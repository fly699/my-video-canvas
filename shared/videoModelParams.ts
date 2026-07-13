// ── 视频模型参数表（单一真源）────────────────────────────────────────────────
// 各云端视频模型（video_task 节点）的参数面板定义：键名、枚举取值、默认值、范围。
// 从 VideoTaskNode.tsx 抽取到 shared，供三方共用：
//   1. 客户端 VideoTaskNode 的参数控件渲染（原用途，经 VideoTaskNode 再导出）；
//   2. 服务端画布助手目录（agentCatalog）向 LLM 输出「每个模型支持哪些参数」清单，
//      并按模型过滤助手写入的 params 键；
//   3. 镜头表/导演台等复用（withParamDefaults 等）。
// ⚠️ 键名与取值严格对齐官方文档（docs/kie-api.md、docs/poyo-video-api.md、
// docs/incremental-models/…-with-params.json），勿凭同族模型猜参数。


// Providers that require a reference image (image-to-video)
export const REQUIRES_REFERENCE_IMAGE = new Set<string>([
  "poyo_wan25_i2v",
  "hf_dop_standard", "hf_dop_lite", "hf_dop_turbo",
  // image-to-video models that require a start frame
  "poyo_kling21_std", "poyo_kling21_pro",
  "poyo_wan27_i2v", "poyo_wan22_i2v_fast",
  // kie 第二批 i2v（需起始帧/参考图）
  "kie_kling21_std", "kie_kling21_pro", "kie_kling21_master_i2v", "kie_wan22_i2v", "kie_wan27_i2v",
  "kie_hailuo02_pro_i2v", "kie_grok_i2v", "kie_happyhorse_i2v",
  "kie_kling_v3turbo_i2v", "kie_happyhorse11_r2v", "kie_happyhorse11_i2v",
  // kie 第三批（图 + 视频/音频，至少需要图片）
  "kie_kling26_motion", "kie_kling30_motion", "kie_kling_avatar_std", "kie_kling_avatar_pro",
  "kie_omnihuman15",  // 数字人：图 + 驱动音频

  "kie_wan_animate_move", "kie_wan_animate_replace",
]);

export type ParamDef =
  | { type: "select"; key: string; label: string; options: { value: string | number; label: string }[]; default?: string | number }
  | { type: "number"; key: string; label: string; min: number; max: number; step: number; default?: number }
  | { type: "range";  key: string; label: string; min: number; max: number; step: number; default?: number; unit?: string }
  | { type: "toggle"; key: string; label: string; default?: boolean };

const HF_CAMERA_MOTION_OPTIONS = [
  { value: "none",       label: "无镜头运动" },
  { value: "zoom_in",    label: "推镜（Zoom In）" },
  { value: "zoom_out",   label: "拉镜（Zoom Out）" },
  { value: "pan_left",   label: "左移（Pan Left）" },
  { value: "pan_right",  label: "右移（Pan Right）" },
  { value: "tilt_up",    label: "上倾（Tilt Up）" },
  { value: "tilt_down",  label: "下倾（Tilt Down）" },
  { value: "orbit",      label: "环绕（Orbit）" },
  { value: "static",     label: "固定（Static）" },
];

const HF_DOP_STANDARD_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 4,
    options: [{ value: 4, label: "4 秒" }, { value: 8, label: "8 秒" }] },
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
  { type: "select", key: "camera_motion_type", label: "镜头运动", default: "none",
    options: HF_CAMERA_MOTION_OPTIONS },
  { type: "select", key: "camera_motion_speed", label: "运动速度", default: "normal",
    options: [{ value: "slow", label: "慢速" }, { value: "normal", label: "正常" }, { value: "fast", label: "快速" }] },
  { type: "toggle", key: "enhance_prompt", label: "AI 增强提示词", default: false },
  { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
];

const HF_DOP_FAST_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 4,
    options: [{ value: 4, label: "4 秒" }] },
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }] },
  { type: "select", key: "camera_motion_type", label: "镜头运动", default: "none",
    options: HF_CAMERA_MOTION_OPTIONS },
  { type: "select", key: "camera_motion_speed", label: "运动速度", default: "normal",
    options: [{ value: "slow", label: "慢速" }, { value: "normal", label: "正常" }, { value: "fast", label: "快速" }] },
  { type: "toggle", key: "enhance_prompt", label: "AI 增强提示词", default: false },
  { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
];

