@echo off
setlocal EnableExtensions
title RAH Desktop Bridge

where node >nul 2>&1
if errorlevel 1 goto :node_missing

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :node_bad
if %NODE_MAJOR% LSS 22 goto :node_bad

cd /d "%~dp0"
echo RAH Desktop Bridge - Node.js %NODE_MAJOR% detected.
node src\index.js
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo Bridge exited with code %EC%.
)
pause
exit /b %EC%

:node_missing
echo.
echo Node.js 22 or later is required.
echo Install the current Node.js LTS release, then run this file again.
echo.
pause
exit /b 1

:node_bad
echo.
echo Node.js 22 or later is required. Detected major version: %NODE_MAJOR%
echo Update Node.js, then run this file again.
echo.
pause
exit /b 1
