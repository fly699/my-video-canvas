// 分镜生图的「参数组装器 + 结果写回器」—— 单一代码路径。
//
// 为什么抽出来：分镜节点的单镜生成（handleGenerate）与镜头表的批量生成必须共用同
// 一套组装逻辑（角色/场景/@图像注入、效果注入、分模型 sizing、kie 块、点数预估），
// 否则两份实现必然漂移。这里是唯一事实源；StoryboardNode 与批量入口都只做薄调用。
//
// 本文件同时补齐了分镜生图相对 ImageGenNode 的历史缺失（审计 2026-06）：
// 1. kie 模型块（kieTempKey + aspectRatio）——此前缺失导致临时 key 不生效、比例失控；
// 2. 后处理「效果注入」（connectedEffectPrompts）——此前连了后处理节点对分镜无效；
// 3. 手动多参考图（payload.referenceImages[]）并入参考集合；
// 4. imageN/批量张数计入点数预估。
import type { StoryboardNodeData, ReferenceImage, MergeSeamTransition } from "../../../shared/types";
import { FACTORY_DEFAULT_MODELS } from "../../../shared/nodeDefaultModels";
import {
  effectiveCharacters, effectiveCharacterRefImages, effectiveSceneRefImages, stripCharacterMentions,
} from "./characterConditioning";
import { mentionedMediaUrls, stripMediaMentions } from "./comfyWorkflowParams";
import { mergeCharactersIntoPrompt } from "./characterPrompt";
import { connectedEffectPrompts, appendEffectPrompts } from "./effectPrompt";
import { resolveImageParam, resolvePoyoImageSize } from "./paramDefs";
import { estimateImageCost, costEstimateLabel } from "./costEstimate";
import { nearestUpstreamStoryboard, nearestUpstreamPrompt, titleShotNumber } from "./inputOrder";

// 与 StoryboardNode UI 共用的模型常量（单一事实源）。
export const SOUL_SIZES_LIST = [
  "2048x1152", "2048x1536", "2016x1344", "1696x960", "1632x1088",
  "1152x2048", "1536x2048", "1344x2016", "960x1696", "1088x1632",
  "1536x1536", "1536x1152", "1152x1536",
] as const;
export const V2_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
export const V2_RESOLUTIONS = ["1K", "2K", "4K"] as const;
/** kie 模型的通用比例选项（服务端会按各模型枚举夹取）。 */
export const KIE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:1"] as const;

type MiniNode = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { x: number; y: number } };
type MiniEdge = { source: string; target: string };

// 镜头表的「景别/运镜/焦段/灯光」此前只在 UI 展示、不进生成请求（智能体填了也不影响出图）。
// 把它们译成生成模型能理解的提示词短语，追加到分镜生图提示词末尾，让 Shot List 真正生效。
// 仅追加非空字段；未知 code 原样降级（连字符转空格）。
const SHOT_TYPE_WORDS: Record<string, string> = {
  ECU: "extreme close-up", CU: "close-up", MS: "medium shot",
  MLS: "medium long shot", WS: "wide shot", establishing: "establishing wide shot",
};
const CAMERA_WORDS: Record<string, string> = {
  static: "static camera", "pan-left": "camera pans left", "pan-right": "camera pans right",
  "tilt-up": "camera tilts up", "tilt-down": "camera tilts down",
  "zoom-in": "camera zooms in", "zoom-out": "camera zooms out",
  "dolly-in": "dolly in", "dolly-out": "dolly out", tracking: "tracking shot",
};
function cinematographyClause(payload: StoryboardNodeData): string {
  const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const parts: string[] = [];
  const shot = s(payload.shotType); if (shot) parts.push(SHOT_TYPE_WORDS[shot] ?? shot.replace(/-/g, " "));
  const cam = s(payload.cameraMovement); if (cam) parts.push(CAMERA_WORDS[cam] ?? cam.replace(/-/g, " "));
  const lens = s(payload.lens); if (lens) parts.push(`${lens} lens`);
  const light = s(payload.lighting); if (light) parts.push(light);
  return parts.join(", ");
}

