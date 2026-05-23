# Claude 项目说明

## 语言要求

**所有回复必须使用中文。** 无论用户用何种语言提问，均以中文作答。

---

## 项目概况

**ai-video-canvas** — 基于 React + tRPC v11 + Express + MySQL (drizzle-orm) 的 AI 视频画布应用。

### 技术栈

- 前端：React + Vite
- 后端：Express + tRPC v11
- 数据库：MySQL（drizzle-orm/mysql2）
- 认证：OAuth（Manus）+ 邮箱密码（scrypt）

### 开发模式

当 `NODE_ENV=development` 且未设置 `DATABASE_URL` 和 `OAUTH_SERVER_URL` 时，进入 dev bypass 模式：自动以 `DEV_USER`（id=1，role="user"）登录，使用内存 devStore 存储画布数据。

---

## 开发规范

### 分支

所有开发和推送均在 `claude/analyze-repository-zZarA` 分支进行，**禁止推送至 main/master**。

### 启动开发服务器

```bash
DATABASE_URL="" OAUTH_SERVER_URL="" NODE_ENV=development pnpm dev
```

---

## 安全审查历史摘要

本项目已经历多轮安全审查（共 13 轮），主要修复集中在以下模块：

### `server/_core/whitelist.ts` — 白名单缓存

多轮修复，核心问题如下（均已修复）：

- **缓存竞态**：并发请求同时穿透缓存，导致 DB 请求风暴。通过 `_cacheGeneration` 机制控制写入时机。
- **过期时间戳过时**：错误路径使用函数入口的 `now` 而非 `Date.now()`，导致 TTL 计算偏短。已修正为写入时取 `Date.now()`。
- **并发兄弟覆盖**：慢失败请求用 5 秒错误 TTL 覆盖并发成功请求写入的 30 秒有效缓存。通过 `priorCached`、`priorExpiry`、`latestGen` 三重守卫解决。
- **二次读取缓存缺失**：生成号变更路径的二次读结果未缓存，导致后续请求持续穿透。已通过 `postInvalidationGen` 守卫写入缓存。

### `server/routers/admin.ts` — 管理接口

- **IP 白名单无格式校验**（第 13 轮，已修复）：`addEntry` 接口的 IP 类型条目无格式限制，管理员可将 `"unknown"` 字符串加入白名单。由于 `context.ts` 在无法确定客户端 IP 时回退为字符串 `"unknown"`，此类请求将绕过白名单拦截。修复方案：新增 `refine()` 校验，IP 类型值须符合 `/^[\d.:a-fA-F/]+$/`。

### `server/_core/sdk.ts` — OAuth

- **`decodeState()` 无异常捕获**：非 base64 的 state 参数导致 `atob()` 抛出未捕获异常（500）。已加外层 try/catch，回退返回原始字符串。
- **空 `redirectUri` 误判**：`""` 被 falsy 判断跳过，返回 JSON blob 而非正确的重定向 URI。已改为显式长度检查。

---

## 第 13 轮更新说明（2026-05-23）

**提交**：`cccdc2b` — `fix: add IP format validation and use fresh timestamp for whitelist cache TTL`

### 修复内容

1. **IP 白名单绕过漏洞（已确认）**
   - 文件：`server/routers/admin.ts`
   - 问题：管理员可将 `"unknown"` 添加为 IP 白名单条目，导致客户端 IP 未知的请求自动通过白名单拦截。
   - 修复：在 `addEntry` 的 Zod schema 中增加 IP 格式校验（仅允许数字、点、冒号、十六进制字符、斜杠），拒绝非法值。

2. **缓存 TTL 时间戳不一致（可疑）**
   - 文件：`server/_core/whitelist.ts`
   - 问题：正常路径写入 `_cacheExpiry = now + 30_000`，`now` 为函数入口时间戳；若 DB 响应较慢，TTL 实际短于 30 秒，与二次读取路径使用 `Date.now()` 不一致。
   - 修复：改为 `Date.now() + 30_000`，确保 TTL 从写入时刻起算。
