import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { BaseNode } from "../BaseNode";
import { handleStyle } from "../../../lib/handleStyle";
import { useConnectState } from "../../../hooks/useConnectingStore";
import { useHoverStore } from "../../../hooks/useHoverStore";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { useReferenceImages } from "../../../hooks/useReferenceImages";
import { HideWhenStudioFloating } from "../../../contexts/StudioFloatingContext";
import { refUrls } from "../../../lib/referenceImages";
import { buildImageGenInput } from "../../../lib/imageGenBuild";
import { effectiveCharacters, stripCharacterMentions } from "../../../lib/characterConditioning";
import { mergeCharactersIntoPrompt } from "../../../lib/characterPrompt";
import { detectUpstreamPrompt, detectUpstreamImagesExpanded, stripMediaMentions } from "../../../lib/comfyWorkflowParams";
import { connectedEffectPrompts, appendEffectPrompts } from "../../../lib/effectPrompt";
import { ReferenceImageStrip, type StripItem } from "../ReferenceImageStrip";
import { openNodeImage } from "../NodeImageLightbox";
import { Depth3DViewer } from "../Depth3DViewer";
import { Model3DViewer } from "../Model3DViewer";
import { confirmDialog } from "@/components/ui/dialogService";
import { pushResultSnapshot } from "@/lib/resultHistory";
import type { ResultSnapshot } from "../../../../../shared/types";
import { useWorkflowRunState } from "../../../contexts/WorkflowRunContext";
import { PromptDock } from "../PromptDock";
import { RefHeroPreview } from "../RefHeroPreview";
import { useNodeDocks, useCharSceneItems } from "../../../hooks/useNodeDocks";
import type { ImageGenNodeData, ImageGenModel, NodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw, Upload, X, Cpu, Check, Grid2X2, Download, ZoomIn, ChevronDown, ChevronRight, Lock, Unlock, ImagePlus, AlertTriangle, Rotate3d, Boxes, History } from "lucide-react";
import { imageModelRequiresRef } from "../../../lib/models";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { downloadMedia } from "@/lib/download";
import { ImageLightbox } from "../ImageLightbox";
import { MediaImage } from "../MediaImage";
import { RefImageReachabilityBadge, RefImageSwitchButton, useRefImageGuard, usePreferUpstreamRefSource, useAutoPreferUpstreamRefSource } from "../mediaReachability";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { estimateImageCost, costEstimateLabel, KIE_IMAGE_RES_COST } from "@/lib/costEstimate";
import { SyncNodesDialog } from "../SyncNodesDialog";
import { ParamControls } from "../ParamControls";
import { IMAGE_MODEL_PARAMS, resolveImageParam } from "@/lib/paramDefs";
import { NodeTextArea } from "../NodeTextInput";

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

