import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TRPCClientError } from "@trpc/client";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { useShallow } from "zustand/react/shallow";
import type { StoryboardNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Loader2, RefreshCw, Upload, X, Wand2, History, Languages, Film, ZoomIn, Download, Copy, HardDriveDownload } from "lucide-react";
import { useLocalMedia } from "@/lib/useLocalMedia";
import { cacheMedia } from "@/lib/mediaCache";
import { mergeCharactersIntoPrompt } from "../../../lib/characterPrompt";
import { IMAGE_MODELS } from "@/lib/models";
import { makeImageProxyFallback } from "@/lib/utils";
import { RefImageReachabilityBadge, RefImageSwitchButton, useRefImageGuard } from "../mediaReachability";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { ParamControls } from "../ParamControls";
import { IMAGE_MODEL_PARAMS, resolveImageParam } from "@/lib/paramDefs";
import type { ImageGenModel } from "../../../../../shared/types";
import { useCanvasMode } from "../../../contexts/CanvasModeContext";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "storyboard";
    title: string;
    payload: StoryboardNodeData;
    projectId: number;
  };
}

const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_FOCUS   = "oklch(0.65 0.20 160 / 0.6)";

function formatAIError(err: unknown): string {
  if (err instanceof TRPCClientError) {
    if (err.data?.zodError) return "输入内容不符合要求，请检查字段长度";
    if (err.data?.httpStatus === 500) return "服务器处理失败，请稍后重试";
    if (err.message?.toLowerCase().includes("fetch") || err.message?.toLowerCase().includes("network")) return "网络连接失败，请检查网络后重试";
    return err.message ?? "请求失败，请重试";
  }
  return "未知错误，请重试";
}

const fieldStyle: React.CSSProperties = {
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
  transition: "border-color 150ms ease, background 150ms ease",
  lineHeight: 1.5,
};

const onFocus = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_FOCUS; };
const onBlur  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