const KLING_O3_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
    options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
  // Kling o3 requires `sound`; Poyo 400s ("sound is required") if it's omitted.
  // Default off (no audio, no extra cost). The server also injects sound:false as
  // a fallback (poyoVideo.VIDEO_PARAM_DEFAULTS), so this toggle just surfaces the
  // choice in the UI — turn it on to let the model generate native audio.
  { type: "toggle", key: "sound", label: "原生音频", default: false },
  { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
];

export const SUPPORTS_NEGATIVE_PROMPT = new Set<string>([
  // negative_prompt is documented (docs/poyo-video-api.md) for Kling 2.1 /
  // 2.5-turbo-pro / Wan 2.5; NOT for Seedance — so seedance models are excluded.
  // （poyo_seedance→wire seedance-2，其文档与 PROVIDER_ALLOWED_PARAMS 均无 negative_prompt，
  //  故不列入——此前误含 poyo_seedance 与本注释自相矛盾，会向 Poyo 发它不认的 negative_prompt。）
  "poyo_kling_o3_std", "poyo_kling_o3_pro", "poyo_kling_o3_4k",
  "poyo_kling21_std", "poyo_kling21_pro", "poyo_kling25_turbo",
  // kie: Kling 2.5 Turbo + Wan 2.5 document negative_prompt.
  "kie_kling25turbo_t2v", "kie_kling25turbo_i2v", "kie_wan25_t2v", "kie_wan25_i2v",
  "kie_kling21_std", "kie_kling21_pro", "kie_kling21_master_t2v", "kie_kling21_master_i2v",
  // #112 复核：poyo kling-1.6 的 with-params 文档含 negative_prompt（3.0-turbo 没有）。
  "poyo_kling16_std", "poyo_kling16_pro",
]);

// ── Reusable param sets for the expanded model catalog ──
const AR_3 = [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }];
const AR_2 = [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }];
// Happy Horse（1.0/1.1）与 kie happyhorse-1-1 t2v/r2v 的完整 9 值画幅枚举（with-params 文档）
const AR_HH9 = [
  { value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" },
  { value: "4:3", label: "4:3" }, { value: "3:4", label: "3:4" }, { value: "4:5", label: "4:5" },
  { value: "5:4", label: "5:4" }, { value: "21:9", label: "21:9 超宽" }, { value: "9:21", label: "9:21 超高" },
];
const DUR_5_10 = [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }];
const DUR_6_10 = [{ value: 6, label: "6 秒" }, { value: 10, label: "10 秒" }];
const seedDef: ParamDef = { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 };

