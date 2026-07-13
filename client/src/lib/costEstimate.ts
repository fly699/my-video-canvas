// ---------------------------------------------------------------------------
// 实时点数消耗预估 — 单一数据源
// ---------------------------------------------------------------------------
// 依据 docs/poyo-credits-pricing.md（Poyo，单位 cr，1 cr = $0.005）与
// docs/kie-pricing.md（kie，单位 点）人工整理的计费规则；2026-07 起以
// docs/incremental-models/2026-07-round2-final.json 为最新权威价（第 150 轮全量核对），
// 按「当前所选模型 +
// 已设置参数」计算预估消耗，显示在各节点的生成按钮上，并随生成请求传给后端
// 计入管理员日志。仅供参考——实际扣费以平台账单为准；价格会随上游调整，
// 改价时同步更新这里与 models.ts 的 costLabel/costNote。
//
// 约定：
//   credits  — 数值预估（同一模型族的已知档位精确取值，范围价取中值并标 approx）
//   unit     — "cr"（Poyo）或 "点"（kie）；Higgsfield 独立计费、无法换算，返回 null
//   approx   — true 表示取近似/中值（标 ≈）
//   null     — 无法预估（模型页未公布固定价 / 本地免费除外）
import { IMAGE_MODELS, VIDEO_MODELS } from "./models";

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
  poyo_sora2_pro:          () => cr(100), // sora-2-pro 已不在 round2 文档，沿用旧价
  poyo_sora2_official:     (p) => cr(12 * num(p, "duration", 8)),
  // round2 文档：sora-2-pro-official 按秒×分辨率（720p 48 / 1024p 80 / 1080p 112 cr/s）
  poyo_sora2_pro_official: (p) => cr(({ "720p": 48, "1024p": 80, "1080p": 112 }[str(p, "resolution", "720p")] ?? 48) * num(p, "duration", 8)),
  poyo_kling21_std:   (p) => cr(6 * num(p, "duration", 5)),
  poyo_kling21_pro:   (p) => cr(11 * num(p, "duration", 5)),
  poyo_kling25_turbo: (p) => cr(8.4 * num(p, "duration", 5)),
  poyo_kling26:       (p) => cr((on(p, "sound") ? 24 : 13) * num(p, "duration", 5)),
  poyo_kling30_std:   (p) => cr((str(p, "resolution", "720p") === "1080p" ? 39 : 27) * num(p, "duration", 5)),
  poyo_kling30_pro:   (p) => cr((str(p, "resolution", "720p") === "1080p" ? 49 : 39) * num(p, "duration", 5)),
  poyo_kling16_std:      (p) => cr(9 * num(p, "duration", 5)),
  poyo_kling16_pro:      (p) => cr(15 * num(p, "duration", 5)),
  poyo_kling30turbo_std: (p) => cr(17 * num(p, "duration", 5)), // 720p
  poyo_kling30turbo_pro: (p) => cr(22 * num(p, "duration", 5)), // 1080p
  poyo_kling30_4k:    (p) => cr(50 * num(p, "duration", 5)),
  poyo_kling_o3_std:  (p) => cr((on(p, "sound") ? 13 : 10) * num(p, "duration", 5)),
  poyo_kling_o3_pro:  (p) => cr((on(p, "sound") ? 16 : 13) * num(p, "duration", 5)),
  poyo_kling_o3_4k:   (p) => cr(50 * num(p, "duration", 5)),
  poyo_wan25_t2v: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 120 : 80) * (num(p, "duration", 5) / 5) * (on(p, "multi_shots") ? 3 : 1), true),
  poyo_wan25_i2v: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 120 : 80) * (num(p, "duration", 5) / 5) * (on(p, "multi_shots") ? 3 : 1), true),
  poyo_wan27_t2v: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 18 : 12) * num(p, "duration", 5)),
  poyo_wan27_i2v: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 18 : 12) * num(p, "duration", 5)),
  poyo_wan27_ref: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 18 : 12) * num(p, "duration", 5)),
  poyo_wan22_t2v_fast: (p) => cr(str(p, "resolution", "720p") === "480p" ? 6 : 12),
  poyo_wan22_i2v_fast: (p) => cr(str(p, "resolution", "720p") === "480p" ? 6 : 12),
  poyo_seedance1_pro:  (p) => cr((str(p, "resolution", "720p") === "1080p" ? 43 : 21) * (num(p, "duration", 5) / 5)),
  // Seedance 1.5 Pro（round2 文档）：整条计价，按 分辨率×时长档(4/8/12s)，音频 ×2；已无 1080p 档。
  poyo_seedance15_pro: (p) => {
    const res = str(p, "resolution", "720p") === "480p" ? "480p" : "720p";
    const dur = num(p, "duration", 4);
    const d = dur >= 12 ? 12 : dur >= 8 ? 8 : 4;
    const base = { "480p": { 4: 9, 8: 18, 12: 21 }, "720p": { 4: 16, 8: 32, 12: 42 } }[res][d];
    return cr(base * (on(p, "generate_audio") ? 2 : 1), d !== dur);
  },
  // Seedance 2（round2 文档「无视频输入」口径——节点只送文/图）：480p 20 / 720p 40 / 1080p 90 / 4K 200 cr·s
  poyo_seedance:       (p) => cr(({ "480p": 20, "720p": 40, "1080p": 90, "4K": 200, "4k": 200 }[str(p, "resolution", "720p")] ?? 40) * num(p, "duration", 5)),
  poyo_hailuo02:     (p) => cr(7 * num(p, "duration", 6)),
  poyo_hailuo02_pro: () => cr(65),
  poyo_hailuo23:     (p) => cr(str(p, "resolution", "768p") === "1080p" ? 60 : (num(p, "duration", 6) === 6 ? 35 : 70), true),
  poyo_happy_horse:  (p) => cr((str(p, "resolution", "1080p") === "1080p" ? 32 : 16) * num(p, "duration", 5)),
  poyo_happy_horse_11: (p) => cr((str(p, "resolution", "720p") === "1080p" ? 28 : 22) * num(p, "duration", 5)),
  poyo_grok_video:   (p) => cr(num(p, "duration", 6) <= 6 ? 30 : 40),
  // Omni Flash（v2 文档）：无视频输入 720p/1080p {4:120,6:150,8:200,10:220}、4K {4:250,6:300,8:350,10:450} cr/次
  poyo_omni_flash: (p) => {
    const k4 = /4k/i.test(str(p, "resolution", "720p"));
    const d = num(p, "duration", 6);
    const tier = d >= 10 ? 10 : d >= 8 ? 8 : d >= 6 ? 6 : 4;
    const table = k4 ? { 4: 250, 6: 300, 8: 350, 10: 450 } : { 4: 120, 6: 150, 8: 200, 10: 220 };
    return cr(table[tier], true); // 视频输入(V2V)另价 300/400，估价按 T2V/I2V 口径
  },
  poyo_runway45:     (p) => cr(15 * num(p, "duration", 5)),
  // ── #151 round2 新接入模型（计价按 2026-07-round2-final.json）──
  // Grok Imagine Video 1.5：480p 14.5 / 720p 25 cr·s + 输入图 2 cr/张
  poyo_grok_video_15: (p) => cr((str(p, "resolution", "720p") === "480p" ? 14.5 : 25) * num(p, "duration", 6) + 2, true),
  // Kling Avatar 2.0：标准 7 / 专业 14 cr·s，时长随驱动音频，按 10s 估
  poyo_kling_avatar2_std: () => cr(7 * 10, true),
  poyo_kling_avatar2_pro: () => cr(14 * 10, true),
  // Seedance 2 Mini：无视频输入口径 480p 10 / 720p 24 cr·s（接参考视频时为 6/12.5）
  poyo_seedance2_mini: (p) => cr(({ "480p": 10, "720p": 24 }[str(p, "resolution", "720p")] ?? 24) * num(p, "duration", 5), true),
  // Wan 2.5：整条计价 480p 30 / 720p 60 / 1080p 90 cr·5s（t2v 按尺寸串判档）
  poyo_wan25_text: (p) => {
    const ar = str(p, "aspect_ratio", "1280*720");
    const per5s = ar.includes("1080") ? 90 : (ar.includes("480") ? 30 : 60);
    return cr(per5s * (num(p, "duration", 5) / 5));
  },
  poyo_wan25_image: (p) => cr(({ "480p": 30, "720p": 60, "1080p": 90 }[str(p, "resolution", "720p")] ?? 60) * (num(p, "duration", 5) / 5)),
  // Wan Animate：480p 7 / 580p 12 / 720p 15 cr·s，时长随源视频，按 5s 估
  poyo_wan_animate_move:    (p) => cr(({ "480p": 7, "580p": 12, "720p": 15 }[str(p, "resolution", "480p")] ?? 7) * 5, true),
  poyo_wan_animate_replace: (p) => cr(({ "480p": 7, "580p": 12, "720p": 15 }[str(p, "resolution", "480p")] ?? 7) * 5, true),
  // Veo 3.1 官方版（round2 文档 veo-3-1-official 三档：基础档→Fast、(pro)→Quality、(lite)→Lite；
  // 档位对应经官方原价交叉核对：Fast $0.10-0.15/s、Quality(pro) $0.40/s、Lite $0.03-0.05/s）。
  poyo_veo_fast_official: (p) => {
    const k4 = /4k/i.test(str(p, "resolution", "720p"));
    return cr((k4 ? (on(p, "sound") ? 35 : 30) : (on(p, "sound") ? 15 : 10)) * num(p, "duration", 8), true);
  },
  poyo_veo_quality_official: (p) => {
    const k4 = /4k/i.test(str(p, "resolution", "720p"));
    return cr((k4 ? (on(p, "sound") ? 72 : 48) : (on(p, "sound") ? 48 : 24)) * num(p, "duration", 8), true);
  },
  poyo_veo_lite_official: (p) => cr((on(p, "sound") ? 6 : 3.6) * num(p, "duration", 8), true),
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
  kie_seedance2_mini: (p) => pt(({ "480p": 9.5, "720p": 20.5 }[str(p, "resolution", "720p")] ?? 20.5) * num(p, "duration", 5), true),
  // Kling 2.1：价格表 标准 5s25/10s50（5/s）· 专业 5s50/10s100（10/s）。
  kie_kling21_std: (p) => pt(5 * num(p, "duration", 5)),
  kie_kling21_pro: (p) => pt(10 * num(p, "duration", 5)),
  kie_kling21_master_t2v: (p) => pt(32 * num(p, "duration", 5)), // 5s 160 / 10s 320
  kie_kling21_master_i2v: (p) => pt(32 * num(p, "duration", 5)),
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
  kie_happyhorse11_t2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 44 : 33) * num(p, "duration", 5)),
  kie_happyhorse11_r2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 44 : 33) * num(p, "duration", 5)),
  kie_happyhorse11_i2v: (p) => pt((str(p, "resolution", "1080p") === "1080p" ? 44 : 33) * num(p, "duration", 5)),
  // 动作控制：价格表 2.6→720p 11/1080p 18 · 3.0→720p 20/1080p 27 点·秒；时长随源视频，按 5s 估。
  kie_kling26_motion: (p) => pt((str(p, "mode", "720p") === "1080p" ? 18 : 11) * 5, true),
  kie_kling30_motion: (p) => pt((str(p, "mode", "720p") === "1080p" ? 27 : 20) * 5, true),
  // 数字人：价格表 标准 8 / 专业 16 点·秒；时长随音频，按 10s 估。
  kie_kling_avatar_std: () => pt(8 * 10, true),
  kie_kling_avatar_pro: () => pt(16 * 10, true),
  // 对口型：OmniHuman 1.5 27 / Volcengine 8 点·秒；时长随音频/源视频，按 10s 估（approx）。
  kie_omnihuman15:        () => pt(27 * 10, true),
  kie_volcengine_lipsync: () => pt(8 * 10, true),
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
  // "4 点/百万像素"（Qwen）/ "4 cr/百万像素"（#151 flux-dev/schnell）→ 按 ~1MP 估
  const perMp = note.match(/^([\d.]+)\s*(?:点|cr)\/百万像素$/);
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
  const n = Number.isFinite(count) && count > 0 ? count : 1; // clamp once for both branches
  const tier = KIE_IMAGE_RES_COST[model];
  if (tier) {
    const keys = Object.keys(tier);
    const res = opts?.resolution && tier[opts.resolution] != null ? opts.resolution : keys[0];
    return { credits: tier[res] * n, unit: "点", approx: false };
  }
  const u = imageUnitCost(model);
  if (!u) return null;
  return { credits: u.credits * n, unit: u.unit, approx: u.approx };
}

