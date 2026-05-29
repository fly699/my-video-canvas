<#
================================================================================
  ai-video-canvas  Windows 一键部署脚本（方案 B：本地正式部署 + MySQL 持久化）
================================================================================
  用法（在项目根目录打开 PowerShell）：

      powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1

  常用参数：
      -DbPassword  "yourpass"        指定 MySQL root 密码（默认随机生成）
      -OwnerEmail  "you@mail.com"    管理员邮箱（默认沿用 .env / fly699@gmail.com）
      -Port        3000              监听端口（默认 3000）
      -SkipBuild                     跳过前端/后端构建（已构建过时加速）
      -Reset                         删除并重建 MySQL 容器（会清空数据库！）

  脚本会自动完成：
      环境检测 → 启动 MySQL(Docker) → 生成 .env → 安装依赖 → 建表 → 构建 → 启动
================================================================================
#>

param(
    [string]$DbPassword = "",
    [string]$OwnerEmail  = "",
    [int]$Port           = 3000,
    [switch]$SkipBuild,
    [switch]$Reset
)

$ErrorActionPreference = "Stop"

# ---------- 彩色输出辅助 ----------
function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Die($msg)      { Write-Host "`n    XX  $msg`n" -ForegroundColor Red; exit 1 }
function Have($cmd)     { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# ---------- 定位项目根目录（脚本位于 deploy/ 下） ----------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
Set-Location $Root

Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "  ai-video-canvas  Windows 本地部署（方案 B）" -ForegroundColor Magenta
Write-Host "  项目目录: $Root" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta

$ContainerName = "avc-mysql"
$DbName        = "ai_video_canvas"

# ============================================================================
Step 1 "检测运行环境"
# ============================================================================

if (-not (Have node)) {
    Die "未检测到 Node.js。请先安装 Node.js 20+（https://nodejs.org/），重开 PowerShell 后再运行本脚本。"
}
$nodeVer = (node -v)
$nodeMajor = [int]($nodeVer -replace 'v(\d+)\..*','$1')
if ($nodeMajor -lt 18) { Die "Node.js 版本过低（$nodeVer），请升级到 20+。" }
Ok "Node.js $nodeVer"

# 启用 pnpm（项目用 pnpm）。优先用 corepack，失败则全局安装。
if (-not (Have pnpm)) {
    Warn "未检测到 pnpm，尝试通过 corepack 启用…"
    try {
        corepack enable | Out-Null
        corepack prepare pnpm@10.4.1 --activate | Out-Null
    } catch {
        Warn "corepack 失败，改用 npm 全局安装 pnpm…"
        npm install -g pnpm | Out-Null
    }
}
if (-not (Have pnpm)) { Die "pnpm 安装失败，请手动执行：npm install -g pnpm" }
Ok "pnpm $(pnpm -v)"

# Docker 用于跑 MySQL。若没有 Docker，提示用户可改用本机已装的 MySQL。
$useDocker = $true
if (-not (Have docker)) {
    $useDocker = $false
    Warn "未检测到 Docker Desktop。"
    Warn "脚本无法自动启动 MySQL。请二选一："
    Warn "  A) 安装 Docker Desktop（https://www.docker.com/products/docker-desktop/）后重跑本脚本；"
    Warn "  B) 自行准备好 MySQL，并在 .env 中填写正确的 DATABASE_URL，然后用 -SkipBuild 之外的方式手动建表。"
} else {
    # 确认 docker 引擎在运行
    try { docker info 2>$null | Out-Null } catch { Die "Docker 已安装但未运行，请先启动 Docker Desktop。" }
    Ok "Docker $(docker -v)"
}

# ============================================================================
Step 2 "准备 MySQL 数据库"
# ============================================================================

if ($useDocker) {
    $exists = (docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}")

    if ($Reset -and $exists) {
        Warn "已指定 -Reset，删除旧容器（数据将被清空）…"
        docker rm -f $ContainerName | Out-Null
        $exists = $null
    }

    if (-not $exists) {
        # 新建容器时确定密码：参数 > 随机生成
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
            mysql:8 | Out-Null
        Ok "MySQL 容器已创建。"
    } else {
        $running = (docker ps --filter "name=^/$ContainerName$" --format "{{.Names}}")
        if (-not $running) { Write-Host "    启动已存在的 MySQL 容器…"; docker start $ContainerName | Out-Null }
        Ok "复用已存在的 MySQL 容器。"
        # 复用容器时密码从已有 .env 读取（见下一步）；此处不覆盖。
    }

    # 等待 MySQL 就绪（最多 ~60 秒）
    Write-Host "    等待 MySQL 就绪…" -NoNewline
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        $ping = (docker exec $ContainerName mysqladmin ping -h 127.0.0.1 --silent 2>$null)
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
        Write-Host "." -NoNewline
    }
    Write-Host ""
    if (-not $ready) { Die "MySQL 启动超时。可执行 'docker logs $ContainerName' 查看原因。" }
    Ok "MySQL 已就绪（localhost:3306，库名 $DbName）。"
}

