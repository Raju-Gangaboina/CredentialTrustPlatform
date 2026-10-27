@echo off
cd /d "%~dp0"

if exist node_modules goto checkport

echo Installing dependencies - first run only, this may take a minute...
call npm install

:checkport
set "APP_PORT=3000"
if defined PORT set "APP_PORT=%PORT%"

echo Checking whether something is already running on port %APP_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "if (-not $c) { Write-Host 'Port %APP_PORT% is free.'; exit 0 }" ^
  "$p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue;" ^
  "if ($p -and $p.ProcessName -eq 'node') { Write-Host ('Stopping old server (node, PID ' + $p.Id + ')...'); Stop-Process -Id $p.Id -Force; Start-Sleep -Seconds 1; Write-Host 'Old server stopped.'; exit 0 }" ^
  "Write-Host ('Port %APP_PORT% is used by ' + $p.ProcessName + ' (PID ' + $c.OwningProcess + '), which is not a Node server, so it was left alone.'); exit 2"

if errorlevel 2 (
  echo.
  echo Close that program, or set a different port with:  set PORT=3001
  pause
  exit /b 1
)

echo.
echo Starting server... open http://localhost:%APP_PORT% once it says it is running.
call npm start

echo.
echo Server stopped or failed to start - see any error above.
pause
