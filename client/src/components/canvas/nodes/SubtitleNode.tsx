import { memo, useState, useCallback } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { SubtitleNodeData, SubtitleEntry } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Captions, Loader2, Download, RotateCcw, Flame, Plus, Trash2, X } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "subtitle";
    title: string;
    payload: SubtitleNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.65 0.18 170)";
const accentA = (a: number) => `oklch(0.65 0.18 170 / ${a})`;
const BORDER_DEFAULT = "oklch(0.20 0.008 260)";

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "oklch(0.45 0.008 260)",
  display: "block",
  marginBottom: 5,
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 12,
  background: "oklch(0.09 0.006 260)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
  borderRadius: 8,
  color: "oklch(0.86 0.006 260)",
  outline: "none",
  transition: "border-color 150ms ease",
  lineHeight: 1.5,
};

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

export const SubtitleNode = memo(function SubtitleNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes, edges } = useCanvasStore();
  const payload = data.payload;
  const [tab, setTab] = useState<"edit" | "settings">("edit");

  const update = useCallback((patch: Partial<SubtitleNodeData>) => updateNodeData(id, patch), [id, updateNodeData]);

  // Find connected video URL from source nodes
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

  const transcribeMutation = trpc.subtitle.transcribe.useMutation({
    onSuccess: (result) => {
      update({
        entries: result.entries,
        language: result.language,
        status: "done",
        errorMessage: undefined,
      });
      toast.success(`转录完成，共 ${result.entries.length} 条字幕，语言：${result.language}`);
    },
    onError: (err) => {
      update({ status: "failed", errorMessage: err.message });
      toast.error("转录失败：" + err.message);
    },
  });

  const burnMutation = trpc.subtitle.burnIn.useMutation({
    onSuccess: (result) => {
      update({ outputUrl: result.url, status: "done" });
      toast.success("字幕烧录完成");
    },
    onError: (err) => {
      update({ status: "failed", errorMessage: err.message });
      toast.error("字幕烧录失败：" + err.message);
    },
  });

  const exportSRTMutation = trpc.subtitle.exportSRT.useMutation({
    onSuccess: (result) => {
      // Download SRT as file
      const blob = new Blob([result.srt], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "subtitles.srt";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("SRT 文件已下载");
    },
    onError: (err) => toast.error("导出失败：" + err.message),
  });

  const handleTranscribe = () => {
    const videoUrl = payload.inputVideoUrl || findSourceVideoUrl();
    if (!videoUrl) { toast.error("请先连接一个视频节点或填写视频 URL"); return; }
    update({ status: "transcribing" });
    transcribeMutation.mutate({ audioUrl: videoUrl, language: payload.language || undefined });
  };

  const handleBurnIn = () => {
    const videoUrl = payload.inputVideoUrl || findSourceVideoUrl();
    if (!videoUrl) { toast.error("请先填写视频 URL"); return; }
    if (!payload.entries?.length) { toast.error("没有字幕数据，请先转录或手动添加字幕"); return; }
    update({ status: "burning" });
    burnMutation.mutate({
      videoUrl,
      entries: payload.entries,
      fontSize: payload.fontSize,
      fontColor: payload.fontColor,
    });
  };

  const handleExportSRT = () => {
    if (!payload.entries?.length) { toast.error("没有字幕数据"); return; }
    exportSRTMutation.mutate({ entries: payload.entries });
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
    const entries = (payload.entries ?? []).filter((_, i) => i !== index);
    update({ entries });
  };

  const isTranscribing = payload.status === "transcribing" || transcribeMutation.isPending;
  const isBurning = payload.status === "burning" || burnMutation.isPending;

  return (
    <BaseNode id={id} selected={selected} nodeType="subtitle" title={data.title} minHeight={240} resizable>
      <Handle type="target" position={Position.Top} id="input" style={{ background: accent }} />

      <div className="flex flex-col gap-3 p-3.5">

        {/* Tab bar */}
        <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "oklch(0.09 0.006 260)", border: "1px solid oklch(0.18 0.008 260)" }}>
          {(["edit", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="nodrag flex-1 py-1.5 rounded-md text-[10.5px] font-medium transition-all"
              style={{
                background: tab === t ? accentA(0.18) : "transparent",
                border: `1px solid ${tab === t ? accentA(0.40) : "transparent"}`,
                color: tab === t ? accent : "oklch(0.48 0.008 260)",
                cursor: "pointer",
              }}
            >
              {t === "edit" ? "字幕编辑" : "烧录设置"}
            </button>
          ))}
        </div>

        {/* Status */}
        {(isTranscribing || isBurning) && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: accentA(0.08), border: `1px solid ${accentA(0.3)}` }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />
            <span className="text-xs" style={{ color: accent }}>{isTranscribing ? "Whisper 转录中..." : "FFmpeg 烧录中..."}</span>
          </div>
        )}

        {payload.status === "failed" && payload.errorMessage && (
          <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.20 25 / 0.08)", border: "1px solid oklch(0.62 0.20 25 / 0.3)" }}>
            <p className="text-xs" style={{ color: "oklch(0.62 0.20 25)" }}>{payload.errorMessage}</p>
          </div>
        )}

        {tab === "edit" && (
          <>
            {/* Video URL input */}
            <div>
              <label style={labelStyle}>视频 URL（自动从连接节点读取）</label>
              <input
                className="nodrag"
                placeholder="https://..."
                value={payload.inputVideoUrl ?? ""}
                onChange={(e) => update({ inputVideoUrl: e.target.value })}
                style={fieldStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>

            {/* Language */}
            <div>
              <label style={labelStyle}>语言（留空自动检测）</label>
              <input
                className="nodrag"
                placeholder="zh / en / ja / auto"
                value={payload.language ?? ""}
                onChange={(e) => update({ language: e.target.value })}
                style={{ ...fieldStyle, width: 120 }}
              />
            </div>

            {/* Transcribe button */}
            <button
              onClick={handleTranscribe}
              disabled={isTranscribing || isBurning}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
              style={{
                background: isTranscribing ? "oklch(0.13 0.007 260)" : accentA(0.12),
                border: `1px solid ${isTranscribing ? BORDER_DEFAULT : accentA(0.4)}`,
                color: isTranscribing ? "oklch(0.38 0.006 260)" : accent,
                cursor: isTranscribing ? "not-allowed" : "pointer",
              }}
            >
              {isTranscribing
                ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
                : <Captions style={{ width: 12, height: 12 }} />}
              {isTranscribing ? "Whisper 识别中..." : "AI 语音识别生成字幕"}
            </button>

            {/* Subtitle entries list */}
            {(payload.entries?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label style={{ ...labelStyle, marginBottom: 0 }}>字幕条目（{payload.entries!.length}条）</label>
                  <button
                    onClick={() => update({ entries: [] })}
                    className="nodrag flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: "oklch(0.13 0.007 260)", border: "1px solid oklch(0.20 0.008 260)", color: "oklch(0.42 0.006 260)", cursor: "pointer" }}
                  >
                    <X style={{ width: 8, height: 8 }} />
                    清空
                  </button>
                </div>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto nodrag">
                  {payload.entries!.map((entry, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 p-2 rounded-lg"
                      style={{ background: "oklch(0.09 0.006 260)", border: "1px solid oklch(0.16 0.007 260)" }}
                    >
                      <div className="flex flex-col gap-0.5 flex-shrink-0" style={{ width: 88 }}>
                        <input
                          type="number" min={0} step={0.1}
                          value={entry.start.toFixed(2)}
                          onChange={(e) => handleUpdateEntry(i, { start: Number(e.target.value) })}
                          className="nodrag"
                          style={{ ...fieldStyle, padding: "2px 6px", fontSize: 10, fontFamily: "monospace", width: "100%" }}
                        />
                        <input
                          type="number" min={0} step={0.1}
                          value={entry.end.toFixed(2)}
                          onChange={(e) => handleUpdateEntry(i, { end: Number(e.target.value) })}
                          className="nodrag"
                          style={{ ...fieldStyle, padding: "2px 6px", fontSize: 10, fontFamily: "monospace", width: "100%" }}
                        />
                        <span style={{ fontSize: 9, color: "oklch(0.40 0.006 260)", textAlign: "center" }}>
                          {formatTime(entry.start)} → {formatTime(entry.end)}
                        </span>
                      </div>
                      <input
                        value={entry.text}
                        onChange={(e) => handleUpdateEntry(i, { text: e.target.value })}
                        className="nodrag flex-1"
                        style={{ ...fieldStyle, fontSize: 11 }}
                        placeholder="字幕文本..."
                      />
                      <button
                        onClick={() => handleDeleteEntry(i)}
                        className="nodrag p-1 rounded flex-shrink-0"
                        style={{ color: "oklch(0.42 0.006 260)", cursor: "pointer" }}
                      >
                        <Trash2 style={{ width: 10, height: 10 }} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add entry button */}
            <button
              onClick={handleAddEntry}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10px] transition-all"
              style={{ background: "oklch(0.12 0.007 260)", border: "1px solid oklch(0.22 0.008 260)", color: "oklch(0.48 0.008 260)", cursor: "pointer" }}
            >
              <Plus style={{ width: 10, height: 10 }} />
              手动添加字幕条目
            </button>

            {/* Export SRT */}
            {(payload.entries?.length ?? 0) > 0 && (
              <button
                onClick={handleExportSRT}
                disabled={exportSRTMutation.isPending}
                className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10px] transition-all"
                style={{
                  background: accentA(0.08), border: `1px solid ${accentA(0.25)}`,
                  color: accent, cursor: "pointer",
                }}
              >
                <Download style={{ width: 10, height: 10 }} />
                导出 SRT 字幕文件
              </button>
            )}
          </>
        )}

        {tab === "settings" && (
          <>
            {/* Font size */}
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>字体大小</label>
                <span style={{ fontSize: 10, color: "oklch(0.50 0.008 260)" }}>{payload.fontSize ?? 22}px</span>
              </div>
              <input
                type="range" min={12} max={40} step={1}
                value={payload.fontSize ?? 22}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
                className="nodrag w-full"
                style={{ accentColor: accent }}
              />
            </div>

            {/* Font color */}
            <div>
              <label style={labelStyle}>字幕颜色</label>
              <div className="flex gap-1.5">
                {FONT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => update({ fontColor: c.value })}
                    className="nodrag flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all"
                    style={{
                      background: payload.fontColor === c.value ? accentA(0.15) : "oklch(0.09 0.006 260)",
                      border: `1px solid ${payload.fontColor === c.value ? accentA(0.50) : "oklch(0.20 0.008 260)"}`,
                      color: payload.fontColor === c.value ? accent : "oklch(0.50 0.008 260)",
                      cursor: "pointer",
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Output video */}
            {payload.outputUrl && (
              <div className="flex flex-col gap-1.5">
                <label style={labelStyle}>烧录后视频</label>
                <video
                  key={payload.outputUrl}
                  src={`/api/video-proxy?url=${encodeURIComponent(payload.outputUrl)}`}
                  controls
                  className="w-full rounded-lg nodrag"
                  style={{ maxHeight: 120, display: "block", border: `1px solid ${accentA(0.4)}` }}
                  preload="metadata"
                />
                <a
                  href={`/api/video-proxy?url=${encodeURIComponent(payload.outputUrl)}&download=1`}
                  download
                  className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
                  style={{ background: accentA(0.08), border: `1px solid ${accentA(0.25)}`, color: accent, textDecoration: "none" }}
                >
                  <Download style={{ width: 10, height: 10 }} />
                  下载带字幕视频
                </a>
                <button
                  onClick={() => update({ outputUrl: undefined, status: "done" })}
                  className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
                  style={{ background: "oklch(0.12 0.007 260)", border: "1px solid oklch(0.22 0.008 260)", color: "oklch(0.42 0.006 260)", cursor: "pointer" }}
                >
                  <RotateCcw style={{ width: 9, height: 9 }} />
                  重置烧录
                </button>
              </div>
            )}

            {/* Burn in button */}
            <button
              onClick={handleBurnIn}
              disabled={isBurning || !(payload.entries?.length)}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: isBurning || !(payload.entries?.length) ? "oklch(0.13 0.007 260)" : accentA(0.15),
                border: `1px solid ${isBurning || !(payload.entries?.length) ? BORDER_DEFAULT : accentA(0.5)}`,
                color: isBurning || !(payload.entries?.length) ? "oklch(0.38 0.006 260)" : accent,
                cursor: isBurning || !(payload.entries?.length) ? "not-allowed" : "pointer",
              }}
            >
              {isBurning
                ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
                : <Flame style={{ width: 12, height: 12 }} />}
              {isBurning ? "FFmpeg 烧录中..." : "烧录字幕到视频"}
            </button>
          </>
        )}

      </div>

      <Handle type="source" position={Position.Bottom} id="output" style={{ background: accent }} />
    </BaseNode>
  );
});
