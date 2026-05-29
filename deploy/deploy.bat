@echo off
title ai-video-canvas deploy
echo ============================================================
echo   ai-video-canvas  Windows one-click deploy
echo   Launching deploy.ps1 (will request admin via UAC)...
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
echo.
echo ============================================================
echo   Script finished. Press any key to close this window.
echo ============================================================
pause >nul
