@echo off
chcp 65001 >nul
setlocal enableextensions
title update ai-video-canvas

rem ============================================================
rem  Locate project root.
rem  Works whether this .bat sits in the repo root OR in a subfolder
rem  (e.g. <project>\deploy\). We pick the git repo automatically.
rem ============================================================
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\.git" goto rootok
rem not a repo here -> try the parent folder
pushd "%~dp0.." >nul
set "ROOT=%CD%"
popd >nul
:rootok
cd /d "%ROOT%"

echo ============================================================
echo   Update ai-video-canvas (pull -^> install -^> migrate -^> build -^> pm2 restart)
echo   Project: %ROOT%
echo ============================================================
echo.

rem ---- 0) need git + a git repo ----
where git >nul 2>nul
if errorlevel 1 (
  echo [X] Git not found. Install Git first.
  goto end
)
if not exist "%ROOT%\.git" (
  echo [X] Could not find a git repository ^(no .git in this folder or its parent^).
  echo     Put this script inside the cloned repo ^(root or a subfolder^).
  goto end
)

rem ---- ensure git commit identity (pull may create a merge commit) ----
git config user.email >nul 2>nul || git config user.email "fly699@gmail.com"
git config user.name  >nul 2>nul || git config user.name  "fly699"

rem ---- 1) pull latest code (--no-edit: don't open an editor for merge commits) ----
echo [*] git pull...
git pull --no-edit
if errorlevel 1 (
  echo [!] Pull failed - resetting local deploy script changes and retrying...
  rem .env is gitignored and unaffected; deploy scripts follow the repo version.
  git merge --abort 2>nul
  git checkout -- deploy/ 2>nul
  git pull --no-edit
)
if errorlevel 1 goto fail
echo [OK] code updated.

rem ---- 2) ensure pnpm ----
where pnpm >nul 2>nul
if errorlevel 1 call corepack enable >nul 2>nul

rem ---- 3) load .env so drizzle (db:push) and pm2 see the vars ----
rem      NOTE: write values WITHOUT surrounding quotes in .env.
if exist "%ROOT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ROOT%\.env") do set "%%a=%%b"
) else (
  echo.
  echo [!] WARNING: no .env found at %ROOT%\.env
  echo     Copy .env.example to .env and fill it in ^(at least DATABASE_URL / JWT_SECRET / OWNER_EMAIL^),
  echo     or run deploy\deploy.bat for a fresh one-click deploy.
  echo.
)
rem strip accidental surrounding quotes from DATABASE_URL (drizzle reads it raw)
if defined DATABASE_URL set "DATABASE_URL=%DATABASE_URL:"=%"

rem ---- 3b) default to production unless .env says otherwise ----
if not defined NODE_ENV set "NODE_ENV=production"
if /i "%NODE_ENV%"=="production" if not defined JWT_SECRET (
  echo.
  echo [!] WARNING: JWT_SECRET is not set in .env.
  echo     Sessions would use an INSECURE built-in fallback key.
  echo     Add a strong random JWT_SECRET to .env before serving real users.
  echo.
)

rem ---- 4) deps / migrate / build ----
echo [*] pnpm install...
call pnpm install
if errorlevel 1 goto fail

echo [*] pnpm db:push (apply committed migrations)...
call pnpm db:push
if errorlevel 1 goto fail

echo [*] pnpm build...
call pnpm build
if errorlevel 1 goto fail

rem ---- 5) restart: prefer Windows service (AVC-App) if installed, else pm2 ----
sc query AVC-App >nul 2>nul
if not errorlevel 1 (
  echo [*] Restarting Windows service AVC-App ...
  net stop AVC-App >nul 2>nul
  net start AVC-App >nul 2>nul
  echo [OK] service restarted
  goto donerestart
)

rem ---- ensure pm2 ----
where pm2 >nul 2>nul
if errorlevel 1 (
  echo [*] Installing pm2...
  call npm install -g pm2
  set "PATH=%PATH%;%AppData%\npm"
)
where pm2 >nul 2>nul
if errorlevel 1 (
  echo [X] pm2 not found. Open a NEW window and run again, or: npm install -g pm2
  goto end
)

rem ---- restart with FRESH env (delete+start guarantees .env changes apply) ----
echo [*] (Re)starting app in background under pm2 with fresh env...
call pm2 delete avc >nul 2>nul
call pm2 start "%ROOT%\dist\index.js" --name avc --cwd "%ROOT%"
if errorlevel 1 goto fail
call pm2 save >nul 2>nul
:donerestart

echo.
echo ============================================================
echo   Update done. App is running in the BACKGROUND.
echo   You can close this window - it keeps running.
echo   Open:  http://localhost:3000
echo   Logs:  pm2 logs avc      Status: pm2 status
echo.
echo   Tip: to auto-start on boot, install once:
echo        npm i -g pm2-windows-startup ^&^& pm2-startup install
echo ============================================================
goto end

:fail
echo.
echo [X] Update failed. Read the message above.

:end
echo.
pause
