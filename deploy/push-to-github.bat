@echo off
title push to github
echo ============================================================
echo   Push this project to a new GitHub repository
echo   Target: https://github.com/fly699/my-video-canvas
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push-to-github.ps1" %*
echo.
pause >nul
