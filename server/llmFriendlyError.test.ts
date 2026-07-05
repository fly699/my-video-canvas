import { describe, it, expect } from "vitest";
import { friendlyLLMError } from "./_core/llm";

describe("friendlyLLMError（上游错误净化）", () => {
  it("JSON error → 抽 message", () => {
    expect(friendlyLLMError(401, "Unauthorized", '{"error":{"message":"bad key"}}')).toContain("bad key");
  });
  it("HTML 错误页（Cloudflare 502 等）→ 一句可行动提示，不糊整页 HTML", () => {
    const html = "<!DOCTYPE html>\n<html><head><title>502</title></head><body>Bad gateway...</body></html>";
    const out = friendlyLLMError(502, "Bad Gateway", html);
    expect(out).not.toContain("<html");
    expect(out).toContain("HTML 错误页");
    expect(out).toContain("127.0.0.1");
  });
  it("超长纯文本 → 截断", () => {
    const out = friendlyLLMError(500, "ISE", "x".repeat(2000));
    expect(out.length).toBeLessThan(700);
    expect(out).toContain("已截断");
  });
});
