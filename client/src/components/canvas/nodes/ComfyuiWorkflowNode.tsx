import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useWorkflowRunState } from "../../../contexts/WorkflowRunContext";
import { ComfyWorkflowImportWizard, type ImportWizardResult } from "../ComfyWorkflowImportWizard";
import { handleStyle } from "../../../lib/handleStyle";
import { useConnectState } from "../../../hooks/useConnectingStore";
import { useHoverStore } from "../../../hooks/useHoverStore";
import { ComfyServerUrlField } from "./ComfyServerUrlField";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateRefImage, propagateWorkflowPrompt } from "../../../lib/refImagePropagation";
import type { ComfyuiWorkflowNodeData, WorkflowParamBinding, ReferenceImage } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { confirmRegenerate } from "@/lib/confirmRegenerate";
import { safeHref } from "@/lib/safeUrl";
import { detectUpstreamImageUrl, detectUpstreamPrompt, fillWorkflowPromptParams, fillWorkflowLoraParam, positivePromptParamKey, listUpstreamImageSources, resolveImageParamsWithMap, listUpstreamAudioSources, resolveAudioParamsWithMap, mentionedMediaSources, applyAspectToWorkflow, parseAspectRatioFromText, detectUpstreamAspectRatio, detectUpstreamDuration } from "@/lib/comfyWorkflowParams";
import { effectiveCharacters, connectedCharacterLora, effectiveCharacterRefImages, stripCharacterMentions } from "@/lib/characterConditioning";
import { mergeCharactersIntoPrompt } from "@/lib/characterPrompt";
import { applyFreeVramToAllComfyNodes } from "@/lib/comfyFreeVram";
import { summarizeComfyWorkflow } from "@/lib/comfyWorkflowSummary";
import { detectWorkflowFormat, extractComfyWorkflowsFromPng } from "@/lib/comfyWorkflowImport";
import { buildWorkflowExportJson, workflowExportFilename } from "@/lib/comfyWorkflowExport";
import { MediaImage } from "../MediaImage";
import { RefHeroPreview } from "../RefHeroPreview";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { ImageLightbox } from "../ImageLightbox";
import { ReferenceImageStrip, type StripItem } from "../ReferenceImageStrip";
import { PromptDock } from "../PromptDock";
import { useNodeDocks, useCharSceneItems, useAudioStripItems } from "../../../hooks/useNodeDocks";
import { openNodeImage } from "../NodeImageLightbox";
import { toast } from "sonner";
import {
  Workflow, Loader2, Upload, Download, X, ChevronDown, ChevronRight,
  Server, Play, RotateCcw, ImageIcon, FileVideo, Plus, Trash2, Copy, AlertTriangle, Wand2, Rotate3d, Boxes, SlidersHorizontal, Check,
} from "lucide-react";
import { SyncConfigDialog } from "../SyncConfigDialog";
import { Depth3DViewer } from "../Depth3DViewer";
import { Model3DViewer } from "../Model3DViewer";
import { useResultHistoryCapture } from "../../../hooks/useResultHistoryCapture";
import { ResultHistoryStrip } from "../ResultHistoryStrip";
import type { ResultSnapshot } from "../../../../../shared/types";
import { NodeTextArea, NodeInput } from "../NodeTextInput";
import { useCreativeAdvanced } from "../../../hooks/useCreativeAdvanced";
import { InlineGenBar } from "../InlineGenBar";
import { nanoid } from "nanoid";
import { isTransportCutError, pollComfyRun, type PendingComfyResult, type RecoveredRun } from "@/lib/comfyRunRecovery";

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
  const upstreamAudioSources = useMemo(() => listUpstreamAudioSources(id, edgesForSources, nodesForSources), [id, edgesForSources, nodesForSources]);
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
    const negB = texts.find((b) => b.role === "negative") ?? texts.find(isNeg);
    const tag = (b: WorkflowParamBinding | undefined) => (b ? `${b.label}（节点 ${b.nodeId}）` : undefined);
    // Ambiguous when there are 2+ text params but none carries an explicit role —
    // then positive/negative are guessed from labels and may land on the wrong slot.
    const ambiguous = texts.length >= 2 && !texts.some((b) => b.role === "positive" || b.role === "negative");
    return { detected, hasTextParam: texts.length > 0, hasPosTarget: !!posB, posTarget: tag(posB), negTarget: tag(negB), ambiguous };
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
    // 失效 = 节点已不在 JSON，**或** 该 id 被复用成了别的 class_type（分析时记录了 classType）——
    // 后者若不拦，参数会被注入到一个「幻影字段」上静默丢失（finding4）。
    return Array.from(new Set(bindings.filter((b) => {
      const nd = wf![b.nodeId] as { class_type?: unknown } | undefined;
      return !nd || (b.classType != null && nd.class_type !== b.classType);
    }).map((b) => b.nodeId)));
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
  // 3D 换视角（与图像节点相同）：伪3D(深度位移) / 真3D(图生 Tripo3D 网格)，换视角截图 → 回灌
  // 到工作流的**首个图像输入参数** → 重跑。pendingGen3d = 已写入参数、等 payload 反映后再跑。
  const [view3dSrc, setView3dSrc] = useState<string | null>(null);
  const [model3dSrc, setModel3dSrc] = useState<string | null>(null);
  const [pendingGen3d, setPendingGen3d] = useState(false);
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
  const analyzeAiMutation = trpc.comfyui.analyzeWorkflowAI.useMutation();
  // 「AI 辅助分析」：勾选后分析走本机 Claude + ComfyUI MCP 纠正参数类型/角色、判主次（需桥接已配）。
  const [aiAssist, setAiAssist] = useState(false);

  // Local vs official cloud (cloud.comfy.org). The cloud toggle is only usable by
  // admins / whitelisted users (and only when the server has it configured).
  const useCloud = payload.useCloudComfy === true;
  // Border-colored annotation: which workflow / models are loaded. Recomputed
  // only when the JSON changes. accentColor matches the node border (green local,
  // blue cloud); detail powers the hover tooltip.
  const accentColor = useCloud ? CLOUD_ACCENT : accent;
  const summary = useMemo(() => summarizeComfyWorkflow(payload.workflowJson), [payload.workflowJson]);
  // 工作流是否含可按比例覆盖尺寸的空 latent 节点（决定是否显示「尺寸比例」开关）。
  const hasOverridableLatent = useMemo(() => {
    if (!payload.workflowJson?.trim()) return false;
    try {
      const wf = JSON.parse(payload.workflowJson) as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
      return Object.values(wf).some((n) => n && /Empty.*Latent/.test(n.class_type ?? "") && typeof n.inputs?.width === "number" && typeof n.inputs?.height === "number");
    } catch { return false; }
  }, [payload.workflowJson]);
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

  // #163 隧道兜底取回：socket 回灌（pendingComfyResult）优先 + workflowResult 轮询，直到终局或超时。
  const recoverComfyRun = useCallback((jobId: string, nodeId: string): Promise<RecoveredRun> => {
    return pollComfyRun({
      jobId,
      readPending: () => {
        const n = useCanvasStore.getState().nodes.find((x) => x.id === nodeId);
        return (n?.data.payload as { pendingComfyResult?: PendingComfyResult } | undefined)?.pendingComfyResult;
      },
      fetchResult: (jid) => utils.comfyui.workflowResult.fetch({ jobId: jid }),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
  }, [utils]);

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
      if (aiAssist) toast.info("AI 辅助分析中（本机 Claude + ComfyUI MCP）…较慢请稍候");
      const result = aiAssist
        ? await analyzeAiMutation.mutateAsync({ customBaseUrl: payload.customBaseUrl?.trim() || undefined, workflowJson: trimmed, model: "claude-local" })
        : await analyzeMutation.mutateAsync({ customBaseUrl: payload.customBaseUrl?.trim() || undefined, workflowJson: trimmed });
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
      const note = (result as { aiNote?: string }).aiNote;
      toast.success(`检测到 ${bindings.length} 个参数` + (aiAssist && note ? ` · ${note}` : ""));
    } catch (err) {
      toast.error("分析失败：" + (err instanceof Error ? err.message : String(err)));
    }
  }, [analyzeMutation, analyzeAiMutation, aiAssist, payload.customBaseUrl, update]);

  // ── File import (drag/drop or picker): .json (API or UI graph) and ComfyUI .png
  //    (embedded workflow). API JSON → existing analyze flow; UI graph → server
  //    converts to API (object_info) first. On any failure, a clear toast + the
  //    existing paste flow remain — no existing path is touched.
  const convertMutation = trpc.comfyui.convertWorkflow.useMutation();
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  // 工具栏「一键导入」创建的节点：挂载即自动打开向导，随后清除瞬态标志（避免重开/被持久化）。
  useEffect(() => {
    if (payload._openWizard) {
      setShowWizard(true);
      update({ _openWizard: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 向导完成：把已预检/修正过的工作流 + 分析结果落到节点，进入既有参数绑定阶段。
  const applyWizardResult = useCallback((r: ImportWizardResult) => {
    const bindings = r.analyze.detectedParams;
    setLocalJson(r.workflowJson);
    setLocalBindings(bindings);
    update({
      workflowJson: r.workflowJson,
      paramBindings: bindings,
      outputNodeIds: r.analyze.outputNodeIds,
      outputNodes: r.analyze.outputNodes,
      outputType: r.analyze.outputType === "mixed" ? "auto" : r.analyze.outputType,
      paramValues: {},
      ...(r.customBaseUrl ? { customBaseUrl: r.customBaseUrl } : {}),
    });
    setPhase("binding");
    setShowWizard(false);
    toast.success(`向导导入成功 · 检测到 ${bindings.length} 个参数`);
  }, [update]);

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

  // 批量「运行全部」进行中：runner 用独立 mutation 实例跑本节点、并不写本节点 payload.status，
  // 故 isProcessing 为 false、手动「运行」会对同一节点再发一次 → 双扣费/占卡。批量中禁用手动运行。
  const batchRunning = useWorkflowRunState().running;
  // #77 LibTV 深度优化：创意模式配置区默认收起（选中也不展开），点输入条「高级」/快捷键 A
  // 才展开；输入条承担 提示词/高级/运行 主入口。工作室/专业保持原折叠逻辑（随选中展开）。
  const { isCreativeMode, advancedOpen, setAdvancedOpen } = useCreativeAdvanced(selected);

  const handleRun = useCallback(async () => {
    if (batchRunning) { toast.error("批量运行进行中，请等待完成后再单独运行"); return; }
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
          bindings.filter((b) => {
            const nd = wfNodes![b.nodeId] as { class_type?: unknown } | undefined;
            return !nd || (b.classType != null && nd.class_type !== b.classType); // 缺失 或 id 被复用成别的类型
          }).map((b) => b.nodeId),
        ));
        if (missing.length > 0) {
          toast.error(`参数绑定已与当前 Workflow 不同步（节点 ${missing.join("、")} 缺失或类型已变），提示词/参数可能无法生效。请点「分析参数」重新分析后再运行。`);
          return;
        }
      }
    }
    update({ status: "processing", errorMessage: undefined, progress: 0, pendingComfyResult: undefined }, true);
    // #163 一次性任务 id：随请求带给服务端；隧道切断超长 HTTP 时用它走 socket 回灌 / 轮询兜底取结果。
    const jobId = nanoid();
    // 落地成功产物（HTTP 正常返回 与 隧道切断后的兜底回灌 共用此路径）。在 try 外声明，使 catch
    // 的兜底分支也能调用；try 内计算出 effectiveParamValues 后再赋真身。
    let applyRunOutputs: (urls: string[], outputType: "image" | "video") => void = () => {};
    try {
      // Pull upstream images (multi-reference → fill blank image params in order)
      // and upstream prompt text (→ blank positive/negative prompt params).
      const { nodes, edges } = useCanvasStore.getState();
      const upstreamPrompt = detectUpstreamPrompt(id, edges, nodes);
      // Connected Character(s): their reference image becomes an extra image source,
      // their LoRA fills the workflow's lora_name param, and their profile text is
      // PREPENDED to the effective positive prompt (augment, never replace it).
      // 角色 = 连线 + prompt 里的「@角色」提及。@提及只从「实际生效」的提示词解析：
      // 上游优先(force)时用上游、仅填空时本地有就用本地，与 fillWorkflowPromptParams 一致，
      // 否则会同时采用上游和本节点的 @角色。
      const posPromptKey = positivePromptParamKey(payload.paramBindings);
      const posCur = posPromptKey && typeof payload.paramValues?.[posPromptKey] === "string" ? (payload.paramValues[posPromptKey] as string) : "";
      const upPos = (upstreamPrompt.positive ?? "").trim();
      const preferUpstream = payload.preferUpstreamPrompt !== false;
      const mentionText = preferUpstream ? (upPos || posCur) : (posCur.trim() ? posCur : upPos);
      const chars = effectiveCharacters(id, mentionText, edges, nodes);
      const charRefImgs = effectiveCharacterRefImages(id, mentionText, edges, nodes);
      const sources = [
        ...listUpstreamImageSources(id, edges, nodes),
        ...charRefImgs.map((url, i) => ({ id: `char_ref_${i}`, title: `角色参考${i + 1}`, url })),
        // @图像名 引用的独立图像节点（与上游来源并列，供参数自动填充 / 显式映射）。
        ...mentionedMediaSources(mentionText, "image", nodes).map((m) => ({ id: m.id, title: m.name, url: m.url })),
      ];
      // Explicit per-param「来源」mapping first, then smart auto-fill the rest.
      const imgResolved = resolveImageParamsWithMap(payload.paramBindings, payload.paramValues ?? {}, sources, payload.imageSourceMap ?? {});
      const imageParamKeys = imgResolved.imageParamKeys;
      // 音频参数：上游音频来源 + @音频名 引用 → 映射 + 自动填充（服务端运行时上传到 ComfyUI）。
      const audioSources = [
        ...listUpstreamAudioSources(id, edges, nodes),
        ...mentionedMediaSources(mentionText, "audio", nodes).map((m) => ({ id: m.id, title: m.name, url: m.url })),
      ];
      const audioResolved = resolveAudioParamsWithMap(payload.paramBindings, imgResolved.paramValues, audioSources, payload.audioSourceMap ?? {});
      const audioParamKeys = audioResolved.audioParamKeys;
      let paramValues = fillWorkflowPromptParams(payload.paramBindings, audioResolved.paramValues, upstreamPrompt, { force: payload.preferUpstreamPrompt !== false });
      // Prepend character identity to the resolved positive (augment, not replace).
      // 去掉字面量「@名字」，改用结构化注入。
      if (chars.length > 0 && posPromptKey) {
        const cur = typeof paramValues[posPromptKey] === "string" ? (paramValues[posPromptKey] as string) : "";
        paramValues = { ...paramValues, [posPromptKey]: mergeCharactersIntoPrompt(stripCharacterMentions(cur, nodes), chars) };
      }
      const charLora = connectedCharacterLora(id, edges, nodes);
      if (charLora) paramValues = fillWorkflowLoraParam(payload.paramBindings, paramValues, charLora.name);
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
      // #161 帧数跟随上游时长：开启后按 帧数=round(fps×上游时长) 覆盖帧数参数（上游无时长则保持原值）。
      if (payload.framesFollowUpstream) {
        const bs2 = payload.paramBindings ?? [];
        const fB = bs2.find((b) => b.type === "number" && (/(?:^|[._])(length|num_frames?|frames?(_number)?|frame_count|video_frames)$/i.test(b.fieldPath) || /帧数/i.test(b.label)));
        const rB = bs2.find((b) => b.type === "number" && (/\b(fps|frame[_-]?rate)\b/i.test(b.fieldPath) || /帧率|fps/i.test(b.label)));
        if (fB) {
          const dur = detectUpstreamDuration(id, edges, nodes);
          if (dur && dur > 0) {
            const fpsKey = rB ? `${rB.nodeId}.${rB.fieldPath}` : null;
            const fps = Number((fpsKey ? effectiveParamValues[fpsKey] : undefined) ?? 24) || 24;
            effectiveParamValues[`${fB.nodeId}.${fB.fieldPath}`] = Math.max(1, Math.round(fps * dur));
          }
        }
      }
      // 按比例覆盖工作流尺寸（保留像素面积、/64 对齐）：① 用户显式「按比例覆盖」→ 用
      // payload.aspectRatio；② 否则从生效提示词里解析画面比例（如 "16:9"）；③ 提示词没写则
      // **回退到上游输入图的比例**（图生视频关键：把 9:16 的图喂进模板不再出工作流默认 16:9）。
      // 用户已手动设置 width/height 参数值时仍以参数值为准；比例无法解析 / 无可改 latent 时原样提交。
      const effPosForRatio = posPromptKey && typeof effectiveParamValues[posPromptKey] === "string"
        ? (effectiveParamValues[posPromptKey] as string) : "";
      // 第三级「上游输入图比例」回退**仅限图生视频（outputType==="video"）**：否则会误伤文生图
      // 工作流——接一张参考图(IPAdapter/风格参考)就把原生方形 latent 重塑成参考图比例。
      const effectiveAspect = payload.overrideRatioSize
        ? payload.aspectRatio
        : (parseAspectRatioFromText(effPosForRatio || mentionText || upstreamPrompt.positive)
          || (payload.outputType === "video" ? detectUpstreamAspectRatio(id, edges, nodes) : undefined));
      const runWorkflowJson = effectiveAspect
        ? applyAspectToWorkflow(workflowJson, effectiveAspect).json
        : workflowJson;
      applyRunOutputs = (urls: string[], outputType: "image" | "video") => {
        update({
          outputUrl: urls[0] ?? "",
          outputUrls: urls,
          // Persist the actual produced type so onConnect/resolveNodeOutputImageUrl
          // never mistakes a video output for a reference image (config may be "auto").
          outputType,
          status: "done",
          errorMessage: undefined,
          progress: 100,
          pendingComfyResult: undefined,
        });
        // Auto-fill downstream reference-image targets — image outputs only.
        if (urls[0] && outputType !== "video") propagateRefImage(id, urls[0]);
        // Push the resolved prompt to downstream comfyui_video nodes (下发提示词).
        const bs = payload.paramBindings ?? [];
        const keyOf = (b?: WorkflowParamBinding) => (b ? `${b.nodeId}.${b.fieldPath}` : undefined);
        const posKey = keyOf(bs.find((b) => b.role === "positive") ?? bs.find((b) => b.type === "text" && /提示词|prompt/i.test(b.label) && !/负|negative/i.test(b.label)));
        const negKey = keyOf(bs.find((b) => b.role === "negative") ?? bs.find((b) => b.type === "text" && /负|negative/i.test(b.label)));
        const posText = posKey ? String(effectiveParamValues[posKey] ?? "") : "";
        const negText = negKey ? String(effectiveParamValues[negKey] ?? "") : undefined;
        if (posText.trim()) propagateWorkflowPrompt(id, posText, negText);
      };

      const result = await executeMutation.mutateAsync({
        nodeId: id,
        projectId: data.projectId,
        customBaseUrl: payload.customBaseUrl?.trim() || undefined,
        useCloudComfy: payload.useCloudComfy === true,
        workflowJson: runWorkflowJson,
        paramValues: effectiveParamValues,
        imageParamKeys: imageParamKeys.length > 0 ? imageParamKeys : undefined,
        audioParamKeys: audioParamKeys.length > 0 ? audioParamKeys : undefined,
        outputNodeIds: payload.outputNodeIds,
        outputType: payload.outputType ?? "auto",
        freeVramAfterRun: payload.freeVramAfterRun === true,
        jobId,
      });
      applyRunOutputs(result.urls, result.outputType === "video" ? "video" : "image");
      toast.success("执行完成");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // #163 隧道兜底：整个应用经 cloudflared 隧道时，这条超长 HTTP 在 ~100s 被切断——但服务端
      // **不因客户端断开而取消**，仍会跑完并把结果经 socket 回灌 + 存入 comfyJobStore。故传输类错误
      // （fetch/abort/超时/网关）不当作失败，转入「socket 回灌优先 + workflowResult 轮询」兜底取结果；
      // 服务端明确返回的业务错误（含具体信息、非传输类）则直接判失败。
      if (isTransportCutError(msg)) {
        const rec = await recoverComfyRun(jobId, id);
        if (rec?.ok && rec.urls) {
          applyRunOutputs(rec.urls, rec.outputType ?? "image");
          toast.success("执行完成（隧道切断后经回灌取回结果）");
          return;
        }
        if (rec && !rec.ok) {
          update({ status: "failed", errorMessage: rec.error ?? "执行失败", progress: undefined, pendingComfyResult: undefined }, true);
          toast.error("执行失败：" + (rec.error ?? "").slice(0, 120));
          return;
        }
        // 兜底轮询超时仍无终局 → 保持处理中提示但结束本次等待，落回失败态并给出可重试信息。
      }
      update({ status: "failed", errorMessage: msg, progress: undefined, pendingComfyResult: undefined }, true);
      toast.error("执行失败：" + msg.slice(0, 120));
    }
  }, [executeMutation, id, data.projectId, payload, update, batchRunning, recoverComfyRun]);

  // 3D 换视角：工作流的「首个图像输入参数」（type==="image" 的绑定）。有它才能把换视角截图
  // 回灌重跑；纯文生工作流无图像输入 → 禁用真·重绘（仍可看/截图）。
  const firstImageParamKey = useMemo(() => {
    const b = (payload.paramBindings ?? []).find((x) => x.type === "image");
    return b ? `${b.nodeId}.${b.fieldPath}` : null;
  }, [payload.paramBindings]);
  // 打开真3D查看器：引擎选择/计费确认在查看器内完成；同源图已有模型则直接复用（免费重开）。
  const openTrue3d = useCallback(async (url: string) => {
    if (url) setModel3dSrc(url);
  }, []);
  // 悬浮工具条「3D / 真3D」跨组件信号（BaseNode → 本节点）：源图取首个输出图。
  const pseudo3dToken = useCanvasStore((s) => (s.panelRequest?.nodeId === id && s.panelRequest?.panel === "pseudo3d" ? s.panelRequest.token : 0));
  const true3dToken = useCanvasStore((s) => (s.panelRequest?.nodeId === id && s.panelRequest?.panel === "true3d" ? s.panelRequest.token : 0));
  useEffect(() => {
    const src = payload.outputUrls?.[0];
    if (pseudo3dToken > 0 && src) setView3dSrc(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pseudo3dToken]);
  useEffect(() => {
    const src = payload.outputUrls?.[0];
    if (true3dToken > 0 && src) void openTrue3d(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [true3dToken]);
  // 换视角截图 → 写入首个图像输入参数（非默认值→resolveImageParamsWithMap 视为用户编辑而保留）→ 重跑。
  const on3dGenerate = useCallback((capturedUrl: string) => {
    if (!firstImageParamKey) { toast.error("该工作流没有图像输入参数，无法回灌重绘（可先连一个图生图/ControlNet 工作流）"); return; }
    update({ paramValues: { ...(payload.paramValues ?? {}), [firstImageParamKey]: capturedUrl } }, true);
    setPendingGen3d(true);
  }, [firstImageParamKey, payload.paramValues, update]);
  // 参数写入后等 payload 反映到位再重跑（避免 handleRun 闭包读到旧 paramValues）。
  useEffect(() => {
    if (!pendingGen3d || payload.status === "processing") return;
    setPendingGen3d(false);
    void handleRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGen3d, payload.status, payload.paramValues]);

  // #5 版本历史（仅图像输出）：每产出新图存一条快照；回滚把某条写回 outputUrls。
  const imgOutUrl = payload.outputType !== "video" ? payload.outputUrls?.[0] : undefined;
  useResultHistoryCapture(id, { current: imgOutUrl, urls: payload.outputUrls, history: payload.resultHistory });
  const rollbackToSnapshot = useCallback((snap: ResultSnapshot) => {
    update({ outputUrls: snap.urls ?? [snap.url], outputUrl: snap.url });
  }, [update]);

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

  // #149 上游参考图列表的 ref（paramImages 在下方才计算；回调经 ref 取最新值避免声明顺序问题）。
  const paramImagesRef = useRef<{ url?: string }[]>([]);

  const setParamValue = useCallback((key: string, value: unknown) => {
    update({ paramValues: { ...payload.paramValues, [key]: value } }, true);
  }, [payload.paramValues, update]);

  // #149 宽/高参数快捷填入：识别工作流暴露的宽/高绑定对；applyWH 一次原子写两键
  //（连续两次 setParamValue 会因闭包旧值互相覆盖——既有比例 chips 的隐性 bug 一并修掉）。
  const whBindings = useMemo(() => {
    const bs = payload.paramBindings ?? [];
    const w = bs.find((b) => b.type === "number" && (/width/i.test(b.fieldPath) || b.label.includes("宽")));
    const h = bs.find((b) => b.type === "number" && (/height/i.test(b.fieldPath) || b.label.includes("高")));
    return w && h ? { w, h } : null;
  }, [payload.paramBindings]);
  const applyWH = useCallback((w: number, h: number) => {
    if (!whBindings) return;
    update({ paramValues: {
      ...payload.paramValues,
      [`${whBindings.w.nodeId}.${whBindings.w.fieldPath}`]: w,
      [`${whBindings.h.nodeId}.${whBindings.h.fieldPath}`]: h,
    } }, true);
  }, [whBindings, payload.paramValues, update]);
  /** 读取上游/参考图实际分辨率填入宽高：/16 对齐、长边等比夹到 1344（常见工作流上限）。 */
  const fillWHFromUpstream = useCallback(() => {
    const url = paramImagesRef.current[0]?.url;
    if (!url) { toast.error("没有上游/参考图可读取尺寸——先连上游图或在参考条添加"); return; }
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { toast.error("读取图片尺寸失败"); return; }
      const MAXL = 1344;
      const scale = Math.min(1, MAXL / Math.max(w, h));
      w = Math.max(16, Math.round((w * scale) / 16) * 16);
      h = Math.max(16, Math.round((h * scale) / 16) * 16);
      applyWH(w, h);
      toast.success(`已按上游图填入 ${w}×${h}（/16 对齐${scale < 1 ? `、长边缩至 ${MAXL}` : ""}）`);
    };
    img.onerror = () => toast.error("读取上游图失败（图片无法加载）");
    img.src = url;
  }, [applyWH]);

  // #161 帧率/帧数：识别工作流暴露的 fps / 帧数（length/num_frames/…）绑定，支持「时长×帧率自动算帧数」+ 快填。
  const fpsBinding = useMemo(() => {
    const bs = payload.paramBindings ?? [];
    return bs.find((b) => b.type === "number" && (/\b(fps|frame[_-]?rate)\b/i.test(b.fieldPath) || /帧率|fps/i.test(b.label))) ?? null;
  }, [payload.paramBindings]);
  const framesBinding = useMemo(() => {
    const bs = payload.paramBindings ?? [];
    return bs.find((b) => b.type === "number" && (/(?:^|[._])(length|num_frames?|frames?(_number)?|frame_count|video_frames)$/i.test(b.fieldPath) || /帧数/i.test(b.label))) ?? null;
  }, [payload.paramBindings]);
  const bkey = (b: WorkflowParamBinding) => `${b.nodeId}.${b.fieldPath}`;
  const effectiveFps = useCallback((): number => {
    if (!fpsBinding) return 24;
    const v = Number(payload.paramValues?.[bkey(fpsBinding)] ?? 24);
    return v > 0 ? v : 24;
  }, [fpsBinding, payload.paramValues]);
  /** 按时长（秒）写入帧数 = round(fps × 时长)（帧数下限 1）。 */
  const applyFramesFromDuration = useCallback((durationSec: number) => {
    if (!framesBinding || !(durationSec > 0)) return false;
    const frames = Math.max(1, Math.round(effectiveFps() * durationSec));
    update({ paramValues: { ...payload.paramValues, [bkey(framesBinding)]: frames } }, true);
    return true;
  }, [framesBinding, effectiveFps, payload.paramValues, update]);
  const setFps = useCallback((fps: number) => {
    if (!fpsBinding || !(fps > 0)) return;
    update({ paramValues: { ...payload.paramValues, [bkey(fpsBinding)]: fps } }, true);
  }, [fpsBinding, payload.paramValues, update]);
  /** 「按上游时长算帧数」：读上游直连节点时长 → 写帧数。 */
  const fillFramesFromUpstream = useCallback(() => {
    const dur = detectUpstreamDuration(id, edgesForSources, nodesForSources);
    if (!dur) { toast.error("没有可用的上游时长——请连上分镜/脚本/视频等带时长的上游节点"); return; }
    if (applyFramesFromDuration(dur)) toast.success(`已按上游时长 ${dur}s × ${effectiveFps()}fps 填入帧数 ${Math.round(effectiveFps() * dur)}`);
  }, [id, edgesForSources, nodesForSources, applyFramesFromDuration, effectiveFps]);

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

  // 「上传参考图」：直接上传本地图片作参考，填入工作流第一个（留空优先）图像参数——
  // 无需先连上游图像节点，也无需展开高级参数绑定去逐个填。运行时服务端再把该 URL 上传到 ComfyUI。
  const uploadRefInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const handleUploadReference = useCallback(async (file: File) => {
    const cur = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.payload as ComfyuiWorkflowNodeData | undefined;
    const imgs = (cur?.paramBindings ?? []).filter((b) => b.type === "image");
    if (imgs.length === 0) { toast.error("该工作流没有图像输入参数——先在「参数绑定」把某个图像节点标为参数"); return; }
    setUploadingRef(true);
    const url = await uploadLocalImage(file);
    setUploadingRef(false);
    if (!url) return;
    const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v.trim());
    const target = imgs.find((b) => !isUrl(cur?.paramValues?.[`${b.nodeId}.${b.fieldPath}`])) ?? imgs[0];
    setParamValue(`${target.nodeId}.${target.fieldPath}`, url);
    toast.success(`参考图已上传并填入「${target.label}」`);
  }, [id, uploadLocalImage, setParamValue]);

  // 上传本地音频到我们的存储，返回 URL；运行时服务端再把该 URL 上传到 ComfyUI。
  const uploadLocalAudio = useCallback((file: File): Promise<string | null> => new Promise((resolve) => {
    if (!file.type.startsWith("audio/")) { toast.error("请选择音频文件"); resolve(null); return; }
    if (file.size > 200 * 1024 * 1024) { toast.error("音频不能超过 200MB"); resolve(null); return; }
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

  // #142 取消生成（与 comfyui_image/video 同款）：POST /interrupt 中断本地推理，
  // 立即回落可重跑状态——此前工作流模板节点完全没有取消入口。
  const interruptMutation = trpc.comfyui.interrupt.useMutation({
    onSuccess: () => toast.success("已发送中断请求"),
    onError: (err) => toast.error("中断失败：" + err.message),
  });
  const handleCancel = useCallback(() => {
    interruptMutation.mutate({ customBaseUrl: payload.customBaseUrl?.trim() || undefined });
    update({ status: "failed", errorMessage: "已取消生成", progress: undefined });
  }, [interruptMutation, payload.customBaseUrl, update]);

  // #142 多图选用：下游（hero/3D/历史/装配/参考传播）一律消费 outputUrls[0]/outputUrl，
  // 「设为使用图」= 把选中图挪到首位并同步 outputUrl。此前多图只能放大、不能选用。
  const selectOutput = useCallback((url: string) => {
    const rest = (payload.outputUrls ?? []).filter((u) => u !== url);
    update({ outputUrl: url, outputUrls: [url, ...rest] });
    toast.success("已设为使用图（下游节点将使用这张）");
  }, [payload.outputUrls, update]);

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

  // #160 导出工作流：把当前 API-format workflowJson（回写用户已设的非图像/音频参数值）
  // 下载为 .json——可在 ComfyUI 里 Load 直接复用，或存档/分享。
  const handleExportWorkflow = useCallback(() => {
    const json = buildWorkflowExportJson(payload.workflowJson, payload.paramBindings, payload.paramValues);
    if (!json) { toast.error("当前没有可导出的工作流"); return; }
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = workflowExportFilename(payload.workflowName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success("已导出工作流 JSON（API 格式，可在 ComfyUI 里 Load）");
    } catch {
      toast.error("导出失败，请重试");
    }
  }, [payload.workflowJson, payload.paramBindings, payload.paramValues, payload.workflowName]);

  // ── 左侧只读「汇总吸附窗」：把本工作流所有图像参数当前绑定的图集中预览 ──
  // 每张图绑定到一个具体的工作流图像参数（key=`节点.字段`），排序/插入无意义，
  // 故只读：仅预览 + 点击放大 + 删除（删除＝清空该参数）。节点折叠后仍可见。
  const isPreviewableUrl = (v: unknown): v is string =>
    typeof v === "string" && /^(https?:|data:|blob:|\/)/.test(v.trim());
  const paramImages: StripItem[] = useMemo(() => {
    const out: StripItem[] = [];
    for (const b of payload.paramBindings ?? []) {
      if (b.type !== "image") continue;
      const key = `${b.nodeId}.${b.fieldPath}`;
      const val = payload.paramValues?.[key];
      if (isPreviewableUrl(val)) out.push({ id: key, url: val.trim(), source: "url", label: "工作流图", removable: true });
    }
    return out;
  }, [payload.paramBindings, payload.paramValues]);
  const clearImageParam = useCallback((key: string) => {
    update({ paramValues: { ...payload.paramValues, [key]: "" } }, true);
  }, [payload.paramValues, update]);

  // ── 顶部「最终提示词」：工作流正向/负向词参数，按「上游优先」与角色注入解析后的结果 ──
  // 与 handleRun 同源：preferUpstream 时用上游、否则本地非空则本地；再叠加 @角色/连线角色注入。
  const finalPromptInfo = useMemo(() => {
    const bindings = payload.paramBindings ?? [];
    const up = detectUpstreamPrompt(id, edgesForSources, nodesForSources);
    const preferUpstream = payload.preferUpstreamPrompt !== false;
    const posKey = positivePromptParamKey(bindings);
    const posCur = posKey && typeof payload.paramValues?.[posKey] === "string" ? (payload.paramValues[posKey] as string) : "";
    const upPos = (up.positive ?? "").trim();
    const basePos = preferUpstream ? (upPos || posCur) : (posCur.trim() ? posCur : upPos);
    const chars = effectiveCharacters(id, basePos, edgesForSources, nodesForSources);
    const finalPos = mergeCharactersIntoPrompt(stripCharacterMentions(basePos, nodesForSources), chars);
    const negB = bindings.find((b) => b.role === "negative") ?? bindings.find((b) => b.type === "text" && /负|negative/i.test(b.label));
    const negKey = negB ? `${negB.nodeId}.${negB.fieldPath}` : undefined;
    const negCur = negKey ? String(payload.paramValues?.[negKey] ?? "") : "";
    const upNeg = (up.negative ?? "").trim();
    const finalNeg = preferUpstream ? (upNeg || negCur) : (negCur.trim() ? negCur : upNeg);
    const usedUpstream = preferUpstream && !!upPos;
    const source = `${usedUpstream ? "上游" : "本地"}${chars.length ? "+角色" : ""}`;
    // basePos 保留 @角色 提及（未被 merge 改写），供左侧吸附窗解析参与的角色/场景。
    return { pos: finalPos, neg: finalNeg, source, hasPos: !!finalPos.trim(), basePos };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, edgesForSources, nodesForSources, payload.paramBindings, payload.paramValues, payload.preferUpstreamPrompt]);

  // 工作流图像参数 + 最终参与的角色/场景图（按解析前正向词里的 @提及/连线，只读）。
  const charSceneItems = useCharSceneItems(id, finalPromptInfo.basePos);
  const audioItems = useAudioStripItems(id); // 「音频」波形项放最后
  paramImagesRef.current = paramImages; // #149 供 fillWHFromUpstream 读最新参考图
  const stripImages: StripItem[] = [...paramImages, ...charSceneItems, ...audioItems];
  const docks = useNodeDocks(id, { hasRef: stripImages.length >= 1, hasPrompt: finalPromptInfo.hasPos }, { prompt: finalPromptInfo.pos, ref: stripImages.map((i) => i.id).join(",") });
  const stripOpen = docks.refOpen;
  const setStripOpen = docks.setRefOpen;

  // 收缩态 hero：有结果显示首个输出（视频/图像按 outputType），否则用工作流的图像参数
  // （paramImages = 参考图）兜底——否则工作室收缩后整张卡片只剩标题栏，结果/参考都看不见。
  const wfHero = (payload.status === "done" && payload.outputUrls && payload.outputUrls.length > 0) ? (
    payload.outputType === "video" ? (
      <div className="relative" style={{ width: "100%" }}>
        <WatermarkedVideo block src={payload.outputUrls[0]} controls className="w-full" preload="metadata" style={{ display: "block" }} />
      </div>
    ) : payload.outputUrls.length > 1 ? (
      // #142 hero 多图网格可点选（与 comfyui_image hero 同款）：创意模式配置区收起时
      // 也能「选择一张为使用图」。点选把该图挪到 outputUrls[0]（下游消费位）。
      <div
        className="grid gap-1 p-2"
        style={{ gridTemplateColumns: payload.outputUrls.length === 4 ? "1fr 1fr" : `repeat(${Math.min(payload.outputUrls.length, 3)}, 1fr)` }}
      >
        {payload.outputUrls.map((url, idx) => (
          <div
            key={url + idx}
            className="nodrag relative rounded-lg overflow-hidden cursor-pointer"
            onClick={(e) => { e.stopPropagation(); if (idx !== 0) selectOutput(url); }}
            title={idx === 0 ? "当前使用图（下游节点使用这张）" : "点击设为使用图"}
            style={{ background: "var(--c-canvas)", outline: idx === 0 ? `2px solid ${accent}` : "none", outlineOffset: -2 }}
          >
            <MediaImage src={url} alt={`workflow-output-${idx}`} className="w-full" draggable={false} />
            {idx === 0 && (
              <div className="absolute top-1 right-1 rounded-full flex items-center justify-center" style={{ width: 16, height: 16, background: accent }}>
                <Check style={{ width: 10, height: 10, color: "var(--c-canvas)" }} />
              </div>
            )}
          </div>
        ))}
      </div>
    ) : (
      <div className="group relative overflow-hidden" style={{ width: "100%" }}>
        <MediaImage src={payload.outputUrls[0]} alt="workflow-output" className="w-full" draggable={false} style={{ display: "block" }} />
        {/* 3D 换视角入口（与图像节点相同）：hover 显示，截图回灌首个图像参数后重跑 */}
        <div className="nodrag absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); setView3dSrc(payload.outputUrls![0]); }}
            title="把这张图虚拟化为伪 3D（深度位移），拖拽换视角后重绘"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
            style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
          >
            <Rotate3d style={{ width: 12, height: 12 }} /> 3D
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void openTrue3d(payload.outputUrls![0]); }}
            title="图生真 3D 网格（Tripo3D），完整 360° 环绕后从新视角重绘"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
            style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
          >
            <Boxes style={{ width: 12, height: 12 }} /> 真3D
          </button>
        </div>
      </div>
    )
  ) : paramImages[0]?.url ? (
    <RefHeroPreview url={paramImages[0].url} />
  ) : null;

  return (
    <>
    <BaseNode
      id={id}
      selected={selected}
      nodeType="comfyui_workflow"
      title={data.title}
      resizable
      heroMedia={wfHero}
      onRun={handleRun}
      running={isProcessing}
      onCancelGenerate={handleCancel}
      canRun={phase === "run" && !!payload.workflowJson?.trim()}
      hasResult={!!payload.outputUrls && payload.outputUrls.length > 0}
      borderTint={accentColor}
      headerTooltip={summary.ok ? annotationDetail : undefined}
      hideTypeBadge
      onHeaderHoverChange={docks.onHeaderHoverChange}
      extraHandles={
        <Handle
          type="target"
          position={Position.Left}
          id="ref-image-in"
          style={{ ...handleStyle("oklch(0.7 0.18 145)", handlesActive, "square", connectState.target), top: "28%", left: -7 }}
          title="参考图输入"
        />
      }
      headerRight={cornerText ? (
        <span
          title={annotationDetail || cornerText}
          style={{ fontSize: 10.5, fontWeight: 600, color: accentColor, maxWidth: 150, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}
        >
          {cornerText}
        </span>
      ) : undefined}
      leftDock={
        <>
          <ReferenceImageStrip
            images={stripImages}
            open={stripOpen}
            accent={accent}
            readOnly
            readOnlyHint={<>工作流图像参数<br />删除＝清空该参数</>}
            title="工作流图"
            onClose={() => setStripOpen(false)}
            onRemove={clearImageParam}
            onMove={() => {}}
            onInsertUrls={() => {}}
            onDropFiles={() => {}}
            onZoom={(i) => { const u = stripImages[i]?.url; if (u) openNodeImage(u); }}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinRef}
          />
          <PromptDock
            open={docks.promptOpen}
            text={finalPromptInfo.pos}
            negText={finalPromptInfo.neg}
            source={finalPromptInfo.source}
            accent={accent}
            onClose={() => docks.setPromptOpen(false)}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinPrompt}
          />
        </>
      }
    >
      {/* 导入向导（弹层，任意阶段可用：空节点首次导入 / 已导入节点换工作流） */}
      {showWizard && (
        <ComfyWorkflowImportWizard
          initialServerUrl={payload.customBaseUrl?.trim() || undefined}
          knownServers={payload.serverUrls}
          onCancel={() => setShowWizard(false)}
          onComplete={applyWizardResult}
        />
      )}
      {/* ref-image-in (top:28%) and the generic input/output dots are rendered via
          BaseNode (extraHandles / default handles) — outside the collapsible body so
          they survive the studio skin's collapsed state. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 0" }}>

        {/* Config area — collapses when the node is deselected (results stay
            visible below), matching the other media nodes. */}
        <div
          style={{
            display: "flex", flexDirection: "column", gap: 10,
            overflow: "hidden",
            maxHeight: selected && !(isCreativeMode && !advancedOpen) ? "9999px" : "0px",
            transition: selected && !(isCreativeMode && !advancedOpen)
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
            {/* 推荐：专业导入向导（分步 + 服务器预检 + 一键重映射，一次跑通） */}
            <button
              onClick={() => setShowWizard(true)}
              style={{
                width: "100%", marginBottom: 8, padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                background: `${accent}1f`, border: `1px solid ${accent}`, color: accent,
                fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
              title="分步引导：载入 → 选服务器 → 预检（检查节点/模型是否存在并一键替换）→ 导入"
            >
              <Wand2 size={14} /> 导入向导（推荐 · 导入前预检，一次跑通）
            </button>
            <div style={{ fontSize: 10, color: "var(--c-t4)", marginBottom: 8, textAlign: "center" }}>—— 或手动导入 ——</div>

            {/* AI 辅助分析：勾选后手动导入的「分析」走本机 Claude + ComfyUI MCP，纠正参数类型/角色、判主次。 */}
            <label className="nodrag" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 10.5, lineHeight: 1.5, color: "var(--c-t3)", marginBottom: 8, cursor: "pointer", padding: "6px 8px", borderRadius: 7, background: aiAssist ? `${accent}14` : "var(--c-input)", border: `1px solid ${aiAssist ? accent : "var(--c-bd2)"}` }}>
              <input type="checkbox" checked={aiAssist} onChange={(e) => setAiAssist(e.target.checked)} style={{ marginTop: 1 }} />
              <span><strong style={{ color: aiAssist ? accent : "var(--c-t2)" }}>🤖 AI 辅助分析</strong>（本机 Claude + ComfyUI MCP 查真实节点 schema，纠正参数类型/正负、按主次排序）。需已配「桥接 MCP 配置」；较慢，失败自动回退启发式。</span>
            </label>

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
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: `${accent}14`, border: `1px solid ${accent}55`, color: accent, fontFamily: "var(--font-sans)" }}
                  onClick={() => setShowWizard(true)}
                  title="用导入向导换一个工作流（重新预检/重映射）"
                >
                  <Wand2 size={11} style={{ display: "inline", marginRight: 3 }} />
                  换工作流
                </button>
                <button
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontFamily: "var(--font-sans)" }}
                  onClick={handleExportWorkflow}
                  title="导出当前工作流为 API 格式 .json（含已设参数，可在 ComfyUI 里 Load）"
                >
                  <Download size={11} style={{ display: "inline", marginRight: 3 }} />
                  导出
                </button>
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
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: `${accent}14`, border: `1px solid ${accent}55`, color: accent, fontFamily: "var(--font-sans)" }}
                  onClick={() => setShowWizard(true)}
                  title="用导入向导换一个工作流（重新预检/重映射）"
                >
                  <Wand2 size={11} style={{ display: "inline", marginRight: 3 }} />
                  换工作流
                </button>
                <button
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontFamily: "var(--font-sans)" }}
                  onClick={handleExportWorkflow}
                  title="导出当前工作流为 API 格式 .json（含已设参数，可在 ComfyUI 里 Load）"
                >
                  <Download size={11} style={{ display: "inline", marginRight: 3 }} />
                  导出
                </button>
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

            {/* 「上传参考图」：直接上传本地图片作参考（无需先连上游图/展开高级绑定），填入首个图像参数。 */}
            {(payload.paramBindings ?? []).some((b) => b.type === "image") && (
              <div style={{ marginTop: 6, marginBottom: 4 }}>
                <input
                  ref={uploadRefInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleUploadReference(f); }}
                />
                <button
                  className="nodrag"
                  disabled={uploadingRef}
                  onClick={(e) => { e.stopPropagation(); uploadRefInputRef.current?.click(); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, padding: "5px 10px", borderRadius: 7, cursor: uploadingRef ? "not-allowed" : "pointer", background: `${accent}14`, border: `1px solid ${accent}55`, color: accent, fontFamily: "var(--font-sans)" }}
                  title="上传本地图片作参考，自动填入工作流第一个（留空优先）图像参数"
                >
                  {uploadingRef ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {uploadingRef ? "上传中…" : "上传参考图"}
                </button>
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

            {/* 尺寸比例：按项目比例覆盖工作流的 latent 尺寸（保留像素面积、/64 对齐）。
                只在工作流含可改的空 latent 节点时显示。 */}
            {hasOverridableLatent && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>尺寸比例</label>
                <div style={{ display: "flex", gap: 6, flex: 1, alignItems: "center" }}>
                  <button
                    onClick={() => update({ overrideRatioSize: !payload.overrideRatioSize })}
                    title="开启后，提交前把工作流里空 latent 节点的宽高按所选比例改写（保留原像素面积、对齐到 64），让 ComfyUI 出图/出视频符合项目比例"
                    style={{ flex: 1, padding: "5px 4px", fontSize: 11, borderRadius: 7, cursor: "pointer", borderWidth: 1, borderStyle: "solid", borderColor: payload.overrideRatioSize ? accent : BORDER_DEFAULT, background: payload.overrideRatioSize ? `${accent}1f` : "transparent", color: payload.overrideRatioSize ? accent : "var(--c-t2)", fontWeight: payload.overrideRatioSize ? 600 : 400 }}
                  >{payload.overrideRatioSize ? "✓ 按比例覆盖" : "用工作流原尺寸"}</button>
                  {payload.overrideRatioSize && (
                    <select
                      value={payload.aspectRatio ?? "16:9"}
                      onChange={(e) => update({ aspectRatio: e.target.value })}
                      style={{ padding: "5px 6px", fontSize: 11, borderRadius: 7, cursor: "pointer", borderWidth: 1, borderStyle: "solid", borderColor: accent, background: "var(--c-input)", color: "var(--c-t1)" }}
                    >
                      {["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "4:5"].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </div>
              </div>
            )}

            {/* Prompt forwarding — re-emit this node's effective prompt to downstream
                nodes (transparent forwarder). Only meaningful when there's a text
                param to forward. Default ON. */}
            {(payload.paramBindings ?? []).some((b) => b.type === "text") && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>向下游转发</label>
                <div style={{ display: "flex", gap: 6, flex: 1 }}>
                  {([["on", "转发", true], ["off", "不转发", false]] as const).map(([k, lbl, val]) => {
                    const active = (payload.forwardPrompt !== false) === val;
                    return (
                      <button
                        key={k}
                        onClick={() => update({ forwardPrompt: val })}
                        title={val ? "把本节点实际生效的提示词继续传给下游节点（可串联）" : "提示词在本节点终止，不再传给下游"}
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
              const { detected, hasPosTarget, posTarget, negTarget, ambiguous } = upstreamPromptInfo;
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
                    已连上游提示词，但本工作流未识别到「正向提示词」参数。请点「参数绑定」→「编辑」，把对应文本参数的角色设为「正向」。
                  </div>
                );
              }
              return (
                <div style={{ marginBottom: 4, lineHeight: 1.45 }}>
                  {/* Show the EXACT target param(s) so wrong-slot mapping is visible. */}
                  {detected.positive && posTarget && (
                    <div style={{ fontSize: 10.5, color: "oklch(0.7 0.16 145)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={detected.positive}>
                      上游正向 → 「{posTarget}」：{detected.positive.slice(0, 40)}
                    </div>
                  )}
                  {detected.negative && negTarget && (
                    <div style={{ fontSize: 10.5, color: "oklch(0.7 0.16 145)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={detected.negative}>
                      上游反向 → 「{negTarget}」：{detected.negative.slice(0, 40)}
                    </div>
                  )}
                  {/* 上游有反向词但本工作流无「反向」参数槽——不静默丢弃，明确告知不会生效
                      （常见于 Flux CFG=1 等无 negative 输入的工作流）。 */}
                  {detected.negative && !negTarget && (
                    <div style={{ fontSize: 10.5, color: "oklch(0.72 0.17 65)", marginTop: 2, lineHeight: 1.4 }} title={detected.negative}>
                      上游有反向提示词，但本工作流未识别到「反向」参数槽（可能该工作流本就不含负向输入，如 Flux CFG=1），该反向词不会生效。如工作流确有负向文本节点，请点「参数绑定」→「编辑」把它的角色设为「反向」。
                    </div>
                  )}
                  {ambiguous && (
                    <div style={{ fontSize: 10.5, color: "oklch(0.72 0.17 65)", marginTop: 2 }}>
                      本工作流有多个文本参数但未设角色，正/反向是按名称猜的，可能对错位置。请点「参数绑定」→「编辑」，给每个文本参数显式选「正向 / 反向」。
                    </div>
                  )}
                  {payload.preferUpstreamPrompt === false && (
                    <div style={{ fontSize: 10.5, color: "var(--c-t3)", marginTop: 2 }}>
                      当前为「仅填空」：仅当目标参数留空或为默认值时才填入。
                    </div>
                  )}
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

            {/* Post-run VRAM cleanup — unload models + free VRAM on the server after
                a run completes, ONLY when that server's queue is idle. Cloud is
                skipped server-side. Default 保留 (off). */}
            {payload.useCloudComfy !== true && (() => {
              const clear = payload.freeVramAfterRun === true;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>完成后</label>
                  <div style={{ display: "flex", gap: 6, flex: 1 }}>
                    {([["keep", "保留", false], ["clear", "清显存", true]] as const).map(([k, lbl, val]) => {
                      const active = clear === val;
                      return (
                        <button
                          key={k}
                          onClick={() => update({ freeVramAfterRun: val })}
                          title={val ? "运行完成且该服务器无其它队列任务时，卸载模型释放显存（下次同卡任务需重新加载）" : "运行后保留显存中的模型（下次同卡任务更快）"}
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
                  <button
                    onClick={() => { const n = applyFreeVramToAllComfyNodes(clear); toast.success(`已应用到 ${n} 个 ComfyUI 节点`); }}
                    title="把本节点的清显存设置同步到画布上所有 ComfyUI 节点（图/视频/工作流）"
                    style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 6, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", whiteSpace: "nowrap", fontFamily: "var(--font-sans)" }}
                  >应用到全部</button>
                </div>
              );
            })()}

            {/* Aspect-ratio presets — shown when the workflow exposes width + height.
                Sets both params to a common resolution for the chosen ratio. */}
            {whBindings && (() => {
              // #149：applyWH 原子写两键（原来连续两次 setParamValue 闭包旧值互相覆盖，宽度被丢）；
              // 追加「按上游图」直传参考图实际分辨率。
              const PRESETS: [string, number, number][] = [["1:1", 1024, 1024], ["16:9", 1344, 768], ["9:16", 768, 1344], ["4:3", 1152, 896], ["3:4", 896, 1152]];
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>比例</label>
                  {PRESETS.map(([lbl, w, h]) => (
                    <button
                      key={lbl}
                      onClick={() => applyWH(w, h)}
                      style={{ padding: "4px 9px", fontSize: 11, borderRadius: 6, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}
                    >{lbl}</button>
                  ))}
                  <button
                    onClick={fillWHFromUpstream}
                    title="读取上游/参考图的实际分辨率填入宽高（/16 对齐，长边等比夹到 1344）"
                    style={{ padding: "4px 9px", fontSize: 11, borderRadius: 6, cursor: "pointer", background: `${accent}14`, border: `1px solid ${accent}45`, color: accent, fontWeight: 600 }}
                  >按上游图</button>
                </div>
              );
            })()}

            {/* Dynamic param form — capped height with internal scroll to keep the node compact.
                时长类参数（帧数 length / 帧率 fps / frame_rate / duration）稳定置顶，便于直接设
                视频时长，无需在长参数列表里翻找。仅改显示顺序，不动 payload.paramBindings 的持久
                化顺序（图片/提示词/音频解析仍按原绑定，不受影响）。 */}
            {(payload.paramBindings ?? []).length > 0 && (() => {
              const isDurationParam = (b: { fieldPath?: string; label?: string }) => {
                const f = (b.fieldPath ?? "").split(".").pop()?.toLowerCase() ?? "";
                return /^(length|num_frames|num_frame|frames|frame_count|video_frames|frame_rate|fps|duration)$/.test(f)
                  || /时长|帧数|帧率|fps/i.test(b.label ?? "");
              };
              const bindings = payload.paramBindings ?? [];
              const orderedBindings = [...bindings.filter(isDurationParam), ...bindings.filter((b) => !isDurationParam(b))];
              return (
              <div className="nowheel nodrag" style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto", overflowX: "hidden" }}>
                {orderedBindings.map((b) => {
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
                      {b.type === "audio" && (
                        <>
                          {/* 音频来源映射（与图像一致）：指定上游音频/素材(音频)节点，或自动 */}
                          {upstreamAudioSources.length > 0 ? (
                            <select
                              value={payload.audioSourceMap?.[key] ?? ""}
                              onChange={(e) => {
                                const map = { ...(payload.audioSourceMap ?? {}) };
                                if (e.target.value) map[key] = e.target.value; else delete map[key];
                                update({ audioSourceMap: map });
                              }}
                              style={{ ...fieldBase, padding: "5px 8px", fontSize: 11, marginBottom: 5, cursor: "pointer" }}
                              title="来源：选某个上游音频节点，或自动（按位置/连线顺序）"
                            >
                              <option value="">来源：自动排序</option>
                              {upstreamAudioSources.map((s, i) => (
                                <option key={s.id} value={s.id}>来源：{i + 1}. {s.title}</option>
                              ))}
                            </select>
                          ) : (
                            <select
                              disabled
                              value=""
                              style={{ ...fieldBase, padding: "5px 8px", fontSize: 11, marginBottom: 5, cursor: "default", opacity: 0.6 }}
                              title="把上游「音频 / 素材(音频)」节点连到本节点后，即可在此指定该音频参数来源"
                            >
                              <option value="">来源：连接上游音频后可选 ▸</option>
                            </select>
                          )}
                          <AudioParamField
                            value={String(value ?? "")}
                            onChangeUrl={(u) => setParamValue(key, u)}
                            uploadFile={uploadLocalAudio}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              );
            })()}

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
              disabled={isProcessing || batchRunning}
              onClick={() => { if (payload.outputUrls?.length) { void confirmRegenerate("执行产物").then((ok) => { if (ok) handleRun(); }); return; } handleRun(); }}
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
            {/* #5 版本历史（仅图像输出）：历次产出快照，点击回滚 */}
            {payload.outputType !== "video" && (
              <div style={{ marginBottom: 8 }}>
                <ResultHistoryStrip history={payload.resultHistory} currentUrl={payload.outputUrls[0]} accent={accent} onRollback={rollbackToSnapshot} />
              </div>
            )}
            {/* Video output
                #148 创意模式下 hero 已常显第一条视频——本区只列 hero 之外的产出
                （单产出即不再重复渲染播放器，曾双预览）；非创意模式（无 hero）全量列出。 */}
            {payload.outputType === "video" ? (
              <div>
                {(isCreativeMode ? payload.outputUrls.slice(1) : payload.outputUrls).map((url, i) => (
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
            ) : isCreativeMode ? null : (
              /* Image grid — #148 创意模式下 hero 已是全量可点选网格（含设为使用图），
                 body 不再重复渲染；非创意模式（无 hero）保持原样。 */
              <div style={{ display: "grid", gridTemplateColumns: payload.outputUrls.length > 1 ? "1fr 1fr" : "1fr", gap: 6 }}>
                {payload.outputUrls.map((url, i) => {
                  // 单张：按原图比例自适应高度（不留黑边）；多张网格：方块铺满裁切(cover，不留黑边)。
                  const single = payload.outputUrls!.length === 1;
                  return (
                  <div key={i} className="nodrag" style={single
                    ? { position: "relative", borderRadius: 8, overflow: "hidden", background: "var(--c-input)", cursor: "zoom-in" }
                    : { position: "relative", paddingTop: "100%", borderRadius: 8, overflow: "hidden", background: "var(--c-input)", cursor: "zoom-in" }} onClick={() => setLightboxIdx(i)} title="点击放大">
                    <MediaImage
                      src={url}
                      alt={`Output ${i + 1}`}
                      style={single
                        ? { width: "100%", height: "auto", display: "block" }
                        : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    {/* MinIO storage indicator (ComfyUI outputs are hard-locked to MinIO) */}
                    {isOwnStorageUrl(url) && (
                      <div
                        title="已存储到 MinIO·长期有效"
                        style={{ position: "absolute", top: 5, left: 5, width: 10, height: 10, borderRadius: "50%", background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)", pointerEvents: "none" }}
                      />
                    )}
                    <div style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.5)", borderRadius: 4, padding: "2px 5px" }}>
                      <a href={safeHref(url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#fff", fontSize: 10, textDecoration: "none" }}>
                        <ImageIcon size={10} style={{ display: "inline", marginRight: 2 }} />
                        {i + 1}
                      </a>
                    </div>
                    {/* #142 多图选用：i===0 即当前使用图（下游一律消费 outputUrls[0]） */}
                    {payload.outputUrls!.length > 1 && (i === 0 ? (
                      <div title="当前使用图（下游节点使用这张）" className="absolute top-1 right-1 rounded-full flex items-center justify-center" style={{ width: 16, height: 16, background: accent }}>
                        <Check style={{ width: 10, height: 10, color: "var(--c-canvas)" }} />
                      </div>
                    ) : (
                      <button
                        className="nodrag absolute top-1 right-1 rounded-md"
                        onClick={(e) => { e.stopPropagation(); selectOutput(url); }}
                        title="设为使用图（下游节点将使用这张）"
                        style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.35)", color: "#fff", cursor: "pointer" }}
                      >
                        选用
                      </button>
                    ))}
                  </div>
                  );
                })}
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

    {/* #77 LibTV：创意模式就地输入条——正向提示词（写入绑定参数）+ 高级 + 运行 */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={!!selected} width={470}>
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span title="本地自建 ComfyUI 工作流（免云端积分）" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 8, fontSize: 10.5, fontWeight: 700, background: "oklch(0.72 0.18 145 / 0.14)", border: "1px solid oklch(0.72 0.18 145 / 0.4)", color: "oklch(0.72 0.18 145)", whiteSpace: "nowrap", flexShrink: 0 }}>⚡ 工作流</span>
          {(() => {
            const posKey = positivePromptParamKey(payload.paramBindings ?? []);
            if (!posKey) return <span style={{ flex: 1, fontSize: 11, color: "var(--c-t4)" }}>{payload.workflowJson?.trim() ? "该工作流未绑定提示词参数（点「高级」进参数面板）" : "尚未导入工作流——点「导入」选择模板或上传 JSON"}</span>;
            return (
              <NodeTextArea
                className="nodrag nowheel"
                placeholder="正向提示词（写入工作流绑定参数）…"
                value={typeof payload.paramValues?.[posKey] === "string" ? (payload.paramValues[posKey] as string) : ""}
                onValueChange={(v) => update({ paramValues: { ...(payload.paramValues ?? {}), [posKey]: v } })}
                rows={1}
                style={{ flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 12, lineHeight: 1.5, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 9, color: "var(--c-t1)", outline: "none", resize: "none" }}
              />
            );
          })()}
        </div>
        {/* #107 常用绑定参数直接上浮（主参数/负向词/种子/步数/CFG/尺寸等），完整参数仍在「高级」 */}
        {(() => {
          const bindings = payload.paramBindings ?? [];
          if (bindings.length === 0) return null;
          const posKey = positivePromptParamKey(bindings);
          const keyOf = (b: WorkflowParamBinding) => `${b.nodeId}.${b.fieldPath}`;
          const common = bindings.filter((b) => {
            if (keyOf(b) === posKey || b.type === "image" || b.type === "audio") return false;
            if (b.priority === 1 || b.role === "negative") return true;
            return /负向|negative|seed|种子|steps|步数|cfg|denoise|width|height|宽|高|时长|帧数|frames|fps/i.test(`${b.label} ${b.fieldPath}`);
          }).slice(0, 8);
          if (common.length === 0) return null;
          const setVal = (k: string, v: unknown) => update({ paramValues: { ...(payload.paramValues ?? {}), [k]: v } });
          return (
            <div className="nodrag" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {common.map((b) => {
                const k = keyOf(b);
                const cur = payload.paramValues?.[k] ?? b.defaultValue;
                const lab = b.label || b.fieldPath;
                if (b.type === "boolean") {
                  return (
                    <button key={k} className="nodrag" onClick={(e) => { e.stopPropagation(); setVal(k, !cur); }} title={lab}
                      style={{ height: 26, padding: "0 9px", borderRadius: 8, fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                        background: cur ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 16%, var(--c-surface))" : "var(--c-input)",
                        border: `1px solid ${cur ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, color: cur ? "var(--c-t1)" : "var(--c-t3)" }}>
                      {lab}{cur ? " ✓" : ""}
                    </button>
                  );
                }
                if (b.type === "select" && (b.options?.length ?? 0) > 0) {
                  return (
                    <label key={k} title={lab} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--c-t4)", whiteSpace: "nowrap" }}>
                      {lab}
                      <select className="nodrag" value={String(cur ?? "")} onChange={(e) => setVal(k, e.target.value)}
                        style={{ height: 26, maxWidth: 150, fontSize: 10.5, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 7, color: "var(--c-t1)", padding: "0 4px" }}>
                        {(b.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                  );
                }
                if (b.type === "number") {
                  return (
                    <label key={k} title={lab} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--c-t4)", whiteSpace: "nowrap" }}>
                      {lab}
                      <input type="number" className="nodrag" value={cur === undefined || cur === null || cur === "" ? "" : Number(cur)}
                        min={b.min} max={b.max} step={b.step}
                        onChange={(e) => setVal(k, e.target.value === "" ? undefined : Number(e.target.value))}
                        style={{ width: 68, height: 26, fontSize: 10.5, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 7, color: "var(--c-t1)", padding: "0 6px", outline: "none" }} />
                    </label>
                  );
                }
                return (
                  <input key={k} className="nodrag" placeholder={lab} title={lab}
                    value={typeof cur === "string" ? cur : cur == null ? "" : String(cur)}
                    onChange={(e) => setVal(k, e.target.value)}
                    style={{ flex: "1 1 100%", minWidth: 180, height: 26, fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 8, color: "var(--c-t2)", padding: "0 9px", outline: "none" }} />
                );
              })}
              {/* #149 宽/高快捷填入：比例常用档一键写两值，或读取上游参考图实际分辨率直传 */}
              {whBindings && (
                <select
                  className="nodrag"
                  value=""
                  title="宽/高快捷填入：选比例档一键写入两值，或「按上游图」读取参考图实际分辨率（/16 对齐、长边夹到 1344）"
                  onChange={(e) => {
                    const v = e.target.value;
                    e.currentTarget.value = "";
                    if (!v) return;
                    if (v === "up") { fillWHFromUpstream(); return; }
                    const [w, h] = v.split("x").map(Number);
                    if (w && h) applyWH(w, h);
                  }}
                  style={{ height: 26, fontSize: 10.5, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 7, color: "var(--c-t2)", padding: "0 4px" }}
                >
                  <option value="">尺寸快填…</option>
                  <option value="up">按上游图尺寸</option>
                  <option value="1344x768">16:9 · 1344×768</option>
                  <option value="768x1344">9:16 · 768×1344</option>
                  <option value="1024x1024">1:1 · 1024×1024</option>
                  <option value="1152x896">4:3 · 1152×896</option>
                  <option value="896x1152">3:4 · 896×1152</option>
                  <option value="832x480">16:9 小 · 832×480</option>
                  <option value="480x832">9:16 小 · 480×832</option>
                </select>
              )}
              {/* #161 帧率/帧数快填：选帧率写 fps；选时长按 帧数=round(fps×时长) 写帧数；或按上游时长自动算 */}
              {(fpsBinding || framesBinding) && (
                <select
                  className="nodrag"
                  value=""
                  title="帧率/帧数快填：选帧率写入 FPS；选时长按 帧数=round(fps×时长) 写入帧数；「按上游时长」读上游分镜/脚本/视频的时长自动算"
                  onChange={(e) => {
                    const v = e.target.value; e.currentTarget.value = "";
                    if (!v) return;
                    if (v === "up") { fillFramesFromUpstream(); return; }
                    if (v.startsWith("fps:")) { setFps(Number(v.slice(4))); return; }
                    if (v.startsWith("dur:")) { const d = Number(v.slice(4)); if (applyFramesFromDuration(d)) toast.success(`已按 ${d}s × ${effectiveFps()}fps 填入帧数 ${Math.round(effectiveFps() * d)}`); }
                  }}
                  style={{ height: 26, fontSize: 10.5, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 7, color: "var(--c-t2)", padding: "0 4px" }}
                >
                  <option value="">帧率/时长快填…</option>
                  {framesBinding && <option value="up">按上游时长算帧数</option>}
                  {fpsBinding && <option value="fps:24">帧率 24</option>}
                  {fpsBinding && <option value="fps:25">帧率 25</option>}
                  {fpsBinding && <option value="fps:30">帧率 30</option>}
                  {fpsBinding && <option value="fps:60">帧率 60</option>}
                  {framesBinding && <option value="dur:3">时长 3s → 帧数</option>}
                  {framesBinding && <option value="dur:5">时长 5s → 帧数</option>}
                  {framesBinding && <option value="dur:8">时长 8s → 帧数</option>}
                  {framesBinding && <option value="dur:10">时长 10s → 帧数</option>}
                </select>
              )}
              {/* #161 帧数跟随上游时长：勾选后每次运行自动按上游时长×fps 覆盖帧数 */}
              {framesBinding && (
                <label className="nodrag" title="勾选后：每次运行自动按「上游时长 × 帧率」覆盖帧数（上游无时长则保持当前值）"
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: payload.framesFollowUpstream ? accent : "var(--c-t4)", cursor: "pointer", whiteSpace: "nowrap" }}>
                  <input type="checkbox" className="nodrag" checked={payload.framesFollowUpstream ?? false}
                    onChange={(e) => update({ framesFollowUpstream: e.target.checked })}
                    style={{ accentColor: accent }} />
                  帧数跟随上游时长
                </label>
              )}
            </div>
          );
        })()}
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
          {!payload.workflowJson?.trim() && (
            <button className="nodrag" onClick={(e) => { e.stopPropagation(); setShowWizard(true); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
              <Upload size={12} /> 导入工作流 / 模板
            </button>
          )}
          {!!payload.workflowJson?.trim() && (
            <button className="nodrag" onClick={(e) => { e.stopPropagation(); handleExportWorkflow(); }}
              title="导出当前工作流为 API 格式 .json（含已设参数，可在 ComfyUI 里 Load）"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}>
              <Download size={12} /> 导出
            </button>
          )}
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起参数面板" : "展开全部工作流参数") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <SlidersHorizontal size={12} /> 高级
          </button>
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); void handleRun(); }}
            disabled={isProcessing || batchRunning || !(phase === "run" && !!payload.workflowJson?.trim())}
            title={payload.workflowJson?.trim() ? "运行工作流（自建算力）" : "先导入工作流"}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 16px", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "var(--ui-accent, var(--c-accent))", border: "none", color: "#0b0d12", cursor: isProcessing ? "wait" : "pointer", opacity: isProcessing || batchRunning || !(phase === "run" && !!payload.workflowJson?.trim()) ? 0.55 : 1, whiteSpace: "nowrap" }}
          >
            {isProcessing ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={13} />} {isProcessing ? "执行中…" : "运行"}
          </button>
        </div>
      </InlineGenBar>
    )}

    {/* ⚠ 两个 3D 查看器必须放在 BaseNode 外面：children 在选中(studioFloated)/lodFar 时会
        整体换容器或不渲染，放里面会随选中状态卸载（真3D 界面消失回画布、点空白又出现）。 */}
    {/* 3D 换视角（与图像节点相同）：伪3D 深度位移 / 真3D 图生网格 → 截图回灌首个图像参数 → 重跑 */}
    {view3dSrc && (
      <Depth3DViewer
        sourceImageUrl={view3dSrc}
        comfyBaseUrl={payload.customBaseUrl}
        onClose={() => setView3dSrc(null)}
        onGenerate={on3dGenerate}
      />
    )}
    {model3dSrc && (
      <Model3DViewer
        sourceImageUrl={model3dSrc}
        comfyBaseUrl={payload.customBaseUrl}
        initialGlbUrl={payload.model3d?.sourceUrl === model3dSrc ? payload.model3d.glbUrl : undefined}
        savedToLibrary={payload.model3d?.sourceUrl === model3dSrc ? payload.model3d.saved : undefined}
        projectId={data.projectId}
        nodeId={id}
        onGlbReady={(glbUrl) => update({ model3d: { sourceUrl: model3dSrc, glbUrl } })}
        onSavedToLibrary={() => payload.model3d && update({ model3d: { ...payload.model3d, saved: true } })}
        onClose={() => setModel3dSrc(null)}
        onGenerate={on3dGenerate}
      />
    )}
    </>
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

// 音频参数输入：URL/文件名 + 上传本地音频 + 试听 + 清除。运行时服务端把 URL 上传到 ComfyUI。
function AudioParamField({
  value, onChangeUrl, uploadFile,
}: {
  value: string;
  onChangeUrl: (url: string) => void;
  uploadFile: (file: File) => Promise<string | null>;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const doUploadFile = async (file: File) => {
    setUploading(true);
    const url = await uploadFile(file).finally(() => setUploading(false));
    if (url) onChangeUrl(url);
  };
  const isUrl = /^https?:\/\//.test(value) || value.startsWith("/");
  return (
    <div className="nodrag" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <NodeInput
          style={{ ...fieldBase, flex: 1 }}
          placeholder="音频 URL / 文件名 / 上传文件"
          value={value}
          noMention
          onValueChange={(v) => onChangeUrl(v)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="上传本地音频"
          style={{ padding: "6px 8px", borderRadius: 6, cursor: uploading ? "not-allowed" : "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontSize: 11, lineHeight: 0 }}
        >
          {uploading ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={12} />}
        </button>
        {value && (
          <button onClick={() => onChangeUrl("")} title="清除" style={{ padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", fontSize: 11, lineHeight: 0 }}>
            <X size={12} />
          </button>
        )}
      </div>
      {isUrl && value && (
        <audio src={value} controls controlsList="nodownload" preload="none" style={{ width: "100%", height: 30 }} />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void doUploadFile(f); }}
      />
    </div>
  );
}