// Sora official: duration 4-20 (step 4), aspect 16:9/9:16
const SORA_OFFICIAL_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 4,
    options: [4, 8, 12, 16, 20].map((v) => ({ value: v, label: `${v} 秒` })) },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
];
// Sora 2 / Pro (non-official): duration choices + style + storyboard
const SORA_STYLE_OPTS = ["thanksgiving", "comic", "news", "selfie", "nostalgic", "anime"].map((v) => ({ value: v, label: v }));
const SORA2_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 10,
    options: [{ value: 10, label: "10 秒" }, { value: 15, label: "15 秒" }] },
  { type: "select", key: "style", label: "风格（可选）", default: "", options: [{ value: "", label: "默认" }, ...SORA_STYLE_OPTS] },
  { type: "toggle", key: "storyboard", label: "故事板模式", default: false },
];
const SORA2_PRO_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 15,
    options: [{ value: 15, label: "15 秒" }, { value: 25, label: "25 秒（HD）" }] },
  { type: "select", key: "style", label: "风格（可选）", default: "", options: [{ value: "", label: "默认" }, ...SORA_STYLE_OPTS] },
  { type: "toggle", key: "storyboard", label: "故事板模式", default: false },
];
// Veo 3.1 tiers: fixed 8s, aspect 16:9/9:16, resolution 720p/1080p/4k, generation_type
const VEO_RES_4K = [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }, { value: "4k", label: "4K" }];
const VEO_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
  { type: "select", key: "duration", label: "时长（秒）", default: 8, options: [{ value: 8, label: "8 秒（固定）" }] },
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: VEO_RES_4K },
  { type: "select", key: "generation_type", label: "生成模式", default: "reference",
    options: [{ value: "reference", label: "参考图风格" }, { value: "frame", label: "首尾帧" }] },
];
const VEO_LITE_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
  { type: "select", key: "duration", label: "时长（秒）", default: 8, options: [{ value: 8, label: "8 秒（固定）" }] },
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
];
// veo3.1-quality 不支持 reference 生成模式(docs/poyo-video-api.md:70)，只做首尾帧/图生；
// 故不暴露 generation_type 控件，由服务端按图数自动判定(2 图=frame)，避免发非法 reference。
const VEO_QUALITY_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
  { type: "select", key: "duration", label: "时长（秒）", default: 8, options: [{ value: 8, label: "8 秒（固定）" }] },
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: VEO_RES_4K },
];
// Veo 3.1 官方版（docs/poyo-video-api.md:74-85）：可变时长 4/6/8s + sound；fast/quality 支持
// reference(3 图)，lite-official 最多 2 图、不支持 reference 与 4k。
const VEO_OFFICIAL_DUR = [{ value: 4, label: "4 秒" }, { value: 6, label: "6 秒" }, { value: 8, label: "8 秒" }];
const VEO_OFFICIAL_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: VEO_RES_4K },
  { type: "select", key: "generation_type", label: "生成模式", default: "reference",
    options: [{ value: "reference", label: "参考图风格" }, { value: "frame", label: "首尾帧" }] },
  { type: "select", key: "duration", label: "时长（秒）", default: 8, options: VEO_OFFICIAL_DUR },
  { type: "toggle", key: "sound", label: "生成音频", default: true },
];
const VEO_OFFICIAL_LITE_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
  { type: "select", key: "duration", label: "时长（秒）", default: 8, options: VEO_OFFICIAL_DUR },
  { type: "toggle", key: "sound", label: "生成音频", default: true },
];
// Kling 2.1 (I2V): duration 5/10
const KLING21_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
];
const KLING25_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
];
// Kling 3.0: aspect 1:1/16:9/9:16, duration 3-15, sound
const KLING30_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
  { type: "toggle", key: "sound", label: "原生音频", default: false },
  seedDef,
];
// Kling 1.6（增量新模型；with-params 文档：duration enum 5/10、aspect 3 值、cfg_scale 0-1）
const KLING16_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "range", key: "cfg_scale", label: "灵活度 cfg", min: 0, max: 1, step: 0.1, default: 0.5 },
];
// Kling 3.0 Turbo（#112 复核修正：文档 duration 为 3-15 整数（非 5/10 枚举）、
// 无 cfg_scale/negative_prompt——之前误与 Kling 1.6 共用参数集）
const KLING30TURBO_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
];
// Omni Flash（增量；resolution 720p/1080p/4k，duration 4/6/8/10，aspect 16:9/9:16）
const OMNI_FLASH_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: VEO_RES_4K },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }] },
  { type: "select", key: "duration", label: "时长（秒，连源视频时忽略）", default: 6, options: [{ value: 4, label: "4 秒" }, { value: 6, label: "6 秒" }, { value: 8, label: "8 秒" }, { value: 10, label: "10 秒" }] },
];
// Wan 2.7
const WAN_RES = [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }];
const WAN27_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: WAN_RES },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
    options: [...AR_3, { value: "4:3", label: "4:3 标准" }, { value: "3:4", label: "3:4 竖屏" }] },
  { type: "select", key: "duration", label: "时长（秒）", default: 5,
    options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }, { value: 15, label: "15 秒" }] },
  seedDef,
];
const WAN27_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: WAN_RES },
  { type: "range", key: "duration", label: "时长（秒）", min: 2, max: 15, step: 1, default: 5, unit: "s" },
  { type: "toggle", key: "multi_shots", label: "多镜头模式", default: false },
  seedDef,
];
// Wan 2.7 参考生视频：reference_image_urls + reference_video_urls 多模态参考，duration 2-10
const WAN27_REF_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: WAN_RES },
  { type: "range", key: "duration", label: "时长（秒）", min: 2, max: 10, step: 1, default: 5, unit: "s" },
  seedDef,
];
const WAN22_FAST_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }] },
  seedDef,
];
const WAN22_I2V_FAST_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }] },
  seedDef,
];
// Seedance 1.x
const SEEDANCE1_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: WAN_RES },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  seedDef,
];
const SEEDANCE15_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 12, step: 1, default: 5, unit: "s" },
  { type: "toggle", key: "camera_fixed", label: "固定镜头", default: false },
  { type: "toggle", key: "generate_audio", label: "AI 生成音频", default: false },
  seedDef,
];
// Hailuo
const HAILUO02_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "768p",
    options: [{ value: "512p", label: "512P" }, { value: "768p", label: "768P" }] },
  { type: "select", key: "duration", label: "时长（秒）", default: 6, options: DUR_6_10 },
];
const HAILUO02_PRO_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: [{ value: "1080p", label: "1080P" }] },
  { type: "select", key: "duration", label: "时长（秒）", default: 6, options: [{ value: 6, label: "6 秒" }] },
];
const HAILUO23_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "768p",
    options: [{ value: "768p", label: "768P" }, { value: "1080p", label: "1080P（仅6s）" }] },
  { type: "select", key: "duration", label: "时长（秒）", default: 6, options: DUR_6_10 },
  { type: "toggle", key: "prompt_optimizer", label: "提示词优化", default: false },
];
const HAPPY_HORSE_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: WAN_RES },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_HH9 },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
  seedDef,
];
const GROK_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
    options: [{ value: "1:1", label: "1:1" }, { value: "2:3", label: "2:3" }, { value: "3:2", label: "3:2" }, ...AR_2] },
  { type: "select", key: "duration", label: "时长（秒）", default: 6, options: DUR_6_10 },
  { type: "select", key: "style", label: "风格", default: "normal",
    options: [{ value: "fun", label: "fun" }, { value: "normal", label: "normal" }, { value: "spicy", label: "spicy" }] },
];

