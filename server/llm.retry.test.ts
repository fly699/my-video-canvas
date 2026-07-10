import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// invokeLLM reads ENV (process.env) at import time and needs an API key, so set
// one before the dynamic import below.
beforeAll(() => { process.env.BUILT_IN_FORGE_API_KEY = "test-key"; process.env.KIE_API_KEY = "kie-test-key"; });

// invokeLLM 现在先 response.text() 再 JSON.parse（#783 防 HTTP 200+HTML），mock 须提供 text()。
const ok = (content: string) => ({
  ok: true,
  text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
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
    const r = await invokeLLM({ model: "kie_claude_sonnet_46", messages: [{ role: "user", content: "hi" }], kieApiKey: "kie-test-key" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/claude/v1/messages");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("forge");
    expect(extractTextContent(r)).toBe("kie-reply");
  });

  it("kie_* 使用调用方传入的用户 key（临时/分配），而非仅公用 key", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await invokeLLM({ model: "kie_claude_opus_48", messages: [{ role: "user" as const, content: "hi" }], kieApiKey: "user-kie-key" });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer user-kie-key"); // 用用户 key，而非 ENV 公用 key
  });

  it("kie_* 未提供密钥时抛错——底层【不再】回退公用 key（权限由 invokeLLMWithKie/resolveKieKey 把关）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    // 即便 ENV.KIE_API_KEY 已配置（beforeAll 设了），不传 kieApiKey 也必须抛错而非偷用公用 key。
    await expect(invokeLLM({ model: "kie_claude_haiku_45", messages: [{ role: "user" as const, content: "hi" }] })).rejects.toThrow(/已授权的密钥|invokeLLMWithKie/);
    expect(fetchMock).not.toHaveBeenCalled(); // 没有任何外发请求（更没用公用 key）
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
