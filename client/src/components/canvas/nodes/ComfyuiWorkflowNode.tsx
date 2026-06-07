import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { handleStyle } from "../../../lib/handleStyle";
import { useConnectState } from "../../../hooks/useConnectingStore";
import { useHoverStore } from "../../../hooks/useHoverStore";
import { ComfyServerUrlField } from "./ComfyServerUrlField";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateRefImage, propagateWorkflowPrompt } from "../../../lib/refImagePropagation";
import type { ComfyuiWorkflowNodeData, WorkflowParamBinding } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { detectUpstreamImageUrl, detectUpstreamPrompt, fillWorkflowPromptParams, listUpstreamImageSources, resolveImageParamsWithMap } from "@/lib/comfyWorkflowParams";
import { summarizeComfyWorkflow } from "@/lib/comfyWorkflowSummary";
import { detectWorkflowFormat, extractComfyWorkflowsFromPng } from "@/lib/comfyWorkflowImport";
import { MediaImage } from "../MediaImage";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { ImageLightbox } from "../ImageLightbox";
import { toast } from "sonner";
import {
  Workflow, Loader2, Upload, X, ChevronDown, ChevronRight,
  Server, Play, RotateCcw, ImageIcon, FileVideo, Plus, Trash2, Copy, AlertTriangle,
} from "lucide-react";
import { SyncConfigDialog } from "../SyncConfigDialog";
import { NodeTextArea, NodeInput } from "../NodeTextInput";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "comfyui_workflow";
    title: string;
    payload: ComfyuiWorkflowNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.65 0.20 140)";        // 本地：绿色
const CLOUD_ACCENT = "oklch(0.68 0.16 235)";  // 云端：蓝青色（外框据此区分）
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = "oklch(0.65 0.20 140 / 0.5)";

const fieldBase: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 12,
  background: "var(--c-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
  borderRadius: 8,
  color: "var(--c-t1)",
  outline: "none",
  fontFamily: "var(--font-sans)",
  transition: "border-color 150ms ease",
  lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

// Preset workflow templates (minimal API-format JSON)
const PRESET_SDXL = JSON.stringify({
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "beautiful scenery", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "ugly, blurry", clip: ["4", 1] } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 30, cfg: 7, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "sdxl_output", images: ["8", 0] } },
}, null, 2);

const PRESET_FLUX = JSON.stringify({
  "1": { class_type: "UNETLoader", inputs: { unet_name: "flux1-dev.safetensors", weight_dtype: "fp8_e4m3fn" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name1: "t5xxl_fp8_e4m3fn.safetensors", clip_name2: "clip_l.safetensors", type: "flux" } },
  "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a beautiful landscape", clip: ["2", 0] } },
  "5": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "4": { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1.0, model: ["1", 0], positive: ["6", 0], negative: ["6", 0], latent_image: ["5", 0] } },
  "7": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
  "8": { class_type: "SaveImage", inputs: { filename_prefix: "flux_output", images: ["7", 0] } },
}, null, 2);

const PRESET_HUNYUAN = JSON.stringify({
  "1": { class_type: "HunyuanVideoTextEncode", inputs: { text: "a person walking in a park", clip: ["3", 0] } },
  "2": { class_type: "EmptyHunyuanLatentVideo", inputs: { width: 848, height: 480, length: 25, batch_size: 1 } },
  "3": { class_type: "HunyuanVideoModelLoader", inputs: { model: "HunyuanVideo_720_cfgdistill_fp8.safetensors" } },
  "4": { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1.0, model: ["3", 0], positive: ["1", 0], negative: ["1", 0], latent_image: ["2", 0] } },
  "5": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
  "6": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 25, loop_count: 0, filename_prefix: "hunyuan_output", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["5", 0] } },
}, null, 2);

const PRESET_WAN = JSON.stringify({
  "1": { class_type: "WanModelLoader", inputs: { model: "Wan2_1-T2V-14B_fp8.safetensors", dtype: "fp8_e4m3fn" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "a cat playing with a ball", clip: ["1", 1] } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "ugly, blurry", clip: ["1", 1] } },
  "4": { class_type: "EmptyWanLatentVideo", inputs: { width: 832, height: 480, length: 81, batch_size: 1 } },
  "5": { class_type: "KSampler", inputs: { seed: 42, steps: 25, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1.0, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
  "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  "7": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 16, loop_count: 0, filename_prefix: "wan_output", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["6", 0] } },
}, null, 2);

// Wan 2.2 T2V — ComfyUI native graph (UNETLoader + CLIPLoader type "wan" +
// EmptyHunyuanLatentVideo + ModelSamplingSD3 shift). Wan2.2 is MoE; this loads
// the high-noise expert — swap unet_name for your fp8/GGUF build.
const PRESET_WAN22 = JSON.stringify({
  "1": { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors", weight_dtype: "default" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
  "3": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
  "10": { class_type: "ModelSamplingSD3", inputs: { shift: 8.0, model: ["1", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a cat walking on grass, cinematic", clip: ["2", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "low quality, blurry", clip: ["2", 0] } },
  "5": { class_type: "EmptyHunyuanLatentVideo", inputs: { width: 832, height: 480, length: 81, batch_size: 1 } },
  "4": { class_type: "KSampler", inputs: { seed: 42, steps: 30, cfg: 5, sampler_name: "euler", scheduler: "simple", denoise: 1.0, model: ["10", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
  "9": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 16, loop_count: 0, filename_prefix: "wan22_output", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["8", 0] } },
}, null, 2);

// LTX-Video — fast/real-time video (native LTXV nodes).
const PRESET_LTXV = JSON.stringify({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-video-2b-v0.9.5.safetensors" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name: "t5xxl_fp16.safetensors", type: "ltxv" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a serene waterfall in a forest", clip: ["2", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "low quality, worst quality, blurry", clip: ["2", 0] } },
  "8": { class_type: "LTXVConditioning", inputs: { positive: ["6", 0], negative: ["7", 0], frame_rate: 25 } },
  "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width: 768, height: 512, length: 97, batch_size: 1 } },
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 30, cfg: 3, sampler_name: "euler", scheduler: "normal", denoise: 1.0, model: ["1", 0], positive: ["8", 0], negative: ["8", 1], latent_image: ["5", 0] } },
  "9": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["1", 2] } },
  "10": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 25, loop_count: 0, filename_prefix: "ltxv_output", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["9", 0] } },
}, null, 2);

// Qwen-Image — ComfyUI native (UNETLoader + CLIPLoader type "qwen_image").
const PRESET_QWEN = JSON.stringify({
  "1": { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_fp8_e4m3fn.safetensors", weight_dtype: "default" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image" } },
  "3": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_vae.safetensors" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a poster with bold typography, vibrant colors", clip: ["2", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "low quality, blurry", clip: ["2", 0] } },
  "5": { class_type: "EmptySD3LatentImage", inputs: { width: 1328, height: 1328, batch_size: 1 } },
  "4": { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 2.5, sampler_name: "euler", scheduler: "simple", denoise: 1.0, model: ["1", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "qwen_output", images: ["8", 0] } },
}, null, 2);

