import { describe, it, expect } from "vitest";
import { contentToText, messagesToPrompt, parseClaudeJsonResult } from "./_core/claudeBridge";

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
