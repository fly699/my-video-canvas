import { memo, useCallback, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { ComfyServerUrlField } from "./ComfyServerUrlField";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import type { ComfyuiWorkflowNodeData, WorkflowParamBinding } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { detectUpstreamImageUrl, resolveWorkflowImageParams } from "@/lib/comfyWorkflowParams";
import { toast } from "sonner";
import {
  Workflow, Loader2, Upload, X, ChevronDown, ChevronRight,
  Server, Play, RotateCcw, ImageIcon, FileVideo, Plus, Trash2,
} from "lucide-react";

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

const accent = "oklch(0.65 0.20 140)";
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
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  // Reactively detect an upstream image feeding this node (via any incoming edge).
  const upstreamImageUrl = useCanvasStore((s) => detectUpstreamImageUrl(id, s.edges, s.nodes));
  const payload = data.payload;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localJson, setLocalJson] = useState(payload.workflowJson ?? "");
  const [phase, setPhase] = useState<Phase>(
    payload.paramBindings && payload.paramBindings.length > 0
      ? (payload.workflowJson ? "run" : "empty")
      : (payload.workflowJson ? "binding" : "empty")
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editingBindings, setEditingBindings] = useState(false);
  const [localBindings, setLocalBindings] = useState<WorkflowParamBinding[]>(payload.paramBindings ?? []);

  const update = useCallback((patch: Partial<ComfyuiWorkflowNodeData>, silent = false) => {
    updateNodeData(id, patch, silent);
  }, [id, updateNodeData]);

  const analyzeMutation = trpc.comfyui.analyzeWorkflow.useMutation();
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
        outputType: result.outputType === "mixed" ? "auto" : result.outputType,
        paramValues: {},
      });
      setPhase("binding");
      toast.success(`检测到 ${bindings.length} 个参数`);
    } catch (err) {
      toast.error("分析失败：" + (err instanceof Error ? err.message : String(err)));
    }
  }, [analyzeMutation, payload.customBaseUrl, update]);

  const handleRun = useCallback(async () => {
    const workflowJson = payload.workflowJson ?? "";
    if (!workflowJson.trim()) { toast.error("请先加载 Workflow JSON"); return; }
    update({ status: "processing", errorMessage: undefined, progress: 0 }, true);
    try {
      // Pull an image from a connected upstream node into any blank image param.
      const { nodes, edges } = useCanvasStore.getState();
      const upstreamImg = detectUpstreamImageUrl(id, edges, nodes);
      const { paramValues, imageParamKeys } = resolveWorkflowImageParams(
        payload.paramBindings,
        payload.paramValues ?? {},
        upstreamImg,
      );
      const result = await executeMutation.mutateAsync({
        nodeId: id,
        projectId: data.projectId,
        customBaseUrl: payload.customBaseUrl?.trim() || undefined,
        workflowJson,
        paramValues,
        imageParamKeys: imageParamKeys.length > 0 ? imageParamKeys : undefined,
        outputNodeIds: payload.outputNodeIds,
        outputType: payload.outputType ?? "auto",
      });
      update({
        outputUrl: result.urls[0] ?? "",
        outputUrls: result.urls,
        status: "done",
        errorMessage: undefined,
        progress: 100,
      });
      // Auto-fill downstream reference-image targets (image outputs only).
      if (result.urls[0] && payload.outputType !== "video") propagateRefImage(id, result.urls[0]);
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
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setLocalJson(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

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

  const isProcessing = payload.status === "processing" || executeMutation.isPending;
  const progress = payload.progress;

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
      onRun={handleRun}
      running={isProcessing}
      canRun={phase === "run" && !!payload.workflowJson?.trim()}
      hasResult={!!payload.outputUrls && payload.outputUrls.length > 0}
    >
      {/* ref-image-in (top:30%): feed an upstream image into the first blank image param.
          Generic "in" (top:55%) keeps ordering-only / video-input edges. */}
      <Handle type="target" position={Position.Left} id="ref-image-in" style={{ top: "30%", background: "oklch(0.7 0.18 145)", border: "2px solid var(--c-bg)" }} />
      <Handle type="target" position={Position.Left} id="in" style={{ top: "55%", background: accent, border: "2px solid var(--c-bg)" }} />
      <Handle type="source" position={Position.Right} id="out" style={{ top: "50%", background: accent, border: "2px solid var(--c-bg)" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 0" }}>

        {/* Server URL */}
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
            accent={accent}
            borderAccent={BORDER_ACCENT}
            borderDefault={BORDER_DEFAULT}
            fieldBase={fieldBase}
          />
        </div>

        {/* ── Phase A: Empty ── */}
        {phase === "empty" && (
          <div>
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
            <textarea className="nowheel nowheel"
              style={{ ...fieldBase, minHeight: 120, resize: "vertical", fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}
              placeholder={'{\n  "3": { "class_type": "KSampler", ... },\n  ...\n}'}
              value={localJson}
              onChange={(e) => setLocalJson(e.target.value)}
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
                        <input
                          style={{ ...fieldBase, padding: "4px 7px", fontSize: 11.5 }}
                          value={b.label}
                          onChange={(e) => {
                            const updated = [...localBindings];
                            updated[i] = { ...b, label: e.target.value };
                            setLocalBindings(updated);
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--c-t1)" }}>{b.label}</span>
                      )}
                      <span style={{ fontSize: 10, color: "var(--c-t4)", marginLeft: 6 }}>
                        节点 {b.nodeId} · {b.type}
                      </span>
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
                        <textarea 
                          style={{ ...fieldBase, minHeight: 56, resize: "vertical" }}
                          value={String(value)}
                          onChange={(e) => setParamValue(key, e.target.value)}
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
                            <input
                              list={hasOptions ? listId : undefined}
                              style={fieldBase}
                              value={String(value)}
                              placeholder={hasOptions ? `输入以搜索（${b.options!.length} 个可选）` : undefined}
                              onChange={(e) => setParamValue(key, e.target.value)}
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
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            style={{ ...fieldBase, flex: 1 }}
                            placeholder="图片 URL 或 ComfyUI 文件名"
                            value={String(value)}
                            onChange={(e) => setParamValue(key, e.target.value)}
                          />
                          {String(value) && (
                            <button
                              style={{ padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: accent, border: "none", color: "#fff", fontSize: 11 }}
                              onClick={() => handleImageParamUpload(b, String(value))}
                              title="上传到 ComfyUI"
                            >
                              <Upload size={12} />
                            </button>
                          )}
                        </div>
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
                <div style={{ display: "flex", gap: 8 }}>
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
                </div>
              )}
            </div>

            {/* Progress bar */}
            {isProcessing && progress != null && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 4, borderRadius: 2, background: "var(--c-bd2)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: accent, transition: "width 300ms ease", borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 3, display: "block" }}>{progress}%</span>
              </div>
            )}

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

        {/* ── Results ── */}
        {payload.status === "done" && payload.outputUrls && payload.outputUrls.length > 0 && (
          <div>
            <label style={{ ...labelStyle, marginBottom: 6 }}>
              输出结果（{payload.outputUrls.length} 个）
            </label>
            {/* Video output */}
            {payload.outputType === "video" ? (
              <div>
                {payload.outputUrls.map((url, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <video
                      src={url}
                      controls
                      style={{ width: "100%", borderRadius: 8, maxHeight: 240, background: "#000" }}
                      onError={(e) => { (e.currentTarget as HTMLVideoElement).src = ""; }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              /* Image grid */
              <div style={{ display: "grid", gridTemplateColumns: payload.outputUrls.length > 1 ? "1fr 1fr" : "1fr", gap: 6 }}>
                {payload.outputUrls.map((url, i) => (
                  <div key={i} style={{ position: "relative", paddingTop: "100%", borderRadius: 8, overflow: "hidden", background: "var(--c-input)" }}>
                    <img
                      src={url}
                      alt={`Output ${i + 1}`}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                    />
                    <div style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.5)", borderRadius: 4, padding: "2px 5px" }}>
                      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", fontSize: 10, textDecoration: "none" }}>
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
    </BaseNode>
  );
});
