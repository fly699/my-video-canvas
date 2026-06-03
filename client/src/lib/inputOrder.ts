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
