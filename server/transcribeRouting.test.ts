import { describe, it, expect } from "vitest";
import { transcribeProviderOf } from "../shared/transcribeRouting";

// 转写模型 → provider 归属：决定路由到哪个后端（方案B 多后端并存的核心）。
describe("transcribeProviderOf", () => {
  it("Groq 模型归 groq", () => {
    expect(transcribeProviderOf("whisper-large-v3")).toBe("groq");
    expect(transcribeProviderOf("whisper-large-v3-turbo")).toBe("groq");
  });
  it("Forge/OpenAI 内置模型归 forge", () => {
    expect(transcribeProviderOf("whisper-1")).toBe("forge");
    expect(transcribeProviderOf("gpt-4o-transcribe")).toBe("forge");
    expect(transcribeProviderOf("gpt-4o-mini-transcribe")).toBe("forge");
  });
  it("未知/自建 model id 归 \"\"（按自建端点处理）", () => {
    expect(transcribeProviderOf("Systran/faster-whisper-large-v3")).toBe("");
    expect(transcribeProviderOf("")).toBe("");
    expect(transcribeProviderOf("  ")).toBe("");
  });
});
