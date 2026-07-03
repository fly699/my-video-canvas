# AI Video Canvas · 移动端（Android / Expo）

React Native (Expo) 客户端。**复用后端 tRPC 路由类型**，用 **Bearer 令牌**鉴权（服务端 M0 已支持，
见根仓库 `server/_core/sdk.ts` / `emailAuth.ts`）。

## M1 已完成（本骨架）

- 工程骨架（Expo SDK 52 · TS · 新架构）。
- **登录（Bearer 端到端）**：邮箱密码 → `POST /api/auth/login`（带 `X-Auth-Mode: token`）→ 拿会话令牌 →
  存 `expo-secure-store` → tRPC 客户端注入 `Authorization: Bearer`。
- **作品浏览起点**：登录后 `HomeScreen` 调 `trpc.canvas.list`（受保护查询）拉「我的作品」——它能成功
  返回，就证明鉴权端到端打通。
- 服务器地址可在登录页修改（默认 `https://avc.fordhev.store`，也可填局域网 `http://192.168.x.x:3000`）。
- 预置 `socket.io-client`（`src/lib/socket.ts`，`/chat` 命名空间 + `auth.token`）供后续聊天用。

## 运行（在你本机，需要 Node + Android Studio/SDK）

```bash
cd mobile
npm install
# 对齐 Expo 依赖版本（强烈建议）：
npx expo install --fix
# 连上安卓设备/模拟器后：
npx expo run:android
# 或先起 dev server，再用 Expo Go / 开发版扫码：
npm start
```

> 本仓库的自动化环境跑不了安卓模拟器，所以本骨架的**运行验收需在你本机完成**（`npx expo run:android`）。
> 代码按 tRPC v11 + react-query v5 + Expo SDK 52 写好，类型复用自 `../server/routers`。

## 关于「与后端共享类型」

`src/lib/trpc.ts` 用 `import type { AppRouter } from "../../../server/routers"` 复用后端路由类型（type-only，
不打包服务端代码）。`tsconfig.json` 里：
- `paths` 映射了 `@shared/*`（服务端类型链会用到）；
- `skipLibCheck: true` 避免服务端深层依赖类型报错。

若 `npm run typecheck` 因 monorepo 依赖解析报错，最简单的办法是让 mobile 复用**根仓库的 `node_modules`**
里那些服务端类型依赖（drizzle-orm 等）——它们已装在根目录；Node 解析会向上找到。必要时把根依赖装好即可。

## 下一步（M1 续 / M2）

- AI 助手 / 聊天（复用 `chat.*` + `src/lib/socket.ts`）。
- 生成进度（socket 广播）。
- 拍照 / 相册上传素材（`expo-image-picker` + `upload.*`）。
- 「设置」页（切换服务器地址、退出登录、推送开关）。
