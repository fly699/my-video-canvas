<#
================================================================================
  ai-video-canvas  Windows 全自动部署脚本（方案 B：Docker + MySQL，局域网访问）
================================================================================
  一键完成（尽可能零手动）：
    自动提权(UAC) → winget 自动装 Node.js → winget 自动装 Docker Desktop
    → 起 MySQL 容器 → 生成 .env → 装依赖 → 建表 → 构建 → 开防火墙 → 启动

  用法（在项目根目录，双击 deploy\一键部署.bat，或运行）：
    powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1

  常用参数：
    -DbPassword "pass"      MySQL root 密码（默认随机生成）
    -OwnerEmail "a@b.com"   管理员邮箱（默认 fly699@gmail.com）
    -Port 3000              监听端口（默认 3000）
    -SkipBuild              跳过构建（已构建过，加速重启）
    -SkipDeps               跳过自动安装 Node/Docker（你已手动装好）
    -NoFirewall             不创建防火墙规则（仅本机访问时用）
    -Reset                  删除并重建 MySQL 容器（清空数据库！）

  说明：首次安装 Docker Desktop 可能需要重启一次电脑（WSL2）。
        若脚本提示需要重启，重启后再运行一次本脚本即可自动续上（脚本幂等）。
================================================================================
#>

param(
    [string]$DbPassword = "",
    [string]$OwnerEmail  = "",
    [int]$Port           = 3000,
    [switch]$SkipBuild,
    [switch]$SkipDeps,
    [switch]$NoFirewall,
    [switch]$Reset
)

$ErrorActionPreference = "Stop"

# ---------- 彩色输出辅助 ----------
function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Die($msg)      { Write-Host "`n    XX  $msg`n" -ForegroundColor Red; exit 1 }
function Have($cmd)     { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $m = [System.Environment]::GetEnvironmentVariable("Path","Machine")
    $u = [System.Environment]::GetEnvironmentVariable("Path","User")
    $env:Path = "$m;$u"
}

# ============================================================================
#  0) 自动提权：安装软件、配置防火墙都需要管理员权限
# ============================================================================
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "需要管理员权限来安装软件并配置防火墙，正在弹出 UAC 授权…" -ForegroundColor Yellow
    # 还原本次调用的参数，原样传给提权后的进程
    $reArgs = @()
    foreach ($kv in $PSBoundParameters.GetEnumerator()) {
        $v = $kv.Value
        if ($v -is [System.Management.Automation.SwitchParameter]) {
            if ($v.IsPresent) { $reArgs += "-$($kv.Key)" }
        } else {
            $reArgs += "-$($kv.Key)"; $reArgs += "$v"
        }
    }
    $full = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"") + $reArgs
    try {
        Start-Process powershell -Verb RunAs -ArgumentList $full
    } catch {
        Die "UAC 授权被取消。请右键 PowerShell『以管理员身份运行』后重试。"
    }
    exit 0
}

# ---------- 定位项目根目录（脚本位于 deploy/ 下） ----------
$ScriptDir = Split-Path -Parent $PSCommandPath
$Root      = Split-Path -Parent $ScriptDir
Set-Location $Root

Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "  ai-video-canvas  Windows 全自动部署（Docker + 局域网）" -ForegroundColor Magenta
Write-Host "  项目目录: $Root  （已获管理员权限）" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta

$ContainerName = "avc-mysql"
$DbName        = "ai_video_canvas"

# ============================================================================
Step 1 "准备运行环境（Node.js / pnpm）"
# ============================================================================
$hasWinget = Have winget

