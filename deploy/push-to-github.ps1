<#
================================================================================
  把当前项目一键推送到新的 GitHub 仓库
================================================================================
  默认推送到: https://github.com/fly699/my-video-canvas
  用法：双击 deploy\push-to-github.bat，或运行
    powershell -ExecutionPolicy Bypass -File .\deploy\push-to-github.ps1

  参数（可选）：
    -RepoUrl "https://github.com/用户/仓库.git"   目标仓库地址
    -Branch  "main"                                推送的分支名
    -Message "init"                                提交说明

  说明：
    - 首次推送会弹出 GitHub 登录授权（浏览器），按提示登录即可。
    - .env（密钥/数据库密码）已被 .gitignore 排除，不会上传。
    - node_modules / dist 也被忽略，不会上传。
    - 脚本可重复运行：有改动就提交并推送，没改动就只推送已有提交。
================================================================================
#>

param(
    [string]$RepoUrl = "https://github.com/fly699/my-video-canvas.git",
    [string]$Branch  = "main",
    [string]$Message = "init: ai-video-canvas local deploy"
)

$ErrorActionPreference = "Stop"

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

# ---------- 定位项目根目录（脚本位于 deploy/ 下） ----------
$ScriptDir = Split-Path -Parent $PSCommandPath
$Root      = Split-Path -Parent $ScriptDir
Set-Location $Root

Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "  推送到 GitHub 新仓库" -ForegroundColor Magenta
Write-Host "  项目目录: $Root" -ForegroundColor Magenta
Write-Host "  目标仓库: $RepoUrl" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta

# ============================================================================
Step 1 "检查 Git"
# ============================================================================
if (-not (Have git)) {
    if (Have winget) {
        Write-Host "    未检测到 Git，使用 winget 自动安装…"
        winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
        Refresh-Path
    }
    if (-not (Have git)) {
        Die "未检测到 Git。请安装 Git for Windows（https://git-scm.com/download/win），重开窗口后再运行。"
    }
}
Ok "$(git --version)"

# 设置提交身份（若本机/仓库未配置过）
$gEmail = (git config user.email) 2>$null
$gName  = (git config user.name)  2>$null
if (-not $gEmail) { git config user.email "fly699@gmail.com"; Warn "未配置 user.email，已临时设为 fly699@gmail.com（可后续修改）。" }
if (-not $gName)  { git config user.name  "fly699";           Warn "未配置 user.name，已临时设为 fly699。" }

# ============================================================================
Step 2 "初始化本地仓库"
# ============================================================================
if (-not (Test-Path (Join-Path $Root ".git"))) {
    git init | Out-Null
    Ok "已执行 git init。"
} else {
    Ok "已是 Git 仓库，复用。"
}

# 安全检查：确认 .env 不会被提交
$envIgnored = $false
if (Test-Path (Join-Path $Root ".env")) {
    git check-ignore ".env" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $envIgnored = $true }
    if (-not $envIgnored) {
        Die ".env 未被 .gitignore 忽略，为防止泄露密钥已中止。请确认 .gitignore 含有 .env 后重试。"
    }
    Ok ".env 已被忽略，不会上传（安全）。"
}

# ============================================================================
Step 3 "提交改动"
# ============================================================================
git add -A
$pending = git status --porcelain
if ($pending) {
    git commit -m $Message | Out-Null
    Ok "已创建提交：$Message"
} else {
    Ok "没有新改动，跳过提交。"
}

# 重命名当前分支为目标分支名
git branch -M $Branch
Ok "当前分支：$Branch"

# ============================================================================
Step 4 "关联远端仓库"
# ============================================================================
$hasOrigin = ((git remote) -split "`n") -contains "origin"
if ($hasOrigin) {
    git remote set-url origin $RepoUrl
    Ok "已更新 origin 指向目标仓库。"
} else {
    git remote add origin $RepoUrl
    Ok "已添加 origin。"
}

# ============================================================================
Step 5 "推送（首次会弹出 GitHub 登录授权）"
# ============================================================================
Write-Host "    正在推送到 $Branch …（如弹出浏览器请登录 GitHub 授权）"
git push -u origin $Branch

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  推送完成！" -ForegroundColor Green
Write-Host "  仓库地址: $($RepoUrl -replace '\.git$','')" -ForegroundColor Green
Write-Host "  今后更新代码：git add -A; git commit -m '说明'; git push" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
pause
