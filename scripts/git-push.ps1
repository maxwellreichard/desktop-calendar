param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

git add .
git commit -m $Message
git push

Write-Host "Done! Pushed with message: $Message"