// ── 音频 ─────────────────────────────────────────────────────────────────────
/** 音乐生成：Suno（Poyo 20 cr / kie 12 点）与 MiniMax Music 2.6（round2 文档 20 cr/次）按次。 */
export function estimateMusicCost(model: string): CostEstimate {
  if (model.startsWith("kie_")) return pt(12);
  if (/suno/i.test(model)) return cr(20);
  if (model === "minimax-music-2.6") return cr(20);
  if (model === "elevenlabs-music") return cr(128, true); // #151：128 cr/分钟，按 1 分钟估
  return null;
}

/** 配音 TTS：按字符数计费（每 1000 字符），向上取整千。本地 VoxCPM 免费。 */
export function estimateTtsCost(model: string, textLength: number): CostEstimate {
  const kChars = Math.max(1, Math.ceil((textLength || 0) / 1000));
  if (model === "kie_elevenlabs_tts") return pt(6 * kChars);
  if (model === "kie_elevenlabs_tts_ml") return pt(12 * kChars);
  if (model === "kie_elevenlabs_v3") return pt(14 * kChars);
  // #151 round2 新 TTS（须在通用 elevenlabs 正则之前判定）
  if (model === "elevenlabs-tts-turbo-2-5") return cr(8 * kChars);
  if (model === "gemini-3-1-flash-tts") return cr(24 * kChars);
  if (model === "xai-tts-1") return cr(2.4 * kChars);
  if (/elevenlabs/i.test(model)) return cr(16 * kChars); // Poyo ElevenLabs V3：16 cr/1k 字
  if (/voxcpm|local/i.test(model)) return cr(0);
  return null; // OpenAI TTS 按 token 计费，无固定点数
}

