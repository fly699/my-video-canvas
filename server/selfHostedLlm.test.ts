import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Self-hosted OpenAI-compatible LLM routing: a model id in SELF_HOSTED_LLM_MODELS (or the
// built-in default) must hit ${SELF_HOSTED_LLM_URL}/v1/chat/completions with the self-hosted
// key, WITHOUT redirecting other (Forge/Poyo) models. Mirrors the user's vLLM Qwen endpoint.
describe("invokeLLM — 自建端点路由", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("自建模型 → 打到 SELF_HOSTED_LLM_URL，带自建 key", async () => {
    process.env.SELF_HOSTED_LLM_URL = "http://172.16.0.10:8000";
    process.env.SELF_HOSTED_LLM_KEY = "sk-test";
    process.env.SELF_HOSTED_LLM_MODELS = "Qwen3.6-35B-A3B-FP8";
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "你好" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await invokeLLM({ model: "Qwen3.6-35B-A3B-FP8", messages: [{ role: "user", content: "hi" }] });
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://172.16.0.10:8000/v1/chat/completions");
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers.authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body).model).toBe("Qwen3.6-35B-A3B-FP8"); // 原样透传模型名给 vLLM
  });

  it("Open WebUI 端点（URL 已含 /api/chat/completions）→ 原样使用，不强补 /v1", async () => {
    process.env.SELF_HOSTED_LLM_URL = "http://172.16.0.20:3000/api/chat/completions";
    process.env.SELF_HOSTED_LLM_KEY = "sk-owui";
    process.env.SELF_HOSTED_LLM_MODELS = "qwen2.5:72b";
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "hi" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await invokeLLM({ model: "qwen2.5:72b", messages: [{ role: "user", content: "hi" }] });
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://172.16.0.20:3000/api/chat/completions"); // 不被改成 /api/v1/chat/completions
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.authorization).toBe("Bearer sk-owui");
  });

  it("只对自建 URL 启用时生效；非自建模型不受影响（仍走 Forge）", async () => {
    process.env.SELF_HOSTED_LLM_URL = "http://172.16.0.10:8000";
    process.env.SELF_HOSTED_LLM_MODELS = "Qwen3.6-35B-A3B-FP8";
    process.env.BUILT_IN_FORGE_API_KEY = "forge-key";
    delete process.env.BUILT_IN_FORGE_API_URL;
    delete process.env.POYO_API_KEY;
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "x" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await invokeLLM({ model: "gemini-3-flash-preview", messages: [{ role: "user", content: "hi" }] });
    expect(String(fetchMock.mock.calls[0][0])).toContain("forge.manus.im"); // 未被自建端点劫持
  });
});
