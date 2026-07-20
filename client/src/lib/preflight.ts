import type { NodeType } from "../../../shared/types";
import { RUNNABLE_TYPES } from "./runnableTypes";
import { estimateNodesBudget, type BudgetEstimate } from "./agentBudget";
import { nearestUpstreamStoryboard } from "./inputOrder";

// 运行前体检（pre-flight）— a pure, side-effect-free scan of the canvas graph that
// surfaces problems which would make a run fail or produce nothing, plus a
// whole-canvas cost estimate. Kept framework-free so it's unit-testable.

export type PreflightSeverity = "error" | "warning";

export interface PreflightIssue {
  severity: PreflightSeverity;
  nodeId?: string;
  nodeTitle?: string;
  message: string;
}

export interface PreflightResult {
  issues: PreflightIssue[];
  errorCount: number;
  warningCount: number;
  runnableCount: number;
  budget: BudgetEstimate;
}

export interface PFNode {
  id: string;
  data: { nodeType: NodeType; title: string; payload?: Record<string, unknown> };
}
export interface PFEdge {
  source: string;
  target: string;
}

// Node types that consume upstream output and are useless without an input edge.
// 注：video_task 不在此列——它既可图生(需上游图)也可纯文生(t2v，仅需提示词)，单独判定，
// 否则一个有提示词、无连线的 t2v 节点会被误报「缺少输入」error。
const CONSUMER_TYPES: NodeType[] = [
  "merge", "subtitle", "overlay", "clip", "smart_cut", "subtitle_motion",
];

// Minimal "must be filled" fields per type. Deliberately conservative to avoid
// false positives on nodes the user is still editing.
const REQUIRED_FIELDS: Partial<Record<NodeType, { field: string; label: string }[]>> = {
  script: [{ field: "synopsis", label: "剧情梗概" }],
  storyboard: [{ field: "description", label: "分镜描述" }],
};

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Detect whether the directed graph (over the given node ids) contains a cycle. */
function findCycle(nodeIds: Set<string>, edges: PFEdge[]): boolean {
  const ids = Array.from(nodeIds);
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) adj.get(e.source)!.push(e.target);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);
  const stack: Array<{ id: string; idx: number }> = [];
  for (const start of ids) {
    if (color.get(start) !== WHITE) continue;
    stack.push({ id: start, idx: 0 });
    color.set(start, GRAY);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbors = adj.get(frame.id)!;
      if (frame.idx < neighbors.length) {
        const next = neighbors[frame.idx++];
        const c = color.get(next);
        if (c === GRAY) return true; // back-edge → cycle
        if (c === WHITE) { color.set(next, GRAY); stack.push({ id: next, idx: 0 }); }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }
  return false;
}