// ── 画布级预算汇总 ───────────────────────────────────────────────────────────
// 把整张画布上所有「会消耗云端点数/积分」的生成节点逐个用上面的精确单价函数估算，
// 汇总成 kie 点 / Poyo cr 两路总额 + 按模型分组明细，供「预算管控面板」对照余额。
// comfyui_* 走用户自有服务器，记为本地免费；无法估价的记为 unknown。
export type CanvasBudgetLine = { key: string; label: string; unit: "点" | "cr"; count: number; credits: number };
export type CanvasBudget = {
  pt: number;            // kie 点 总额
  cr: number;            // Poyo cr 总额
  approx: boolean;       // 任一项取了近似值
  lines: CanvasBudgetLine[];
  unknownCount: number;  // 选了模型但无法估价 / 未选模型
  localCount: number;    // comfyui_*（自有服务器，免费）
  runnableCount: number; // 参与估算的生成节点总数
};
type BudgetNode = { id?: string; data: { nodeType: string; payload?: Record<string, unknown> } };
type BudgetEdge = { source: string; target: string };
// comfyui_*（自有服务器）与 subtitle（内置 Forge STT 转录）都不计 kie 点 / Poyo cr，记为本地/内置免费。
const LOCAL_BUDGET_TYPES = new Set(["comfyui_image", "comfyui_video", "comfyui_workflow", "subtitle"]);

