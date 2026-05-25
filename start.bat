@echo off
setlocal

cd /d "%~dp0"

echo [pokemon-watcher] starting docker (postgres + redis)...
docker compose up -d
if errorlevel 1 (
  echo [pokemon-watcher] docker compose failed. Is Docker Desktop running?
  pause
  exit /b 1
)

echo [pokemon-watcher] waiting for postgres healthy...
:waitloop
for /f "delims=" %%H in ('docker inspect -f "{{.State.Health.Status}}" pokemon-watcher-postgres 2^>nul') do set STATUS=%%H
if /i not "%STATUS%"=="healthy" (
  timeout /t 2 /nobreak >nul
  goto waitloop
)
echo [pokemon-watcher] postgres healthy.

if not exist node_modules (
  echo [pokemon-watcher] installing backend dependencies...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist web\node_modules (
  echo [pokemon-watcher] installing frontend dependencies...
  call npm --prefix web install
  if errorlevel 1 ( pause & exit /b 1 )
)

echo [pokemon-watcher] building server + frontend...
call npm run build
if errorlevel 1 (
  echo [pokemon-watcher] build failed.
  pause
  exit /b 1
)

for /f "tokens=2 delims==" %%P in ('findstr /b "WEB_PORT=" .env 2^>nul') do set WEB_PORT=%%P
if "%WEB_PORT%"=="" set WEB_PORT=3000

echo.
echo [pokemon-watcher] scheduler + WebApp starting...
echo [pokemon-watcher] open http://localhost:%WEB_PORT% in browser (Ctrl+C to stop)
echo.
call npm run start
if errorlevel 1 (
  echo [pokemon-watcher] process exited with error.
  pause
)

endlocal
