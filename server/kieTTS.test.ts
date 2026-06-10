import { describe, it, expect } from "vitest";
import { KIE_TTS_MODELS, isKieTTS } from "./_core/kieTTS";

describe("kie TTS specs", () => {
  it("isKieTTS 只对已注册 kie ElevenLabs 模型为真", () => {
    expect(isKieTTS("kie_elevenlabs_tts")).toBe(true);
    expect(isKieTTS("kie_elevenlabs_tts_ml")).toBe(true);
    expect(isKieTTS("kie_elevenlabs_v3")).toBe(true);
    expect(isKieTTS("elevenlabs/text-to-speech-turbo-2-5")).toBe(false); // 原始 model 串非 UI 值
    expect(isKieTTS("openai-tts")).toBe(false);
    expect(isKieTTS(undefined)).toBe(false);
  });

  it("每个 UI 值映射到合法的 ElevenLabs model 串与类型", () => {
    const validModels = new Set([
      "elevenlabs/text-to-speech-turbo-2-5",
      "elevenlabs/text-to-speech-multilingual-v2",
      "elevenlabs/text-to-dialogue-v3",
    ]);
    for (const [k, s] of Object.entries(KIE_TTS_MODELS)) {
      expect(k.startsWith("kie_elevenlabs"), `${k} 命名不符`).toBe(true);
      expect(validModels.has(s.model), `${k} → ${s.model} 非法`).toBe(true);
      expect(["tts", "dialogue"]).toContain(s.kind);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("V3 为 dialogue 类型，Turbo/多语为 tts 类型", () => {
    expect(KIE_TTS_MODELS.kie_elevenlabs_v3.kind).toBe("dialogue");
    expect(KIE_TTS_MODELS.kie_elevenlabs_tts.kind).toBe("tts");
    expect(KIE_TTS_MODELS.kie_elevenlabs_tts_ml.kind).toBe("tts");
  });
});
