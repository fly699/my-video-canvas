// ---------------------------------------------------------------------------
// 实时点数消耗预估 — 单一数据源
// ---------------------------------------------------------------------------
// 依据 docs/poyo-credits-pricing.md（Poyo，单位 cr，1 cr = $0.005）与
// docs/kie-pricing.md（kie，单位 点）人工整理的计费规则，按「当前所选模型 +
// 已设置参数」计算预估消耗，显示在各节点的生成按钮上，并随生成请求传给后端
// 计入管理员日志。仅供参考——实际扣费以平台账单为准；价格会随上游调整，
// 改价时同步更新这里与 models.ts 的 costLabel/costNote。
//
// 约定：
//   credits  — 数值预估（同一模型族的已知档位精确取值，范围价取中值并标 approx）
//   unit     — "cr"（Poyo）或 "点"（kie）；Higgsfield 独立计费、无法换算，返回 null
//   approx   — true 表示取近似/中值（标 ≈）
//   null     — 无法预估（模型页未公布固定价 / 本地免费除外）
import { IMAGE_MODELS } from "./models";

export type CostEstimate = {
  credits: number;
  unit: "cr" | "点";
  approx: boolean;
} | null;

/** 把预估格式化成按钮上的短标签，如 "≈60 点" / "20 cr"；null → ""。 */
export function costEstimateLabel(e: CostEstimate): string {
  if (!e) return "";
  const n = Number.isInteger(e.credits) ? e.credits : Math.round(e.credits * 10) / 10;
  return `${e.approx ? "≈" : ""}${n} ${e.unit}`;
}

const cr = (credits: number, approx = false): CostEstimate => ({ credits, unit: "cr", approx });
const pt = (credits: number, approx = false): CostEstimate => ({ credits, unit: "点", approx });

