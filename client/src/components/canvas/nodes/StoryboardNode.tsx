import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TRPCClientError } from "@trpc/client";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import type { StoryboardNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Loader2, RefreshCw, ChevronDown, Upload, X, Wand2, History, Languages, Film, ZoomIn, Download } from "lucide-react";
import { IMAGE_MODELS, type ImageModelId } from "@/lib/models";
import { makeImageProxyFallback } from "@/lib/utils";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
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
  const connectedCharWithRef = useCanvasStore((s) => {
    const incomingEdges = s.edges.filter((e) => e.target === id);
    return incomingEdges.some((edge) => {
      const srcNode = s.nodes.find((n) => n.id === edge.source);
      if (srcNode?.data.nodeType !== "character") return false;
      const cp = srcNode.data.payload as import("../../../../../shared/types").CharacterNodeData;
      return !!cp.referenceImageUrl;
    });
  });

  // Outgoing edges → connected video_task node IDs (for prompt push button)
  // useShallow prevents infinite Zustand re-subscription when the returned array has
  // the same elements but a different reference (React error #185).
  const connectedVideoNodeIds = useCanvasStore(
    useShallow((s) => {
      const outgoingEdges = s.edges.filter((e) => e.source === id);
      return outgoingEdges
        .map((edge) => s.nodes.find((n) => n.id === edge.target && n.data.nodeType === "video_task"))
        .filter(Boolean)
        .map((n) => n!.id as string);
    }),
  );
  const { mode: canvasMode } = useCanvasMode();
  const isCreative = canvasMode === "creative";
  const payload = data.payload;
  const [generating, setGenerating] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
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
  const model: ImageModelId = IMAGE_MODELS.some(m => m.value === payload.imageModel)
    ? (payload.imageModel as ImageModelId)
    : "manus_forge";
  const setModel = (m: ImageModelId) => { updateNodeData(id, { imageModel: m }); };

  const [uploadingRef, setUploadingRef] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const [modelPickerRect, setModelPickerRect] = useState<DOMRect | null>(null);

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
      updateNodeData(id, { imageUrl, imageHistory: newHistory });
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
    setGenerating(true);

    // Character consistency: inject reference image + appearance from connected CharacterNodes
    const { nodes: allNodes, edges: allEdges } = useCanvasStore.getState();
    const incomingEdges = allEdges.filter((e) => e.target === id);
    let charRefUrl: string | undefined = payload.referenceImageUrl;
    const charDescParts: string[] = [];
    for (const edge of incomingEdges) {
      const srcNode = allNodes.find((n) => n.id === edge.source);
      if (srcNode?.data.nodeType === "character") {
        const cp = srcNode.data.payload as import("../../../../../shared/types").CharacterNodeData;
        if (cp.referenceImageUrl && !charRefUrl) charRefUrl = cp.referenceImageUrl;
        if (cp.characterKind === "person" && cp.appearance) charDescParts.push(cp.appearance);
        if (cp.characterKind === "scene" && cp.sceneDescription) charDescParts.push(cp.sceneDescription);
      }
    }
    const rawPrompt = charDescParts.length
      ? `${payload.promptText}, ${charDescParts.join(", ")}`
      : payload.promptText;
    const enhancedPrompt = Array.from(rawPrompt).length > 2000
      ? Array.from(rawPrompt).slice(0, 2000).join("")
      : rawPrompt;

    genImageMutation.mutate({
      prompt: enhancedPrompt,
      negativePrompt: payload.negativePrompt,
      style: payload.colorTone,
      referenceImageUrl: charRefUrl,
      model,
      batchSize: model === "hf_soul_standard" && batchCount > 1 ? batchCount : undefined,
    });
  };

  const currentModel = IMAGE_MODELS.find((m) => m.value === model) ?? IMAGE_MODELS[0];

  const heroMedia = (() => {
    if (payload.imageUrl) {
      return (
        <img
          src={payload.imageUrl}
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
              <img
                src={payload.imageUrl}
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
              {payload.sceneNumber && (
                <div
                  className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    background: "oklch(0 0 0 / 0.65)",
                    color: "oklch(0.75 0.18 160)",
                    backdropFilter: "blur(4px)",
                  }}
                >
                  #{payload.sceneNumber}
                </div>
              )}
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
          className="nodrag"
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
            className="nodrag"
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
              className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all self-start"
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
          className="nodrag"
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
          </div>
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

        {/* ── Model selector ── */}
        <div className="nodrag">
          <button
            ref={modelBtnRef}
            onClick={() => {
              if (modelBtnRef.current) setModelPickerRect(modelBtnRef.current.getBoundingClientRect());
              setShowModelPicker((v) => !v);
            }}
            className="nodrag flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-xs transition-all"
            style={{
              background: "var(--c-input)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "oklch(0.65 0.20 160 / 0.30)",
              color: "oklch(0.72 0.18 160)",
            }}
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              {currentModel.label}
              <span
                className="px-1 py-0.5 rounded text-[9px] font-semibold"
                style={{ background: "oklch(0.65 0.20 160 / 0.15)", color: "oklch(0.65 0.20 160)" }}
              >
                {currentModel.group}
              </span>
            </span>
            <ChevronDown className="w-3 h-3 opacity-60" style={{ transform: showModelPicker ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
          </button>
        </div>
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

    </BaseNode>

      {/* ── Image model picker portal (avoids overflow:hidden clipping from BaseNode inner wrapper) ── */}
      {showModelPicker && modelPickerRect && createPortal(
        <>
          {/* Backdrop to close on outside click — skip if mousedown target is the toggle button itself */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99990 }}
            onMouseDown={(e) => {
              if (modelBtnRef.current?.contains(e.target as Node)) return;
              setShowModelPicker(false);
            }}
          />
          <div
            className="rounded-lg overflow-hidden"
            style={{
              position: "fixed",
              zIndex: 99991,
              bottom: window.innerHeight - modelPickerRect.top + 4,
              left: modelPickerRect.left,
              width: modelPickerRect.width,
              background: "var(--c-surface)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "var(--c-bd2)",
              boxShadow: "0 8px 24px oklch(0 0 0 / 0.5)",
            }}
          >
            {["Manus", "Poyo", "Higgsfield"].map((group) => (
              <div key={group}>
                <div className="px-2.5 py-1" style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-t4)", borderBottom: "1px solid var(--c-bd2)" }}>
                  {group}
                </div>
                {IMAGE_MODELS.filter((m) => m.group === group).map((m) => (
                  <button
                    key={m.value}
                    className="nodrag flex items-center justify-between w-full px-2.5 py-2 text-xs transition-colors"
                    style={{
                      background: model === m.value ? "oklch(0.65 0.20 160 / 0.10)" : "transparent",
                      color: model === m.value ? "oklch(0.72 0.18 160)" : "var(--c-t2)",
                    }}
                    onMouseDown={(e) => { e.stopPropagation(); setModel(m.value); setShowModelPicker(false); }}
                    onMouseEnter={(e) => { if (model !== m.value) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                    onMouseLeave={(e) => { if (model !== m.value) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <span>{m.label}</span>
                    <span
                      className="px-1 py-0.5 rounded text-[9px] font-semibold"
                      style={{ background: "oklch(0.65 0.20 160 / 0.12)", color: "oklch(0.55 0.15 160)" }}
                    >
                      {m.desc}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>,
        document.body
      )}

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