if (-not (Have node)) {
    if ($SkipDeps) { Die "未检测到 Node.js，且指定了 -SkipDeps。请先安装 Node.js 20+。" }
    if (-not $hasWinget) {
        Die "未检测到 Node.js，且系统无 winget（需 Win10 1809+/Win11）。请手动安装 Node.js 20+ 后重试：https://nodejs.org/"
    }
    Write-Host "    未检测到 Node.js，使用 winget 自动安装 LTS 版…"
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Have node)) { Die "Node.js 安装后仍未生效。请关闭本窗口、重开 PowerShell 再运行一次脚本。" }
}
$nodeVer = (node -v)
$nodeMajor = [int]($nodeVer -replace 'v(\d+)\..*','$1')
if ($nodeMajor -lt 18) { Die "Node.js 版本过低（$nodeVer），请升级到 20+。" }
Ok "Node.js $nodeVer"

if (-not (Have pnpm)) {
    Write-Host "    启用 pnpm（corepack）…"
    try { corepack enable | Out-Null; corepack prepare pnpm@10.4.1 --activate | Out-Null }
    catch { npm install -g pnpm | Out-Null }
    Refresh-Path
}
if (-not (Have pnpm)) { Die "pnpm 启用失败，请手动执行：npm install -g pnpm" }
Ok "pnpm $(pnpm -v)"

# ============================================================================
Step 2 "准备 Docker 引擎"
# ============================================================================
if (-not (Have docker)) {
    if ($SkipDeps) { Die "未检测到 Docker，且指定了 -SkipDeps。请先安装并启动 Docker Desktop。" }
    if (-not $hasWinget) { Die "未检测到 Docker，且系统无 winget。请手动安装 Docker Desktop：https://www.docker.com/products/docker-desktop/" }
    Write-Host "    未检测到 Docker，使用 winget 自动安装 Docker Desktop…"
    winget install --id Docker.DockerDesktop -e --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path
    Warn "Docker Desktop 已安装。首次使用 WSL2 通常需要【重启电脑】。"
    Warn "请现在重启电脑，重启后再次运行本脚本（或双击 一键部署.bat）即可自动继续。"
    Write-Host "`n    （脚本是幂等的：已完成的步骤不会重复执行。）`n" -ForegroundColor Yellow
    exit 0
}
Ok "Docker 已安装：$(docker -v)"

# 确保 Docker 引擎在运行；没运行就尝试启动 Docker Desktop 并等待
$engineUp = $false
try { docker info 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $engineUp = $true } } catch {}

if (-not $engineUp) {
    $ddPaths = @(
        "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "${Env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
    ) | Where-Object { Test-Path $_ }
    if ($ddPaths) {
        Write-Host "    Docker 引擎未运行，正在启动 Docker Desktop…"
        Start-Process $ddPaths[0]
    }
    Write-Host "    等待 Docker 引擎就绪（最多约 120 秒）…" -NoNewline
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2; Write-Host "." -NoNewline
        try { docker info 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $engineUp = $true; break } } catch {}
    }
    Write-Host ""
}
if (-not $engineUp) {
    Die "Docker 引擎未能就绪。若刚装完 Docker，请【重启电脑】后再运行本脚本；或手动打开 Docker Desktop 等其变绿后重试。"
}
Ok "Docker 引擎已就绪。"

# ============================================================================
Step 3 "准备 MySQL 数据库容器"
# ============================================================================
$exists = (docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}")

if ($Reset -and $exists) {
    Warn "已指定 -Reset，删除旧容器（数据将被清空）…"
    docker rm -f $ContainerName | Out-Null
    $exists = $null
}

if (-not $exists) {
    if (-not $DbPassword) {
        $DbPassword = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 20 | ForEach-Object {[char]$_})
        Warn "未指定 -DbPassword，已随机生成 MySQL 密码（仅本地容器使用）。"
    }
    Write-Host "    创建并启动 MySQL 容器 ($ContainerName)…"
    docker run -d --name $ContainerName `
        -p 3306:3306 `
        -e "MYSQL_ROOT_PASSWORD=$DbPassword" `
        -e "MYSQL_DATABASE=$DbName" `
        -v "${ContainerName}-data:/var/lib/mysql" `
        --restart unless-stopped `
        mysql:8 | Out-Null
    Ok "MySQL 容器已创建（已设开机自启 --restart unless-stopped）。"
} else {
    $running = (docker ps --filter "name=^/$ContainerName$" --format "{{.Names}}")
    if (-not $running) { Write-Host "    启动已存在的 MySQL 容器…"; docker start $ContainerName | Out-Null }
    Ok "复用已存在的 MySQL 容器（密码沿用 .env 中的 DATABASE_URL）。"
}

