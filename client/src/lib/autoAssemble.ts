import { getNodeVideoOutput } from "./canvasPassthrough";

// 「一键自动成片」：从选中的节点里挑出「已完成、有视频产出」的视频源，以及可选的一个
// 配乐音频源，产出装配方案。视频的排序与背景音乐识别都交给 MergeNode（按标题序号→Y 排序、
// 自动把连入的 audio 节点当配乐），这里只负责筛选 + 去重，保持纯函数便于测试。

export interface AutoAssemblePlan {
  /** 参与成片的视频源节点 id（顺序不重要，MergeNode 会再排序）。 */
  videoNodeIds: string[];
  /** 选中的配乐音频源节点 id（取第一个 audio / asset(音频)）；无则 null。 */
  audioNodeId: string | null;
}

interface MinNode {
  id: string;
  data: { nodeType: string; payload: Record<string, unknown> };
}

function isAudioSource(nodeType: string, p: Record<string, unknown>): boolean {
  const url = p.url;
  if (typeof url !== "string" || !url.trim()) return false;
  if (nodeType === "audio") return true;
  if (nodeType === "asset" && p.type === "audio") return true;
  return false;
}

export function planAutoAssemble(selected: MinNode[]): AutoAssemblePlan {
  const videoNodeIds: string[] = [];
  let audioNodeId: string | null = null;
  for (const n of selected) {
    const nt = n.data?.nodeType ?? "";
    const p = (n.data?.payload ?? {}) as Record<string, unknown>;
    // 配乐音频源优先判定（audio 节点的 url 不是视频，不能当视频轨，否则 FFmpeg 会炸）。
    if (isAudioSource(nt, p)) {
      if (!audioNodeId) audioNodeId = n.id;
      continue;
    }
    // 视频源：有可用视频产出（getNodeVideoOutput 会跳过图像/音频产出）。
    if (getNodeVideoOutput(nt, p as never)) videoNodeIds.push(n.id);
  }
  return { videoNodeIds, audioNodeId };
}
