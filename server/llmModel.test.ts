import { describe, expect, it } from "vitest";
import { normalizeModelId } from "./_core/llm";

describe("normalizeModelId", () => {
  it("maps the legacy claude-sonnet-4-6 alias to Poyo's real Anthropic model", () => {
    // Poyo's Anthropic model is claude-sonnet-4-5-20250929 (docs/poyo-llm-api.md);
    // 4-6 is a legacy alias that would 404 if sent verbatim.
    expect(normalizeModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-5-20250929");
  });
  it("leaves real model ids unchanged", () => {
    for (const id of ["gpt-5.2", "claude-sonnet-4-5-20250929", "gemini-3-flash-preview", "gemini-2.5-flash"]) {
      expect(normalizeModelId(id)).toBe(id);
    }
  });
});
