import { describe, it, expect } from "vitest";
import { sunoMvForModel } from "./sunoMv";

describe("sunoMvForModel", () => {
  it("Suno 各版本 → 对应 mv", () => {
    expect(sunoMvForModel("suno-v4")).toBe("V4");
    expect(sunoMvForModel("suno-v4.5")).toBe("V4_5");
    expect(sunoMvForModel("suno-v4.5plus")).toBe("V4_5PLUS");
    expect(sunoMvForModel("suno-v4.5all")).toBe("V4_5ALL");
    expect(sunoMvForModel("suno-v5")).toBe("V5");
    expect(sunoMvForModel("suno-v5.5")).toBe("V5_5");
    expect(sunoMvForModel("suno-v3.5")).toBe("V4"); // 旧别名
  });
  it("非 Suno 模型 → null（不提供原生续写）", () => {
    expect(sunoMvForModel("minimax-music-2.6")).toBeNull();
    expect(sunoMvForModel("elevenlabs-music")).toBeNull();
    expect(sunoMvForModel("kie_suno_v5")).toBeNull();
    expect(sunoMvForModel(undefined)).toBeNull();
    expect(sunoMvForModel("")).toBeNull();
  });
});
