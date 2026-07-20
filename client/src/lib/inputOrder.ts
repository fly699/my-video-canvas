// Deterministic ordering for a node's multiple graph inputs/outputs, so "参考图1
// / 参考图2", merge clip order, etc. are predictable AND visible. Order key:
//   1) the trailing number in the OTHER node's title (素材1 → 1, 分镜2 → 2)
//   2) the other node's Y position (top → bottom)
//   3) the original edge order (connection time)

export function trailingNumber(title?: string | null): number {
  if (!title) return Number.POSITIVE_INFINITY;
  const m = String(title).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

type OrderNode = { id: string; position?: { y?: number }; data?: { title?: string } };
type OrderEdge = { id: string; source: string; target: string };

export function compareUpstreamNodes(a: OrderNode | undefined, b: OrderNode | undefined, tieA = 0, tieB = 0): number {
  const ta = trailingNumber(a?.data?.title), tb = trailingNumber(b?.data?.title);
  if (ta !== tb) return ta - tb;
  const ya = a?.position?.y ?? 0, yb = b?.position?.y ?? 0;
  if (ya !== yb) return ya - yb;
  return tieA - tieB;
}

// ── #280 合并段序权威化：上游分镜镜号优先 ────────────────────────────────────
// 用户实报「合并节点的镜头排序总也做不对」。根因：合并段序此前只按
// 标题尾号→Y→连接序，与「镜头表 sceneNumber」这一用户最直觉的权威顺序脱节——
// 标题不带尾号（如“镜头 1：日出”尾号不在结尾）就退化成按画布 Y 坐标排，
// 场景分组布局下 Y 交错即乱序。这里把「最近上游分镜的 sceneNumber」提为第一
// 排序键（与「按镜头表装配」同一权威源），无镜号的段回退原口径殿后——
// 无分镜画布行为逐字节不变（sceneNumber 全 Infinity 时纯走 compareUpstreamNodes）。

type ShotNode = OrderNode & { data?: { title?: string; nodeType?: string; payload?: unknown } };

/** 单镜管线的「可穿透」中间节点类型：分镜→(这些)→视频 的链上回溯分镜时可跨过。
 *  刻意不含 merge/clip 等汇聚型节点——穿过它们会把别的镜头的分镜错认成本段的。 */
const SHOT_PASSTHROUGH = new Set(["image_gen", "comfyui_image", "prompt", "comfyui_workflow"]);

/** 最近上游分镜（多跳 BFS，默认深度 4）。#280 核心修复：标准管线是
 *  分镜→image_gen 出图工位→视频（imageFirst 也会强插 image_gen），一跳直查
 *  找不到分镜、镜号排序整体失效——必须能隔着单镜管线的中间节点回溯。
 *  同深度多源时按边序取第一个（确定性）。 */
export function nearestUpstreamStoryboard(
  nodeId: string,
  edges: { source: string; target: string }[],
  byId: Map<string, ShotNode>,
  maxDepth = 4,
): ShotNode | undefined {
  let frontier = [nodeId];
  const visited = new Set([nodeId]);
  for (let d = 0; d < maxDepth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of edges) {
        if (e.target !== id || visited.has(e.source)) continue;
        visited.add(e.source);
        const src = byId.get(e.source);
        if (!src) continue;
        if (src.data?.nodeType === "storyboard") return src;
        if (SHOT_PASSTHROUGH.has(src.data?.nodeType ?? "")) next.push(e.source);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return undefined;
}

/** #280 标题镜号识别（无分镜管线的段序兜底）：用户实报画布可以完全不用分镜节点——
 *  此时没有 sceneNumber 权威，旧口径只认「标题结尾的数字」，而助手起的标题多是
 *  「镜头 1：日出」「s2 海边」这种数字不在结尾的格式，尾号识别失败就退化成按画布
 *  Y 坐标排、正是乱序来源之一。这里按优先级识别：①结尾数字（与 trailingNumber
 *  同口径，兼容「素材1」）②「镜头N/镜N/第N镜/场N/sN/shotN/sceneN/#N」等常见镜号
 *  写法。刻意只在合并段序比较器里使用，不动 compareUpstreamNodes 的通用口径
 * （参考图序号/桩点标签等既有行为零回归）。 */
export function titleShotNumber(title?: string | null): number {
  if (!title) return Number.POSITIVE_INFINITY;
  const t = String(title);
  const tail = t.match(/(\d+)\s*$/);
  if (tail) return parseInt(tail[1], 10);
  // 长前缀在前（正则交替取先匹配者）：SH06/shot3/scene2/镜头1/第4镜/场5/s3/#7 都要认——
  // 用户实际画布就是「SH06 首帧」「SH11 视频」这种 SH 前缀镜号（实报截图）。
  const m = t.match(/(?:镜头|场景|shot|scene|sh|sc|镜|第|场|s|#)\s*0*(\d{1,4})/i);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

/** 最近上游分镜的镜号；无分镜/无有效镜号 → Infinity（排序时殿后）。 */
export function upstreamSceneNumber(
  nodeId: string,
  edges: { source: string; target: string }[],
  byId: Map<string, ShotNode>,
): number {
  const sb = nearestUpstreamStoryboard(nodeId, edges, byId);
  const n = Number((sb?.data?.payload as { sceneNumber?: unknown } | undefined)?.sceneNumber);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** 合并段序比较器工厂：分镜镜号（多跳回溯）→ 标题镜号（含「镜头N」等非尾号写法，
 *  覆盖【完全不用分镜节点】的画布）→ 标题尾号 → Y → 连接序。
 *  MergeNode 段列表与 useWorkflowRunner 的 collectInputVideoUrls 共用本工厂——
 *  逐节点「合并」按钮与「运行全部」两条路径的段顺序绝不允许漂移。 */
export function makeShotOrderComparator(
  byId: Map<string, ShotNode>,
  edges: { source: string; target: string }[],
): (aId: string, bId: string, tieA?: number, tieB?: number) => number {
  const cache = new Map<string, number>();
  const num = (id: string): number => {
    let v = cache.get(id);
    if (v === undefined) { v = upstreamSceneNumber(id, edges, byId); cache.set(id, v); }
    return v;
  };
  return (aId, bId, tieA = 0, tieB = 0) => {
    const na = num(aId), nb = num(bId);
    if (na !== nb) return na - nb;
    // 无分镜镜号时（含整张画布不用分镜的场景）：先比标题里的镜号——
    // 「镜头 1：日出」「s2 海边」这类数字不在结尾的标题也能排对。
    const ta = titleShotNumber(byId.get(aId)?.data?.title), tb = titleShotNumber(byId.get(bId)?.data?.title);
    if (ta !== tb) return ta - tb;
    return compareUpstreamNodes(byId.get(aId), byId.get(bId), tieA, tieB);
  };
}

/** 0-based index of `edgeId` among the edges on `side` of `nodeId`, ordered by
 *  the rule above. Returns -1 if the edge isn't on that side. */
export function edgeOrderIndex(
  edgeId: string,
  side: "in" | "out",
  nodeId: string,
  edges: OrderEdge[],
  nodes: OrderNode[],
): { index: number; total: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const other = (e: OrderEdge) => (side === "in" ? e.source : e.target);
  const rel = edges.map((e, i) => ({ e, i })).filter(({ e }) => (side === "in" ? e.target : e.source) === nodeId);
  rel.sort((a, b) => compareUpstreamNodes(byId.get(other(a.e)), byId.get(other(b.e)), a.i, b.i));
  return { index: rel.findIndex(({ e }) => e.id === edgeId), total: rel.length };
}
