@echo off
title push with history to github
echo ============================================================
echo   Clone source repo (with full history) and push to new repo
echo   Source: fly699/ai-video-canvas (branch claude/ecstatic-cori-IAuiT)
echo   Target: fly699/my-video-canvas (branch main)
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push-history.ps1" %*
echo.
pause >nul
