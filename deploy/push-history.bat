@echo off
setlocal enabledelayedexpansion
title push with history to github

set "SOURCE_URL=https://github.com/fly699/ai-video-canvas.git"
set "SOURCE_BRANCH=claude/ecstatic-cori-IAuiT"
set "TARGET_URL=https://github.com/fly699/my-video-canvas.git"
set "TARGET_BRANCH=main"

rem clone destination = sibling of the project folder
pushd "%~dp0..\.." >nul
set "PARENT=%CD%"
popd >nul
set "DEST=%PARENT%\my-video-canvas"

echo ============================================================
echo   Push WITH full history to a new GitHub repo
echo   Source: %SOURCE_URL%
echo           branch %SOURCE_BRANCH%
echo   Target: %TARGET_URL%
echo           branch %TARGET_BRANCH%
echo   Clone into: %DEST%
echo ============================================================
echo.

rem ---- 1) ensure git (auto-install via winget if missing) ----
where git >nul 2>nul
if not errorlevel 1 goto gitok

echo [*] Git not found. Trying to auto-install via winget...
where winget >nul 2>nul
if errorlevel 1 goto nogit
winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
rem make git visible in THIS window without reopening
set "PATH=%PATH%;C:\Program Files\Git\cmd;C:\Program Files\Git\bin"
where git >nul 2>nul
if not errorlevel 1 goto gitok
echo [X] Git was installed but not detected in this window.
echo     Please CLOSE this window and double-click the script again.
goto end

:nogit
echo [X] winget not available. Install Git manually, then rerun:
echo     https://git-scm.com/download/win
goto end

:gitok
for /f "delims=" %%v in ('git --version') do echo [OK] %%v

rem ---- 2) target folder must not exist ----
if exist "%DEST%" (
  echo [X] Target folder already exists:
  echo     %DEST%
  echo     Delete/rename it, then run again.
  goto end
)

rem ---- 3) clone source (full history) ----
echo.
echo [*] Cloning source repo ^(login popup may appear^)...
git clone "%SOURCE_URL%" "%DEST%"
if errorlevel 1 goto fail
cd /d "%DEST%"

rem ---- 4) checkout the branch we want to keep ----
echo [*] Checking out branch %SOURCE_BRANCH% ...
git checkout %SOURCE_BRANCH%
if errorlevel 1 goto fail

rem ---- 5) rename branch to target, switch remotes ----
git branch -M %TARGET_BRANCH%
git remote rename origin upstream
git remote add origin "%TARGET_URL%"

rem ---- 6) push with history ----
echo.
echo [*] Pushing to new repo ^(login popup may appear^)...
git push -u origin %TARGET_BRANCH%
if errorlevel 1 goto fail

echo.
echo ============================================================
echo   DONE. New repo now has the FULL commit history.
echo   Repo:   https://github.com/fly699/my-video-canvas
echo   Folder: %DEST%   ^(your working copy from now on^)
echo   Update later:  git add -A ^&^& git commit -m "msg" ^&^& git push
echo   Sync source:   git fetch upstream ^&^& git merge upstream/main
echo ============================================================
goto end

:fail
echo.
echo [X] A git command failed. Read the message above.
echo     Common causes: repo not created yet on GitHub, or login cancelled.

:end
echo.
pause
