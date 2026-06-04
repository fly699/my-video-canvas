// Canvas auto-layout — multiple "smart" arrangements the agent node can cycle
// through. No external layout lib (no dagre/elk); dependency layout reuses a
// toast-free copy of the workflow runner's topological getLayers.

interface LayoutNode {
  id: string;
  position: { x: number; y: number };
  data: { nodeType: string };
}
interface LayoutEdge { source: string; target: string }

const COL_GAP = 360;
const ROW_GAP = 240;

export interface LayoutOption { id: "dependency" | "grid" | "byType"; name: string }
export const LAYOUTS: LayoutOption[] = [
  { id: "dependency", name: "依赖分层（左→右）" },
  { id: "grid", name: "紧凑网格" },
  { id: "byType", name: "按类型分组" },
];

/** Topological layering (toast-free); cyclic/unreached nodes are appended as
 *  single-node layers so every node is always placed. */
function getLayers(ids: string[], edges: LayoutEdge[]): string[][] {
  const idSet = new Set(ids);
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
      (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    }
  }
  const layers: string[][] = [];
  let current = ids.filter((id) => (inDegree.get(id) ?? 0) === 0);
  while (current.length > 0) {
    layers.push(current);
    const next: string[] = [];
    for (const id of current) {
      for (const t of adj.get(id) ?? []) {
        const deg = (inDegree.get(t) ?? 1) - 1;
        inDegree.set(t, deg);
        if (deg === 0) next.push(t);
      }
    }
    current = next;
  }
  const placed = new Set(layers.flat());
  for (const id of ids) if (!placed.has(id)) layers.push([id]);
  return layers;
}

/** Compute new positions for `nodes` under the chosen layout. Returns only the
 *  position deltas; anchored at the nodes' current bounding-box top-left so the
 *  arrangement stays roughly where the user is looking. */
export function computeLayout(
  layoutId: LayoutOption["id"],
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): { id: string; position: { x: number; y: number } }[] {
  if (nodes.length === 0) return [];
  const originX = Math.min(...nodes.map((n) => n.position.x));
  const originY = Math.min(...nodes.map((n) => n.position.y));

  if (layoutId === "grid") {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    return nodes.map((n, i) => ({
      id: n.id,
      position: { x: originX + (i % cols) * COL_GAP, y: originY + Math.floor(i / cols) * ROW_GAP },
    }));
  }

  if (layoutId === "byType") {
    const groups = new Map<string, string[]>();
    for (const n of nodes) (groups.get(n.data.nodeType) ?? groups.set(n.data.nodeType, []).get(n.data.nodeType)!).push(n.id);
    const out: { id: string; position: { x: number; y: number } }[] = [];
    let col = 0;
    for (const ids of Array.from(groups.values())) {
      ids.forEach((id: string, row: number) => out.push({ id, position: { x: originX + col * COL_GAP, y: originY + row * ROW_GAP } }));
      col++;
    }
    return out;
  }

  // dependency: each topological layer is a column (left→right), nodes stacked
  // within a column ordered by their current y.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layers = getLayers(nodes.map((n) => n.id), edges);
  const out: { id: string; position: { x: number; y: number } }[] = [];
  layers.forEach((layer, col) => {
    [...layer]
      .sort((a, b) => (byId.get(a)!.position.y) - (byId.get(b)!.position.y))
      .forEach((id, row) => out.push({ id, position: { x: originX + col * COL_GAP, y: originY + row * ROW_GAP } }));
  });
  return out;
}
