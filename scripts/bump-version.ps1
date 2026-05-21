param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

# Validate version format
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Invalid version format. Use semantic versioning e.g. 1.0.0"
    exit 1
}

$rootDir = Split-Path -Parent $PSScriptRoot

# Update tauri.conf.json
$tauriConf = Get-Content "$rootDir\src-tauri\tauri.conf.json" -Raw
$tauriConf = $tauriConf -replace '"version": "\d+\.\d+\.\d+"', "`"version`": `"$Version`""
Set-Content "$rootDir\src-tauri\tauri.conf.json" $tauriConf
Write-Host "Updated tauri.conf.json to v$Version"

# Update Cargo.toml
$cargoToml = Get-Content "$rootDir\src-tauri\Cargo.toml" -Raw
$cargoToml = $cargoToml -replace 'version = "\d+\.\d+\.\d+"', "version = `"$Version`""
Set-Content "$rootDir\src-tauri\Cargo.toml" $cargoToml
Write-Host "Updated Cargo.toml to v$Version"

# Git commit and tag
Set-Location $rootDir
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "v$Version"
git tag "v$Version"
git push
git push --tags

Write-Host "Done! Version bumped to v$Version and pushed to GitHub"