// ── 视频 ─────────────────────────────────────────────────────────────────────
type P = Record<string, unknown>;
const num = (p: P, k: string, d: number): number => {
  const v = Number(p[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};
const str = (p: P, k: string, d: string): string => (typeof p[k] === "string" && p[k] ? (p[k] as string) : d);
const on = (p: P, k: string): boolean => p[k] === true;

/** 每个视频模型的计费规则（provider value → 估算函数）。未列出 = 无法预估。 */
const VIDEO_RULES: Record<string, (p: P) => CostEstimate> = {
  // ── Poyo（cr）──
  poyo_sora2_pro:          () => cr(100),
  poyo_sora2_official:     (p) => cr(12 * num(p, "duration", 8)),
  poyo_sora2_pro_official: () => cr(100),
  poyo_kling21_std:   (p) => cr(6 * num(p, "duration", 5)),
  poyo_kling21_pro:   (p) => cr(11 * num(p, "duration", 5)),
  poyo_kling25_turbo: (p) => cr(8.4 * num(p, "duration", 5)),
  poyo_kling26:       (p) => cr((on(p, "sound") ? 24 : 13) * num(p, "duration", 5)),
  poyo_kling30_std:   (p) => cr((str(p, "resolution", "720p") === "1080p" ? 39 : 27) * num(p, "duration", 5)),
  poyo_kling30_pro:   (p) => cr((str(p, "resolution", "720p") === "1080p" ? 49 : 39) * num(p, "duration", 5)),
  poyo_kling30_4k:    (p) => cr(50 * num(p, "duration", 5)),
  poyo_kling_o3_std:  (p) => cr((on(p, "sound") ? 13 : 10) * num(p, "duration", 5)),
  poyo_kling_o3_pro:  (p) => cr((on(p, "sound") ? 16 : 13) * num(p, "duration", 5)),
  poyo_kling_o3_4k:   (p) => cr(50 * num(p, "duration", 5)),
  poyo_wan25_t2v: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 120 : 80) * (num(p, "duration", 5) / 5) * (on(p, "multi_shots") ? 3 : 1), true),
  poyo_wan25_i2v: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 120 : 80) * (num(p, "duration", 5) / 5) * (on(p, "multi_shots") ? 3 : 1), true),
  poyo_wan27_t2v: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 18 : 12) * num(p, "duration", 5)),
  poyo_wan27_i2v: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 18 : 12) * num(p, "duration", 5)),
  poyo_wan22_t2v_fast: (p) => cr(str(p, "resolution", "720p") === "480p" ? 6 : 12),
  poyo_wan22_i2v_fast: (p) => cr(str(p, "resolution", "720p") === "480p" ? 6 : 12),
  poyo_seedance1_pro:  (p) => cr((str(p, "resolution", "720p") === "1080p" ? 43 : 21) * (num(p, "duration", 5) / 5)),
  poyo_seedance15_pro: (p) => cr(({ "480p": 9, "720p": 16, "1080p": 32 }[str(p, "resolution", "720p")] ?? 16) * (num(p, "duration", 5) / 5), true),
  poyo_seedance:       (p) => cr(({ "480p": 10, "720p": 20, "1080p": 45 }[str(p, "resolution", "720p")] ?? 20) * num(p, "duration", 5)),
  poyo_hailuo02:     (p) => cr(7 * num(p, "duration", 6)),
  poyo_hailuo02_pro: () => cr(65),
  poyo_hailuo23:     (p) => cr(str(p, "resolution", "768p") === "1080p" ? 60 : (num(p, "duration", 6) === 6 ? 35 : 70), true),
  poyo_happy_horse:  (p) => cr((str(p, "resolution", "1080p") === "1080p" ? 32 : 16) * num(p, "duration", 5)),
  poyo_grok_video:   (p) => cr(num(p, "duration", 6) <= 6 ? 30 : 40),
  poyo_runway45:     (p) => cr(15 * num(p, "duration", 5)),
  // ── kie（点）──
  kie_veo31_quality: () => pt(250, true), // 720p 250 / 1080p 255 / 4K 380；分辨率由上游自动，取最常用档
  kie_veo31_fast:    () => pt(60, true),
  kie_kling26_t2v: (p) => pt(11 * num(p, "duration", 5) * (on(p, "sound") ? 2 : 1)),
  kie_kling26_i2v: (p) => pt(11 * num(p, "duration", 5) * (on(p, "sound") ? 2 : 1)),
  // kie 价格表：std=720p(无14/有20) · pro=1080p(无18/有27) · 4K=67（含/无音轨），随 mode+sound 变。
  kie_kling30: (p) => {
    const m = str(p, "mode", "pro"); const snd = on(p, "sound");
    const perSec = m === "4K" ? 67 : m === "pro" ? (snd ? 27 : 18) : (snd ? 20 : 14);
    return pt(perSec * num(p, "duration", 5), true);
  },
  kie_kling25turbo_t2v: (p) => pt(8.4 * num(p, "duration", 5)),
  kie_kling25turbo_i2v: (p) => pt(8.4 * num(p, "duration", 5)),
  kie_wan25_t2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 100 : 60) * (num(p, "duration", 5) / 5), true),
  kie_wan25_i2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 100 : 60) * (num(p, "duration", 5) / 5), true),
  kie_wan26_t2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 105 : 70) * (num(p, "duration", 5) / 5), true),
  kie_wan26_i2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 105 : 70) * (num(p, "duration", 5) / 5), true),
  kie_hailuo23_pro: (p) => pt(num(p, "duration", 6) >= 10 ? 90 : (str(p, "resolution", "768P") === "1080P" ? 80 : 45), true),
  kie_hailuo23_std: (p) => pt(num(p, "duration", 6) >= 10 ? 50 : (str(p, "resolution", "768P") === "1080P" ? 50 : 30), true),
  // Seedance 2：kieVideo.ts 权威单价为「点·秒」（每秒）× 时长，无音频附加（label 上限即 1080p）。
  kie_seedance2:      (p) => pt(({ "480p": 19, "720p": 41, "1080p": 102 }[str(p, "resolution", "720p")] ?? 41) * num(p, "duration", 5), true),
  kie_seedance2_fast: (p) => pt(({ "480p": 15.5, "720p": 33 }[str(p, "resolution", "720p")] ?? 33) * num(p, "duration", 5), true),
  // Kling 2.1：价格表 标准 5s25/10s50（5/s）· 专业 5s50/10s100（10/s）。
  kie_kling21_std: (p) => pt(5 * num(p, "duration", 5)),
  kie_kling21_pro: (p) => pt(10 * num(p, "duration", 5)),
  // Wan 2.2 turbo：价格表按整条计（5s 固定）480p 40 / 720p 80 点。
  kie_wan22_t2v: (p) => pt(str(p, "resolution", "720p") === "480p" ? 40 : 80),
  kie_wan22_i2v: (p) => pt(str(p, "resolution", "720p") === "480p" ? 40 : 80),
  // Wan 2.7：价格表 720p 16 / 1080p 24 点·秒。
  kie_wan27_t2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 24 : 16) * num(p, "duration", 5)),
  kie_wan27_i2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 24 : 16) * num(p, "duration", 5)),
  // Hailuo 02：价格表 标准 6s30/10s50（5/s，768p）· 专业 6s 1080p 固定 57。
  kie_hailuo02_std:     (p) => pt(5 * num(p, "duration", 6)),
  kie_hailuo02_pro_t2v: () => pt(57),
  kie_hailuo02_pro_i2v: () => pt(57),
  // Grok Imagine：价格表 480p 1.6 / 720p 3 点·秒（duration 6–30s）。
  kie_grok_t2v: (p) => pt(({ "480p": 1.6, "720p": 3 }[str(p, "resolution", "480p")] ?? 1.6) * num(p, "duration", 6)),
  kie_grok_i2v: (p) => pt(({ "480p": 1.6, "720p": 3 }[str(p, "resolution", "480p")] ?? 1.6) * num(p, "duration", 6)),
  // HappyHorse：价格表 720p 28 / 1080p 48 点·秒。
  kie_happyhorse_t2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 48 : 28) * num(p, "duration", 5)),
  kie_happyhorse_i2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 48 : 28) * num(p, "duration", 5)),
  // 动作控制：价格表 2.6→720p 11/1080p 18 · 3.0→720p 20/1080p 27 点·秒；时长随源视频，按 5s 估。
  kie_kling26_motion: (p) => pt((str(p, "mode", "720p") === "1080p" ? 18 : 11) * 5, true),
  kie_kling30_motion: (p) => pt((str(p, "mode", "720p") === "1080p" ? 27 : 20) * 5, true),
  // 数字人：价格表 标准 8 / 专业 16 点·秒；时长随音频，按 10s 估。
  kie_kling_avatar_std: () => pt(8 * 10, true),
  kie_kling_avatar_pro: () => pt(16 * 10, true),
  // Wan Animate：价格表 480p 6 / 580p 9.5 / 720p 12.5 点·秒；时长随源视频，按 5s 估。
  kie_wan_animate_move:    (p) => pt(({ "480p": 6, "580p": 9.5, "720p": 12.5 }[str(p, "resolution", "480p")] ?? 6) * 5, true),
  kie_wan_animate_replace: (p) => pt(({ "480p": 6, "580p": 9.5, "720p": 12.5 }[str(p, "resolution", "480p")] ?? 6) * 5, true),
  // Runway Gen 4.5：价格表 720p 5s12/10s30 · 1080p（仅 5s）30 点·条。
  kie_runway45:     (p) => pt(str(p, "quality", "720p") === "1080p" ? 30 : (num(p, "duration", 5) >= 10 ? 30 : 12)),
  kie_topaz_upscale: (p) => pt((str(p, "upscale_factor", "2") === "4" ? 14 : 8) * 10, true), // 按 10s 源视频估
  kie_runway_aleph: () => pt(110),
  mock: () => cr(0),
};