export interface StoryboardGenBuild {
  /** trpc.imageGen.generate 的入参（loose——服务端 Zod 二次校验）。 */
  input: Record<string, unknown>;
  /** 主参考图（可达性 guard 用）。 */
  refUrl?: string;
  /** 预估生成张数（费用预估口径）。 */
  count: number;
  /** 预估点数标签（"≈5 cr" / ""）。 */
  costLabel: string;
  /** 组装失败原因（如缺提示词）；非空时不应提交。 */
  blocked?: string;
}

/** 组装一个分镜的生图请求。纯函数：画布快照显式传入，便于单测与批量复用。 */
export function buildStoryboardGenInput(args: {
  id: string;
  payload: StoryboardNodeData;
  nodes: MiniNode[];
  edges: MiniEdge[];
  /** kie 临时 key（组件侧传 localStorage 值；测试可注入）。 */
  kieTempKey?: string | null;
  /** 归属项目 id——生成的关键帧据此入项目素材库、走 assertProjectAccess。与 ImageGen/视频/配音/音效
   *  同口径；缺了会以 projectId=null 落库、脱离项目（曾漏）。 */
  projectId?: number;
}): StoryboardGenBuild {
  const { id, payload, nodes, edges } = args;
  // 兜底：分镜节点通常已把项目默认（kie GPT Image 2）写入 payload.imageModel；
  // 此处仅在缺失时用出厂默认，保持与节点 picker 显示一致。
  const model = (payload.imageModel as string) || FACTORY_DEFAULT_MODELS.image;
  const promptText = payload.promptText ?? "";
  if (!promptText.trim()) return { input: {}, count: 0, costLabel: "", blocked: "请先填写提示词" };

  const isSoul = model === "hf_soul_standard";
  const isV2HF = model === "hf_reve" || model === "hf_seedream_v4" || model === "hf_flux_pro";

  // ── 角色/场景/@图像 注入（每镜按自己的连线与提及解析）──
  const chars = effectiveCharacters(id, promptText, edges, nodes);
  const manualRef = payload.referenceImageUrl?.trim();
  // 手动多参考（referenceImages[] 管理；[0] 与 referenceImageUrl 镜像）。
  const manualRefs = (payload.referenceImages ?? [])
    .map((r: ReferenceImage) => r.url)
    .filter((u): u is string => !!u?.trim());
  const atImageRefs = mentionedMediaUrls(promptText, "image", nodes);
  const refs = Array.from(new Set([
    ...(manualRefs.length ? manualRefs : manualRef ? [manualRef] : [
      ...effectiveCharacterRefImages(id, promptText, edges, nodes),
      ...effectiveSceneRefImages(id, promptText, edges, nodes),
    ]),
    ...atImageRefs,
  ])).slice(0, 8);
  const refUrl = manualRefs[0] || manualRef || refs[0];

  // ── 提示词：剥 @字面量 → 结构化注入角色 → 追加效果注入（与 ImageGenNode 同序）→ 追加镜头表运镜/灯光 ──
  const cineClause = cinematographyClause(payload);
  const enhancedPrompt = appendEffectPrompts(
    mergeCharactersIntoPrompt(stripMediaMentions(stripCharacterMentions(promptText, nodes), nodes), chars, 2000),
    connectedEffectPrompts(id, edges, nodes),
  ) + (cineClause ? `, ${cineClause}` : "");

  // ── 分模型 sizing（与服务端 Zod 对齐；缺省由 resolveImageParam 补 ParamDef 默认）──
  const generic = payload as unknown as {
    imageSize?: string; imageResolution?: string; imageN?: number;
    imageOutputFormat?: string; poyoAspectRatio?: string;
  };
  const sizing: Record<string, unknown> = {};
  const validSeed = (s: unknown): number | undefined =>
    typeof s === "number" && Number.isInteger(s) && s >= 0 && s <= 2147483647 ? s : undefined;
  if (isSoul) {
    if (SOUL_SIZES_LIST.includes(payload.widthAndHeight as (typeof SOUL_SIZES_LIST)[number])) sizing.widthAndHeight = payload.widthAndHeight;
    if (payload.soulQuality) sizing.quality = payload.soulQuality;
    // 与 ImageGenNode 对齐：种子锁定 + AI 增强提示词（此前分镜未透传，复现一致画面失效）
    const seed = validSeed(payload.seed);
    if (seed != null) sizing.seed = seed;
    if (payload.enhancePrompt != null) sizing.enhancePrompt = !!payload.enhancePrompt;
  } else if (isV2HF) {
    if (V2_ASPECT_RATIOS.includes(payload.reveAspectRatio as (typeof V2_ASPECT_RATIOS)[number])) sizing.reveAspectRatio = payload.reveAspectRatio;
    if (V2_RESOLUTIONS.includes(payload.reveResolution as (typeof V2_RESOLUTIONS)[number])) sizing.reveResolution = payload.reveResolution;
    // Flux Pro Kontext 专属参数（与 ImageGenNode 对齐；此前分镜未透传）
    if (model === "hf_flux_pro") {
      const g = payload.fluxGuidanceScale;
      if (typeof g === "number" && g >= 1 && g <= 20) sizing.fluxGuidanceScale = g;
      const fs = validSeed(payload.fluxSeed);
      if (fs != null) sizing.fluxSeed = fs;
      if ([1, 2, 3, 4].includes(payload.fluxNumImages as number)) sizing.fluxNumImages = payload.fluxNumImages;
    }
  } else if (model.startsWith("poyo_")) {
    // 统一比例（aspectFieldsFor 写进 poyoAspectRatio）在模型接受时升级为 imageSize——
    // 否则被强制填的默认 imageSize 在服务端 size=imageSize??poyoAspectRatio 遮蔽，比例失效。
    sizing.imageSize = resolvePoyoImageSize(model, generic.imageSize, generic.poyoAspectRatio);
    sizing.imageResolution = resolveImageParam(model, "imageResolution", generic.imageResolution);
    sizing.imageN = resolveImageParam(model, "imageN", generic.imageN);
    sizing.imageOutputFormat = resolveImageParam(model, "imageOutputFormat", generic.imageOutputFormat);
    sizing.poyoQuality = resolveImageParam(model, "poyoQuality", payload.poyoQuality);
    sizing.poyoAspectRatio = generic.poyoAspectRatio;
  }

  // ── 批量数 → 预估张数（Soul 批量 / Flux 张数 / Poyo n，与 ImageGenNode.genCount 同口径）──
  const batchSize = isSoul && [1, 4].includes(payload.batchSize as number) ? (payload.batchSize as 1 | 4) : 1;
  const poyoN = Number(sizing.imageN);
  const fluxN = Number(sizing.fluxNumImages);
  const count = isSoul && batchSize > 1 ? batchSize
    : Number.isFinite(fluxN) && fluxN > 1 ? fluxN
    : Number.isFinite(poyoN) && poyoN > 1 ? poyoN : 1;
  const costLabel = costEstimateLabel(estimateImageCost(model, count, { resolution: payload.imageResolution }));

  const input: Record<string, unknown> = {
    prompt: enhancedPrompt,
    negativePrompt: payload.negativePrompt,
    style: payload.colorTone,
    projectId: args.projectId, // 归属项目（缺则服务端 recordGeneratedAsset 落 null，脱离素材库）
    referenceImageUrl: refUrl,
    referenceImageUrls: refs.length > 1 ? refs : undefined,
    model,
    batchSize: isSoul && batchSize > 1 ? batchSize : undefined,
    ...sizing,
    // kie 块（审计补齐）：临时 key 三级体系 + 通用比例（服务端按模型枚举夹取）。
    ...(model.startsWith("kie_") ? {
      kieTempKey: args.kieTempKey || undefined,
      aspectRatio: (payload.aspectRatio as string | undefined) || undefined,
      // 分辨率档（如 GPT Image 2 1K/2K/4K，逐档计价；服务端按模型 resOptions 夹取）
      imageResolution: payload.imageResolution || undefined,
    } : {}),
    estimatedCost: costLabel || undefined,
  };
  return { input, refUrl, count, costLabel };
}

