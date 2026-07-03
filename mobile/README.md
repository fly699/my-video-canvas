# AI Video Canvas · 移动端（Android / Expo）

React Native (Expo) 客户端。**复用后端 tRPC 路由类型**，用 **Bearer 令牌**鉴权（服务端 M0 已支持，
见根仓库 `server/_core/sdk.ts` / `emailAuth.ts`）。

## M1 已完成

- 工程骨架（Expo SDK 52 · TS · 新架构）。
- **登录（Bearer 端到端）**：邮箱密码 → `POST /api/auth/login`（带 `X-Auth-Mode: token`）→ 拿会话令牌 →
  存 `expo-secure-store` → tRPC 客户端注入 `Authorization: Bearer`。
- **作品浏览**（`HomeScreen`）：`trpc.canvas.list` 拉「我的作品/共享给我」，下拉刷新。
- **AI 助手聊天**（`ChatScreen`）：`openAssistant` / `getMessages` / `sendToAssistant` + socket `/chat`
  实时（`chat:join` / `chat:message:new`），收到即从服务器权威重载。
- **上传素材**（`UploadScreen`）：`expo-image-picker` 拍照/相册 → `upload.uploadImage`（base64）→ 预览。
- 底部三 tab（`Main`，不引 react-navigation）。
- 服务器地址可在登录页改（默认 `https://avc.fordhev.store`，也可填局域网 `http://192.168.x.x:3000`）。

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

## 关于「与后端共享类型」（已打通，`npm run typecheck` 全绿）

`src/lib/trpc.ts` 用 `import type { AppRouter } from "../../../server/routers"` 复用后端路由类型。
`tsconfig.json` 关键设置（与根仓库对齐，才能正确解析服务端源码）：
- `baseUrl: ".."` + `paths` 映射 `@shared/*`、`server/*`（服务端用 baseUrl 裸导入 `server/xxx`）；
- `module: ESNext` + `moduleResolution: bundler`（否则服务端动态 import 报错）；
- `skipLibCheck: true`。
- 需 `@types/node`（服务端用 `process`/`Buffer` 等）。

装好依赖后 `npm run typecheck` 应全绿——它会连服务端路由类型一起校验，**移动端调用的每个 tRPC
接口名/入参/返回字段都对着真实后端类型检查**（例如：画布/作品路由挂载键是 `projects`，不是 `canvas`）。
服务端类型依赖（drizzle-orm 等）从根仓库 `node_modules` 向上解析。

## 下一步（M1 续 / M2）

- AI 助手 / 聊天（复用 `chat.*` + `src/lib/socket.ts`）。
- 生成进度（socket 广播）。
- 拍照 / 相册上传素材（`expo-image-picker` + `upload.*`）。
- 「设置」页（切换服务器地址、退出登录、推送开关）。
