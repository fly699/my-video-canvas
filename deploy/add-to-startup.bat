@echo off
chcp 65001 >nul
setlocal enableextensions
title 添加 AI视频画布 到 Windows 启动

rem ============================================================
rem  在 Windows「启动」文件夹创建快捷方式，登录后自动打开应用。
rem  配合登录页勾选「下次自动登录」即可开机自动进入。
rem ============================================================

rem ---- 应用地址（按你的实际访问地址修改：https/http、端口、IP）----
set "APP_URL=https://172.16.0.114:3000"

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\AI视频画布.url"

echo [*] 应用地址：%APP_URL%
echo [*] 启动项位置：%LNK%
echo.

> "%LNK%" echo [InternetShortcut]
>> "%LNK%" echo URL=%APP_URL%

if exist "%LNK%" (
  echo [OK] 已添加到 Windows 启动。登录系统后会自动打开应用。
  echo     若登录页已勾选"下次自动登录"，将自动登录进入。
) else (
  echo [X] 创建失败，请检查权限或手动操作：Win+R 输入 shell:startup，
  echo     在打开的文件夹里新建一个指向 %APP_URL% 的快捷方式。
)

echo.
echo ------------------------------------------------------------
echo  想用"已安装的应用窗口"开机自启（而不是浏览器标签）：
echo    1) Win+R 输入 shell:startup 打开启动文件夹；
echo    2) 在开始菜单找到已安装的"聊天/AI视频画布"应用图标，
echo       右键 - 更多 - 打开文件位置，把该快捷方式复制到启动文件夹。
echo.
echo  移除开机启动：删除文件  %LNK%
echo ------------------------------------------------------------
pause