/** 把生图结果写回分镜节点（imageUrl/历史/来源 URL + 推给已连接的视频节点）。
 *  返回写入的 URL 列表；节点已被删除时返回空（调用方据此提示）。 */
export function applyStoryboardGenResult(
  id: string,
  result: { url?: string; urls?: string[]; sourceUrl?: string; sourceUrls?: string[]; sourceAt?: number },
  deps: {
    getNodes: () => Array<{ id: string; data: { payload: unknown } }>;
    updateNodeData: (id: string, payload: Record<string, unknown>) => void;
    propagateRefImage: (id: string, url: string) => void;
  },
): string[] {
  if (!deps.getNodes().some((n) => n.id === id)) return [];
  const newUrls = (result.urls?.length ? result.urls : result.url ? [result.url] : []).filter(Boolean) as string[];
  if (!newUrls.length) return [];
  const imageUrl = newUrls[0];
  const currentHistory = (deps.getNodes().find((n) => n.id === id)?.data.payload as StoryboardNodeData)?.imageHistory ?? [];
  const newHistory = [...newUrls, ...currentHistory].filter((u): u is string => !!u).slice(0, 12);
  deps.updateNodeData(id, {
    imageUrl, imageHistory: newHistory,
    imageUrlSource: result.sourceUrl ?? result.sourceUrls?.[0],
    imageUrlSourceAt: result.sourceAt,
  });
  deps.propagateRefImage(id, imageUrl);
  return newUrls;
}

