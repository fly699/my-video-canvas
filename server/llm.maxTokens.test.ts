import { describe, it, expect } from "vitest";
import { resolveMaxTokens, resolveModelId } from "./_core/llm";

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
