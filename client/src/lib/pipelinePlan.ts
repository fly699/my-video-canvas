import type { PipelineStep, MergeNodeData } from "../../../shared/types";

// ── 管线下一步推导（智能体管线协同）─────────────────────────────────────────────
// apply 后确定性分析「本智能体名下」的画布结构：若构成分镜→成片管线（有分镜、
// 通常还有合并节点），生成一条有序的「下一步路线」引导卡。纯函数、零 LLM、单测友好。
//
// 为什么确定性推导而非让 LLM 给：下一步是固定的管线 SOP（镜头表批量生产 → 按镜头表
// 装配 → 内嵌字幕），由画布结构唯一决定——交给 LLM 只会引入幻觉与不一致。

interface PNode {
  id: string;
  data: { nodeType: string; payload?: unknown };
}

function ownerOf(n: PNode): string | undefined {
  return (n.data.payload as { ownerAgentId?: string } | undefined)?.ownerAgentId;
}

function sceneNum(n: PNode): number {
  const v = Number((n.data.payload as { sceneNumber?: number | string } | undefined)?.sceneNumber);
  return Number.isFinite(v) && v > 0 ? v : Number.POSITIVE_INFINITY;
}

/** 推导本智能体（agentId）刚铺好的分镜管线的「下一步」清单。
 *  无分镜 → 返回空（非分镜管线，如纯 comfyOnly prompt→workflow 不出引导卡）。 */
export function derivePipelineSteps(
  agentId: string,
  nodes: PNode[],
): PipelineStep[] {
  const mine = nodes.filter((n) => ownerOf(n) === agentId);
  const sbs = mine.filter((n) => n.data.nodeType === "storyboard");
  if (sbs.length === 0) return [];

  // 镜头表入口取镜号最小的分镜（与镜头表面板「同组」一致）。
  const firstSb = [...sbs].sort((a, b) => sceneNum(a) - sceneNum(b))[0];
  const steps: PipelineStep[] = [{
    action: "open_shotlist",
    targetId: firstSb.id,
    label: "打开镜头表批量生产",
    hint: `${sbs.length} 个分镜：在镜头表面板批量生成关键帧 → 视频 → 配音`,
  }];

  const merge = mine.find((n) => n.data.nodeType === "merge");
  if (merge) {
    const mp = merge.data.payload as MergeNodeData | undefined;
    steps.push({
      action: "assemble",
      targetId: merge.id,
      label: "按镜头表装配",
      hint: "视频出片后一键：镜号排序 + 逐镜转场 + 配音/音效对位",
      done: !!mp?.segTransitions,
    });
    steps.push({
      action: "burn_subtitle",
      targetId: merge.id,
      label: "成片内嵌字幕",
      hint: "用镜头表对白确定性烧字幕（零转录、零成本）",
      done: !!mp?.burnShotSubtitles,
    });
  }
  return steps;
}
