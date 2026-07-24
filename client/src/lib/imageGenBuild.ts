// image_gen 节点生图的「参数组装器」—— 单一代码路径。
//
// 为什么抽出来：逐节点 ImageGenNode.handleGenerate 与「运行全部」(useWorkflowRunner) 必须
// 共用同一套组装逻辑（角色/场景/@图像注入、效果注入、分模型 sizing、kie 块、点数预估、
// 参考图解析），否则两份实现必然漂移——此前 runner 用简化的 injectCharacters + 11 模型白名单，
// 丢了 kie/多数 poyo 模型（被置默认模型出图、扣费不符）及全部 sizing/比例/效果/@图像/多参考。
//
// 本函数【逐行精确镜像】ImageGenNode.handleGenerate 的组装（含其与 storyboard 的差异：
// 参考图解析 referenceImageUrl=payload.referenceImageUrl??charRefs[0]、referenceImageUrls
// 非空即发、prompt 合并无 maxLen、无镜头表 cineClause、style=payload.style、各模型块判断用
// 原始 payload.model 而 model 字段用兜底 defaultModel）。改动务必保持两侧行为一致。
import type { ImageGenNodeData, ReferenceImage } from "../../../shared/types";
import { refUrls } from "./referenceImages";
import {
  effectiveCharacters, effectiveCharacterRefImages, effectiveSceneRefImages, stripCharacterMentions,
} from "./characterConditioning";
import { mentionedMediaUrls, stripMediaMentions } from "./comfyWorkflowParams";
import { mergeCharactersIntoPrompt } from "./characterPrompt";
import { connectedEffectPrompts, appendEffectPrompts } from "./effectPrompt";
import { resolveImageParam, resolvePoyoImageSize } from "./paramDefs";
import { estimateImageCost, costEstimateLabel } from "./costEstimate";
// 复用与 StoryboardNode 共享的模型常量（值与 ImageGenNode 本地常量逐一相等，单一事实源）。
import { SOUL_SIZES_LIST, V2_ASPECT_RATIOS, V2_RESOLUTIONS } from "./storyboardGen";

const SOUL_QUALITIES = ["720p", "1080p"] as const;
const MAX_SEED = 2147483647;

type MiniNode = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { x: number; y: number } };
type MiniEdge = { source: string; target: string };

export interface ImageGenBuild {
  /** trpc.imageGen.generate 的入参（loose——服务端 Zod 二次校验）；不含 projectId（调用方补）。 */
  input: Record<string, unknown>;
  /** 主参考图（可达性 guard 用）。 */
  refUrl?: string;
  /** 预估生成张数（费用预估口径）。 */
  count: number;
  /** 预估点数标签。 */
  costLabel: string;
  /** 组装失败原因（缺提示词）；非空时不应提交。 */
  blocked?: string;
}

