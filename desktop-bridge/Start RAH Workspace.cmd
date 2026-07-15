@echo off
setlocal

REM RAH Local Workspace launcher.
REM  1) Ensures the Desktop Bridge is running on port 47824.
REM  2) Probes LM Studio (1234) and Ollama (11434) and reports status.
REM  3) Opens Raven Command in the default browser.

set BRIDGE_PORT=47824
set LMSTUDIO_PORT=1234
set OLLAMA_PORT=11434
set WEB_URL=https://raven-command-core.lovable.app

echo === RAH Local Workspace ===
echo.

call :probe %BRIDGE_PORT% "Desktop Bridge"
if errorlevel 1 (
  echo Starting Desktop Bridge...
  start "" "%~dp0Start RAH Desktop Bridge.cmd"
  REM Wait up to 15s for bridge to come up.
  set /a _tries=0
  :wait_bridge
  timeout /t 1 /nobreak >nul
  netstat -ano | findstr /r ":%BRIDGE_PORT% .*LISTENING" >nul && goto bridge_up
  set /a _tries+=1
  if %_tries% lss 15 goto wait_bridge
  echo WARNING: Bridge did not come up on port %BRIDGE_PORT% within 15s.
  goto skip_bridge
  :bridge_up
  echo Bridge is up on port %BRIDGE_PORT%.
  :skip_bridge
) else (
  echo Desktop Bridge already running on port %BRIDGE_PORT%.
)

call :probe %LMSTUDIO_PORT% "LM Studio"
if errorlevel 1 (
  echo LM Studio is NOT running on port %LMSTUDIO_PORT%. Start LM Studio and load a model if you want local AI.
) else (
  echo LM Studio detected on port %LMSTUDIO_PORT%.
)

call :probe %OLLAMA_PORT% "Ollama"
if errorlevel 1 (
  echo Ollama is NOT running on port %OLLAMA_PORT%.  (Optional.)
) else (
  echo Ollama detected on port %OLLAMA_PORT%.
)

echo.
echo Opening %WEB_URL% ...
start "" "%WEB_URL%"
echo Done.
endlocal
exit /b 0

:probe
netstat -ano | findstr /r ":%~1 .*LISTENING" >nul
exit /b %errorlevel%