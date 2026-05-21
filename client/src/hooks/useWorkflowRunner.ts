import { useState, useCallback } from "react";
import { useCanvasStore } from "./useCanvasStore";

export interface WorkflowRunState {
  running: boolean;
  currentNodeId: string | null;
  completedIds: string[];
  failedIds: string[];
  runnableCount: number; // set on start, 0 when not running
}

const INITIAL_STATE: WorkflowRunState = {
  running: false,
  currentNodeId: null,
  completedIds: [],
  failedIds: [],
  runnableCount: 0,
};

/** Group runnableIds into dependency layers using topological sort */
function getLayers(
  runnableIds: string[],
  edges: { source: string; target: string }[]
): string[][] {
  const idSet = new Set(runnableIds);
  const inDegree = new Map<string, number>(runnableIds.map((id) => [id, 0]));
  const adj = new Map<string, string[]>();

  edges.forEach((e) => {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    }
  });

  const layers: string[][] = [];
  let current = runnableIds.filter((id) => (inDegree.get(id) ?? 0) === 0);

  while (current.length > 0) {
    layers.push(current);
    const next: string[] = [];
    current.forEach((id) => {
      (adj.get(id) ?? []).forEach((targetId) => {
        const deg = (inDegree.get(targetId) ?? 1) - 1;
        inDegree.set(targetId, deg);
        if (deg === 0) next.push(targetId);
      });
    });
    current = next;
  }

  return layers;
}

/**
 * useWorkflowRunner — orchestrates parallel, layer-based execution of canvas nodes.
 *
 * Actual node execution is delegated to a caller-supplied `executeNode` callback so
 * this hook remains decoupled from tRPC / node-specific logic.
 */
export function useWorkflowRunner() {
  const [runState, setRunState] = useState<WorkflowRunState>(INITIAL_STATE);

  const { nodes, edges } = useCanvasStore();

  const runWorkflow = useCallback(
    async (
      executeNode: (nodeId: string) => Promise<void>,
      /** Optional: subset of node IDs to run. Defaults to all non-asset, non-note nodes. */
      nodeIds?: string[]
    ) => {
      // Determine which nodes are runnable
      const SKIP_TYPES = new Set(["asset", "note"]);
      const runnableIds =
        nodeIds ??
        nodes
          .filter((n) => !SKIP_TYPES.has(n.data.nodeType))
          .map((n) => n.id);

      if (runnableIds.length === 0) return;

      const completed: string[] = [];
      const failed: string[] = [];

      setRunState({
        running: true,
        currentNodeId: null,
        completedIds: [],
        failedIds: [],
        runnableCount: runnableIds.length,
      });

      // Build dependency layers
      const layers = getLayers(runnableIds, edges);

      const runSingleNode = async (nodeId: string): Promise<"ok" | "fail"> => {
        setRunState((s) => ({ ...s, currentNodeId: nodeId }));
        try {
          await executeNode(nodeId);
          completed.push(nodeId);
          return "ok";
        } catch {
          failed.push(nodeId);
          return "fail";
        }
      };

      for (const layer of layers) {
        await Promise.allSettled(layer.map(runSingleNode));
        // After each layer, update progress
        setRunState((s) => ({
          ...s,
          completedIds: [...completed],
          failedIds: [...failed],
          currentNodeId: null,
        }));
      }

      setRunState((s) => ({
        ...s,
        running: false,
        currentNodeId: null,
        completedIds: [...completed],
        failedIds: [...failed],
      }));
    },
    [nodes, edges]
  );

  const stopWorkflow = useCallback(() => {
    setRunState(INITIAL_STATE);
  }, []);

  return { runState, runWorkflow, stopWorkflow };
}
