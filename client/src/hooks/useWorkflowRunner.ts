import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore, type CanvasNode } from "./useCanvasStore";
import { toast } from "sonner";
import type { NodeType, WorkflowParamBinding } from "../../../shared/types";
import { VIDEO_PROVIDERS } from "../../../shared/types";
import { detectUpstreamImageUrl, resolveWorkflowImageParams } from "../lib/comfyWorkflowParams";
import { computeRefImageUpdates } from "../lib/refImagePropagation";
import { handleWhitelistError } from "./useWhitelistBlocked";

export type NodeRunPhase = "pending" | "running" | "done" | "failed" | "skipped";

export interface NodeRunStatus {
  phase: NodeRunPhase;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface WorkflowRunState {
  running: boolean;
  currentNodeId: string | null;
  completedIds: string[];
  failedIds: string[];
  runnableCount: number; // set on start, 0 when not running
  // Per-node detailed status — populated for nodes participating in the run,
  // preserved after run completes so the status panel keeps its history until
  // the next run starts or user resets.
  nodeStates: Record<string, NodeRunStatus>;
}

export const RUNNABLE_TYPES: NodeType[] = [
  "storyboard", "prompt", "image_gen", "video_task",
  "clip", "merge", "subtitle", "overlay",
  "subtitle_motion", "smart_cut",
  "comfyui_image", "comfyui_video", "comfyui_workflow",
];

const VIDEO_SOURCE_TYPES = new Set(["video_task", "clip", "merge", "overlay", "asset", "subtitle", "subtitle_motion", "smart_cut", "comfyui_video", "comfyui_workflow"]);

/** Pick the video output URL from a node's payload regardless of which field it uses. */
function getNodeVideoUrl(payload: Record<string, unknown>): string | undefined {
  return (payload.resultVideoUrl ?? payload.outputUrl ?? payload.url) as string | undefined;
}

/** Return false for audio-mime asset nodes so they never feed into video pipelines. */
function isVideoAsset(nodeType: string, payload: Record<string, unknown>): boolean {
  if (nodeType === "asset") {
    const mt = payload.mimeType as string | undefined;
    if (mt?.startsWith("audio/")) return false;
  }
  return true;
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
    const payload = src.data.payload as Record<string, unknown>;
    if (!isVideoAsset(src.data.nodeType, payload)) continue;
    const url = getNodeVideoUrl(payload);
    if (url) return url;
  }
  return undefined;
}

