<#
================================================================================
  保留完整提交历史，把分支推送到新的 GitHub 仓库
================================================================================
  原理：克隆原仓库（含历史）→ 把指定分支作为新仓库的 main 推上去。

  默认：
    源仓库   : https://github.com/fly699/ai-video-canvas  (分支 claude/ecstatic-cori-IAuiT)
    新仓库   : https://github.com/fly699/my-video-canvas   (分支 main)

  用法：双击 deploy\push-history.bat，或运行
    powershell -ExecutionPolicy Bypass -File .\deploy\push-history.ps1

  参数（可选）：
    -SourceUrl    "https://github.com/用户/源仓库.git"
    -SourceBranch "claude/ecstatic-cori-IAuiT"
    -TargetUrl    "https://github.com/用户/新仓库.git"
    -TargetBranch "main"
    -Dir          "克隆到的本地文件夹路径"

  说明：
    - 会新建一个干净的克隆文件夹（不影响你现在运行中的部署目录）。
    - 推送完成后，该文件夹的 origin 指向新仓库，可作为今后维护的工作副本。
    - 源仓库为私有时，克隆/推送会弹出 GitHub 登录授权。
================================================================================
#>

param(
    [string]$SourceUrl    = "https://github.com/fly699/ai-video-canvas.git",
    [string]$SourceBranch = "claude/ecstatic-cori-IAuiT",
    [string]$TargetUrl    = "https://github.com/fly699/my-video-canvas.git",
    [string]$TargetBranch = "main",
    [string]$Dir          = ""
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

# 克隆目标文件夹：默认放在“项目所在目录的上一层”，与原项目并列
$ScriptDir = Split-Path -Parent $PSCommandPath
$Root      = Split-Path -Parent $ScriptDir
$repoName  = [System.IO.Path]::GetFileNameWithoutExtension(($TargetUrl -split '/' )[-1])
if (-not $Dir) { $Dir = Join-Path (Split-Path -Parent $Root) $repoName }

Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "  保留历史推送到新仓库" -ForegroundColor Magenta
Write-Host "  源:   $SourceUrl  ($SourceBranch)" -ForegroundColor Magenta
Write-Host "  目标: $TargetUrl  ($TargetBranch)" -ForegroundColor Magenta
Write-Host "  克隆到: $Dir" -ForegroundColor Magenta
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
    if (-not (Have git)) { Die "未检测到 Git。请安装 Git for Windows 后重开窗口再运行。" }
}
Ok "$(git --version)"

# ============================================================================
Step 2 "克隆源仓库（含完整历史）"
# ============================================================================
if (Test-Path $Dir) {
    Die "目标文件夹已存在：$Dir`n请删除它或用 -Dir 指定一个不存在的新路径后重试。"
}
Write-Host "    git clone $SourceUrl …（私有仓库会弹出登录授权）"
git clone $SourceUrl "$Dir"
Set-Location $Dir
Ok "克隆完成。"

# 切到要保留历史的分支
git checkout $SourceBranch
Ok "已切到分支 $SourceBranch（携带完整历史）。"
$commits = (git rev-list --count HEAD)
Ok "该分支共有 $commits 个提交。"

# ============================================================================
Step 3 "把分支重命名为新仓库的主分支"
# ============================================================================
git branch -M $TargetBranch
Ok "本地分支已命名为 $TargetBranch。"

# ============================================================================
Step 4 "调整远端：origin → 新仓库，原仓库留作 upstream"
# ============================================================================
git remote rename origin upstream
git remote add origin $TargetUrl
Ok "origin = 新仓库；upstream = 原仓库（今后可 git fetch upstream 同步原仓库更新）。"

# ============================================================================
Step 5 "推送到新仓库（含全部历史）"
# ============================================================================
Write-Host "    git push -u origin $TargetBranch …（首次会弹出 GitHub 登录授权）"
git push -u origin $TargetBranch

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  完成！新仓库已包含完整提交历史（$commits 个提交）。" -ForegroundColor Green
Write-Host "  仓库地址: $($TargetUrl -replace '\.git$','')" -ForegroundColor Green
Write-Host "  工作副本: $Dir" -ForegroundColor Green
Write-Host "  今后在此文件夹: git add -A; git commit -m '说明'; git push" -ForegroundColor Green
Write-Host "  同步原仓库更新: git fetch upstream; git merge upstream/main" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
pause
