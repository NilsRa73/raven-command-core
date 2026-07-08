# RAH Desktop Bridge — optional installer that verifies Node.js.
# Does NOT require administrator rights.
$ErrorActionPreference = "Stop"
Write-Host "Checking Node.js..."
try {
  $ver = & node --version
  Write-Host "Found Node.js $ver"
} catch {
  Write-Host "Node.js not found. Please install Node.js 20 or later from https://nodejs.org/ and re-run this script." -ForegroundColor Yellow
  exit 1
}
Write-Host "No further installation needed. To start the bridge, double-click 'Start RAH Desktop Bridge.cmd'."