/** Auto-detect a connected audio node (AudioNode or audio-mime AssetNode) for bgMusic. */
function detectBgMusicUrl(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CanvasNode[],
): string | undefined {
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const src = nodes.find((n) => n.id === edge.source);
    if (!src) continue;
    if (src.data.nodeType === "audio") {
      const u = (src.data.payload as { url?: string }).url;
      if (u) return u;
    }
    if (src.data.nodeType === "asset") {
      const p = src.data.payload as { mimeType?: string; url?: string };
      if (p.mimeType?.startsWith("audio/") && p.url) return p.url;
    }
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
    const payload = src.data.payload as Record<string, unknown>;
    if (!isVideoAsset(src.data.nodeType, payload)) continue;
    const url = getNodeVideoUrl(payload);
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

  // Nodes that never reached inDegree=0 form a cycle — warn and run them one
  // at a time (each as a single-element layer) to avoid concurrent state mutations.
  const placed = new Set(layers.flat());
  const cyclic = runnableIds.filter((id) => !placed.has(id));
  if (cyclic.length > 0) {
    toast.warning(`检测到节点循环依赖，将逐个顺序执行（${cyclic.length} 个节点）`);
    cyclic.forEach((id) => layers.push([id]));
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
    nodeStates: {},
  });

  const abortRef = useRef(false);
  const runningRef = useRef(false);
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
  const smartCutMutation = trpc.clip.smartCut.useMutation();
  const subtitleMotionTranscribeMutation = trpc.subtitleMotion.transcribe.useMutation();
  const subtitleMotionBurnMutation = trpc.subtitleMotion.burnMotion.useMutation();
  const comfyuiImageMutation = trpc.comfyui.generateImage.useMutation();
  const comfyuiVideoMutation = trpc.comfyui.generateVideo.useMutation();
  const comfyuiWorkflowMutation = trpc.comfyui.executeWorkflow.useMutation();

  const runWorkflow = useCallback(async (startNodeId: string | null) => {
    if (runningRef.current) return;
    runningRef.current = true;
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
      runningRef.current = false;
      toast.info("没有可运行的节点");
      return;
    }

    // Initialize per-node states: all participating nodes start as "pending"
    const initialNodeStates: Record<string, NodeRunStatus> = {};
    for (const id of runnableIds) initialNodeStates[id] = { phase: "pending" };

    setRunState({
      running: true,
      currentNodeId: null,
      completedIds: [],
      failedIds: [],
      runnableCount: runnableIds.length,
      nodeStates: initialNodeStates,
    });

    const completed: string[] = [];
    const failed: string[] = [];

    // Build dependency layers for parallel execution
    const layers = getLayers(runnableIds, edges);

    // Wrapper around the inner runner — records per-node start/done/failed
    // status so the run-status panel can show progress, duration, errors.
    const runSingleNode = async (nodeId: string): Promise<"ok" | "fail"> => {
      const startedAt = Date.now();
      setRunState((s) => ({
        ...s,
        nodeStates: { ...s.nodeStates, [nodeId]: { ...s.nodeStates[nodeId], phase: "running", startedAt } },
      }));
      let result: "ok" | "fail" = "fail";
      let errorMessage: string | undefined;
      try {
        result = await runSingleNodeImpl(nodeId);
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
      // If inner returned "fail" without throwing, try to recover the error
      // message from the node's payload (set by individual mutation onError).
      if (result === "fail" && !errorMessage) {
        const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
        const em = (node?.data.payload as Record<string, unknown> | undefined)?.errorMessage;
        if (typeof em === "string" && em) errorMessage = em;
      }
      setRunState((s) => ({
        ...s,
        nodeStates: {
          ...s.nodeStates,
          [nodeId]: { phase: result === "ok" ? "done" : "failed", startedAt, completedAt: Date.now(), errorMessage },
        },
      }));
      return result;
    };

    const runSingleNodeImpl = async (nodeId: string): Promise<"ok" | "fail"> => {
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
            batchSize: ([1, 4] as number[]).includes(p.batchSize as number) ? (p.batchSize as 1 | 4) : undefined,
            referenceImageUrl: (p.referenceImageUrl as string) || undefined,
            projectId: node.data.projectId,
          });
          const bestUrl = result.url ?? result.urls?.[0];
          if (!bestUrl) throw new Error("图像生成未返回 URL");
          if (nodeType === "storyboard") {
            // StoryboardNodeData uses imageHistory (not imageUrls)
            const existingHistory = ((useCanvasStore.getState().nodes.find(n => n.id === nodeId)?.data.payload) as Record<string, unknown> | undefined)?.imageHistory as string[] | undefined ?? [];
            const newUrls = result.urls?.length ? result.urls : [bestUrl];
            const newHistory = [...newUrls, ...existingHistory].filter(Boolean).slice(0, 12);
            useCanvasStore.getState().updateNodeData(nodeId, { imageUrl: bestUrl, imageHistory: newHistory }, true);
          } else {
            useCanvasStore.getState().updateNodeData(nodeId, {
              imageUrl: bestUrl,
              ...(result.urls?.length ? { imageUrls: result.urls } : {}),
            }, true);
          }

          // Propagate image URL to connected reference-image targets
          const { edges: currentEdges, nodes: currentNodes } = useCanvasStore.getState();
          const downstreamUpdates = bestUrl
            ? computeRefImageUpdates(nodeId, bestUrl, currentNodes, currentEdges)
            : [];
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
          // Fall back to edge-connected audio node when inputAudioUrl is not stored in payload
          const audioUrl = (p.inputAudioUrl as string) || detectBgMusicUrl(nodeId, es, ns) || undefined;
          const result = await clipMutation.mutateAsync({
            inputUrl,
            startTime,
            endTime,
            speed: typeof p.speed === "number" && Math.abs(p.speed - 1.0) > 0.01 ? p.speed : undefined,
            audioUrl,
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
            bgMusicUrl: (p.bgMusicUrl as string) || detectBgMusicUrl(nodeId, es, ns) || undefined,
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
              errorMessage: undefined,
            }, true);
          } else {
            useCanvasStore.getState().updateNodeData(nodeId, { status: "done", errorMessage: undefined }, true);
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

        // ── Smart Cut ────────────────────────────────────────────────────────
        } else if (nodeType === "smart_cut") {
          const { nodes: ns, edges: es } = useCanvasStore.getState();
          const inputUrl = (p.inputVideoUrl as string) || autoDetectInputVideo(nodeId, es, ns);
          if (!inputUrl) {
            toast.error(`节点 "${node.data.title}"：未找到视频输入`);
            failed.push(nodeId);
            return "fail";
          }
          const result = await smartCutMutation.mutateAsync({
            inputUrl,
            aggressiveness: (p.aggressiveness as "low" | "medium" | "high") || undefined,
            targetDuration: typeof p.targetDuration === "number" ? p.targetDuration : undefined,
          });
          useCanvasStore.getState().updateNodeData(nodeId, {
            outputUrl: result.url,
            outputDuration: result.outputDuration,
            originalDuration: result.originalDuration,
            status: "done",
          }, true);
          completed.push(nodeId);
          return "ok";

        // ── Subtitle Motion ──────────────────────────────────────────────────
        } else if (nodeType === "subtitle_motion") {
          const { nodes: ns, edges: es } = useCanvasStore.getState();
          const videoUrl = (p.inputVideoUrl as string) || autoDetectInputVideo(nodeId, es, ns);
          if (!videoUrl) {
            toast.error(`节点 "${node.data.title}"：未找到视频输入`);
            failed.push(nodeId);
            return "fail";
          }
          let entries = p.entries as Array<{ start: number; end: number; text: string }> | undefined;
          if (!entries?.length) {
            const transcribeResult = await subtitleMotionTranscribeMutation.mutateAsync({
              audioUrl: videoUrl,
              language: (p.language as string) || undefined,
            });
            entries = transcribeResult.entries;
            useCanvasStore.getState().updateNodeData(nodeId, { entries }, true);
          }
          if (!entries?.length) {
            toast.error(`节点 "${node.data.title}"：未能获取字幕条目`);
            failed.push(nodeId);
            return "fail";
          }
          const burnResult = await subtitleMotionBurnMutation.mutateAsync({
            videoUrl,
            entries,
            motionStyle: (p.motionStyle as "fade" | "roll" | "karaoke" | "bounce") || undefined,
            fontSize: typeof p.fontSize === "number" ? p.fontSize : undefined,
            fontColor: (p.fontColor as string) || undefined,
          });
          useCanvasStore.getState().updateNodeData(nodeId, {
            outputUrl: burnResult.url,
            status: "done",
            errorMessage: undefined,
          }, true);
          completed.push(nodeId);
          return "ok";

        // ── ComfyUI Image ────────────────────────────────────────────────────
        } else if (nodeType === "comfyui_image") {
          const prompt = (p.prompt as string) || "";
          const ckpt = (p.ckpt as string) || "";
          if (!prompt.trim() || !ckpt.trim()) {
            toast.error(`节点 "${node.data.title}"：提示词和 Checkpoint 必填`);
            failed.push(nodeId);
            return "fail";
          }
          const tplRaw = p.workflowTemplate as string;
          const template = (tplRaw === "img2img" || tplRaw === "inpaint") ? tplRaw : "txt2img";
          const refUrl = (p.referenceImageUrl as string) || undefined;
          const maskUrl = (p.maskUrl as string) || undefined;
          if ((template === "img2img" || template === "inpaint") && !refUrl) {
            toast.error(`节点 "${node.data.title}"：${template} 模板需要参考图`);
            failed.push(nodeId);
            return "fail";
          }
          if (template === "inpaint" && !maskUrl) {
            toast.error(`节点 "${node.data.title}"：inpaint 模板需要蒙版`);
            failed.push(nodeId);
            return "fail";
          }
          // Architecture / loader fields — must mirror the per-node "运行" button
          // (ComfyuiImageNode), otherwise an auto-run drops arch/modelSource/clip
          // and a Flux/SD3/Qwen (UNet + separate CLIP) node silently falls back to
          // a plain checkpoint graph → "model not in checkpoints list" failures.
          const archVal: "sd" | "flux" | "sd3" | "qwen" =
            p.arch === "flux" || p.arch === "sd3" || p.arch === "qwen" ? p.arch : "sd";
          const modelSrc: "checkpoint" | "unet" =
            p.modelSource === "unet" || p.modelSource === "checkpoint"
              ? p.modelSource
              : (archVal === "sd" ? "checkpoint" : "unet");
          const clipRaw = p.clip as { clipType?: string; name1?: string; name2?: string; name3?: string } | undefined;
          const clip = clipRaw?.name1?.trim()
            ? { clipType: clipRaw.clipType || "", name1: clipRaw.name1.trim(), name2: clipRaw.name2?.trim() || undefined, name3: clipRaw.name3?.trim() || undefined }
            : undefined;
          const result = await comfyuiImageMutation.mutateAsync({
            nodeId,
            projectId: node.data.projectId,
            customBaseUrl: ((p.customBaseUrl as string) || "").trim() || undefined,
            workflowTemplate: template,
            prompt,
            negPrompt: (p.negPrompt as string) || undefined,
            ckpt,
            filenamePrefix: `${node.data.title}_${ckpt}`.slice(0, 120),
            clip,
            arch: archVal === "sd" ? undefined : archVal,
            modelSource: modelSrc,
            unetWeightDtype: modelSrc === "unet" ? ((p.unetWeightDtype as string) || "default") : undefined,
            guidance: archVal === "flux" ? (typeof p.guidance === "number" ? p.guidance : 3.5) : undefined,
            shift: (archVal === "sd3" || archVal === "qwen") ? (typeof p.shift === "number" ? p.shift : (archVal === "qwen" ? 3.1 : 3)) : undefined,
            lora: (p.lora as string) || undefined,
            // Forward the multi-LoRA stack + ControlNet so canvas-wide runs match
            // the per-node "运行" button (both call comfyui.generateImage).
            loras: Array.isArray(p.loras) && p.loras.length > 0
              ? (p.loras as { name: string; strengthModel: number; strengthClip?: number }[])
              : undefined,
            controlnet: p.controlnet && typeof p.controlnet === "object" && (p.controlnet as { model?: string }).model && (p.controlnet as { imageUrl?: string }).imageUrl
              ? (p.controlnet as { model: string; imageUrl: string; strength?: number; startPercent?: number; endPercent?: number; preprocessor?: string })
              : undefined,
            ipadapter: p.ipadapter && typeof p.ipadapter === "object" && (p.ipadapter as { model?: string }).model && (p.ipadapter as { imageUrl?: string }).imageUrl
              ? (p.ipadapter as { model: string; imageUrl: string; clipVision?: string; weight?: number })
              : undefined,
            upscaleModel: (p.upscaleModel as string) || undefined,
            steps: typeof p.steps === "number" ? p.steps : 20,
            cfg: typeof p.cfg === "number" ? p.cfg : 7,
            seed: typeof p.seed === "number" ? p.seed : -1,
            width: typeof p.width === "number" ? p.width : 512,
            height: typeof p.height === "number" ? p.height : 512,
            sampler: (p.sampler as string) || undefined,
            scheduler: (p.scheduler as string) || undefined,
            denoise: typeof p.denoise === "number" ? p.denoise : undefined,
            vae: (p.vae as string) || undefined,
            loraStrength: typeof p.loraStrength === "number" ? p.loraStrength : undefined,
            batchSize: typeof p.batchSize === "number" ? p.batchSize : 1,
            referenceImageUrl: refUrl,
            maskUrl,
          });
          // Guard against the node having been deleted while the long-running
          // mutation was in flight — writing back would resurrect a ghost node.
          const { nodes: nodesAtSuccess, edges: currentEdges } = useCanvasStore.getState();
          if (!nodesAtSuccess.some((n) => n.id === nodeId)) {
            return "ok";
          }
          useCanvasStore.getState().updateNodeData(nodeId, {
            imageUrl: result.url,
            imageUrls: result.urls,
            status: "done",
            errorMessage: undefined,
            progress: undefined,
          }, true);
          // Propagate to downstream reference-image targets
          const downstreamUpdates = result.url
            ? computeRefImageUpdates(nodeId, result.url, nodesAtSuccess, currentEdges)
            : [];
          if (downstreamUpdates.length > 0) {
            useCanvasStore.getState().batchUpdateNodeData(downstreamUpdates);
          }
          completed.push(nodeId);
          return "ok";

        // ── ComfyUI Video ────────────────────────────────────────────────────
        } else if (nodeType === "comfyui_video") {
          const prompt = (p.prompt as string) || "";
          const ckpt = (p.ckpt as string) || "";
          if (!prompt.trim() || !ckpt.trim()) {
            toast.error(`节点 "${node.data.title}"：提示词和 Checkpoint 必填`);
            failed.push(nodeId);
            return "fail";
          }
          const vtplRaw = p.workflowTemplate as string;
          const template = (["svd", "wan_t2v", "wan_i2v", "ltxv"].includes(vtplRaw) ? vtplRaw : "animatediff") as "animatediff" | "svd" | "wan_t2v" | "wan_i2v" | "ltxv";
          const refUrl = (p.referenceImageUrl as string) || undefined;
          if ((template === "svd" || template === "wan_i2v") && !refUrl) {
            toast.error(`节点 "${node.data.title}"：该模板需要起始图`);
            failed.push(nodeId);
            return "fail";
          }
          const motionModule = (p.motionModule as string) || undefined;
          if (template === "animatediff" && !motionModule) {
            toast.error(`节点 "${node.data.title}"：AnimateDiff 需要 Motion Module`);
            failed.push(nodeId);
            return "fail";
          }
          const result = await comfyuiVideoMutation.mutateAsync({
            nodeId,
            projectId: node.data.projectId,
            customBaseUrl: ((p.customBaseUrl as string) || "").trim() || undefined,
            workflowTemplate: template,
            prompt,
            negPrompt: (p.negPrompt as string) || undefined,
            ckpt,
            motionModule,
            clip: (p.clip as string) || undefined,
            clipVision: (p.clipVision as string) || undefined,
            steps: typeof p.steps === "number" ? p.steps : 20,
            cfg: typeof p.cfg === "number" ? p.cfg : 7,
            seed: typeof p.seed === "number" ? p.seed : -1,
            frames: typeof p.frames === "number" ? p.frames : 16,
            fps: typeof p.fps === "number" ? p.fps : 8,
            width: typeof p.width === "number" ? p.width : undefined,
            height: typeof p.height === "number" ? p.height : undefined,
            sampler: (p.sampler as string) || undefined,
            scheduler: (p.scheduler as string) || undefined,
            denoise: typeof p.denoise === "number" ? p.denoise : undefined,
            vae: (p.vae as string) || undefined,
            batchSize: typeof p.batchSize === "number" ? p.batchSize : 1,
            referenceImageUrl: refUrl,
          });
          // Guard against the node having been deleted during the long mutation.
          if (!useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) {
            return "ok";
          }
          useCanvasStore.getState().updateNodeData(nodeId, {
            resultVideoUrl: result.url,
            status: "done",
            errorMessage: undefined,
            progress: undefined,
          }, true);
          completed.push(nodeId);
          return "ok";

        // ── ComfyUI Custom Workflow ───────────────────────────────────────────
        } else if (nodeType === "comfyui_workflow") {
          const workflowJson = (p.workflowJson as string) || "";
          if (!workflowJson.trim()) {
            toast.error(`节点 "${node.data.title}"：请先粘贴 Workflow JSON`);
            failed.push(nodeId);
            return "fail";
          }
          // Pull an upstream image into blank image params (mirrors the video
          // pull model above), then tell the server which keys are images so it
          // uploads the URL to ComfyUI.
          const { nodes: preNodes, edges: preEdges } = useCanvasStore.getState();
          const upstreamImg = detectUpstreamImageUrl(nodeId, preEdges, preNodes);
          const { paramValues, imageParamKeys } = resolveWorkflowImageParams(
            p.paramBindings as WorkflowParamBinding[] | undefined,
            (p.paramValues as Record<string, unknown>) || {},
            upstreamImg,
          );
          const result = await comfyuiWorkflowMutation.mutateAsync({
            nodeId,
            projectId: node.data.projectId,
            customBaseUrl: ((p.customBaseUrl as string) || "").trim() || undefined,
            workflowJson,
            paramValues,
            imageParamKeys: imageParamKeys.length > 0 ? imageParamKeys : undefined,
            outputNodeIds: (p.outputNodeIds as string[]) || undefined,
            outputType: ((p.outputType as string) || "auto") as "image" | "video" | "auto",
          });
          const { nodes: wfNodes, edges: wfEdges } = useCanvasStore.getState();
          if (!wfNodes.some((n) => n.id === nodeId)) return "ok";
          const firstUrl = result.urls[0] ?? "";
          useCanvasStore.getState().updateNodeData(nodeId, {
            outputUrl: firstUrl,
            outputUrls: result.urls,
            status: "done",
            errorMessage: undefined,
            progress: undefined,
          }, true);
          // Propagate image output to downstream reference-image targets (image
          // outputs only — never a video output). Downstream comfyui_workflow
          // nodes pull this output at run time (detectUpstreamImageUrl) and are
          // not ref-image targets, so they're correctly excluded.
          if (result.outputType === "image" && firstUrl) {
            const wfDownstream = computeRefImageUpdates(nodeId, firstUrl, wfNodes, wfEdges);
            if (wfDownstream.length > 0) useCanvasStore.getState().batchUpdateNodeData(wfDownstream);
          }
          completed.push(nodeId);
          return "ok";
        }

        // Unrecognized runnable node type — mark as failed
        failed.push(nodeId);
        return "fail";
      } catch (err) {
        failed.push(nodeId);
        // ComfyUI nodes show status/progress in their UI — reset to failed on error
        if (nodeType === "comfyui_image" || nodeType === "comfyui_video" || nodeType === "comfyui_workflow") {
          const errMsg = err instanceof Error ? err.message : String(err);
          useCanvasStore.getState().updateNodeData(nodeId, { status: "failed", errorMessage: errMsg, progress: undefined }, true);
        }
        if (!handleWhitelistError(err)) {
          toast.error(`节点 "${node.data.title}" 执行失败`);
        }
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

    runningRef.current = false;
    if (!abortRef.current) {
      // Preserve nodeStates so the status panel keeps showing the last run's
      // per-node results until the next run starts or user clicks reset.
      setRunState((s) => ({
        ...s,
        running: false,
        currentNodeId: null,
        completedIds: completed,
        failedIds: failed,
        runnableCount: 0,
      }));
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
  }, [imageGenMutation, videoTaskMutation, clipMutation, mergeMutation, subtitleTranscribeMutation, subtitleBurnMutation, overlayMutation, smartCutMutation, subtitleMotionTranscribeMutation, subtitleMotionBurnMutation, comfyuiImageMutation, comfyuiVideoMutation, comfyuiWorkflowMutation]);

  const reset = useCallback(() => {
    runningRef.current = false;
    setRunState({
      running: false,
      currentNodeId: null,
      completedIds: [],
      failedIds: [],
      runnableCount: 0,
      nodeStates: {},
    });
  }, []);

  return { runWorkflow, runState, reset };
}
