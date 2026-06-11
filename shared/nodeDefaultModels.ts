// 节点默认模型 —— 中心化配置（client / server 共用）。
//
// 背景：此前各节点组件与服务端兜底各自硬编码默认模型（claude-sonnet-* / manus_forge），
// 散落数十处、口径不一。这里统一为「出厂默认 + 项目级可配置覆盖」一处定义。
//
// 解析优先级（高→低）：项目配置 perSlot 覆盖  >  项目配置 category 默认  >  出厂默认。

import type { NodeType } from "./types";

/** 一个节点可能持有的「模型槽位」类别。 */
export type ModelSlot = "llm" | "image" | "video";

/**
 * 出厂默认模型（项目级配置缺省时的兜底）。
 * - llm：除 ComfyUI 外的文本/对话/规划，以及 ComfyUI 节点的提示词翻译，统一用 kie Opus 4.7。
 * - image：生图统一用 kie GPT Image 2。
 * - video：非 ComfyUI 视频节点统一用 kie Grok Imagine 图生（i2v）。
 */
export const FACTORY_DEFAULT_MODELS: Record<ModelSlot, string> = {
  llm: "kie_claude_opus_47",
  image: "kie_gpt_image_2",
  video: "kie_grok_i2v",
};

/** 项目级「节点默认模型」配置。存于 projects.defaultModels（JSON 列）。 */
export interface NodeDefaultModelsConfig {
  /** 类别级默认，覆盖出厂默认。 */
  categories?: Partial<Record<ModelSlot, string>>;
  /** 按「节点类型 + 槽位」精确覆盖（最高优先级）。key 由 slotKey() 生成，如 "storyboard.image"。 */
  perSlot?: Record<string, string>;
}

/** 「节点类型 + 槽位」→ 覆盖表的 key。 */
export function slotKey(nodeType: NodeType, slot: ModelSlot): string {
  return `${nodeType}.${slot}`;
}

/**
 * 解析某节点某槽位应使用的默认模型。
 * 节点新建/未显式选择模型时调用；已有 payload.model 优先于本结果（在调用处用 ?? 串接）。
 */
export function resolveNodeModel(
  config: NodeDefaultModelsConfig | null | undefined,
  nodeType: NodeType,
  slot: ModelSlot,
): string {
  const exact = config?.perSlot?.[slotKey(nodeType, slot)];
  if (exact) return exact;
  const byCategory = config?.categories?.[slot];
  if (byCategory) return byCategory;
  return FACTORY_DEFAULT_MODELS[slot];
}

/** 解析「类别级」默认（不针对具体节点类型）：用于服务端兜底、以及无 nodeType 上下文处。 */
export function resolveCategoryModel(
  config: NodeDefaultModelsConfig | null | undefined,
  slot: ModelSlot,
): string {
  return config?.categories?.[slot] ?? FACTORY_DEFAULT_MODELS[slot];
}
