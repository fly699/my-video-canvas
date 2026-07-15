// AI 客户端/对话节点「引用画布节点作上下文」的纯逻辑：把选中的画布节点编译成一段文本上下文，
// 随 aiChat.sendMessage 的 contextContent 传给 LLM。纯函数便于单测；节点与客户端共用同一实现。
import type { NodeType } from "../../../shared/types";

type MiniNode = {
  id: string;
  data: { nodeType: NodeType; title?: string; payload?: unknown };
};

const CONTEXT_CAP = 8000; // 与服务端 contextContent.max(8000) 对齐

/** 从节点 payload 里抽出「有意义的文本内容」（脚本/分镜描述/提示词/便签等）。 */
export function extractNodeText(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  return (
    pick("content") || pick("description") || pick("positivePrompt") ||
    pick("prompt") || pick("synopsis") || pick("ttsText") || pick("musicPrompt") || ""
  );
}

/** 把选中的画布节点编译成上下文文本（`[标题]: 内容` 逐行），封顶 8000 字符。无有效内容→undefined。 */
export function buildNodeContextContent(nodes: MiniNode[], contextNodeIds: string[] | undefined): string | undefined {
  const ids = Array.from(new Set(contextNodeIds ?? []));
  if (ids.length === 0) return undefined;
  const parts: string[] = [];
  for (const nodeId of ids) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const text = extractNodeText(node.data.payload);
    if (text) parts.push(`[${node.data.title || node.data.nodeType}]: ${text}`);
  }
  const joined = parts.join("\n\n");
  return (joined.length > CONTEXT_CAP ? joined.slice(0, CONTEXT_CAP) : joined) || undefined;
}

/** 画布节点在「引用选择器」里的显示标签：标题 → 类型；带类型后缀。 */
export function nodeContextLabel(node: MiniNode): string {
  const title = node.data.title?.trim();
  return title ? `${title}` : node.data.nodeType;
}

/** 可作为上下文引用的节点类型（含有文本内容或产物的节点；排除结构性/纯装饰节点）。 */
const REFERABLE = new Set<NodeType>([
  "script", "storyboard", "prompt", "character", "note", "image_gen", "video_task",
  "comfyui_image", "comfyui_video", "comfyui_workflow", "audio", "asset", "ai_chat", "merge", "clip",
]);
export function isReferableNode(node: MiniNode): boolean {
  return REFERABLE.has(node.data.nodeType);
}

// ── 回答一键落成画布节点 ────────────────────────────────────────────────────────
// type "reasoning" 为推理模型的「思考过程」（存 attachments、不进 content），无 url、内容在 text；
// 仅 AI 客户端渲染折叠展示，落成节点/图片渲染等都会跳过它。
export type ChatMsgAttachment = { type: "image" | "file" | "reasoning"; url?: string; mimeType?: string; name?: string; text?: string };
export type DropPlan = { nodeType: NodeType; payload: Record<string, unknown>; label: string };

/** 把一条 AI 回答编译成「落成画布节点」的计划：图片附件→asset 图像节点（各一个）；
 *  文本→note 便签（长文本截断进 content，完整内容仍保留）。返回可能多个节点计划。 */
export function planMessageDrop(content: string, attachments?: ChatMsgAttachment[]): DropPlan[] {
  const plans: DropPlan[] = [];
  for (const a of attachments ?? []) {
    if (a.type === "image" && a.url) {
      plans.push({ nodeType: "asset", payload: { type: "image", url: a.url, name: a.name || "AI 图片", ...(a.mimeType ? { mimeType: a.mimeType } : {}) }, label: "图片" });
    }
  }
  const text = (content ?? "").trim();
  if (text) plans.push({ nodeType: "note", payload: { content: text }, label: "便签" });
  return plans;
}
