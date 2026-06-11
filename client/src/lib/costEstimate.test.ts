import { describe, it, expect } from "vitest";
import { estimateVideoCost, estimateImageCost, estimateMusicCost, estimateTtsCost, costEstimateLabel, estimateCanvasBudget } from "./costEstimate";

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
  it("Seedance 2 按「点·秒」× 时长计费（权威单价，非 /5）", () => {
    // kieVideo.ts：Fast 480p 15.5 / 720p 33 点·秒；Pro 480p 19 / 720p 41 / 1080p 102 点·秒
    expect(estimateVideoCost("kie_seedance2_fast", { resolution: "720p", duration: 5 })?.credits).toBe(33 * 5);
    expect(estimateVideoCost("kie_seedance2_fast", { resolution: "480p", duration: 10 })?.credits).toBe(15.5 * 10);
    expect(estimateVideoCost("kie_seedance2", { resolution: "1080p", duration: 5 })?.credits).toBe(102 * 5);
    expect(estimateVideoCost("kie_seedance2", { duration: 5 })?.credits).toBe(41 * 5); // 默认 720p
  });
  it("固定价（sora2 pro 100 cr/次）与未知模型返回 null", () => {
    expect(estimateVideoCost("poyo_sora2_pro", {})).toEqual({ credits: 100, unit: "cr", approx: false });
    expect(estimateVideoCost("poyo_veo", {})).toBeNull();
    expect(estimateVideoCost("unknown_model", {})).toBeNull();
  });
  // 穷尽式对账锁定：kie 视频价格必须取自 docs/kie-pricing.md（曾误抄 Poyo 同名模型的价，
  // 全量审计后逐档校正）。任何回归到 Poyo 数值都会在此处失败。
  it("kie 视频逐档价对齐 docs/kie-pricing.md（防回退 Poyo 误值）", () => {
    const v = (m: string, p: Record<string, unknown>) => estimateVideoCost(m, p)?.credits;
    expect(v("kie_kling21_std", { duration: 5 })).toBe(25);    // 标准 5/s（曾误 30）
    expect(v("kie_kling21_pro", { duration: 5 })).toBe(50);    // 专业 10/s（曾误 55）
    expect(v("kie_wan22_t2v", { resolution: "480p" })).toBe(40);  // 曾误 6
    expect(v("kie_wan22_i2v", { resolution: "720p" })).toBe(80);  // 曾误 12
    expect(v("kie_wan27_t2v", { resolution: "720p", duration: 5 })).toBe(80);    // 16/s（曾误 12）
    expect(v("kie_wan27_i2v", { resolution: "1080p", duration: 5 })).toBe(120);  // 24/s（曾误 18）
    expect(v("kie_hailuo02_std", { duration: 6 })).toBe(30);   // 5/s（曾误 7/s=42）
    expect(v("kie_hailuo02_pro_t2v", {})).toBe(57);            // 曾误 65
    expect(v("kie_hailuo02_pro_i2v", {})).toBe(57);
    expect(v("kie_grok_t2v", { resolution: "720p", duration: 6 })).toBe(18);  // 3/s（曾误 30 固定）
    expect(v("kie_grok_i2v", { resolution: "480p", duration: 6 })).toBeCloseTo(9.6); // 1.6/s
    expect(v("kie_happyhorse_t2v", { resolution: "720p", duration: 5 })).toBe(140);  // 28/s（曾误 16/s）
    expect(v("kie_happyhorse_i2v", { resolution: "1080p", duration: 5 })).toBe(240); // 48/s（曾误 32/s）
    expect(v("kie_kling26_motion", { mode: "1080p" })).toBe(18 * 5);  // 18/s（曾误 12/s）
    expect(v("kie_kling30_motion", { mode: "720p" })).toBe(20 * 5);   // 20/s（曾误 9/s）
    expect(v("kie_kling_avatar_std", {})).toBe(8 * 10);   // 8/s（曾误 7/s）
    expect(v("kie_kling_avatar_pro", {})).toBe(16 * 10);  // 16/s（曾误 14/s）
    expect(v("kie_wan_animate_move", { resolution: "720p" })).toBe(12.5 * 5);    // 12.5/s（曾误 15 固定）
    expect(v("kie_wan_animate_replace", { resolution: "480p" })).toBe(6 * 5);    // 6/s
    expect(v("kie_runway45", { quality: "720p", duration: 5 })).toBe(12);   // 曾误 75
    expect(v("kie_runway45", { quality: "720p", duration: 10 })).toBe(30);  // 曾误 150
    expect(v("kie_runway45", { quality: "1080p", duration: 5 })).toBe(30);
  });
  it("kie kling 3.0 随 mode+sound 计价（价格表 std720p 14/20·pro1080p 18/27·4K 67 点·秒）", () => {
    expect(estimateVideoCost("kie_kling30", {})?.credits).toBe(18 * 5);                          // 默认 pro 无音轨 18/s
    expect(estimateVideoCost("kie_kling30", { sound: true })?.credits).toBe(27 * 5);             // pro 有音轨 27/s
    expect(estimateVideoCost("kie_kling30", { mode: "std" })?.credits).toBe(14 * 5);             // std 无音轨 14/s
    expect(estimateVideoCost("kie_kling30", { mode: "std", sound: true })?.credits).toBe(20 * 5);// std 有音轨 20/s
    expect(estimateVideoCost("kie_kling30", { mode: "4K", duration: 10 })?.credits).toBe(670);   // 4K 67/s
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

describe("estimateImageCost — kie 分辨率逐档计价（GPT Image 2）", () => {
  it("默认（未选档）按 1K=6 点，不再取区间中值", () => {
    expect(estimateImageCost("kie_gpt_image_2", 1)).toEqual({ credits: 6, unit: "点", approx: false });
  });
  it("2K=10 / 4K=16，张数相乘", () => {
    expect(estimateImageCost("kie_gpt_image_2", 1, { resolution: "2K" })?.credits).toBe(10);
    expect(estimateImageCost("kie_gpt_image_2", 2, { resolution: "4K" })?.credits).toBe(32);
    expect(estimateImageCost("kie_gpt_image_2_i2i", 1, { resolution: "4K" })?.credits).toBe(16);
  });
  it("非法档回退默认档", () => {
    expect(estimateImageCost("kie_gpt_image_2", 1, { resolution: "8K" })?.credits).toBe(6);
  });
});

describe("estimateImageCost — 全量审计补齐档位（nano banana 2 / flux2 flex）", () => {
  it("nano banana 2：1K=8 默认精确，4K=18", () => {
    expect(estimateImageCost("kie_nano_banana_2", 1)).toEqual({ credits: 8, unit: "点", approx: false });
    expect(estimateImageCost("kie_nano_banana_2", 1, { resolution: "4K" })?.credits).toBe(18);
  });
  it("flux2 flex：1K=14 / 2K=24（t2i 与 i2i 同价）", () => {
    expect(estimateImageCost("kie_flux2_flex", 1)?.credits).toBe(14);
    expect(estimateImageCost("kie_flux2_flex_i2i", 1, { resolution: "2K" })?.credits).toBe(24);
  });
  it("ideogram v3 按文档默认 BALANCED 档精确 7 点", () => {
    expect(estimateImageCost("kie_ideogram_v3", 1)).toEqual({ credits: 7, unit: "点", approx: false });
  });
});

describe("estimateCanvasBudget — 画布级预算汇总", () => {
  const node = (nodeType: string, payload: Record<string, unknown>) => ({ data: { nodeType, payload } });
  it("分 kie 点 / Poyo cr 两路汇总，并按模型分组计数", () => {
    const b = estimateCanvasBudget([
      node("video_task", { provider: "kie_kling21_std", duration: 10 }), // 50 点
      node("video_task", { provider: "kie_kling21_std", duration: 5 }),  // 25 点（同模型合并）
      node("image_gen", { model: "kie_gpt_image_2", imageResolution: "2K", imageN: 2 }), // 20 点
      node("video_task", { provider: "poyo_runway45", duration: 5 }),    // 75 cr
      node("comfyui_image", {}),                                          // 本地免费
      node("image_gen", {}),                                              // 未选模型 → unknown
    ]);
    expect(b.pt).toBe(95);   // 50 + 25 + 20
    expect(b.cr).toBe(75);
    expect(b.localCount).toBe(1);
    expect(b.unknownCount).toBe(1);
    const kling = b.lines.find((l) => l.key === "kie_kling21_std");
    expect(kling?.count).toBe(2);
    expect(kling?.credits).toBe(75);
    expect(kling?.unit).toBe("点");
  });
  it("音频：配乐/配音/音效分别计入对应单位", () => {
    const b = estimateCanvasBudget([
      node("audio", { audioCategory: "music", musicModel: "kie_suno_v5" }),            // 12 点
      node("audio", { audioCategory: "dubbing", ttsModel: "kie_elevenlabs_tts", ttsText: "a".repeat(1500) }), // 6*2=12 点
      node("audio", { audioCategory: "sfx", sfxDuration: 10 }),                          // 0.24*10=2.4 点
      node("audio", { audioCategory: "music", musicModel: "poyo_suno" }),               // 20 cr
      node("audio", { audioCategory: "upload" }),                                        // 免费，不计
    ]);
    expect(b.pt).toBeCloseTo(26.4); // 12 + 12 + 2.4
    expect(b.cr).toBe(20);
    expect(b.runnableCount).toBe(5);
  });
});
