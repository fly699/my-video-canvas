@echo off
setlocal enableextensions
title update ai-video-canvas

rem ---- project root = parent of this deploy folder ----
pushd "%~dp0.." >nul
set "ROOT=%CD%"
popd >nul
cd /d "%ROOT%"

echo ============================================================
echo   Update ai-video-canvas (pull -^> install -^> migrate -^> build -^> restart)
echo   Project: %ROOT%
echo ============================================================
echo.

rem ---- 0) need git + a git repo ----
where git >nul 2>nul
if errorlevel 1 (
  echo [X] Git not found. Install Git first, or this folder is not a git clone.
  goto end
)
if not exist "%ROOT%\.git" (
  echo [X] This folder is not a git repository ^(no .git^).
  echo     Run the project from the cloned repo, not from an unzipped copy.
  goto end
)

rem ---- 1) pull latest code ----
echo [*] git pull...
git pull
if errorlevel 1 goto fail
echo [OK] code updated.

rem ---- 2) ensure pnpm ----
where pnpm >nul 2>nul
if errorlevel 1 call corepack enable >nul 2>nul

rem ---- 3) load .env (skip # comment lines) so db:push sees DATABASE_URL ----
if exist "%ROOT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ROOT%\.env") do set "%%a=%%b"
)
if not defined PORT set "PORT=3000"

rem ---- 4) deps / migrate / build ----
echo [*] pnpm install...
call pnpm install
if errorlevel 1 goto fail

echo [*] pnpm db:push (apply any schema changes)...
call pnpm db:push
if errorlevel 1 goto fail

echo [*] pnpm build...
call pnpm build
if errorlevel 1 goto fail

rem ---- 5) stop the old server holding the port, then start fresh ----
echo [*] Stopping any old server on port %PORT% ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>nul

echo.
echo ============================================================
echo   Update done. Starting server on http://localhost:%PORT%
echo   Stop the server with Ctrl+C in this window.
echo ============================================================
echo.
call pnpm start
goto end

:fail
echo.
echo [X] Update failed. Read the message above.

:end
echo.
pause
