import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { useReferenceImages } from "../../../hooks/useReferenceImages";
import { refUrls } from "../../../lib/referenceImages";
import { ReferenceImageStrip } from "../ReferenceImageStrip";
import { Layers } from "lucide-react";
import type { ImageGenNodeData, ImageGenModel } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw, Upload, X, Cpu, Check, Grid2X2, Download, ZoomIn, ChevronDown, ChevronRight, Lock, Unlock, ImagePlus, HardDriveDownload } from "lucide-react";
import { useLocalMedia } from "@/lib/useLocalMedia";
import { cacheMedia } from "@/lib/mediaCache";
import { downloadMedia } from "@/lib/download";
import { ImageLightbox } from "../ImageLightbox";
import { makeImageProxyFallback } from "@/lib/utils";
import { RefImageReachabilityBadge, RefImageSwitchButton, useRefImageGuard, usePreferUpstreamRefSource, useAutoPreferUpstreamRefSource } from "../mediaReachability";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { ParamControls } from "../ParamControls";
import { IMAGE_MODEL_PARAMS, resolveImageParam } from "@/lib/paramDefs";

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

const MAX_SEED = 2147483647;

export const ImageGenNode = memo(function ImageGenNode({ id, selected, data }: Props) {
  // Use selector to avoid re-rendering on every store change (other nodes' updates)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { guard, reachable, dialog: reachabilityDialog } = useRefImageGuard();
  const expanded = Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned);
  const payload = data.payload;
  // Auto-prefer the upstream AI temporary public URL as the reference source when
  // the admin toggle is on and that URL probes alive (no-op when off / default).
  const preferUpstreamRef = usePreferUpstreamRefSource();
  useAutoPreferUpstreamRefSource({ nodeId: id, refImageUrl: payload.referenceImageUrl, enabled: preferUpstreamRef, onSwitch: (u) => updateNodeData(id, { referenceImageUrl: u }, true) });
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [refZoom, setRefZoom] = useState<number | null>(null);
  // Multi-reference-image list + left-docked expandable strip.
  const refImages = useReferenceImages(id, payload);
  const [stripOpen, setStripOpen] = useState(false);
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
        updateNodeData(id, {
          imageUrls: result.urls,
          imageUrl: result.urls[0],
          imageUrlSources: result.sourceUrls,
          imageUrlSource: result.sourceUrls?.[0] ?? result.sourceUrl,
          imageUrlSourceAt: result.sourceAt,
        });
        propagateRefImage(id, result.urls[0]);
        toast.success(`批量生成完成，共 ${result.urls.length} 张图像`);
      } else {
        const imageUrl = result.url ?? result.urls?.[0];
        if (!imageUrl) { toast.error("生成完成但未返回图像"); return; }
        updateNodeData(id, {
          imageUrl,
          imageUrls: undefined,
          imageUrlSource: result.sourceUrl ?? result.sourceUrls?.[0],
          imageUrlSources: undefined,
          imageUrlSourceAt: result.sourceAt,
        });
        propagateRefImage(id, imageUrl);
        toast.success("图像生成成功");
      }
    },
    onError: (err) => {
      toast.error("图像生成失败：" + err.message);
    },
  });

  const uploadMutation = trpc.upload.uploadImage.useMutation();

  // Upload image files and insert them into the reference list at `index`.
  // Used by both the inline upload button (append) and the strip's drag-in
  // (smart-sorted by drop position).
  const uploadFilesToRef = useCallback(async (files: File[], index: number) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) { toast.error("请选择图片文件"); return; }
    setUploading(true);
    let at = index;
    try {
      for (const file of imgs) {
        if (file.size > 16 * 1024 * 1024) { toast.error(`${file.name} 超过 16MB`); continue; }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = () => reject(new Error("文件读取失败"));
          reader.readAsDataURL(file);
        });
        const result = await uploadMutation.mutateAsync({ base64, mimeType: file.type, filename: file.name });
        if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
        refImages.insertUrls([result.url], at, "upload");
        at++;
      }
      toast.success("参考图上传成功");
    } catch (err) {
      toast.error("参考图上传失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  }, [id, refImages, uploadMutation]);

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
    const isReveOrSeedream = payload.model === "hf_reve" || payload.model === "hf_seedream_v4" || payload.model === "hf_flux_pro";
    const reveAspectAllowed: readonly string[] = payload.model === "hf_flux_pro" ? FLUX_PRO_ASPECT_RATIOS : REVE_ASPECT_RATIOS;
    const reveAspect = reveAspectAllowed.includes(payload.reveAspectRatio ?? "") ? payload.reveAspectRatio : undefined;
    const fluxNum = ([1, 2, 3, 4] as number[]).includes(payload.fluxNumImages as number) ? (payload.fluxNumImages as 1 | 2 | 3 | 4) : undefined;
    const soulQuality = (SOUL_QUALITIES as readonly string[]).includes(payload.soulQuality ?? "") ? payload.soulQuality : undefined;
    const reveResolution = (REVE_RESOLUTIONS as readonly string[]).includes(payload.reveResolution ?? "") ? payload.reveResolution : undefined;
    const widthAndHeight = (SOUL_SIZES as readonly string[]).includes(payload.widthAndHeight ?? "") ? payload.widthAndHeight : undefined;
    const validSeed = (s: number | undefined) =>
      typeof s === "number" && Number.isInteger(s) && s >= 0 && s <= MAX_SEED ? s : undefined;
    const validGuidance = (g: number | undefined) =>
      typeof g === "number" && Number.isFinite(g) && g >= 1 && g <= 20 ? g : undefined;
    // 通用尺寸字段尚未写入 ImageGenNodeData 类型（由后端 Zod 接收）。以 tRPC
    // 输入类型作为视图，使枚举字段（imageResolution / imageOutputFormat 等）
    // 与 mutation 入参精确对齐，无需在前端硬抄枚举。
    type GenInput = Parameters<typeof genMutation.mutate>[0];
    const generic = payload as unknown as Pick<
      GenInput,
      "imageSize" | "imageResolution" | "imageN" | "imageOutputFormat" | "poyoAspectRatio"
    >;
    const submit = () => genMutation.mutate({
      prompt: payload.prompt,
      negativePrompt: payload.negativePrompt,
      style: payload.style,
      referenceImageUrl: payload.referenceImageUrl,
      referenceImageUrls: refUrls(payload),
      // Match the picker, which displays "manus_forge" when unset — otherwise a
      // fresh node shows Manus Forge but the backend's undefined-fallback routes
      // to Poyo gpt-image-2 (different model; errors with no Poyo key).
      model: payload.model || "manus_forge",
      // Poyo image model params —— 对任意 poyo_ 开头模型转发通用参数字段。
      // 通用尺寸字段（imageSize / imageResolution / imageN / imageOutputFormat）
      // 与旧 poyoAspectRatio 由 ParamControls/旧节点写入，后端 Zod 校验枚举；前端
      // payload 类型尚未声明这些键，统一经 generic 视图读取后由后端二次校验。
      ...(payload.model?.startsWith("poyo_") ? {
        // Resolve each param to payload value OR the ParamDef default — the
        // controls only display defaults, so an untouched node would otherwise
        // omit fields some models require (e.g. z-image text-to-image size).
        imageSize: resolveImageParam(payload.model, "imageSize", generic.imageSize) as GenInput["imageSize"],
        imageResolution: resolveImageParam(payload.model, "imageResolution", generic.imageResolution) as GenInput["imageResolution"],
        imageN: resolveImageParam(payload.model, "imageN", generic.imageN) as GenInput["imageN"],
        imageOutputFormat: resolveImageParam(payload.model, "imageOutputFormat", generic.imageOutputFormat) as GenInput["imageOutputFormat"],
        poyoQuality: resolveImageParam(payload.model, "poyoQuality", payload.poyoQuality) as GenInput["poyoQuality"],
        // 兼容旧节点：旧 payload 用 poyoAspectRatio，后端 size 取 imageSize ?? poyoAspectRatio
        poyoAspectRatio: generic.poyoAspectRatio,
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
    guard({ model: payload.model ?? "manus_forge", refImageUrl: payload.referenceImageUrl }, submit);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) void uploadFilesToRef(files, refImages.images.length);
  };

  const handleSelectImage = (url: string) => {
    // Keep imageUrlSource aligned with the newly selected batch image so the
    // downstream "switch to AI-platform URL" fallback maps to the right source.
    const idx = payload.imageUrls?.indexOf(url) ?? -1;
    const matchedSource = idx >= 0 ? payload.imageUrlSources?.[idx] : undefined;
    updateNodeData(id, { imageUrl: url, ...(matchedSource !== undefined ? { imageUrlSource: matchedSource } : {}) });
    const n = propagateRefImage(id, url);
    toast.success(n > 0 ? `已选择图像并更新 ${n} 个下游节点` : "已选择此图像");
  };

  const handleClearBatch = () => {
    updateNodeData(id, { imageUrls: undefined, imageUrl: undefined });
  };

  const handleDownloadImage = (url: string) => {
    void downloadMedia(url, `generated-${Date.now()}.png`, "image");
  };

  const handleDownloadSelected = () => handleDownloadImage(payload.imageUrl ?? "");

  const isSoul = payload.model === "hf_soul_standard";
  const isReve = payload.model === "hf_reve";
  const isSeedreamV4 = payload.model === "hf_seedream_v4";
  const isFluxPro = payload.model === "hf_flux_pro";
  const isManus = payload.model === "manus_forge";
  // Models that use the collapsible params panel
  const isReveLike = isReve || isSeedreamV4 || isFluxPro;

  // Collapse the params panel when switching model — old expansion state doesn't apply to a new param set
  useEffect(() => {
    setParamsExpanded(false);
  }, [payload.model]);

  // ── Local media cache (IndexedDB) ────────────────────────────────────────
  const { isLocal: imgIsLocal, blobUrl: imgBlobUrl, downloadedAt: imgDownloadedAt, refresh: refreshImgCache } = useLocalMedia(payload.imageUrl);
  const [imgCaching, setImgCaching] = useState(false);
  const [imgCacheProgress, setImgCacheProgress] = useState(0);
  const handleImgCache = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!payload.imageUrl || imgCaching) return;
    setImgCaching(true); setImgCacheProgress(0);
    try {
      await cacheMedia(payload.imageUrl, "image", (loaded, total) => {
        if (total > 0) setImgCacheProgress(Math.round(loaded / total * 100));
      });
      refreshImgCache();
      toast.success("已缓存到本地");
    } catch (err) {
      toast.error("缓存失败：" + (err instanceof Error ? err.message : String(err)));
    } finally { setImgCaching(false); }
  };

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
        src={imgBlobUrl ?? payload.imageUrl}
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
    <BaseNode id={id} selected={selected} nodeType="image_gen" title={data.title} minHeight={300} heroMedia={heroMedia}
      onRun={handleGenerate} running={genMutation.isPending} canRun={!!payload.prompt?.trim()} hasResult={!!payload.imageUrl}
      headerRight={refImages.images.length > 1 ? (
        <button
          onClick={() => setStripOpen((v) => !v)}
          className="nodrag flex items-center gap-1"
          style={{ fontSize: 10, color: stripOpen ? accent : "var(--c-t3)", border: `1px solid ${stripOpen ? BORDER_ACCENT : "var(--c-bd2)"}`, borderRadius: 6, padding: "1px 6px" }}
          title="展开/收起左侧参考图列表"
        >
          <Layers style={{ width: 11, height: 11 }} /> {refImages.images.length}
        </button>
      ) : undefined}>
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
                  src={imgBlobUrl ?? payload.imageUrl}
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
              {imgIsLocal && (
                <div
                  title={`已缓存到本地（${new Date(imgDownloadedAt).toLocaleString("zh-CN")}）`}
                  className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
                  style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
                />
              )}
              <img
                src={imgBlobUrl ?? payload.imageUrl}
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
                {!imgIsLocal && (
                  <button
                    onClick={handleImgCache}
                    disabled={imgCaching}
                    className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "oklch(0.72 0.18 155)" }}
                    title={imgCaching ? `缓存中 ${imgCacheProgress}%` : "缓存到本地"}
                  >
                    {imgCaching ? <Loader2 className="w-3 h-3 animate-spin" /> : <HardDriveDownload className="w-3 h-3" />}
                    {imgCaching ? (imgCacheProgress > 0 ? `${imgCacheProgress}%` : "缓存中") : "缓存"}
                  </button>
                )}
                {/* 重新生成已移至标题栏常驻按钮，避免与"放大"相邻误点浪费点数 */}
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
          <ModelPicker
            value={payload.model ?? "manus_forge"}
            onChange={(v) => update("model", v as ImageGenModel)}
            options={IMAGE_MODEL_PICKER_OPTIONS}
          />
        </div>

        {/* Prompt */}
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

        {/* Negative prompt */}
        <div>
          <label style={labelStyle}>反向提示词</label>
          <textarea className="nodrag nowheel"
            placeholder="blurry, low quality..."
            value={payload.negativePrompt ?? ""}
            onChange={(e) => update("negativePrompt", e.target.value)}
            rows={2}
            
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
              {/* 比例选择器仅用于既没有 schema 参数、且非 Manus 的旧模型；
                  Poyo 模型的尺寸/比例改由下方 ParamControls 渲染（schema 驱动），
                  Manus Forge 服务端忽略比例所以隐藏。 */}
              {!isManus && payload.model && !IMAGE_MODEL_PARAMS[payload.model] && (
                <div style={{ width: 80 }}>
                  <label style={labelStyle}>比例</label>
                  <select
                    value={payload.aspectRatio ?? ""}
                    onChange={(e) => update("aspectRatio", e.target.value)}
                    className="nodrag"
                    style={{ ...fieldBase, cursor: "pointer" }}
                  >
                    {(RATIOS as readonly string[]).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Poyo 模型参数控件（schema 驱动）—— 替代原 Poyo 专属比例/GPT 质量硬编码区块 */}
        {payload.model && IMAGE_MODEL_PARAMS[payload.model] && IMAGE_MODEL_PARAMS[payload.model].length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <ParamControls
              defs={IMAGE_MODEL_PARAMS[payload.model]}
              values={payload as unknown as Record<string, unknown>}
              onChange={(key, value) => update(key as keyof ImageGenNodeData, value as never)}
            />
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

        {/* Reference images (multi) */}
        <div
          onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-asset-list") || e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (files.length) { e.preventDefault(); void uploadFilesToRef(files, refImages.images.length); return; }
            const assetRaw = e.dataTransfer.getData("application/x-asset-list");
            if (assetRaw) {
              e.preventDefault();
              try {
                const list = JSON.parse(assetRaw) as Array<{ url?: string; type?: string }>;
                const urls = list.filter((a) => a.url && (!a.type || a.type === "image")).map((a) => a.url!);
                if (urls.length) refImages.addUrls(urls, "drop");
              } catch { /* ignore */ }
              return;
            }
            const uri = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim();
            if (/^https?:\/\//.test(uri)) { e.preventDefault(); refImages.addUrls([uri], "drop"); }
          }}
        >
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            参考图（可选，可多张）
            {refImages.images.length > 0 && (
              <span style={{ fontSize: 10, color: "var(--c-t3)", fontWeight: 600 }}>· {refImages.images.length} 张</span>
            )}
            <RefImageReachabilityBadge
              model={payload.model}
              refImageUrl={payload.referenceImageUrl}
              reachable={reachable}
            />
            <RefImageSwitchButton
              nodeId={id}
              model={payload.model}
              refImageUrl={payload.referenceImageUrl}
              reachable={reachable}
              onSwitch={(u) => update("referenceImageUrl", u)}
            />
            {refImages.images.length > 1 && (
              <button
                onClick={() => setStripOpen((v) => !v)}
                className="nodrag"
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: stripOpen ? accent : "var(--c-t3)", border: `1px solid ${stripOpen ? BORDER_ACCENT : "var(--c-bd2)"}`, borderRadius: 6, padding: "1px 6px" }}
                title="展开左侧参考图列表"
              >
                <Layers style={{ width: 11, height: 11 }} /> {stripOpen ? "收起" : "展开"}
              </button>
            )}
          </label>

          {/* Horizontal thumbnails (numbered) */}
          {refImages.images.length > 0 && (
            <div className="nowheel" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
              {refImages.images.map((img, i) => (
                <div key={img.id} className="relative rounded-lg overflow-hidden flex-shrink-0" style={{ width: 72, height: 72, borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}>
                  <img
                    src={img.url}
                    alt={`ref-${i + 1}`}
                    className="nodrag w-full h-full object-cover"
                    style={{ cursor: "zoom-in" }}
                    draggable={false}
                    title="点击放大"
                    onClick={() => setRefZoom(i)}
                    onError={makeImageProxyFallback(img.url)}
                  />
                  <span style={{ position: "absolute", left: 3, top: 3, minWidth: 15, height: 15, paddingInline: 3, borderRadius: 8, fontSize: 9, fontWeight: 700, lineHeight: "15px", textAlign: "center", background: accent, color: "white" }}>{i + 1}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); refImages.removeId(img.id); }}
                    className="nodrag absolute top-1 right-1 p-0.5 rounded-full"
                    style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                  >
                    <X style={{ width: 11, height: 11 }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="nodrag w-full flex items-center justify-center gap-2 py-2.5 rounded-lg transition-colors"
            style={{
              marginTop: refImages.images.length > 0 ? 6 : 0,
              borderWidth: 1, borderStyle: "dashed",
              borderColor: uploading ? BORDER_DEFAULT : "var(--c-bd3)",
              background: "var(--c-input)",
              color: uploading ? "var(--c-t4)" : "var(--c-t3)",
              fontSize: 11, cursor: uploading ? "not-allowed" : "pointer",
            }}
          >
            {uploading
              ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> 上传中...</>
              : <><Upload style={{ width: 13, height: 13 }} /> {refImages.images.length > 0 ? "添加参考图" : "上传 / 拖拽参考图"}</>
            }
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          {/* 或直接粘贴公网图片 URL —— 回车/失焦添加为新的参考图 */}
          <input
            type="url"
            placeholder="粘贴公网图片 URL 后回车添加（https://…）"
            className="nodrag"
            style={{ ...fieldBase, marginTop: 6, fontSize: 10.5 }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const v = (e.target as HTMLInputElement).value.trim();
              if (/^https?:\/\//.test(v)) { refImages.addUrls([v], "url"); (e.target as HTMLInputElement).value = ""; }
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (/^https?:\/\//.test(v)) { refImages.addUrls([v], "url"); e.currentTarget.value = ""; }
              e.currentTarget.style.borderColor = BORDER_DEFAULT;
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
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
            const poyoN = (payload as unknown as { imageN?: number }).imageN ?? 1;
            const batch = isSoul && (payload.batchSize ?? 1) > 1 ? (payload.batchSize ?? 1)
                        : isFluxPro && (payload.fluxNumImages ?? 1) > 1 ? (payload.fluxNumImages ?? 1)
                        : poyoN > 1 ? poyoN
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

      {/* Reference-image zoom (plain viewer, navigable across all refs) */}
      {refZoom !== null && refImages.images.length > 0 && (
        <ImageLightbox
          images={refImages.images.map((r) => r.url)}
          currentIndex={Math.min(refZoom, refImages.images.length - 1)}
          onClose={() => setRefZoom(null)}
          onNavigate={(idx) => setRefZoom(idx)}
        />
      )}

      {/* Left-docked, expandable reference-image strip */}
      <ReferenceImageStrip
        images={refImages.images}
        open={stripOpen}
        accent={accent}
        onClose={() => setStripOpen(false)}
        onRemove={refImages.removeId}
        onMove={refImages.moveId}
        onInsertUrls={(urls, index) => refImages.insertUrls(urls, index, "drop")}
        onDropFiles={(files, index) => void uploadFilesToRef(files, index)}
        onZoom={(i) => setRefZoom(i)}
      />

      {reachabilityDialog}
    </BaseNode>
  );
});