// ── 批量图生视频：时长夹取 ───────────────────────────────────────────────────
/** 把分镜时长夹取到视频模型支持的档位。defs = 该 provider 的参数定义（注入以便测试）。
 *  select → 取最接近的选项；range → clamp；无 duration 定义 → undefined（模型固定时长）。 */
export function clampDurationForProvider(
  defs: Array<{ type: string; key: string; options?: { value: unknown }[]; min?: number; max?: number }> | undefined,
  seconds: number | undefined,
): number | undefined {
  if (!defs) return undefined;
  const d = defs.find((x) => x.key === "duration");
  if (!d) return undefined;
  const want = Number.isFinite(Number(seconds)) && Number(seconds)! > 0 ? Number(seconds) : undefined;
  if (d.type === "select" && d.options?.length) {
    const nums = d.options.map((o) => Number(o.value)).filter((n) => Number.isFinite(n));
    if (!nums.length) return undefined;
    if (want == null) return nums[0];
    return nums.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), nums[0]);
  }
  if (d.type === "range") {
    const min = d.min ?? 1, max = d.max ?? 30;
    if (want == null) return undefined; // 用模型默认
    return Math.max(min, Math.min(max, Math.round(want)));
  }
  return undefined;
}

// ── 装配端：按镜头表收集合并输入（视频段顺序 / 逐切点转场 / 逐段配音）────────────
/** #264 中文/别名 → 标准转场值。画布助手（LLM）或用户偶尔会往分镜 transition 写中文
 *  （「叠化」「黑场」等），旧映射一律收敛 none → 用户明明写了转场、装配后却全直切。
 *  只登记语义无歧义的常见叫法，冷僻词仍走未知值路径（回退 fallback）。 */
const SHOT_TRANSITION_ALIASES: Record<string, MergeSeamTransition> = {
  "叠化": "dissolve", "溶解": "dissolve", "交叉叠化": "dissolve",
  "淡入淡出": "fade", "渐隐": "fade", "淡化": "fade",
  "黑场": "fadeblack", "渐黑": "fadeblack", "闪黑": "fadeblack",
  "白场": "fadewhite", "渐白": "fadewhite", "闪白": "fadewhite",
  "擦除": "wipe", "划像": "wipe",
  "横扫": "smoothleft", "滑动": "smoothleft",
};

/** 分镜 transition → 合并转场映射。#244 扩含 fadeblack/fadewhite/smoothleft。
 *
 *  #264 修复「装配后全直切」——三档语义（fallback 由调用方传合并节点的全局转场）：
 *   1. 显式硬切（cut / match-cut）→ none：导演点名要硬切，任何全局设置都不覆盖它；
 *   2. 显式已知转场（含中文别名）→ 用它：分镜逐镜意图最优先；
 *   3. 【未设置 / 未知值】→ fallback（默认 "none" 保持旧行为）：此前这档被硬收敛为
 *      none，于是「快捷设置选了柔和叠化 → 全局 transition=dissolve → 一点装配全被
 *      长度=段数-1 的全 none segTransitions 覆盖成直切」（发送口逐接缝数组优先于
 *      全局转场，见 videoEditor.mergeVideos 的 advanced 分支）——用户设置第一位被违背。
 *      现在未指定的接缝跟随用户设的全局转场；全局没设（none）时仍旧全直切，零回归。 */