export const ImageGenNode = memo(function ImageGenNode({ id, selected, data }: Props) {
  const handlesActive = useHoverStore((s) => s.nodeId === id) || !!selected;
  const connectState = useConnectState(id, "image_gen");
  // Use selector to avoid re-rendering on every store change (other nodes' updates)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { resolve } = useNodeDefaultModels();
  const { guard, reachable, dialog: reachabilityDialog } = useRefImageGuard();
  const expanded = Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned);
  const payload = data.payload;
  // Auto-prefer the upstream AI temporary public URL as the reference source when
  // the admin toggle is on and that URL probes alive (no-op when off / default).
  const preferUpstreamRef = usePreferUpstreamRefSource();
  useAutoPreferUpstreamRefSource({ nodeId: id, refImageUrl: payload.referenceImageUrl, enabled: preferUpstreamRef, onSwitch: (u) => updateNodeData(id, { referenceImageUrl: u }, true) });
  // Pull a connected upstream prompt (提示词 / 分镜) into this node's blank prompt —
  // image_gen advertises "← 提示词 / 分镜" as inputs but never consumed them. The
  // selector returns a primitive string, so it only re-renders when that text changes.
  const upstreamPrompt = useCanvasStore((s) => detectUpstreamPrompt(id, s.edges, s.nodes).positive);
  const upstreamNeg = useCanvasStore((s) => detectUpstreamPrompt(id, s.edges, s.nodes).negative);
  useEffect(() => {
    const patch: Record<string, string> = {};
    if (upstreamPrompt && !payload.prompt?.trim()) patch.prompt = upstreamPrompt;
    if (upstreamNeg && !payload.negativePrompt?.trim()) patch.negativePrompt = upstreamNeg;
    if (Object.keys(patch).length) updateNodeData(id, patch, true); // fill-only-when-blank
  }, [upstreamPrompt, upstreamNeg, payload.prompt, payload.negativePrompt, id, updateNodeData]);
  const [uploading, setUploading] = useState(false);
  const [showSyncDlg, setShowSyncDlg] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [refZoom, setRefZoom] = useState<number | null>(null);
  // 3D 换视角：打开 Depth3DViewer 的源图；pendingGen3d = 截图已插为参考图、等 re-render 后触发生成。
  const [view3dSrc, setView3dSrc] = useState<string | null>(null);
  // B 档「真3D」：把选中图交 Poyo Tripo3D 图生 .glb 网格，完整 360° 环绕后截图重绘。复用 pendingGen3d。
  const [model3dSrc, setModel3dSrc] = useState<string | null>(null);
  const [pendingGen3d, setPendingGen3d] = useState(false);
  // 图生 3D 是付费操作（Tripo3D 图生 30–60 credits、耗时 1–3 分钟），开窗前先确认费用。
  const openTrue3d = useCallback(async (url: string) => {
    if (!url) return;
    const ok = await confirmDialog({
      title: "生成真 3D 模型？",
      message: "将调用 Tripo3D 把这张图生成为可 360° 环绕的 3D 网格。约消耗 30–60 credits，通常需 1–3 分钟。",
      confirmLabel: "生成",
    });
    if (ok) setModel3dSrc(url);
  }, []);
  // Multi-reference-image list + left-docked expandable strip.
  const refImages = useReferenceImages(id, payload);
  // 上游图像（图像生成 / ComfyUI 图像·自定义 / 素材 / 分镜）自动作为参考图填充——
  // 仅当本节点尚无任何参考图时（fill-only-when-blank），绝不覆盖手动参考图，也不改变
  // 「无参考图时用连线角色」的既有优先级（角色不在图源类型里，单独走 connectedCharacterRefImages）。
  const upstreamRefKey = useCanvasStore((s) => detectUpstreamImagesExpanded(id, s.edges, s.nodes).join("\n"));
  // 有连线「角色」上游时，保留既有「无参考图→用连线角色」的优先级，不自动填上游图（避免破坏）。
  const hasUpstreamChar = useCanvasStore((s) => s.edges.some((e) => e.target === id && s.nodes.find((n) => n.id === e.source)?.data.nodeType === "character"));
  useEffect(() => {
    if (hasUpstreamChar) return;
    const list = upstreamRefKey ? upstreamRefKey.split("\n").filter(Boolean) : [];
    if (list.length === 0) return;
    const hasRefs = (payload.referenceImages?.length ?? 0) > 0 || !!payload.referenceImageUrl?.trim();
    if (hasRefs) return;
    refImages.addUrls(list, "upstream");
    // refImages 每渲染重建，但 hasRefs 守卫 + addUrls 去重使其幂等
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamRefKey, hasUpstreamChar, payload.referenceImages, payload.referenceImageUrl]);
  // 「最终提示词」= 真正会送去生成的正向词：本地/上游已自动填入 payload.prompt，
  // 这里再叠加「@角色 / 连线角色」结构化注入与 post_process 效果词，和 handleGenerate 同源。
  const finalPromptDisplay = useCanvasStore((s) => {
    const base = payload.prompt ?? "";
    const chars = effectiveCharacters(id, base, s.edges, s.nodes);
    return appendEffectPrompts(
      mergeCharactersIntoPrompt(stripMediaMentions(stripCharacterMentions(base, s.nodes), s.nodes), chars),
      connectedEffectPrompts(id, s.edges, s.nodes),
    );
  });
  const hasCharInject = useCanvasStore((s) => effectiveCharacters(id, payload.prompt ?? "", s.edges, s.nodes).length > 0);
  // 左侧吸附窗 = 自有参考图（可编辑）+ 最终参与的角色/场景图（@提及或连线，只读），各带类型标签。
  const charSceneItems = useCharSceneItems(id, payload.prompt ?? "");
  const stripImages: StripItem[] = [
    ...refImages.images.map((img) => ({ ...img, label: "参考图", removable: true })),
    ...charSceneItems,
  ];
  const docks = useNodeDocks(id, { hasRef: stripImages.length > 0, hasPrompt: !!finalPromptDisplay.trim() }, { prompt: finalPromptDisplay, ref: stripImages.map((i) => i.id).join(",") });
  const { refOpen: stripOpen, setRefOpen: setStripOpen } = docks;
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
      .flatMap<{ id: string; payload: Partial<NodeData> }>(edge => {
        const target = allNodes.find(n => n.id === edge.target);
        if (!target) return [];
        const nt = target.data.nodeType;
        if (nt !== "storyboard" && nt !== "image_gen" && nt !== "video_task") return [];
        // video_task 的种子存在 payload.params.seed（ParamDef），不是顶层 payload.seed——
        // 顶层写入视频节点永远读不到（曾致「传播成功」但实际未生效）。按目标类型写对字段，
        // 并保留该节点其余 params。
        if (nt === "video_task") {
          const params = ((target.data.payload as { params?: Record<string, unknown> }).params) ?? {};
          if (params.seed === payload.seed) return [];
          return [{ id: edge.target, payload: { params: { ...params, seed: payload.seed } } }];
        }
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

  // 批量「运行全部」进行中：runner 用它自己的 mutation 实例跑本节点，本节点 genMutation.isPending
  // 却为 false，导致手动「运行」可对同一节点再发一次 → 双扣费/占卡。批量运行中禁用手动运行。
  const batchRunning = useWorkflowRunState().running;

  const handleGenerate = () => {
    if (genMutation.isPending) return;
    if (batchRunning) { toast.error("批量运行进行中，请等待完成后再单独运行"); return; }
    if (uploading) { toast.error("参考图正在上传中，请稍候"); return; }
    if (!payload.prompt?.trim()) { toast.error("请先填写提示词"); return; }
    // 组装逻辑抽到纯函数 buildImageGenInput（与「运行全部」runner 同一事实源，防两侧漂移）。
    const { edges: gedges, nodes: gnodes } = useCanvasStore.getState();
    const built = buildImageGenInput({
      id, payload, nodes: gnodes, edges: gedges,
      defaultModel: resolve("image_gen", "image"),
      kieTempKey: localStorage.getItem("kie:tempKey"),
    });
    if (built.blocked) { toast.error(built.blocked); return; }
    const submit = () => genMutation.mutate({
      ...(built.input as Parameters<typeof genMutation.mutate>[0]),
      projectId: data.projectId,
    });
    guard({ model: payload.model ?? resolve("image_gen", "image"), refImageUrl: built.refUrl }, submit);
  };

  // 3D 换视角截图已插为首位参考图后，等 payload.referenceImages re-render 反映到位再触发生成，
  // 避免同 tick 调 handleGenerate 读到旧 payload（buildImageGenInput 读 prop）。
  useEffect(() => {
    if (!pendingGen3d) return;
    if (uploading || genMutation.isPending) return;
    setPendingGen3d(false);
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGen3d, uploading, payload.referenceImages, payload.referenceImageUrl]);

  // #5 版本历史：每产出一张新图就记进 resultHistory（回滚到旧快照时 url 已存在 → pushResultSnapshot
  // 返回同引用，据引用相等跳过写入，防更新环）。silent=true：不进撤销栈、不广播（本地便利态）。
  useEffect(() => {
    const url = payload.imageUrl;
    if (!url) return;
    const next = pushResultSnapshot(payload.resultHistory, { url, urls: payload.imageUrls, prompt: payload.prompt, at: Date.now() });
    if (next !== payload.resultHistory) updateNodeData(id, { resultHistory: next }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.imageUrl]);
  // 回滚：把某条快照写回当前结果（进撤销栈，便于再撤销回来）。
  const rollbackToSnapshot = useCallback((snap: ResultSnapshot) => {
    updateNodeData(id, { imageUrl: snap.url, imageUrls: snap.urls ?? [snap.url] });
  }, [id, updateNodeData]);

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

  // 实时点数预估：单价 × 张数（Soul 批量 / Flux 多图 / Poyo imageN），模型或数量一变即重算。
  const genCount = (() => {
    const poyoN = (payload as unknown as { imageN?: number }).imageN ?? 1;
    if (isSoul && (payload.batchSize ?? 1) > 1) return payload.batchSize ?? 1;
    if (isFluxPro && (payload.fluxNumImages ?? 1) > 1) return payload.fluxNumImages ?? 1;
    return poyoN > 1 ? poyoN : 1;
  })();
  const genCostLabel = costEstimateLabel(estimateImageCost(payload.model || resolve("image_gen", "image"), genCount, { resolution: payload.imageResolution }));

  // Collapse the params panel when switching model — old expansion state doesn't apply to a new param set
  useEffect(() => {
    setParamsExpanded(false);
  }, [payload.model]);

  // 绿点指示：结果图是否已落到我方 MinIO 长期存储（/manus-storage/ 路径）。
  const imgStoredInMinio = isOwnStorageUrl(payload.imageUrl);

  // 收缩态 hero 兜底：尚无生成结果、但已有参考图时，用参考图作为预览。
  // 否则工作室收缩后（无 inline body）整个节点只剩标题栏，参考图根本看不见。
  const heroRefUrl = refImages.images[0]?.url ?? payload.referenceImageUrl ?? payload.referenceImages?.[0];

  // Collapsed hero: a multi-image batch shows the whole grid by default
  // ("grid"); "single" falls back to just the selected image.
  const heroShowGrid = hasMultiple && payload.heroView !== "single";
  const heroMedia = heroShowGrid ? (
    <div
      className="grid gap-1 p-2"
      style={{ gridTemplateColumns: payload.imageUrls!.length === 4 ? "1fr 1fr" : `repeat(${Math.min(payload.imageUrls!.length, 3)}, 1fr)` }}
    >
      {payload.imageUrls!.map((url, idx) => {
        const isSelected = url === payload.imageUrl;
        return (
          <div key={idx} className="relative rounded-lg overflow-hidden" style={{ background: "var(--c-canvas)" }}>
            <MediaImage
              src={url}
              alt={`generated-${idx}`}
              className="w-full"
              draggable={false}
            />
            {isOwnStorageUrl(url) && (
              <div
                title="已存储到 MinIO·长期有效"
                className="absolute top-1 left-1 rounded-full pointer-events-none"
                style={{ width: 9, height: 9, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2px oklch(0.72 0.18 155 / 0.35)" }}
              />
            )}
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
      <MediaImage
        src={payload.imageUrl}
        alt="generated"
        className="w-full"
        draggable={false}
        style={{ display: "block" }}
      />
      {imgStoredInMinio && (
        <div
          title="已存储到 MinIO·长期有效"
          className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
          style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
        />
      )}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
        style={{ background: "oklch(0 0 0 / 0.45)" }}
      >
        <button
          onClick={() => setLightboxIndex(0)}
          className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)" }}
        >
          <ZoomIn className="w-3 h-3" />
          放大
        </button>
        <button
          onClick={() => setView3dSrc(payload.imageUrl!)}
          title="把这张图虚拟化为 3D，拖拽换视角后重绘"
          className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)" }}
        >
          <Rotate3d className="w-3 h-3" />
          3D 换视角
        </button>
        <button
          onClick={() => openTrue3d(payload.imageUrl!)}
          title="图生真 3D 网格（Tripo3D），完整 360° 环绕后从新视角重绘"
          className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)" }}
        >
          <Boxes className="w-3 h-3" />
          真3D
        </button>
      </div>
    </div>
  ) : heroRefUrl ? (
    // 无结果但有参考图 → 收缩时把参考图当 hero 预览（避免只剩标题栏、参考图看不见）。
    <RefHeroPreview url={heroRefUrl} />
  ) : null;

  return (
    <BaseNode id={id} selected={selected} nodeType="image_gen" title={data.title} minHeight={300} heroMedia={heroMedia}
      onRun={handleGenerate} running={genMutation.isPending} canRun={!!payload.prompt?.trim()} hasResult={!!payload.imageUrl}
      onAssetImageDrop={(urls) => refImages.addUrls(urls, "drop")}
      onHeaderHoverChange={docks.onHeaderHoverChange}
      extraHandles={
        <Handle
          type="source"
          position={Position.Right}
          id="image-out"
          style={{ ...handleStyle(accent, handlesActive, "circle", connectState.source), top: "75%", right: -7 }}
          title="图像输出 → 连接到视频任务参考图"
        />
      }
      leftDock={
        <>
          <ReferenceImageStrip
            images={stripImages}
            open={stripOpen}
            accent={accent}
            onClose={() => setStripOpen(false)}
            onRemove={refImages.removeId}
            onMove={refImages.moveId}
            onInsertUrls={(urls, index) => refImages.insertUrls(urls, index, "drop")}
            onDropFiles={(files, index) => void uploadFilesToRef(files, index)}
            onZoom={(i) => { const u = stripImages[i]?.url; if (u) openNodeImage(u); }}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinRef}
          />
          <PromptDock
            open={docks.promptOpen}
            text={finalPromptDisplay}
            negText={payload.negativePrompt}
            source={hasCharInject ? "含角色" : undefined}
            accent={accent}
            onClose={() => docks.setPromptOpen(false)}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinPrompt}
          />
        </>
      }>
      <div className="flex flex-col h-full p-3.5 gap-3 overflow-auto">

        {/* #5 版本历史：历次产出的结果快照，点击回滚（当前项高亮）。≥2 条才显示。 */}
        {(payload.resultHistory?.length ?? 0) >= 2 && (
          <div className="flex-shrink-0">
            <div style={{ fontSize: 10, color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
              <History style={{ width: 10, height: 10 }} /> 版本历史 · 点击回滚（{payload.resultHistory!.length}）
            </div>
            <div className="nowheel" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
              {payload.resultHistory!.map((snap, i) => {
                const isCurrent = snap.url === payload.imageUrl;
                return (
                  <button
                    key={snap.url}
                    onClick={() => rollbackToSnapshot(snap)}
                    title={snap.prompt ? `回滚到此版本\n${snap.prompt}` : "回滚到此版本"}
                    className="nodrag relative flex-shrink-0 rounded-lg overflow-hidden"
                    style={{ width: 56, height: 56, borderWidth: 2, borderStyle: "solid", borderColor: isCurrent ? accent : BORDER_DEFAULT, cursor: "pointer", opacity: isCurrent ? 1 : 0.82, background: "var(--c-canvas)" }}
                  >
                    <MediaImage src={snap.url} alt={`v${i + 1}`} className="w-full h-full object-cover" draggable={false} />
                    <span style={{ position: "absolute", top: 2, left: 2, fontSize: 8, fontWeight: 700, lineHeight: "12px", padding: "0 4px", borderRadius: 4, background: "oklch(0 0 0 / 0.6)", color: "#fff" }}>{payload.resultHistory!.length - i}</span>
                    {isCurrent && <span style={{ position: "absolute", bottom: 2, left: 2, fontSize: 8, fontWeight: 700, lineHeight: "12px", padding: "0 4px", borderRadius: 4, background: accent, color: "#fff" }}>当前</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Batch grid result ── (hidden inside the studio floating panel — the
            node card's hero preview already shows the result there → no duplicate) */}
        <HideWhenStudioFloating>
        {hasMultiple ? (
          <div className="flex-shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: 10, color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4 }}>
                <Grid2X2 style={{ width: 10, height: 10 }} />
                {payload.imageUrls!.length} 张图像 · 点击选择
              </span>
              <div className="flex gap-1">
                {/* 折叠预览模式：网格 / 单图 */}
                <div className="flex items-center rounded overflow-hidden" style={{ border: `1px solid ${BORDER_DEFAULT}` }} title="折叠后预览：整组网格 / 仅选中图">
                  {(["grid", "single"] as const).map((mode) => {
                    const active = (payload.heroView ?? "grid") === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => update("heroView", mode)}
                        className="nodrag flex items-center gap-1 px-1.5 py-0.5"
                        style={{ fontSize: 9.5, background: active ? accent : "transparent", color: active ? "white" : "var(--c-t3)" }}
                        title={mode === "grid" ? "折叠后显示整组网格（默认）" : "折叠后只显示选中图"}
                      >
                        {mode === "grid" ? <Grid2X2 style={{ width: 10, height: 10 }} /> : <ImagePlus style={{ width: 10, height: 10 }} />}
                        {mode === "grid" ? "网格" : "单图"}
                      </button>
                    );
                  })}
                </div>
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
                  // 结果图可拖出：写 text/uri-list + text/plain，让参考图条/其它节点(读同一 MIME)直接接住。
                  // 用 div[role=button] 而非 <button>，以便在内部嵌套逐图操作按钮（button 不可嵌套 button）。
                  <div
                    key={idx}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/uri-list", url);
                      e.dataTransfer.setData("text/plain", url);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setLightboxIndex(idx)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightboxIndex(idx); } }}
                    className="nodrag relative rounded-lg overflow-hidden group"
                    style={{
                      aspectRatio: "1/1",
                      borderWidth: 2,
                      borderStyle: "solid",
                      borderColor: isSelected ? accent : "transparent",
                      background: "var(--c-canvas)",
                      padding: 0,
                      cursor: "grab",
                      transition: "border-color 150ms ease, opacity 150ms ease",
                      opacity: isSelected ? 1 : 0.72,
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.opacity = "0.72"; }}
                  >
                    <MediaImage
                      src={url}
                      alt={`generated-${idx}`}
                      className="w-full h-full object-cover"
                      draggable={false}
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
                    {/* Hover overlay：放大 / 下载此图 / 设为封面（逐图操作），拖动可拖到参考图条或其它节点 */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5"
                      style={{ background: "oklch(0 0 0 / 0.45)" }}
                    >
                      <div className="rounded-md flex items-center justify-center" title="放大预览" style={{ width: 24, height: 24, background: "oklch(0 0 0 / 0.5)" }}>
                        <ZoomIn style={{ width: 14, height: 14, color: "#fff" }} />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadImage(url); }}
                        className="nodrag rounded-md flex items-center justify-center"
                        title="下载此图" style={{ width: 24, height: 24, background: "oklch(0 0 0 / 0.5)", border: "none", cursor: "pointer" }}
                      >
                        <Download style={{ width: 13, height: 13, color: "#fff" }} />
                      </button>
                      {!isSelected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelectImage(url); }}
                          className="nodrag rounded-md flex items-center justify-center"
                          title="设为封面（选为此节点输出）" style={{ width: 24, height: 24, background: "oklch(0 0 0 / 0.5)", border: "none", cursor: "pointer" }}
                        >
                          <Check style={{ width: 14, height: 14, color: "#fff" }} />
                        </button>
                      )}
                    </div>
                  </div>
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
                <MediaImage
                  src={payload.imageUrl}
                  alt="selected"
                  className="w-full object-contain"
                  style={{ maxHeight: 120 }}
                  draggable={false}
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
              {imgStoredInMinio && (
                <div
                  title="已存储到 MinIO·长期有效"
                  className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
                  style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
                />
              )}
              <MediaImage
                src={payload.imageUrl}
                alt="generated"
                className="w-full h-full object-contain"
                draggable={false}
              />
              <div
                className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
                style={{ background: "oklch(0 0 0 / 0.55)" }}
              >
                <button
                  onClick={() => setLightboxIndex(0)}
                  className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)" }}
                >
                  <ZoomIn className="w-3 h-3" />
                  放大
                </button>
                <button
                  onClick={handleDownloadSelected}
                  className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)" }}
                >
                  <Download className="w-3 h-3" />
                  下载
                </button>
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
        </HideWhenStudioFloating>

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
            value={payload.model ?? resolve("image_gen", "image")}
            onChange={(v) => update("model", v as ImageGenModel)}
            options={IMAGE_MODEL_PICKER_OPTIONS}
          />
          {/* 编辑 / 图生图模型必须有参考图——缺图时提前提示，避免提交后才被上游退回扣费 */}
          {imageModelRequiresRef(payload.model) && stripImages.length === 0 && (
            <div style={{
              marginTop: 6, display: "flex", alignItems: "center", gap: 5, fontSize: 11,
              color: "oklch(0.62 0.20 25)", background: "oklch(0.62 0.20 25 / 0.08)",
              border: "1px solid oklch(0.62 0.20 25 / 0.28)", borderRadius: 6, padding: "4px 7px",
            }}>
              <AlertTriangle className="w-3 h-3" style={{ flexShrink: 0 }} />
              此模型为图生图 / 编辑，需先连接或上传参考图
            </div>
          )}
        </div>
        {/* 同步模型与参数到同类图像生成节点（弹窗勾选） */}
        <button
          onClick={() => setShowSyncDlg(true)}
          title="把当前模型与全部参数同步到所选图像生成节点（弹窗勾选，默认同工作流）"
          className="nodrag flex items-center justify-center gap-1 rounded-lg text-[10.5px] py-1 transition-all"
          style={{ marginTop: 6, width: "100%", background: "oklch(0.66 0.19 300 / 0.08)", border: "1px dashed oklch(0.66 0.19 300 / 0.4)", color: "oklch(0.74 0.16 300)", cursor: "pointer" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.66 0.19 300 / 0.16)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.66 0.19 300 / 0.08)"; }}
        >
          <Grid2X2 className="w-3 h-3" /> 同步模型与参数到其它图像节点
        </button>
        {showSyncDlg && (
          <SyncNodesDialog
            sourceId={id}
            nodeType="image_gen"
            typeLabel="图像生成"
            patch={{ model: payload.model, negativePrompt: payload.negativePrompt, style: payload.style, aspectRatio: payload.aspectRatio, poyoQuality: payload.poyoQuality, widthAndHeight: payload.widthAndHeight, soulQuality: payload.soulQuality, batchSize: payload.batchSize, seed: payload.seed, enhancePrompt: payload.enhancePrompt, reveAspectRatio: payload.reveAspectRatio, reveResolution: payload.reveResolution, fluxGuidanceScale: payload.fluxGuidanceScale, fluxSeed: payload.fluxSeed, fluxNumImages: payload.fluxNumImages }}
            onClose={() => setShowSyncDlg(false)}
          />
        )}

        {/* Prompt */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <NodeTextArea className="nodrag nowheel"
            placeholder="描述你想生成的图像..."
            value={payload.prompt ?? ""}
            onValueChange={(v) => update("prompt", v)}
            rows={3}

            style={{ ...fieldBase, resize: "none", lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Negative prompt */}
        <div>
          <label style={labelStyle}>反向提示词</label>
          <NodeTextArea className="nodrag nowheel"
            placeholder="blurry, low quality..."
            value={payload.negativePrompt ?? ""}
            onValueChange={(v) => update("negativePrompt", v)}
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
              {/* kie 分辨率档（如 GPT Image 2 1K/2K/4K = 6/10/16 点，逐档计价） */}
              {payload.model && KIE_IMAGE_RES_COST[payload.model] && (
                <div style={{ width: 72 }}>
                  <label style={labelStyle} title={Object.entries(KIE_IMAGE_RES_COST[payload.model]).map(([k, v]) => `${k}=${v}点`).join(" / ")}>分辨率</label>
                  <select
                    value={payload.imageResolution ?? Object.keys(KIE_IMAGE_RES_COST[payload.model])[0]}
                    onChange={(e) => update("imageResolution", e.target.value)}
                    className="nodrag"
                    style={{ ...fieldBase, cursor: "pointer" }}
                  >
                    {Object.keys(KIE_IMAGE_RES_COST[payload.model]).map((r) => <option key={r} value={r}>{r}</option>)}
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
          </label>

          {/* Horizontal thumbnails (numbered) */}
          {refImages.images.length > 0 && (
            <div className="nowheel" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
              {refImages.images.map((img, i) => (
                <div key={img.id} className="group relative rounded-lg overflow-hidden flex-shrink-0" style={{ width: 72, height: 72, borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}>
                  <MediaImage
                    src={img.url}
                    alt={`ref-${i + 1}`}
                    className="nodrag w-full h-full object-cover"
                    style={{ cursor: "zoom-in" }}
                    draggable={false}
                    title="点击放大"
                    onClick={() => setRefZoom(i)}
                  />
                  <span style={{ position: "absolute", left: 3, top: 3, minWidth: 15, height: 15, paddingInline: 3, borderRadius: 8, fontSize: 9, fontWeight: 700, lineHeight: "15px", textAlign: "center", background: accent, color: "white" }}>{i + 1}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); refImages.removeId(img.id); }}
                    className="nodrag absolute top-1 right-1 p-0.5 rounded-full"
                    style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                  >
                    <X style={{ width: 11, height: 11 }} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setView3dSrc(img.url); }}
                    title="把这张参考图虚拟化为伪 3D（深度位移），拖拽换视角后重绘"
                    className="nodrag absolute bottom-1 right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                  >
                    <Rotate3d style={{ width: 12, height: 12 }} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void openTrue3d(img.url); }}
                    title="图生真 3D 网格（Tripo3D），完整 360° 环绕后从新视角重绘"
                    className="nodrag absolute bottom-1 left-1 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                  >
                    <Boxes style={{ width: 12, height: 12 }} />
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
          disabled={genMutation.isPending || batchRunning || !payload.prompt?.trim()}
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
          {genCostLabel && !genMutation.isPending && (
            <span
              title="按当前模型与参数实时预估的点数消耗，仅供参考，实际以平台账单为准"
              style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "oklch(0.72 0.20 330 / 0.15)", letterSpacing: "0.02em" }}
            >
              {genCostLabel}
            </span>
          )}
        </button>

        </div>{/* end input collapse wrapper */}
      </div>

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

      {/* 3D 换视角：把选中图深度位移为伪 3D，拖拽换视角截图 → 插为首位参考图 → 触发再生成。 */}
      {view3dSrc && (
        <Depth3DViewer
          sourceImageUrl={view3dSrc}
          onClose={() => setView3dSrc(null)}
          onGenerate={(capturedUrl) => {
            refImages.insertUrls([capturedUrl], 0, "upload"); // 作首位结构参考图，且在参考图条可见
            setPendingGen3d(true); // 等 payload 反映后由 effect 触发生成
          }}
        />
      )}

      {/* B 档 真3D：图生 .glb 网格 → 完整 360° 环绕 → 截图插为首位参考图 → 触发再生成。 */}
      {model3dSrc && (
        <Model3DViewer
          sourceImageUrl={model3dSrc}
          onClose={() => setModel3dSrc(null)}
          onGenerate={(capturedUrl) => {
            refImages.insertUrls([capturedUrl], 0, "upload");
            setPendingGen3d(true);
          }}
        />
      )}

      {reachabilityDialog}
    </BaseNode>
  );
});
