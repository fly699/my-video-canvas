# 部署说明

## 系统依赖：ffmpeg（必需）

本项目的**视频功能依赖系统 ffmpeg**：

- 视频剪辑器的「单遍导出」(`server/_core/videoComposer.ts`)
- 画布上的裁剪 / 合并 / 字幕 / 叠加 / 智能剪辑等节点 (`server/_core/videoEditor.ts`)

这些都通过 `ffmpeg` / `ffprobe` 命令调用，**ffmpeg 不在 npm/pnpm 依赖里，必须在服务器上单独安装**。

> ⚠️ 应用内「系统更新」只做 `git pull → pnpm install → db:push → build`，**不会**安装 ffmpeg 这类系统软件包。所以 ffmpeg 需要在部署环境里预先装好（或用下面的 Docker 镜像，已内置）。

### 确认是否已安装

```bash
ffmpeg -version
```

有版本号即可；提示 `command not found` 则需安装。

### 安装

```bash
# Windows（与 deploy.ps1 一致）
winget install --id Gyan.FFmpeg -e

# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y ffmpeg

# CentOS / RHEL / Rocky
sudo yum install -y epel-release && sudo yum install -y ffmpeg

# macOS (本地开发)
brew install ffmpeg
```

> Windows 用 winget 装完后，**新开一个 PowerShell** 让 PATH 生效再启动应用。

---

## 方式零：Windows 一键部署（`deploy/deploy.bat`）

这是本项目的主部署方式。双击 `deploy/deploy.bat`（会自动提权），`deploy.ps1`
会用 winget 依次准备 **Node.js / pnpm / ffmpeg / Docker**，再 `pnpm install →
db:push → build → start`。

> ✅ **ffmpeg 现已纳入 deploy.ps1 的自动安装**（Step 1，winget `Gyan.FFmpeg`）。
> **已经部署过的老环境**：重新双击一次 `deploy.bat` 即可补装 ffmpeg（脚本幂等，
> 已完成的步骤不会重复）；或手动 `winget install --id Gyan.FFmpeg -e` 后**新开
> PowerShell**。
>
> ⚠️ 应用内「系统更新」(`update.bat` / 管理后台一键更新) 只做
> `git pull → pnpm install → db:push → build`，**不会**装 ffmpeg 这类系统软件，
> 所以 ffmpeg 要在首次部署时装好。

---

## 方式一：Docker（已内置 ffmpeg + git + pnpm）

仓库根目录已提供 `Dockerfile`。

```bash
# 构建镜像
docker build -t ai-video-canvas .

# 运行（按需注入外部服务的环境变量）
docker run -d --name ai-video-canvas \
  -p 3000:3000 \
  -e DATABASE_URL="mysql://用户:密码@主机:3306/库名" \
  -e OAUTH_SERVER_URL="https://你的-oauth" \
  -e S3_ENDPOINT="https://你的-minio" \
  -e S3_BUCKET="你的桶" \
  -e S3_ACCESS_KEY="..." \
  -e S3_SECRET_KEY="..." \
  ai-video-canvas
```

> 数据库迁移：容器启动默认只 `pnpm start`。首次部署或升级后需迁移时，可
> 单独执行 `docker exec ai-video-canvas pnpm db:push`，或把 `Dockerfile`
> 末尾的 `CMD` 改为 `pnpm db:push && pnpm start`。

镜像内已包含 `ffmpeg`（视频导出）、`git`/`pnpm`（应用内「系统更新」），构建时
会打印 ffmpeg 版本以便确认。

---

## 方式二：裸机 / PM2

```bash
# 1. 安装 ffmpeg（见上文）
# 2. 安装依赖并构建
pnpm install --frozen-lockfile
pnpm build
# 3. 迁移数据库
DATABASE_URL="mysql://..." pnpm db:push
# 4. 启动（生产）
DATABASE_URL="mysql://..." OAUTH_SERVER_URL="..." pnpm start
```

应用内「系统更新」要求部署目录是一个可 `git pull` 的 git 工作区，且
`git` / `pnpm` 在 PATH 中——裸机方式天然满足。

---

## 端口与环境变量

- `PORT`：服务监听端口（默认 `3000`）。
- `DATABASE_URL`：MySQL/MariaDB 连接串。**未设置且 `NODE_ENV=development` 时进入 dev bypass（内存存储）**。
- `OAUTH_SERVER_URL`：OAuth 服务地址。
- `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` 等：对象存储（MinIO/S3），视频成片、素材都存这里。

> 视频剪辑器导出的成片只写入 MinIO/S3，并按用户前缀 `u/{userId}/editor/...`
> 归档、登记进素材库；下载受「严格下载授权」开关约束。
