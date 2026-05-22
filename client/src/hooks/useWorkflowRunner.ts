import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "./useCanvasStore";
import { toast } from "sonner";
import type { NodeType } from "../../../shared/types";
import { VIDEO_PROVIDERS } from "../../../shared/types";

export interface WorkflowRunState {
  running: boolean;
  currentNodeId: string | null;
  completedIds: string[];
  failedIds: string[];
  runnableCount: number; // set on start, 0 when not running
}

const RUNNABLE_TYPES: NodeType[] = ["storyboard", "prompt", "image_gen", "video_task"];

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

  // Nodes that never reached inDegree=0 form a cycle — include them in a final
  // layer so the runner doesn't silently skip them.
  const placed = new Set(layers.flat());
  const cyclic = runnableIds.filter((id) => !placed.has(id));
  if (cyclic.length > 0) {
    console.warn("[useWorkflowRunner] Cycle detected among nodes:", cyclic, "— running them as a final layer.");
    layers.push(cyclic);
  }

  return layers;
}

export function useWorkflowRunner() {
  const [runState, setRunState] = useState<WorkflowRunState>({
    running: false,
    currentNodeId: null,
    completedIds: [],
    failedIds: [],
    runnableCount: 0,
  });

  const abortRef = useRef(false);
  useEffect(() => {
    abortRef.current = false;
    return () => { abortRef.current = true; };
  }, []);

  const imageGenMutation = trpc.imageGen.generate.useMutation();
  const videoTaskMutation = trpc.videoTasks.create.useMutation();

  const runWorkflow = useCallback(async (startNodeId: string | null) => {
    const { nodes, edges } = useCanvasStore.getState();

    // Determine which nodes are runnable
    let runnableIds: string[];
    if (startNodeId) {
      // Collect the start node + all its descendants (forward DFS).
      // Also collect all upstream ancestors of the start node so that their
      // outputs are available as inputs before the start node executes.
      const forwardAdj = new Map<string, string[]>();
      const reverseAdj = new Map<string, string[]>();
      edges.forEach((e) => {
        if (!forwardAdj.has(e.source)) forwardAdj.set(e.source, []);
        forwardAdj.get(e.source)!.push(e.target);
        if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, []);
        reverseAdj.get(e.target)!.push(e.source);
      });

      const visitedFwd = new Set<string>();
      const visitedRev = new Set<string>();
      const dfsForward = (id: string) => {
        if (visitedFwd.has(id)) return;
        visitedFwd.add(id);
        (forwardAdj.get(id) ?? []).forEach(dfsForward);
      };
      const dfsReverse = (id: string) => {
        if (visitedRev.has(id)) return;
        visitedRev.add(id);
        (reverseAdj.get(id) ?? []).forEach(dfsReverse);
      };

      // Collect ancestors (separate set so start node isn't pre-visited)
      dfsReverse(startNodeId);
      // Collect startNode and all descendants
      dfsForward(startNodeId);

      const allIds = new Set(Array.from(visitedRev).concat(Array.from(visitedFwd)));
      runnableIds = Array.from(allIds).filter((id) => {
        const node = nodes.find((n) => n.id === id);
        return node && RUNNABLE_TYPES.includes(node.data.nodeType);
      });
    } else {
      runnableIds = nodes
        .filter((n) => RUNNABLE_TYPES.includes(n.data.nodeType))
        .map((n) => n.id);
    }

    if (runnableIds.length === 0) {
      toast.info("没有可运行的节点（分镜/提示词/图像/视频）");
      return;
    }

    setRunState({
      running: true,
      currentNodeId: null,
      completedIds: [],
      failedIds: [],
      runnableCount: runnableIds.length,
    });

    const completed: string[] = [];
    const failed: string[] = [];

    // Build dependency layers for parallel execution
    const layers = getLayers(runnableIds, edges);

    const runSingleNode = async (nodeId: string): Promise<"ok" | "fail"> => {
      if (abortRef.current) return "fail";

      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      if (!node) return "fail";

      if (!abortRef.current) setRunState((s) => ({ ...s, currentNodeId: nodeId }));
      const p = node.data.payload as Record<string, unknown>;
      const nodeType = node.data.nodeType;

      try {
        if (nodeType === "storyboard" || nodeType === "prompt" || nodeType === "image_gen") {
          const prompt =
            (p.promptText as string) ||
            (p.positivePrompt as string) ||
            (p.prompt as string) ||
            "";
          if (!prompt.trim()) {
            failed.push(nodeId);
            return "fail";
          }

          const VALID_IMAGE_MODELS = new Set([
            "manus_forge", "poyo_flux", "poyo_sdxl",
            "poyo_gpt_image", "poyo_seedream", "poyo_grok_image", "poyo_wan_image",
            "hf_soul_standard", "hf_reve", "hf_seedream_v4", "hf_flux_pro",
          ]);
          const rawModel = (p.imageModel as string) || (p.model as string) || "";
          const result = await imageGenMutation.mutateAsync({
            prompt,
            negativePrompt: (p.negativePrompt as string) || undefined,
            style: (p.style as string) || undefined,
            model: (VALID_IMAGE_MODELS.has(rawModel) ? rawModel : undefined) as Parameters<typeof imageGenMutation.mutateAsync>[0]["model"],
            seed: typeof p.seed === "number" ? p.seed : undefined,
            batchSize: typeof p.batchSize === "number" ? p.batchSize : undefined,
            referenceImageUrl: (p.referenceImageUrl as string) || undefined,
            projectId: node.data.projectId,
          });
          const bestUrl = result.url ?? result.urls?.[0];
          useCanvasStore.getState().updateNodeData(nodeId, {
            imageUrl: bestUrl,
            ...(result.urls?.length ? { imageUrls: result.urls } : {}),
          });

          // Propagate image URL to connected video_task nodes
          const downstreamUpdates = useCanvasStore
            .getState()
            .edges.filter((e) => e.source === nodeId)
            .flatMap((edge) => {
              const target = useCanvasStore
                .getState()
                .nodes.find((n) => n.id === edge.target);
              return target?.data.nodeType === "video_task" && bestUrl
                ? [{ id: edge.target, payload: { referenceImageUrl: bestUrl } }]
                : [];
            });
          if (downstreamUpdates.length > 0) {
            useCanvasStore.getState().batchUpdateNodeData(downstreamUpdates);
          }
          completed.push(nodeId);
          return "ok";
        } else if (nodeType === "video_task") {
          const prompt = (p.prompt as string) || "";
          if (!prompt.trim() && !(p.referenceImageUrl as string)) {
            failed.push(nodeId);
            return "fail";
          }

          type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
          const providerValue = (p.provider as string) || "poyo_seedance";
          const provider: VideoProvider = (VIDEO_PROVIDERS as readonly string[]).includes(providerValue)
            ? (providerValue as VideoProvider)
            : "poyo_seedance";

          const task = await videoTaskMutation.mutateAsync({
            projectId: node.data.projectId,
            nodeId,
            provider,
            prompt: prompt || "cinematic video",
            referenceImageUrl: (p.referenceImageUrl as string) || undefined,
            params: (p.params as Record<string, unknown>) || {},
          });
          useCanvasStore
            .getState()
            .updateNodeData(nodeId, { taskId: task.id, status: "processing" });
          completed.push(nodeId);
          return "ok";
        }

        return "fail";
      } catch {
        failed.push(nodeId);
        toast.error(`节点 "${node.data.title}" 执行失败`);
        return "fail";
      }
    };

    // Execute layers in parallel, wait for each layer before starting next
    for (const layer of layers) {
      if (abortRef.current) break;
      await Promise.allSettled(layer.map(runSingleNode));
      // After each layer, update progress
      if (!abortRef.current) {
        setRunState((s) => ({
          ...s,
          completedIds: [...completed],
          failedIds: [...failed],
          currentNodeId: null,
        }));
      }
    }

    if (!abortRef.current) {
      setRunState({
        running: false,
        currentNodeId: null,
        completedIds: completed,
        failedIds: failed,
        runnableCount: 0,
      });
      const ok = completed.length;
      const ko = failed.length;
      if (ko === 0) {
        toast.success("工作流执行完成", { description: `${ok} 个节点成功`, duration: 5000 });
      } else {
        toast.warning("工作流执行完成", {
          description: `${ok} 成功，${ko} 失败`,
          duration: 5000,
        });
      }
    }
  }, [imageGenMutation, videoTaskMutation]);

  const reset = useCallback(() => {
    setRunState({
      running: false,
      currentNodeId: null,
      completedIds: [],
      failedIds: [],
      runnableCount: 0,
    });
  }, []);

  return { runWorkflow, runState, reset };
}
