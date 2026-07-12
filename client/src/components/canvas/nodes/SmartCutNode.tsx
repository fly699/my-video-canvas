import { memo, useCallback } from "react";
import { useCreativeAdvanced } from "../../../hooks/useCreativeAdvanced";
import { InlineGenBar } from "../InlineGenBar";
import { SlidersHorizontal } from "lucide-react";
import { BaseNode } from "../BaseNode";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { SmartCutNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { loadAiToolModel } from "../NodeTextInput";
import { toast } from "sonner";
import { mediaFetchUrl, onDownloadMedia } from "@/lib/download";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { getNodeVideoOutput } from "@/lib/canvasPassthrough";
import { Zap, Loader2, Download, RotateCcw, Clapperboard } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "smart_cut";
    title: string;
    payload: SmartCutNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.68 0.22 65)";
const accentA = (a: number) => `oklch(0.68 0.22 65 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";

const labelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const,
  letterSpacing: "0.06em", color: "var(--c-t4)", display: "block", marginBottom: 5,
};

const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 12,
  background: "var(--c-input)", borderWidth: 1, borderStyle: "solid",
  borderColor: BORDER_DEFAULT, borderRadius: 8, color: "var(--c-t1)",
  outline: "none", transition: "border-color 150ms ease", lineHeight: 1.5,
};

const AGGRESSIVENESS_OPTIONS = [
  { value: "low",    label: "保守",   desc: "仅删除明显停顿和无语义片段" },
  { value: "medium", label: "适中",   desc: "删除停顿、冗余和低信息密度片段" },
  { value: "high",   label: "激进",   desc: "大幅压缩，保留核心内容" },
] as const;

export const SmartCutNode = memo(function SmartCutNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes, edges } = useCanvasStore();
  const payload = data.payload;

  const update = useCallback((patch: Partial<SmartCutNodeData>) => updateNodeData(id, patch), [id, updateNodeData]);
  // LibTV（#70 创意模式）：参数区默认收起（保留状态/产出/运行），点「参数设置」/快捷键 A 展开。
  const { isCreativeMode, advancedOpen, setAdvancedOpen } = useCreativeAdvanced(selected);

  const VIDEO_SOURCE_TYPES = new Set(["video_task", "clip", "merge", "overlay", "asset", "subtitle", "subtitle_motion", "smart_cut", "comfyui_video", "comfyui_workflow"]);

  const findSourceVideoUrl = (): string | undefined => {
    const inEdges = edges.filter((e) => e.target === id);
    for (const edge of inEdges) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src || !VIDEO_SOURCE_TYPES.has(src.data.nodeType)) continue;
      const p = src.data.payload as Record<string, unknown>;
      // Helper skips non-video assets and image-output comfyui_workflow runs.
      const url = getNodeVideoOutput(src.data.nodeType, p);
      if (url) return url;
    }
    return undefined;
  };

  const smartCutMutation = trpc.clip.smartCut.useMutation({
    onSuccess: (result) => {
      update({ outputUrl: result.url, outputDuration: result.outputDuration, originalDuration: result.originalDuration, status: "done" });
      toast.success(`智能剪辑完成，输出时长约 ${result.outputDuration.toFixed(1)}s`);
    },
    onError: (err) => { update({ status: "failed", errorMessage: err.message }); toast.error("智能剪辑失败：" + err.message); },
  });


  // #100 场景切点检测：本地 ffmpeg 找视觉切换点，作为剪辑边界吸附（与镜界保护同通道）。
  const detectMutation = trpc.clip.detectScenes.useMutation({
    onSuccess: (r) => {
      update({ sceneBoundaries: r.boundaries });
      toast.success(r.boundaries.length ? `检测到 ${r.boundaries.length} 个场景切点，剪辑边界将优先吸附` : "未检测到明显场景切换（画面连续），将按语义自由剪辑");
    },
    onError: (err) => toast.error("场景检测失败：" + err.message),
  });
  const handleDetectScenes = () => {
    if (detectMutation.isPending) return;
    const videoUrl = payload.inputVideoUrl || findSourceVideoUrl();
    if (!videoUrl) { toast.error("请先连接视频节点或填写视频 URL"); return; }
    detectMutation.mutate({ inputUrl: videoUrl, projectId: data.projectId });
  };

  // 镜界保护：上游是「已装配并完成合并」的成片、且本次剪辑源就是该成片时，
  // 把各段精确起点（segStarts）作为镜头边界传给智能剪辑——剪辑边界优先落在切点上
  // （LLM 提示 + 服务端 ±0.5s 确定性吸附），不在镜头中间起切。
  const shotBoundariesFor = (videoUrl: string): number[] | undefined => {
    for (const e of edges) {
      if (e.target !== id) continue;
      const src = nodes.find((n) => n.id === e.source);
      if (src?.data.nodeType !== "merge") continue;
      const mp = src.data.payload as { segStarts?: number[]; outputUrl?: string };
      if (mp.segStarts?.length && mp.outputUrl === videoUrl) return mp.segStarts.slice(0, 60);
    }
    return undefined;
  };
  const boundaryCount = (() => {
    const videoUrl = payload.inputVideoUrl || findSourceVideoUrl();
    return videoUrl ? (shotBoundariesFor(videoUrl)?.length ?? 0) : 0;
  })();

  const handleRun = () => {
    if (smartCutMutation.isPending) return;
    const videoUrl = payload.inputVideoUrl || findSourceVideoUrl();
    if (!videoUrl) { toast.error("请先连接视频节点或填写视频 URL"); return; }
    update({ status: "processing", errorMessage: undefined });
    smartCutMutation.mutate({
      inputUrl: videoUrl,
      projectId: data.projectId,
      nodeId: id,
      aggressiveness: payload.aggressiveness ?? "medium",
      // 服务端要求 5-3600；<5 视为「自动判定」不下发，避免被 zod 拒。
      targetDuration: typeof payload.targetDuration === "number" && payload.targetDuration >= 5 ? Math.min(3600, payload.targetDuration) : undefined,
      // #100 镜界（装配成片 segStarts）与场景检测切点合并去重（上限 60，服务端 zod 同限）
      shotBoundaries: (() => {
        const merged = Array.from(new Set([...(shotBoundariesFor(videoUrl) ?? []), ...(payload.sceneBoundaries ?? [])])).sort((a, b) => a - b).slice(0, 60);
        return merged.length ? merged : undefined;
      })(),
      // #73：此前不传 model 暗走服务端默认——随宽幅弹窗 AI 工具偏好（含自建/桥接）
      ...(loadAiToolModel() ? { model: loadAiToolModel() } : {}),
    });
  };

  const isProcessing = payload.status === "processing" || smartCutMutation.isPending;
  const aggressiveness = payload.aggressiveness ?? "medium";

  // #97 配置区单一来源：非创意内联卡体（原样）；创意模式挂输入条「参数与操作」下浮面板。
  const configBody = (
    <>
        {/* Video URL */}
        <div>
          <label style={labelStyle}>视频 URL（自动从连接节点读取）</label>
          <input className="nodrag" placeholder="https://..." value={payload.inputVideoUrl ?? ""}
            onChange={(e) => update({ inputVideoUrl: e.target.value })} style={fieldStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }} />
        </div>
        {/* #100 场景切点检测行 */}
        <div className="flex items-center gap-2">
          <button onClick={handleDetectScenes} disabled={detectMutation.isPending || isProcessing}
            className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold transition-all flex-shrink-0"
            style={{ background: detectMutation.isPending ? "var(--c-surface)" : accentA(0.12), border: `1px solid ${detectMutation.isPending ? BORDER_DEFAULT : accentA(0.4)}`, color: detectMutation.isPending || isProcessing ? "var(--c-t4)" : accent, cursor: detectMutation.isPending || isProcessing ? "not-allowed" : "pointer" }}>
            {detectMutation.isPending ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <Clapperboard style={{ width: 11, height: 11 }} />}
            检测场景切点
          </button>
          <span style={{ fontSize: 9.5, color: "var(--c-t4)", lineHeight: 1.4 }}>
            {payload.sceneBoundaries?.length
              ? `已检测 ${payload.sceneBoundaries.length} 个视觉切点——剪辑边界将优先吸附，不在镜头中间起切`
              : "ffmpeg 找视觉场景切换点 → 剪辑边界吸附（免费，本地执行）"}
          </span>
        </div>


        {/* Aggressiveness */}
        <div>
          <label style={labelStyle}>剪辑激进度</label>
          <div className="flex flex-col gap-1.5">
            {AGGRESSIVENESS_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => update({ aggressiveness: opt.value })}
                className="nodrag flex items-center justify-between px-3 py-2 rounded-lg transition-all"
                style={{ background: aggressiveness === opt.value ? accentA(0.15) : "var(--c-input)", border: `1px solid ${aggressiveness === opt.value ? accentA(0.50) : "var(--c-bd2)"}`, cursor: "pointer" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: aggressiveness === opt.value ? accent : "var(--c-t2)" }}>{opt.label}</span>
                <span style={{ fontSize: 10, color: "var(--c-t4)" }}>{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 目标时长（可选）：此前仅命令栏可设，专业版 body 缺控件 → 脱离命令栏无法在节点上改。 */}
        <div>
          <label style={labelStyle}>目标时长（秒，≥5，可选）</label>
          {/* 服务端 zod 要求 5-3600；<5 视为「留空=自动判定」，避免 0/1-4 直接被服务端拒。 */}
          <input type="number" min={5} max={3600} step={1} className="nodrag" placeholder="留空=自动判定（≥5）"
            value={typeof payload.targetDuration === "number" ? payload.targetDuration : ""}
            onChange={(e) => { const n = Number(e.target.value); update({ targetDuration: Number.isFinite(n) && n >= 5 ? Math.min(3600, n) : undefined }); }}
            style={fieldStyle} />
        </div>

    </>
  );

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="smart_cut" title={data.title} minHeight={200} resizable
      heroMedia={/* #105 创意未选中且有成片→英雄区（悬停自动播放；选中走卡体预览避免双播放器；极简形态据此覆盖） */
      isCreativeMode && !selected && payload.outputUrl ? <WatermarkedVideo block key={payload.outputUrl} src={mediaFetchUrl(payload.outputUrl)} preload="metadata" className="w-full" style={{ display: "block" }} /> : null}>

      <div className="flex flex-col gap-3 p-3.5">

        {/* Status banner */}
        {isProcessing && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: accentA(0.08), border: `1px solid ${accentA(0.3)}` }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />
            <span className="text-xs" style={{ color: accent }}>Whisper 转录 + AI 分析 + FFmpeg 剪辑中...</span>
          </div>
        )}
        {payload.status === "failed" && payload.errorMessage && (
          <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.20 25 / 0.08)", border: "1px solid oklch(0.62 0.20 25 / 0.3)" }}>
            <p className="text-xs" style={{ color: "oklch(0.62 0.20 25)" }}>{payload.errorMessage}</p>
          </div>
        )}

        {boundaryCount > 0 && (
          <p title="上游成片的各镜起点将作为剪辑保护切点：剪辑边界优先落在镜头切点上（±0.5s 自动吸附），不在镜头中间起切"
            style={{ fontSize: 9.5, color: "oklch(0.65 0.20 160)", margin: 0, lineHeight: 1.5 }}>
            🎬 已识别上游装配成片：{boundaryCount} 个镜头切点将作为剪辑保护边界
          </p>
        )}

        {!isCreativeMode && configBody}

        {/* Output stats */}
        {payload.status === "done" && payload.outputDuration != null && (
          <div className="flex items-center gap-3 px-2.5 py-2 rounded-lg" style={{ background: accentA(0.06), border: `1px solid ${accentA(0.25)}` }}>
            <div className="flex flex-col">
              <span style={{ fontSize: 9, color: "var(--c-t4)" }}>输出时长</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>{payload.outputDuration.toFixed(1)}s</span>
            </div>
            {payload.originalDuration != null && payload.originalDuration > 0 && (
              <div className="flex flex-col">
                <span style={{ fontSize: 9, color: "var(--c-t4)" }}>压缩比</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>
                  {Math.round((1 - (payload.outputDuration ?? 0) / payload.originalDuration) * 100)}%↓
                </span>
              </div>
            )}
          </div>
        )}

        {/* Output video */}
        {payload.outputUrl && (
          <div className="flex flex-col gap-1.5">
            <div className="relative">
              <WatermarkedVideo block key={payload.outputUrl} src={mediaFetchUrl(payload.outputUrl)}
                controls className="w-full rounded-lg nodrag" style={{ maxHeight: 120, display: "block", border: `1px solid ${accentA(0.4)}` }} preload="metadata" />
              {isOwnStorageUrl(payload.outputUrl) && (
                <div title="已存储到 MinIO·长期有效" className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
                  style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }} />
              )}
            </div>
            <a href={mediaFetchUrl(payload.outputUrl, true)} onClick={onDownloadMedia(payload.outputUrl, "智能剪辑视频.mp4")}
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] cursor-pointer"
              style={{ background: accentA(0.08), border: `1px solid ${accentA(0.25)}`, color: accent, textDecoration: "none" }}>
              <Download style={{ width: 10, height: 10 }} /> 下载智能剪辑视频
            </a>
            <button onClick={() => update({ outputUrl: undefined, status: "idle", errorMessage: undefined, outputDuration: undefined, originalDuration: undefined })}
              disabled={isProcessing}
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: isProcessing ? "not-allowed" : "pointer", opacity: isProcessing ? 0.5 : 1 }}>
              <RotateCcw style={{ width: 9, height: 9 }} /> 重置
            </button>
          </div>
        )}

        {/* Run button */}
        <button onClick={handleRun} disabled={isProcessing}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: isProcessing ? "var(--c-surface)" : accentA(0.15), border: `1px solid ${isProcessing ? BORDER_DEFAULT : accentA(0.5)}`, color: isProcessing ? "var(--c-t4)" : accent, cursor: isProcessing ? "not-allowed" : "pointer" }}>
          {isProcessing ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Zap style={{ width: 12, height: 12 }} />}
          {isProcessing ? "AI 智能剪辑中..." : "运行智能剪辑"}
        </button>

        <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5, margin: 0 }}>
          Whisper 语音识别 → AI 语义分析 → FFmpeg 精准剪切拼接
        </p>
      </div>

    </BaseNode>
    {/* ── #97 LibTV（创意模式）就地输入条：参数与操作下浮面板（屏幕恒定） ── */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={!!selected} width={440}>
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t2)", whiteSpace: "nowrap" }}>智能剪辑</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>检测参数 / 片段策略</span>
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
