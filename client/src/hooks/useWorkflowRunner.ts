import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore, type CanvasNode } from "./useCanvasStore";
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

const RUNNABLE_TYPES: NodeType[] = [
  "storyboard", "prompt", "image_gen", "video_task",
  "clip", "merge", "subtitle", "overlay",
];

const VIDEO_SOURCE_TYPES = new Set(["video_task", "clip", "merge", "overlay", "asset", "subtitle"]);

/** Pick the video output URL from a node's payload regardless of which field it uses. */
function getNodeVideoUrl(payload: Record<string, unknown>): string | undefined {
  return (payload.resultVideoUrl ?? payload.outputUrl ?? payload.url) as string | undefined;
}

/** Auto-detect the first available video URL from nodes connected into targetId. */
function autoDetectInputVideo(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CanvasNode[],
): string | undefined {
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const src = nodes.find((n) => n.id === edge.source);
    if (!src || !VIDEO_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const url = getNodeVideoUrl(src.data.payload as Record<string, unknown>);
    if (url) return url;
  }
  return undefined;
}

/** Collect all video URLs from nodes connected into targetId. */
function collectInputVideoUrls(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CanvasNode[],
): string[] {
  const urls: string[] = [];
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const src = nodes.find((n) => n.id === edge.source);
    if (!src || !VIDEO_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const url = getNodeVideoUrl(src.data.payload as Record<string, unknown>);
    if (url) urls.push(url);
  }
  return urls;
}

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

  // Nodes that never reached inDegree=0 form a cycle — warn and include as a final layer.
  const placed = new Set(layers.flat());
  const cyclic = runnableIds.filter((id) => !placed.has(id));
  if (cyclic.length > 0) {
    toast.warning(`检测到节点循环依赖，将单独执行（${cyclic.length} 个节点）`);
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
  const clipMutation = trpc.clip.trimVideo.useMutation();
  const mergeMutation = trpc.merge.mergeVideos.useMutation();
  const subtitleTranscribeMutation = trpc.subtitle.transcribe.useMutation();
  const subtitleBurnMutation = trpc.subtitle.burnIn.useMutation();
  const overlayMutation = trpc.overlay.process.useMutation();

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
      toast.info("没有可运行的节点");
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

      // Skip if any direct upstream dependency already failed — avoids wasting
      // API credits on nodes whose inputs will be undefined/invalid.
      const hasFailedUpstream = edges.some(
        (e) => e.target === nodeId && failed.includes(e.source)
      );
      if (hasFailedUpstream) {
        failed.push(nodeId);
        return "fail";
      }

      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      if (!node) return "fail";

      if (!abortRef.current) setRunState((s) => ({ ...s, currentNodeId: nodeId }));
      const p = node.data.payload as Record<string, unknown>;
      const nodeType = node.data.nodeType;

      try {
        // ── Image generation (storyboard / prompt / image_gen) ──────────────
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
          }, true);

          // Propagate image URL to connected video_task nodes
          const { edges: currentEdges, nodes: currentNodes } = useCanvasStore.getState();
          const downstreamUpdates = currentEdges
            .filter((e) => e.source === nodeId)
            .flatMap((edge) => {
              const target = currentNodes.find((n) => n.id === edge.target);
              return target?.data.nodeType === "video_task" && bestUrl
                ? [{ id: edge.target, payload: { referenceImageUrl: bestUrl } }]
                : [];
            });
          if (downstreamUpdates.length > 0) {
            useCanvasStore.getState().batchUpdateNodeData(downstreamUpdates);
          }
          completed.push(nodeId);
          return "ok";

        // ── Video task ──────────────────────────────────────────────────────
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
            .updateNodeData(nodeId, { taskId: task.id, status: "processing" }, true);
          completed.push(nodeId);
          return "ok";

        // ── Clip / trim ─────────────────────────────────────────────────────
        } else if (nodeType === "clip") {
          const { nodes: ns, edges: es } = useCanvasStore.getState();
          const inputUrl =
            (p.inputVideoUrl as string) ||
            autoDetectInputVideo(nodeId, es, ns);
          if (!inputUrl) {
            toast.error(`节点 "${node.data.title}"：未找到视频输入`);
            failed.push(nodeId);
            return "fail";
          }
          const startTime = typeof p.startTime === "number" ? p.startTime : 0;
          const endTime = typeof p.endTime === "number" ? p.endTime : (p.sourceDuration as number ?? 0);
          if (endTime <= startTime) {
            toast.error(`节点 "${node.data.title}"：出点必须大于入点`);
            failed.push(nodeId);
            return "fail";
          }
          const result = await clipMutation.mutateAsync({
            inputUrl,
            startTime,
            endTime,
            speed: typeof p.speed === "number" && Math.abs(p.speed - 1.0) > 0.01 ? p.speed : undefined,
            audioUrl: (p.inputAudioUrl as string) || undefined,
            audioVolume: typeof p.audioVolume === "number" ? p.audioVolume : undefined,
          });
          useCanvasStore.getState().updateNodeData(nodeId, {
            outputUrl: result.url,
            outputDuration: result.duration,
            status: "done",
          }, true);
          completed.push(nodeId);
          return "ok";

        // ── Merge ───────────────────────────────────────────────────────────
        } else if (nodeType === "merge") {
          const { nodes: ns, edges: es } = useCanvasStore.getState();
          const inputUrls: string[] = (p.inputVideoUrls as string[] | undefined)?.length
            ? (p.inputVideoUrls as string[])
            : collectInputVideoUrls(nodeId, es, ns);
          if (inputUrls.length < 2) {
            toast.error(`节点 "${node.data.title}"：至少需要 2 个视频输入`);
            failed.push(nodeId);
            return "fail";
          }
          const result = await mergeMutation.mutateAsync({
            inputUrls,
            transition: (p.transition as "none" | "fade" | "dissolve") || undefined,
            transitionDuration: typeof p.transitionDuration === "number" ? p.transitionDuration : undefined,
            bgMusicUrl: (p.bgMusicUrl as string) || undefined,
            bgMusicVolume: typeof p.bgMusicVolume === "number" ? p.bgMusicVolume : undefined,
          });
          useCanvasStore.getState().updateNodeData(nodeId, {
            outputUrl: result.url,
            outputDuration: result.duration,
            status: "done",
          }, true);
          completed.push(nodeId);
          return "ok";

        // ── Subtitle ────────────────────────────────────────────────────────
        } else if (nodeType === "subtitle") {
          const { nodes: ns, edges: es } = useCanvasStore.getState();
          const videoUrl =
            (p.inputVideoUrl as string) ||
            autoDetectInputVideo(nodeId, es, ns);
          if (!videoUrl) {
            toast.error(`节点 "${node.data.title}"：未找到视频输入`);
            failed.push(nodeId);
            return "fail";
          }

          let entries = p.entries as Array<{ start: number; end: number; text: string }> | undefined;

          // Step 1: transcribe if no entries yet
          if (!entries?.length) {
            const transcribeResult = await subtitleTranscribeMutation.mutateAsync({
              audioUrl: videoUrl,
              language: (p.language as string) || undefined,
            });
            entries = transcribeResult.entries;
            useCanvasStore.getState().updateNodeData(nodeId, {
              entries,
              language: transcribeResult.language,
            }, true);
          }

          // Step 2: burn-in if enabled
          if (p.burnInEnabled && entries?.length) {
            const burnResult = await subtitleBurnMutation.mutateAsync({
              videoUrl,
              entries,
              fontSize: typeof p.fontSize === "number" ? p.fontSize : undefined,
              fontColor: (p.fontColor as string) || undefined,
            });
            useCanvasStore.getState().updateNodeData(nodeId, {
              outputUrl: burnResult.url,
              status: "done",
            }, true);
          } else {
            useCanvasStore.getState().updateNodeData(nodeId, { status: "done" }, true);
          }
          completed.push(nodeId);
          return "ok";

        // ── Overlay ─────────────────────────────────────────────────────────
        } else if (nodeType === "overlay") {
          const { nodes: ns, edges: es } = useCanvasStore.getState();
          const inputUrl =
            (p.inputVideoUrl as string) ||
            autoDetectInputVideo(nodeId, es, ns);
          if (!inputUrl) {
            toast.error(`节点 "${node.data.title}"：未找到视频输入`);
            failed.push(nodeId);
            return "fail";
          }
          const mode = (p.mode as "watermark" | "pip" | "color_correction") || "watermark";
          if (mode === "watermark" && !(p.overlayImageUrl as string)) {
            toast.error(`节点 "${node.data.title}"：水印模式需要叠加图片`);
            failed.push(nodeId);
            return "fail";
          }
          if (mode === "pip" && !(p.pipVideoUrl as string)) {
            toast.error(`节点 "${node.data.title}"：画中画模式需要 PiP 视频`);
            failed.push(nodeId);
            return "fail";
          }
          const result = await overlayMutation.mutateAsync({
            inputUrl,
            mode,
            overlayImageUrl: (p.overlayImageUrl as string) || undefined,
            overlayPosition: (p.overlayPosition as "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center") || undefined,
            overlayScale: typeof p.overlayScale === "number" ? p.overlayScale : undefined,
            overlayOpacity: typeof p.overlayOpacity === "number" ? p.overlayOpacity : undefined,
            pipVideoUrl: (p.pipVideoUrl as string) || undefined,
            pipPosition: (p.pipPosition as "top-left" | "top-right" | "bottom-left" | "bottom-right") || undefined,
            pipScale: typeof p.pipScale === "number" ? p.pipScale : undefined,
            brightness: typeof p.brightness === "number" ? p.brightness : undefined,
            contrast: typeof p.contrast === "number" ? p.contrast : undefined,
            saturation: typeof p.saturation === "number" ? p.saturation : undefined,
          });
          useCanvasStore.getState().updateNodeData(nodeId, {
            outputUrl: result.url,
            status: "done",
          }, true);
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
      const { nodes: finalNodes } = useCanvasStore.getState();
      if (ko === 0) {
        toast.success("工作流执行完成", { description: `${ok} 个节点成功`, duration: 5000 });
      } else {
        const failedNames = failed
          .map((fid) => finalNodes.find((n) => n.id === fid)?.data.title ?? fid)
          .join("、");
        toast.warning("工作流执行完成", {
          description: `${ok} 成功，${ko} 失败：${failedNames}`,
          duration: 8000,
        });
      }
    }
  }, [imageGenMutation, videoTaskMutation, clipMutation, mergeMutation, subtitleTranscribeMutation, subtitleBurnMutation, overlayMutation]);

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
