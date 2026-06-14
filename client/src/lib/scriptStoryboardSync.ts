import { useCanvasStore } from "../hooks/useCanvasStore";
import type { ScriptNodeData } from "../../../shared/types";

// 脚本↔分镜「过期」检测：脚本节点在已生成下游分镜后又被修改时，提示用户分镜可能
// 与最新脚本不一致，并提供「重新拆分镜」入口（提示而非自动覆盖，保留已编辑分镜）。

/** 零依赖字符串 hash（djb2，xor 变体）。同输入稳定、不同输入极少碰撞，足够做「内容是否变了」判断。 */
export function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i); // h * 33 ^ c
  }
  // 转无符号 36 进制，紧凑
  return (h >>> 0).toString(36);
}

type MinimalNode = { id: string; data: { nodeType?: string } };
type MinimalEdge = { source: string; target: string };

/** 纯函数：脚本节点 id 是否有下游分镜/ComfyUI 图像节点（任一方向算「下游」按 source→target）。 */
export function hasDownstreamStoryboard(id: string, nodes: MinimalNode[], edges: MinimalEdge[]): boolean {
  const outs = new Set(edges.filter((e) => e.source === id).map((e) => e.target));
  return nodes.some((n) => outs.has(n.id) && (n.data.nodeType === "storyboard" || n.data.nodeType === "comfyui_image"));
}

/** 从 store 读当前画布，判断脚本节点是否已有下游分镜。 */
export function hasDownstreamStoryboardForId(id: string): boolean {
  const { nodes, edges } = useCanvasStore.getState();
  return hasDownstreamStoryboard(
    id,
    nodes.map((n) => ({ id: n.id, data: { nodeType: n.data.nodeType } })),
    edges.map((e) => ({ source: e.source, target: e.target })),
  );
}

/**
 * 纯函数：判断下游分镜是否「已过期」（脚本在上次拆分镜后又改了）。
 * 仅当有下游分镜 + 记录过基线 hash + 当前 content hash 与基线不同 时为 true。
 * 存量节点（从未记录基线）返回 false，不误报。
 */
export function isStoryboardStale(
  payload: Pick<ScriptNodeData, "content" | "lastStoryboardContentHash">,
  hasStoryboards: boolean,
): boolean {
  if (!hasStoryboards) return false;
  const base = payload.lastStoryboardContentHash;
  if (!base) return false;
  return base !== hashContent(payload.content ?? "");
}
