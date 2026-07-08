@echo off
setlocal
title RAH Desktop Bridge
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js 20 or later is required.
  echo Download it from https://nodejs.org/ then run this file again.
  echo.
  pause
  exit /b 1
)
cd /d "%~dp0"
node src\index.js
pause
