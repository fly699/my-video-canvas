import { describe, it, expect } from "vitest";
import { KIE_LLM_MODELS, isKieLLMModel } from "./_core/kieLLM";

describe("kie LLM specs", () => {
  it("isKieLLMModel 只对已注册 kie 对话模型为真", () => {
    expect(isKieLLMModel("kie_claude_opus_48")).toBe(true);
    expect(isKieLLMModel("kie_gemini_3_pro")).toBe(true);
    expect(isKieLLMModel("kie_gpt_5_5")).toBe(true);
    expect(isKieLLMModel("claude-sonnet-4-6")).toBe(false); // Forge/Poyo Claude
    expect(isKieLLMModel("gpt-5.2")).toBe(false);
    expect(isKieLLMModel(undefined)).toBe(false);
  });

  it("三种格式与端点路径符合文档约定", () => {
    // Claude → Anthropic /claude/v1/messages
    expect(KIE_LLM_MODELS.kie_claude_opus_48).toMatchObject({ model: "claude-opus-4-8", path: "/claude/v1/messages", format: "claude" });
    expect(KIE_LLM_MODELS.kie_claude_sonnet_46.model).toBe("claude-sonnet-4-6");
    expect(KIE_LLM_MODELS.kie_claude_haiku_45.model).toBe("claude-haiku-4-5");
    // Gemini → OpenAI chat/completions，model 在路径里
    expect(KIE_LLM_MODELS.kie_gemini_3_pro).toMatchObject({ model: "gemini-3-pro", path: "/gemini-3-pro/v1/chat/completions", format: "openai-chat" });
    expect(KIE_LLM_MODELS.kie_gemini_3_flash.path).toBe("/gemini-3-flash/v1/chat/completions");
    // GPT 5.5/5.4 → Responses API；5.2 → chat/completions
    expect(KIE_LLM_MODELS.kie_gpt_5_5).toMatchObject({ model: "gpt-5-5", path: "/codex/v1/responses", format: "responses" });
    expect(KIE_LLM_MODELS.kie_gpt_5_4).toMatchObject({ model: "gpt-5-4", path: "/codex/v1/responses", format: "responses" });
    expect(KIE_LLM_MODELS.kie_gpt_5_2).toMatchObject({ model: "gpt-5-2", path: "/gpt-5-2/v1/chat/completions", format: "openai-chat" });
  });

  it("每个模型都带点数标注", () => {
    for (const [k, s] of Object.entries(KIE_LLM_MODELS)) {
      expect(s.creditNote.length, `${k} 缺 creditNote`).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});