// Flux.1 Kontext — instruction-based image editing. The input image is scaled,
// VAE-encoded, and injected into the conditioning via ReferenceLatent.
const PRESET_FLUX_KONTEXT = JSON.stringify({
  "1": { class_type: "UNETLoader", inputs: { unet_name: "flux1-dev-kontext_fp8_scaled.safetensors", weight_dtype: "default" } },
  "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: "t5xxl_fp8_e4m3fn.safetensors", clip_name2: "clip_l.safetensors", type: "flux" } },
  "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
  "10": { class_type: "LoadImage", inputs: { image: "input.png" } },
  "11": { class_type: "FluxKontextImageScale", inputs: { image: ["10", 0] } },
  "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["3", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "change the background to a snowy mountain", clip: ["2", 0] } },
  "13": { class_type: "FluxGuidance", inputs: { conditioning: ["6", 0], guidance: 2.5 } },
  "14": { class_type: "ReferenceLatent", inputs: { conditioning: ["13", 0], latent: ["12", 0] } },
  "15": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["6", 0] } },
  "4": { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1.0, model: ["1", 0], positive: ["14", 0], negative: ["15", 0], latent_image: ["12", 0] } },
  "7": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
  "8": { class_type: "SaveImage", inputs: { filename_prefix: "kontext_output", images: ["7", 0] } },
}, null, 2);

