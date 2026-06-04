import { describe, it, expect } from "vitest";
import { resolveMaxTokens } from "./_core/llm";

// Regression: Gemini 3 Flash Preview (served via Forge) rejects an over-large
// max_tokens (the script generator asks for 8000), which 400'd the request and
// made Gemini unusable in the script node specifically — while every other LLM
// path (≤4096) worked. resolveMaxTokens clamps the budget for those models.
describe("resolveMaxTokens", () => {
  it("clamps Gemini 3 Flash preview down to its safe ceiling", () => {
    expect(resolveMaxTokens("gemini-3-flash-preview", 8000)).toBe(4096);
  });

  it("clamps Gemini 2.5 Flash too", () => {
    expect(resolveMaxTokens("gemini-2.5-flash", 8000)).toBe(4096);
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