# 等待 MySQL 就绪
Write-Host "    等待 MySQL 就绪…" -NoNewline
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    docker exec $ContainerName mysqladmin ping -h 127.0.0.1 --silent 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2; Write-Host "." -NoNewline
}
Write-Host ""
if (-not $ready) { Die "MySQL 启动超时。可执行 'docker logs $ContainerName' 查看原因。" }
Ok "MySQL 已就绪（localhost:3306，库名 $DbName）。"

# ============================================================================
Step 4 "生成 .env 配置文件"
# ============================================================================
$envPath = Join-Path $Root ".env"

if (Test-Path $envPath) {
    Ok ".env 已存在，保留原有配置（如需重置请手动删除后重跑）。"
} else {
    if (-not $DbPassword) { Die "内部错误：复用容器但缺少 .env。请用 -DbPassword 指定密码，或加 -Reset 重建容器。" }
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwt = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    if (-not $OwnerEmail) { $OwnerEmail = "fly699@gmail.com" }

    $content = @"
# === ai-video-canvas 本地部署配置（由 deploy.ps1 生成）===
NODE_ENV=production
PORT=$Port
DATABASE_URL=mysql://root:$DbPassword@localhost:3306/$DbName
JWT_SECRET=$jwt
OWNER_EMAIL=$OwnerEmail

# ---------- 可选项（按需启用）----------
# OAUTH_SERVER_URL=
# VITE_APP_ID=
# OPENAI_API_KEY=
# HIGGSFIELD_API_KEY=
# HIGGSFIELD_API_SECRET=
# POYO_API_KEY=
# COMFYUI_BASE_URL=
"@
    # 用无 BOM 的 UTF-8 写入，避免首行键名被 BOM 污染
    [System.IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding($false)))
    Ok ".env 已生成（含随机 JWT_SECRET）。"
}

# ============================================================================
Step 5 "安装依赖 / 建表 / 构建"
# ============================================================================
# 把 .env 注入当前进程环境，供 drizzle-kit 读取
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

Write-Host "    pnpm install …"
pnpm install
Ok "依赖安装完成。"

Write-Host "    pnpm db:push（建表）…"
pnpm db:push
Ok "数据库表已创建/更新。"

if ($SkipBuild) {
    Warn "已指定 -SkipBuild，跳过构建。"
} else {
    Write-Host "    pnpm build（构建前后端，首次较慢）…"
    pnpm build
    Ok "构建完成（产物在 dist/）。"
}

# ============================================================================
Step 6 "配置 Windows 防火墙（局域网访问）"
# ============================================================================
if ($NoFirewall) {
    Warn "已指定 -NoFirewall，跳过防火墙配置（仅本机可访问）。"
} else {
    $ruleName = "ai-video-canvas (TCP $Port)"
    $existsRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existsRule) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
        Ok "已创建防火墙入站规则：放行 TCP $Port。"
    } else {
        Ok "防火墙规则已存在：TCP $Port。"
    }
}

# 获取本机局域网 IPv4，供他人访问
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress
if (-not $lanIp) { $lanIp = "本机IP" }

# ============================================================================
Step 7 "启动服务"
# ============================================================================
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  部署完成！正在启动服务…" -ForegroundColor Green
Write-Host "  本机访问:   http://localhost:$Port" -ForegroundColor Green
Write-Host "  局域网访问: http://${lanIp}:$Port   （同一网络的手机/电脑可访问）" -ForegroundColor Green
Write-Host "  管理员账号: 用 .env 中 OWNER_EMAIL 的邮箱注册即为管理员" -ForegroundColor Green
Write-Host "  停止服务:   在本窗口按 Ctrl+C" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

pnpm start