# ============================================================================
Step 3 "生成 .env 配置文件"
# ============================================================================

$envPath = Join-Path $Root ".env"

if (Test-Path $envPath) {
    Ok ".env 已存在，保留原有配置（如需重置请手动删除后重跑）。"
    # 若复用容器但脚本没拿到密码，从 .env 里解析 DATABASE_URL 即可，无需改动。
} else {
    if ($useDocker -and -not $DbPassword) {
        Die "内部错误：缺少数据库密码。请用 -DbPassword 指定后重试。"
    }
    # JWT_SECRET：32 字节随机 → hex
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwt = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

    if (-not $OwnerEmail) { $OwnerEmail = "fly699@gmail.com" }

    $dbUrl = if ($useDocker) {
        "mysql://root:$DbPassword@localhost:3306/$DbName"
    } else {
        "mysql://root:CHANGE_ME@localhost:3306/$DbName"
    }

    $content = @"
# === ai-video-canvas 本地部署配置（由 deploy.ps1 生成）===
NODE_ENV=production
PORT=$Port

# 数据库连接（MySQL）
DATABASE_URL=$dbUrl

# 会话 Cookie 签名密钥（请勿泄露；更换会使所有人重新登录）
JWT_SECRET=$jwt

# 管理员邮箱：用该邮箱注册/登录的账号将获得管理员角色
OWNER_EMAIL=$OwnerEmail

# ---------- 以下为可选项，按需启用 ----------
# Manus OAuth（不填则使用邮箱+密码登录）
# OAUTH_SERVER_URL=
# VITE_APP_ID=
# VITE_OAUTH_PORTAL_URL=

# AI 能力所需的外部 API（不填仅对应功能不可用，不影响启动）
# OPENAI_API_KEY=
# HIGGSFIELD_API_KEY=
# HIGGSFIELD_API_SECRET=
# POYO_API_KEY=
# COMFYUI_BASE_URL=
"@
    $content | Out-File -FilePath $envPath -Encoding utf8 -NoNewline
    Ok ".env 已生成（含随机 JWT_SECRET）。"
    if (-not $useDocker) {
        Warn "未使用 Docker：请打开 .env 把 DATABASE_URL 改成你本机 MySQL 的真实连接串！"
    }
}

# ============================================================================
Step 4 "安装项目依赖（pnpm install）"
# ============================================================================
pnpm install
Ok "依赖安装完成。"

# ============================================================================
Step 5 "初始化数据库表结构（pnpm db:push）"
# ============================================================================
# drizzle-kit 从 .env 读取 DATABASE_URL；这里把 .env 注入当前进程环境。
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}
pnpm db:push
Ok "数据库表已创建/更新。"

# ============================================================================
Step 6 "构建前端与后端（pnpm build）"
# ============================================================================
if ($SkipBuild) {
    Warn "已指定 -SkipBuild，跳过构建。"
} else {
    pnpm build
    Ok "构建完成（产物在 dist/）。"
}

# ============================================================================
Step 7 "启动服务"
# ============================================================================
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  部署完成！正在启动服务…" -ForegroundColor Green
Write-Host "  访问地址:  http://localhost:$Port" -ForegroundColor Green
Write-Host "  停止服务:  在本窗口按 Ctrl+C" -ForegroundColor Green
Write-Host "  管理员邮箱: 用 .env 中 OWNER_EMAIL 的邮箱注册即可成为管理员" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

pnpm start