/** 逐节点精确汇总画布预算（复用 estimateVideoCost/Image/Music/Tts）。framework-free，可单测。
 *  `resolveModel(nodeType, slot)` 用于补全「节点未显式存模型、运行时取默认模型」的情形
 *  （分镜/图像/视频任务都可能不在 payload 里存模型，而用 resolveActiveNodeModel 的默认）——
 *  传入后这些节点不再被记为「未估价」。调用方（BudgetButton/AgentNode）传 resolveActiveNodeModel。 */
export function estimateCanvasBudget(
  nodes: BudgetNode[],
  resolveModel?: (nodeType: string, slot: "llm" | "image" | "video") => string | undefined,
  edges?: BudgetEdge[],
): CanvasBudget {
  const map = new Map<string, CanvasBudgetLine>();
  let totPt = 0, totCr = 0, approx = false, unknownCount = 0, localCount = 0, runnableCount = 0;
  const vLabel = (v: string) => VIDEO_MODELS.find((m) => m.value === v)?.label ?? v;
  const iLabel = (v: string) => IMAGE_MODELS.find((m) => m.value === v)?.label ?? v;
  const add = (key: string, label: string, est: CostEstimate) => {
    if (!est) { unknownCount++; return; }
    if (est.approx) approx = true;
    if (est.unit === "点") totPt += est.credits; else totCr += est.credits;
    const ex = map.get(key);
    if (ex) { ex.count++; ex.credits += est.credits; }
    else map.set(key, { key, label, unit: est.unit, count: 1, credits: est.credits });
  };
  // 「分镜有下游 image_gen 连线」判定（与 useWorkflowRunner 的执行跳过同口径）：
  // 这类分镜是纯镜头表数据行，运行全部不会兜底生图，估价也不应把它按默认模型计价
  // ——此前正是这条把未设 imageModel 的分镜按平台默认（如 Nano Banana Pro）估出幻影成本。
  const typeById = new Map<string, string>();
  for (const n of nodes) if (n.id) typeById.set(n.id, n.data.nodeType);
  const hasDownstreamImageGen = (id: string | undefined) =>
    !!id && !!edges?.some((e) => e.source === id && typeById.get(e.target) === "image_gen");
  for (const n of nodes) {
    const t = n.data.nodeType;
    const p = (n.data.payload ?? {}) as Record<string, unknown>;
    // 「跳过执行」的节点（右键可切换）不参与运行，也不计价。
    if (p.disabled === true) continue;
    if (LOCAL_BUDGET_TYPES.has(t)) { localCount++; continue; }
    if (t === "video_task") {
      runnableCount++;
      const provider = String(p.provider ?? resolveModel?.("video_task", "video") ?? "");
      if (!provider) { unknownCount++; continue; }
      add(provider, vLabel(provider), estimateVideoCost(provider, p));
    } else if (t === "image_gen") {
      runnableCount++;
      const model = String(p.model ?? resolveModel?.("image_gen", "image") ?? "");
      if (!model) { unknownCount++; continue; }
      const count = Math.max(1, Number(p.imageN ?? p.batchSize ?? p.fluxNumImages ?? 1) || 1);
      add(model, iLabel(model), estimateImageCost(model, count, { resolution: p.imageResolution as string | undefined }));
    } else if (t === "storyboard") {
      // 分镜节点本质是「按分镜生成图像」，计价与 image_gen 同源（StoryboardNode 用 imageModel
      // 字段；hf_soul 批量 batchSize 张，其余 1 张）。此前漏算导致分镜不计入预算。
      // 智能跳过（与运行器同口径）：设了 skipAutoImage、或已有下游 image_gen 工位的分镜
      // 不会在「运行全部」时生图 → 不计价、不计 runnableCount。
      if (p.skipAutoImage === true || hasDownstreamImageGen(n.id)) continue;
      runnableCount++;
      const model = String(p.imageModel ?? p.model ?? resolveModel?.("storyboard", "image") ?? "");
      if (!model || !IMAGE_MODELS.some((m) => m.value === model)) { unknownCount++; continue; }
      const count = model === "hf_soul_standard" ? (Number(p.batchSize) === 4 ? 4 : 1) : 1;
      add(model, iLabel(model), estimateImageCost(model, count, { resolution: p.imageResolution as string | undefined }));
    } else if (t === "audio") {
      runnableCount++;
      const cat = String(p.audioCategory ?? "");
      if (cat === "music") {
        const m = String(p.musicModel ?? p.aiModel ?? "");
        if (!m) { unknownCount++; continue; }
        add(m, `配乐 ${m}`, estimateMusicCost(m));
      } else if (cat === "dubbing") {
        const m = String(p.ttsModel ?? p.aiModel ?? "");
        if (!m) { unknownCount++; continue; }
        add(m, `配音 ${m}`, estimateTtsCost(m, String(p.ttsText ?? "").length));
      } else if (cat === "sfx") {
        const secs = Math.max(0.5, Number(p.sfxDuration ?? 5) || 5);
        add("kie_sfx", "音效 SFX", pt(0.24 * secs, true)); // kie ElevenLabs SFX 0.24 点/秒
      } // upload：非生成，免费
    }
  }
  return {
    pt: Math.round(totPt * 10) / 10,
    cr: Math.round(totCr * 10) / 10,
    approx, unknownCount, localCount, runnableCount,
    lines: Array.from(map.values()).sort((a, b) => b.credits - a.credits),
  };
}
