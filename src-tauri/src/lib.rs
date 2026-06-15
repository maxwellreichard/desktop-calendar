use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let _ = apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None);
            }

            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_mica;
                let _ = apply_mica(&window, Some(true));
            }

            std::thread::spawn(|| {
                start_oauth_server();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── URL helpers ───────────────────────────────────────────────────────────────

fn url_decode(s: &str) -> String {
    let mut out = Vec::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        } else if b[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                String::from(b as char)
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn parse_query(s: &str) -> std::collections::HashMap<String, String> {
    s.split('&')
        .filter_map(|pair| {
            let mut it = pair.splitn(2, '=');
            let k = url_decode(it.next()?);
            let v = url_decode(it.next().unwrap_or(""));
            if k.is_empty() { None } else { Some((k, v)) }
        })
        .collect()
}

// ── OAuth server ──────────────────────────────────────────────────────────────

struct ExchangeParams {
    client_id: String,
    code_verifier: String,
    redirect_uri: String,
    scope: String,
}

fn start_oauth_server() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    let pending_code: Arc<Mutex<Option<String>>>             = Arc::new(Mutex::new(None));
    let pending_exchange: Arc<Mutex<Option<ExchangeParams>>> = Arc::new(Mutex::new(None));
    let pending_tokens: Arc<Mutex<Option<String>>>           = Arc::new(Mutex::new(None));

    let listener = TcpListener::bind("127.0.0.1:8642")
        .unwrap_or_else(|_| TcpListener::bind("127.0.0.1:0").unwrap());

    for stream in listener.incoming() {
        if let Ok(mut stream) = stream {
            let mut buffer = [0u8; 8192];
            let n = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..n]).to_string();
            let first_line = request.lines().next().unwrap_or("").to_string();

            // CORS preflight
            if first_line.starts_with("OPTIONS") {
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\n\
                      Access-Control-Allow-Origin: *\r\n\
                      Access-Control-Allow-Methods: GET, POST\r\n\
                      Access-Control-Allow-Headers: *\r\n\r\n",
                );
                continue;
            }

            // POST /oauth/setup — JS sends exchange params before opening the browser
            if first_line.starts_with("POST") && first_line.contains("/oauth/setup") {
                println!("[oauth] setup POST received");
                if let Some(pos) = request.find("\r\n\r\n") {
                    let body = &request[pos + 4..];
                    let params = parse_query(body.trim_end_matches('\0'));
                    let client_id = params.get("client_id").cloned().unwrap_or_default();
                    println!("[oauth] setup params parsed, client_id present: {}", !client_id.is_empty());
                    *pending_exchange.lock().unwrap() = Some(ExchangeParams {
                        client_id,
                        code_verifier: params.get("code_verifier").cloned().unwrap_or_default(),
                        redirect_uri:  params.get("redirect_uri") .cloned().unwrap_or_default(),
                        scope:         params.get("scope")        .cloned().unwrap_or_default(),
                    });
                } else {
                    println!("[oauth] setup: could not find header/body separator in request");
                }
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\n\
                      Access-Control-Allow-Origin: *\r\n\
                      Content-Type: application/json\r\n\r\n\
                      {\"ok\":true}",
                );
                continue;
            }

            // GET /oauth/callback — browser redirect after user authenticates
            if first_line.contains("/oauth/callback") {
                println!("[oauth] callback received: {}", first_line);
                let query = first_line
                    .split('?').nth(1)
                    .and_then(|q| q.split(' ').next())
                    .unwrap_or("");
                let params = parse_query(query);
                println!("[oauth] callback has code: {}, has error: {}",
                    params.contains_key("code"), params.contains_key("error"));

                // Take pending_exchange regardless — clears it so it isn't reused
                let exchange = pending_exchange.lock().unwrap().take();
                println!("[oauth] pending_exchange present: {}", exchange.is_some());

                if let Some(code) = params.get("code").cloned() {
                    if let Some(ex) = exchange {
                        // Outlook: exchange code in a background thread so the server
                        // stays responsive to JS polling while the request is in flight
                        println!("[oauth] spawning token exchange thread");
                        let tokens_ref = Arc::clone(&pending_tokens);
                        std::thread::spawn(move || {
                            println!("[oauth] thread: starting token exchange");
                            let body = format!(
                                "client_id={}&code={}&code_verifier={}\
                                 &redirect_uri={}&grant_type=authorization_code&scope={}",
                                url_encode(&ex.client_id),
                                url_encode(&code),
                                url_encode(&ex.code_verifier),
                                url_encode(&ex.redirect_uri),
                                url_encode(&ex.scope),
                            );
                            let agent = ureq::AgentBuilder::new()
                                .timeout_connect(std::time::Duration::from_secs(15))
                                .timeout_read(std::time::Duration::from_secs(30))
                                .build();
                            let result = agent
                                .post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
                                .set("Content-Type", "application/x-www-form-urlencoded")
                                .send_string(&body);
                            let token_json = match result {
                                Ok(resp) => {
                                    println!("[oauth] thread: token exchange succeeded");
                                    resp.into_string().unwrap_or_else(|_| "{}".into())
                                }
                                Err(ureq::Error::Status(code, resp)) => {
                                    println!("[oauth] thread: token exchange HTTP error {}", code);
                                    resp.into_string().unwrap_or_else(|_| "{}".into())
                                }
                                Err(e) => {
                                    println!("[oauth] thread: token exchange network error: {}", e);
                                    format!(
                                        "{{\"error\":\"request_failed\",\"error_description\":\"{}\"}}",
                                        e.to_string().replace('"', "\\\"")
                                    )
                                }
                            };
                            println!("[oauth] thread: storing token_json");
                            *tokens_ref.lock().unwrap() = Some(token_json);
                        });
                    } else {
                        // Google: store code for client-side exchange
                        *pending_code.lock().unwrap() = Some(code);
                    }
                } else if exchange.is_some() {
                    // Microsoft returned an error redirect (no code) during Outlook flow
                    let error = params.get("error").cloned().unwrap_or_else(|| "auth_failed".into());
                    let desc  = params.get("error_description").cloned().unwrap_or_default();
                    *pending_tokens.lock().unwrap() = Some(format!(
                        "{{\"error\":\"{}\",\"error_description\":\"{}\"}}",
                        error.replace('"', "\\\""),
                        desc.replace('"', "\\\"").replace('+', " ")
                    ));
                }

                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
                      <html><body>\
                      <h2>Authentication successful!</h2>\
                      <p>You can close this tab and return to the app.</p>\
                      </body></html>",
                );
                continue;
            }

            // GET /oauth/tokens — Outlook: JS polls for the full token JSON
            if first_line.contains("/oauth/tokens") {
                if let Some(t) = pending_tokens.lock().unwrap().take() {
                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                         Content-Type: application/json\r\n\
                         Access-Control-Allow-Origin: *\r\n\r\n{}",
                        t
                    );
                    let _ = stream.write_all(response.as_bytes());
                } else {
                    let _ = stream.write_all(
                        b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
                    );
                }
                continue;
            }

            // GET /oauth/token — Google: JS polls for auth code
            if first_line.contains("/oauth/token") {
                if let Some(c) = pending_code.lock().unwrap().take() {
                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                         Content-Type: application/json\r\n\
                         Access-Control-Allow-Origin: *\r\n\r\n\
                         {{\"code\":\"{}\"}}",
                        c
                    );
                    let _ = stream.write_all(response.as_bytes());
                } else {
                    let _ = stream.write_all(
                        b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
                    );
                }
                continue;
            }
        }
    }
}
