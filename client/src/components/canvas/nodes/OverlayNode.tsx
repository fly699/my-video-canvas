import { memo, useCallback } from "react";
import { useCreativeAdvanced } from "../../../hooks/useCreativeAdvanced";
import { InlineGenBar } from "../InlineGenBar";
import { SlidersHorizontal } from "lucide-react";
import { BaseNode } from "../BaseNode";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import type { OverlayNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { mediaFetchUrl, onDownloadMedia } from "@/lib/download";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { getNodeVideoOutput } from "@/lib/canvasPassthrough";
import { Blend, Loader2, CheckCircle2, XCircle, Download, Play } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "overlay";
    title: string;
    payload: OverlayNodeData;
    projectId: number;
  };
}

const BORDER_DEFAULT = "var(--c-bd2)";

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
  transition: "border-color 150ms ease",
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

const accentColor = "oklch(0.65 0.18 30)";

export const OverlayNode = memo(function OverlayNode({ id, selected, data }: Props) {
  const { updateNodeData, edges, nodes } = useCanvasStore(useShallow((s) => ({ updateNodeData: s.updateNodeData, edges: s.edges, nodes: s.nodes })));
  const payload = data.payload;

  const overlayMutation = trpc.overlay.process.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { outputUrl: result.url, status: "done", errorMessage: undefined });
      toast.success("叠加处理完成");
    },
    onError: (err) => {
      updateNodeData(id, { status: "failed", errorMessage: err.message });
      toast.error("叠加失败：" + err.message);
    },
  });

  const handleChange = useCallback(
    (field: keyof OverlayNodeData, value: unknown) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );

  // Auto-detect inputVideoUrl from connected video-output nodes only (not image/asset nodes)
  const VIDEO_SOURCE_TYPES = new Set(["video_task", "clip", "merge", "overlay", "asset", "subtitle", "subtitle_motion", "smart_cut", "comfyui_video", "comfyui_workflow"]);
  // 已连接的视频源（带标题，供 PiP 显式选择主/画中画，消除「靠连线顺序定主次」的歧义）。
  const connectedVideos = (() => {
    const list: { url: string; title: string }[] = [];
    for (const edge of edges.filter((e) => e.target === id)) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src || !VIDEO_SOURCE_TYPES.has(src.data.nodeType)) continue;
      // getNodeVideoOutput skips a comfyui_workflow that produced an IMAGE and a
      // non-video asset — so we never feed an image/audio URL into the overlay.
      const url = getNodeVideoOutput(src.data.nodeType, src.data.payload as Record<string, unknown>);
      if (url && !list.some((v) => v.url === url)) list.push({ url, title: src.data.title || src.id });
    }
    return list;
  })();
  const autoDetectedVideoUrls = connectedVideos.map((v) => v.url);
  const autoDetectedVideoUrl = autoDetectedVideoUrls[0];
  // PiP mode needs a SECOND video — auto-fill it from the second distinct connected
  // video so wiring two videos "just works" without hand-typing the pip URL.
  const autoDetectedPipUrl = autoDetectedVideoUrls[1];

  const effectivePipUrl = payload.pipVideoUrl?.trim() || autoDetectedPipUrl;
  // 主视频：手填优先；否则取第一路「不是画中画」的连线视频（用户显式选了某路作画中画时，
  // 主视频自动落到另一路，避免主/画中画指向同一视频）。
  const effectiveInputUrl = payload.inputVideoUrl ?? (autoDetectedVideoUrls.find((u) => u !== effectivePipUrl) ?? autoDetectedVideoUrl);

  const handleProcess = () => {
    if (overlayMutation.isPending || payload.status === "processing") return;
    if (!effectiveInputUrl) {
      toast.error("请先连接视频源节点或填写输入视频 URL");
      return;
    }
    const mode = payload.mode ?? "watermark";
    if (mode === "watermark" && !payload.overlayImageUrl) {
      toast.error("水印/Logo 模式需要填写叠加图片 URL");
      return;
    }
    if (mode === "pip" && !effectivePipUrl) {
      toast.error("画中画模式需要第二个视频（再连一个视频源，或填写画中画视频 URL）");
      return;
    }
    updateNodeData(id, { status: "processing", errorMessage: undefined });
    overlayMutation.mutate({
      inputUrl: effectiveInputUrl,
      projectId: data.projectId,
      nodeId: id,
      mode,
      overlayImageUrl: payload.overlayImageUrl,
      overlayPosition: payload.overlayPosition,
      overlayScale: payload.overlayScale,
      overlayOpacity: payload.overlayOpacity,
      pipVideoUrl: effectivePipUrl,
      pipPosition: payload.pipPosition,
      pipScale: payload.pipScale,
      brightness: payload.brightness,
      contrast: payload.contrast,
      saturation: payload.saturation,
    });
  };

  const isProcessing = payload.status === "processing" || overlayMutation.isPending;
  const isDone = payload.status === "done";
  const isFailed = payload.status === "failed";

  const onFocusMid = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "var(--c-t4)"; };
  const onBlurDefault = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

  const videoSrc = payload.outputUrl ? mediaFetchUrl(payload.outputUrl) : undefined;

  const mode = payload.mode ?? "watermark";

  // LibTV（#70 创意模式）：参数区默认收起（保留产出/状态/运行），点「参数设置」/快捷键 A 展开。
  const { isCreativeMode, advancedOpen, setAdvancedOpen } = useCreativeAdvanced(selected);

  // #97 配置区单一来源：非创意内联卡体（原样）；创意模式挂输入条「参数与操作」下浮面板。
  const configBody = (
    <>
        {/* Icon + mode selector */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Blend style={{ width: 14, height: 14, color: accentColor, flexShrink: 0 }} />
          <select
            value={mode}
            onChange={(e) => handleChange("mode", e.target.value)}
            disabled={isProcessing}
            className="nodrag flex-1"
            style={{ ...fieldStyle, cursor: isProcessing ? "not-allowed" : "pointer", opacity: isProcessing ? 0.5 : 1 }}
            onFocus={onFocusMid}
            onBlur={onBlurDefault}
          >
            <option value="watermark">水印 / Logo 叠加</option>
            <option value="pip">画中画 (PiP)</option>
            <option value="color_correction">色彩校正</option>
          </select>
        </div>

        {/* Input video URL */}
        <div className="flex-shrink-0">
          <label style={labelStyle}>
            输入视频{effectiveInputUrl && !payload.inputVideoUrl ? "（自动检测）" : ""}
          </label>
          <input
            placeholder={autoDetectedVideoUrl ? "（已自动连接）" : "视频 URL..."}
            value={payload.inputVideoUrl ?? ""}
            onChange={(e) => handleChange("inputVideoUrl", e.target.value)}
            disabled={isProcessing}
            className="nodrag"
            style={{ ...fieldStyle, opacity: isProcessing ? 0.5 : 1 }}
            onFocus={onFocusMid}
            onBlur={onBlurDefault}
          />
          {autoDetectedVideoUrl && !payload.inputVideoUrl && (
            <p style={{ fontSize: 9, color: "var(--c-t4)", marginTop: 3 }}>
              来自连接节点
            </p>
          )}
        </div>

        {/* Watermark mode fields */}
        {mode === "watermark" && (
          <>
            <div className="flex-shrink-0">
              <label style={labelStyle}>叠加图片 URL *</label>
              <input
                placeholder="https://... (PNG/WebP 支持透明)"
                value={payload.overlayImageUrl ?? ""}
                onChange={(e) => handleChange("overlayImageUrl", e.target.value)}
                disabled={isProcessing}
                className="nodrag"
                style={{ ...fieldStyle, opacity: isProcessing ? 0.5 : 1 }}
                onFocus={onFocusMid}
                onBlur={onBlurDefault}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 flex-shrink-0">
              <div>
                <label style={labelStyle}>位置</label>
                <select
                  value={payload.overlayPosition ?? "bottom-right"}
                  onChange={(e) => handleChange("overlayPosition", e.target.value)}
                  disabled={isProcessing}
                  className="nodrag"
                  style={{ ...fieldStyle, cursor: "pointer", opacity: isProcessing ? 0.5 : 1 }}
                  onFocus={onFocusMid}
                  onBlur={onBlurDefault}
                >
                  <option value="top-left">左上</option>
                  <option value="top-right">右上</option>
                  <option value="bottom-left">左下</option>
                  <option value="bottom-right">右下</option>
                  <option value="center">居中</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>缩放 ({Math.round((payload.overlayScale ?? 0.2) * 100)}%)</label>
                <input
                  type="range"
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  value={payload.overlayScale ?? 0.2}
                  onChange={(e) => handleChange("overlayScale", parseFloat(e.target.value))}
                  disabled={isProcessing}
                  className="nodrag w-full mt-1"
                  style={{ accentColor }}
                />
              </div>
            </div>
            <div className="flex-shrink-0">
              <label style={labelStyle}>透明度 ({Math.round((payload.overlayOpacity ?? 1.0) * 100)}%)</label>
              <input
                type="range"
                min={0}
                max={1.0}
                step={0.05}
                value={payload.overlayOpacity ?? 1.0}
                onChange={(e) => handleChange("overlayOpacity", parseFloat(e.target.value))}
                disabled={isProcessing}
                className="nodrag w-full"
                style={{ accentColor }}
              />
            </div>
          </>
        )}

        {/* PiP mode fields */}
        {mode === "pip" && (
          <>
            {/* 显式指定哪路连线视频作画中画（≥2 路时消除「靠顺序定主次」歧义；选「自动」用第 2 路）。 */}
            {connectedVideos.length >= 2 && (
              <div className="flex-shrink-0">
                <label style={labelStyle}>画中画来源</label>
                <select
                  value={payload.pipVideoUrl?.trim() && connectedVideos.some((v) => v.url === payload.pipVideoUrl) ? payload.pipVideoUrl : ""}
                  onChange={(e) => handleChange("pipVideoUrl", e.target.value || undefined)}
                  disabled={isProcessing}
                  className="nodrag"
                  style={{ ...fieldStyle, cursor: "pointer", opacity: isProcessing ? 0.5 : 1 }}
                  onFocus={onFocusMid}
                  onBlur={onBlurDefault}
                >
                  <option value="">自动（第 2 路连线）</option>
                  {connectedVideos.map((v, i) => (
                    <option key={v.url} value={v.url}>{`第 ${i + 1} 路：${v.title}`}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex-shrink-0">
              <label style={labelStyle}>画中画视频 URL *</label>
              <input
                placeholder={autoDetectedPipUrl ? "（已自动连接第二个视频）" : "https://..."}
                value={payload.pipVideoUrl ?? ""}
                onChange={(e) => handleChange("pipVideoUrl", e.target.value)}
                disabled={isProcessing}
                className="nodrag"
                style={{ ...fieldStyle, opacity: isProcessing ? 0.5 : 1 }}
                onFocus={onFocusMid}
                onBlur={onBlurDefault}
              />
              {autoDetectedPipUrl && !payload.pipVideoUrl && (
                <p style={{ fontSize: 9.5, color: "var(--c-t4)", margin: "3px 0 0" }}>已自动使用第二个连接的视频作为画中画</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 flex-shrink-0">
              <div>
                <label style={labelStyle}>位置</label>
                <select
                  value={payload.pipPosition ?? "bottom-right"}
                  onChange={(e) => handleChange("pipPosition", e.target.value)}
                  disabled={isProcessing}
                  className="nodrag"
                  style={{ ...fieldStyle, cursor: "pointer", opacity: isProcessing ? 0.5 : 1 }}
                  onFocus={onFocusMid}
                  onBlur={onBlurDefault}
                >
                  <option value="top-left">左上</option>
                  <option value="top-right">右上</option>
                  <option value="bottom-left">左下</option>
                  <option value="bottom-right">右下</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>大小 ({Math.round((payload.pipScale ?? 0.25) * 100)}%)</label>
                <input
                  type="range"
                  min={0.1}
                  max={0.5}
                  step={0.05}
                  value={payload.pipScale ?? 0.25}
                  onChange={(e) => handleChange("pipScale", parseFloat(e.target.value))}
                  disabled={isProcessing}
                  className="nodrag w-full mt-1"
                  style={{ accentColor }}
                />
              </div>
            </div>
          </>
        )}

        {/* Color correction mode fields */}
        {mode === "color_correction" && (
          <div className="flex flex-col gap-2.5 flex-shrink-0">
            <div>
              <label style={labelStyle}>亮度 ({payload.brightness ?? 0})</label>
              <input
                type="range"
                min={-1.0}
                max={1.0}
                step={0.05}
                value={payload.brightness ?? 0}
                onChange={(e) => handleChange("brightness", parseFloat(e.target.value))}
                disabled={isProcessing}
                className="nodrag w-full"
                style={{ accentColor }}
              />
            </div>
            <div>
              <label style={labelStyle}>对比度 ({payload.contrast ?? 1.0})</label>
              <input
                type="range"
                min={0}
                max={2.0}
                step={0.05}
                value={payload.contrast ?? 1.0}
                onChange={(e) => handleChange("contrast", parseFloat(e.target.value))}
                disabled={isProcessing}
                className="nodrag w-full"
                style={{ accentColor }}
              />
            </div>
            <div>
              <label style={labelStyle}>饱和度 ({payload.saturation ?? 1.0})</label>
              <input
                type="range"
                min={0}
                max={3.0}
                step={0.1}
                value={payload.saturation ?? 1.0}
                onChange={(e) => handleChange("saturation", parseFloat(e.target.value))}
                disabled={isProcessing}
                className="nodrag w-full"
                style={{ accentColor }}
              />
            </div>
          </div>
        )}

    </>
  );

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="overlay" title={data.title} minHeight={240}>
      <div className="flex flex-col h-full p-3.5 gap-3 overflow-auto">

        {!isCreativeMode && configBody}

        {/* Result video */}
        {isDone && payload.outputUrl && videoSrc && (
          <div className="flex-shrink-0">
            <div className="relative rounded-lg overflow-hidden" style={{ borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.65 0.18 155 / 0.35)" }}>
              <WatermarkedVideo
                block
                key={videoSrc}
                src={videoSrc}
                controls
                className="w-full nodrag"
                style={{ maxHeight: 140, display: "block" }}
                preload="metadata"
              />
              {isOwnStorageUrl(payload.outputUrl) && (
                <div
                  title="已存储到 MinIO·长期有效"
                  className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
                  style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
                />
              )}
            </div>
            <a
              href={mediaFetchUrl(payload.outputUrl, true)}
              onClick={onDownloadMedia(payload.outputUrl, "叠加视频.mp4")}
              className="nodrag mt-1.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: "oklch(0.72 0.18 155 / 0.10)",
                borderWidth: 1, borderStyle: "solid",
                borderColor: "oklch(0.72 0.18 155 / 0.30)",
                color: "oklch(0.72 0.18 155)",
                textDecoration: "none",
                display: "flex",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.72 0.18 155 / 0.18)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.72 0.18 155 / 0.10)"; }}
            >
              <Download className="w-3 h-3" />
              下载视频
            </a>
          </div>
        )}

        {/* Error */}
        {isFailed && payload.errorMessage && (
          <div className="flex items-start gap-2 p-2 rounded-lg flex-shrink-0" style={{ background: "oklch(0.62 0.20 25 / 0.08)", borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.62 0.20 25 / 0.30)" }}>
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "oklch(0.62 0.20 25)" }} />
            <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.62 0.20 25)" }}>{payload.errorMessage}</p>
          </div>
        )}

        {/* Status + action */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isDone && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "oklch(0.72 0.18 155)" }} />
              <span className="text-xs" style={{ color: "oklch(0.72 0.18 155)" }}>处理完成</span>
            </div>
          )}
          <button
            onClick={handleProcess}
            disabled={isProcessing}
            className="nodrag flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: isProcessing ? "var(--c-surface)" : `${accentColor.replace(")", " / 0.15)")}`,
              borderWidth: 1, borderStyle: "solid",
              borderColor: isProcessing ? BORDER_DEFAULT : accentColor.replace(")", " / 0.4)"),
              color: isProcessing ? "var(--c-t4)" : accentColor,
              cursor: isProcessing ? "not-allowed" : "pointer",
            }}
          >
            {isProcessing
              ? <><Loader2 className="w-3 h-3 animate-spin" />处理中...</>
              : <><Play className="w-3 h-3" />{isDone ? "重新处理" : "开始处理"}</>
            }
          </button>
        </div>
      </div>
    </BaseNode>
    {/* ── #97 LibTV（创意模式）就地输入条：参数与操作下浮面板（屏幕恒定） ── */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={!!selected} width={440}>
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t2)", whiteSpace: "nowrap" }}>叠加</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>叠加素材 / 位置 / 尺寸 / 混合参数</span>
          <button className="nodrag" onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起参数面板" : "展开参数与操作面板（浮现于输入条下方，不撑开节点卡体）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
            <SlidersHorizontal size={12} /> 参数与操作
          </button>
        </div>
        {advancedOpen && (
          <div className="nodrag nowheel flex flex-col" style={{ gap: 12, maxHeight: "52vh", overflowY: "auto", overscrollBehavior: "contain", paddingTop: 10, marginTop: 4, borderTop: "1px solid var(--c-bd1)" }}>
            {configBody}
          </div>
        )}
      </InlineGenBar>
    )}
    </>
  );
});
