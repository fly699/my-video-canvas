# syntax=docker/dockerfile:1
#
# ai-video-canvas 生产镜像。
#
# 关键点：镜像内安装了 **ffmpeg**——视频剪辑器的「单遍导出」以及画布上的
# 裁剪/合并/字幕/叠加等节点都依赖系统 ffmpeg/ffprobe。同时装了 git + pnpm，
# 以便应用内「系统更新」(git pull → pnpm install → db:push → build) 能正常运行。
#
# 运行所需的外部服务（MySQL/MariaDB、MinIO/S3、OAuth 等）通过环境变量在
# `docker run` / compose 时注入，镜像本身不内置。

FROM node:22-bookworm-slim

# ── 系统依赖 ──────────────────────────────────────────────────────────────────
#  ffmpeg  : 视频编辑 / 剪辑器导出（必需）
#  git     : 应用内「系统更新」会执行 git pull
#  其余     : 证书 / 构建原生依赖时可能需要
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version | head -n 1

# pnpm 由 package.json 的 "packageManager" 字段锁定版本，corepack 自动启用
RUN corepack enable

WORKDIR /app

# 先装依赖（利用 Docker 层缓存：依赖未变时不重复安装）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 再拷源码并构建（vite 前端 + esbuild 打包后端到 dist/）
COPY . .
RUN pnpm build

ENV NODE_ENV=production
# 服务端口（server/_core/index.ts 读取 PORT，默认 3000）
ENV PORT=3000
EXPOSE 3000

# 启动前如需自动迁移数据库，可改成： CMD pnpm db:push && pnpm start
CMD ["pnpm", "start"]
