@echo off
chcp 65001 >nul
setlocal enableextensions enabledelayedexpansion
title Setup MinIO for ai-video-canvas

rem ============================================================
rem  一键安装并启动 MinIO（S3 兼容对象存储，用于聊天文件）
rem  - 下载 minio.exe / mc.exe
rem  - 用 pm2 后台常驻（随 app 一起开机自启）
rem  - 创建存储桶
rem  - 把 S3_* 配置写入项目 .env
rem ============================================================

rem ---- 可按需修改的配置 ----
set "MINIO_USER=minioadmin"
set "MINIO_PASS=minio-secret-change-me"
set "MINIO_PORT=9000"
set "MINIO_CONSOLE=9001"
set "BUCKET=avc-chat"

rem ---- 定位项目根目录（脚本放在仓库根或子目录均可）----
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\.git" goto rootok
pushd "%~dp0.." >nul
set "ROOT=%CD%"
popd >nul
:rootok

rem MinIO 程序与数据放在项目目录下的 minio 文件夹
set "MINIO_HOME=%ROOT%\minio"
set "MINIO_DATA=%MINIO_HOME%\data"
if not exist "%MINIO_DATA%" mkdir "%MINIO_DATA%"

echo ============================================================
echo   MinIO 安装目录: %MINIO_HOME%
echo   数据目录:       %MINIO_DATA%
echo   API 端口:       %MINIO_PORT%   控制台: %MINIO_CONSOLE%
echo   桶名:           %BUCKET%
echo ============================================================
echo.

rem ---- 1) 下载 minio.exe ----
if not exist "%MINIO_HOME%\minio.exe" (
  echo [*] 下载 minio.exe ...
  curl -L -o "%MINIO_HOME%\minio.exe" https://dl.min.io/server/minio/release/windows-amd64/minio.exe
  if errorlevel 1 goto faildl
) else (
  echo [OK] minio.exe 已存在
)

rem ---- 2) 下载 mc.exe（客户端，用于建桶）----
if not exist "%MINIO_HOME%\mc.exe" (
  echo [*] 下载 mc.exe ...
  curl -L -o "%MINIO_HOME%\mc.exe" https://dl.min.io/client/mc/release/windows-amd64/mc.exe
  if errorlevel 1 goto faildl
) else (
  echo [OK] mc.exe 已存在
)

rem ---- 3) 设置 MinIO 凭据到环境（被 pm2 进程继承）----
set "MINIO_ROOT_USER=%MINIO_USER%"
set "MINIO_ROOT_PASSWORD=%MINIO_PASS%"

rem ---- 4) 启动 MinIO（优先 pm2，便于后台常驻 + 开机自启）----
where pm2 >nul 2>nul
if errorlevel 1 (
  echo [*] 未检测到 pm2，将在新窗口启动 MinIO（关闭窗口即停止）...
  start "MinIO" "%MINIO_HOME%\minio.exe" server "%MINIO_DATA%" --address ":%MINIO_PORT%" --console-address ":%MINIO_CONSOLE%"
) else (
  echo [*] 用 pm2 启动 MinIO（后台常驻）...
  call pm2 delete minio >nul 2>nul
  call pm2 start "%MINIO_HOME%\minio.exe" --name minio --interpreter none -- server "%MINIO_DATA%" --address ":%MINIO_PORT%" --console-address ":%MINIO_CONSOLE%"
  call pm2 save >nul 2>nul
)

rem ---- 5) 等待 MinIO 就绪 ----
echo [*] 等待 MinIO 就绪 ...
set "READY="
for /l %%i in (1,1,30) do (
  curl -s -o nul "http://127.0.0.1:%MINIO_PORT%/minio/health/live" && (set "READY=1" & goto ready)
  timeout /t 1 >nul
)
:ready
if not defined READY (
  echo [X] MinIO 未在 30 秒内就绪，请检查端口 %MINIO_PORT% 是否被占用，或查看 pm2 logs minio
  goto end
)
echo [OK] MinIO 已启动

rem ---- 6) 创建存储桶 ----
"%MINIO_HOME%\mc.exe" alias set avclocal "http://127.0.0.1:%MINIO_PORT%" "%MINIO_USER%" "%MINIO_PASS%" >nul 2>nul
"%MINIO_HOME%\mc.exe" mb --ignore-existing avclocal/%BUCKET%
echo [OK] 存储桶 %BUCKET% 就绪

rem ---- 7) 写入 .env（若尚未配置 S3）----
if exist "%ROOT%\.env" (
  findstr /b /c:"S3_ENDPOINT=" "%ROOT%\.env" >nul 2>nul
  if errorlevel 1 (
    echo.>>"%ROOT%\.env"
    echo # MinIO 自建对象存储（聊天文件）>>"%ROOT%\.env"
    echo S3_ENDPOINT=http://127.0.0.1:%MINIO_PORT%>>"%ROOT%\.env"
    echo S3_BUCKET=%BUCKET%>>"%ROOT%\.env"
    echo S3_ACCESS_KEY=%MINIO_USER%>>"%ROOT%\.env"
    echo S3_SECRET_KEY=%MINIO_PASS%>>"%ROOT%\.env"
    echo S3_REGION=us-east-1>>"%ROOT%\.env"
    echo S3_FORCE_PATH_STYLE=true>>"%ROOT%\.env"
    echo [OK] 已把 S3_* 配置追加到 %ROOT%\.env
    set "ENV_WRITTEN=1"
  ) else (
    echo [!] .env 已有 S3_ENDPOINT，跳过写入。请自行核对以下配置：
  )
) else (
  echo [!] 未找到 %ROOT%\.env，请手动把以下配置加入 .env：
)

echo.
echo ------- 应写入 .env 的配置 -------
echo S3_ENDPOINT=http://127.0.0.1:%MINIO_PORT%
echo S3_BUCKET=%BUCKET%
echo S3_ACCESS_KEY=%MINIO_USER%
echo S3_SECRET_KEY=%MINIO_PASS%
echo S3_REGION=us-east-1
echo S3_FORCE_PATH_STYLE=true
echo ---------------------------------

rem ---- 8) 重启 app 让其读到新 .env ----
where pm2 >nul 2>nul
if not errorlevel 1 (
  call pm2 describe avc >nul 2>nul
  if not errorlevel 1 (
    echo [*] 重启 app 以加载新配置...
    call pm2 restart avc --update-env >nul 2>nul
    echo [OK] app 已重启
  )
)

echo.
echo ============================================================
echo   完成！MinIO 控制台: http://127.0.0.1:%MINIO_CONSOLE%
echo   登录: %MINIO_USER% / %MINIO_PASS%
echo   管理 MinIO:  pm2 logs minio   pm2 restart minio   pm2 stop minio
echo.
echo   [安全提醒] 请把上面的 MINIO_PASS 改成你自己的强密码，
echo   改完重跑本脚本或手动同步 .env 后重启 app。
echo ============================================================
goto end

:faildl
echo.
echo [X] 下载失败。请检查网络是否能访问 dl.min.io，或手动下载 minio.exe / mc.exe 放到 %MINIO_HOME%\
goto end

:end
echo.
pause
