import type { AgentOperation } from "../../../shared/types";
import { aspectFieldsFor } from "./agentApply";

// "成片配方" — one click expands a recipe into a full node chain. Now config-driven:
// the recipe defines sensible defaults + per-shot content, and a single builder
// honors the user's choices (shot count / aspect / duration / 配乐 / 字幕 / 生图先行 /
// 仅ComfyUI / AI 生成分镜) so the same recipe adapts instead of being hardcoded.
// Applied through the same applyAgentOperations path as the agent's own output.

export interface RecipeConfig {
  topic?: string;
  shots: number;
  aspect: string;            // "9:16" | "16:9" | "1:1"
  durationEach: number;      // seconds per shot
  addMusic: boolean;
  addSubtitle: boolean;
  imageFirst: boolean;       // 生图 → 再图生视频
  style?: string;
  comfyOnly?: boolean;       // 仅 ComfyUI 生成
  videoTemplateId?: number;  // required when comfyOnly
  /** Per-shot descriptions (AI-generated or default). Length ≥ shots preferred. */
  shotDescriptions?: string[];
}

export interface AgentRecipe {
  id: string;
  name: string;
  desc: string;
  category: string;
  defaults: {
    shots: number;
    aspect: string;
    durationEach: number;
    addMusic?: boolean;
    addSubtitle?: boolean;
    imageFirst?: boolean;
    /** 逐镜默认转场（写入每个分镜的 transition，供「按镜头表装配」消费）；缺省 cut。 */
    shotTransition?: "cut" | "fade" | "dissolve" | "wipe" | "match-cut";
  };
  /** Recipes that read as narration add a 配音(dubbing) track automatically. */
  voiceOver?: boolean;
  /** [min, max] shot bounds for the config dialog. */
  shotRange: [number, number];
  /** Synopsis seed for the script node. */
  synopsis: (topic?: string) => string;
  /** Base per-shot beats; fitted to the chosen shot count. */
  beats: string[];
}

// Fit a base beat list to exactly `n` items: slice if fewer, pad with generic
// shot labels if more.
function fitBeats(base: string[], n: number, topic?: string): string[] {
  if (base.length >= n) return base.slice(0, n);
  const out = [...base];
  for (let i = base.length; i < n; i++) out.push(topic ? `${topic} · 镜头${i + 1}` : `镜头${i + 1}`);
  return out;
}

function resolveDescriptions(recipe: AgentRecipe, cfg: RecipeConfig, shots: number): string[] {
  if (cfg.shotDescriptions && cfg.shotDescriptions.length > 0) {
    const ds = cfg.shotDescriptions.filter((s) => s && s.trim());
    if (ds.length >= shots) return ds.slice(0, shots);
    // pad short AI output with default beats
    return [...ds, ...fitBeats(recipe.beats, shots).slice(ds.length)];
  }
  return fitBeats(recipe.beats, shots, cfg.topic);
}

function styleAspectSuffix(cfg: RecipeConfig): string {
  const bits = [cfg.aspect, cfg.style?.trim()].filter(Boolean);
  return bits.length ? `（${bits.join("，")}）` : "";
}

