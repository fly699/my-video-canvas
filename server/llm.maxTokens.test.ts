import { describe, it, expect } from "vitest";
import { resolveMaxTokens, resolveModelId, chooseMaxTokens, SELF_HOSTED_DEFAULT_MAX_TOKENS, SELF_HOSTED_MIN_MAX_TOKENS, CLOUD_DEFAULT_MAX_TOKENS } from "./_core/llm";

// Regression: Gemini 3 Flash Preview (served via Forge) rejects an over-large
// max_tokens (the script generator asks for 8000), which 400'd the request and
// made Gemini unusable in the script node specifically — while every other LLM
// path (≤4096) worked. resolveMaxTokens clamps the budget for those models.
describe("resolveMaxTokens", () => {
  it("clamps Gemini 3 Flash preview down to its safe ceiling", () => {
    expect(resolveMaxTokens("gemini-3-flash-preview", 8000)).toBe(4096);
  });

  it("leaves a Gemini request already under the ceiling untouched", () => {
    expect(resolveMaxTokens("gemini-3-flash-preview", 4000)).toBe(4000);
  });

  it("does NOT clamp Claude — keeps the full 8000 budget", () => {
    expect(resolveMaxTokens("claude-sonnet-4-6", 8000)).toBe(8000);
    expect(resolveMaxTokens("claude-sonnet-4-5-20250929", 8000)).toBe(8000);
  });

  it("does NOT clamp GPT", () => {
    expect(resolveMaxTokens("gpt-5.2", 8000)).toBe(8000);
  });

  it("passes through when model is undefined", () => {
    expect(resolveMaxTokens(undefined, 8000)).toBe(8000);
  });
});

// Regression: 自建 vLLM 推理模型（Qwen3）的 <think> 思维链吃掉 max_tokens 预算，默认 4096
// 会让可见答案过短/被截断。自建模型给更高默认 + 8192 下限。
describe("chooseMaxTokens（自建模型预算）", () => {
  it("自建模型不传预算 → 用更高默认", () => {
    expect(chooseMaxTokens(true)).toBe(SELF_HOSTED_DEFAULT_MAX_TOKENS);
    expect(SELF_HOSTED_DEFAULT_MAX_TOKENS).toBeGreaterThanOrEqual(16384);
  });

  it("云端模型不传预算 → 4096", () => {
    expect(chooseMaxTokens(false)).toBe(CLOUD_DEFAULT_MAX_TOKENS);
    expect(chooseMaxTokens(false)).toBe(4096);
  });

  it("自建模型：偏小的显式预算被抬到 8192 下限（思维链保底）", () => {
    expect(chooseMaxTokens(true, 4096)).toBe(SELF_HOSTED_MIN_MAX_TOKENS);
    expect(chooseMaxTokens(true, 1000)).toBe(8192);
  });

  it("自建模型：更大的显式预算原样保留", () => {
    expect(chooseMaxTokens(true, 32000)).toBe(32000);
  });

  it("云端模型：显式预算原样保留（不加下限）", () => {
    expect(chooseMaxTokens(false, 1000)).toBe(1000);
    expect(chooseMaxTokens(false, 8000)).toBe(8000);
  });
});

// gemini-2.5-flash is no longer served upstream → remapped to the working Gemini 3.
describe("resolveModelId", () => {
  it("remaps the dead gemini-2.5-flash to gemini-3-flash-preview", () => {
    expect(resolveModelId("gemini-2.5-flash")).toBe("gemini-3-flash-preview");
  });

  it("leaves a working model id untouched", () => {
    expect(resolveModelId("gemini-3-flash-preview")).toBe("gemini-3-flash-preview");
    expect(resolveModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("falls back to the default model when undefined", () => {
    expect(resolveModelId(undefined)).toBe("claude-sonnet-4-5-20250929");
  });

  it("a remapped 2.5 request then clamps via its new id's ceiling", () => {
    // End-to-end: caller passes the dead id + 8000 budget → runs as Gemini 3 @ 4096.
    const resolved = resolveModelId("gemini-2.5-flash");
    expect(resolveMaxTokens(resolved, 8000)).toBe(4096);
  });
});