/** 视频任务：按 provider + 当前参数估算（duration/resolution/sound 等变化即时反映）。 */
export function estimateVideoCost(provider: string, params: P | undefined): CostEstimate {
  const rule = VIDEO_RULES[provider];
  return rule ? rule(params ?? {}) : null;
}

// ── 图像 ─────────────────────────────────────────────────────────────────────
// 单价：优先取 IMAGE_MODELS.cost（精确单价），否则解析 costNote 中的固定值或
// 区间（取中值、标 approx）。"模型页"/"HF 计费" 无法预估 → null；"内置" → 0。
function imageUnitCost(model: string): CostEstimate {
  const meta = IMAGE_MODELS.find((m) => m.value === model);
  if (!meta) return null;
  const unit: "cr" | "点" = meta.provider === "Kie" ? "点" : "cr";
  if (typeof meta.cost === "number") return { credits: meta.cost, unit, approx: false };
  const note = meta.costNote ?? "";
  if (meta.provider === "Manus") return cr(0); // 内置免费
  if (meta.provider === "Higgsfield") return null; // HF 独立计费，无法换算
  // "4 点/张" / "8 cr/张"
  const fixed = note.match(/^([\d.]+)\s*(?:点|cr)\/张$/);
  if (fixed) return { credits: Number(fixed[1]), unit, approx: false };
  // "18-24 点/张" / "5-12 cr/张" → 取中值
  const range = note.match(/^([\d.]+)-([\d.]+)\s*(?:点|cr)\/张$/);
  if (range) return { credits: (Number(range[1]) + Number(range[2])) / 2, unit, approx: true };
  // "起 2cr × 1/2/4x"（gpt image 按分辨率倍率）→ 基价近似
  const base = note.match(/^起\s*([\d.]+)\s*cr/);
  if (base) return { credits: Number(base[1]), unit, approx: true };
  // "4 点/百万像素"（Qwen）→ 按 ~1MP 估
  const perMp = note.match(/^([\d.]+)\s*点\/百万像素$/);
  if (perMp) return { credits: Number(perMp[1]), unit, approx: true };
  return null; // 模型页 / 分辨率×n 等无法预估
}

