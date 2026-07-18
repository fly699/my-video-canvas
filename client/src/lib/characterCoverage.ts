// #225 批②「已覆盖 N 镜」：角色节点连入下游生成节点的覆盖统计（纯函数，单测覆盖）。
// total   = 以该角色为 source 的边所指向的【生成节点】数（唯一目标计数——同一目标多条边只算一次）；
// withRef = 其中 payload 任意字段包含该角色主参考图 URL 的数量（「应用到分镜」与助手自动接线
//           写入的字段名各异——storyboard.referenceImageUrl / image_gen.refImages / comfy IPAdapter
//           等，用 JSON 包含判定统一覆盖，避免逐类型枚举漏项）。

/** 视为「镜头/生成节点」的下游类型（与角色注入运行时消费方一致）。 */
export const COVERAGE_GEN_TYPES: readonly string[] = [
  "storyboard", "image_gen", "video_task", "comfyui_image", "comfyui_video", "comfyui_workflow",
];

export interface CoverageEdge { source: string; target: string }
export interface CoverageNode { id: string; nodeType: string; payload?: unknown }

export function countCharacterCoverage(
  characterId: string,
  mainRefUrl: string | undefined | null,
  edges: CoverageEdge[],
  nodes: CoverageNode[],
): { total: number; withRef: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const mainRef = (mainRefUrl ?? "").trim();
  const seen = new Set<string>();
  let withRef = 0;
  for (const e of edges) {
    if (e.source !== characterId || seen.has(e.target)) continue;
    const t = byId.get(e.target);
    if (!t || !COVERAGE_GEN_TYPES.includes(t.nodeType)) continue;
    seen.add(e.target);
    if (mainRef && JSON.stringify(t.payload ?? {}).includes(mainRef)) withRef++;
  }
  return { total: seen.size, withRef };
}
