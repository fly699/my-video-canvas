import { describe, it, expect } from "vitest";
import { KIE_LLM_MODELS, isKieLLMModel, extractKieLLMText } from "./_core/kieLLM";

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
    // 新增 Claude（均走 /claude/v1/messages）
    for (const [k, m] of [["kie_claude_opus_47", "claude-opus-4-7"], ["kie_claude_opus_46", "claude-opus-4-6"], ["kie_claude_opus_45", "claude-opus-4-5"], ["kie_claude_sonnet_45", "claude-sonnet-4-5"]] as const) {
      expect(KIE_LLM_MODELS[k]).toMatchObject({ model: m, path: "/claude/v1/messages", format: "claude" });
    }
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

describe("extractKieLLMText — responses 解析（GPT-5.x 推理模型）", () => {
  it("output_text 便捷字段优先", () => {
    expect(extractKieLLMText("responses", { output_text: "你好" })).toBe("你好");
  });
  it("reasoning 项在前、message 项在后：仍取到正文", () => {
    const data = {
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: "答案在此" }] },
      ],
    };
    expect(extractKieLLMText("responses", data)).toBe("答案在此");
  });
  it("多段 message 文本拼接；type 兼容 text/output_text", () => {
    const data = {
      output: [
        { type: "message", content: [{ type: "output_text", text: "甲" }] },
        { type: "message", content: [{ type: "text", text: "乙" }] },
      ],
    };
    expect(extractKieLLMText("responses", data)).toBe("甲乙");
  });
  it("只有 reasoning、无正文 → 返回空串（由上层按 incomplete 抛错）", () => {
    expect(extractKieLLMText("responses", { output: [{ type: "reasoning", summary: [] }], status: "incomplete" })).toBe("");
  });
  it("content 为字符串 / 文本挂在 item.text 上也能取到（宽容解析）", () => {
    expect(extractKieLLMText("responses", { output: [{ type: "message", content: "直接字符串" }] })).toBe("直接字符串");
    expect(extractKieLLMText("responses", { output: [{ type: "message", text: "挂在item上" }] })).toBe("挂在item上");
  });
  it("reasoning 项的 text 不被当作正文", () => {
    expect(extractKieLLMText("responses", { output: [{ type: "reasoning", text: "内部推理" }, { type: "message", content: [{ type: "output_text", text: "正文" }] }] })).toBe("正文");
  });
  it("claude / openai-chat 解析不受影响", () => {
    expect(extractKieLLMText("claude", { content: [{ type: "text", text: "C" }] })).toBe("C");
    expect(extractKieLLMText("openai-chat", { choices: [{ message: { content: "O" } }] })).toBe("O");
  });
});
