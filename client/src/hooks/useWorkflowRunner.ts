import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "./useCanvasStore";
import { toast } from "sonner";
import type { NodeType } from "../../../shared/types";

export interface WorkflowRunState {
  running: boolean;
  currentNodeId: string | null;
  completedIds: string[];
  failedIds: string[];
}

const RUNNABLE_TYPES: NodeType[] = ["storyboard", "prompt", "image_gen", "video_task"];

/** Topological sort of reachable nodes from startId via DFS post-order. */
function getExecutionOrder(
  startId: string,
  nodes: { id: string; data: { nodeType: NodeType } }[],
  edges: { source: string; target: string }[]
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  const adj = new Map<string, string[]>();
  edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  });

  function dfs(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    (adj.get(id) ?? []).forEach(dfs);
    order.unshift(id);
  }
  dfs(startId);
  return order.filter(id => id !== startId);
}

export function useWorkflowRunner() {
  const [runState, setRunState] = useState<WorkflowRunState>({
    running: false, currentNodeId: null, completedIds: [], failedIds: [],
  });

  const abortRef = useRef(false);
  useEffect(() => {
    abortRef.current = false;
    return () => { abortRef.current = true; };
  }, []);

  const imageGenMutation = trpc.imageGen.generate.useMutation();
  const videoTaskMutation = trpc.videoTasks.create.useMutation();

  const runWorkflow = useCallback(async (startNodeId: string) => {
    const { nodes, edges } = useCanvasStore.getState();
    const execOrder = getExecutionOrder(startNodeId, nodes, edges);
    const runnableIds = execOrder.filter(id => {
      const node = nodes.find(n => n.id === id);
      return node && RUNNABLE_TYPES.includes(node.data.nodeType);
    });

    if (runnableIds.length === 0) {
      toast.info("没有可运行的节点（分镜/提示词/图像/视频）");
      return;
    }

    if (!abortRef.current) {
      setRunState({ running: true, currentNodeId: null, completedIds: [], failedIds: [] });
    }
    const completed: string[] = [];
    const failed: string[] = [];

    for (const nodeId of runnableIds) {
      if (abortRef.current) break;

      const node = useCanvasStore.getState().nodes.find(n => n.id === nodeId);
      if (!node) continue;

      if (!abortRef.current) setRunState(s => ({ ...s, currentNodeId: nodeId }));
      const p = node.data.payload as Record<string, unknown>;
      const nodeType = node.data.nodeType;

      try {
        if (nodeType === "storyboard" || nodeType === "prompt" || nodeType === "image_gen") {
          const prompt = (p.promptText as string) || (p.positivePrompt as string) || (p.prompt as string) || "";
          if (!prompt.trim()) { failed.push(nodeId); continue; }

          const result = await imageGenMutation.mutateAsync({
            prompt,
            negativePrompt: (p.negativePrompt as string) || undefined,
            style: (p.style as string) || undefined,
            model: ((p.imageModel as string) || (p.model as string)) as "manus_forge" | "poyo_flux" | "poyo_sdxl" | "hf_soul_standard" | "hf_reve" | undefined || undefined,
          });
          useCanvasStore.getState().updateNodeData(nodeId, { imageUrl: result.url });

          const downstreamUpdates = useCanvasStore.getState().edges
            .filter(e => e.source === nodeId)
            .flatMap(edge => {
              const target = useCanvasStore.getState().nodes.find(n => n.id === edge.target);
              return target?.data.nodeType === "video_task" && result.url
                ? [{ id: edge.target, payload: { referenceImageUrl: result.url } }]
                : [];
            });
          if (downstreamUpdates.length > 0) useCanvasStore.getState().batchUpdateNodeData(downstreamUpdates);
          completed.push(nodeId);

        } else if (nodeType === "video_task") {
          const prompt = (p.prompt as string) || "";
          if (!prompt.trim() && !(p.referenceImageUrl as string)) { failed.push(nodeId); continue; }

          const validProviders = ["mock", "poyo_seedance", "poyo_veo", "hf_dop_standard", "hf_dop_preview", "hf_dop_lite", "hf_dop_turbo", "hf_kling_21_pro", "hf_seedance_pro"] as const;
          type VideoProvider = typeof validProviders[number];
          const providerValue = (p.provider as string) || "poyo_seedance";
          const provider: VideoProvider = (validProviders as readonly string[]).includes(providerValue)
            ? providerValue as VideoProvider
            : "poyo_seedance";

          const task = await videoTaskMutation.mutateAsync({
            projectId: node.data.projectId,
            nodeId,
            provider,
            prompt: prompt || "cinematic video",
            referenceImageUrl: (p.referenceImageUrl as string) || undefined,
            params: (p.params as Record<string, unknown>) || {},
          });
          useCanvasStore.getState().updateNodeData(nodeId, { taskId: task.id, status: "processing" });
          completed.push(nodeId);
        }
      } catch {
        failed.push(nodeId);
        toast.error(`节点 "${node.data.title}" 执行失败`);
      }
    }

    if (!abortRef.current) {
      setRunState({ running: false, currentNodeId: null, completedIds: completed, failedIds: failed });
      const ok = completed.length;
      const ko = failed.length;
      if (ko === 0) {
        toast.success("工作流执行完成", { description: `${ok} 个节点成功`, duration: 5000 });
      } else {
        toast.warning("工作流执行完成", { description: `${ok} 成功，${ko} 失败`, duration: 5000 });
      }
    }
  }, [imageGenMutation, videoTaskMutation]);

  const reset = useCallback(() => {
    setRunState({ running: false, currentNodeId: null, completedIds: [], failedIds: [] });
  }, []);

  return { runWorkflow, runState, reset };
}
