import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ComfyuiImageNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Sparkles, Loader2, RefreshCw, Upload, X, Cpu, Download, ZoomIn,
  ChevronDown, ChevronRight, Server, Boxes, ImageIcon,
} from "lucide-react";
import { ImageLightbox } from "../ImageLightbox";
import { makeImageProxyFallback } from "@/lib/utils";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "comfyui_image";
    title: string;
    payload: ComfyuiImageNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.68 0.20 100)";
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = `oklch(0.68 0.20 100 / 0.5)`;

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
  transition: "border-color 150ms ease, background 150ms ease",
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

export const ComfyuiImageNode = memo(function ComfyuiImageNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  const [uploading, setUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [urlExpanded, setUrlExpanded] = useState(false);
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pull ckpt/lora suggestions from ComfyUI via /object_info (best-effort, no-throw).
  // Debounce the URL so each keystroke in the COMFYUI_BASE_URL field doesn't
  // fire a fresh assertWhitelisted DB query + outbound HTTP probe.
  const [debouncedUrl, setDebouncedUrl] = useState(payload.customBaseUrl?.trim() || undefined);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(payload.customBaseUrl?.trim() || undefined), 600);
    return () => clearTimeout(t);
  }, [payload.customBaseUrl]);
  const modelsQuery = trpc.comfyui.fetchModels.useQuery(
    { customBaseUrl: debouncedUrl },
    { staleTime: 60_000, retry: false }
  );

  const genMutation = trpc.comfyui.generateImage.useMutation({
    onSuccess: (result) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { imageUrl: result.url, imageUrls: result.urls, status: "done", errorMessage: undefined, progress: undefined });
      toast.success("ComfyUI 图像生成成功");
    },
    onError: (err) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { status: "failed", errorMessage: err.message, progress: undefined });
      toast.error("ComfyUI 图像生成失败：" + err.message);
    },
  });

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      setUploading(false);
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { referenceImageUrl: result.url });
      toast.success("参考图上传成功");
    },
    onError: (err) => {
      setUploading(false);
      toast.error("参考图上传失败：" + err.message);
    },
  });

  const update = useCallback(
    (field: keyof ComfyuiImageNodeData, value: unknown) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );

  const handleGenerate = () => {
    if (genMutation.isPending) return;
    if (uploading) { toast.error("参考图正在上传中，请稍候"); return; }
    if (!payload.prompt?.trim()) { toast.error("请先填写提示词"); return; }
    if (!payload.ckpt?.trim()) { toast.error("请先填写 Checkpoint 名称"); return; }
    if (payload.workflowTemplate === "img2img" && !payload.referenceImageUrl) {
      toast.error("img2img 模板需要参考图"); return;
    }
    updateNodeData(id, { status: "processing", errorMessage: undefined, progress: 0 });
    genMutation.mutate({
      nodeId: id,
      projectId: data.projectId,
      customBaseUrl: payload.customBaseUrl?.trim() || undefined,
      workflowTemplate: payload.workflowTemplate ?? "txt2img",
      prompt: payload.prompt,
      negPrompt: payload.negPrompt,
      ckpt: payload.ckpt,
      lora: payload.lora,
      steps: payload.steps ?? 20,
      cfg: payload.cfg ?? 7,
      seed: typeof payload.seed === "number" ? payload.seed : -1,
      width: payload.width ?? 512,
      height: payload.height ?? 512,
      sampler: payload.sampler || undefined,
      scheduler: payload.scheduler || undefined,
      denoise: typeof payload.denoise === "number" ? payload.denoise : undefined,
      vae: payload.vae || undefined,
      loraStrength: typeof payload.loraStrength === "number" ? payload.loraStrength : undefined,
      batchSize: payload.batchSize ?? 1,
      referenceImageUrl: payload.referenceImageUrl,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); e.target.value = ""; return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16 MB"); e.target.value = ""; return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.onerror = () => { setUploading(false); toast.error("文件读取失败"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDownload = (url: string) => {
    if (!url) return;
    const a = document.createElement("a");
    const isSameOrigin = (url.startsWith("/") && !url.startsWith("//")) || url.startsWith(window.location.origin);
    a.href = isSameOrigin ? url : `/api/image-proxy?url=${encodeURIComponent(url)}&download=1`;
    a.download = `comfyui-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isImg2Img = payload.workflowTemplate === "img2img";

  const heroMedia = payload.imageUrl ? (
    <div className="relative overflow-hidden group" style={{ width: "100%" }}>
      <img
        src={payload.imageUrl}
        alt="comfyui-generated"
        className="w-full h-full object-cover"
        draggable={false}
        style={{ objectFit: "cover", display: "block" }}
        onError={makeImageProxyFallback(payload.imageUrl)}
      />
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        style={{ background: "oklch(0 0 0 / 0.45)" }}
      >
        <button
          onClick={handleGenerate}
          disabled={genMutation.isPending}
          className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
        >
          {genMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          重新生成
        </button>
      </div>
    </div>
  ) : null;

  return (
    <BaseNode id={id} selected={selected} nodeType="comfyui_image" title={data.title} minHeight={320} heroMedia={heroMedia}>
      <div className="flex flex-col h-full p-3.5 gap-3 overflow-auto">

        {/* ── Result image(s) ── */}
        {payload.imageUrl ? (
          (payload.imageUrls && payload.imageUrls.length > 1) ? (
            // Multi-image grid
            <div className="flex-shrink-0 grid gap-1.5" style={{ gridTemplateColumns: payload.imageUrls.length >= 2 ? "1fr 1fr" : "1fr" }}>
              {payload.imageUrls.map((url, i) => (
                <div
                  key={url + i}
                  className="relative rounded-lg overflow-hidden"
                  style={{ aspectRatio: "1/1", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}
                >
                  <img
                    src={url}
                    alt={`generated-${i}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                    onError={makeImageProxyFallback(url)}
                  />
                  <div
                    className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-1"
                    style={{ background: "oklch(0 0 0 / 0.55)" }}
                  >
                    <button
                      onClick={() => { setLightboxUrl(url); setLightboxOpen(true); }}
                      className="nodrag flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
                    >
                      <ZoomIn className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDownload(url)}
                      className="nodrag flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => {
                        // Set the reference image AND switch the template to img2img;
                        // the server only honours referenceImageUrl when workflowTemplate
                        // === "img2img", so updating one without the other is a no-op.
                        updateNodeData(id, { referenceImageUrl: url, workflowTemplate: "img2img" });
                        toast.success("已设为参考图并切换至 img2img 模式");
                      }}
                      className="nodrag flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
                      title="设为参考图并切换 img2img 模式"
                    >
                      <ImageIcon className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
          // Single image
          <div
            className="relative rounded-lg overflow-hidden flex-shrink-0"
            style={{ aspectRatio: "16/9", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}
          >
            <img
              src={payload.imageUrl}
              alt="generated"
              className="w-full h-full object-contain"
              draggable={false}
              onError={makeImageProxyFallback(payload.imageUrl ?? "")}
            />
            <div
              className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
              style={{ background: "oklch(0 0 0 / 0.55)" }}
            >
              <button
                onClick={() => setLightboxOpen(true)}
                className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
              >
                <ZoomIn className="w-3 h-3" />
                放大
              </button>
              <button
                onClick={() => handleDownload(payload.imageUrl ?? "")}
                className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
              >
                <Download className="w-3 h-3" />
                下载
              </button>
            </div>
          </div>
          )
        ) : (
          <div
            className="rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ aspectRatio: "16/9", borderWidth: 1, borderStyle: "dashed", borderColor: `oklch(0.68 0.20 100 / 0.25)`, background: `oklch(0.68 0.20 100 / 0.04)` }}
          >
            <div className="flex flex-col items-center gap-1.5" style={{ color: "oklch(0.68 0.20 100 / 0.6)" }}>
              <Boxes style={{ width: 24, height: 24 }} />
              <span style={{ fontSize: 11 }}>ComfyUI 生成图像将显示在这里</span>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {payload.status === "failed" && payload.errorMessage && (
          <div
            className="flex items-start gap-2 p-2 rounded-lg flex-shrink-0"
            style={{ background: "oklch(0.62 0.20 25 / 0.08)", borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.62 0.20 25 / 0.30)" }}
          >
            <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "oklch(0.62 0.20 25)" }} />
            <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.62 0.20 25)", wordBreak: "break-word", overflowWrap: "anywhere", minWidth: 0, flex: 1 }}>
              {payload.errorMessage}
            </p>
          </div>
        )}

        {/* ── Input area (collapsed when not selected) ── */}
        <div
          style={{
            overflow: "hidden",
            maxHeight: selected ? "9999px" : "0px",
            transition: selected
              ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
              : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
          }}
        >

        {/* ── ComfyUI URL (collapsible) ── */}
        <div
          className="rounded-xl"
          style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd1)", marginBottom: 12 }}
        >
          <button
            onClick={() => setUrlExpanded((v) => !v)}
            className="nodrag w-full flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ cursor: "pointer", background: "transparent" }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4 }}>
              <Server style={{ width: 10, height: 10 }} />
              ComfyUI 服务器
            </span>
            {urlExpanded
              ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
              : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
            }
          </button>
          {urlExpanded && (
            <div className="px-3 pb-3">
              <input
                placeholder="http://127.0.0.1:8188（留空使用全局默认）"
                value={payload.customBaseUrl ?? ""}
                onChange={(e) => update("customBaseUrl", e.target.value)}
                className="nodrag"
                style={fieldBase}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
              <p style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 4 }}>
                每个节点独立配置，仅 http(s) 协议。
              </p>
            </div>
          )}
        </div>

        {/* ── Workflow template ── */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
            <Cpu style={{ width: 10, height: 10 }} />
            Workflow 模板
          </label>
          <select
            value={payload.workflowTemplate ?? "txt2img"}
            onChange={(e) => update("workflowTemplate", e.target.value as "txt2img" | "img2img")}
            className="nodrag"
            style={{ ...fieldBase, cursor: "pointer" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          >
            <option value="txt2img">txt2img — 文生图</option>
            <option value="img2img">img2img — 图生图</option>
          </select>
        </div>

        {/* ── Prompt ── */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <textarea className="nodrag nowheel"
            placeholder="描述你想生成的图像..."
            value={payload.prompt ?? ""}
            onChange={(e) => update("prompt", e.target.value)}
            rows={3}
            
            style={{ ...fieldBase, resize: "none", lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* ── Negative prompt ── */}
        <div>
          <label style={labelStyle}>反向提示词</label>
          <textarea className="nodrag nowheel"
            placeholder="blurry, low quality..."
            value={payload.negPrompt ?? ""}
            onChange={(e) => update("negPrompt", e.target.value)}
            rows={2}
            
            style={{ ...fieldBase, resize: "none", lineHeight: 1.6, fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-t4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* ── Checkpoint with datalist suggestions ── */}
        <div>
          <label style={labelStyle}>Checkpoint *</label>
          <input
            list={`comfyui-ckpts-${id}`}
            placeholder="如 sd_xl_base_1.0.safetensors"
            value={payload.ckpt ?? ""}
            onChange={(e) => update("ckpt", e.target.value)}
            className="nodrag"
            style={fieldBase}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
          <datalist id={`comfyui-ckpts-${id}`}>
            {(modelsQuery.data?.ckpts ?? []).map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        {/* ── LoRA ── */}
        <div>
          <label style={labelStyle}>LoRA（可选）</label>
          <input
            list={`comfyui-loras-${id}`}
            placeholder="留空表示不使用 LoRA"
            value={payload.lora ?? ""}
            onChange={(e) => update("lora", e.target.value)}
            className="nodrag"
            style={fieldBase}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-t4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
          <datalist id={`comfyui-loras-${id}`}>
            {(modelsQuery.data?.loras ?? []).map((l) => <option key={l} value={l} />)}
          </datalist>
        </div>

        {/* ── Advanced params (collapsible) ── */}
        <div
          className="rounded-xl"
          style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd1)" }}
        >
          <button
            onClick={() => setParamsExpanded((v) => !v)}
            className="nodrag w-full flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ cursor: "pointer", background: "transparent" }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
              采样参数
            </span>
            {paramsExpanded
              ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
              : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
            }
          </button>
          {paramsExpanded && (
            <div className="px-3 pb-3 grid grid-cols-2 gap-x-2 gap-y-2">
              <div>
                <label style={labelStyle}>Steps</label>
                <input
                  type="number" min={1} max={150}
                  value={payload.steps ?? 20}
                  onChange={(e) => update("steps", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              <div>
                <label style={labelStyle}>CFG</label>
                <input
                  type="number" min={1} max={30} step={0.5}
                  value={payload.cfg ?? 7}
                  onChange={(e) => update("cfg", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              <div>
                <label style={labelStyle}>宽度</label>
                <input
                  type="number" min={64} max={2048} step={8}
                  value={payload.width ?? 512}
                  onChange={(e) => update("width", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              <div>
                <label style={labelStyle}>高度</label>
                <input
                  type="number" min={64} max={2048} step={8}
                  value={payload.height ?? 512}
                  onChange={(e) => update("height", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              {/* Sampler */}
              <div>
                <label style={labelStyle}>采样器</label>
                <input
                  list={`comfyui-samplers-${id}`}
                  placeholder="euler"
                  value={payload.sampler ?? ""}
                  onChange={(e) => update("sampler", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-samplers-${id}`}>
                  {(modelsQuery.data?.samplers ?? []).map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              {/* Scheduler */}
              <div>
                <label style={labelStyle}>调度器</label>
                <input
                  list={`comfyui-schedulers-${id}`}
                  placeholder="normal"
                  value={payload.scheduler ?? ""}
                  onChange={(e) => update("scheduler", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-schedulers-${id}`}>
                  {(modelsQuery.data?.schedulers ?? ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"]).map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              {/* Denoise */}
              <div className="col-span-2">
                <label style={labelStyle}>
                  Denoise &nbsp;
                  <span style={{ fontWeight: 400, color: "var(--c-t3)" }}>{(payload.denoise ?? 1.0).toFixed(2)}</span>
                </label>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={payload.denoise ?? 1.0}
                  onChange={(e) => update("denoise", Number(e.target.value))}
                  className="nodrag" style={{ width: "100%", accentColor: accent }}
                />
              </div>
              {/* VAE */}
              <div className="col-span-2">
                <label style={labelStyle}>VAE（留空用 Checkpoint 内置）</label>
                <input
                  list={`comfyui-vaes-${id}`}
                  placeholder="ae.safetensors"
                  value={payload.vae ?? ""}
                  onChange={(e) => update("vae", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-vaes-${id}`}>
                  {(modelsQuery.data?.vaes ?? []).map((v) => <option key={v} value={v} />)}
                </datalist>
              </div>
              {/* LoRA strength (only when lora is set) */}
              {payload.lora && (
                <div className="col-span-2">
                  <label style={labelStyle}>
                    LoRA 强度 &nbsp;
                    <span style={{ fontWeight: 400, color: "var(--c-t3)" }}>{(payload.loraStrength ?? 1.0).toFixed(2)}</span>
                  </label>
                  <input
                    type="range" min={0} max={2} step={0.05}
                    value={payload.loraStrength ?? 1.0}
                    onChange={(e) => update("loraStrength", Number(e.target.value))}
                    className="nodrag" style={{ width: "100%", accentColor: accent }}
                  />
                </div>
              )}
              {/* Batch size */}
              <div>
                <label style={labelStyle}>批量数量</label>
                <input
                  type="number" min={1} max={8}
                  value={payload.batchSize ?? 1}
                  onChange={(e) => update("batchSize", e.target.value ? Math.min(8, Math.max(1, Number(e.target.value))) : 1)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              {/* Seed */}
              <div>
                <label style={labelStyle}>Seed（-1 随机）</label>
                <input
                  type="number" placeholder="-1"
                  value={payload.seed ?? ""}
                  onChange={(e) => update("seed", e.target.value === "" ? undefined : Number(e.target.value))}
                  className="nodrag" style={fieldBase}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Reference image upload (img2img only) ── */}
        {isImg2Img && (
          <div>
            <label style={labelStyle}>参考图（img2img 必需） *</label>
            {payload.referenceImageUrl ? (
              <div
                className="relative rounded-lg overflow-hidden"
                style={{ height: 80, borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}
              >
                <img
                  src={payload.referenceImageUrl}
                  alt="reference"
                  className="w-full h-full object-cover"
                  draggable={false}
                  onError={makeImageProxyFallback(payload.referenceImageUrl ?? "")}
                />
                <button
                  onClick={() => update("referenceImageUrl", undefined)}
                  className="nodrag absolute top-1 right-1 p-0.5 rounded-full"
                  style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="nodrag w-full flex items-center justify-center gap-2 py-3 rounded-lg transition-colors"
                style={{
                  borderWidth: 1, borderStyle: "dashed",
                  borderColor: uploading ? BORDER_DEFAULT : "var(--c-bd3)",
                  background: "var(--c-input)",
                  color: uploading ? "var(--c-t4)" : "var(--c-t3)",
                  fontSize: 11, cursor: uploading ? "not-allowed" : "pointer",
                }}
              >
                {uploading
                  ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> 上传中...</>
                  : <><Upload style={{ width: 13, height: 13 }} /> 点击上传参考图</>
                }
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* ── Progress bar ── */}
        {payload.status === "processing" && payload.progress != null && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ height: 4, borderRadius: 2, background: "var(--c-bd2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${payload.progress}%`, background: accent, transition: "width 300ms ease", borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 2, display: "block" }}>{payload.progress}%</span>
          </div>
        )}

        {/* ── Generate button ── */}
        <button
          onClick={handleGenerate}
          disabled={genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim()}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim()
              ? "var(--c-surface)"
              : "linear-gradient(135deg, oklch(0.68 0.20 100 / 0.18), oklch(0.62 0.22 80 / 0.18))",
            borderWidth: 1, borderStyle: "solid",
            borderColor: genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim() ? BORDER_DEFAULT : BORDER_ACCENT,
            color: genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim() ? "var(--c-t4)" : accent,
            cursor: genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
            marginTop: 12,
          }}
        >
          {genMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {genMutation.isPending ? "ComfyUI 生成中..." : "运行 ComfyUI"}
        </button>

        </div>{/* end input collapse wrapper */}
      </div>

      {/* Input handle — receives reference image */}
      <Handle
        type="target"
        position={Position.Left}
        id="ref-image-in"
        style={{
          width: 12, height: 12,
          borderRadius: 3,
          background: "oklch(0.72 0.20 330 / 0.85)",
          border: "2px solid var(--c-canvas)",
          left: -6,
          top: "25%",
        }}
        title="参考图输入（img2img 使用）"
      />

      {/* Output handle — provided by BaseNode default (id="output" on Position.Right);
          no custom handle to avoid overlapping with the default. Downstream nodes
          consume payload.imageUrl directly via useWorkflowRunner's edge traversal. */}

      {/* Lightbox */}
      {lightboxOpen && (lightboxUrl ?? payload.imageUrl) && (
        <ImageLightbox
          images={payload.imageUrls && payload.imageUrls.length > 1 ? payload.imageUrls : [lightboxUrl ?? payload.imageUrl ?? ""]}
          currentIndex={0}
          selectedUrl={lightboxUrl ?? payload.imageUrl ?? ""}
          onClose={() => { setLightboxOpen(false); setLightboxUrl(null); }}
          onNavigate={() => { /* multi-image navigation handled by lightbox */ }}
          onSelect={() => { /* no-op */ }}
        />
      )}
    </BaseNode>
  );
});
