import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// invokeLLM reads ENV (process.env) at import time and needs an API key, so set
// one before the dynamic import below.
beforeAll(() => { process.env.BUILT_IN_FORGE_API_KEY = "test-key"; process.env.KIE_API_KEY = "kie-test-key"; });

const ok = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});
const fail = (status: number, body: string, statusText = "Error") => ({
  ok: false, status, statusText, text: async () => body,
});

const baseParams = { model: "gemini-3-flash-preview", messages: [{ role: "user" as const, content: "hi" }] };

describe("invokeLLM — transient-error retry", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("kie_* 对话模型转发到 kie 专属端点（不打 Forge，修复 404）", async () => {
    // claude 格式响应：content[].text。
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: "text", text: "kie-reply" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM, extractTextContent } = await import("./_core/llm");
    const r = await invokeLLM({ model: "kie_claude_sonnet_46", messages: [{ role: "user", content: "hi" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/claude/v1/messages");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("forge");
    expect(extractTextContent(r)).toBe("kie-reply");
  });

  it("retries a 5xx upstream error then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(500, '{"error":{"message":"Server exception"}}', "Internal Server Error"))
      .mockResolvedValueOnce(ok("recovered"));
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM, extractTextContent } = await import("./_core/llm");
    const r = await invokeLLM(baseParams);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(extractTextContent(r)).toBe("recovered");
  });

  it("retries 429 rate-limits", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(429, "rate limited", "Too Many Requests"))
      .mockResolvedValueOnce(ok("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await invokeLLM(baseParams);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx caller error and surfaces the gateway message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(400, '{"error":{"message":"bad request"}}', "Bad Request"));
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await expect(invokeLLM(baseParams)).rejects.toThrow(/400 Bad Request – bad request/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries on a persistent 5xx and throws the friendly message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(500, '{"error":{"message":"Server exception, please try again later"}}', "Internal Server Error"));
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await expect(invokeLLM(baseParams)).rejects.toThrow(/Server exception, please try again later/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("retries network/timeout errors", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(ok("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await invokeLLM(baseParams);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
