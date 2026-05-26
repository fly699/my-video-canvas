import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ImageGenNodeData, ImageGenModel } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw, Upload, X, Cpu, Check, Grid2X2, Download, ZoomIn, ChevronDown, ChevronRight, Lock, Unlock, ImagePlus } from "lucide-react";
import { ImageLightbox } from "../ImageLightbox";
import { IMAGE_MODELS } from "@/lib/models";
import { makeImageProxyFallback } from "@/lib/utils";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "image_gen";
    title: string;
    payload: ImageGenNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.72 0.20 330)";
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = `oklch(0.72 0.20 330 / 0.5)`;

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

const STYLES = ["写实", "动漫", "插画", "3D渲染", "水彩", "油画", "素描", "赛博朋克", "复古胶片"];
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:1"];

// Soul Standard supported sizes (from official SDK)
// Soul Standard — server enforces a 13-value enum for `width_and_height`.
// Source: official higgsfield-js SDK src/helpers.ts SoulSize constant; also
// echoed in the 422 error response when an invalid value is sent. Picking
// anything outside this list (e.g. "1024x1024") returns Pydantic literal_error.
const SOUL_SIZES = [
  // Landscape
  "2048x1152", "2048x1536", "2016x1344", "1696x960", "1632x1088",
  // Portrait
  "1152x2048", "1536x2048", "1344x2016", "960x1696", "1088x1632",
  // Square / mixed
  "1536x1536", "1536x1152", "1152x1536",
] as const;

// Reve / Seedream / Flux Pro aspect_ratio enum — verified against the
// third-party reference impl (jeremieLouvaert/ComfyUI-Higgsfield-Direct).
// All v2 image endpoints share this set.
const REVE_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const FLUX_PRO_ASPECT_RATIOS = REVE_ASPECT_RATIOS;

// v2 endpoints expect resolution as "1K" / "2K" / "4K", NOT "720p"/"1080p".
// Soul Standard (v1) is the only model that uses the px-based "720p"/"1080p".
const REVE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
const SOUL_QUALITIES = ["720p", "1080p"] as const;

// Per-model aspect ratio whitelists — protect downstream APIs from cross-model contamination
// Also used to drive UI <option> rendering so users cannot select a value the server will silently drop
const POYO_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"] as const;
const POYO_QUALITIES = ["low", "medium", "high"] as const;

const MAX_SEED = 2147483647;

const MODELS = IMAGE_MODELS as unknown as { value: ImageGenModel; label: string; desc: string; group: string }[];

// Push a freshly chosen / generated image URL out to every downstream node
// that consumes a reference image (video_task / comfyui_video / comfyui_image).
// Kept in sync with useWorkflowRunner's post-generation propagation and
// useCanvasStore's onConnect pre-populate. Returns how many nodes were
// updated so callers can toast meaningfully.
function propagateImageUrl(sourceId: string, url: string): number {
  const { edges, nodes, batchUpdateNodeData } = useCanvasStore.getState();
  const updates = edges
    .filter(e =>
      e.source === sourceId &&
      (e.sourceHandle === "image-out" || e.sourceHandle === "output") &&
      e.targetHandle === "ref-image-in"
    )
    .flatMap(edge => {
      const target = nodes.find(n => n.id === edge.target);
      const tt = target?.data.nodeType;
      return (tt === "video_task" || tt === "comfyui_video" || tt === "comfyui_image")
        ? [{ id: edge.target, payload: { referenceImageUrl: url } }]
        : [];
    });
  if (updates.length > 0) batchUpdateNodeData(updates);
  return updates.length;
}

