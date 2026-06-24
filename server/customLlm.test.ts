import { describe, it, expect } from "vitest";
import {
  CUSTOM_LLM_MODELS,
  isCustomLLMModel,
  resolveCustomModelName,
} from "./_core/customLlm";

describe("自定义 LLM 模型注册表", () => {
  it("仅包含 custom_openai / custom_claude 两个模型", () => {
    expect(Object.keys(CUSTOM_LLM_MODELS).sort()).toEqual(["custom_claude", "custom_openai"]);
  });

  it("isCustomLLMModel 正确识别（含空/未知）", () => {
    expect(isCustomLLMModel("custom_openai")).toBe(true);
    expect(isCustomLLMModel("custom_claude")).toBe(true);
    expect(isCustomLLMModel("kie_claude_opus_48")).toBe(false);
    expect(isCustomLLMModel("claude-sonnet-4-6")).toBe(false);
    expect(isCustomLLMModel(undefined)).toBe(false);
    expect(isCustomLLMModel("")).toBe(false);
  });

  it("OpenAI 走 chat/completions + Bearer 端点；Claude 走 Anthropic messages", () => {
    expect(CUSTOM_LLM_MODELS.custom_openai.format).toBe("openai-chat");
    expect(CUSTOM_LLM_MODELS.custom_openai.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(CUSTOM_LLM_MODELS.custom_claude.format).toBe("claude");
    expect(CUSTOM_LLM_MODELS.custom_claude.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("各自的前端密钥/模型请求头名固定", () => {
    expect(CUSTOM_LLM_MODELS.custom_openai.keyHeader).toBe("x-openai-key");
    expect(CUSTOM_LLM_MODELS.custom_openai.modelHeader).toBe("x-openai-model");
    expect(CUSTOM_LLM_MODELS.custom_claude.keyHeader).toBe("x-anthropic-key");
    expect(CUSTOM_LLM_MODELS.custom_claude.modelHeader).toBe("x-anthropic-model");
  });

  it("底层模型名优先级：前端请求头 > env 覆盖 > 默认", () => {
    const spec = CUSTOM_LLM_MODELS.custom_openai;
    // 测试环境无 OPENAI_MODEL env → envModel() 为空
    expect(resolveCustomModelName(spec, "gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(resolveCustomModelName(spec, "  ")).toBe(spec.defaultModel);
    expect(resolveCustomModelName(spec, null)).toBe(spec.defaultModel);
    expect(resolveCustomModelName(spec, undefined)).toBe(spec.defaultModel);
  });
});