// 按分辨率档逐档计价的 kie 图像模型（docs/kie-pricing.md 权威价；与服务端 resOptions 同步）。
// 未选档时按服务端默认（首项）计价——不再用区间中值（曾把 GPT Image 2 默认 1K=6 估成 ≈11）。
export const KIE_IMAGE_RES_COST: Record<string, Record<string, number>> = {
  kie_gpt_image_2:     { "1K": 6, "2K": 10, "4K": 16 },
  kie_gpt_image_2_i2i: { "1K": 6, "2K": 10, "4K": 16 },
  // 全量审计补齐（kie-pricing.md 逐行价）
  kie_nano_banana_2:   { "1K": 8, "2K": 12, "4K": 18 },
  kie_flux2_flex:      { "1K": 14, "2K": 24 },
  kie_flux2_flex_i2i:  { "1K": 14, "2K": 24 },
};

/** 图像生成：单价 × 张数（批量/多图参数）。`opts.resolution` 命中逐档计价表时用精确档价。 */
export function estimateImageCost(model: string, count = 1, opts?: { resolution?: string }): CostEstimate {
  const tier = KIE_IMAGE_RES_COST[model];
  if (tier) {
    const keys = Object.keys(tier);
    const res = opts?.resolution && tier[opts.resolution] != null ? opts.resolution : keys[0];
    return { credits: tier[res] * count, unit: "点", approx: false };
  }
  const u = imageUnitCost(model);
  if (!u) return null;
  const n = Number.isFinite(count) && count > 0 ? count : 1;
  return { credits: u.credits * n, unit: u.unit, approx: u.approx };
}

// ── 音频 ─────────────────────────────────────────────────────────────────────
/** 音乐生成：Suno（Poyo 20 cr / kie 12 点）按次。MiniMax 未公布 → null。 */
export function estimateMusicCost(model: string): CostEstimate {
  if (model.startsWith("kie_")) return pt(12);
  if (/suno/i.test(model)) return cr(20);
  return null;
}

/** 配音 TTS：按字符数计费（每 1000 字符），向上取整千。本地 VoxCPM 免费。 */
export function estimateTtsCost(model: string, textLength: number): CostEstimate {
  const kChars = Math.max(1, Math.ceil((textLength || 0) / 1000));
  if (model === "kie_elevenlabs_tts") return pt(6 * kChars);
  if (model === "kie_elevenlabs_tts_ml") return pt(12 * kChars);
  if (model === "kie_elevenlabs_v3") return pt(14 * kChars);
  if (/elevenlabs/i.test(model)) return cr(16 * kChars); // Poyo ElevenLabs V3：16 cr/1k 字
  if (/voxcpm|local/i.test(model)) return cr(0);
  return null; // OpenAI TTS 按 token 计费，无固定点数
}
