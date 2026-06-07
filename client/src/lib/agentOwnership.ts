// Multi-agent ownership: nodes created by an agent carry `payload.ownerAgentId`
// (stamped in agentApply). These helpers scope selection / running / clearing and
// drive the per-owner color badge so several agents can co-exist on one canvas,
// each managing only its own subgraph.

type MiniNode = { id: string; data: { nodeType: string; title?: string; payload?: unknown } };

/** Read the agent id that owns a node (undefined if none). */
export function ownerAgentIdOf(node: { data: { payload?: unknown } }): string | undefined {
  const p = node.data.payload as { ownerAgentId?: unknown } | undefined;
  return typeof p?.ownerAgentId === "string" ? p.ownerAgentId : undefined;
}

/** Ids of all nodes owned by the given agent. */
export function ownedNodeIds<T extends MiniNode>(nodes: T[], agentId: string): string[] {
  return nodes.filter((n) => ownerAgentIdOf(n) === agentId).map((n) => n.id);
}

// A small, fixed, high-contrast palette; assigned by the agent's stable order on the
// canvas so colors stay consistent and distinct across agents.
const OWNER_PALETTE = [
  "oklch(0.70 0.18 25)",   // red
  "oklch(0.70 0.17 145)",  // green
  "oklch(0.68 0.16 250)",  // blue
  "oklch(0.74 0.16 85)",   // amber
  "oklch(0.68 0.20 320)",  // magenta
  "oklch(0.72 0.15 195)",  // teal
  "oklch(0.70 0.17 50)",   // orange
  "oklch(0.66 0.18 285)",  // violet
];

/** Deterministic color + 1-based index for an agent, by its order among all agent
 *  nodes on the canvas (sorted by id for stability). */
export function agentBadge(
  agentId: string,
  nodes: MiniNode[],
): { color: string; index: number } {
  const agentIds = nodes.filter((n) => n.data.nodeType === "agent").map((n) => n.id).sort();
  const idx = agentIds.indexOf(agentId);
  const i = idx < 0 ? 0 : idx;
  return { color: OWNER_PALETTE[i % OWNER_PALETTE.length], index: i + 1 };
}
