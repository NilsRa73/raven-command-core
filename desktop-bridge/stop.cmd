@echo off
REM Closes any bridge running on the default localhost port.
setlocal
set PORT=47824
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":%PORT% .*LISTENING"') do (
  echo Stopping bridge PID %%p
  taskkill /pid %%p /f >nul
)
endlocal
