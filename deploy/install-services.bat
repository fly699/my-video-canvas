@echo off
chcp 65001 >nul
setlocal enableextensions enabledelayedexpansion
title 注册为 Windows 服务（开机自启，无需登录）

rem ============================================================
rem  用 NSSM 把 App 与 MinIO 注册成 Windows 服务（开机即启，登录前）
rem  前提：先跑过 deploy\update.bat（生成 dist）与 deploy\setup-minio.bat（下载 minio.exe）
rem ============================================================

rem ---- 必须管理员 ----
net session >nul 2>nul
if errorlevel 1 (
  echo [X] 请右键本脚本，选择"以管理员身份运行"。
  pause & exit /b 1
)

rem ---- 可改：MinIO 凭据，应与 .env 中的 S3_ACCESS_KEY / S3_SECRET_KEY 一致 ----
set "MINIO_USER=minioadmin"
set "MINIO_PASS=minio-secret-change-me"

rem ---- 定位项目根 ----
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\.git" goto rootok
pushd "%~dp0.." >nul
set "ROOT=%CD%"
popd >nul
:rootok
cd /d "%ROOT%"

set "MINIO_HOME=%ROOT%\minio"
set "MINIO_DATA=%MINIO_HOME%\data"

rem ---- 找 node.exe ----
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE (
  echo [X] 未找到 node，请先安装 Node.js。
  pause & exit /b 1
)

rem ---- 确保 dist 已构建 ----
if not exist "%ROOT%\dist\index.js" (
  echo [X] 未找到 dist\index.js，请先运行 deploy\update.bat 构建。
  pause & exit /b 1
)

rem ---- 准备 NSSM（没有则下载并解压）----
set "NSSM=%MINIO_HOME%\nssm.exe"
if exist "%NSSM%" goto nssmok
echo [*] 下载 NSSM ...
curl -L -o "%TEMP%\nssm.zip" https://nssm.cc/release/nssm-2.24.zip
if errorlevel 1 goto failnssm
powershell -NoProfile -Command "Expand-Archive -Force '%TEMP%\nssm.zip' '%TEMP%\nssm-extract'"
copy /y "%TEMP%\nssm-extract\nssm-2.24\win64\nssm.exe" "%NSSM%" >nul
:nssmok
if not exist "%NSSM%" goto failnssm

rem ---- 停掉 pm2 版，避免端口冲突（服务将接管）----
where pm2 >nul 2>nul
if not errorlevel 1 (
  echo [*] 停止并移除 pm2 中的 avc / minio ...
  call pm2 delete avc >nul 2>nul
  call pm2 delete minio >nul 2>nul
  call pm2 save >nul 2>nul
)

rem ---- 注册 MinIO 服务 ----
if exist "%MINIO_HOME%\minio.exe" (
  echo [*] 注册服务 AVC-MinIO ...
  "%NSSM%" stop AVC-MinIO >nul 2>nul
  "%NSSM%" remove AVC-MinIO confirm >nul 2>nul
  "%NSSM%" install AVC-MinIO "%MINIO_HOME%\minio.exe" server "%MINIO_DATA%" --address ":9000" --console-address ":9001"
  "%NSSM%" set AVC-MinIO AppDirectory "%MINIO_HOME%"
  "%NSSM%" set AVC-MinIO AppEnvironmentExtra MINIO_ROOT_USER=%MINIO_USER% MINIO_ROOT_PASSWORD=%MINIO_PASS%
  "%NSSM%" set AVC-MinIO Start SERVICE_AUTO_START
  "%NSSM%" start AVC-MinIO
  echo [OK] AVC-MinIO 已安装并启动
) else (
  echo [!] 未找到 minio.exe，跳过 MinIO 服务（请先跑 deploy\setup-minio.bat）。
)

rem ---- 注册 App 服务（node dist\index.js，工作目录=项目根，自动读 .env）----
echo [*] 注册服务 AVC-App ...
"%NSSM%" stop AVC-App >nul 2>nul
"%NSSM%" remove AVC-App confirm >nul 2>nul
"%NSSM%" install AVC-App "%NODE%" "%ROOT%\dist\index.js"
"%NSSM%" set AVC-App AppDirectory "%ROOT%"
"%NSSM%" set AVC-App AppEnvironmentExtra NODE_ENV=production
"%NSSM%" set AVC-App Start SERVICE_AUTO_START
rem 进程任何退出都自动重启（应用内「一键更新」构建完成后会自我退出以加载新版本）
"%NSSM%" set AVC-App AppExit Default Restart
"%NSSM%" set AVC-App AppRestartDelay 2000
"%NSSM%" set AVC-App AppThrottle 3000
"%NSSM%" start AVC-App
echo [OK] AVC-App 已安装并启动

echo.
echo ============================================================
echo   完成！已注册为 Windows 服务，开机即启（无需登录）：
echo     AVC-App    ^<- 应用（node dist\index.js）
echo     AVC-MinIO  ^<- 对象存储
echo.
echo   管理：services.msc，或命令：
echo     "%NSSM%" restart AVC-App
echo     "%NSSM%" stop AVC-App / start AVC-App
echo     "%NSSM%" remove AVC-App confirm   ^(卸载服务^)
echo.
echo   [提示] 以后更新代码：先 deploy\update.bat 构建，再
echo          "%NSSM%" restart AVC-App 让服务加载新代码。
echo   [提示] 若服务无法读取桌面下的项目文件，可在 services.msc
echo          里把这两个服务的"登录"账户改为你的 Windows 账户。
echo ============================================================
pause
goto :eof

:failnssm
echo.
echo [X] 未能准备 nssm.exe（下载或解压失败）。请手动下载 nssm.cc/release/nssm-2.24.zip，
echo     解压取出 win64\nssm.exe 放到 %MINIO_HOME%\ 后重试。
pause
exit /b 1