export function mapShotTransition(t: string | undefined, fallback: MergeSeamTransition = "none"): MergeSeamTransition {
  if (t === "cut" || t === "match-cut") return "none";           // 档1：显式硬切
  if (t === "fade" || t === "dissolve" || t === "wipe" || t === "fadeblack" || t === "fadewhite" || t === "smoothleft") return t; // 档2
  const alias = SHOT_TRANSITION_ALIASES[(t ?? "").trim()];
  if (alias) return alias;                                        // 档2（中文别名）
  return fallback;                                                // 档3：未设 / 未知
}

export interface AssembledPlan {
  inputVideoUrls: string[];
  /** 逐切点转场（长度 = 段数-1），取「前一镜」的 transition（指向下一镜）。 */
  transitions: MergeSeamTransition[];
  /** 逐段配音（该镜下游 dubbing 音频节点的 url；无则 null）。 */
  voiceUrls: (string | null)[];
  /** 逐段音效（该镜下游 sfx 音频节点的 url；无则 null），混入时权重低于配音。 */
  sfxUrls: (string | null)[];
  /** 逐镜对白快照（字幕自动对位消费）。 */
  dialogues: (string | null)[];
  /** 逐镜配音时长（秒；字幕收口用）。 */
  voiceDurations: (number | null)[];
  /** 段↔分镜/视频节点绑定（按镜定位与重生成入口）。 */
  sourceShots: { sb: string | null; vid: string; num?: number | string }[];
  shots: { sceneNumber: number | string | undefined; hasVoice: boolean; hasSfx: boolean; transition: string }[];
}

/** 把装配清单映射成合并节点 payload 补丁（MergeNode.handleAssemble 与智能体引导卡共用，
 *  单一事实源避免两处字段映射漂移）。 */
export function assembledPlanToMergePatch(plan: AssembledPlan) {
  return {
    inputVideoUrls: plan.inputVideoUrls,
    segTransitions: plan.transitions,
    voiceUrls: plan.voiceUrls,
    sfxUrls: plan.sfxUrls,
    segDialogues: plan.dialogues,
    segVoiceDurations: plan.voiceDurations,
    sourceShots: plan.sourceShots,
  };
}

// ── #281 合并段列表手动删段/拖动重排：平行数组确定性跟随 ─────────────────────
// 用户实问「手动删除某镜转场会自动对齐吗」——核查发现此前不会且【静默错位】：
// 删除/重排只更新 inputVideoUrls，segTransitions 与逐镜配音/音效/对白/时长/绑定
// 六个平行数组原地不动；而 #244 对齐守卫比对的 inputVideoUrls 快照恰好被 UI 同步
// 更新、恒为真形同虚设——删除点之后的接缝转场整体前移一位错套、逐镜配音全部错配
// 到前一镜，并被真实发送合成。语义约定（与装配一致）：segTransitions[j] 是【段 j
// 自己的转场】、管辖接缝 j→j+1（前段决定转场）——删段删它自己的转场（删末段删最后
// 一个接缝）；重排把转场当段的属性随段携带（末段补 none 参与置换、新末段的丢弃）。
// 长度与当前段数不匹配的数组（本就失配的历史数据）原样不动，绝不伪造。

/** 与段一一平行的合并 payload 数组键（装配产物，见 assembledPlanToMergePatch）。 */
export interface MergeSegArrays {
  inputVideoUrls?: string[];
  segTransitions?: string[];
  voiceUrls?: (string | null)[];
  sfxUrls?: (string | null)[];
  segDialogues?: (string | null)[];
  segVoiceDurations?: (number | null)[];
  sourceShots?: unknown[];
}
const SEG_PARALLEL_KEYS = ["voiceUrls", "sfxUrls", "segDialogues", "segVoiceDurations", "sourceShots"] as const;

/** 旧快照 prev（平行数组真正对位的列表）是否仍是 next 的前缀（逐项相等）。
 *  消费端按位置 slice 对齐，前缀保持 = 数组仍对位、可原样保留。 */
function prevIsAlignedPrefix(next: string[], prev: string[]): boolean {
  return prev.length <= next.length && prev.every((u, j) => u === next[j]);
}