/** Build the operation list for a recipe + user config. Pure / deterministic. */
export function buildRecipeOps(recipe: AgentRecipe, cfg: RecipeConfig): AgentOperation[] {
  const shots = Math.max(1, Math.floor(cfg.shots));
  const descs = resolveDescriptions(recipe, cfg, shots);
  const useComfy = !!cfg.comfyOnly && cfg.videoTemplateId != null;
  const ops: AgentOperation[] = [];

  ops.push({
    op: "create", nodeType: "script", tempId: "script", title: "脚本",
    payload: { synopsis: recipe.synopsis(cfg.topic) + styleAspectSuffix(cfg), aiSceneCount: shots },
  });
  // Create merge up front so per-shot `connect → merge` resolves in apply order.
  ops.push({
    op: "create", nodeType: "merge", tempId: "merge", title: "合并成片",
    payload: { transition: "none" }, // #147 合并默认直切（转场由镜头表/用户显式设置）
  });

  for (let i = 0; i < shots; i++) {
    const n = i + 1;
    const desc = descs[i];
    if (useComfy) {
      const p = `p${n}`, cw = `cw${n}`;
      ops.push({ op: "create", nodeType: "prompt", tempId: p, title: `提示词${n}`, payload: { positivePrompt: desc, ...aspectFieldsFor("prompt", cfg.aspect), ...(cfg.style?.trim() ? { style: cfg.style.trim() } : {}) } });
      // 默认按项目比例覆盖工作流 latent 尺寸（保留面积、/64 对齐），让 ComfyUI 出片符合配方比例。
      ops.push({ op: "create", nodeType: "comfyui_workflow", tempId: cw, title: `镜头${n}`, payload: { templateId: cfg.videoTemplateId, prompt: desc, ...aspectFieldsFor("comfyui_workflow", cfg.aspect) } });
      ops.push({ op: "connect", sourceRef: "script", targetRef: p });
      ops.push({ op: "connect", sourceRef: p, targetRef: cw });
      ops.push({ op: "connect", sourceRef: cw, targetRef: "merge" });
      continue;
    }
    const sb = `sb${n}`, vt = `vt${n}`;
    // 镜号 + 逐镜转场：让配方产物直接满足「镜头表批量生产 → 按镜头表装配」的字段要求。
    // 把配方画面比例透传给分镜节点。storyboardGen 按模型族读不同字段：kie→aspectRatio、
    // Poyo→poyoAspectRatio、V2/HF→reveAspectRatio。分镜默认模型可能是任一族，故三者都写
    // （各模型只读自己的字段、互不影响）；此前一个都没写，导致分镜无视配方比例按默认出图。
    ops.push({ op: "create", nodeType: "storyboard", tempId: sb, title: `分镜${n}`, payload: { sceneNumber: n, description: desc, duration: cfg.durationEach, transition: recipe.defaults.shotTransition ?? "cut", ...aspectFieldsFor("storyboard", cfg.aspect), ...(cfg.style?.trim() ? { colorTone: cfg.style.trim() } : {}) } });
    ops.push({ op: "connect", sourceRef: "script", targetRef: sb });
    // 分镜本身就是「生图工位」：镜头表批量生产会把关键帧生成在分镜上，批量生视频按
    // 「分镜→视频直连」找到该工位并把关键帧作首帧。因此 imageFirst（生图→再生视频）
    // 在分镜管线里由 分镜→视频 直连天然满足——不再额外插 image_gen 静帧节点，否则
    // 一镜两次生图，且直连断裂会让批量生视频找不到既有工位再新建一个。
    // 把配方每镜时长传给视频节点（params.duration，服务端按 provider 夹取）；此前 payload
    // 为空，视频按模型默认时长生成、无视配方设定。比例无需传——i2v 跟随分镜参考图比例。
    ops.push({ op: "create", nodeType: "video_task", tempId: vt, title: `视频${n}`, payload: { params: { duration: cfg.durationEach } } });
    // 分镜关键帧 = 视频的参考图（i2v 首帧）。必须连到 video 的 `ref-image-in` 句柄，
    // 否则连线预填 / 生成后传播（都按该句柄识别参考图边）都不会把分镜图填进视频参考图。
    ops.push({ op: "connect", sourceRef: sb, targetRef: vt, targetHandle: "ref-image-in" });
    let tail = vt;
    if (cfg.addSubtitle) {
      const sub = `sub${n}`;
      ops.push({ op: "create", nodeType: "subtitle", tempId: sub, title: `字幕${n}`, payload: {} });
      ops.push({ op: "connect", sourceRef: tail, targetRef: sub });
      tail = sub;
    }
    ops.push({ op: "connect", sourceRef: tail, targetRef: "merge" });
  }

  // 音轨（comfyOnly 下尊重「仅 ComfyUI」语义，不添加音频/字幕节点）。
  if (!useComfy) {
    if (cfg.addMusic) {
      ops.push({ op: "create", nodeType: "audio", tempId: "music", title: "配乐", payload: { audioCategory: "music" } });
      ops.push({ op: "connect", sourceRef: "music", targetRef: "merge" });
    }
    if (recipe.voiceOver) {
      ops.push({ op: "create", nodeType: "audio", tempId: "voice", title: "配音", payload: { audioCategory: "dubbing" } });
      ops.push({ op: "connect", sourceRef: "voice", targetRef: "merge" });
    }
  }
  return ops;
}

/** Merge a recipe's defaults with the agent node's planPrefs into a start config. */
export function recipeDefaultConfig(
  recipe: AgentRecipe,
  opts: { topic?: string; comfyOnly?: boolean; prefs?: { imageFirst?: boolean; addMusic?: boolean; addSubtitle?: boolean; aspect?: string; style?: string } } = {},
): RecipeConfig {
  const p = opts.prefs ?? {};
  return {
    topic: opts.topic?.trim() || undefined,
    shots: recipe.defaults.shots,
    aspect: p.aspect || recipe.defaults.aspect,
    durationEach: recipe.defaults.durationEach,
    addMusic: p.addMusic ?? recipe.defaults.addMusic ?? false,
    addSubtitle: p.addSubtitle ?? recipe.defaults.addSubtitle ?? false,
    imageFirst: p.imageFirst ?? recipe.defaults.imageFirst ?? false,
    style: p.style?.trim() || undefined,
    comfyOnly: opts.comfyOnly,
    videoTemplateId: undefined,
  };
}