// ── kie.ai video param controls (keys = verbatim kie input fields; see
// server/_core/kieVideo.ts + docs/kie-api.md). Duration sent as a number and
// coerced to the doc's string enum server-side; Veo uses camelCase aspectRatio. ──
const KIE_RES_WAN = [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }];
const KIE_RES_HAILUO = [{ value: "768P", label: "768P" }, { value: "1080P", label: "1080P" }];
const KIE_RES_SEEDANCE = [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }];
// fast/mini 仅 480p/720p（无 1080p；schema 严格）
const KIE_RES_SEEDANCE_FAST = [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }];
const KIE_DUR_5_10_15 = [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }, { value: 15, label: "15 秒" }];
const KIE_AR_SEEDANCE = [
  { value: "21:9", label: "21:9 超宽" }, { value: "16:9", label: "16:9 横屏" }, { value: "4:3", label: "4:3 标准" },
  { value: "1:1", label: "1:1 方形" }, { value: "3:4", label: "3:4 竖屏" }, { value: "9:16", label: "9:16 竖屏" },
];
// Veo 端点请求体字段是 aspect_ratio（下划线，docs/kie-api.md veo quickstart）；
// 与服务端 spec 一致，否则比例参数会落到服务端 allow-list 之外被丢弃。
const KIE_VEO_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
];
const KIE_KLING26_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "toggle", key: "sound", label: "原生音频（有声 2x 计费）", default: false },
];
const KIE_KLING26_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "toggle", key: "sound", label: "原生音频（有声 2x 计费）", default: false },
];
const KIE_KLING30_PARAMS: ParamDef[] = [
  { type: "select", key: "mode", label: "画质档", default: "pro",
    options: [{ value: "std", label: "标准" }, { value: "pro", label: "Pro 1080p" }, { value: "4K", label: "4K" }] },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
  { type: "toggle", key: "sound", label: "原生音频", default: false },
];
const KIE_KLING25T_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "range", key: "cfg_scale", label: "提示词贴合度", min: 0, max: 1, step: 0.1, default: 0.5 },
];
const KIE_KLING25T_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "range", key: "cfg_scale", label: "提示词贴合度", min: 0, max: 1, step: 0.1, default: 0.5 },
];
const KIE_WAN25_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: KIE_RES_WAN },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "toggle", key: "enable_prompt_expansion", label: "提示词扩写", default: false },
  seedDef,
];
const KIE_WAN25_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: KIE_RES_WAN },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "toggle", key: "enable_prompt_expansion", label: "提示词扩写", default: false },
  seedDef,
];
const KIE_WAN26_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: KIE_RES_WAN },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: KIE_DUR_5_10_15 },
];
const KIE_HAILUO23_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "768P", options: KIE_RES_HAILUO },
  { type: "select", key: "duration", label: "时长（秒）", default: 6, options: DUR_6_10 },
];
// seedance-2 官方 input schema 无 seed 字段（docs/kie-api.md），故不提供随机种子控件。
const KIE_SEEDANCE2_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: KIE_RES_SEEDANCE },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: KIE_AR_SEEDANCE },
  { type: "range", key: "duration", label: "时长（秒）", min: 4, max: 15, step: 1, default: 5, unit: "s" },
  { type: "toggle", key: "generate_audio", label: "AI 生成音频", default: true },
];
// seedance-2-fast / -mini：分辨率仅 480p/720p（schema 严格，无 1080p）
const KIE_SEEDANCE2_FAST_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: KIE_RES_SEEDANCE_FAST },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: KIE_AR_SEEDANCE },
  { type: "range", key: "duration", label: "时长（秒）", min: 4, max: 15, step: 1, default: 5, unit: "s" },
  { type: "toggle", key: "generate_audio", label: "AI 生成音频", default: true },
];
// ── kie 视频 第二批扩充的参数控件 ──
const KIE_RES_WAN22 = [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }];
const RES_GROK = [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }];
const AR_GROK = [{ value: "2:3", label: "2:3 竖" }, { value: "3:2", label: "3:2 横" }, { value: "1:1", label: "1:1 方" }, { value: "16:9", label: "16:9 横" }, { value: "9:16", label: "9:16 竖" }];
const MODE_GROK = [{ value: "normal", label: "标准" }, { value: "fun", label: "趣味" }, { value: "spicy", label: "大胆" }];
const AR_5 = [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }, { value: "4:3", label: "4:3" }, { value: "3:4", label: "3:4" }];
const cfgDef: ParamDef = { type: "range", key: "cfg_scale", label: "灵活度 cfg", min: 0, max: 1, step: 0.1, default: 0.5 };
const KIE_KLING21_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 }, cfgDef,
];
const KIE_KLING_MASTER_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 }, cfgDef,
];
// Kling V3 Turbo（增量；参数严格按 with-params 文档：无 cfg/negative_prompt，带 resolution）
const KIE_KLING_V3TURBO_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_3 },
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: KIE_RES_WAN },
];
const KIE_KLING_V3TURBO_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: KIE_RES_WAN },
];
// HappyHorse 1.1（增量；文档无 seed 字段；#112 复核：画幅按文档补全 9 值）
const KIE_HAPPYHORSE11_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: KIE_RES_WAN },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_HH9 },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
];
// HappyHorse 1.1 图生视频：无 aspect_ratio（schema 严格）
const KIE_HAPPYHORSE11_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: KIE_RES_WAN },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
];
// OmniHuman 1.5 数字人（output_resolution 枚举 "720"/"1080"，非 720p）
const KIE_OMNIHUMAN_PARAMS: ParamDef[] = [
  { type: "select", key: "output_resolution", label: "分辨率", default: "1080", options: [{ value: "720", label: "720P" }, { value: "1080", label: "1080P" }] },
  { type: "toggle", key: "pe_fast_mode", label: "快速模式（降质提速）", default: false },
];
// Volcengine 视频对口型（mode 必填 lite/basic）
const KIE_VOLCENGINE_PARAMS: ParamDef[] = [
  { type: "select", key: "mode", label: "模式", default: "lite", options: [{ value: "lite", label: "Lite（单人正面·快）" }, { value: "basic", label: "Basic（复杂场景）" }] },
  { type: "toggle", key: "separate_vocal", label: "人声分离去噪", default: false },
  { type: "toggle", key: "open_scenedet", label: "场景分割/说话人识别（Basic）", default: false },
];
const KIE_WAN22_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: KIE_RES_WAN22 },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_2 },
  { type: "toggle", key: "enable_prompt_expansion", label: "提示词扩写", default: false }, seedDef,
];
const KIE_WAN22_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "720p", options: KIE_RES_WAN22 },
  { type: "toggle", key: "enable_prompt_expansion", label: "提示词扩写", default: false }, seedDef,
];
const KIE_WAN27_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: KIE_RES_WAN },
  { type: "select", key: "ratio", label: "宽高比", default: "16:9", options: AR_5 },
  { type: "range", key: "duration", label: "时长（秒）", min: 2, max: 15, step: 1, default: 5, unit: "s" },
  { type: "toggle", key: "prompt_extend", label: "提示词扩写", default: true }, seedDef,
];
const KIE_WAN27_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: KIE_RES_WAN },
  { type: "range", key: "duration", label: "时长（秒）", min: 2, max: 15, step: 1, default: 5, unit: "s" },
  { type: "toggle", key: "prompt_extend", label: "提示词扩写", default: true }, seedDef,
];
const KIE_HAILUO02_STD_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 6, options: DUR_6_10 },
  { type: "toggle", key: "prompt_optimizer", label: "提示词优化", default: true },
];
const KIE_HAILUO02_PRO_PARAMS: ParamDef[] = [
  { type: "toggle", key: "prompt_optimizer", label: "提示词优化", default: true },
];
const KIE_GROK_T2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "480p", options: RES_GROK },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_GROK },
  { type: "select", key: "mode", label: "风格", default: "normal", options: MODE_GROK },
  { type: "range", key: "duration", label: "时长（秒）", min: 6, max: 30, step: 1, default: 6, unit: "s" },
];
const KIE_GROK_I2V_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "480p", options: RES_GROK },
  { type: "select", key: "mode", label: "风格", default: "normal", options: MODE_GROK },
  { type: "range", key: "duration", label: "时长（秒）", min: 6, max: 30, step: 1, default: 6, unit: "s" },
];
const KIE_HAPPYHORSE_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "1080p", options: KIE_RES_WAN },
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9", options: AR_5 },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" }, seedDef,
];
// 第三批：动作控制 / Animate
const MODE_720_1080 = [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }];
const ORIENT_OPTS = [{ value: "video", label: "跟随源视频" }, { value: "image", label: "跟随图片" }];
const KIE_KLING26_MOTION_PARAMS: ParamDef[] = [
  { type: "select", key: "mode", label: "分辨率", default: "720p", options: MODE_720_1080 },
  { type: "select", key: "character_orientation", label: "朝向", default: "video", options: ORIENT_OPTS },
];
const KIE_KLING30_MOTION_PARAMS: ParamDef[] = [
  { type: "select", key: "mode", label: "分辨率", default: "720p", options: MODE_720_1080 },
  { type: "select", key: "character_orientation", label: "朝向", default: "video", options: ORIENT_OPTS },
  { type: "select", key: "background_source", label: "背景来源", default: "input_video", options: [{ value: "input_video", label: "源视频" }, { value: "input_image", label: "图片" }] },
];
const KIE_WAN_ANIMATE_PARAMS: ParamDef[] = [
  { type: "select", key: "resolution", label: "分辨率", default: "480p", options: [{ value: "480p", label: "480p" }, { value: "580p", label: "580p" }, { value: "720p", label: "720p" }] },
];
const KIE_RUNWAY_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 5, options: DUR_5_10 },
  { type: "select", key: "quality", label: "画质", default: "720p", options: MODE_720_1080 },
  { type: "select", key: "aspectRatio", label: "宽高比", default: "16:9", options: AR_5 },
];
const KIE_TOPAZ_PARAMS: ParamDef[] = [
  { type: "select", key: "upscale_factor", label: "放大倍数", default: "2", options: [{ value: "1", label: "1x" }, { value: "2", label: "2x" }, { value: "4", label: "4x" }] },
];
const AR_ALEPH = [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }, { value: "4:3", label: "4:3" }, { value: "3:4", label: "3:4" }, { value: "21:9", label: "21:9 超宽" }];
const KIE_ALEPH_PARAMS: ParamDef[] = [
  { type: "select", key: "aspectRatio", label: "宽高比", default: "16:9", options: AR_ALEPH }, seedDef,
];