/** 删除第 i 段：urls 为当前生效段顺序（UI 的 orderItems）。返回要 update 的补丁。
 *  【混合态审查修复】装配后又新连了视频时，orderItems = 旧快照 prev + 追加段——
 *  平行数组只与 prev 对位。此时：删「追加段」→ prev 仍是新列表前缀，数组原样保留
 * （删完可健康恢复完全对齐）；删「prev 内的原装配段」→ 数组永失对位，且删除后
 *  长度恰好重新吻合、各消费端长度守卫会被意外骗过——必须清 segTransitions
 * （宁可退全局转场，绝不错位发送）。 */
export function removeMergeSegmentPatch(p: MergeSegArrays, urls: string[], i: number): MergeSegArrays {
  const n = urls.length;
  if (i < 0 || i >= n) return {};
  const newUrls = urls.filter((_, j) => j !== i);
  const prev = p.inputVideoUrls ?? [];
  // #283 位置对齐视同快照对齐：助手【规划期】写的 segTransitions 没有 URL 快照
  //（prev 为空）——此时转场数与当前段数吻合即按位置对待，删段照常精确跟随
  //（此前走保守分支原样保留，长度对不上被发送守卫整体回退成全局转场，用户实报
  // 「删除某一分镜后转场回退了」）。逐数组的 length 门在下方各自把关。
  const sameList = (prev.length === n && prev.every((u, j) => u === urls[j])) || prev.length === 0;
  if (!sameList) {
    const patch: MergeSegArrays = { inputVideoUrls: newUrls };
    // prev 仍是新列表前缀（删的是追加段）→ 数组保留；否则（删了 prev 内的段）清转场。
    if (!prevIsAlignedPrefix(newUrls, prev) && Array.isArray(p.segTransitions)) patch.segTransitions = undefined;
    return patch;
  }
  const patch: MergeSegArrays = { inputVideoUrls: newUrls };
  for (const k of SEG_PARALLEL_KEYS) {
    const arr = p[k];
    if (Array.isArray(arr) && arr.length === n) (patch as Record<string, unknown>)[k] = arr.filter((_, j) => j !== i);
  }
  const seg = p.segTransitions;
  if (Array.isArray(seg) && seg.length === n - 1 && n > 1) {
    const cut = Math.min(i, seg.length - 1); // 删末段=删最后一个接缝；删其余=删该段自己的转场
    const next = seg.filter((_, j) => j !== cut);
    patch.segTransitions = next.length > 0 ? next : undefined;
  }
  return patch;
}

/** 段从 from 拖到 to：平行数组按同一置换重排；转场随段携带（own[末段]=none 填充）。
 *  【混合态审查修复】列表与旧快照不一致时：置换后 prev 仍是前缀（只在追加区内挪动）
 *  → 数组原样保留；prev 元素被挪位 → 数组永失对位，清 segTransitions 防错位发送。 */
export function reorderMergeSegmentsPatch(p: MergeSegArrays, urls: string[], from: number, to: number): MergeSegArrays {
  const n = urls.length;
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return {};
  const perm = urls.map((_, j) => j);
  const [moved] = perm.splice(from, 1);
  perm.splice(to, 0, moved); // perm[新下标] = 旧下标
  const newUrls = perm.map((j) => urls[j]);
  const prev = p.inputVideoUrls ?? [];
  // #283 与删除同口径：规划期无快照时按位置对待（见 removeMergeSegmentPatch 注释）。
  const sameList = (prev.length === n && prev.every((u, j) => u === urls[j])) || prev.length === 0;
  if (!sameList) {
    const patch: MergeSegArrays = { inputVideoUrls: newUrls };
    if (!prevIsAlignedPrefix(newUrls, prev) && Array.isArray(p.segTransitions)) patch.segTransitions = undefined;
    return patch;
  }
  const patch: MergeSegArrays = { inputVideoUrls: newUrls };
  for (const k of SEG_PARALLEL_KEYS) {
    const arr = p[k];
    if (Array.isArray(arr) && arr.length === n) (patch as Record<string, unknown>)[k] = perm.map((j) => arr[j]);
  }
  const seg = p.segTransitions;
  if (Array.isArray(seg) && seg.length === n - 1) {
    const own = [...seg, "none"]; // own[j] = 段 j 自己的转场；末段无接缝补 none
    patch.segTransitions = perm.map((j) => own[j]).slice(0, n - 1);
  }
  return patch;
}

