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

---

## 近期新增的服务端功能与配置（2026-06/07，均为可选、默认关闭）

> **通用原则**
> - 环境变量统一写进项目根目录 **`.env`**（`update.bat`/「系统更新」/Windows 服务都会读它）。
> - **改了 `.env` 或服务端代码必须重启 Node 才生效**：跑「系统更新」/`update.bat` 会自动重启；只改 `.env` 没更新代码时，手动重启服务（`net stop AVC-App && net start AVC-App` 或 `pm2 restart`）。
> - 前端改动部署后，浏览器需**强刷（Ctrl+Shift+R）**。
> - 下面提到的 CLI（Claude Code / Codex）都是系统级软件：**「系统更新」和 `deploy.ps1` 都不会安装它们**，需手动 `npm i -g` 一次。

### A. 工程智能体 ·「代码任务」（无头 Claude Code，默认完全关闭）

| 变量 | 作用 |
|---|---|
| `SUPER_AGENT_CODE_ENABLED=1` | 第一把钥匙：允许起 claude 进程 |
| `SUPER_AGENT_CODE_ALLOW_BASH=1` | 第二把钥匙：放行 shell（不设=只能读写隔离工作区，最安全） |
| `SUPER_AGENT_PERMISSION_CMD=node`<br>`SUPER_AGENT_PERMISSION_ARGS=["<项目绝对路径>/dist/permissionMcpServer.cjs"]` | 执行前命令审批（危险命令根本不跑）。Windows 路径用 `\\` 转义 |
| `CLAUDE_CODE_OAUTH_TOKEN` | 订阅授权（`claude setup-token` 所得；**勿同时设 `ANTHROPIC_API_KEY`**，否则变按量计费） |
| `CLAUDE_BIN` | CLI 不在 PATH 时的绝对路径（Windows 一般 `C:\Users\你\AppData\Roaming\npm\claude.cmd`） |

前置：`npm i -g @anthropic-ai/claude-code`；`dist/permissionMcpServer.cjs` 由 `pnpm build` 自动产出。
逐步勾选清单见 **`docs/phase2-启用清单.md`**，原理与安全边界见 **`docs/super-agent.md`**（含「只读沙箱 vs 放行 Shell」能不能碰真实文件的说明）。

### B. ComfyUI 缺模型/节点自动下载（工程智能体自愈，默认关闭）

| 变量 | 作用 |
|---|---|
| `SUPER_AGENT_AUTO_INSTALL=1` | 开放 install_model / install_node 工具 |

另需：目标 ComfyUI 地址已在**运维台注册（带 SSH）且启用**，且操作者为 L3+。不满足任一条件则工具不开放（框架 inert）。

### C. 本机 Claude（订阅）桥接——用 Claude 订阅额度跑画布 AI（默认关闭）

| 变量 | 作用 |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | 订阅授权（与 A 共用，配一次两处生效） |
| `CLAUDE_LOCAL_BRIDGE_KEY` | 桥接口令：**设了才启用**，且后台「自建 LLM」的 API Key 必须与之一致（防公网白嫖） |
| `CLAUDE_BIN` | 同 A，可共用 |

后台配置：管理后台 → 模型管理 › 自建 LLM → 「一键填入本机 Claude」→ API Key 粘同口令 → 保存。
模型切换：选择器里的 `claude-local:sonnet` / `:opus`（需 Max 档）等条目即切换。
**公网隧道部署**：后台「服务器地址」要改成内网回环 `http://127.0.0.1:<内部端口>/api/claude-bridge`。
完整说明与排错表：**`docs/本机claude桥接.md`**。

### D. 本机 GPT（ChatGPT 订阅）——与 C 同端点同 Key，零新增变量

前置三步：
1. 服务器 `npm i -g @openai/codex`（路径特殊时设 `CODEX_BIN`）；
2. 在能开浏览器的机器跑 `codex` → 「Sign in with ChatGPT」登录订阅；
3. 把该机 `~/.codex/auth.json` 拷到服务器同路径（Windows：`C:\Users\你\.codex\auth.json`；等同密码，注意保管）。

后台点「一键填入本机 GPT（ChatGPT 订阅）」加模型条目即可（`gpt-local` / `gpt-local:模型名`）。
凭证优先级 `CODEX_API_KEY > auth.json(订阅) > OPENAI_API_KEY`：**千万别设 `CODEX_API_KEY`**（会绕过订阅）；
`OPENAI_API_KEY`（配音 TTS 在用）**可以共存**——只要 auth.json 在，codex 优先走订阅；但若 auth.json 没放好，
codex 会静默落到 `OPENAI_API_KEY` 按量计费，务必放好凭证再用 `gpt-local` 条目。

### E. Docker 部署使用 A/C/D 的额外说明

镜像默认**不含** Claude Code / Codex CLI 与订阅凭证。需在镜像里补装 CLI（`npm i -g @anthropic-ai/claude-code @openai/codex`），
并把宿主机的 `~/.claude`（如使用）与 `~/.codex/auth.json` 挂载/复制进容器对应的 HOME 路径，env 经 `-e` 注入。裸机/Windows 服务方式无此额外步骤。
