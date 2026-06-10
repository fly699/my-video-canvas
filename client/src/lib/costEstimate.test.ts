import { describe, it, expect } from "vitest";
import { estimateVideoCost, estimateImageCost, estimateMusicCost, estimateTtsCost, costEstimateLabel } from "./costEstimate";

describe("estimateVideoCost", () => {
  it("按时长线性计费（poyo kling 2.1 std：6 cr/s）", () => {
    expect(estimateVideoCost("poyo_kling21_std", { duration: 5 })).toEqual({ credits: 30, unit: "cr", approx: false });
    expect(estimateVideoCost("poyo_kling21_std", { duration: 10 })?.credits).toBe(60);
  });
  it("kie kling 2.6 有声 2x 计费", () => {
    expect(estimateVideoCost("kie_kling26_t2v", { duration: 5, sound: false })?.credits).toBe(55);
    expect(estimateVideoCost("kie_kling26_t2v", { duration: 5, sound: true })?.credits).toBe(110);
  });
  it("分辨率档位（poyo wan2.7：720p 12 / 1080p 18 cr/s）", () => {
    expect(estimateVideoCost("poyo_wan27_t2v", { duration: 5, resolution: "720p" })?.credits).toBe(60);
    expect(estimateVideoCost("poyo_wan27_t2v", { duration: 5, resolution: "1080p" })?.credits).toBe(90);
  });
  it("多镜头 3x 计费（poyo wan2.6）", () => {
    const single = estimateVideoCost("poyo_wan25_t2v", { duration: 5, resolution: "720p", multi_shots: false });
    const multi = estimateVideoCost("poyo_wan25_t2v", { duration: 5, resolution: "720p", multi_shots: true });
    expect(multi!.credits).toBe(single!.credits * 3);
  });
  it("固定价（sora2 pro 100 cr/次）与未知模型返回 null", () => {
    expect(estimateVideoCost("poyo_sora2_pro", {})).toEqual({ credits: 100, unit: "cr", approx: false });
    expect(estimateVideoCost("poyo_veo", {})).toBeNull();
    expect(estimateVideoCost("unknown_model", {})).toBeNull();
  });
  it("缺省参数取默认值（kie kling 3.0 默认 std 5s）", () => {
    expect(estimateVideoCost("kie_kling30", {})?.credits).toBe(18 * 5);
    expect(estimateVideoCost("kie_kling30", { mode: "4K", duration: 10 })?.credits).toBe(670);
  });
});

describe("estimateImageCost", () => {
  it("单价 × 张数（poyo nano banana 5 cr/张）", () => {
    expect(estimateImageCost("poyo_nano_banana", 1)).toEqual({ credits: 5, unit: "cr", approx: false });
    expect(estimateImageCost("poyo_nano_banana", 4)?.credits).toBe(20);
  });
  it("kie 固定价解析（kie_nano_banana 4 点/张）", () => {
    expect(estimateImageCost("kie_nano_banana", 2)).toEqual({ credits: 8, unit: "点", approx: false });
  });
  it("区间价取中值并标 approx（kie_nano_banana_pro 18-24 点/张）", () => {
    expect(estimateImageCost("kie_nano_banana_pro", 1)).toEqual({ credits: 21, unit: "点", approx: true });
  });
  it("内置免费 0；HF 独立计费 null", () => {
    expect(estimateImageCost("manus_forge", 1)?.credits).toBe(0);
    expect(estimateImageCost("hf_soul_standard", 4)).toBeNull();
  });
});

describe("estimateMusicCost / estimateTtsCost", () => {
  it("Suno：Poyo 20 cr / kie 12 点；MiniMax 未知", () => {
    expect(estimateMusicCost("suno-v5")).toEqual({ credits: 20, unit: "cr", approx: false });
    expect(estimateMusicCost("kie_suno_v5")).toEqual({ credits: 12, unit: "点", approx: false });
    expect(estimateMusicCost("minimax-music-2.6")).toBeNull();
  });
  it("TTS 按千字符向上取整（kie ElevenLabs 6 点/1k）", () => {
    expect(estimateTtsCost("kie_elevenlabs_tts", 500)?.credits).toBe(6);
    expect(estimateTtsCost("kie_elevenlabs_tts", 1500)?.credits).toBe(12);
    expect(estimateTtsCost("elevenlabs-v3-tts", 2200)).toEqual({ credits: 48, unit: "cr", approx: false });
    expect(estimateTtsCost("voxcpm-local", 9999)?.credits).toBe(0);
    expect(estimateTtsCost("openai_tts_real", 1000)).toBeNull();
  });
});

describe("costEstimateLabel", () => {
  it("格式化：approx 加 ≈，小数保留 1 位，null 为空串", () => {
    expect(costEstimateLabel({ credits: 60, unit: "点", approx: false })).toBe("60 点");
    expect(costEstimateLabel({ credits: 21.55, unit: "cr", approx: true })).toBe("≈21.6 cr");
    expect(costEstimateLabel(null)).toBe("");
  });
});
