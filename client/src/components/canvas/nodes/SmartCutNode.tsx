import { memo, useCallback } from "react";
import { BaseNode } from "../BaseNode";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { SmartCutNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { mediaFetchUrl, onDownloadMedia } from "@/lib/download";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { getNodeVideoOutput } from "@/lib/canvasPassthrough";
import { Zap, Loader2, Download, RotateCcw } from "lucide-react";

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
      targetDuration: payload.targetDuration,
      shotBoundaries: shotBoundariesFor(videoUrl),
    });
  };

  const isProcessing = payload.status === "processing" || smartCutMutation.isPending;
  const aggressiveness = payload.aggressiveness ?? "medium";

  return (
    <BaseNode id={id} selected={selected} nodeType="smart_cut" title={data.title} minHeight={200} resizable>

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

        {/* Video URL */}
        <div>
          <label style={labelStyle}>视频 URL（自动从连接节点读取）</label>
          <input className="nodrag" placeholder="https://..." value={payload.inputVideoUrl ?? ""}
            onChange={(e) => update({ inputVideoUrl: e.target.value })} style={fieldStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }} />
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
  );
});
