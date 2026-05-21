use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])))
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let _ = window;

            // Start OAuth callback server
            std::thread::spawn(|| {
                start_oauth_server();
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_oauth_server() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    let pending_code: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let listener = TcpListener::bind("127.0.0.1:8642").unwrap_or_else(|_| {
        TcpListener::bind("127.0.0.1:0").unwrap()
    });

    for stream in listener.incoming() {
        if let Ok(mut stream) = stream {
            let mut buffer = [0; 4096];
            if stream.read(&mut buffer).is_ok() {
                let request = String::from_utf8_lossy(&buffer);
                let first_line = request.lines().next().unwrap_or("");
                if first_line.contains("OPTIONS") {
                    let response = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Headers: *\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes());
                    continue;
                }
                if first_line.contains("/oauth/callback") {
                    // Extract code from query string
                    let code = first_line
                        .split('?')
                        .nth(1)
                        .and_then(|q| q.split('&').find(|p| p.starts_with("code=")))
                        .and_then(|p| p.split('=').nth(1))
                        .map(|c| c.split(' ').next().unwrap_or("").to_string());

                    if let Some(code) = code {
                        *pending_code.lock().unwrap() = Some(code);
                        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to the app.</p></body></html>";
                        let _ = stream.write_all(response.as_bytes());
                    }
                } else if first_line.contains("/oauth/token") {
                    let code = pending_code.lock().unwrap().clone();
                    let response = if let Some(c) = code {
                        *pending_code.lock().unwrap() = None;
                        format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n{{\"code\":\"{}\"}}", c)
                    } else {
                        "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\n\r\n".to_string()
                    };
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        }
    }
}