// Stable Diffusion 3.5 Large — all-in-one checkpoint + ModelSamplingSD3 shift.
const PRESET_SD35 = JSON.stringify({
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd3.5_large.safetensors" } },
  "10": { class_type: "ModelSamplingSD3", inputs: { shift: 3.0, model: ["4", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a photorealistic portrait, studio lighting", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "low quality, deformed", clip: ["4", 1] } },
  "5": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 30, cfg: 4.5, sampler_name: "euler", scheduler: "sgm_uniform", denoise: 1.0, model: ["10", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "sd35_output", images: ["8", 0] } },
}, null, 2);

type Phase = "empty" | "binding" | "run";

export const ComfyuiWorkflowNode = memo(function ComfyuiWorkflowNode({ id, selected, data }: Props) {
  const handlesActive = useHoverStore((s) => s.nodeId === id) || !!selected;
  const connectState = useConnectState(id, "comfyui_workflow");
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  // Reactively detect an upstream image feeding this node (via any incoming edge).
  const upstreamImageUrl = useCanvasStore((s) => detectUpstreamImageUrl(id, s.edges, s.nodes));
  const edgesForSources = useCanvasStore((s) => s.edges);
  const nodesForSources = useCanvasStore((s) => s.nodes);
  const upstreamSources = useMemo(() => listUpstreamImageSources(id, edgesForSources, nodesForSources), [id, edgesForSources, nodesForSources]);
  const payload = data.payload;
  // Reactively detect the upstream prompt text + whether this workflow exposes a
  // positive/negative prompt param it can be written into. Surfaces exactly why
  // 上游优先 may appear to do nothing: no upstream prompt detected, or no text
  // param to receive it. Mirrors the run-time logic in fillWorkflowPromptParams.
  const upstreamPromptInfo = useMemo(() => {
    const detected = detectUpstreamPrompt(id, edgesForSources, nodesForSources);
    const texts = (payload.paramBindings ?? []).filter((b) => b.type === "text");
    const isNeg = (b: WorkflowParamBinding) => b.role === "negative" || (!b.role && /负|negative/i.test(b.label));
    const posB = texts.find((b) => b.role === "positive")
      ?? texts.find((b) => !b.role && /提示词|prompt/i.test(b.label) && !isNeg(b))
      ?? texts.find((b) => !isNeg(b));
    return { detected, hasTextParam: texts.length > 0, hasPosTarget: !!posB };
  }, [id, edgesForSources, nodesForSources, payload.paramBindings]);
  // Param bindings whose node id no longer exists in the current workflow JSON —
  // a stale binding map (workflow re-imported/edited without re-analyzing). Their
  // values won't be injected, so we warn and gate Run on it (see handleRun).
  const staleBindingNodeIds = useMemo(() => {
    const bindings = payload.paramBindings ?? [];
    if (bindings.length === 0 || !payload.workflowJson?.trim()) return [] as string[];
    let wf: Record<string, unknown> | null = null;
    try { wf = JSON.parse(payload.workflowJson) as Record<string, unknown>; } catch { return [] as string[]; }
    if (!wf || typeof wf !== "object") return [] as string[];
    return Array.from(new Set(bindings.filter((b) => !(b.nodeId in wf!)).map((b) => b.nodeId)));
  }, [payload.paramBindings, payload.workflowJson]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localJson, setLocalJson] = useState(payload.workflowJson ?? "");
  const [phase, setPhase] = useState<Phase>(
    payload.paramBindings && payload.paramBindings.length > 0
      ? (payload.workflowJson ? "run" : "empty")
      : (payload.workflowJson ? "binding" : "empty")
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [editingBindings, setEditingBindings] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [localBindings, setLocalBindings] = useState<WorkflowParamBinding[]>(payload.paramBindings ?? []);

  const update = useCallback((patch: Partial<ComfyuiWorkflowNodeData>, silent = false) => {
    updateNodeData(id, patch, silent);
  }, [id, updateNodeData]);

  // Creating a node from the template library (or a collab peer) populates the
  // payload AFTER mount, but phase/localJson were snapshotted from the empty
  // payload at mount — leaving the node stuck on the "paste JSON" screen with no
  // param form. When a workflow appears while we're still empty, advance out of it.
  useEffect(() => {
    if (phase === "empty" && payload.workflowJson) {
      setLocalJson(payload.workflowJson);
      setLocalBindings(payload.paramBindings ?? []);
      setPhase(payload.paramBindings && payload.paramBindings.length > 0 ? "run" : "binding");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.workflowJson, payload.paramBindings]);

  const analyzeMutation = trpc.comfyui.analyzeWorkflow.useMutation();

  // Local vs official cloud (cloud.comfy.org). The cloud toggle is only usable by
  // admins / whitelisted users (and only when the server has it configured).
  const useCloud = payload.useCloudComfy === true;
  // Border-colored annotation: which workflow / models are loaded. Recomputed
  // only when the JSON changes. accentColor matches the node border (green local,
  // blue cloud); detail powers the hover tooltip.
  const accentColor = useCloud ? CLOUD_ACCENT : accent;
  const summary = useMemo(() => summarizeComfyWorkflow(payload.workflowJson), [payload.workflowJson]);
  const annotationText = `${payload.workflowName ? payload.workflowName + " · " : ""}${summary.brief}`;
  const annotationDetail = `${payload.workflowName ? "工作流: " + payload.workflowName + "\n" : ""}${summary.detail}`;
  // Corner annotation prefers the template-library name when the node came from one.
  const cornerText = payload.templateLabel?.trim() || (summary.ok ? annotationText : "");
  const hasOutput = payload.status === "done" && !!payload.outputUrls && payload.outputUrls.length > 0;
  const cloudInfo = trpc.comfyui.cloudInfo.useQuery(undefined, { staleTime: 60_000 });
  const canUseCloud = cloudInfo.data?.allowed ?? false;
  const cloudConfigured = cloudInfo.data?.configured ?? false;
  const setUseCloud = useCallback((on: boolean) => {
    if (on && !canUseCloud) { toast.error("ComfyUI 云服务仅向管理员和白名单用户开放"); return; }
    update({ useCloudComfy: on });
  }, [canUseCloud, update]);
  const cloudTestMut = trpc.comfyui.cloudTest.useMutation();
  const handleTestCloud = useCallback(async () => {
    try {
      const r = await cloudTestMut.mutateAsync();
      if (r.ok) toast.success(r.message); else toast.error(r.message);
    } catch (e) { toast.error("测试失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 120)); }
  }, [cloudTestMut]);

  // Test the ComfyUI server connection (this node runs arbitrary workflows and
  // doesn't pull a model list, so we probe via fetchModels purely to verify
  // reachability and report what's available).
  const utils = trpc.useUtils();
  const [testingServer, setTestingServer] = useState(false);
  const handleTestServer = useCallback(async () => {
    setTestingServer(true);
    try {
      const r = await utils.comfyui.fetchModels.fetch({ customBaseUrl: payload.customBaseUrl?.trim() || undefined });
      toast.success(`连接成功 — checkpoint ${r.ckpts.length} · LoRA ${r.loras.length}`);
    } catch (e) {
      toast.error("连接失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 120));
    } finally { setTestingServer(false); }
  }, [utils, payload.customBaseUrl]);
  const executeMutation = trpc.comfyui.executeWorkflow.useMutation();
  const uploadImageMutation = trpc.comfyui.uploadWorkflowImage.useMutation();

  const handleAnalyze = useCallback(async (json: string) => {
    const trimmed = json.trim();
    if (!trimmed) { toast.error("请粘贴 Workflow JSON"); return; }
    try {
      JSON.parse(trimmed);
    } catch {
      toast.error("JSON 格式错误，请检查后重试");
      return;
    }
    update({ workflowJson: trimmed, status: "idle", errorMessage: undefined });
    try {
      const result = await analyzeMutation.mutateAsync({
        customBaseUrl: payload.customBaseUrl?.trim() || undefined,
        workflowJson: trimmed,
      });
      const bindings = result.detectedParams;
      setLocalBindings(bindings);
      update({
        workflowJson: trimmed,
        paramBindings: bindings,
        outputNodeIds: result.outputNodeIds,
        outputNodes: result.outputNodes,
        outputType: result.outputType === "mixed" ? "auto" : result.outputType,
        paramValues: {},
      });
      setPhase("binding");
      toast.success(`检测到 ${bindings.length} 个参数`);
    } catch (err) {
      toast.error("分析失败：" + (err instanceof Error ? err.message : String(err)));
    }
  }, [analyzeMutation, payload.customBaseUrl, update]);

  // ── File import (drag/drop or picker): .json (API or UI graph) and ComfyUI .png
  //    (embedded workflow). API JSON → existing analyze flow; UI graph → server
  //    converts to API (object_info) first. On any failure, a clear toast + the
  //    existing paste flow remain — no existing path is touched.
  const convertMutation = trpc.comfyui.convertWorkflow.useMutation();
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const toApiThenAnalyze = useCallback(async (parsed: unknown, rawText: string) => {
    const fmt = detectWorkflowFormat(parsed);
    if (fmt === "api") { await handleAnalyze(rawText); return; }
    if (fmt === "ui") {
      const r = await convertMutation.mutateAsync({ customBaseUrl: payload.customBaseUrl?.trim() || undefined, uiWorkflow: JSON.stringify(parsed) });
      await handleAnalyze(r.workflowJson);
      toast.success("已把 UI 工作流转换为可运行格式");
      return;
    }
    toast.error("无法识别的工作流格式（需 ComfyUI 的 API/UI 工作流）");
  }, [convertMutation, handleAnalyze, payload.customBaseUrl]);

  const handleFile = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const isPng = /\.png$/i.test(file.name) || file.type === "image/png";
      if (isPng) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { promptApi, workflowUi } = extractComfyWorkflowsFromPng(bytes);
        if (promptApi) { await handleAnalyze(JSON.stringify(promptApi)); toast.success("已从 PNG 读取工作流"); return; }
        if (workflowUi) { await toApiThenAnalyze(workflowUi, JSON.stringify(workflowUi)); return; }
        toast.error("该 PNG 未内嵌 ComfyUI 工作流（请用 ComfyUI 生成的图，或导出 JSON）");
        return;
      }
      const text = await file.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { toast.error("JSON 解析失败"); return; }
      await toApiThenAnalyze(parsed, text);
    } catch (err) {
      toast.error("导入失败：" + (err instanceof Error ? err.message : String(err)));
    } finally { setImporting(false); }
  }, [handleAnalyze, toApiThenAnalyze]);

  const handleRun = useCallback(async () => {
    const workflowJson = payload.workflowJson ?? "";
    if (!workflowJson.trim()) { toast.error("请先加载 Workflow JSON"); return; }
    // Guard against a stale binding map: if any param binding points at a node id
    // that no longer exists in the current workflow JSON (e.g. the workflow was
    // re-imported/edited without re-analyzing), its value — including a forced
    // upstream prompt — would be injected onto a missing node and silently dropped,
    // making「上游优先」appear broken. Abort and ask the user to re-analyze.
    const bindings = payload.paramBindings ?? [];
    if (bindings.length > 0) {
      let wfNodes: Record<string, unknown> | null = null;
      try { wfNodes = JSON.parse(workflowJson) as Record<string, unknown>; } catch { wfNodes = null; }
      if (wfNodes && typeof wfNodes === "object") {
        const missing = Array.from(new Set(
          bindings.filter((b) => !(b.nodeId in wfNodes!)).map((b) => b.nodeId),
        ));
        if (missing.length > 0) {
          toast.error(`参数绑定已与当前 Workflow 不同步（缺失节点 ${missing.join("、")}），提示词/参数可能无法生效。请点「分析参数」重新分析后再运行。`);
          return;
        }
      }
    }
    update({ status: "processing", errorMessage: undefined, progress: 0 }, true);
    try {
      // Pull upstream images (multi-reference → fill blank image params in order)
      // and upstream prompt text (→ blank positive/negative prompt params).
      const { nodes, edges } = useCanvasStore.getState();
      const sources = listUpstreamImageSources(id, edges, nodes);
      const upstreamPrompt = detectUpstreamPrompt(id, edges, nodes);
      // Explicit per-param「来源」mapping first, then smart auto-fill the rest.
      const imgResolved = resolveImageParamsWithMap(payload.paramBindings, payload.paramValues ?? {}, sources, payload.imageSourceMap ?? {});
      const imageParamKeys = imgResolved.imageParamKeys;
      const paramValues = fillWorkflowPromptParams(payload.paramBindings, imgResolved.paramValues, upstreamPrompt, { force: payload.preferUpstreamPrompt !== false });
      // Seed handling: unless the user pinned the seed (randomizeSeed === false),
      // re-randomize every seed param each run, and persist the used value back so
      // the form reflects what was actually sent.
      const randomize = payload.randomizeSeed !== false;
      const seedPatch: Record<string, unknown> = {};
      if (randomize) {
        for (const b of payload.paramBindings ?? []) {
          if (b.type === "number" && (/seed/i.test(b.fieldPath) || b.label.includes("种子"))) {
            seedPatch[`${b.nodeId}.${b.fieldPath}`] = Math.floor(Math.random() * 2_147_483_647);
          }
        }
      }
      const effectiveParamValues = { ...paramValues, ...seedPatch };
      if (Object.keys(seedPatch).length > 0) {
        update({ paramValues: { ...(payload.paramValues ?? {}), ...seedPatch } }, true);
      }
      const result = await executeMutation.mutateAsync({
        nodeId: id,
        projectId: data.projectId,
        customBaseUrl: payload.customBaseUrl?.trim() || undefined,
        useCloudComfy: payload.useCloudComfy === true,
        workflowJson,
        paramValues: effectiveParamValues,
        imageParamKeys: imageParamKeys.length > 0 ? imageParamKeys : undefined,
        outputNodeIds: payload.outputNodeIds,
        outputType: payload.outputType ?? "auto",
      });
      update({
        outputUrl: result.urls[0] ?? "",
        outputUrls: result.urls,
        // Persist the actual produced type so onConnect/resolveNodeOutputImageUrl
        // never mistakes a video output for a reference image (config may be "auto").
        outputType: result.outputType,
        status: "done",
        errorMessage: undefined,
        progress: 100,
      });
      // Auto-fill downstream reference-image targets — image outputs only. Use
      // the run's actual outputType, not the config (which can be "auto").
      if (result.urls[0] && result.outputType !== "video") propagateRefImage(id, result.urls[0]);
      // Push the resolved prompt to downstream comfyui_video nodes (下发提示词).
      const bs = payload.paramBindings ?? [];
      const keyOf = (b?: WorkflowParamBinding) => (b ? `${b.nodeId}.${b.fieldPath}` : undefined);
      const posKey = keyOf(bs.find((b) => b.role === "positive") ?? bs.find((b) => b.type === "text" && /提示词|prompt/i.test(b.label) && !/负|negative/i.test(b.label)));
      const negKey = keyOf(bs.find((b) => b.role === "negative") ?? bs.find((b) => b.type === "text" && /负|negative/i.test(b.label)));
      const posText = posKey ? String(effectiveParamValues[posKey] ?? "") : "";
      const negText = negKey ? String(effectiveParamValues[negKey] ?? "") : undefined;
      if (posText.trim()) propagateWorkflowPrompt(id, posText, negText);
      toast.success("执行完成");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      update({ status: "failed", errorMessage: msg, progress: undefined }, true);
      toast.error("执行失败：" + msg.slice(0, 120));
    }
  }, [executeMutation, id, data.projectId, payload, update]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Remember the source filename (sans extension) so the node can show a
    // "which workflow is loaded" annotation. Persisted on the node payload.
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setLocalJson(text);
      if (baseName) update({ workflowName: baseName });
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [update]);

  const handleImageParamUpload = useCallback(async (binding: WorkflowParamBinding, sourceUrl: string) => {
    const baseUrl = payload.customBaseUrl?.trim() || undefined;
    if (!baseUrl) {
      // Store URL directly; the server will upload when executing
      update({ paramValues: { ...payload.paramValues, [`${binding.nodeId}.${binding.fieldPath}`]: sourceUrl } });
      return;
    }
    try {
      const res = await uploadImageMutation.mutateAsync({ projectId: data.projectId, customBaseUrl: baseUrl, sourceUrl });
      update({ paramValues: { ...payload.paramValues, [`${binding.nodeId}.${binding.fieldPath}`]: res.comfyFilename } });
    } catch (err) {
      toast.error("上传至 ComfyUI 失败，将使用原始链接：" + (err instanceof Error ? err.message : "未知错误").slice(0, 80));
      update({ paramValues: { ...payload.paramValues, [`${binding.nodeId}.${binding.fieldPath}`]: sourceUrl } });
    }
  }, [data.projectId, payload.customBaseUrl, payload.paramValues, update, uploadImageMutation]);

  const setParamValue = useCallback((key: string, value: unknown) => {
    update({ paramValues: { ...payload.paramValues, [key]: value } }, true);
  }, [payload.paramValues, update]);

  // Upload a local image file to our storage and return its URL (the run flow
  // then re-uploads URL-valued image params to ComfyUI). Powers drag-in / file
  // pick on image params.
  const imgUploadMutation = trpc.upload.uploadImage.useMutation();
  const uploadLocalImage = useCallback((file: File): Promise<string | null> => new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); resolve(null); return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16MB"); resolve(null); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(",")[1];
        const r = await imgUploadMutation.mutateAsync({ base64, mimeType: file.type, filename: file.name });
        resolve(r.url);
      } catch (e) { toast.error("上传失败：" + (e instanceof Error ? e.message : String(e))); resolve(null); }
    };
    reader.onerror = () => { toast.error("文件读取失败"); resolve(null); };
    reader.readAsDataURL(file);
  }), [imgUploadMutation]);

  const isProcessing = payload.status === "processing" || executeMutation.isPending;

  const handleReset = useCallback(() => {
    setLocalJson("");
    setPhase("empty");
    update({ workflowJson: undefined, paramBindings: undefined, paramValues: {}, outputUrl: undefined, outputUrls: undefined, status: "idle", errorMessage: undefined, progress: undefined });
    setLocalBindings([]);
  }, [update]);

  const handleConfirmBindings = useCallback(() => {
    update({ paramBindings: localBindings });
    setPhase("run");
    setEditingBindings(false);
  }, [localBindings, update]);

  return (
    <BaseNode
      id={id}
      selected={selected}
      nodeType="comfyui_workflow"
      title={data.title}
      resizable
      onRun={handleRun}
      running={isProcessing}
      canRun={phase === "run" && !!payload.workflowJson?.trim()}
      hasResult={!!payload.outputUrls && payload.outputUrls.length > 0}
      borderTint={accentColor}
      headerTooltip={summary.ok ? annotationDetail : undefined}
      hideTypeBadge
      headerRight={cornerText ? (
        <span
          title={annotationDetail || cornerText}
          style={{ fontSize: 10.5, fontWeight: 600, color: accentColor, maxWidth: 150, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}
        >
          {cornerText}
        </span>
      ) : undefined}
    >
      {/* ref-image-in (top:28%): feed an upstream image into the first blank image
          param. The generic input/output dots are provided by BaseNode (id="input"
          at 50% left / id="output" at 50% right) — we no longer render duplicate
          "in"/"out" handles here (they overlapped the defaults and were unused). */}
      <Handle
        type="target"
        position={Position.Left}
        id="ref-image-in"
        style={{ ...handleStyle("oklch(0.7 0.18 145)", handlesActive, "square", connectState.target), top: "28%", left: -7 }}
        title="参考图输入"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 0" }}>

        {/* Config area — collapses when the node is deselected (results stay
            visible below), matching the other media nodes. */}
        <div
          style={{
            display: "flex", flexDirection: "column", gap: 10,
            overflow: "hidden",
            maxHeight: selected ? "9999px" : "0px",
            transition: selected
              ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
              : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
          }}
        >

        {/* 运行位置：本地自建服务器 vs 官方云端 cloud.comfy.org。
            云端开关仅管理员/白名单用户可用；外框颜色随之改变（绿=本地，蓝=云端）。 */}
        <div>
          <label style={labelStyle}>
            <Server size={9} style={{ display: "inline", marginRight: 3 }} />
            运行位置
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            {([["local", "本地服务器", accent], ["cloud", "云端 cloud.comfy.org", CLOUD_ACCENT]] as const).map(([key, label, col]) => {
              const active = (key === "cloud") === useCloud;
              const disabled = key === "cloud" && !canUseCloud;
              return (
                <button
                  key={key}
                  onClick={() => setUseCloud(key === "cloud")}
                  disabled={disabled}
                  title={disabled ? "ComfyUI 云服务仅向管理员和白名单用户开放" : undefined}
                  style={{
                    flex: 1, padding: "6px 4px", fontSize: 11, borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
                    borderWidth: 1, borderStyle: "solid",
                    borderColor: active ? col : BORDER_DEFAULT,
                    background: active ? `${col}1f` : "transparent",
                    color: disabled ? "var(--c-t4)" : active ? col : "var(--c-t2)",
                    opacity: disabled ? 0.55 : 1, fontWeight: active ? 600 : 400,
                  }}
                >{label}</button>
              );
            })}
          </div>
          {useCloud && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "var(--c-t4)" }}>
                {cloudConfigured
                  ? "已连接官方云端 cloud.comfy.org，无需本地服务器；服务端密钥已配置。"
                  : "⚠ 服务端尚未配置云端密钥（COMFYUI_CLOUD_API_KEY），运行将失败。"}
              </div>
              <button
                onClick={handleTestCloud}
                disabled={cloudTestMut.isPending}
                style={{
                  alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 10px", fontSize: 11, borderRadius: 7, cursor: cloudTestMut.isPending ? "default" : "pointer",
                  border: `1px solid ${CLOUD_ACCENT}`, background: `${CLOUD_ACCENT}1f`, color: CLOUD_ACCENT,
                }}
              >
                {cloudTestMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                测试云端连接
              </button>
            </div>
          )}
        </div>

        {/* Server URL — 仅本地模式显示（云端用服务端配置的地址，无需填写） */}
        {!useCloud && (
        <div>
          <label style={labelStyle}>
            <Server size={9} style={{ display: "inline", marginRight: 3 }} />
            ComfyUI 地址（留空用全局默认）
          </label>
          <ComfyServerUrlField
            id={id}
            value={payload.customBaseUrl ?? ""}
            onChange={(v) => update({ customBaseUrl: v })}
            serverUrls={payload.serverUrls ?? []}
            onChangeServerUrls={(next) => update({ serverUrls: next })}
            isFetching={testingServer}
            onRefresh={handleTestServer}
            accent={accent}
            borderAccent={BORDER_ACCENT}
            borderDefault={BORDER_DEFAULT}
            fieldBase={fieldBase}
          />
        </div>
        )}

        {/* ── Sync this workflow (JSON / bindings / values / address) to siblings ── */}
        {payload.workflowJson?.trim() && (
          <>
            <button
              onClick={() => setSyncOpen(true)}
              title="选择目标节点与类别，把当前工作流定义 / 参数值 / 服务器地址同步到其他自定义工作流节点（不含运行状态与结果）"
              className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10.5px] transition-all"
              style={{
                background: "oklch(0.65 0.20 140 / 0.08)",
                border: "1px dashed oklch(0.65 0.20 140 / 0.4)",
                color: accent, cursor: "pointer", marginBottom: 4,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.65 0.20 140 / 0.16)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.65 0.20 140 / 0.08)"; }}
            >
              <Copy className="w-3 h-3" />
              同步配置到其他自定义工作流节点…
            </button>
            <SyncConfigDialog open={syncOpen} onOpenChange={setSyncOpen} sourceId={id} nodeType="comfyui_workflow" accent={accent} />
          </>
        )}

        {/* ── Phase A: Empty ── */}
        {phase === "empty" && (
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
          >
            {/* Import from file (.json / ComfyUI .png) */}
            <div
              onClick={() => { if (!importing) importFileRef.current?.click(); }}
              style={{
                marginBottom: 8, padding: "10px 12px", borderRadius: 8, cursor: importing ? "wait" : "pointer",
                border: `1px dashed ${accent}`, background: "var(--c-input)", color: "var(--c-t2)",
                fontSize: 11.5, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {importing ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Workflow size={13} style={{ color: accent }} />}
              {importing ? "正在导入…" : "拖入或点击导入工作流文件（.json / ComfyUI .png）"}
            </div>
            <input ref={importFileRef} type="file" accept=".json,application/json,.png,image/png" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
            <div style={{ fontSize: 10, color: "var(--c-t4)", marginBottom: 10, lineHeight: 1.5 }}>
              最稳：ComfyUI 里用 <b>Save (API Format)</b> 导出的 .json，或带工作流的 PNG（直接可用，无需联服务器）。普通「Save」的 UI .json 会自动转换，但含未装节点 / Primitive 等复杂连接时可能转换失败。
            </div>

            {/* Preset buttons */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {[
                { label: "SDXL 1.0", json: PRESET_SDXL },
                { label: "SD3.5", json: PRESET_SD35 },
                { label: "Flux.1-dev", json: PRESET_FLUX },
                { label: "Flux Kontext", json: PRESET_FLUX_KONTEXT },
                { label: "Qwen-Image", json: PRESET_QWEN },
                { label: "HunyuanVideo", json: PRESET_HUNYUAN },
                { label: "Wan2.1", json: PRESET_WAN },
                { label: "Wan2.2", json: PRESET_WAN22 },
                { label: "LTX-Video", json: PRESET_LTXV },
              ].map((p) => (
                <button
                  key={p.label}
                  style={{
                    fontSize: 10.5, padding: "4px 9px", borderRadius: 6, cursor: "pointer",
                    background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)",
                    fontFamily: "var(--font-sans)", transition: "border-color 150ms ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = accent)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--c-bd2)")}
                  onClick={() => setLocalJson(p.json)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label style={labelStyle}>粘贴 API-format Workflow JSON</label>
            <NodeTextArea className="nowheel nowheel"
              style={{ ...fieldBase, minHeight: 120, resize: "vertical", fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}
              placeholder={'{\n  "3": { "class_type": "KSampler", ... },\n  ...\n}'}
              value={localJson}
              onValueChange={(v) => setLocalJson(v)}
              spellCheck={false}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                style={{
                  flex: 1, padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                  background: accent, border: "none", color: "#fff",
                  fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                  opacity: analyzeMutation.isPending ? 0.6 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                }}
                disabled={analyzeMutation.isPending}
                onClick={() => handleAnalyze(localJson)}
              >
                {analyzeMutation.isPending ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Workflow size={13} />}
                分析参数
              </button>
              <button
                style={{
                  padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                  background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)",
                  fontSize: 12, fontFamily: "var(--font-sans)",
                  display: "flex", alignItems: "center", gap: 5,
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={13} />
                上传文件
              </button>
              <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileUpload} />
            </div>
          </div>
        )}

        {/* ── Phase B: Binding Editor ── */}
        {phase === "binding" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: accent }}>
                检测到 {localBindings.length} 个参数
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {!editingBindings && (
                  <button
                    style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontFamily: "var(--font-sans)" }}
                    onClick={() => setEditingBindings(true)}
                  >编辑</button>
                )}
                <button
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontFamily: "var(--font-sans)" }}
                  onClick={handleReset}
                >
                  <RotateCcw size={11} style={{ display: "inline", marginRight: 3 }} />
                  重置
                </button>
              </div>
            </div>

            {/* Binding list */}
            <div className="nowheel nodrag" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
              {localBindings.map((b, i) => (
                <div key={i} style={{ background: "var(--c-input)", borderRadius: 6, padding: "7px 9px", border: "1px solid var(--c-bd2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editingBindings ? (
                        <NodeInput
                          style={{ ...fieldBase, padding: "4px 7px", fontSize: 11.5 }}
                          value={b.label}
                          onValueChange={(v) => {
                            const updated = [...localBindings];
                            updated[i] = { ...b, label: v };
                            setLocalBindings(updated);
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--c-t1)" }}>{b.label}</span>
                      )}
                      <span style={{ fontSize: 10, color: "var(--c-t4)", marginLeft: 6 }}>
                        节点 {b.nodeId} · {b.type}
                      </span>
                      {/* Role tag — drives precise auto-fill from upstream nodes.
                          Editable for text/image params. */}
                      {editingBindings && (b.type === "text" || b.type === "image") && (
                        <select
                          value={b.role ?? ""}
                          onChange={(e) => {
                            const updated = [...localBindings];
                            const role = e.target.value || undefined;
                            updated[i] = { ...b, role: role as WorkflowParamBinding["role"] };
                            setLocalBindings(updated);
                          }}
                          style={{ ...fieldBase, padding: "3px 6px", fontSize: 10.5, marginTop: 4, cursor: "pointer" }}
                        >
                          <option value="">角色：自动</option>
                          {b.type === "text" ? (
                            <>
                              <option value="positive">正向提示词</option>
                              <option value="negative">反向提示词</option>
                            </>
                          ) : (
                            <>
                              <option value="reference">参考图</option>
                              <option value="control">控制图</option>
                              <option value="mask">遮罩</option>
                            </>
                          )}
                        </select>
                      )}
                      {!editingBindings && b.role && (
                        <span style={{ fontSize: 9, color: accent, marginLeft: 6, padding: "1px 5px", borderRadius: 4, border: `1px solid ${accent}55` }}>
                          {b.role === "positive" ? "正向" : b.role === "negative" ? "反向" : b.role === "reference" ? "参考图" : b.role === "control" ? "控制图" : "遮罩"}
                        </span>
                      )}
                    </div>
                    {editingBindings && (
                      <button
                        style={{ padding: 4, borderRadius: 4, cursor: "pointer", background: "none", border: "none", color: "var(--c-t4)" }}
                        onClick={() => setLocalBindings(localBindings.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add custom binding */}
            {editingBindings && (
              <button
                style={{
                  marginTop: 6, width: "100%", padding: "6px", borderRadius: 6, cursor: "pointer",
                  background: "none", border: "1px dashed var(--c-bd2)", color: "var(--c-t4)",
                  fontSize: 11.5, fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}
                onClick={() => setLocalBindings([...localBindings, { nodeId: "", fieldPath: "inputs.text", label: "新参数", type: "text" }])}
              >
                <Plus size={12} />
                添加参数
              </button>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {editingBindings ? (
                <button
                  style={{
                    flex: 1, padding: "8px", borderRadius: 8, cursor: "pointer",
                    background: accent, border: "none", color: "#fff",
                    fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                  }}
                  onClick={handleConfirmBindings}
                >
                  确认参数绑定
                </button>
              ) : (
                <button
                  style={{
                    flex: 1, padding: "8px", borderRadius: 8, cursor: "pointer",
                    background: accent, border: "none", color: "#fff",
                    fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  }}
                  onClick={() => setPhase("run")}
                >
                  进入运行配置
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Phase C: Run Form ── */}
        {phase === "run" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: accent, fontWeight: 600 }}>
                {payload.workflowName || "自定义工作流"}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontFamily: "var(--font-sans)" }}
                  onClick={() => setPhase("binding")}
                >← 参数绑定</button>
                <button
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontFamily: "var(--font-sans)" }}
                  onClick={handleReset}
                >
                  <RotateCcw size={11} style={{ display: "inline", marginRight: 3 }} />
                  重置
                </button>
              </div>
            </div>

            {/* Upstream image hint: a connected image node fills blank image params on run. */}
            {upstreamImageUrl && (payload.paramBindings ?? []).some((b) => b.type === "image") && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "oklch(0.7 0.16 145)" }}>
                <ImageIcon size={11} />
                已连接上游图片，运行时将自动填入留空的图像参数
              </div>
            )}

            {/* Prompt priority — only when the workflow exposes a text/prompt param.
                仅填空(默认): only fill blank/default prompt from upstream; 上游优先:
                a connected upstream prompt overrides this node's prompt on run. */}
            {(payload.paramBindings ?? []).some((b) => b.type === "text") && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>提示词</label>
                <div style={{ display: "flex", gap: 6, flex: 1 }}>
                  {([["fill", "仅填空", false], ["prefer", "上游优先", true]] as const).map(([k, lbl, val]) => {
                    const active = (payload.preferUpstreamPrompt !== false) === val;
                    return (
                      <button
                        key={k}
                        onClick={() => update({ preferUpstreamPrompt: val })}
                        title={val ? "运行时若连了上游提示词/分镜，强制覆盖本节点的提示词参数" : "仅当本节点提示词为空或为工作流默认值时，才用上游提示词填入"}
                        style={{ flex: 1, padding: "5px 4px", fontSize: 11, borderRadius: 7, cursor: "pointer", borderWidth: 1, borderStyle: "solid", borderColor: active ? accent : BORDER_DEFAULT, background: active ? `${accent}1f` : "transparent", color: active ? accent : "var(--c-t2)", fontWeight: active ? 600 : 400 }}
                      >{lbl}</button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stale binding map warning: a binding points at a node id no longer in
                the workflow → its value (incl. forced upstream prompt) won't inject.
                Run is gated on this in handleRun; surface it here too. */}
            {staleBindingNodeIds.length > 0 && (
              <div style={{ fontSize: 10.5, color: "oklch(0.7 0.2 25)", marginBottom: 4, lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: 4 }}>
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>参数绑定与当前 Workflow 不同步（缺失节点 {staleBindingNodeIds.join("、")}）。请点「分析参数」重新分析，否则提示词/参数不会生效。</span>
              </div>
            )}

            {/* Upstream-prompt diagnostics: make 上游优先 observable. Shows whether an
                upstream prompt was detected and whether a positive prompt param exists
                to receive it — so "上游优先没生效" can be told apart from a wiring issue. */}
            {upstreamPromptInfo.hasTextParam && (() => {
              const { detected, hasPosTarget } = upstreamPromptInfo;
              const hasUpstream = !!(detected.positive || detected.negative);
              if (!hasUpstream) {
                return (
                  <div style={{ fontSize: 10.5, color: "var(--c-t3)", marginBottom: 4, lineHeight: 1.4 }}>
                    未检测到上游提示词。请将「提示词 / 分镜 / 脚本」节点的输出连到本节点，「上游优先」才有内容可覆盖。
                  </div>
                );
              }
              if (!hasPosTarget) {
                return (
                  <div style={{ fontSize: 10.5, color: "oklch(0.72 0.17 65)", marginBottom: 4, lineHeight: 1.4 }}>
                    已连上游提示词，但本工作流未识别到「正向提示词」参数。请在上方「参数绑定」里把对应文本参数的角色设为「正向」。
                  </div>
                );
              }
              return (
                <div style={{ fontSize: 10.5, color: "oklch(0.7 0.16 145)", marginBottom: 4, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={detected.positive || detected.negative}>
                  {payload.preferUpstreamPrompt !== false ? "运行时将用上游提示词覆盖：" : "运行时仅在留空/默认时填入上游提示词："}
                  {(detected.positive || detected.negative || "").slice(0, 60)}
                </div>
              );
            })()}

            {/* Seed mode — only when the workflow has a seed param. Random (default):
                re-roll each run; Fixed: use the value in the form below as-is. */}
            {(payload.paramBindings ?? []).some((b) => b.type === "number" && (/seed/i.test(b.fieldPath) || b.label.includes("种子"))) && (() => {
              const random = payload.randomizeSeed !== false;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>种子</label>
                  <div style={{ display: "flex", gap: 6, flex: 1 }}>
                    {([["random", "随机", true], ["fixed", "固定", false]] as const).map(([k, lbl, val]) => {
                      const active = random === val;
                      return (
                        <button
                          key={k}
                          onClick={() => update({ randomizeSeed: val })}
                          title={val ? "每次运行自动生成新随机种子" : "固定使用下方表单里的种子值"}
                          style={{
                            flex: 1, padding: "5px 4px", fontSize: 11, borderRadius: 7, cursor: "pointer",
                            borderWidth: 1, borderStyle: "solid",
                            borderColor: active ? accent : BORDER_DEFAULT,
                            background: active ? `${accent}1f` : "transparent",
                            color: active ? accent : "var(--c-t2)", fontWeight: active ? 600 : 400,
                          }}
                        >{lbl}</button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Aspect-ratio presets — shown when the workflow exposes width + height.
                Sets both params to a common resolution for the chosen ratio. */}
            {(() => {
              const widthB = (payload.paramBindings ?? []).find((b) => b.type === "number" && (/width/i.test(b.fieldPath) || b.label.includes("宽")));
              const heightB = (payload.paramBindings ?? []).find((b) => b.type === "number" && (/height/i.test(b.fieldPath) || b.label.includes("高")));
              if (!widthB || !heightB) return null;
              const PRESETS: [string, number, number][] = [["1:1", 1024, 1024], ["16:9", 1344, 768], ["9:16", 768, 1344], ["4:3", 1152, 896], ["3:4", 896, 1152]];
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>比例</label>
                  {PRESETS.map(([lbl, w, h]) => (
                    <button
                      key={lbl}
                      onClick={() => { setParamValue(`${widthB.nodeId}.${widthB.fieldPath}`, w); setParamValue(`${heightB.nodeId}.${heightB.fieldPath}`, h); }}
                      style={{ padding: "4px 9px", fontSize: 11, borderRadius: 6, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}
                    >{lbl}</button>
                  ))}
                </div>
              );
            })()}

            {/* Dynamic param form — capped height with internal scroll to keep the node compact */}
            {(payload.paramBindings ?? []).length > 0 && (
              <div className="nowheel nodrag" style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto", overflowX: "hidden" }}>
                {(payload.paramBindings ?? []).map((b) => {
                  const key = `${b.nodeId}.${b.fieldPath}`;
                  const value = payload.paramValues?.[key] ?? b.defaultValue ?? "";
                  return (
                    <div key={key}>
                      <label style={labelStyle}>{b.label}</label>
                      {b.type === "text" && (
                        <NodeTextArea
                          style={{ ...fieldBase, minHeight: 56, resize: "vertical" }}
                          value={String(value)}
                          onValueChange={(v) => setParamValue(key, v)}
                        />
                      )}
                      {b.type === "number" && (
                        <input
                          type="number"
                          style={fieldBase}
                          value={Number(value)}
                          min={b.min}
                          max={b.max}
                          step={b.step ?? 1}
                          onChange={(e) => setParamValue(key, parseFloat(e.target.value))}
                        />
                      )}
                      {b.type === "select" && (() => {
                        // Searchable combobox: a datalist lets the user type to
                        // filter long model lists yet still pick from suggestions
                        // (and free-type a value the server didn't report).
                        const hasOptions = !!b.options && b.options.length > 0;
                        const listId = `wf-opts-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
                        return (
                          <>
                            <NodeInput
                              list={hasOptions ? listId : undefined}
                              style={fieldBase}
                              value={String(value)}
                              placeholder={hasOptions ? `输入以搜索（${b.options!.length} 个可选）` : undefined}
                              onValueChange={(v) => setParamValue(key, v)}
                            />
                            {hasOptions && (
                              <datalist id={listId}>
                                {b.options!.map((opt) => <option key={opt} value={opt} />)}
                              </datalist>
                            )}
                          </>
                        );
                      })()}
                      {b.type === "boolean" && (
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(e) => setParamValue(key, e.target.checked)}
                          />
                          <span style={{ fontSize: 12, color: "var(--c-t2)" }}>{b.label}</span>
                        </label>
                      )}
                      {b.type === "image" && (
                        <>
                          {/* 来源映射：显式指定该图像参数用哪个上游节点的图（不填用智能自动排序）。
                              即使还没连上游图像，也显示一个禁用的占位下拉，让用户知道「可显式指定来源」这个功能存在、且知道下一步该连上游图。 */}
                          {upstreamSources.length > 0 ? (
                            <select
                              value={payload.imageSourceMap?.[key] ?? ""}
                              onChange={(e) => {
                                const map = { ...(payload.imageSourceMap ?? {}) };
                                if (e.target.value) map[key] = e.target.value; else delete map[key];
                                update({ imageSourceMap: map });
                              }}
                              style={{ ...fieldBase, padding: "5px 8px", fontSize: 11, marginBottom: 5, cursor: "pointer" }}
                              title="来源：选某个上游节点的图，或自动（按编号/位置/连线顺序）"
                            >
                              <option value="">来源：自动排序</option>
                              {upstreamSources.map((s, i) => (
                                <option key={s.id} value={s.id}>来源：{i + 1}. {s.title}</option>
                              ))}
                            </select>
                          ) : (
                            <select
                              disabled
                              value=""
                              style={{ ...fieldBase, padding: "5px 8px", fontSize: 11, marginBottom: 5, cursor: "default", opacity: 0.6 }}
                              title="把一个上游图像节点连到本节点的「参考图输入」句柄后，即可在此显式指定该图像参数的来源"
                            >
                              <option value="">来源：连接上游图像后可选 ▸</option>
                            </select>
                          )}
                          <ImageParamField
                            value={String(value)}
                            onChangeUrl={(u) => setParamValue(key, u)}
                            uploadFile={uploadLocalImage}
                            upstreamUrl={upstreamImageUrl}
                            onUploadToComfy={payload.customBaseUrl?.trim() ? (u) => handleImageParamUpload(b, u) : undefined}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Advanced: output type */}
            <div style={{ marginTop: 10 }}>
              <button
                style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--c-t4)", fontSize: 11, fontFamily: "var(--font-sans)", padding: 0, marginBottom: 6 }}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                高级选项
              </button>
              {showAdvanced && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>输出类型</label>
                    <select
                      style={{ ...fieldBase, cursor: "pointer" }}
                      value={payload.outputType ?? "auto"}
                      onChange={(e) => update({ outputType: e.target.value as "image" | "video" | "auto" })}
                    >
                      <option value="auto">自动检测</option>
                      <option value="image">图像</option>
                      <option value="video">视频</option>
                    </select>
                  </div>
                  {/* Output selection — pick which output node(s) to collect when
                      the workflow has more than one SaveImage / VHS output. */}
                  {(payload.outputNodes?.length ?? 0) > 1 && (() => {
                    const all = payload.outputNodes ?? [];
                    // empty/undefined outputNodeIds = collect all
                    const sel = payload.outputNodeIds && payload.outputNodeIds.length > 0 ? payload.outputNodeIds : all.map((o) => o.id);
                    const toggle = (id: string) => {
                      const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
                      // keep at least one selected; storing all is fine (== collect all)
                      update({ outputNodeIds: next.length > 0 ? next : [id] });
                    };
                    return (
                      <div>
                        <label style={labelStyle}>输出节点（{sel.length}/{all.length}）</label>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {all.map((o) => (
                            <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--c-t2)", cursor: "pointer" }}>
                              <input type="checkbox" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} />
                              节点 {o.id} · {o.classType}（{o.isVideo ? "视频" : "图像"}）
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* 进度条由 BaseNode 常驻渲染（收缩后仍可见） */}

            {/* Error */}
            {payload.status === "failed" && payload.errorMessage && (
              <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 6, background: "oklch(0.98 0.02 20)", border: "1px solid oklch(0.85 0.12 20)", color: "oklch(0.45 0.2 20)", fontSize: 11 }}>
                {payload.errorMessage.slice(0, 200)}
              </div>
            )}

            {/* Run button */}
            <button
              style={{
                marginTop: 10, width: "100%", padding: "9px", borderRadius: 8, cursor: isProcessing ? "not-allowed" : "pointer",
                background: isProcessing ? "var(--c-input)" : accent, border: isProcessing ? "1px solid var(--c-bd2)" : "none",
                color: isProcessing ? "var(--c-t3)" : "#fff", fontSize: 13, fontWeight: 700, fontFamily: "var(--font-sans)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
              disabled={isProcessing}
              onClick={handleRun}
            >
              {isProcessing
                ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />执行中…</>
                : <><Play size={14} />运 行</>
              }
            </button>
          </div>
        )}

        </div>{/* end collapsible config */}

        {/* ── Results ── (always visible, even when config is collapsed) */}
        {payload.status === "done" && payload.outputUrls && payload.outputUrls.length > 0 && (
          <div>
            {/* Section label is redundant once the node is collapsed (no config
                above it) — show it only while expanded; the result media stays. */}
            {selected && (
              <label style={{ ...labelStyle, marginBottom: 6 }}>
                输出结果（{payload.outputUrls.length} 个）
              </label>
            )}
            {/* Video output */}
            {payload.outputType === "video" ? (
              <div>
                {payload.outputUrls.map((url, i) => (
                  <div key={i} style={{ position: "relative", marginBottom: 8 }}>
                    <WatermarkedVideo
                      block
                      src={url}
                      controls
                      style={{ width: "100%", borderRadius: 8, maxHeight: 240, background: "#000" }}
                      onError={(e) => { (e.currentTarget as HTMLVideoElement).src = ""; }}
                    />
                    {/* MinIO storage indicator — parity with the image grid */}
                    {isOwnStorageUrl(url) && (
                      <div
                        title="已存储到 MinIO·长期有效"
                        style={{ position: "absolute", top: 6, left: 6, width: 10, height: 10, borderRadius: "50%", background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)", pointerEvents: "none" }}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* Image grid */
              <div style={{ display: "grid", gridTemplateColumns: payload.outputUrls.length > 1 ? "1fr 1fr" : "1fr", gap: 6 }}>
                {payload.outputUrls.map((url, i) => (
                  <div key={i} className="nodrag" style={{ position: "relative", paddingTop: "100%", borderRadius: 8, overflow: "hidden", background: "var(--c-input)", cursor: "zoom-in" }} onClick={() => setLightboxIdx(i)} title="点击放大">
                    <MediaImage
                      src={url}
                      alt={`Output ${i + 1}`}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                    />
                    {/* MinIO storage indicator (ComfyUI outputs are hard-locked to MinIO) */}
                    {isOwnStorageUrl(url) && (
                      <div
                        title="已存储到 MinIO·长期有效"
                        style={{ position: "absolute", top: 5, left: 5, width: 10, height: 10, borderRadius: "50%", background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)", pointerEvents: "none" }}
                      />
                    )}
                    <div style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.5)", borderRadius: 4, padding: "2px 5px" }}>
                      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#fff", fontSize: 10, textDecoration: "none" }}>
                        <ImageIcon size={10} style={{ display: "inline", marginRight: 2 }} />
                        {i + 1}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox — click an output image to enlarge / navigate */}
      {lightboxIdx !== null && payload.outputType !== "video" && payload.outputUrls && payload.outputUrls.length > 0 && lightboxIdx < payload.outputUrls.length && (
        <ImageLightbox
          images={payload.outputUrls}
          currentIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onNavigate={(idx) => setLightboxIdx(idx)}
        />
      )}
    </BaseNode>
  );
});

// ── Image param control ───────────────────────────────────────────────────────
// Bind an image to a workflow LoadImage param by: dragging an asset from the
// library / a file / an image URL onto it, picking a local file, or pasting a
// URL. Shows a thumbnail when set. stopPropagation on drop so the canvas doesn't
// ALSO spawn a duplicate asset node (same fix as the other media nodes).
function parseDragImageUrls(dt: DataTransfer): string[] {
  const assetRaw = dt.getData("application/x-asset-list");
  if (assetRaw) {
    try {
      const list = JSON.parse(assetRaw) as Array<{ url?: string; type?: string }>;
      return list.filter((a) => a.url && (!a.type || a.type === "image")).map((a) => a.url!);
    } catch { /* fall through */ }
  }
  const uri = dt.getData("text/uri-list") || dt.getData("text/plain");
  return uri ? uri.split(/[\r\n]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)) : [];
}

function ImageParamField({
  value, onChangeUrl, uploadFile, upstreamUrl, onUploadToComfy,
}: {
  value: string;
  onChangeUrl: (url: string) => void;
  uploadFile: (file: File) => Promise<string | null>;
  upstreamUrl?: string | null;
  onUploadToComfy?: (url: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doUploadFile = async (file: File) => {
    setUploading(true);
    const url = await uploadFile(file).finally(() => setUploading(false));
    if (url) onChangeUrl(url);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) { void doUploadFile(files[0]); return; }
    const urls = parseDragImageUrls(e.dataTransfer);
    if (urls.length) onChangeUrl(urls[0]);
  };

  const isImg = /^https?:\/\//.test(value) || value.startsWith("/");
  return (
    <div
      className="nodrag"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-asset-list") || e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list")) {
          e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{ display: "flex", flexDirection: "column", gap: 6, padding: 6, borderRadius: 8, border: `1px dashed ${dragOver ? BORDER_ACCENT : "var(--c-bd2)"}`, background: dragOver ? "color-mix(in oklch, var(--c-input) 82%, var(--c-base))" : "transparent" }}
    >
      {isImg && value && (
        <div style={{ position: "relative", width: "100%", height: 88, borderRadius: 6, overflow: "hidden", background: "var(--c-canvas)", border: "1px solid var(--c-bd2)" }}>
          <MediaImage src={value} alt="ref" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <button
            onClick={() => onChangeUrl("")}
            className="nodrag"
            title="清除"
            style={{ position: "absolute", top: 3, right: 3, padding: 3, borderRadius: "50%", background: "oklch(0 0 0 / 0.65)", color: "#fff", border: "none", lineHeight: 0, cursor: "pointer" }}
          >
            <X size={11} />
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <NodeInput
          style={{ ...fieldBase, flex: 1 }}
          placeholder="拖入图片 / 粘贴 URL / 上传文件"
          value={value}
          onValueChange={(v) => onChangeUrl(v)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="上传本地图片"
          style={{ padding: "6px 8px", borderRadius: 6, cursor: uploading ? "not-allowed" : "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontSize: 11, lineHeight: 0 }}
        >
          {uploading ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={12} />}
        </button>
        {value && onUploadToComfy && (
          <button
            onClick={() => onUploadToComfy(value)}
            title="预上传到 ComfyUI（可选；运行时也会自动上传）"
            style={{ padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: accent, border: "none", color: "#fff", fontSize: 11, lineHeight: 0 }}
          >
            <ImageIcon size={12} />
          </button>
        )}
      </div>
      {!value && upstreamUrl && (
        <button
          onClick={() => onChangeUrl(upstreamUrl)}
          className="nodrag"
          style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, padding: "3px 8px", borderRadius: 6, border: "1px solid oklch(0.65 0.16 145 / 0.4)", background: "transparent", color: "oklch(0.7 0.16 145)", cursor: "pointer" }}
        >
          <ImageIcon size={10} /> 用上游图填入
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void doUploadFile(f); }}
      />
    </div>
  );
}
