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

## 数据库迁移注意事项（drizzle-kit，务必遵守！）

迁移机制：`db:migrate` 与 `db:push` 都执行 `drizzle-kit migrate`；管理后台「系统更新」一键更新会自动跑 `pnpm db:push`。迁移文件在 `drizzle/*.sql`，由 `meta/_journal.json` 记录顺序，应用记录存在 DB 的 `__drizzle_migrations` 表（按 journal 的 `when` 时间戳判断是否已应用，失败的迁移不会被记录、下次会重试）。

**血泪教训（2026-06，0029 迁移连续翻车两次后用真实 MariaDB 复现定位）：**

1. **drizzle-kit 按字符串 `--> statement-breakpoint` 暴力切分迁移文件——连注释里出现该字面量也会被当成真正的分隔符！** 切碎后 SQL 片段非法，报 `42000 You have an error in your SQL syntax`。
   → **迁移 `.sql` 文件的注释里严禁出现该分隔符字面量**（哪怕用反引号包起来当例子也不行，drizzle-kit 照切不误）。注意：本 `CLAUDE.md` 不被 drizzle-kit 处理，这里写出标记无妨。

2. **一个 .sql 里有多条语句时，每两条之间必须显式插入一行 `--> statement-breakpoint`**（mysql2 默认 `multipleStatements: false`，否则多条被当一条发送报错）。单条语句的迁移不需要。

3. **建表/改表尽量幂等**：用 `CREATE TABLE IF NOT EXISTS`，以兼容「首次失败已自动提交了第一张表」的半成品状态，让重跑能续上。

4. **改完迁移必须用真实 MySQL/MariaDB 跑一遍 `drizzle-kit migrate` 复现验证，禁止靠猜！** 本机无 DB 时：`apt-get install -y mariadb-server`（root 下 `mariadbd --user=root --datadir=... --socket=... --skip-name-resolve` 起独立实例），建库后 `DATABASE_URL="mysql://用户:密码@127.0.0.1:端口/库" npx drizzle-kit migrate`。同时验证「半成品状态」（手动建出第一张表 + 从 `__drizzle_migrations` 删掉该条记录）下能否幂等通过。

5. **绝不靠盲改让用户反复折腾数据库**；先复现拿到确切 `sqlState/sqlMessage`，再动手。

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

---

## 第 14 轮更新说明（2026-06-04）

剪辑器与画布节点的自驱体验优化，4 个提交均通过 `tsc` / 168 项 vitest / build / 无头浏览器实测。

### 节点（画布）

1. **生成进度条收缩后仍可见** — `client/src/components/canvas/BaseNode.tsx`
   - 问题：进度条原本只在节点折叠的配置区内渲染，节点收缩/取消选中后看不到生成进度。
   - 修复：在 BaseNode 标题栏下方常驻渲染进度条，直接读 `payload.status/progress`，对所有节点统一生效。

2. **移除 comfyui 节点冗余内嵌进度条** — `ComfyuiImageNode/ComfyuiVideoNode/ComfyuiWorkflowNode`
   - 上一步常驻进度条已覆盖原内嵌进度条，删除三处重复 UI。

3. **节点失败状态常驻提示** — `BaseNode.tsx`
   - 问题：生成失败（`payload.status==="failed"`）的错误信息原本只在折叠配置区内显示，收缩后不可见。
   - 修复：标题栏下方常驻一条红色失败提示（图标 + 错误摘要，hover 看全文），与进度条同理。实测「未配置 ComfyUI 地址」运行 → 红条出现，取消选中收缩后仍可见。

### 剪辑器

4. **播放 / 定位快捷键** — 空格 播放/暂停、Home/End 跳首尾、←/→ 逐帧步进（Shift ×10）。逐帧实测精确（5 帧 = 0.166s @30fps）。

5. **时间轴增强** — `client/src/components/editor/Timeline.tsx`
   - 「适应窗口」按钮：一键缩放 `pxPerSec` 使整条时间轴完整显示（实测 3s 片段 180px→792px 铺满可视区）。
   - 含关键帧的片段在轨道上按关键帧时间显示菱形标记，关键帧动画在时间轴上可见可定位。
