import type { ScriptEpisode } from "../../../shared/types";

// 把短剧「分集大纲」拆成独立脚本子节点的布局/内容计算（纯函数，便于单测）。
// 每集 → 一个脚本节点（synopsis 填该集大纲，content 留空待生成），纵向错开排在
// 父脚本节点右侧，并用一个分组框包裹。

export const EPISODE_NODE_DX = 560; // 子节点相对父节点的横向偏移
export const EPISODE_NODE_DY = 260; // 子节点之间的纵向间距
const NODE_W = 320;
const NODE_H = 210;
const PAD = 30;

export type EpisodeNodeSpec = { position: { x: number; y: number }; synopsis: string };
export type EpisodeSplitPlan = {
  items: EpisodeNodeSpec[];
  group: { x: number; y: number; width: number; height: number };
};

/** 单集 → synopsis 文本（标题 + 钩子 + 剧情 + 卡点，缺项跳过）。 */
export function episodeSynopsis(ep: ScriptEpisode): string {
  return [
    `第${ep.episode}集 ${ep.title}`.trim(),
    ep.hook && `钩子：${ep.hook}`,
    ep.summary,
    ep.cliffhanger && `卡点：${ep.cliffhanger}`,
  ].filter(Boolean).join("\n");
}

/** 计算每个分集子节点的位置与内容 + 包裹用的分组框。 */
export function buildEpisodeNodes(
  episodes: ScriptEpisode[],
  basePos: { x: number; y: number },
): EpisodeSplitPlan {
  const baseX = basePos.x + EPISODE_NODE_DX;
  const items: EpisodeNodeSpec[] = episodes.map((ep, i) => ({
    position: { x: baseX, y: basePos.y + i * EPISODE_NODE_DY },
    synopsis: episodeSynopsis(ep),
  }));
  const count = Math.max(1, episodes.length);
  const group = {
    x: baseX - PAD,
    y: basePos.y - PAD,
    width: NODE_W + PAD * 2,
    height: (count - 1) * EPISODE_NODE_DY + NODE_H + PAD * 2,
  };
  return { items, group };
}
