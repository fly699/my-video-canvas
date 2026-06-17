import { describe, it, expect, vi, beforeEach } from "vitest";

// invokeLLMWithKie is the single wrapper every LLM router entry funnels through.
// Guard the whitelist gating: non-kie models use the platform env key and MUST pass
// assertLLMAllowed; kie models are gated inside resolveKieKey and must NOT be
// double-gated here (so users with their own/assigned kie key aren't blocked by the
// LLM whitelist switch).
const assertLLMAllowed = vi.fn<[unknown], Promise<void>>().mockResolvedValue(undefined);
const resolveKieKey = vi.fn().mockResolvedValue({ key: "resolved-kie-key" });
const invokeLLM = vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }] });

vi.mock("./_core/whitelist", () => ({ assertLLMAllowed: (ctx: unknown) => assertLLMAllowed(ctx) }));
vi.mock("./_core/kie", () => ({ resolveKieKey: (...a: unknown[]) => resolveKieKey(...a) }));
vi.mock("./_core/llm", () => ({ invokeLLM: (...a: unknown[]) => invokeLLM(...a) }));
vi.mock("./_core/kieLLM", () => ({ isKieLLMModel: (m: string) => m.startsWith("kie_") }));

const ctx = { user: { id: 7, role: "user" } } as never;
const msgs = [{ role: "user" as const, content: "hi" }];

describe("invokeLLMWithKie — LLM 白名单门控", () => {
  beforeEach(() => { assertLLMAllowed.mockClear(); resolveKieKey.mockClear(); invokeLLM.mockClear(); assertLLMAllowed.mockResolvedValue(undefined); });

  it("非 kie 模型：调用 assertLLMAllowed 后再 invokeLLM（堵白名单绕过）", async () => {
    const { invokeLLMWithKie } = await import("./_core/llmWithKie");
    await invokeLLMWithKie(ctx, { model: "gemini-3-flash-preview", messages: msgs });
    expect(assertLLMAllowed).toHaveBeenCalledTimes(1);
    expect(resolveKieKey).not.toHaveBeenCalled();
    expect(invokeLLM).toHaveBeenCalledTimes(1);
  });

  it("非 kie 模型：白名单拒绝时直接抛出、不落到 invokeLLM", async () => {
    assertLLMAllowed.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const { invokeLLMWithKie } = await import("./_core/llmWithKie");
    await expect(invokeLLMWithKie(ctx, { model: "poyo-gateway-model", messages: msgs })).rejects.toThrow("FORBIDDEN");
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it("kie 模型：走 resolveKieKey 门控，不重复调用 assertLLMAllowed", async () => {
    const { invokeLLMWithKie } = await import("./_core/llmWithKie");
    await invokeLLMWithKie(ctx, { model: "kie_claude_opus_48", messages: msgs });
    expect(resolveKieKey).toHaveBeenCalledTimes(1);
    expect(assertLLMAllowed).not.toHaveBeenCalled();
    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({ kieApiKey: "resolved-kie-key" }));
  });
});