export const ImageGenNode = memo(function ImageGenNode({ id, selected, data }: Props) {
  // Use selector to avoid re-rendering on every store change (other nodes' updates)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const expanded = Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned);
  const payload = data.payload;
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [paramsExpanded, setParamsExpanded] = useState(false);
  // Derived, not local state — stays in sync with collaboration/undo updates
  const seedLocked = payload.seed != null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine if we are in batch/grid mode
  const hasMultiple = (payload.imageUrls?.length ?? 0) > 1;

  // Reset lightbox when image data shape changes (avoids out-of-bounds index after batch→single switch)
  useEffect(() => {
    if (lightboxIndex === null) return;
    const len = hasMultiple ? (payload.imageUrls?.length ?? 0) : (payload.imageUrl ? 1 : 0);
    if (lightboxIndex >= len) setLightboxIndex(null);
  }, [hasMultiple, payload.imageUrls, payload.imageUrl, lightboxIndex]);

  const genMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      // Guard: node may have been deleted while generation was in flight
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      if (result.urls && result.urls.length > 1) {
        updateNodeData(id, { imageUrls: result.urls, imageUrl: result.urls[0] });
        propagateImageUrl(id, result.urls[0]);
        toast.success(`批量生成完成，共 ${result.urls.length} 张图像`);
      } else {
        const imageUrl = result.url ?? result.urls?.[0];
        if (!imageUrl) { toast.error("生成完成但未返回图像"); return; }
        updateNodeData(id, { imageUrl, imageUrls: undefined });
        propagateImageUrl(id, imageUrl);
        toast.success("图像生成成功");
      }
    },
    onError: (err) => {
      toast.error("图像生成失败：" + err.message);
    },
  });

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      setUploading(false);
      // Guard: node may have been deleted while upload was in flight
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
    (field: keyof ImageGenNodeData, value: unknown) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );

  const handlePropagateSeed = useCallback(() => {
    if (payload.seed == null) return;
    const { nodes: allNodes, edges: allEdges, batchUpdateNodeData } = useCanvasStore.getState();
    const updates = allEdges
      .filter(e => e.source === id)
      .flatMap(edge => {
        const target = allNodes.find(n => n.id === edge.target);
        if (!target) return [];
        const nt = target.data.nodeType;
        if (nt !== "storyboard" && nt !== "image_gen" && nt !== "video_task") return [];
        // Skip targets that already hold the same seed — avoid store churn
        // and misleading "propagated to N nodes" toasts when nothing changed
        const currentSeed = (target.data.payload as { seed?: number }).seed;
        if (currentSeed === payload.seed) return [];
        return [{ id: edge.target, payload: { seed: payload.seed } }];
      });
    if (updates.length > 0) {
      batchUpdateNodeData(updates);
      toast.success(`种子 ${payload.seed} 已传播到 ${updates.length} 个节点`);
    } else {
      toast.info("下游节点种子已是最新或没有支持种子的下游节点");
    }
  }, [id, payload.seed]);

  const handleGenerate = () => {
    if (genMutation.isPending) return;
    if (uploading) { toast.error("参考图正在上传中，请稍候"); return; }
    if (!payload.prompt?.trim()) { toast.error("请先填写提示词"); return; }
    const isPoyo = payload.model === "poyo_flux" || payload.model === "poyo_sdxl" || payload.model === "poyo_gpt_image" ||
                   payload.model === "poyo_seedream" || payload.model === "poyo_grok_image" || payload.model === "poyo_wan_image";
    const isReveOrSeedream = payload.model === "hf_reve" || payload.model === "hf_seedream_v4" || payload.model === "hf_flux_pro";
    const poyoAspect = (POYO_ASPECT_RATIOS as readonly string[]).includes(payload.aspectRatio ?? "") ? payload.aspectRatio : undefined;
    const reveAspectAllowed: readonly string[] = payload.model === "hf_flux_pro" ? FLUX_PRO_ASPECT_RATIOS : REVE_ASPECT_RATIOS;
    const reveAspect = reveAspectAllowed.includes(payload.reveAspectRatio ?? "") ? payload.reveAspectRatio : undefined;
    const fluxNum = ([1, 2, 3, 4] as number[]).includes(payload.fluxNumImages as number) ? (payload.fluxNumImages as 1 | 2 | 3 | 4) : undefined;
    const poyoQuality = (POYO_QUALITIES as readonly string[]).includes(payload.poyoQuality ?? "") ? payload.poyoQuality : undefined;
    const soulQuality = (SOUL_QUALITIES as readonly string[]).includes(payload.soulQuality ?? "") ? payload.soulQuality : undefined;
    const reveResolution = (REVE_RESOLUTIONS as readonly string[]).includes(payload.reveResolution ?? "") ? payload.reveResolution : undefined;
    const widthAndHeight = (SOUL_SIZES as readonly string[]).includes(payload.widthAndHeight ?? "") ? payload.widthAndHeight : undefined;
    const validSeed = (s: number | undefined) =>
      typeof s === "number" && Number.isInteger(s) && s >= 0 && s <= MAX_SEED ? s : undefined;
    const validGuidance = (g: number | undefined) =>
      typeof g === "number" && Number.isFinite(g) && g >= 1 && g <= 20 ? g : undefined;
    genMutation.mutate({
      prompt: payload.prompt,
      negativePrompt: payload.negativePrompt,
      style: payload.style,
      referenceImageUrl: payload.referenceImageUrl,
      model: payload.model || undefined,
      // Poyo image model params
      ...(isPoyo ? {
        poyoAspectRatio: poyoAspect,
        ...(payload.model === "poyo_gpt_image" ? { poyoQuality } : {}),
      } : {}),
      // Soul Standard specific params
      ...(payload.model === "hf_soul_standard" ? {
        widthAndHeight,
        quality: soulQuality,
        batchSize: ([1, 4] as number[]).includes(payload.batchSize as number) ? (payload.batchSize as 1 | 4) : undefined,
        seed: validSeed(payload.seed),
        enhancePrompt: payload.enhancePrompt,
      } : {}),
      // Reve / Seedream v4 / Flux Pro aspect ratio
      ...(isReveOrSeedream ? {
        reveAspectRatio: reveAspect,
        ...(payload.model === "hf_reve" ? { reveResolution } : {}),
      } : {}),
      // Flux Pro Kontext extra params
      ...(payload.model === "hf_flux_pro" ? {
        fluxGuidanceScale: validGuidance(payload.fluxGuidanceScale),
        fluxSeed: validSeed(payload.fluxSeed),
        fluxNumImages: fluxNum,
      } : {}),
      projectId: data.projectId,
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

  const handleSelectImage = (url: string) => {
    update("imageUrl", url);
    const n = propagateImageUrl(id, url);
    toast.success(n > 0 ? `已选择图像并更新 ${n} 个下游节点` : "已选择此图像");
  };

  const handleClearBatch = () => {
    updateNodeData(id, { imageUrls: undefined, imageUrl: undefined });
  };

  const handleDownloadImage = (url: string) => {
    if (!url) return;
    const a = document.createElement("a");
    const filename = `generated-${Date.now()}.png`;
    // Same-origin check: must start with single "/" (not protocol-relative "//host/...") or origin prefix
    const isSameOrigin = (url.startsWith("/") && !url.startsWith("//")) || url.startsWith(window.location.origin);
    a.href = isSameOrigin ? url : `/api/image-proxy?url=${encodeURIComponent(url)}&download=1`;
    a.download = filename;
    // Firefox requires <a> in DOM for download to trigger
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadSelected = () => handleDownloadImage(payload.imageUrl ?? "");

  const isSoul = payload.model === "hf_soul_standard";
  const isReve = payload.model === "hf_reve";
  const isSeedreamV4 = payload.model === "hf_seedream_v4";
  const isFluxPro = payload.model === "hf_flux_pro";
  const isGptImage = payload.model === "poyo_gpt_image";
  const isManus = payload.model === "manus_forge";
  // Models that use the collapsible params panel
  const isReveLike = isReve || isSeedreamV4 || isFluxPro;

  // Collapse the params panel when switching model — old expansion state doesn't apply to a new param set
  useEffect(() => {
    setParamsExpanded(false);
  }, [payload.model]);

  const heroMedia = hasMultiple ? (
    <div
      className="grid gap-1 p-2"
      style={{ gridTemplateColumns: payload.imageUrls!.length === 4 ? "1fr 1fr" : `repeat(${Math.min(payload.imageUrls!.length, 3)}, 1fr)` }}
    >
      {payload.imageUrls!.map((url, idx) => {
        const isSelected = url === payload.imageUrl;
        return (
          <div key={idx} className="relative rounded-lg overflow-hidden" style={{ aspectRatio: "1/1", background: "var(--c-canvas)" }}>
            <img
              src={url}
              alt={`generated-${idx}`}
              className="w-full h-full object-cover"
              draggable={false}
              onError={makeImageProxyFallback(url)}
            />
            {isSelected && (
              <div
                className="absolute top-1 right-1 rounded-full flex items-center justify-center"
                style={{ width: 16, height: 16, background: accent }}
              >
                <Check style={{ width: 10, height: 10, color: "var(--c-canvas)" }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  ) : payload.imageUrl ? (
    <div className="relative overflow-hidden group" style={{ width: "100%" }}>
      <img
        src={payload.imageUrl}
        alt="generated"
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
    <BaseNode id={id} selected={selected} nodeType="image_gen" title={data.title} minHeight={300} heroMedia={heroMedia}>
      <div className="flex flex-col h-full p-3.5 gap-3 overflow-auto">

        {/* ── Batch grid result ── */}
        {hasMultiple ? (
          <div className="flex-shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: 10, color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4 }}>
                <Grid2X2 style={{ width: 10, height: 10 }} />
                {payload.imageUrls!.length} 张图像 · 点击选择
              </span>
              <div className="flex gap-1">
                <button
                  onClick={handleGenerate}
                  disabled={genMutation.isPending}
                  className="nodrag flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ background: "oklch(0.72 0.20 330 / 0.12)", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_ACCENT, color: accent, fontSize: 10 }}
                >
                  {genMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                  重新生成
                </button>
                <button
                  onClick={handleClearBatch}
                  className="nodrag flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ background: "var(--c-surface)", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, color: "var(--c-t3)", fontSize: 10 }}
                >
                  <X className="w-2.5 h-2.5" />
                  清空
                </button>
              </div>
            </div>

            {/* Grid */}
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: payload.imageUrls!.length === 4 ? "1fr 1fr" : `repeat(${Math.min(payload.imageUrls!.length, 3)}, 1fr)` }}
            >
              {payload.imageUrls!.map((url, idx) => {
                const isSelected = url === payload.imageUrl;
                return (
                  <button
                    key={idx}
                    onClick={() => setLightboxIndex(idx)}
                    className="nodrag relative rounded-lg overflow-hidden group"
                    style={{
                      aspectRatio: "1/1",
                      borderWidth: 2,
                      borderStyle: "solid",
                      borderColor: isSelected ? accent : "transparent",
                      background: "var(--c-canvas)",
                      padding: 0,
                      cursor: "pointer",
                      transition: "border-color 150ms ease, opacity 150ms ease",
                      opacity: isSelected ? 1 : 0.72,
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.opacity = "0.72"; }}
                  >
                    <img
                      src={url}
                      alt={`generated-${idx}`}
                      className="w-full h-full object-cover"
                      draggable={false}
                      onError={makeImageProxyFallback(url)}
                    />
                    {/* Selected checkmark */}
                    {isSelected && (
                      <div
                        className="absolute top-1 right-1 rounded-full flex items-center justify-center"
                        style={{ width: 16, height: 16, background: accent }}
                      >
                        <Check style={{ width: 10, height: 10, color: "var(--c-canvas)" }} />
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      style={{ background: "oklch(0 0 0 / 0.45)" }}
                    >
                      <ZoomIn style={{ width: 16, height: 16, color: "var(--c-t1)" }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selected image preview (larger) */}
            {payload.imageUrl && (
              <div
                className="mt-1.5 rounded-lg overflow-hidden"
                style={{ borderWidth: 1, borderStyle: "solid", borderColor: `oklch(0.72 0.20 330 / 0.3)`, background: "var(--c-canvas)" }}
              >
                <div className="flex items-center justify-between" style={{ padding: "3px 8px", borderBottom: `1px solid oklch(0.72 0.20 330 / 0.15)` }}>
                  <span style={{ fontSize: 9, color: accent, letterSpacing: "0.05em", fontWeight: 600 }}>✓ 已选择</span>
                  <button
                    onClick={handleDownloadSelected}
                    className="nodrag flex items-center gap-0.5"
                    style={{ fontSize: 9, color: "var(--c-t3)", cursor: "pointer", background: "none", border: "none", padding: 0 }}
                    title="下载此图像"
                  >
                    <Download style={{ width: 9, height: 9 }} />
                    下载
                  </button>
                </div>
                <img
                  src={payload.imageUrl}
                  alt="selected"
                  className="w-full object-contain"
                  style={{ maxHeight: 120 }}
                  draggable={false}
                  onError={makeImageProxyFallback(payload.imageUrl ?? "")}
                />
              </div>
            )}
          </div>
        ) : (
          /* ── Single image result ── */
          payload.imageUrl ? (
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
                  onClick={() => setLightboxIndex(0)}
                  className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
                >
                  <ZoomIn className="w-3 h-3" />
                  放大
                </button>
                <button
                  onClick={handleDownloadSelected}
                  className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
                >
                  <Download className="w-3 h-3" />
                  下载
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={genMutation.isPending}
                  className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "oklch(0.72 0.20 330 / 0.2)", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_ACCENT, color: accent }}
                >
                  {genMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  重新生成
                </button>
              </div>
            </div>
          ) : (
            <div
              className="rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ aspectRatio: "16/9", borderWidth: 1, borderStyle: "dashed", borderColor: `oklch(0.72 0.20 330 / 0.25)`, background: `oklch(0.72 0.20 330 / 0.04)` }}
            >
              <div className="flex flex-col items-center gap-1.5" style={{ color: "oklch(0.72 0.20 330 / 0.5)" }}>
                <Sparkles style={{ width: 24, height: 24 }} />
                <span style={{ fontSize: 11 }}>生成图像将显示在这里</span>
              </div>
            </div>
          )
        )}

        {/* ── Input area (collapsed when not selected, kept open if pinned) ── */}
        <div
          style={{
            overflow: "hidden",
            maxHeight: expanded ? "9999px" : "0px",
            transition: expanded
              ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
              : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
          }}
        >

        {/* Model selector */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
            <Cpu style={{ width: 10, height: 10 }} />
            模型
          </label>
          <select
            value={payload.model ?? ""}
            onChange={(e) => update("model", e.target.value)}
            className="nodrag"
            style={{ ...fieldBase, cursor: "pointer" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          >
            <option value="">自动选择</option>
            {["Manus", "Poyo", "Higgsfield"].map((group) => (
              <optgroup key={group} label={`── ${group} ──`} style={{ background: "var(--c-surface)" }}>
                {MODELS.filter((m) => m.group === group).map((m) => (
                  <option key={m.value} value={m.value} style={{ background: "var(--c-surface)" }}>
                    {m.label} — {m.desc}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Prompt */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <textarea
            placeholder="描述你想生成的图像..."
            value={payload.prompt ?? ""}
            onChange={(e) => update("prompt", e.target.value)}
            rows={3}
            className="nodrag"
            style={{ ...fieldBase, resize: "none", lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Negative prompt */}
        <div>
          <label style={labelStyle}>反向提示词</label>
          <textarea
            placeholder="blurry, low quality..."
            value={payload.negativePrompt ?? ""}
            onChange={(e) => update("negativePrompt", e.target.value)}
            rows={2}
            className="nodrag"
            style={{ ...fieldBase, resize: "none", lineHeight: 1.6, fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-t4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Reve params are now inside the collapsible block below */}

        {/* Style + Ratio (non-Soul, non-Reve/Seedream/FluxPro models) */}
        {!isSoul && !isReveLike && (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <div className="flex-1">
                <label style={labelStyle}>风格</label>
                <select
                  value={payload.style ?? ""}
                  onChange={(e) => update("style", e.target.value)}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  <option value="">默认</option>
                  {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {/* Manus Forge ignores aspect ratio server-side — hide the picker to avoid misleading users */}
              {!isManus && (
                <div style={{ width: 80 }}>
                  <label style={labelStyle}>比例</label>
                  <select
                    value={payload.aspectRatio ?? ""}
                    onChange={(e) => update("aspectRatio", e.target.value)}
                    className="nodrag"
                    style={{ ...fieldBase, cursor: "pointer" }}
                  >
                    {/* Restrict options to the Poyo whitelist (server-validated); fallback to RATIOS for other non-Manus paths */}
                    {(payload.model && (payload.model === "poyo_flux" || payload.model === "poyo_sdxl" || payload.model === "poyo_gpt_image" || payload.model === "poyo_seedream" || payload.model === "poyo_grok_image" || payload.model === "poyo_wan_image")
                      ? (POYO_ASPECT_RATIOS as readonly string[])
                      : (RATIOS as readonly string[])
                    ).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
            </div>
            {/* GPT Image 2 quality selector */}
            {isGptImage && (
              <div>
                <label style={labelStyle}>质量</label>
                <select
                  value={payload.poyoQuality ?? "medium"}
                  onChange={(e) => update("poyoQuality", e.target.value as "low" | "medium" | "high")}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                >
                  <option value="low">低质量 · 快速</option>
                  <option value="medium">标准质量</option>
                  <option value="high">高质量 · 慢速</option>
                </select>
              </div>
            )}
          </div>
        )}

        {/* Soul / Reve / Seedream v4 / Flux Pro specific params — collapsible */}
        {(isSoul || isReveLike) && (
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
                模型参数
              </span>
              {paramsExpanded
                ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
                : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
              }
            </button>
            {paramsExpanded && (
              <div className="px-3 pb-3 flex flex-col gap-2.5">
                {/* Soul Standard params */}
                {isSoul && <>
            <div className="flex gap-1.5">
              <div className="flex-1">
                <label style={labelStyle}>尺寸</label>
                <select
                  value={payload.widthAndHeight ?? "1024x1024"}
                  onChange={(e) => update("widthAndHeight", e.target.value)}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  {SOUL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ width: 80 }}>
                <label style={labelStyle}>质量</label>
                <select
                  value={payload.soulQuality ?? "720p"}
                  onChange={(e) => update("soulQuality", e.target.value as "720p" | "1080p")}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
            </div>
            <div className="flex gap-1.5">
              <div style={{ width: 80 }}>
                <label style={labelStyle}>批量</label>
                <select
                  value={String(payload.batchSize ?? 1)}
                  onChange={(e) => update("batchSize", Number(e.target.value))}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  <option value="1">1 张</option>
                  <option value="4">4 张</option>
                </select>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-[5px]">
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Seed（可选）</label>
                  <button
                    onClick={() => {
                      if (seedLocked) {
                        update("seed", undefined);
                      } else {
                        const randomSeed = Math.floor(Math.random() * 2147483647);
                        update("seed", randomSeed);
                      }
                    }}
                    className="nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] transition-all"
                    style={{
                      background: seedLocked ? "oklch(0.68 0.22 285 / 0.15)" : "var(--c-surface)",
                      border: `1px solid ${seedLocked ? "oklch(0.68 0.22 285 / 0.40)" : "var(--c-bd2)"}`,
                      color: seedLocked ? "oklch(0.72 0.18 285)" : "var(--c-t4)",
                      cursor: "pointer",
                    }}
                    title={seedLocked ? "解锁种子（清除）" : "锁定随机种子"}
                  >
                    {seedLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                    {seedLocked ? "已锁" : "锁定"}
                  </button>
                </div>
                <input
                  type="number"
                  placeholder="随机"
                  value={payload.seed ?? ""}
                  onChange={(e) => update("seed", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag"
                  style={fieldBase}
                />
              </div>
            </div>
            {payload.model === "hf_soul_standard" && payload.seed !== undefined && (
              <button
                onClick={handlePropagateSeed}
                className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all self-start"
                style={{
                  background: "oklch(0.68 0.22 285 / 0.10)",
                  border: "1px solid oklch(0.68 0.22 285 / 0.30)",
                  color: "oklch(0.68 0.22 285)",
                  cursor: "pointer",
                }}
              >
                <Lock className="w-3 h-3" />
                传播种子 {payload.seed} 到下游
              </button>
            )}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`enhance-${id}`}
                checked={Boolean(payload.enhancePrompt)}
                onChange={(e) => update("enhancePrompt", e.target.checked)}
                className="nodrag"
                style={{ accentColor: accent, width: 12, height: 12 }}
              />
              <label htmlFor={`enhance-${id}`} style={{ fontSize: 11, color: "var(--c-t2)", cursor: "pointer" }}>
                AI 增强提示词
              </label>
            </div>
          </>
                }
                {/* Reve / Seedream v4 / Flux Pro params */}
                {isReveLike && (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-1.5">
                      <div className="flex-1">
                        <label style={labelStyle}>宽高比</label>
                        <select
                          value={payload.reveAspectRatio ?? "16:9"}
                          onChange={(e) => update("reveAspectRatio", e.target.value)}
                          className="nodrag"
                          style={{ ...fieldBase, cursor: "pointer" }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                        >
                          {/* Flux Pro Kontext only supports a subset of ratios — keep UI options in sync with the server-side whitelist */}
                          {(isFluxPro ? (FLUX_PRO_ASPECT_RATIOS as readonly string[]) : (REVE_ASPECT_RATIOS as readonly string[])).map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      {isReveLike && (
                        <div style={{ width: 80 }}>
                          <label style={labelStyle}>分辨率</label>
                          <select
                            value={payload.reveResolution ?? "2K"}
                            onChange={(e) => update("reveResolution", e.target.value)}
                            className="nodrag"
                            style={{ ...fieldBase, cursor: "pointer" }}
                            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                          >
                            {REVE_RESOLUTIONS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    {/* Flux Pro Kontext extra params */}
                    {isFluxPro && (
                      <>
                        <div className="flex gap-1.5">
                          <div className="flex-1">
                            <label style={labelStyle}>引导强度</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min={1}
                                max={20}
                                step={0.5}
                                value={payload.fluxGuidanceScale ?? 3.5}
                                onChange={(e) => update("fluxGuidanceScale", Number(e.target.value))}
                                className="nodrag flex-1"
                                style={{ accentColor: accent }}
                              />
                              <span style={{ fontSize: 11, color: "var(--c-t3)", width: 28, textAlign: "right" }}>
                                {(payload.fluxGuidanceScale ?? 3.5).toFixed(1)}
                              </span>
                            </div>
                          </div>
                          <div style={{ width: 72 }}>
                            <label style={labelStyle}>批量</label>
                            <select
                              value={String(payload.fluxNumImages ?? 1)}
                              onChange={(e) => update("fluxNumImages", Number(e.target.value))}
                              className="nodrag"
                              style={{ ...fieldBase, cursor: "pointer" }}
                            >
                              <option value="1">1 张</option>
                              <option value="2">2 张</option>
                              <option value="3">3 张</option>
                              <option value="4">4 张</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label style={labelStyle}>Seed（可选）</label>
                          <input
                            type="number"
                            placeholder="随机"
                            value={payload.fluxSeed ?? ""}
                            onChange={(e) => update("fluxSeed", e.target.value ? Number(e.target.value) : undefined)}
                            className="nodrag"
                            style={fieldBase}
                            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reference image upload */}
        <div>
          <label style={labelStyle}>参考图（可选）</label>
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

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={genMutation.isPending || !payload.prompt?.trim()}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: genMutation.isPending || !payload.prompt?.trim()
              ? "var(--c-surface)"
              : "linear-gradient(135deg, oklch(0.72 0.20 330 / 0.18), oklch(0.68 0.22 285 / 0.18))",
            borderWidth: 1, borderStyle: "solid",
            borderColor: genMutation.isPending || !payload.prompt?.trim() ? BORDER_DEFAULT : BORDER_ACCENT,
            color: genMutation.isPending || !payload.prompt?.trim() ? "var(--c-t4)" : accent,
            cursor: genMutation.isPending || !payload.prompt?.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
          }}
        >
          {genMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {(() => {
            const batch = isSoul && (payload.batchSize ?? 1) > 1 ? (payload.batchSize ?? 1)
                        : isFluxPro && (payload.fluxNumImages ?? 1) > 1 ? (payload.fluxNumImages ?? 1)
                        : 1;
            if (genMutation.isPending) return batch > 1 ? `批量生成中 (${batch} 张)...` : "AI 生成中...";
            return batch > 1 ? `批量生成 ${batch} 张` : "生成图像";
          })()}
        </button>

        </div>{/* end input collapse wrapper */}
      </div>

      {/* Image-specific output handle — kept separate from BaseNode's default
          `output` (at top:50%) so the two right-side dots don't visually collide.
          Position at top:75% mirrors the asymmetric layout used by VideoTaskNode's
          ref-image-in (top:25%). Legacy edges with sourceHandle="image-out" remain
          functional, plus useCanvasStore's onConnect auto-fill for image_gen →
          video_task still finds this handle. */}
      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        style={{
          width: 12, height: 12,
          borderRadius: "50%",
          background: accent,
          border: `2px solid var(--c-canvas)`,
          right: -6,
          top: "75%",
        }}
        title="图像输出 → 连接到视频任务参考图"
      />

      {/* Lightbox */}
      {lightboxIndex !== null && (() => {
        const images = hasMultiple ? (payload.imageUrls ?? []) : (payload.imageUrl ? [payload.imageUrl] : []);
        if (images.length === 0 || lightboxIndex >= images.length) return null;
        return (
          <ImageLightbox
            images={images}
            currentIndex={lightboxIndex}
            selectedUrl={payload.imageUrl}
            onClose={() => setLightboxIndex(null)}
            onNavigate={(idx) => setLightboxIndex(idx)}
            onSelect={(url) => { handleSelectImage(url); setLightboxIndex(null); }}
          />
        );
      })()}
    </BaseNode>
  );
});
