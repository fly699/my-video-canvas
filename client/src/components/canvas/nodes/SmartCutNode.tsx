import { memo, useCallback } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { SmartCutNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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

  const VIDEO_SOURCE_TYPES = new Set(["video_task", "clip", "merge", "overlay", "asset", "subtitle", "subtitle_motion", "smart_cut"]);

  const findSourceVideoUrl = (): string | undefined => {
    const inEdges = edges.filter((e) => e.target === id);
    for (const edge of inEdges) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src || !VIDEO_SOURCE_TYPES.has(src.data.nodeType)) continue;
      const p = src.data.payload as Record<string, unknown>;
      if (src.data.nodeType === "asset" && (p.mimeType as string | undefined)?.startsWith("audio/")) continue;
      const url = (p.resultVideoUrl ?? p.outputUrl ?? p.url) as string | undefined;
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

  const handleRun = () => {
    if (smartCutMutation.isPending) return;
    const videoUrl = payload.inputVideoUrl || findSourceVideoUrl();
    if (!videoUrl) { toast.error("请先连接视频节点或填写视频 URL"); return; }
    update({ status: "processing", errorMessage: undefined });
    smartCutMutation.mutate({
      inputUrl: videoUrl,
      aggressiveness: payload.aggressiveness ?? "medium",
      targetDuration: payload.targetDuration,
    });
  };

  const isProcessing = payload.status === "processing" || smartCutMutation.isPending;
  const aggressiveness = payload.aggressiveness ?? "medium";

  return (
    <BaseNode id={id} selected={selected} nodeType="smart_cut" title={data.title} minHeight={200} resizable showHandles={false}>
      <Handle type="target" position={Position.Top} id="input" style={{ background: accent }} />

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
            <video key={payload.outputUrl} src={`/api/video-proxy?url=${encodeURIComponent(payload.outputUrl)}`}
              controls className="w-full rounded-lg nodrag" style={{ maxHeight: 120, display: "block", border: `1px solid ${accentA(0.4)}` }} preload="metadata" />
            <a href={`/api/video-proxy?url=${encodeURIComponent(payload.outputUrl)}&download=1`} download
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
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

      <Handle type="source" position={Position.Bottom} id="output" style={{ background: accent }} />
    </BaseNode>
  );
});
