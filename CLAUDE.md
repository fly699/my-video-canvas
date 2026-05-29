# Claude 项目说明

## 语言要求

**所有回答必须使用中文。** 无论用户用何种语言提问，所有回复、解释、总结、计划、
问题澄清等对话内容一律以中文作答（代码、标识符、文件名等技术内容保持原样）。
这是强制要求，任何情况下都不得用其他语言回复。

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

## 浏览器点击测试方法

### 环境依赖

```bash
# puppeteer-core（已安装在 /tmp/node_modules）
cd /tmp && npm install puppeteer-core

# Chromium 二进制：/opt/chromium/chromium（v131，系统预装）
# 注意：/usr/bin/chromium-browser 是 snap 存根，不可用
```

### 标准测试脚本模板

```js
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/chromium/chromium',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-setuid-sandbox'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('console', msg => { if (msg.type()==='error') errs.push(msg.text()); });

  // 1. 首页 → 新建项目（进入画布）
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.innerText.includes('新建项目'));
    if (b) b.click();
  });
  await sleep(3000); // 等待画布加载

  // 2. 关闭欢迎提示
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(b =>
      b.innerText.includes('不再显示') || b.innerText.includes('开始使用'));
    if (b) b.click();
  });
  await sleep(500);

  // 3. 通过文字查找并点击按钮
  const clicked = await page.evaluate((txt) => {
    const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === txt);
    if (b) { b.click(); return true; }
    return false;
  }, '添加');

  // 4. 截图
  await page.screenshot({ path: '/tmp/screenshot.png' });

  // 5. 错误汇总（过滤无关噪声）
  const relErr = errs.filter(e => !/favicon|403|VITE|analytics|ERR_NAME_NOT_RESOLVED/.test(e));
  console.log('JS错误:', relErr.length);

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
```

### 关键注意事项

- **Puppeteer v25 API 变更**：`page.$x()`（XPath）、`page.waitForTimeout()`、`page.mouse.dblclick()` 已移除
  - XPath → 改用 `page.evaluate()` 手动查找
  - 等待 → 用 `const sleep = ms => new Promise(r => setTimeout(r, ms))`
  - 双击 → 用 `page.mouse.click(x, y, { clickCount: 2 })`
- **NodePicker vs NodeSearch**：
  - `添加` 按钮 → `setShowNodePicker` → 添加新节点到画布（正确入口）
  - `Ctrl+K` → `setShowNodeSearch` → 搜索**现有**画布节点（不能新增）
- **导航流程**：首页没有 `a[href*="/canvas/"]` 链接，必须点击"新建项目"按钮跳转到画布
- **截图路径**：写到 `/tmp/*.png`，用 Read 工具查看图像内容

### 运行方式

```bash
# 先确保开发服务器已启动
DATABASE_URL="" OAUTH_SERVER_URL="" NODE_ENV=development pnpm dev &

# 在 /tmp 目录运行测试（因为 node_modules 在 /tmp）
cd /tmp && node my_test.js 2>&1
```

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
