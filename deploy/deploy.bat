@echo off
chcp 65001 >nul
title ai-video-canvas 一键部署
echo ============================================================
echo   ai-video-canvas  Windows 一键部署
echo   即将调用 deploy.ps1 完成全部步骤...
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
echo.
echo ============================================================
echo   脚本已结束。按任意键关闭窗口。
echo ============================================================
pause >nul
