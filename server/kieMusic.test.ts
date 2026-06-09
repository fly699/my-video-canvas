import { describe, it, expect } from "vitest";
import { KIE_MUSIC_MODELS, isKieMusicModel } from "./_core/kieMusic";

describe("kie music specs", () => {
  it("isKieMusicModel 只对已注册 kie suno 模型为真", () => {
    expect(isKieMusicModel("kie_suno_v5")).toBe(true);
    expect(isKieMusicModel("kie_suno_v4_5plus")).toBe(true);
    expect(isKieMusicModel("suno-v5")).toBe(false);     // Poyo Suno
    expect(isKieMusicModel("minimax-music-2.6")).toBe(false);
    expect(isKieMusicModel(undefined)).toBe(false);
  });

  it("每个 UI 值映射到合法的 kie Suno model 枚举（文档：V3_5/V4/V4_5/V4_5PLUS/V5/V5_5）", () => {
    const valid = new Set(["V3_5", "V4", "V4_5", "V4_5PLUS", "V5", "V5_5"]);
    for (const [k, s] of Object.entries(KIE_MUSIC_MODELS)) {
      expect(k.startsWith("kie_suno_"), `${k} 命名不符`).toBe(true);
      expect(valid.has(s.model), `${k} → ${s.model} 非法`).toBe(true);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});
