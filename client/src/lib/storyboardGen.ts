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
import type { StoryboardNodeData, ReferenceImage } from "../../../shared/types";
import { FACTORY_DEFAULT_MODELS } from "../../../shared/nodeDefaultModels";
import {
  effectiveCharacters, effectiveCharacterRefImages, effectiveSceneRefImages, stripCharacterMentions,
} from "./characterConditioning";
import { mentionedMediaUrls, stripMediaMentions } from "./comfyWorkflowParams";
import { mergeCharactersIntoPrompt } from "./characterPrompt";
import { connectedEffectPrompts, appendEffectPrompts } from "./effectPrompt";
import { resolveImageParam } from "./paramDefs";
import { estimateImageCost, costEstimateLabel } from "./costEstimate";

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

  // ── 提示词：剥 @字面量 → 结构化注入角色 → 追加效果注入（与 ImageGenNode 同序）──
  const enhancedPrompt = appendEffectPrompts(
    mergeCharactersIntoPrompt(stripMediaMentions(stripCharacterMentions(promptText, nodes), nodes), chars, 2000),
    connectedEffectPrompts(id, edges, nodes),
  );

  // ── 分模型 sizing（与服务端 Zod 对齐；缺省由 resolveImageParam 补 ParamDef 默认）──
  const generic = payload as unknown as {
    imageSize?: string; imageResolution?: string; imageN?: number;
    imageOutputFormat?: string; poyoAspectRatio?: string;
  };
  const sizing: Record<string, unknown> = {};
  if (isSoul) {
    if (SOUL_SIZES_LIST.includes(payload.widthAndHeight as (typeof SOUL_SIZES_LIST)[number])) sizing.widthAndHeight = payload.widthAndHeight;
    if (payload.soulQuality) sizing.quality = payload.soulQuality;
  } else if (isV2HF) {
    if (V2_ASPECT_RATIOS.includes(payload.reveAspectRatio as (typeof V2_ASPECT_RATIOS)[number])) sizing.reveAspectRatio = payload.reveAspectRatio;
    if (V2_RESOLUTIONS.includes(payload.reveResolution as (typeof V2_RESOLUTIONS)[number])) sizing.reveResolution = payload.reveResolution;
  } else if (model.startsWith("poyo_")) {
    sizing.imageSize = resolveImageParam(model, "imageSize", generic.imageSize);
    sizing.imageResolution = resolveImageParam(model, "imageResolution", generic.imageResolution);
    sizing.imageN = resolveImageParam(model, "imageN", generic.imageN);
    sizing.imageOutputFormat = resolveImageParam(model, "imageOutputFormat", generic.imageOutputFormat);
    sizing.poyoQuality = resolveImageParam(model, "poyoQuality", payload.poyoQuality);
    sizing.poyoAspectRatio = generic.poyoAspectRatio;
  }

  // ── 批量数 → 预估张数 ──
  const batchSize = isSoul && [1, 4].includes(payload.batchSize as number) ? (payload.batchSize as 1 | 4) : 1;
  const poyoN = Number(sizing.imageN);
  const count = isSoul && batchSize > 1 ? batchSize : Number.isFinite(poyoN) && poyoN > 1 ? poyoN : 1;
  const costLabel = costEstimateLabel(estimateImageCost(model, count));

  const input: Record<string, unknown> = {
    prompt: enhancedPrompt,
    negativePrompt: payload.negativePrompt,
    style: payload.colorTone,
    referenceImageUrl: refUrl,
    referenceImageUrls: refs.length > 1 ? refs : undefined,
    model,
    batchSize: isSoul && batchSize > 1 ? batchSize : undefined,
    ...sizing,
    // kie 块（审计补齐）：临时 key 三级体系 + 通用比例（服务端按模型枚举夹取）。
    ...(model.startsWith("kie_") ? {
      kieTempKey: args.kieTempKey || undefined,
      aspectRatio: (payload.aspectRatio as string | undefined) || undefined,
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
/** 分镜 transition → 合并转场映射（cut/match-cut=硬切）。 */
export function mapShotTransition(t: string | undefined): "none" | "fade" | "dissolve" | "wipe" {
  if (t === "fade") return "fade";
  if (t === "dissolve") return "dissolve";
  if (t === "wipe") return "wipe";
  return "none"; // cut / match-cut / 未设
}

export interface AssembledPlan {
  inputVideoUrls: string[];
  /** 逐切点转场（长度 = 段数-1），取「前一镜」的 transition（指向下一镜）。 */
  transitions: ("none" | "fade" | "dissolve" | "wipe")[];
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

/** 从合并节点出发，按「上游视频 → 其上游分镜」回溯，按镜号排序产出装配清单。
 *  纯函数（画布快照注入），便于单测。仅纳入「能回溯到分镜」且已出片的视频节点。 */
export function assembleFromStoryboards(
  mergeId: string,
  nodes: Array<{ id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { x: number; y: number } }>,
  edges: Array<{ source: string; target: string }>,
): AssembledPlan | { error: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  type Entry = { num: number; url: string; transition: string | undefined; voice: string | null; voiceDur: number | null; sfx: string | null; dialogue: string | null; sbId: string | null; vidId: string; sceneNumber: number | string | undefined };
  const entries: Entry[] = [];
  for (const e of edges) {
    if (e.target !== mergeId) continue;
    const vn = byId.get(e.source);
    const vt = vn?.data.nodeType;
    if (!vn || (vt !== "video_task" && vt !== "comfyui_video" && vt !== "comfyui_workflow")) continue;
    const vp = vn.data.payload as { resultVideoUrl?: string; outputUrl?: string; outputType?: string };
    // comfyui_workflow 出图运行（outputType=image）不是视频段，跳过（开源工作流主力：
    // 出视频的自定义工作流与 comfyui_video / 云端 video_task 一视同仁纳入装配）。
    if (vt === "comfyui_workflow" && vp.outputType === "image") continue;
    const url = (vp.resultVideoUrl ?? vp.outputUrl)?.split("\n")[0];
    if (!url) continue;
    // 回溯该视频的上游分镜
    const sbEdge = edges.find((e2) => e2.target === vn.id && byId.get(e2.source)?.data.nodeType === "storyboard");
    const sb = sbEdge ? byId.get(sbEdge.source) : undefined;
    const sp = sb?.data.payload as { sceneNumber?: number | string; transition?: string; dialogue?: string } | undefined;
    // 该分镜下游的已出声音频，按类别分轨：配音（dubbing/未标类别）与音效（sfx）。
    // music 明确排除——整体配乐走合并节点的 BGM 通道，不按镜对位。
    let voice: string | null = null;
    let voiceDur: number | null = null;
    let sfx: string | null = null;
    if (sb) {
      for (const e3 of edges) {
        if (e3.source !== sb.id) continue;
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
    entries.push({ num: Number.isFinite(num) && num > 0 ? num : 9000 + entries.length, url, transition: sp?.transition, voice, voiceDur, sfx, dialogue: sp?.dialogue?.trim() || null, sbId: sb?.id ?? null, vidId: vn.id, sceneNumber: sp?.sceneNumber });
  }
  if (entries.length < 2) return { error: "需要至少 2 个已出片、且能回溯到分镜的上游视频节点" };
  entries.sort((a, b) => a.num - b.num);
  return {
    inputVideoUrls: entries.map((x) => x.url),
    transitions: entries.slice(0, -1).map((x) => mapShotTransition(x.transition)),
    voiceUrls: entries.map((x) => x.voice),
    sfxUrls: entries.map((x) => x.sfx),
    dialogues: entries.map((x) => x.dialogue),
    voiceDurations: entries.map((x) => x.voiceDur),
    sourceShots: entries.map((x) => ({ sb: x.sbId, vid: x.vidId, num: x.sceneNumber })),
    shots: entries.map((x) => ({ sceneNumber: x.sceneNumber, hasVoice: !!x.voice, hasSfx: !!x.sfx, transition: mapShotTransition(x.transition) })),
  };
}
