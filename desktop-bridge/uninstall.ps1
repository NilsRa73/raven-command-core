# Removes bridge configuration and audit log from %LOCALAPPDATA%\RAH\DesktopBridge
$dir = Join-Path $env:LOCALAPPDATA "RAH\DesktopBridge"
if (Test-Path $dir) {
  Remove-Item -Recurse -Force $dir
  Write-Host "Removed bridge config at $dir"
} else {
  Write-Host "No bridge config found."
}
