import { describe, it, expect } from "vitest";
import { contentToText, messagesToPrompt, parseClaudeJsonResult, bridgeModelArg } from "./_core/claudeBridge";

describe("contentToText", () => {
  it("字符串原样；分段数组拼接 text；其它为空", () => {
    expect(contentToText("你好")).toBe("你好");
    expect(contentToText([{ type: "text", text: "a" }, "b", { type: "text", text: "c" }])).toBe("abc");
    expect(contentToText(undefined)).toBe("");
  });
});

describe("messagesToPrompt", () => {
  it("system 置顶、user/assistant 转写为「用户/助手」，跳过空内容", () => {
    const p = messagesToPrompt([
      { role: "system", content: "你是助手" },
      { role: "user", content: "问题一" },
      { role: "assistant", content: "回答一" },
      { role: "user", content: "  " },
      { role: "user", content: [{ type: "text", text: "问题二" }] },
    ]);
    expect(p).toBe("你是助手\n\n用户：问题一\n\n助手：回答一\n\n用户：问题二");
  });
  it("空数组 → 空串", () => {
    expect(messagesToPrompt([])).toBe("");
  });
});

describe("parseClaudeJsonResult", () => {
  it("标准成功 JSON → 取 result", () => {
    expect(parseClaudeJsonResult('{"type":"result","subtype":"success","result":"你好呀","is_error":false}')).toEqual({ text: "你好呀", isError: false });
  });
  it("is_error=true → isError", () => {
    expect(parseClaudeJsonResult('{"result":"boom","is_error":true}').isError).toBe(true);
  });
  it("前面有杂行、末尾是 JSON → 仍能抽出", () => {
    const r = parseClaudeJsonResult('some log line\n{"result":"最终答案","is_error":false}');
    expect(r).toEqual({ text: "最终答案", isError: false });
  });
  it("非 JSON 裸文本 → 兜底当回复", () => {
    expect(parseClaudeJsonResult("直接输出的文本")).toEqual({ text: "直接输出的文本", isError: false });
  });
  it("空输出 → isError", () => {
    expect(parseClaudeJsonResult("   ")).toEqual({ text: "", isError: true });
  });
});

describe("bridgeModelArg（模型切换解析）", () => {
  it("claude-local（默认条目）→ null 不传 --model", () => {
    expect(bridgeModelArg("claude-local")).toBeNull();
    expect(bridgeModelArg("")).toBeNull();
    expect(bridgeModelArg(undefined)).toBeNull();
  });
  it("claude-local:sonnet / :opus → 取后缀", () => {
    expect(bridgeModelArg("claude-local:sonnet")).toBe("sonnet");
    expect(bridgeModelArg("claude-local:opus")).toBe("opus");
  });
  it("直接登记别名/完整 id → 原样透传（含 [1m] 形态）", () => {
    expect(bridgeModelArg("haiku")).toBe("haiku");
    expect(bridgeModelArg("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5-20250929");
    expect(bridgeModelArg("sonnet[1m]")).toBe("sonnet[1m]");
  });
  it("非法字符/超长 → null 回退默认（防命令行注入）", () => {
    expect(bridgeModelArg("sonnet; rm -rf /")).toBeNull();
    expect(bridgeModelArg("a b")).toBeNull();
    expect(bridgeModelArg("x".repeat(80))).toBeNull();
  });
});

describe("rewriteBridgeSelfUrl（桥接自调用强制回环）", () => {
  it("非桥接地址恒等；未登记端口原样；登记后公网域名被改写为 127.0.0.1", async () => {
    const { rewriteBridgeSelfUrl, setBridgeSelfHttpPort } = await import("./_core/claudeBridge");
    expect(rewriteBridgeSelfUrl("http://172.16.0.10:8000/v1/chat/completions")).toBe("http://172.16.0.10:8000/v1/chat/completions");
    const pub = "https://avc.example.com/api/claude-bridge/v1/chat/completions";
    // 未登记端口 → 原样（如测试环境/极早期启动）
    expect(rewriteBridgeSelfUrl(pub)).toBe(pub);
    setBridgeSelfHttpPort(3456);
    expect(rewriteBridgeSelfUrl(pub)).toBe("http://127.0.0.1:3456/api/claude-bridge/v1/chat/completions");
    // 基础地址形态（未带 /v1/chat/completions）同样命中
    expect(rewriteBridgeSelfUrl("https://avc.example.com/api/claude-bridge")).toBe("http://127.0.0.1:3456/api/claude-bridge/v1/chat/completions");
  });
});