export function runPreflight(nodes: PFNode[], edges: PFEdge[]): PreflightResult {
  const issues: PreflightIssue[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const e of edges) {
    if (nodeIds.has(e.target)) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    if (nodeIds.has(e.source)) outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1);
  }

  // Skip agent / note / asset-only nodes — only generation-relevant nodes matter.
  const relevant = nodes.filter((n) => n.data.nodeType !== "agent" && n.data.nodeType !== "note");

  for (const n of relevant) {
    const t = n.data.nodeType;
    const p = n.data.payload ?? {};
    const inDeg = incoming.get(n.id) ?? 0;
    const outDeg = outgoing.get(n.id) ?? 0;

    // 1) 孤立节点：既无输入也无输出，永远不会参与运行。
    if (inDeg === 0 && outDeg === 0) {
      issues.push({ severity: "warning", nodeId: n.id, nodeTitle: n.data.title, message: `「${n.data.title}」是孤立节点（没有任何连接），不会参与运行` });
    }
    // 2) 缺输入：消费型节点没有上游输入，无法生成。
    else if (CONSUMER_TYPES.includes(t) && inDeg === 0) {
      issues.push({ severity: "error", nodeId: n.id, nodeTitle: n.data.title, message: `「${n.data.title}」缺少输入连接（${t} 需要上游内容才能运行）` });
    }
    // 2b) 视频任务：图生(上游/参考图)或文生(提示词)二者皆无 → 无法生成。
    else if (t === "video_task" && inDeg === 0 && isBlank(p.prompt) && isBlank(p.referenceImageUrl)) {
      issues.push({ severity: "error", nodeId: n.id, nodeTitle: n.data.title, message: `「${n.data.title}」缺少提示词或输入（视频任务需文字描述或上游图像才能生成）` });
    }
    // 3) 缺参：关键字段为空。
    for (const req of REQUIRED_FIELDS[t] ?? []) {
      if (isBlank(p[req.field])) {
        issues.push({ severity: "warning", nodeId: n.id, nodeTitle: n.data.title, message: `「${n.data.title}」未填写${req.label}` });
      }
    }
  }

  // 4) 循环依赖：会导致运行死锁/无法拓扑排序。
  if (findCycle(nodeIds, edges)) {
    issues.push({ severity: "error", message: "画布中存在循环依赖（节点首尾相连成环），无法确定运行顺序" });
  }

  // 5) 镜头表管线就绪：镜号缺失/重复会让「按镜头表装配」排序失准。
  //    仅在部分分镜已有镜号（说明在用镜头表）时提示，避免对随手画布产生噪声。
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sbs = relevant.filter((n) => n.data.nodeType === "storyboard");
  if (sbs.length >= 2) {
    const numOf = (n: PFNode) => Number((n.data.payload ?? {}).sceneNumber);
    const withNum = sbs.filter((n) => Number.isFinite(numOf(n)) && numOf(n) > 0);
    if (withNum.length > 0 && withNum.length < sbs.length) {
      issues.push({ severity: "warning", message: `有 ${sbs.length - withNum.length} 个分镜缺镜号（sceneNumber），装配成片时将排到末尾——建议在镜头表面板补全或一键重编号` });
    }
    const counts = new Map<number, number>();
    for (const n of withNum) counts.set(numOf(n), (counts.get(numOf(n)) ?? 0) + 1);
    const dups = Array.from(counts.entries()).filter(([, c]) => c > 1).map(([v]) => v).sort((a, b) => a - b);
    if (dups.length > 0) {
      issues.push({ severity: "warning", message: `分镜镜号重复（${dups.join("、")}），装配排序可能不符合预期——建议在镜头表面板一键重编号` });
    }
  }

  // 6) 合并节点「可装配未装配」：上游已有 ≥2 个出片且能回溯到分镜的视频，
  //    但尚未点「按镜头表装配」——提示一键获得镜号排序+逐镜转场+配音对位。
  for (const m of relevant.filter((n) => n.data.nodeType === "merge")) {
    const p = m.data.payload ?? {};
    if (p.segTransitions) continue; // 已装配
    let assemblable = 0;
    for (const e of edges) {
      if (e.target !== m.id) continue;
      const vn = byId.get(e.source);
      const vt = vn?.data.nodeType;
      if (!vn || (vt !== "video_task" && vt !== "comfyui_video" && vt !== "comfyui_workflow")) continue;
      const vp = vn.data.payload ?? {};
      if (vt === "comfyui_workflow" && vp.outputType === "image") continue; // 出图运行不算视频段
      if (!vp.resultVideoUrl && !vp.outputUrl) continue; // 未出片
      // #280 与 assembleFromStoryboards 同口径：多跳回溯（隔 image_gen 工位也认）。
      const hasSb = !!nearestUpstreamStoryboard(vn.id, edges, byId as never);
      if (hasSb) assemblable++;
    }
    if (assemblable >= 2) {
      issues.push({ severity: "warning", nodeId: m.id, nodeTitle: m.data.title, message: `「${m.data.title}」上游有 ${assemblable} 个可回溯到分镜的已出片视频，可点「按镜头表装配」自动完成镜号排序、逐镜转场与配音对位` });
    }
  }

  const runnableCount = relevant.filter((n) => RUNNABLE_TYPES.includes(n.data.nodeType)).length;
  const budget = estimateNodesBudget(relevant);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return { issues, errorCount, warningCount, runnableCount, budget };
}

/**
 * 组装「诊断修复」发给智能体的指令：确定性地点名运行失败的节点（id + 失败原因）
 * 与体检问题清单，让 LLM 针对清单逐项精准修复，而不是从摘要里自己猜哪里坏了。
 * 两个清单都为空时退回通用检查指令。纯函数，便于单测失败分支。
 */
export function buildSelfHealInstruction(nodes: PFNode[], issues: PreflightIssue[]): string {
  const failed = nodes
    .filter((n) => (n.data.payload as { status?: string } | undefined)?.status === "failed")
    .map((n) => {
      const em = ((n.data.payload as { errorMessage?: string }).errorMessage ?? "").trim();
      return `- ${n.data.title}（id=${n.id}）${em ? `：${em.length > 120 ? em.slice(0, 120) + "…" : em}` : ""}`;
    });
  const issueLines = issues.slice(0, 12).map((iss) =>
    `- [${iss.severity === "error" ? "错误" : "提醒"}] ${iss.nodeTitle ? `${iss.nodeTitle}（id=${iss.nodeId}）` : ""}${iss.message}`);
  if (failed.length === 0 && issueLines.length === 0) {
    return "请检查当前画布上运行失败或缺少必要参数的节点，并用 update / connect 操作给出修复方案。若无问题请说明。";
  }
  const parts: string[] = ["请精准修复以下画布问题。要求：针对每个问题的根因做最小化修复（优先 update 单个字段或补 connect），禁止删除重建节点；无法用画布操作解决的（如服务器未配置、余额不足、网络故障），不要乱改参数，在 reply 里说明原因和手动解决步骤。"];
  if (failed.length > 0) parts.push(`【运行失败的节点】（完整错误见画布摘要 error 字段）\n${failed.slice(0, 10).join("\n")}`);
  if (issueLines.length > 0) parts.push(`【体检发现】\n${issueLines.join("\n")}`);
  return parts.join("\n\n");
}