export const PROVIDER_PARAMS: Record<string, ParamDef[]> = {
  poyo_seedance: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [
        { value: "21:9", label: "21:9 超宽" }, { value: "16:9", label: "16:9 横屏" },
        { value: "4:3", label: "4:3 标准" }, { value: "1:1", label: "1:1 方形" },
        { value: "3:4", label: "3:4 竖屏" }, { value: "9:16", label: "9:16 竖屏" },
      ]},
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { type: "range",  key: "duration", label: "时长（秒）", min: 4, max: 15, step: 1, default: 5, unit: "s" },
    { type: "toggle", key: "camera_fixed", label: "固定镜头", default: false },
    { type: "toggle", key: "generate_audio", label: "AI 生成音频", default: false },
    { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
  ],
  poyo_veo: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }] },
    // Veo 3.1 only supports fixed 8-second duration per API docs
    { type: "select", key: "duration", label: "时长（秒）", default: 8,
      options: [{ value: 8, label: "8 秒（固定）" }] },
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }, { value: "4k", label: "4K" }] },
    { type: "select", key: "generation_type", label: "生成模式", default: "reference",
      options: [{ value: "reference", label: "参考图风格" }, { value: "frame", label: "首帧约束" }] },
  ],
  hf_dop_standard: HF_DOP_STANDARD_PARAMS,
  hf_dop_lite:     HF_DOP_FAST_PARAMS,
  hf_dop_turbo:    HF_DOP_FAST_PARAMS,
  poyo_kling26: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }] },
    { type: "toggle", key: "sound", label: "AI 生成音效", default: false },
  ],
  poyo_kling_o3_std: KLING_O3_PARAMS,
  poyo_kling_o3_pro: KLING_O3_PARAMS,
  poyo_kling_o3_4k:  KLING_O3_PARAMS,
  poyo_wan25_t2v: [
    // Wan 2.6 API does not document aspect_ratio; resolution and multi_shots replace it
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }, { value: 15, label: "15 秒" }] },
    // ⚠️ multi_shots: true causes Poyo to generate 3 separate video shots and
    // bills each separately (~3x credit cost). Default off; label spells this
    // out so users can't enable it without seeing the cost.
    { type: "toggle", key: "multi_shots", label: "多镜头模式（⚠ 生成 3 段，3x 计费）", default: false },
  ],
  poyo_wan25_i2v: [
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }, { value: 15, label: "15 秒" }] },
    { type: "toggle", key: "multi_shots", label: "多镜头模式（⚠ 生成 3 段，3x 计费）", default: false },
  ],
  poyo_runway45: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }] },
    { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
  ],
  // ── new catalog ──
  poyo_sora2: SORA2_PARAMS,
  poyo_sora2_pro: SORA2_PRO_PARAMS,
  poyo_sora2_official: SORA_OFFICIAL_PARAMS,
  poyo_sora2_pro_official: [
    ...SORA_OFFICIAL_PARAMS,
    { type: "select", key: "resolution", label: "分辨率", default: "1024p",
      options: [{ value: "720p", label: "720p" }, { value: "1024p", label: "1024p" }, { value: "1080p", label: "1080p" }] },
  ],
  poyo_veo_fast: VEO_PARAMS,
  poyo_veo_quality: VEO_QUALITY_PARAMS,
  poyo_veo_lite: VEO_LITE_PARAMS,
  poyo_veo_fast_official: VEO_OFFICIAL_PARAMS,
  poyo_veo_quality_official: VEO_OFFICIAL_PARAMS,
  poyo_veo_lite_official: VEO_OFFICIAL_LITE_PARAMS,
  poyo_kling21_std: KLING21_PARAMS,
  poyo_kling21_pro: KLING21_PARAMS,
  poyo_kling25_turbo: KLING25_PARAMS,
  poyo_kling30_std: KLING30_PARAMS,
  poyo_kling30_pro: KLING30_PARAMS,
  poyo_kling30_4k: KLING30_PARAMS,
  poyo_kling16_std: KLING16_PARAMS,
  poyo_kling16_pro: KLING16_PARAMS,
  poyo_kling30turbo_std: KLING30TURBO_PARAMS,
  poyo_kling30turbo_pro: KLING30TURBO_PARAMS,
  poyo_wan27_t2v: WAN27_T2V_PARAMS,
  poyo_wan27_i2v: WAN27_I2V_PARAMS,
  poyo_wan27_ref: WAN27_REF_PARAMS,
  poyo_wan22_t2v_fast: WAN22_FAST_PARAMS,
  poyo_wan22_i2v_fast: WAN22_I2V_FAST_PARAMS,
  poyo_seedance1_pro: SEEDANCE1_PARAMS,
  poyo_seedance15_pro: SEEDANCE15_PARAMS,
  poyo_seedance2_fast: [
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }] },
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [
        { value: "21:9", label: "21:9 超宽" }, { value: "16:9", label: "16:9 横屏" },
        { value: "4:3", label: "4:3 标准" }, { value: "1:1", label: "1:1 方形" },
        { value: "3:4", label: "3:4 竖屏" }, { value: "9:16", label: "9:16 竖屏" },
      ]},
    { type: "range", key: "duration", label: "时长（秒）", min: 4, max: 15, step: 1, default: 5, unit: "s" },
    { type: "toggle", key: "generate_audio", label: "AI 生成音频", default: false },
    seedDef,
  ],
  poyo_hailuo02: HAILUO02_PARAMS,
  poyo_hailuo02_pro: HAILUO02_PRO_PARAMS,
  poyo_hailuo23: HAILUO23_PARAMS,
  poyo_happy_horse: HAPPY_HORSE_PARAMS,
  poyo_happy_horse_11: HAPPY_HORSE_PARAMS,
  poyo_omni_flash: OMNI_FLASH_PARAMS,
  poyo_grok_video: GROK_PARAMS,
  // ── kie.ai video ──
  kie_veo31_quality: KIE_VEO_PARAMS,
  kie_veo31_fast: KIE_VEO_PARAMS,
  kie_kling26_t2v: KIE_KLING26_T2V_PARAMS,
  kie_kling26_i2v: KIE_KLING26_I2V_PARAMS,
  kie_kling30: KIE_KLING30_PARAMS,
  kie_kling25turbo_t2v: KIE_KLING25T_T2V_PARAMS,
  kie_kling25turbo_i2v: KIE_KLING25T_I2V_PARAMS,
  kie_wan25_t2v: KIE_WAN25_T2V_PARAMS,
  kie_wan25_i2v: KIE_WAN25_I2V_PARAMS,
  kie_wan26_t2v: KIE_WAN26_PARAMS,
  kie_wan26_i2v: KIE_WAN26_PARAMS,
  kie_hailuo23_pro: KIE_HAILUO23_PARAMS,
  kie_hailuo23_std: KIE_HAILUO23_PARAMS,
  kie_seedance2: KIE_SEEDANCE2_PARAMS,
  kie_seedance2_fast: KIE_SEEDANCE2_FAST_PARAMS,
  kie_seedance2_mini: KIE_SEEDANCE2_FAST_PARAMS,
  kie_kling_v3turbo_t2v: KIE_KLING_V3TURBO_T2V_PARAMS,
  kie_kling_v3turbo_i2v: KIE_KLING_V3TURBO_I2V_PARAMS,
  // ── kie 视频 第二批 ──
  kie_kling21_std: KIE_KLING21_PARAMS,
  kie_kling21_pro: KIE_KLING21_PARAMS,
  kie_kling21_master_t2v: KIE_KLING_MASTER_T2V_PARAMS,
  kie_kling21_master_i2v: KIE_KLING21_PARAMS,
  kie_wan22_t2v: KIE_WAN22_T2V_PARAMS,
  kie_wan22_i2v: KIE_WAN22_I2V_PARAMS,
  kie_wan27_t2v: KIE_WAN27_T2V_PARAMS,
  kie_wan27_i2v: KIE_WAN27_I2V_PARAMS,
  kie_hailuo02_std: KIE_HAILUO02_STD_PARAMS,
  kie_hailuo02_pro_t2v: KIE_HAILUO02_PRO_PARAMS,
  kie_hailuo02_pro_i2v: KIE_HAILUO02_PRO_PARAMS,
  kie_grok_t2v: KIE_GROK_T2V_PARAMS,
  kie_grok_i2v: KIE_GROK_I2V_PARAMS,
  kie_happyhorse_t2v: KIE_HAPPYHORSE_PARAMS,
  kie_happyhorse_i2v: KIE_HAPPYHORSE_PARAMS,
  kie_happyhorse11_t2v: KIE_HAPPYHORSE11_PARAMS,
  kie_happyhorse11_r2v: KIE_HAPPYHORSE11_PARAMS,
  kie_happyhorse11_i2v: KIE_HAPPYHORSE11_I2V_PARAMS,
  kie_omnihuman15: KIE_OMNIHUMAN_PARAMS,
  kie_volcengine_lipsync: KIE_VOLCENGINE_PARAMS,
  kie_kling26_motion: KIE_KLING26_MOTION_PARAMS,
  kie_kling30_motion: KIE_KLING30_MOTION_PARAMS,
  kie_kling_avatar_std: [],
  kie_kling_avatar_pro: [],
  kie_wan_animate_move: KIE_WAN_ANIMATE_PARAMS,
  kie_wan_animate_replace: KIE_WAN_ANIMATE_PARAMS,
  kie_runway45: KIE_RUNWAY_PARAMS,
  kie_topaz_upscale: KIE_TOPAZ_PARAMS,
  kie_runway_aleph: KIE_ALEPH_PARAMS,
  mock: [],
};

// Merge a provider's ParamDef defaults into the params actually submitted.
// The param controls only DISPLAY `def.default`; they don't persist it until
// the user touches the control. The backend builder copies only keys present
// in `params`, and several models require fields (Seedance resolution+
// aspect_ratio, Kling 2.6 sound, etc.). Without this, a fresh node the user
// never expanded would submit prompt-only and the upstream call would fail.
export function withParamDefaults(provider: string, params: Record<string, unknown> | undefined): Record<string, unknown> {
  const defs = PROVIDER_PARAMS[provider] ?? [];
  const merged: Record<string, unknown> = { ...(params ?? {}) };
  for (const def of defs) {
    if (def.default === undefined) continue;            // number/optional fields (e.g. seed) have no default
    if (merged[def.key] === undefined || merged[def.key] === "") merged[def.key] = def.default;
  }
  return merged;
}