export const AGENT_RECIPES: AgentRecipe[] = [
  {
    id: "vertical_promo", name: "竖屏宣传片", desc: "脚本 → 多分镜 → 视频 → 合并（9:16）", category: "营销",
    defaults: { shots: 3, aspect: "9:16", durationEach: 4, addMusic: true }, shotRange: [2, 8],
    synopsis: (t) => t?.trim() || "产品/品牌竖屏宣传短片",
    beats: ["开场：抓眼球的产品/主体特写", "中段：核心卖点 / 使用场景展示", "收尾：品牌露出 + 行动号召"],
  },
  {
    id: "drama", name: "反转短剧", desc: "脚本 → 多分镜 → 视频 → 合并（强冲突）", category: "叙事",
    defaults: { shots: 4, aspect: "9:16", durationEach: 6, addMusic: true }, shotRange: [3, 12],
    synopsis: (t) => t?.trim() || "强冲突反转狗血短剧",
    beats: ["设定与人物关系铺垫", "矛盾出现、冲突升级", "高潮反转、情绪爆发", "结局与情绪收束"],
  },
  {
    id: "talking_sell", name: "口播带货", desc: "脚本 → 主画面 → 视频 → 字幕 + 配音 → 合并", category: "营销",
    defaults: { shots: 1, aspect: "9:16", durationEach: 15, addSubtitle: true }, voiceOver: true, shotRange: [1, 3],
    synopsis: (t) => t?.trim() || "单品口播带货脚本（痛点 → 卖点 → 促单）",
    beats: ["主播出镜口播：痛点引入 → 卖点展示 → 限时促单", "产品细节特写补充", "优惠信息 + 行动号召"],
  },
  {
    id: "knowledge", name: "知识科普/解说", desc: "脚本 → 多分镜 → 视频 → 字幕 + 解说配音 → 合并", category: "知识",
    defaults: { shots: 5, aspect: "16:9", durationEach: 6, addSubtitle: true }, voiceOver: true, shotRange: [3, 12],
    synopsis: (t) => t?.trim() || "一个知识点的科普解说短片",
    beats: ["抛出问题/悬念，吸引注意", "背景与概念铺垫", "核心原理拆解（图示/类比）", "实例佐证", "总结升华 + 互动引导"],
  },
  {
    id: "vlog", name: "横屏 Vlog", desc: "脚本 → 多分镜 → 视频 → 合并 + 配乐（16:9）", category: "生活",
    defaults: { shots: 5, aspect: "16:9", durationEach: 5, addMusic: true }, shotRange: [3, 12],
    synopsis: (t) => t?.trim() || "一天/一次体验的横屏 Vlog",
    beats: ["开场打招呼 + 今天主题", "出发 / 准备过程", "高光体验片段一", "高光体验片段二", "收尾感受 + 下期预告"],
  },
  {
    id: "music_mv", name: "卡点音乐 MV", desc: "脚本 → 多快切镜头 → 生图 → 视频 → 合并 + 配乐", category: "音乐",
    defaults: { shots: 8, aspect: "9:16", durationEach: 2, addMusic: true, imageFirst: true }, shotRange: [4, 16],
    synopsis: (t) => t?.trim() || "踩节拍快切的氛围音乐 MV",
    beats: ["主体登场特写", "环境全景", "动作细节快切", "光影/色彩氛围", "情绪高点", "转场过渡", "节奏副歌爆发", "收束定格"],
  },
  {
    id: "cinematic_trailer", name: "电影感预告", desc: "脚本 → 多分镜 → 视频 → 合并 + 配乐（16:9）", category: "叙事",
    defaults: { shots: 6, aspect: "16:9", durationEach: 4, addMusic: true, shotTransition: "dissolve" }, shotRange: [4, 12],
    synopsis: (t) => t?.trim() || "电影感叙事预告片",
    beats: ["氛围空镜 + 旁白起势", "主角与世界观登场", "冲突/危机浮现", "节奏加快的冲突蒙太奇", "高潮悬念定格", "片名 Logo + 上映信息"],
  },
  {
    id: "product_3", name: "产品三件套", desc: "脚本 → 外观/细节/场景 三镜 → 视频 → 合并（1:1）", category: "营销",
    defaults: { shots: 3, aspect: "1:1", durationEach: 5, addMusic: true }, shotRange: [3, 6],
    synopsis: (t) => t?.trim() || "电商产品三镜展示（外观 → 细节 → 场景）",
    beats: ["产品整体外观 360° 展示", "材质/工艺细节微距特写", "真实使用场景演示"],
  },
];

export function getRecipe(id: string): AgentRecipe | undefined {
  return AGENT_RECIPES.find((r) => r.id === id);
}
