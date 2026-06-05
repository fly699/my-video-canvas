import type { AgentOperation } from "../../../shared/types";

// Deterministic "成片配方" — one click expands a recipe into a full node chain
// (skeleton + sensible defaults), applied through the same applyAgentOperations
// path as the agent's own output. Faster and more reliable than free-form chat
// for common formats; the user (or the agent) then fills/refines the content.

export interface AgentRecipe {
  id: string;
  name: string;
  desc: string;
  /** Build the operation list. `topic` seeds titles/synopsis when provided. */
  build: (topic?: string) => AgentOperation[];
}

// Helper: a script → N storyboards → N video_task → merge chain.
function shotChain(opts: {
  synopsis: string;
  shots: string[];          // per-shot description
  durationEach?: number;
  aspectHint?: string;      // e.g. "9:16 竖屏"
}): AgentOperation[] {
  const ops: AgentOperation[] = [];
  ops.push({ op: "create", nodeType: "script", tempId: "script", title: "脚本", payload: { synopsis: `${opts.synopsis}（${opts.aspectHint ?? "16:9"}）`, aiSceneCount: opts.shots.length } });
  opts.shots.forEach((desc, i) => {
    const sb = `sb${i + 1}`;
    const vt = `vt${i + 1}`;
    ops.push({ op: "create", nodeType: "storyboard", tempId: sb, title: `分镜${i + 1}`, payload: { description: desc, duration: opts.durationEach ?? 5 } });
    ops.push({ op: "create", nodeType: "video_task", tempId: vt, title: `视频${i + 1}`, payload: {} });
    ops.push({ op: "connect", sourceRef: "script", targetRef: sb });
    ops.push({ op: "connect", sourceRef: sb, targetRef: vt });
    ops.push({ op: "connect", sourceRef: vt, targetRef: "merge" });
  });
  ops.push({ op: "create", nodeType: "merge", tempId: "merge", title: "合并成片", payload: { transition: "fade", transitionDuration: 0.5 } });
  return ops;
}

export const AGENT_RECIPES: AgentRecipe[] = [
  {
    id: "vertical_promo",
    name: "竖屏宣传片（3镜）",
    desc: "脚本 → 3 分镜 → 3 视频 → 合并（9:16）",
    build: (topic) => shotChain({
      synopsis: topic?.trim() || "产品/品牌竖屏宣传短片",
      aspectHint: "9:16 竖屏",
      durationEach: 4,
      shots: ["开场：抓眼球的产品/主体特写", "中段：卖点 / 使用场景展示", "收尾：品牌露出 + 行动号召"],
    }),
  },
  {
    id: "drama_4shot",
    name: "狗血短剧（4镜）",
    desc: "脚本 → 4 分镜 → 4 视频 → 合并",
    build: (topic) => shotChain({
      synopsis: topic?.trim() || "强冲突反转狗血短剧",
      aspectHint: "9:16 竖屏",
      durationEach: 6,
      shots: ["设定与矛盾铺垫", "冲突激化", "高潮反转", "结局与情绪收束"],
    }),
  },
  {
    id: "talking_sell",
    name: "口播带货",
    desc: "脚本 → 分镜 → 图像 → 视频 → 字幕 → 合并 + 配音",
    build: (topic) => {
      const ops: AgentOperation[] = [];
      ops.push({ op: "create", nodeType: "script", tempId: "script", title: "口播脚本", payload: { synopsis: topic?.trim() || "单品口播带货脚本（痛点→卖点→促单）", aiSceneCount: 1 } });
      ops.push({ op: "create", nodeType: "storyboard", tempId: "sb", title: "主画面", payload: { description: "主播/产品口播主画面", duration: 15 } });
      ops.push({ op: "create", nodeType: "image_gen", tempId: "img", title: "产品图", payload: {} });
      ops.push({ op: "create", nodeType: "video_task", tempId: "vt", title: "口播视频", payload: {} });
      ops.push({ op: "create", nodeType: "audio", tempId: "voice", title: "配音", payload: { audioCategory: "voice" } });
      ops.push({ op: "create", nodeType: "subtitle", tempId: "sub", title: "字幕", payload: {} });
      ops.push({ op: "create", nodeType: "merge", tempId: "merge", title: "合并成片", payload: { transition: "none" } });
      ops.push({ op: "connect", sourceRef: "script", targetRef: "sb" });
      ops.push({ op: "connect", sourceRef: "sb", targetRef: "img" });
      ops.push({ op: "connect", sourceRef: "img", targetRef: "vt" });
      ops.push({ op: "connect", sourceRef: "vt", targetRef: "sub" });
      ops.push({ op: "connect", sourceRef: "sub", targetRef: "merge" });
      ops.push({ op: "connect", sourceRef: "voice", targetRef: "merge" });
      return ops;
    },
  },
];
