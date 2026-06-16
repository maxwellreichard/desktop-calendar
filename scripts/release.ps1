$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

# Read version from Cargo.toml
$version = (Select-String -Path "src-tauri\Cargo.toml" -Pattern '^version = "(.+)"' | Select-Object -First 1).Matches.Groups[1].Value
$tag = "v$version"

Write-Host "Creating release tag: $tag"
git tag $tag
git push origin $tag
Write-Host "Done! GitHub Actions will build and publish the release."