export const StoryboardNode = memo(function StoryboardNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  // Detect connected CharacterNodes that have their own referenceImageUrl
  const connectedCharRefUrl = useCanvasStore((s) => {
    const incomingEdges = s.edges.filter((e) => e.target === id);
    for (const edge of incomingEdges) {
      const srcNode = s.nodes.find((n) => n.id === edge.source);
      if (srcNode?.data.nodeType !== "character") continue;
      const cp = srcNode.data.payload as import("../../../../../shared/types").CharacterNodeData;
      if (cp.referenceImageUrl) return cp.referenceImageUrl;
    }
    return undefined;
  });
  const connectedCharWithRef = Boolean(connectedCharRefUrl);

  // Outgoing edges → connected video_task node IDs (for prompt push button)
  // useShallow prevents infinite Zustand re-subscription when the returned array has
  // the same elements but a different reference (React error #185).
  const connectedVideoNodeIds = useCanvasStore(
    useShallow((s) => {
      const outgoingEdges = s.edges.filter((e) => e.source === id);
      return outgoingEdges
        .map((edge) => s.nodes.find((n) => n.id === edge.target
          && (n.data.nodeType === "video_task" || n.data.nodeType === "comfyui_video")))
        .filter(Boolean)
        .map((n) => n!.id as string);
    }),
  );
  const { mode: canvasMode } = useCanvasMode();
  const isCreative = canvasMode === "creative";
  const payload = data.payload;
  // Effective reference the next generation will use (local overrides character)
  const effectiveRefUrl = payload.referenceImageUrl?.trim() || connectedCharRefUrl;
  const [generating, setGenerating] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(!!selected);
  const [llmModel, setLlmModel] = useState<LLMModelId>("gemini-2.5-flash");
  const [showHistory, setShowHistory] = useState(false);
  const [batchCount, setBatchCount] = useState<1 | 4>(([1, 4].includes(payload.batchSize as number) ? payload.batchSize : 1) as 1 | 4);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  // Close lightbox on Escape
  useEffect(() => {
    if (!zoomUrl) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setZoomUrl(null); } };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [zoomUrl]);

  // Sync batchCount when payload.batchSize changes externally (collab / undo-redo)
  useEffect(() => {
    if ([1, 4].includes(payload.batchSize as number)) {
      setBatchCount(payload.batchSize as 1 | 4);
    }
  }, [payload.batchSize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setInputExpanded(!!selected);
  }, [selected]);
  const model: ImageGenModel = IMAGE_MODELS.some(m => m.value === payload.imageModel)
    ? (payload.imageModel as ImageGenModel)
    : "manus_forge";
  const setModel = (m: string) => { updateNodeData(id, { imageModel: m as ImageGenModel }); };
  const { guard, reachable, dialog: reachabilityDialog } = useRefImageGuard();

  // ── Per-model sizing controls ──
  // Mirror the option lists used by ImageGenNode so a scene can be tuned
  // independently without forcing the user to round-trip via ImageGenNode.
  const isSoul = model === "hf_soul_standard";
  const isV2HF = model === "hf_reve" || model === "hf_seedream_v4" || model === "hf_flux_pro";
  const SOUL_SIZES_LIST = [
    "2048x1152", "2048x1536", "2016x1344", "1696x960", "1632x1088",
    "1152x2048", "1536x2048", "1344x2016", "960x1696", "1088x1632",
    "1536x1536", "1536x1152", "1152x1536",
  ] as const;
  const V2_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
  const V2_RESOLUTIONS = ["1K", "2K", "4K"] as const;

  // Sync key shared settings (model / color tone / batch / negative prompt)
  // from this storyboard to ALL other storyboard nodes on the canvas.
  // Helps users keep a consistent style across an entire sequence without
  // hand-editing every scene.
  const syncToAllStoryboards = useCallback(() => {
    const { nodes: allNodes, batchUpdateNodeData } = useCanvasStore.getState();
    const targets = allNodes.filter(
      (n) => n.data.nodeType === "storyboard" && n.id !== id,
    );
    if (targets.length === 0) {
      toast.info("当前画布只有这一个分镜节点");
      return;
    }
    const patch: Partial<StoryboardNodeData> = {
      imageModel: payload.imageModel,
      colorTone: payload.colorTone,
      batchSize: payload.batchSize,
      negativePrompt: payload.negativePrompt,
      cameraMovement: payload.cameraMovement,
      lens: payload.lens,
    };
    batchUpdateNodeData(targets.map((t) => ({ id: t.id, payload: patch })));
    toast.success(`已同步设置到 ${targets.length} 个分镜节点`);
  }, [id, payload.imageModel, payload.colorTone, payload.batchSize, payload.negativePrompt, payload.cameraMovement, payload.lens]);

  const [uploadingRef, setUploadingRef] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  const uploadRefMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { referenceImageUrl: result.url });
      setUploadingRef(false);
      toast.success("参考图已上传");
    },
    onError: (err) => {
      setUploadingRef(false);
      toast.error("参考图上传失败：" + err.message);
    },
  });

  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16MB"); return; }
    setUploadingRef(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadRefMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.onerror = () => { setUploadingRef(false); toast.error("文件读取失败"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const genImageMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      // Guard: node may have been deleted while generation was in flight
      if (!useCanvasStore.getState().nodes.some(n => n.id === id)) return;
      const newUrls = (result.urls?.length ? result.urls : result.url ? [result.url] : []).filter(Boolean) as string[];
      if (!newUrls.length) { setGenerating(false); toast.error("生成完成但未返回图像"); return; }
      const imageUrl = newUrls[0];
      const currentHistory = (useCanvasStore.getState().nodes.find(n => n.id === id)?.data.payload as StoryboardNodeData)?.imageHistory ?? [];
      const newHistory = [...newUrls, ...currentHistory].filter((u): u is string => !!u).slice(0, 12);
      updateNodeData(id, {
        imageUrl, imageHistory: newHistory,
        imageUrlSource: result.sourceUrl ?? result.sourceUrls?.[0],
        imageUrlSourceAt: result.sourceAt,
      });
      // Push the freshly generated image to any already-connected video node so
      // "connect first, generate later" still auto-fills the reference image.
      propagateRefImage(id, imageUrl);
      setGenerating(false);
      if (newUrls.length > 1) setShowHistory(true);
      toast.success(newUrls.length > 1 ? `已生成 ${newUrls.length} 张，可在历史中切换` : "分镜图像已生成");
    },
    onError: (err) => {
      setGenerating(false);
      toast.error("图像生成失败：" + err.message);
    },
  });

  // AI prompt expansion
  const [expandingPrompt, setExpandingPrompt] = useState(false);
  const aiExpandMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { promptText: result.result });
      setExpandingPrompt(false);
      toast.success("提示词已扩写");
    },
    onError: (err) => {
      setExpandingPrompt(false);
      toast.error("AI 扩写失败：" + formatAIError(err));
    },
  });

  const [expandingDesc, setExpandingDesc] = useState(false);
  const aiExpandDescMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { description: result.result });
      setExpandingDesc(false);
      toast.success("场景描述已扩写");
    },
    onError: (err) => {
      setExpandingDesc(false);
      toast.error("AI 扩写失败：" + formatAIError(err));
    },
  });

  const [translating, setTranslating] = useState(false);
  const aiTranslateMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { promptText: result.result });
      setTranslating(false);
      toast.success("已翻译为英文提示词");
    },
    onError: (err) => {
      setTranslating(false);
      toast.error("翻译失败：" + formatAIError(err));
    },
  });

  const handleExpandPrompt = useCallback(() => {
    if (aiExpandMutation.isPending || expandingPrompt) return;
    if (!payload.description?.trim()) { toast.error("请先填写场景描述"); return; }
    setExpandingPrompt(true);
    aiExpandMutation.mutate({ text: payload.description.slice(0, 8000), mode: "storyboard_prompt", model: llmModel });
  }, [payload.description, aiExpandMutation, expandingPrompt, llmModel]);

  const handleChange = useCallback(
    (field: keyof StoryboardNodeData, value: string | number | undefined) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  useEffect(() => {
    if (payload.duration === undefined) {
      updateNodeData(id, { duration: 5 });
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = () => {
    // Double guard — local state is async (could be stale on rapid double-click) so
    // also check the mutation's own isPending which tRPC flips synchronously
    if (generating || genImageMutation.isPending) return;
    if (!payload.promptText?.trim()) { toast.error("请先填写提示词"); return; }

    // Character consistency: inject reference image + FULL character profile
    // from connected CharacterNodes. Previously only appearance / sceneDescription
    // were used; mergeCharactersIntoPrompt now renders the whole profile
    // (name / role / outfit / signature / atmosphere / …) via the same
    // template engine used by VideoTaskNode + PromptNode, so all three node
    // types produce consistent injected prompts from a shared CharacterNode.
    const { nodes: allNodes, edges: allEdges } = useCanvasStore.getState();
    const incomingEdges = allEdges.filter((e) => e.target === id);
    let charRefUrl: string | undefined = payload.referenceImageUrl;
    const connectedCharacters: import("../../../../../shared/types").CharacterNodeData[] = [];
    for (const edge of incomingEdges) {
      const srcNode = allNodes.find((n) => n.id === edge.source);
      if (srcNode?.data.nodeType === "character") {
        const cp = srcNode.data.payload as import("../../../../../shared/types").CharacterNodeData;
        if (cp.referenceImageUrl && !charRefUrl) charRefUrl = cp.referenceImageUrl;
        connectedCharacters.push(cp);
      }
    }
    const rawPrompt = mergeCharactersIntoPrompt(payload.promptText, connectedCharacters);
    const enhancedPrompt = Array.from(rawPrompt).length > 2000
      ? Array.from(rawPrompt).slice(0, 2000).join("")
      : rawPrompt;

    // Per-model sizing: pass only the fields the chosen model actually
    // consumes. The imageGen.generate tRPC procedure validates each field
    // against its own zod enum; mismatched-model fields are dropped server-
    // side, but staying clean here keeps the request small and obvious.
    // 通用尺寸字段尚未写入 StoryboardNodeData 类型（由后端 Zod 接收）；宽松视图读取。
    const generic = payload as unknown as {
      imageSize?: string; imageResolution?: string; imageN?: number;
      imageOutputFormat?: string; poyoAspectRatio?: string;
    };
    const sizingFields: Record<string, unknown> = {};
    if (isSoul) {
      if (SOUL_SIZES_LIST.includes(payload.widthAndHeight as (typeof SOUL_SIZES_LIST)[number])) {
        sizingFields.widthAndHeight = payload.widthAndHeight;
      }
      if (payload.soulQuality) sizingFields.quality = payload.soulQuality;
    } else if (isV2HF) {
      if (V2_ASPECT_RATIOS.includes(payload.reveAspectRatio as (typeof V2_ASPECT_RATIOS)[number])) {
        sizingFields.reveAspectRatio = payload.reveAspectRatio;
      }
      if (V2_RESOLUTIONS.includes(payload.reveResolution as (typeof V2_RESOLUTIONS)[number])) {
        sizingFields.reveResolution = payload.reveResolution;
      }
    } else if (model.startsWith("poyo_")) {
      // 对任意 poyo_ 模型转发通用参数字段（与 ImageGenNode 一致）。
      // resolveImageParam: 控件只展示默认值不落库，提交时补上 ParamDef 默认，
      // 避免未展开节点漏发必填字段（如 z-image 文生图 size 必填）。
      sizingFields.imageSize = resolveImageParam(model, "imageSize", generic.imageSize);
      sizingFields.imageResolution = resolveImageParam(model, "imageResolution", generic.imageResolution);
      sizingFields.imageN = resolveImageParam(model, "imageN", generic.imageN);
      sizingFields.imageOutputFormat = resolveImageParam(model, "imageOutputFormat", generic.imageOutputFormat);
      sizingFields.poyoQuality = resolveImageParam(model, "poyoQuality", payload.poyoQuality);
      // 兼容旧节点：旧 payload 用 poyoAspectRatio，后端 size 取 imageSize ?? poyoAspectRatio
      sizingFields.poyoAspectRatio = generic.poyoAspectRatio;
    }
    const submit = () => {
      setGenerating(true);
      genImageMutation.mutate({
        prompt: enhancedPrompt,
        negativePrompt: payload.negativePrompt,
        style: payload.colorTone,
        referenceImageUrl: charRefUrl,
        model,
        batchSize: model === "hf_soul_standard" && batchCount > 1 ? batchCount : undefined,
        ...sizingFields,
      });
    };
    guard({ model, refImageUrl: charRefUrl }, submit);
  };

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

  const heroMedia = (() => {
    if (payload.imageUrl) {
      return (
        <img
          src={imgBlobUrl ?? payload.imageUrl}
          style={{ width: "100%", objectFit: "cover", display: "block" }}
          draggable={false}
          onError={makeImageProxyFallback(payload.imageUrl)}
          alt="分镜"
        />
      );
    }
    if (payload.description?.trim()) {
      return (
        <div
          className="node-hero-placeholder"
          style={{
            minHeight: 100,
            padding: "14px 16px",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            background: "var(--c-input)",
          }}
        >
          <p style={{ fontSize: 12, color: "var(--c-t2)", lineHeight: 1.6, margin: 0 }}>
            {(() => {
              const chars = Array.from(payload.description);
              return chars.length > 120 ? chars.slice(0, 120).join("") + "…" : payload.description;
            })()}
          </p>
        </div>
      );
    }
    return null;
  })();

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="storyboard" title={data.title} minHeight={280} heroMedia={heroMedia}>
      <div className="flex flex-col h-full p-3.5 gap-3">

        {/* ── Image preview — hidden in creative mode (image shown in heroMedia instead) ── */}
        {!(isCreative && payload.imageUrl) && (<div
          className="relative rounded-lg overflow-hidden flex-shrink-0"
          style={{
            height: 150,
            background: "var(--c-input)",
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: BORDER_DEFAULT,
          }}
        >
          {payload.imageUrl ? (
            <>
              {imgIsLocal && (
                <div
                  title={`已缓存到本地（${new Date(imgDownloadedAt).toLocaleString("zh-CN")}）`}
                  className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
                  style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
                />
              )}
              <img
                src={imgBlobUrl ?? payload.imageUrl}
                alt="分镜"
                className="w-full h-full object-cover"
                draggable={false}
                onError={makeImageProxyFallback(payload.imageUrl ?? "")}
              />
              <div
                className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1"
                style={{ background: "oklch(0 0 0 / 0.55)" }}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: "oklch(0.65 0.20 160 / 0.20)",
                      borderWidth: 1, borderStyle: "solid",
                      borderColor: "oklch(0.65 0.20 160 / 0.5)",
                      color: "oklch(0.75 0.18 160)",
                    }}
                  >
                    {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {generating ? "生成中..." : "重新生成"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setZoomUrl(payload.imageUrl || null); }}
                    className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: "oklch(0.68 0.18 220 / 0.20)",
                      borderWidth: 1, borderStyle: "solid",
                      borderColor: "oklch(0.68 0.18 220 / 0.5)",
                      color: "oklch(0.75 0.15 220)",
                    }}
                  >
                    <ZoomIn className="w-3 h-3" />
                  </button>
                  {!imgIsLocal && (
                    <button
                      onClick={handleImgCache}
                      disabled={imgCaching}
                      className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background: "oklch(0.62 0.16 200 / 0.20)",
                        borderWidth: 1, borderStyle: "solid",
                        borderColor: "oklch(0.62 0.16 200 / 0.5)",
                        color: "oklch(0.72 0.14 200)",
                        cursor: imgCaching ? "not-allowed" : "pointer",
                      }}
                      title={imgCaching ? `缓存中 ${imgCacheProgress}%` : "缓存到本地"}
                    >
                      {imgCaching ? <Loader2 className="w-3 h-3 animate-spin" /> : <HardDriveDownload className="w-3 h-3" />}
                    </button>
                  )}
                </div>
                {(payload.imageHistory?.length ?? 0) > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowHistory((v) => !v); }}
                    className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all mt-1"
                    style={{
                      background: "oklch(0.68 0.22 285 / 0.20)",
                      borderWidth: 1, borderStyle: "solid",
                      borderColor: "oklch(0.68 0.22 285 / 0.5)",
                      color: "oklch(0.75 0.18 285)",
                    }}
                  >
                    <History className="w-3 h-3" />
                    历史 ({payload.imageHistory?.length ?? 0})
                  </button>
                )}
              </div>
              <SceneNumberBadge
                value={payload.sceneNumber}
                onChange={(n) => updateNodeData(id, { sceneNumber: n })}
              />

            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3">
              <ImageIcon className="w-7 h-7" style={{ color: "var(--c-t4)" }} />
              <button
                onClick={handleGenerate}
                disabled={generating || !payload.promptText?.trim()}
                className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: generating || !payload.promptText?.trim()
                    ? "var(--c-surface)"
                    : "oklch(0.65 0.20 160 / 0.15)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: generating || !payload.promptText?.trim()
                    ? "var(--c-bd2)"
                    : "oklch(0.65 0.20 160 / 0.45)",
                  color: generating || !payload.promptText?.trim()
                    ? "var(--c-t4)"
                    : "oklch(0.72 0.18 160)",
                  cursor: generating || !payload.promptText?.trim() ? "not-allowed" : "pointer",
                }}
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {generating ? "生成中..." : "AI 生成分镜"}
              </button>
              {!payload.promptText?.trim() && (
                <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>请先填写提示词</p>
              )}
            </div>
          )}
        </div>)}

        {/* ── Generation history panel ── */}
        {showHistory && (payload.imageHistory?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>
                生成历史
              </span>
              <button
                onClick={() => setShowHistory(false)}
                className="nodrag"
                style={{ fontSize: 10, color: "var(--c-t4)", cursor: "pointer", background: "none", border: "none" }}
              >
                收起
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {(payload.imageHistory ?? []).map((url, i) => (
                <button
                  key={i}
                  onClick={() => { updateNodeData(id, { imageUrl: url }); setShowHistory(false); }}
                  className="nodrag flex-shrink-0 rounded overflow-hidden"
                  style={{
                    width: 60, height: 45,
                    border: url === payload.imageUrl
                      ? "1.5px solid oklch(0.65 0.20 160)"
                      : "1.5px solid var(--c-bd2)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  title={i === 0 ? "当前版本" : `版本 ${i + 1}`}
                >
                  <img
                    src={url}
                    alt={`历史 ${i + 1}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={makeImageProxyFallback(url)}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Collapsible inputs ── */}
        <div
          style={{
            overflow: "hidden",
            maxHeight: inputExpanded ? 2000 : 0,
            opacity: inputExpanded ? 1 : 0,
            transition: "max-height 250ms cubic-bezier(0.23,1,0.32,1), opacity 200ms ease",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
        {/* ── Scene meta ── */}
        <div className="flex gap-1.5">
          <input
            type="number"
            placeholder="场景#"
            value={payload.sceneNumber ?? ""}
            onChange={(e) => handleChange("sceneNumber", e.target.value === "" ? undefined : Number(e.target.value))}
            className="nodrag"
            style={{ ...fieldStyle, width: 52 }}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <input
            placeholder="运镜方式"
            value={payload.cameraMovement ?? ""}
            onChange={(e) => handleChange("cameraMovement", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        </div>
        {/* ── Duration slider ── */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
            <label style={{ fontSize: 11, color: "var(--c-t3)", marginBottom: 0 }}>时长</label>
            <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>{payload.duration ?? 5}秒</span>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={payload.duration ?? 5}
            onChange={(e) => handleChange("duration", Number(e.target.value))}
            className="nodrag w-full"
            style={{ accentColor: "oklch(0.65 0.20 160)" }}
          />
        </div>

        {/* ── Description ── */}
        <textarea
          placeholder="场景描述..."
          value={payload.description ?? ""}
          onChange={(e) => handleChange("description", e.target.value)}
          className="nodrag nowheel"
          rows={2}
          style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={expandingDesc || expandingPrompt || translating} />
          <button
            onClick={() => {
              if (expandingDesc || expandingPrompt || translating || aiExpandDescMutation.isPending) return;
              if (!payload.description?.trim()) { toast.error("请先填写场景描述"); return; }
              setExpandingDesc(true);
              aiExpandDescMutation.mutate({ text: payload.description.slice(0, 8000), mode: "expand", model: llmModel });
            }}
            disabled={expandingDesc || expandingPrompt || translating}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: (expandingDesc || expandingPrompt || translating) ? "var(--c-surface)" : "oklch(0.65 0.20 160 / 0.10)",
              border: `1px solid ${(expandingDesc || expandingPrompt || translating) ? "var(--c-bd2)" : "oklch(0.65 0.20 160 / 0.35)"}`,
              color: (expandingDesc || expandingPrompt || translating) ? "var(--c-t4)" : "oklch(0.65 0.20 160)",
              cursor: (expandingDesc || expandingPrompt || translating) ? "not-allowed" : "pointer",
            }}
          >
            {expandingDesc ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
            AI 扩写描述
          </button>
        </div>

        {/* ── Prompt ── */}
        <div className="flex flex-col gap-1">
          <textarea
            placeholder="正向提示词（用于 AI 生图）..."
            value={payload.promptText ?? ""}
            onChange={(e) => handleChange("promptText", e.target.value)}
            className="nodrag nowheel"
            rows={2}
            style={{
              ...fieldStyle,
              resize: "none",
              lineHeight: 1.6,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
            }}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
              {(payload.promptText ?? "").length} 字
            </span>
          </div>
          {connectedVideoNodeIds.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap self-start">
              <button
                onClick={() => {
                  if (!payload.promptText?.trim()) { toast.error("请先填写提示词再发送"); return; }
                  const { updateNodeData: updateStore } = useCanvasStore.getState();
                  connectedVideoNodeIds.forEach((videoNodeId) => {
                    updateStore(videoNodeId, {
                      prompt: payload.promptText,
                      // Always sync referenceImageUrl — explicitly clear it (undefined)
                      // when the storyboard has no image so stale URLs don't linger
                      referenceImageUrl: payload.imageUrl || undefined,
                    });
                  });
                  toast.success(
                    connectedVideoNodeIds.length === 1
                      ? "提示词已发送到视频节点"
                      : `提示词已发送至 ${connectedVideoNodeIds.length} 个视频节点`
                  );
                }}
                className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all"
                style={{
                  background: "oklch(0.62 0.20 25 / 0.12)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "oklch(0.62 0.20 25 / 0.35)",
                  color: "oklch(0.68 0.18 25)",
                  cursor: "pointer",
                }}
              >
                <Film className="w-3 h-3" />
                发送到视频节点
              </button>
              {/* Image-only send: pushes just the generated image as the video
                  node's reference, without requiring a prompt. */}
              <button
                disabled={!payload.imageUrl}
                title={payload.imageUrl ? "把本节点已生成的图片发送为视频节点的参考图" : "请先生成图片"}
                onClick={() => {
                  if (!payload.imageUrl) return;
                  const { updateNodeData: updateStore } = useCanvasStore.getState();
                  connectedVideoNodeIds.forEach((videoNodeId) => {
                    updateStore(videoNodeId, { referenceImageUrl: payload.imageUrl });
                  });
                  toast.success(
                    connectedVideoNodeIds.length === 1
                      ? "图片已发送到视频节点"
                      : `图片已发送至 ${connectedVideoNodeIds.length} 个视频节点`
                  );
                }}
                className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all"
                style={{
                  background: payload.imageUrl ? "oklch(0.62 0.16 260 / 0.14)" : "var(--c-surface)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: payload.imageUrl ? "oklch(0.62 0.16 260 / 0.40)" : "var(--c-bd2)",
                  color: payload.imageUrl ? "oklch(0.72 0.14 260)" : "var(--c-t4)",
                  cursor: payload.imageUrl ? "pointer" : "not-allowed",
                }}
              >
                <ImageIcon className="w-3 h-3" />
                发送图片到视频节点
              </button>
            </div>
          )}
          <button
            onClick={handleExpandPrompt}
            disabled={expandingPrompt || expandingDesc || translating || !payload.description?.trim()}
            className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all self-start"
            style={{
              background: expandingPrompt || expandingDesc || translating || !payload.description?.trim()
                ? "var(--c-surface)"
                : "oklch(0.65 0.20 160 / 0.12)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: expandingPrompt || expandingDesc || translating || !payload.description?.trim()
                ? "var(--c-bd2)"
                : "oklch(0.65 0.20 160 / 0.35)",
              color: expandingPrompt || expandingDesc || translating || !payload.description?.trim()
                ? "var(--c-t4)"
                : "oklch(0.65 0.20 160)",
              cursor: expandingPrompt || expandingDesc || translating || !payload.description?.trim() ? "not-allowed" : "pointer",
            }}
          >
            {expandingPrompt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {expandingPrompt ? "AI 扩写中..." : "AI 扩写提示词"}
          </button>
          <button
            onClick={() => {
              if (translating || expandingDesc || expandingPrompt || aiTranslateMutation.isPending) return;
              const text = payload.description?.trim() || payload.promptText?.trim();
              if (!text) { toast.error("请先填写场景描述或提示词"); return; }
              setTranslating(true);
              aiTranslateMutation.mutate({ text, mode: "translate_en", model: llmModel });
            }}
            disabled={translating || expandingDesc || expandingPrompt}
            title="将场景描述翻译为英文，结果写入提示词"
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: (translating || expandingDesc || expandingPrompt) ? "var(--c-surface)" : "oklch(0.68 0.22 300 / 0.10)",
              border: `1px solid ${(translating || expandingDesc || expandingPrompt) ? "var(--c-bd2)" : "oklch(0.68 0.22 300 / 0.35)"}`,
              color: (translating || expandingDesc || expandingPrompt) ? "var(--c-t4)" : "oklch(0.72 0.18 300)",
              cursor: (translating || expandingDesc || expandingPrompt) ? "not-allowed" : "pointer",
            }}
          >
            {translating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Languages className="w-2.5 h-2.5" />}
            翻译英文
          </button>
        </div>

        {/* ── Negative prompt ── */}
        <textarea
          placeholder="负面提示词（可选，描述不希望出现的内容）..."
          value={payload.negativePrompt ?? ""}
          onChange={(e) => handleChange("negativePrompt", e.target.value)}
          className="nodrag nowheel"
          rows={2}
          style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
          onFocus={onFocus}
          onBlur={onBlur}
        />

        {/* ── Style row ── */}
        <div className="flex gap-1.5">
          <input
            placeholder="色调/风格"
            value={payload.colorTone ?? ""}
            onChange={(e) => handleChange("colorTone", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <input
            placeholder="镜头"
            value={payload.lens ?? ""}
            onChange={(e) => handleChange("lens", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        </div>

        {/* ── Reference image upload ── */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleRefUpload}
            />
            <button
              onClick={() => refInputRef.current?.click()}
              disabled={uploadingRef}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all flex-1"
              style={{
                background: "var(--c-input)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "var(--c-bd2)",
                color: "var(--c-t3)",
                cursor: uploadingRef ? "not-allowed" : "pointer",
              }}
            >
              {uploadingRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {payload.referenceImageUrl ? "更换参考图" : "上传参考图"}
            </button>
            {payload.referenceImageUrl && (
              <button
                onClick={() => updateNodeData(id, { referenceImageUrl: undefined })}
                className="nodrag p-1 rounded transition-all"
                style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t3)" }}
                title="清除参考图"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <RefImageReachabilityBadge
              model={model}
              refImageUrl={effectiveRefUrl}
              reachable={reachable}
            />
            <RefImageSwitchButton
              nodeId={id}
              model={model}
              refImageUrl={effectiveRefUrl}
              reachable={reachable}
              onSwitch={(u) => updateNodeData(id, { referenceImageUrl: u })}
            />
          </div>
          {/* 或直接粘贴公网图片 URL */}
          <input
            type="url"
            placeholder="或粘贴公网图片 URL（https://…）"
            value={payload.referenceImageUrl?.startsWith("http") ? payload.referenceImageUrl : ""}
            onChange={(e) => updateNodeData(id, { referenceImageUrl: e.target.value.trim() || undefined })}
            className="nodrag"
            style={{ ...fieldStyle, fontSize: 10.5 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-t4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--c-bd2)"; }}
          />
          {/* Priority hint: when this node has its own referenceImageUrl, CharacterNode's ref is silently ignored */}
          {connectedCharWithRef && payload.referenceImageUrl && (
            <p style={{ fontSize: 9.5, color: "oklch(0.72 0.18 55)", lineHeight: 1.4, margin: 0 }}>
              本节点参考图优先：已连接角色节点的参考图不会用于生图
            </p>
          )}
          {/* Hint: when no local ref but CharacterNode has one, show it will be used */}
          {connectedCharWithRef && !payload.referenceImageUrl && (
            <p style={{ fontSize: 9.5, color: "var(--c-t4)", lineHeight: 1.4, margin: 0 }}>
              将使用已连接角色节点的参考图
            </p>
          )}
        </div>

        {/* ── Model selector + sync-all-storyboards ── */}
        <div className="nodrag flex items-stretch gap-1.5">
          <div className="flex-1">
            <ModelPicker
              value={model}
              onChange={(v) => setModel(v)}
              options={IMAGE_MODEL_PICKER_OPTIONS}
            />
          </div>
          <button
            onClick={syncToAllStoryboards}
            title="把当前模型 / 色调 / 抽卡次数 / 反向提示词等参数同步到画布中所有其他分镜节点"
            className="nodrag flex items-center gap-1 px-2 rounded-lg text-[10.5px] transition-all"
            style={{
              background: "oklch(0.65 0.20 160 / 0.08)",
              border: "1px dashed oklch(0.65 0.20 160 / 0.4)",
              color: "oklch(0.72 0.18 160)",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.65 0.20 160 / 0.16)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.65 0.20 160 / 0.08)"; }}
          >
            <Copy className="w-3 h-3" />
            同步到全部
          </button>
        </div>
        {/* ── Sizing controls (per-model) ── Soul / Reve-like 走既有专属控件；
            Poyo 模型改由下方 schema 驱动的 ParamControls 渲染 ── */}
        {(isSoul || isV2HF) && (
          <div className="flex gap-1.5 nodrag">
            {isSoul && (
              <>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    画布尺寸
                  </label>
                  <select
                    value={payload.widthAndHeight ?? "1536x1536"}
                    onChange={(e) => updateNodeData(id, { widthAndHeight: e.target.value })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
                  >
                    {SOUL_SIZES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ width: 90 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    画质
                  </label>
                  <select
                    value={payload.soulQuality ?? "1080p"}
                    onChange={(e) => updateNodeData(id, { soulQuality: e.target.value as "720p" | "1080p" })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
              </>
            )}
            {isV2HF && (
              <>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    宽高比
                  </label>
                  <select
                    value={payload.reveAspectRatio ?? "2:3"}
                    onChange={(e) => updateNodeData(id, { reveAspectRatio: e.target.value })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
                  >
                    {V2_ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ width: 90 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    分辨率
                  </label>
                  <select
                    value={payload.reveResolution ?? "2K"}
                    onChange={(e) => updateNodeData(id, { reveResolution: e.target.value as "1K" | "2K" | "4K" })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
                  >
                    {V2_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
        )}
        {/* Poyo 模型参数控件（schema 驱动）—— 替代原 Poyo 宽高比/画质硬编码块 */}
        {model && IMAGE_MODEL_PARAMS[model] && IMAGE_MODEL_PARAMS[model].length > 0 && (
          <div className="nodrag">
            <ParamControls
              defs={IMAGE_MODEL_PARAMS[model]}
              values={payload as unknown as Record<string, unknown>}
              onChange={(key, value) => updateNodeData(id, { [key]: value } as unknown as Partial<StoryboardNodeData>)}
            />
          </div>
        )}
        {/* ── Batch count (only effective for hf_soul_standard) ── */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
              抽卡次数
            </span>
            <div className="flex gap-1">
              {([1, 4] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => { setBatchCount(n); updateNodeData(id, { batchSize: n }); }}
                  className="nodrag"
                  style={{
                    width: 28, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
                    border: `1px solid ${batchCount === n ? "oklch(0.65 0.20 160 / 0.6)" : "var(--c-bd2)"}`,
                    background: batchCount === n ? "oklch(0.65 0.20 160 / 0.15)" : "var(--c-input)",
                    color: batchCount === n ? "oklch(0.72 0.18 160)" : "var(--c-t3)",
                    cursor: "pointer",
                    transition: "all 120ms",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {batchCount > 1 && model !== "hf_soul_standard" && (
            <p style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
              当前模型仅支持单张，请选择 Soul Standard 以启用抽卡
            </p>
          )}
        </div>

        {/* End collapsible inputs */}
        </div>

      </div>

      {reachabilityDialog}
    </BaseNode>

      {/* ── Image lightbox (portal to body — avoids React Flow event interception) ── */}
      {zoomUrl && createPortal(
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 99999,
            background: "oklch(0 0 0 / 0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setZoomUrl(null); }}
        >
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
            <img
              src={zoomUrl}
              alt="分镜大图"
              style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 8, display: "block" }}
              onError={makeImageProxyFallback(zoomUrl)}
            />
            {/* Top-right controls */}
            <div style={{ position: "absolute", top: -12, right: -12, display: "flex", gap: 8 }}>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(zoomUrl);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const blob = await res.blob();
                    const ext = blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpg"
                      : blob.type.includes("webp") ? "webp"
                      : "png";
                    const a = document.createElement("a");
                    const objectUrl = URL.createObjectURL(blob);
                    a.href = objectUrl;
                    a.download = `storyboard.${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
                  } catch (err) {
                    // Only fall back to window.open for CORS/network errors (TypeError),
                    // not for HTTP errors (403, 404) where opening a new tab is unhelpful
                    if (err instanceof TypeError && /^https?:\/\//i.test(zoomUrl)) {
                      toast.info("直接下载失败，将尝试在新标签页打开");
                      window.open(zoomUrl, "_blank");
                    } else {
                      toast.error("下载失败，图片无法访问");
                    }
                  }
                }}
                style={{
                  width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  background: "oklch(0.72 0.18 160 / 0.20)", border: "1px solid oklch(0.72 0.18 160 / 0.5)",
                  color: "oklch(0.80 0.16 160)", cursor: "pointer",
                }}
                title="下载图片"
              >
                <Download style={{ width: 14, height: 14 }} />
              </button>
              <button
                onClick={() => setZoomUrl(null)}
                style={{
                  width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  background: "oklch(0.55 0.0 0 / 0.5)", border: "1px solid rgba(255,255,255,0.15)",
                  color: "white", cursor: "pointer",
                }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
});

// Editable scene-number badge: click to edit, Enter / blur to save, Esc cancels.
// Lives separately from the BaseNode title (which carries "分镜 #N") so users
// can renumber a shot independent of the panel title — useful when re-ordering
// scenes after AI generation.
function SceneNumberBadge({
  value,
  onChange,
}: {
  value?: number | string;
  onChange: (v: number | string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");
  useEffect(() => { setDraft(value != null ? String(value) : ""); }, [value]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) { onChange(undefined); return; }
    // Preserve numeric type when input is purely digits (keeps backward
    // compatibility with templates / AI generation that emit Number values).
    // Anything else (letters, mixed, symbols) is stored as the user's string
    // verbatim — supports labels like "开场", "S1", "插曲#3".
    const asNumber = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    if (asNumber !== null && Number.isFinite(asNumber)) onChange(asNumber);
    else onChange(trimmed);
  };

  // Width grows with content so a long label like "开场镜头" doesn't get
  // clipped while still keeping the badge tight for short numbers.
  const measuredWidth = Math.max(28, Math.min(160, draft.length * 7 + 14));

  if (editing) {
    return (
      <div
        className="absolute top-2 left-2 nodrag nowheel"
        style={{
          background: "oklch(0 0 0 / 0.85)",
          backdropFilter: "blur(4px)",
          borderRadius: 4,
          display: "flex", alignItems: "center",
          padding: "1px 4px",
          gap: 2,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span style={{ color: "oklch(0.75 0.18 160)", fontSize: 10, fontWeight: 600 }}>#</span>
        <input
          autoFocus
          type="text"
          value={draft}
          maxLength={24}
          onChange={(e) => setDraft(e.target.value.slice(0, 24))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") { setDraft(value != null ? String(value) : ""); setEditing(false); }
          }}
          style={{
            width: measuredWidth,
            padding: 0,
            fontSize: 10,
            fontWeight: 600,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "oklch(0.75 0.18 160)",
            textAlign: "left",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold nodrag"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="点击编辑场景编号（任意字符，最多 24 字）"
      style={{
        background: "oklch(0 0 0 / 0.65)",
        color: "oklch(0.75 0.18 160)",
        backdropFilter: "blur(4px)",
        cursor: "pointer",
        userSelect: "none",
        maxWidth: 180,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {value != null && value !== "" ? `#${value}` : "#?"}
    </div>
  );
}
