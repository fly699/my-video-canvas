import { describe, it, expect } from "vitest";
import { stripReasoning, extractReasoning, type InvokeResult } from "./_core/llm";

function resp(message: Record<string, unknown>): InvokeResult {
  return { id: "x", created: 0, model: "m", choices: [{ index: 0, message: message as never, finish_reason: "stop" }] };
}

describe("stripReasoning — 剥离推理模型的 <think> 链路", () => {
  it("规整的 <think>…</think> 块 → 只留答案", () => {
    expect(stripReasoning("<think>分析用户意图……</think>\n\n你好！我在的。")).toBe("你好！我在的。");
  });

  it("孤立的 </think>（开标签丢失，本次线上实际情形）→ 丢弃其前全部", () => {
    const leaked = `Here's a thinking process:\n1. 分析输入\n2. 组织回答\n</think>\n\n你好！我在的。😊 今天有什么需要我协助的？`;
    expect(stripReasoning(leaked)).toBe("你好！我在的。😊 今天有什么需要我协助的？");
  });

  it("多个 think 块全部剥离", () => {
    expect(stripReasoning("<think>a</think>正文<think>b</think>")).toBe("正文");
  });

  it("大小写不敏感", () => {
    expect(stripReasoning("<THINK>x</THINK>答案")).toBe("答案");
  });

  it("被截断的开标签（推理没写完就停）→ 丢尾", () => {
    expect(stripReasoning("<think>只想了一半就被截断")).toBe("");
  });

  it("普通文本（无 think）原样返回（仅去首尾空白）", () => {
    expect(stripReasoning("  正常回答  ")).toBe("正常回答");
    expect(stripReasoning("")).toBe("");
  });
});

describe("extractReasoning — 取出思考过程供展示", () => {
  it("OpenAI 兼容 reasoning_content 字段优先", () => {
    expect(extractReasoning(resp({ role: "assistant", content: "答案", reasoning_content: "先分析再作答" }))).toBe("先分析再作答");
  });
  it("content 里的 <think> 块", () => {
    expect(extractReasoning(resp({ role: "assistant", content: "<think>逐步推理…</think>\n\n最终答案" }))).toBe("逐步推理…");
  });
  it("孤立开标签（被截断）→ 取其后全部", () => {
    expect(extractReasoning(resp({ role: "assistant", content: "<think>只想了一半" }))).toBe("只想了一半");
  });
  it("孤立闭标签 → 取其前全部", () => {
    expect(extractReasoning(resp({ role: "assistant", content: "推理内容\n</think>\n答案" }))).toBe("推理内容");
  });
  it("无思考内容 → 空串", () => {
    expect(extractReasoning(resp({ role: "assistant", content: "纯答案，无思考" }))).toBe("");
  });
});
