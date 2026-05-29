@echo off
chcp 65001 >nul
setlocal enableextensions
title Setup HTTPS (self-signed) for ai-video-canvas

rem ============================================================
rem  生成本机自签证书并启用 HTTPS（启用端到端加密 / PWA 安装的前提）
rem  - 证书自动包含 localhost / 127.0.0.1 / 本机所有局域网 IP
rem  - 可附加额外域名或 IP：setup-https.bat my.host 192.168.1.50
rem ============================================================

rem ---- 定位项目根目录（脚本放在仓库根或子目录均可）----
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\.git" goto rootok
pushd "%~dp0.." >nul
set "ROOT=%CD%"
popd >nul
:rootok
cd /d "%ROOT%"

where pnpm >nul 2>nul
if errorlevel 1 call corepack enable >nul 2>nul

echo [*] 生成自签证书（含本机局域网 IP）...
call pnpm gen-cert %*
if errorlevel 1 (
  echo [X] 生成失败。请先运行 deploy\update.bat 安装依赖（需要 selfsigned 包），再重试。
  goto end
)

echo [*] 重启 app 以启用 HTTPS...
where pm2 >nul 2>nul
if not errorlevel 1 (
  call pm2 describe avc >nul 2>nul
  if not errorlevel 1 (
    call pm2 restart avc --update-env >nul 2>nul
    echo [OK] app 已重启
  ) else (
    echo [!] 未发现 pm2 进程 avc，请运行 deploy\update.bat 或 deploy\runbackground.bat 启动。
  )
) else (
  echo [!] 未检测到 pm2，请手动重启 app。
)

echo.
echo ============================================================
echo   HTTPS 已启用（默认读取 certs\cert.pem 与 certs\key.pem）
echo.
echo   本机访问:        https://localhost:3000
echo   局域网其他机器:  https://本机IP:3000
echo.
echo   其他机器去除证书警告（二选一）:
echo     A) 直接点「高级 - 继续访问」即可使用（HTTPS 仍生效，端到端加密可用）
echo     B) 安装证书消除警告:
echo        1. 在该机器浏览器打开  https://本机IP:3000/cert.crt  下载证书
echo        2. 双击证书 - 安装到「本地计算机 - 受信任的根证书颁发机构」
echo        3. 重启浏览器
echo ============================================================
goto end

:end
echo.
pause
