import { describe, it, expect } from "vitest";
import { stripReasoning } from "./_core/llm";

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
