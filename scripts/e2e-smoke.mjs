// 画布 / 智能体 E2E 冒烟测试（固化版）。
//
// 用途：对运行中的 dev 服务器做一次端到端冒烟——新建项目进画布、依次添加
// 脚本/图像生成/视频任务/智能体节点，校验「节点默认模型」接线（Opus47 / GPT Image 2 /
// Grok Imagine 图生），并汇总未预期的 JS 错误。返回码 0=通过 / 1=失败。
//
// 前置：
//   1. 启动 dev 服务器（dev bypass 自动以 admin 角色登录可选）：
//        DATABASE_URL="" OAUTH_SERVER_URL="" NODE_ENV=development pnpm dev
//   2. 安装无头浏览器驱动（一次性）：
//        npm i -D puppeteer-core      # 或全局
//   3. 提供 Chromium 可执行文件路径（自动探测常见位置，或用 CHROME_PATH 覆盖）。
//
// 运行：  node scripts/e2e-smoke.mjs   [BASE_URL]
//   环境变量：BASE_URL（默认 http://localhost:3000）、CHROME_PATH。

import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BASE_URL = process.env.BASE_URL || process.argv[2] || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 探测 Chromium 可执行文件 ───────────────────────────────────────────────────
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/chromium/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // Playwright 安装目录通配兜底
  try {
    const { globSync } = require("node:fs");
    if (globSync) {
      const hits = globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome");
      if (hits?.length) return hits[0];
    }
  } catch { /* node 版本无 globSync */ }
  return null;
}

let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  console.error("✗ 需要 puppeteer-core：请先 `npm i -D puppeteer-core`");
  process.exit(2);
}

const chromePath = findChrome();
if (!chromePath) {
  console.error("✗ 找不到 Chromium 可执行文件，请设置 CHROME_PATH 环境变量");
  process.exit(2);
}

// 过滤与本测试无关的噪声错误。
const IGNORE = /favicon|403|VITE|analytics|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|Failed to load resource/;

async function clickByText(page, text, exact = false) {
  // 只匹配 <button>，避免点到包裹文本的父 div（点了不导航）。
  return page.evaluate((t, ex) => {
    const b = [...document.querySelectorAll("button")].find((el) => {
      const s = (el.innerText || "").trim();
      return ex ? s === t : s.includes(t);
    });
    if (b) { b.click(); return true; }
    return false;
  }, text, exact);
}

async function addNode(page, label) {
  await clickByText(page, "添加", true);
  await sleep(700);
  const ok = await page.evaluate((lbl) => {
    const el = [...document.querySelectorAll("button, div")].find((e) => (e.innerText || "").trim() === lbl);
    if (el) { el.click(); return true; }
    return false;
  }, label);
  await sleep(1800);
  return ok;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-setuid-sandbox"],
    headless: true,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

  const checks = [];
  const record = (name, pass, detail = "") => { checks.push({ name, pass, detail }); console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
    record("首页加载", true);

    await clickByText(page, "新建项目");
    await sleep(4000);
    // 关掉新手引导
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        [...document.querySelectorAll("button")].forEach((b) => {
          const t = b.innerText || "";
          if (t.includes("不再显示") || t.includes("开始使用") || t.includes("跳过")) b.click();
        });
      });
      await sleep(500);
    }
    const onCanvas = await page.evaluate(() => !!document.querySelector(".react-flow"));
    record("进入画布", onCanvas);

    // 依次添加节点并校验默认模型接线
    await addNode(page, "脚本");
    await addNode(page, "图像生成");
    await addNode(page, "视频任务");
    await sleep(800);
    const body = await page.evaluate(() => document.body.innerText);
    record("脚本节点默认 LLM = Opus47", body.includes("Opus47"), "（kie Claude Opus 4.7）");
    record("图像生成默认 = GPT Image 2", body.includes("GPT Image 2") && !body.includes("Manus Forge"));
    record("视频任务默认 = Grok Imagine 图生", body.includes("Grok Imagine 图生"));

    // 智能体节点渲染
    const agentAdded = await addNode(page, "智能体");
    record("智能体节点可添加", agentAdded);

    await page.screenshot({ path: "/tmp/e2e-smoke.png" }).catch(() => {});
  } catch (e) {
    record("执行异常", false, e instanceof Error ? e.message : String(e));
  }

  const relErr = errs.filter((e) => !IGNORE.test(e));
  record("无未预期 JS 错误", relErr.length === 0, relErr.slice(0, 3).join(" | "));

  await browser.close();

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
