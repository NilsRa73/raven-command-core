# RAH Desktop Bridge — optional installer that verifies Node.js.
# Does NOT require administrator rights.
$ErrorActionPreference = "Stop"

Write-Host "Checking Node.js..."
try {
  $ver = (& node --version).Trim()
  $major = [int]($ver.TrimStart('v').Split('.')[0])
  Write-Host "Found Node.js $ver"
} catch {
  Write-Host "Node.js not found. Install Node.js 22 or later and re-run this script." -ForegroundColor Yellow
  exit 1
}

if($major -lt 22){
  Write-Host "Node.js 22 or later is required. Detected $ver." -ForegroundColor Yellow
  exit 1
}

Write-Host "PASS: Node.js runtime satisfies the Desktop Bridge engine contract." -ForegroundColor Green
Write-Host "No further installation is required. Double-click 'Start RAH Desktop Bridge.cmd' to start the bridge."