/** 组装一个 image_gen 节点的生图请求。纯函数：画布快照 + 默认模型 + kie key 显式传入。 */
export function buildImageGenInput(args: {
  id: string;
  payload: ImageGenNodeData;
  nodes: MiniNode[];
  edges: MiniEdge[];
  /** 节点未显式设 model 时的默认（项目级→出厂，与 picker 显示一致；组件用 resolve、runner 用 resolveActiveNodeModel）。 */
  defaultModel: string;
  /** kie 临时 key（组件/ runner 传 localStorage 值；测试可注入）。 */
  kieTempKey?: string | null;
}): ImageGenBuild {
  const { id, payload, nodes, edges } = args;
  if (!payload.prompt?.trim()) return { input: {}, count: 0, costLabel: "", blocked: "请先填写提示词" };

  // model 字段用兜底；但各模型块的判断沿用 handleGenerate——用【原始】payload.model。
  const model = payload.model || args.defaultModel;
  const raw = payload.model;
  const isReveOrSeedream = raw === "hf_reve" || raw === "hf_seedream_v4" || raw === "hf_flux_pro";
  // reve / seedream_v4 / flux_pro 目前共用同一套比例白名单（V2_ASPECT_RATIOS）；原写成
  // `flux_pro ? A : A` 的死三元（两分支相同）易被误读为「flux_pro 有独立比例集」，简化掉。
  const reveAspect = (V2_ASPECT_RATIOS as readonly string[]).includes(payload.reveAspectRatio ?? "") ? payload.reveAspectRatio : undefined;
  const fluxNum = ([1, 2, 3, 4] as number[]).includes(payload.fluxNumImages as number) ? (payload.fluxNumImages as 1 | 2 | 3 | 4) : undefined;
  const soulQuality = (SOUL_QUALITIES as readonly string[]).includes(payload.soulQuality ?? "") ? payload.soulQuality : undefined;
  const reveResolution = (V2_RESOLUTIONS as readonly string[]).includes(payload.reveResolution ?? "") ? payload.reveResolution : undefined;
  const widthAndHeight = (SOUL_SIZES_LIST as readonly string[]).includes(payload.widthAndHeight ?? "") ? payload.widthAndHeight : undefined;
  const validSeed = (s: number | undefined) =>
    typeof s === "number" && Number.isInteger(s) && s >= 0 && s <= MAX_SEED ? s : undefined;
  const validGuidance = (g: number | undefined) =>
    typeof g === "number" && Number.isFinite(g) && g >= 1 && g <= 20 ? g : undefined;

  const generic = payload as unknown as {
    imageSize?: string; imageResolution?: string; imageN?: number;
    imageOutputFormat?: string; poyoAspectRatio?: string;
  };

  // 参考图：手动多参考(referenceImages[]) → 无手动时用角色/场景参考图；@图像 并入 referenceImageUrls。
  const manualRefs = refUrls(payload as unknown as { referenceImageUrl?: string; referenceImages?: ReferenceImage[] });
  const charRefs = manualRefs.length === 0
    ? [...effectiveCharacterRefImages(id, payload.prompt, edges, nodes), ...effectiveSceneRefImages(id, payload.prompt, edges, nodes)]
    : [];
  const atImageRefs = mentionedMediaUrls(payload.prompt, "image", nodes);
  const effectiveRefs = Array.from(new Set([...(manualRefs.length ? manualRefs : charRefs), ...atImageRefs])).slice(0, 8);

  // 提示词：剥 @字面量 → 结构化注入角色（无 maxLen，与 handleGenerate 一致）→ 追加效果注入。
  const connChars = effectiveCharacters(id, payload.prompt, edges, nodes);
  const finalPrompt = appendEffectPrompts(
    mergeCharactersIntoPrompt(stripMediaMentions(stripCharacterMentions(payload.prompt, nodes), nodes), connChars),
    connectedEffectPrompts(id, edges, nodes),
  );

  // 预估张数（与 ImageGenNode.genCount 同口径：原始 imageN / soul batchSize / flux num）。
  const isSoul = raw === "hf_soul_standard";
  const isFluxPro = raw === "hf_flux_pro";
  const poyoN = generic.imageN ?? 1;
  const count = isSoul && (payload.batchSize ?? 1) > 1 ? (payload.batchSize ?? 1)
    : isFluxPro && (payload.fluxNumImages ?? 1) > 1 ? (payload.fluxNumImages ?? 1)
    : poyoN > 1 ? poyoN : 1;
  const costLabel = costEstimateLabel(estimateImageCost(model, count, { resolution: payload.imageResolution }));

  const refUrl = payload.referenceImageUrl ?? charRefs[0];
  const input: Record<string, unknown> = {
    prompt: finalPrompt,
    negativePrompt: payload.negativePrompt,
    style: payload.style,
    referenceImageUrl: refUrl,
    referenceImageUrls: effectiveRefs.length ? effectiveRefs : undefined,
    model,
    ...(raw?.startsWith("poyo_") ? {
      imageSize: resolvePoyoImageSize(raw, generic.imageSize, generic.poyoAspectRatio),
      imageResolution: resolveImageParam(raw, "imageResolution", generic.imageResolution),
      imageN: resolveImageParam(raw, "imageN", generic.imageN),
      imageOutputFormat: resolveImageParam(raw, "imageOutputFormat", generic.imageOutputFormat),
      poyoQuality: resolveImageParam(raw, "poyoQuality", payload.poyoQuality),
      poyoAspectRatio: generic.poyoAspectRatio,
    } : {}),
    ...(raw === "hf_soul_standard" ? {
      widthAndHeight,
      quality: soulQuality,
      batchSize: ([1, 4] as number[]).includes(payload.batchSize as number) ? (payload.batchSize as 1 | 4) : undefined,
      seed: validSeed(payload.seed),
      enhancePrompt: payload.enhancePrompt,
    } : {}),
    ...(isReveOrSeedream ? {
      reveAspectRatio: reveAspect,
      reveResolution,
    } : {}),
    ...(raw === "hf_flux_pro" ? {
      fluxGuidanceScale: validGuidance(payload.fluxGuidanceScale),
      fluxSeed: validSeed(payload.fluxSeed),
      fluxNumImages: fluxNum,
    } : {}),
    ...(raw?.startsWith("kie_") ? {
      kieTempKey: args.kieTempKey || undefined,
      aspectRatio: payload.aspectRatio || undefined,
      imageResolution: (payload.imageResolution || undefined) as "1K" | "2K" | "4K" | undefined,
    } : {}),
    // #337 金泰（dreamina）CLI 生图专用参数（服务端按官方 -h 交叉夹取，非法回退默认）。
    ...(raw?.startsWith("jimeng_") ? {
      jimengImgModelVersion: resolveImageParam(raw, "jimengImgModelVersion", (payload as unknown as Record<string, unknown>).jimengImgModelVersion),
      jimengImgRatio: resolveImageParam(raw, "jimengImgRatio", (payload as unknown as Record<string, unknown>).jimengImgRatio),
      jimengImgResolutionType: resolveImageParam(raw, "jimengImgResolutionType", (payload as unknown as Record<string, unknown>).jimengImgResolutionType),
      jimengImgGenerateNum: resolveImageParam(raw, "jimengImgGenerateNum", (payload as unknown as Record<string, unknown>).jimengImgGenerateNum),
    } : {}),
    estimatedCost: costLabel || undefined,
  };
  return { input, refUrl, count, costLabel };
}