/** 从合并节点出发，按「上游视频 → 其上游分镜」回溯，按镜号排序产出装配清单。
 *  纯函数（画布快照注入），便于单测。仅纳入「能回溯到分镜」且已出片的视频节点。 */
export function assembleFromStoryboards(
  mergeId: string,
  nodes: Array<{ id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { x: number; y: number } }>,
  edges: Array<{ source: string; target: string }>,
): AssembledPlan | { error: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // #134 成片参与范围：节点「跳过参与」（payload.disabled，右键/多选条/助手均可设）——
  // 装配与运行/估价同口径：工位或其上游分镜被跳过的段不进成片。
  const isOff = (n?: { data: { payload?: unknown } }) => (n?.data.payload as { disabled?: boolean } | undefined)?.disabled === true;
  type Entry = { num: number; url: string; transition: string | undefined; voice: string | null; voiceDur: number | null; sfx: string | null; dialogue: string | null; sbId: string | null; vidId: string; sceneNumber: number | string | undefined };
  const entries: Entry[] = [];
  for (const e of edges) {
    if (e.target !== mergeId) continue;
    const vn = byId.get(e.source);
    const vt = vn?.data.nodeType;
    if (!vn || (vt !== "video_task" && vt !== "comfyui_video" && vt !== "comfyui_workflow")) continue;
    if (isOff(vn)) continue;
    const vp = vn.data.payload as { resultVideoUrl?: string; outputUrl?: string; outputType?: string };
    // comfyui_workflow 出图运行（outputType=image）不是视频段，跳过（开源工作流主力：
    // 出视频的自定义工作流与 comfyui_video / 云端 video_task 一视同仁纳入装配）。
    if (vt === "comfyui_workflow" && vp.outputType === "image") continue;
    const url = (vp.resultVideoUrl ?? vp.outputUrl)?.split("\n")[0];
    if (!url) continue;
    // 回溯该视频的上游分镜（#280 改多跳）：标准管线是 分镜→image_gen 出图工位→视频
    //（imageFirst 也会强插 image_gen），此前只查一跳直连——隔了工位就回溯不到分镜，
    // 镜号全体失效退化成连线顺序，正是「装配镜头排序总不对」的根因。
    const sb = nearestUpstreamStoryboard(vn.id, edges, byId as never) as (typeof nodes)[number] | undefined;
    if (sb && isOff(sb)) continue; // 分镜被「跳过参与」→ 整段（含其工位产物）不进成片
    const sp = sb?.data.payload as { sceneNumber?: number | string; transition?: string; dialogue?: string } | undefined;
    // 该分镜下游的已出声音频，按类别分轨：配音（dubbing/未标类别）与音效（sfx）。
    // music 明确排除——整体配乐走合并节点的 BGM 通道，不按镜对位。
    let voice: string | null = null;
    let voiceDur: number | null = null;
    let sfx: string | null = null;
    // #300 无分镜段的配音对位：排除分镜工作流的镜载体是 prompt 节点
    //（script→prompt→[image_gen]→video），「给每个镜头配音」把工位挂在 prompt 下游
    // ——回溯不到分镜时改回溯最近上游 prompt，扫它下游的音频。有分镜的段
    // 行为逐字节不变（仍只扫分镜下游）。
    const voiceHost = sb ?? (nearestUpstreamPrompt(vn.id, edges, byId as never) as (typeof nodes)[number] | undefined);
    if (voiceHost) {
      for (const e3 of edges) {
        if (e3.source !== voiceHost.id) continue;
        const an = byId.get(e3.target);
        if (an?.data.nodeType === "audio") {
          const ap = an.data.payload as { url?: string; audioCategory?: string; duration?: number };
          if (!ap.url) continue;
          if (ap.audioCategory === "sfx") { if (!sfx) sfx = ap.url; }
          else if (ap.audioCategory !== "music") { if (!voice) { voice = ap.url; voiceDur = ap.duration ?? null; } }
          if (voice && sfx) break;
        }
      }
    }
    const num = Number(sp?.sceneNumber);
    // #280 无分镜管线也要能装配：回溯不到分镜（用户画布可以完全不用分镜节点，如
    // prompt「SH06」+首帧→视频 直连合并）时，退用【视频节点标题里的镜号】（SH06/
    // 镜头6/结尾数字等，titleShotNumber 与合并段序比较器同源）；标题也无镜号才
    // 按连线顺序垫底（9000+）。此前无分镜段一律 9000+ 连线序，装配等于白点。
    const tNum = titleShotNumber(vn.data.title);
    entries.push({ num: Number.isFinite(num) && num > 0 ? num : (Number.isFinite(tNum) ? tNum : 9000 + entries.length), url, transition: sp?.transition, voice, voiceDur, sfx, dialogue: sp?.dialogue?.trim() || null, sbId: sb?.id ?? null, vidId: vn.id, sceneNumber: sp?.sceneNumber ?? (Number.isFinite(tNum) ? tNum : undefined) });
  }
  if (entries.length < 2) return { error: "需要至少 2 个已出片的上游视频节点" };
  entries.sort((a, b) => a.num - b.num);
  // #264 用户设置第一位：合并节点已设的【全局转场】作为「分镜未指定转场」接缝的回退值。
  // 此前这些接缝被硬收敛为 none，装配产生的 segTransitions（发送时优先于全局转场）把
  // 用户设置整体清成直切。全局默认 none 时回退仍是 none——默认直切原则（#147）不变。
  const mergePayload = byId.get(mergeId)?.data.payload as { transition?: string; inputVideoUrls?: string[]; segTransitions?: string[] } | undefined;
  const gt = mergePayload?.transition;
  const seamFallback: MergeSeamTransition =
    gt === "fade" || gt === "dissolve" || gt === "fadeblack" || gt === "fadewhite" || gt === "smoothleft" ? gt : "none";
  // #280 已配置的【逐缝转场】按「接缝内容」（前段URL→后段URL）对齐保留：用户命令
  // 助手写好 segTransitions 后再点「装配」，此前无分镜段的转场被整体冲成全局回退
  //（实报「装配无效」）。分镜显式 transition 仍最高；只有分镜没说的接缝才继承旧值。
  const SEAM_OK = new Set(["none", "fade", "dissolve", "fadeblack", "fadewhite", "smoothleft"]);
  const prevUrls = mergePayload?.inputVideoUrls ?? [];
  const prevSeg = mergePayload?.segTransitions ?? [];
  const seamKeep = new Map<string, MergeSeamTransition>();
  for (let i = 0; i + 1 < prevUrls.length && i < prevSeg.length; i++) {
    if (SEAM_OK.has(prevSeg[i])) seamKeep.set(`${prevUrls[i]}\u0000${prevUrls[i + 1]}`, prevSeg[i] as MergeSeamTransition);
  }
  // #283 位置继承（用户实报「手动装配转场传不过来、必须指挥助手」的根因）：助手在
  // 【规划期】就把逐缝转场写进合并节点——届时视频尚未出片、inputVideoUrls 快照无从
  // 写入（没有 URL），上面的 URL 接缝对齐必然落空，手动装配把助手写好的转场整体冲成
  // 全局回退。此时若旧转场数恰等于装配后的接缝数，按【位置】继承——助手按镜号顺序
  // 写、装配也按镜号排序，位置语义一致；数量不符则不继承（绝不错位套用）。
  // 有 URL 快照时仍以内容对齐为准（更精确，重排/删段后依旧安全）。
  const positional = prevUrls.length === 0 && prevSeg.length === entries.length - 1;
  return {
    inputVideoUrls: entries.map((x) => x.url),
    transitions: entries.slice(0, -1).map((x, i) =>
      x.transition
        ? mapShotTransition(x.transition, seamFallback)
        : (seamKeep.get(`${x.url}\u0000${entries[i + 1].url}`)
          ?? (positional && SEAM_OK.has(prevSeg[i]) ? (prevSeg[i] as MergeSeamTransition) : mapShotTransition(undefined, seamFallback)))),
    voiceUrls: entries.map((x) => x.voice),
    sfxUrls: entries.map((x) => x.sfx),
    dialogues: entries.map((x) => x.dialogue),
    voiceDurations: entries.map((x) => x.voiceDur),
    sourceShots: entries.map((x) => ({ sb: x.sbId, vid: x.vidId, num: x.sceneNumber })),
    shots: entries.map((x) => ({ sceneNumber: x.sceneNumber, hasVoice: !!x.voice, hasSfx: !!x.sfx, transition: mapShotTransition(x.transition, seamFallback) })),
  };
}
