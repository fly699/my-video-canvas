import { memo, useState, useCallback } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { SubtitleMotionNodeData, SubtitleEntry } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Clapperboard, Loader2, Download, RotateCcw, Mic2, Plus, Trash2, X } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "subtitle_motion";
    title: string;
    payload: SubtitleMotionNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.68 0.20 175)";
const accentA = (a: number) => `oklch(0.68 0.20 175 / ${a})`;
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

const MOTION_STYLES = [
  { value: "fade",    label: "淡入淡出", desc: "柔和过渡" },
  { value: "roll",    label: "滑动入场", desc: "从右飞入" },
  { value: "karaoke", label: "卡拉OK",   desc: "逐字高亮" },
  { value: "bounce",  label: "弹跳出现", desc: "缩放弹入" },
] as const;

const FONT_COLORS = [
  { value: "white",  label: "白" },
  { value: "yellow", label: "黄" },
  { value: "red",    label: "红" },
  { value: "green",  label: "绿" },
  { value: "orange", label: "橙" },
];

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${String(m).padStart(2, "0")}:${sec}`;
}

export const SubtitleMotionNode = memo(function SubtitleMotionNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes, edges } = useCanvasStore();
  const payload = data.payload;
  const [tab, setTab] = useState<"edit" | "style">("edit");

  const update = useCallback((patch: Partial<SubtitleMotionNodeData>) => updateNodeData(id, patch), [id, updateNodeData]);

  const findSourceVideoUrl = (): string | undefined => {
    const inEdges = edges.filter((e) => e.target === id);
    for (const edge of inEdges) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src) continue;
      const p = src.data.payload as Record<string, unknown>;
      const url = (p.resultVideoUrl ?? p.outputUrl ?? p.url) as string | undefined;
      if (url) return url;
    }
    return undefined;
  };

  const transcribeMutation = trpc.subtitleMotion.transcribe.useMutation({
    onSuccess: (result) => {
      update({ entries: result.entries, language: result.language, status: "done" });
      toast.success(`转录完成，共 ${result.entries.length} 条字幕`);
    },
    onError: (err) => { update({ status: "failed", errorMessage: err.message }); toast.error("转录失败：" + err.message); },
  });

  const burnMutation = trpc.subtitleMotion.burnMotion.useMutation({
    onSuccess: (result) => {
      update({ outputUrl: result.url, status: "done" });
      toast.success("动态字幕烧录完成");
    },
    onError: (err) => { update({ status: "failed", errorMessage: err.message }); toast.error("烧录失败：" + err.message); },
  });

  const handleTranscribe = () => {
    if (transcribeMutation.isPending || burnMutation.isPending) return;
    const videoUrl = payload.inputVideoUrl || findSourceVideoUrl();
    if (!videoUrl) { toast.error("请先连接视频节点或填写视频 URL"); return; }
    update({ status: "transcribing" });
    transcribeMutation.mutate({ audioUrl: videoUrl, language: payload.language || undefined });
  };

  const handleBurn = () => {
    if (burnMutation.isPending || transcribeMutation.isPending) return;
    const videoUrl = payload.inputVideoUrl || findSourceVideoUrl();
    if (!videoUrl) { toast.error("请先填写视频 URL"); return; }
    if (!payload.entries?.length) { toast.error("没有字幕数据，请先转录或手动添加"); return; }
    // Filter out zero-duration entries (e.g. boundary artifacts from Whisper transcription)
    // to prevent server-side refine from rejecting the entire batch.
    const validEntries = payload.entries.filter((e) => e.end > e.start);
    if (!validEntries.length) { toast.error("所有字幕条目的结束时间必须大于开始时间"); return; }
    if (validEntries.length < payload.entries.length) {
      toast.warning(`已过滤 ${payload.entries.length - validEntries.length} 条无效条目（结束时间 ≤ 开始时间）`);
    }
    update({ status: "burning" });
    burnMutation.mutate({
      videoUrl,
      entries: validEntries,
      motionStyle: payload.motionStyle ?? "fade",
      fontSize: payload.fontSize,
      fontColor: payload.fontColor,
    });
  };

  const handleAddEntry = () => {
    const entries = payload.entries ?? [];
    const lastEntry = entries[entries.length - 1];
    const newStart = lastEntry ? lastEntry.end + 0.5 : 0;
    update({ entries: [...entries, { start: newStart, end: newStart + 3, text: "" }] });
  };

  const handleUpdateEntry = (index: number, patch: Partial<SubtitleEntry>) => {
    const entries = [...(payload.entries ?? [])];
    entries[index] = { ...entries[index], ...patch };
    update({ entries });
  };

  const handleDeleteEntry = (index: number) => {
    update({ entries: (payload.entries ?? []).filter((_, i) => i !== index) });
  };

  const isTranscribing = payload.status === "transcribing" || transcribeMutation.isPending;
  const isBurning = payload.status === "burning" || burnMutation.isPending;

  return (
    <BaseNode id={id} selected={selected} nodeType="subtitle_motion" title={data.title} minHeight={240} resizable showHandles={false}>
      <Handle type="target" position={Position.Top} id="input" style={{ background: accent }} />

      <div className="flex flex-col gap-3 p-3.5">

        {/* Tab bar */}
        <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
          {(["edit", "style"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="nodrag flex-1 py-1.5 rounded-md text-[10.5px] font-medium transition-all"
              style={{ background: tab === t ? accentA(0.18) : "transparent", border: `1px solid ${tab === t ? accentA(0.40) : "transparent"}`, color: tab === t ? accent : "var(--c-t3)", cursor: "pointer" }}>
              {t === "edit" ? "字幕编辑" : "动态样式"}
            </button>
          ))}
        </div>

        {/* Status banners */}
        {(isTranscribing || isBurning) && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: accentA(0.08), border: `1px solid ${accentA(0.3)}` }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />
            <span className="text-xs" style={{ color: accent }}>{isTranscribing ? "Whisper 转录中..." : "FFmpeg 烧录动态字幕中..."}</span>
          </div>
        )}
        {payload.status === "failed" && payload.errorMessage && (
          <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.20 25 / 0.08)", border: "1px solid oklch(0.62 0.20 25 / 0.3)" }}>
            <p className="text-xs" style={{ color: "oklch(0.62 0.20 25)" }}>{payload.errorMessage}</p>
          </div>
        )}

        {tab === "edit" && (
          <>
            <div>
              <label style={labelStyle}>视频 URL（自动从连接节点读取）</label>
              <input className="nodrag" placeholder="https://..." value={payload.inputVideoUrl ?? ""}
                onChange={(e) => update({ inputVideoUrl: e.target.value })} style={fieldStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }} />
            </div>

            <div>
              <label style={labelStyle}>语言（留空自动检测）</label>
              <input className="nodrag" placeholder="zh / en / auto" value={payload.language ?? ""}
                onChange={(e) => update({ language: e.target.value })} style={{ ...fieldStyle, width: 120 }} />
            </div>

            <button onClick={handleTranscribe} disabled={isTranscribing || isBurning}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
              style={{ background: isTranscribing || isBurning ? "var(--c-surface)" : accentA(0.12), border: `1px solid ${isTranscribing || isBurning ? BORDER_DEFAULT : accentA(0.4)}`, color: isTranscribing || isBurning ? "var(--c-t4)" : accent, cursor: isTranscribing || isBurning ? "not-allowed" : "pointer" }}>
              {isTranscribing ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Clapperboard style={{ width: 12, height: 12 }} />}
              {isTranscribing ? "Whisper 识别中..." : "AI 语音识别生成字幕"}
            </button>

            {(payload.entries?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label style={{ ...labelStyle, marginBottom: 0 }}>字幕条目（{payload.entries!.length}条）</label>
                  <button onClick={() => update({ entries: [] })} className="nodrag flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: "pointer" }}>
                    <X style={{ width: 8, height: 8 }} /> 清空
                  </button>
                </div>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto nodrag">
                  {payload.entries!.map((entry, i) => (
                    <div key={i} className="flex items-start gap-1.5 p-2 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
                      <div className="flex flex-col gap-0.5 flex-shrink-0" style={{ width: 88 }}>
                        <input type="number" min={0} step={0.1} value={entry.start.toFixed(2)}
                          onChange={(e) => handleUpdateEntry(i, { start: Number(e.target.value) })}
                          className="nodrag" style={{ ...fieldStyle, padding: "2px 6px", fontSize: 10, fontFamily: "monospace", width: "100%" }} />
                        <input type="number" min={0} step={0.1} value={entry.end.toFixed(2)}
                          onChange={(e) => handleUpdateEntry(i, { end: Number(e.target.value) })}
                          className="nodrag" style={{ ...fieldStyle, padding: "2px 6px", fontSize: 10, fontFamily: "monospace", width: "100%" }} />
                        <span style={{ fontSize: 9, color: "var(--c-t4)", textAlign: "center" }}>{formatTime(entry.start)} → {formatTime(entry.end)}</span>
                      </div>
                      <input value={entry.text} onChange={(e) => handleUpdateEntry(i, { text: e.target.value })}
                        className="nodrag flex-1" style={{ ...fieldStyle, fontSize: 11 }} placeholder="字幕文本..." />
                      <button onClick={() => handleDeleteEntry(i)} className="nodrag p-1 rounded flex-shrink-0" style={{ color: "var(--c-t4)", cursor: "pointer" }}>
                        <Trash2 style={{ width: 10, height: 10 }} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={handleAddEntry} disabled={isTranscribing || isBurning}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10px] transition-all"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: isTranscribing || isBurning ? "var(--c-t4)" : "var(--c-t3)", cursor: isTranscribing || isBurning ? "not-allowed" : "pointer" }}>
              <Plus style={{ width: 10, height: 10 }} /> 手动添加字幕条目
            </button>
          </>
        )}

        {tab === "style" && (
          <>
            {/* Motion style */}
            <div>
              <label style={labelStyle}>动画样式</label>
              <div className="flex flex-col gap-1.5">
                {MOTION_STYLES.map((s) => (
                  <button key={s.value} onClick={() => update({ motionStyle: s.value })} className="nodrag flex items-center justify-between px-3 py-2 rounded-lg transition-all"
                    style={{ background: payload.motionStyle === s.value || (!payload.motionStyle && s.value === "fade") ? accentA(0.15) : "var(--c-input)", border: `1px solid ${payload.motionStyle === s.value || (!payload.motionStyle && s.value === "fade") ? accentA(0.50) : "var(--c-bd2)"}`, cursor: "pointer" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: payload.motionStyle === s.value || (!payload.motionStyle && s.value === "fade") ? accent : "var(--c-t2)" }}>{s.label}</span>
                    <span style={{ fontSize: 10, color: "var(--c-t4)" }}>{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Font size */}
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>字体大小</label>
                <span style={{ fontSize: 10, color: "var(--c-t3)" }}>{payload.fontSize ?? 22}px</span>
              </div>
              <input type="range" min={12} max={40} step={1} value={payload.fontSize ?? 22}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
                className="nodrag w-full" style={{ accentColor: accent }} />
            </div>

            {/* Font color */}
            <div>
              <label style={labelStyle}>字幕颜色</label>
              <div className="flex gap-1.5">
                {FONT_COLORS.map((c) => (
                  <button key={c.value} onClick={() => update({ fontColor: c.value })} className="nodrag flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all"
                    style={{ background: payload.fontColor === c.value ? accentA(0.15) : "var(--c-input)", border: `1px solid ${payload.fontColor === c.value ? accentA(0.50) : "var(--c-bd2)"}`, color: payload.fontColor === c.value ? accent : "var(--c-t3)", cursor: "pointer" }}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Output video */}
            {payload.outputUrl && (
              <div className="flex flex-col gap-1.5">
                <label style={labelStyle}>烧录后视频</label>
                <video key={payload.outputUrl} src={`/api/video-proxy?url=${encodeURIComponent(payload.outputUrl)}`}
                  controls className="w-full rounded-lg nodrag" style={{ maxHeight: 120, display: "block", border: `1px solid ${accentA(0.4)}` }} preload="metadata" />
                <a href={`/api/video-proxy?url=${encodeURIComponent(payload.outputUrl)}&download=1`} download
                  className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
                  style={{ background: accentA(0.08), border: `1px solid ${accentA(0.25)}`, color: accent, textDecoration: "none" }}>
                  <Download style={{ width: 10, height: 10 }} /> 下载带字幕视频
                </a>
                <button onClick={() => update({ outputUrl: undefined, status: "idle", errorMessage: undefined })}
                  className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
                  style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: "pointer" }}>
                  <RotateCcw style={{ width: 9, height: 9 }} /> 重置
                </button>
              </div>
            )}

            {/* Burn button */}
            <button onClick={handleBurn} disabled={isBurning || isTranscribing || !(payload.entries?.length)}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: isBurning || isTranscribing || !(payload.entries?.length) ? "var(--c-surface)" : accentA(0.15), border: `1px solid ${isBurning || isTranscribing || !(payload.entries?.length) ? BORDER_DEFAULT : accentA(0.5)}`, color: isBurning || isTranscribing || !(payload.entries?.length) ? "var(--c-t4)" : accent, cursor: isBurning || isTranscribing || !(payload.entries?.length) ? "not-allowed" : "pointer" }}>
              {isBurning ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Mic2 style={{ width: 12, height: 12 }} />}
              {isBurning ? "FFmpeg 烧录中..." : "烧录动态字幕到视频"}
            </button>
          </>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} id="output" style={{ background: accent }} />
    </BaseNode>
  );
});
