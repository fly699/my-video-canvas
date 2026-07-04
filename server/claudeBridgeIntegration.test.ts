import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerClaudeBridge } from "./_core/claudeBridge";

// 集成测试：起一个真 express + 桥接路由，用「假 claude」（CLAUDE_BIN 指向一个 shell 脚本）验证
// 鉴权门控 + spawn + 解析 + OpenAI chat.completion 响应形状这条真实链路。

const ORIG = { key: process.env.CLAUDE_LOCAL_BRIDGE_KEY, bin: process.env.CLAUDE_BIN };
let dir: string;
let fakeClaude: string;
let echoClaude: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "claude-bridge-test-"));
  fakeClaude = join(dir, "claude");
  // 假 claude：吞掉 stdin，打印 --output-format json 形状的结果。
  writeFileSync(fakeClaude, "#!/bin/sh\ncat > /dev/null\necho '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"你好，我是本机 Claude\",\"is_error\":false}'\n");
  chmodSync(fakeClaude, 0o755);
  // 回显参数的假 claude：用于断言 --model 是否被透传。
  echoClaude = join(dir, "claude-echo");
  writeFileSync(echoClaude, "#!/bin/sh\ncat > /dev/null\necho \"{\\\"type\\\":\\\"result\\\",\\\"subtype\\\":\\\"success\\\",\\\"result\\\":\\\"ARGS:$*\\\",\\\"is_error\\\":false}\"\n");
  chmodSync(echoClaude, 0o755);

  const app = express();
  app.use(express.json());
  registerClaudeBridge(app);
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => { server?.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
afterEach(() => { process.env.CLAUDE_LOCAL_BRIDGE_KEY = ORIG.key; process.env.CLAUDE_BIN = ORIG.bin; });

const post = (headers: Record<string, string>, body: unknown) =>
  fetch(`${base}/api/claude-bridge/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("本机 Claude 桥接（集成）", () => {
  it("未设 CLAUDE_LOCAL_BRIDGE_KEY → 404 未启用", async () => {
    delete process.env.CLAUDE_LOCAL_BRIDGE_KEY;
    const r = await post({ authorization: "Bearer x" }, { messages: [{ role: "user", content: "hi" }] });
    expect(r.status).toBe(404);
  });

  it("key 不匹配 → 401", async () => {
    process.env.CLAUDE_LOCAL_BRIDGE_KEY = "secret";
    const r = await post({ authorization: "Bearer wrong" }, { messages: [{ role: "user", content: "hi" }] });
    expect(r.status).toBe(401);
  });

  it("key 匹配 + 假 claude → 200，返回 OpenAI chat.completion 形状", async () => {
    process.env.CLAUDE_LOCAL_BRIDGE_KEY = "secret";
    process.env.CLAUDE_BIN = fakeClaude;
    const r = await post({ authorization: "Bearer secret" }, { model: "claude-local", messages: [{ role: "system", content: "你是助手" }, { role: "user", content: "你好" }] });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.object).toBe("chat.completion");
    expect(j.model).toBe("claude-local");
    expect(j.choices[0].message.role).toBe("assistant");
    expect(j.choices[0].message.content).toBe("你好，我是本机 Claude");
    expect(j.choices[0].finish_reason).toBe("stop");
  });

  it("messages 为空 → 400", async () => {
    process.env.CLAUDE_LOCAL_BRIDGE_KEY = "secret";
    const r = await post({ authorization: "Bearer secret" }, { messages: [] });
    expect(r.status).toBe(400);
  });
});

describe("模型切换透传（--model）", () => {
  it("claude-local:sonnet → 传 --model sonnet；claude-local → 不传", async () => {
    process.env.CLAUDE_LOCAL_BRIDGE_KEY = "secret";
    process.env.CLAUDE_BIN = echoClaude;
    const r1 = await post({ authorization: "Bearer secret" }, { model: "claude-local:sonnet", messages: [{ role: "user", content: "hi" }] });
    const j1 = await r1.json();
    expect(j1.choices[0].message.content).toContain("--model sonnet");
    const r2 = await post({ authorization: "Bearer secret" }, { model: "claude-local", messages: [{ role: "user", content: "hi" }] });
    const j2 = await r2.json();
    expect(j2.choices[0].message.content).not.toContain("--model");
  });
});

describe("GPT（codex）分流：同端点同 Key，按模型前缀走 codex exec", () => {
  it("gpt-local:foo → codex 收到 exec/--sandbox read-only/-m foo；回复来自 codex stdout", async () => {
    process.env.CLAUDE_LOCAL_BRIDGE_KEY = "secret";
    // 假 codex：吞 stdin，把参数回显为纯文本（codex 无 --json 时 stdout 即最终回答）
    const fakeCodex = join(dir, "codex-echo");
    writeFileSync(fakeCodex, "#!/bin/sh\ncat > /dev/null\necho \"CODEX-ARGS:$*\"\n");
    chmodSync(fakeCodex, 0o755);
    process.env.CODEX_BIN = fakeCodex;
    try {
      const r = await post({ authorization: "Bearer secret" }, { model: "gpt-local:foo", messages: [{ role: "user", content: "hi" }] });
      expect(r.status).toBe(200);
      const j = await r.json();
      const c = j.choices[0].message.content as string;
      expect(c).toContain("exec");
      expect(c).toContain("--sandbox read-only");
      expect(c).toContain("-m foo");
      // 默认条目不传 -m
      const r2 = await post({ authorization: "Bearer secret" }, { model: "gpt-local", messages: [{ role: "user", content: "hi" }] });
      const c2 = (await r2.json()).choices[0].message.content as string;
      expect(c2).not.toContain("-m ");
    } finally { delete process.env.CODEX_BIN; }
  });
});
