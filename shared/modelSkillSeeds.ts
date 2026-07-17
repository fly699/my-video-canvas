/**
 * #203 模型技能库——代码内置种子（首批，全部依官方文档整理，逐条标注来源；禁止凭空杜撰）。
 *
 * 定位：独立的「全能模型技能库」。本文件只是种子兜底；线上以 DB（管理后台「模型技能库」
 * 面板）为准——同 modelId 的 DB 行覆盖种子（server/_core/modelSkills.ts 合并）。
 * 本批不接任何智能体；后续由各调用方（画布助手/扩写工具等）按需读取，另行规划。
 *
 * modelId 对齐 shared/modelCatalog.ts 的 value（图像/视频）与音乐管线的 model id（suno-*）。
 */

export type ModelSkillKind = "image" | "video" | "audio" | "music" | "llm" | "other";

export interface ModelSkillSeed {
  modelId: string;
  kind: ModelSkillKind;
  /** 提示词技法正文（多行）。写给「为该模型撰写提示词的 LLM/用户」看。 */
  tips: string;
  /** 来源（官方文档位置），维护溯源用。 */
  source: string;
}

// ── 家族级共享文案（同族多个 wire id 共用一段技法） ────────────────────────────

const GPT_IMAGE_TIPS = [
  "描述清楚主体与场景，再叠加细节。",
  "显式指定艺术风格（如 photorealistic / cartoon / watercolor / impressionist / digital art）。",
  "补充色彩、光线与构图要求；加入情绪与氛围元素。",
  "避免过度复杂或自相矛盾的描述。",
].join("\n");
const GPT_IMAGE_SRC = "docs/kie-api.md · 4o Image API「Prompt Tips」与「Best Practices › Prompt Optimization」";

const GROK_IMAGE_TIPS = [
  "提示词建议用英文（官方注明 Supports English language prompts）。",
  "高对比风格见长；每次固定返回一组约 6 张候选，提示词写单一明确主体更利于挑选。",
].join("\n");
const GROK_IMAGE_SRC = "docs/kie-api.md · Grok Imagine Text to Image（prompt 字段说明）+ shared/modelCatalog 能力标注";

const GROK_VIDEO_TIPS = [
  "提示词建议用英文（Grok Imagine 系官方注明支持英文提示词）。",
  "时长 6-30 秒可选：短时长写单动作，长时长按时间顺序描述动作串。",
  "图生视频（i2v）以参考图定画面，提示词专注写「动起来的部分」：动作、镜头移动、氛围变化。",
].join("\n");
const GROK_VIDEO_SRC = "docs/kie-api.md · Grok Imagine Text/Image to Video（prompt/时长字段说明）";

const RUNWAY_TIPS = [
  "以动作为中心而非静态描述：写具体动作与运动（如 walking slowly / spinning quickly）。",
  "加入时间推进词（gradually / suddenly / slowly）。",
  "指明机位与镜头（close-up / wide shot / tracking shot；zooming in / panning left）。",
  "加视觉风格词（cinematic / animated / realistic）与光线氛围（golden hour lighting / dramatic shadows）。",
].join("\n");
const RUNWAY_SRC = "docs/kie-api.md · Runway API「Tips for better prompts」与「Best Practices › Video Prompt Engineering」";

const KLING_TIPS = [
  "写具体且描述性的提示词：包含运动、机位角度与场景构成。",
  "参考图/元素要与目标视频的风格主题一致，用高质量素材。",
  "多镜头时规划每个镜头时长，使其匹配总时长。",
  "快速迭代用 std 档，最终成片再用高质量档；动作/动态场景开音效更沉浸。",
].join("\n");
const KLING_SRC = "docs/kie-api.md · Kling「Best Practices」（Prompt Writing / Element Usage / Duration Planning / Mode Selection / Sound Effects）";

const VEO_TIPS = [
  "提示词务必用英文（官方内容审查指引：Ensure prompts use English，中文提示词易触发失败）。",
  "用描述性文本：主体、动作、场景、镜头与氛围写全。",
  "1080P 高清仅 16:9 画幅支持。",
].join("\n");
const VEO_SRC = "docs/kie-api.md · Veo3.1 API quickstart + Troubleshooting「Content Review Issues」";

const SUNO_TIPS = [
  "明确曲风、情绪与乐器（be specific about genre, mood, and instruments）。",
  "用描述性形容词控制风格；写明速度（tempo）与能量强度。",
  "可引用音乐年代或代表性艺术家风格作参照。",
].join("\n");
const SUNO_SRC = "docs/kie-api.md · Suno API「Best Practices › Prompt Engineering」";

// ── 种子清单（家族文案展开到各 wire id） ──────────────────────────────────────

const expand = (ids: string[], kind: ModelSkillKind, tips: string, source: string): ModelSkillSeed[] =>
  ids.map((modelId) => ({ modelId, kind, tips, source }));

export const MODEL_SKILL_SEEDS: ModelSkillSeed[] = [
  // GPT Image 家族（kie 4o Image 官方 tips，同族通用）
  ...expand(
    ["poyo_gpt_4o_image", "poyo_gpt_image_15", "poyo_gpt_image", "kie_gpt_image_15", "kie_gpt_image_15_edit", "kie_gpt_image_2", "kie_gpt_image_2_i2i"],
    "image", GPT_IMAGE_TIPS, GPT_IMAGE_SRC,
  ),
  // Grok 图像
  ...expand(["poyo_grok_image", "poyo_grok_image_quality", "kie_grok_image"], "image", GROK_IMAGE_TIPS, GROK_IMAGE_SRC),
  // Grok 视频
  ...expand(["kie_grok_t2v", "kie_grok_i2v"], "video", GROK_VIDEO_TIPS, GROK_VIDEO_SRC),
  // Runway
  ...expand(["kie_runway45", "kie_runway_aleph"], "video", RUNWAY_TIPS, RUNWAY_SRC),
  // Kling 视频家族
  ...expand(
    ["kie_kling26_t2v", "kie_kling26_i2v", "kie_kling30", "kie_kling25turbo_t2v", "kie_kling25turbo_i2v", "kie_kling_v3turbo_t2v"],
    "video", KLING_TIPS, KLING_SRC,
  ),
  // Veo 3.1 家族
  ...expand(["kie_veo31_quality", "kie_veo31_fast", "poyo_veo", "poyo_veo_fast", "poyo_veo_quality"], "video", VEO_TIPS, VEO_SRC),
  // Suno 音乐家族（音乐管线 model id）
  ...expand(["suno-v4", "suno-v4.5", "suno-v4.5plus", "suno-v4.5all", "suno-v5", "suno-v5.5"], "music", SUNO_TIPS, SUNO_SRC),
];
