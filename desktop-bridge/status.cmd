@echo off
setlocal
set PORT=47824
netstat -ano | findstr /r ":%PORT% .*LISTENING" >nul
if errorlevel 1 (
  echo Bridge is NOT running on port %PORT%.
) else (
  echo Bridge is running on http://127.0.0.1:%PORT%
)
endlocal
