import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { handleStyle } from "../../../lib/handleStyle";
import { useHoverStore } from "../../../hooks/useHoverStore";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ClipNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { downloadMedia } from "@/lib/download";
import {
  Scissors, Play, Pause, Loader2, Download, RotateCcw,
  ArrowRight, Volume2, Music, Film,
} from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "clip";
    title: string;
    payload: ClipNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.68 0.20 55)";
const accentA = (a: number) => `oklch(0.68 0.20 55 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${cs}`;
}

// ── Dual-range trim bar ───────────────────────────────────────────────────────

function TrimBar({
  duration, startTime, endTime, currentTime,
  onStartChange, onEndChange, onSeek,
}: {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
  onSeek: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const pct = (v: number) => `${(v / duration) * 100}%`;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Track */}
      <div
        ref={trackRef}
        className="nodrag relative h-6 rounded-md cursor-pointer select-none"
        style={{ background: "var(--c-input)", border: `1px solid var(--c-bd2)` }}
        onClick={handleTrackClick}
      >
        {/* Selected range */}
        <div
          className="absolute top-0 bottom-0 rounded-sm"
          style={{
            left: pct(startTime),
            width: `${((endTime - startTime) / duration) * 100}%`,
            background: accentA(0.25),
            border: `1px solid ${accentA(0.5)}`,
            pointerEvents: "none",
          }}
        />
        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5"
          style={{
            left: pct(Math.min(Math.max(currentTime, 0), duration)),
            background: "var(--c-t1)",
            pointerEvents: "none",
          }}
        />
        {/* Start thumb */}
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={startTime}
          onChange={(e) => {
            const v = Number(e.target.value);
            onStartChange(Math.min(v, endTime - 0.5));
          }}
          className="nodrag absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style={{ zIndex: 2 }}
          title={`入点: ${fmt(startTime)}`}
        />
        {/* End thumb */}
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={endTime}
          onChange={(e) => {
            const v = Number(e.target.value);
            onEndChange(Math.max(v, startTime + 0.5));
          }}
          className="nodrag absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style={{ zIndex: 3 }}
          title={`出点: ${fmt(endTime)}`}
        />
        {/* Start handle visual */}
        <div
          className="absolute top-0 bottom-0 w-1 rounded-l"
          style={{ left: pct(startTime), background: accent, pointerEvents: "none" }}
        />
        {/* End handle visual */}
        <div
          className="absolute top-0 bottom-0 w-1 rounded-r"
          style={{ left: `calc(${pct(endTime)} - 4px)`, background: accent, pointerEvents: "none" }}
        />
      </div>
      {/* Time labels */}
      <div className="flex justify-between" style={{ fontSize: 10, color: "var(--c-t4)" }}>
        <span style={{ color: accent }}>入 {fmt(startTime)}</span>
        <span>总 {fmt(duration)}</span>
        <span style={{ color: accent }}>出 {fmt(endTime)}</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export const ClipNode = memo(function ClipNode({ id, selected, data }: Props) {
  const handlesActive = useHoverStore((s) => s.nodeId === id) || !!selected;
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewMode, setPreviewMode] = useState<"source" | "output">("source");
  const videoRef = useRef<HTMLVideoElement>(null);

  const update = useCallback(
    (key: keyof ClipNodeData, value: unknown) => updateNodeData(id, { [key]: value }),
    [id, updateNodeData],
  );

  // ── Auto-detect connected upstream nodes ──────────────────────────────────
  // Split into two primitive-returning selectors to avoid object identity
  // churn that would cause Zustand to re-subscribe on every store change.
  const inputVideoUrl = useCanvasStore(
    useCallback((s: ReturnType<typeof useCanvasStore.getState>) => {
      for (const edge of s.edges.filter(e => e.target === id && e.targetHandle === "video-in")) {
        const node = s.nodes.find(n => n.id === edge.source);
        if (!node) continue;
        const p = node.data.payload as Record<string, unknown>;
        // Covers: video_task (resultVideoUrl), clip/merge/overlay/subtitle/subtitle_motion/smart_cut (outputUrl), asset (url)
        const url = (p.resultVideoUrl ?? p.outputUrl ?? (p.type === "video" ? p.url : undefined)) as string | undefined;
        if (url) return url;
      }
      return null;
    }, [id]),
  );

  const inputAudioUrl = useCanvasStore(
    useCallback((s: ReturnType<typeof useCanvasStore.getState>) => {
      for (const edge of s.edges.filter(e => e.target === id && e.targetHandle === "audio-in")) {
        const node = s.nodes.find(n => n.id === edge.source);
        if (!node) continue;
        if (node.data.nodeType === "audio") {
          const p = node.data.payload as Record<string, unknown>;
          if (p.url) return p.url as string;
        }
      }
      return null;
    }, [id]),
  );

  const activeVideoUrl = inputVideoUrl ?? payload.inputVideoUrl ?? null;
  const activeAudioUrl = inputAudioUrl ?? payload.inputAudioUrl ?? null;

  const duration = payload.sourceDuration ?? 0;
  const startTime = payload.startTime ?? 0;
  const endTime = payload.endTime ?? (payload.sourceDuration ?? Infinity);
  const speed = Math.max(0.01, payload.speed ?? 1.0);
  const audioVolume = payload.audioVolume ?? 1.0;

  // When source video loads, capture duration and init trim points
  const handleVideoMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const dur = (e.target as HTMLVideoElement).duration;
    if (!isNaN(dur) && dur > 0 && Math.abs(dur - duration) > 0.1) {
      updateNodeData(id, {
        sourceDuration: dur,
        startTime: 0,
        endTime: dur,
        status: "idle",
        outputUrl: undefined,
      });
    }
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.target as HTMLVideoElement;
    setCurrentTime(v.currentTime);
    // Use !v.paused instead of isPlaying to avoid stale-closure misses during
    // the window between v.play() being called and the next React render
    if (!v.paused && v.currentTime >= endTime) {
      v.pause();
      v.currentTime = startTime;
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) { v.pause(); setIsPlaying(false); }
    else { v.play().then(() => setIsPlaying(true)).catch(() => {}); }
  };

  // Clamp playback to trim range — poll while playing
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isPlaying) return;
    const timerId = setInterval(() => {
      if (v.currentTime >= endTime) {
        v.pause();
        v.currentTime = startTime;
        setIsPlaying(false);
      }
    }, 100);
    return () => clearInterval(timerId);
  }, [isPlaying, endTime, startTime]);

  const seekToStart = () => {
    if (videoRef.current) videoRef.current.currentTime = startTime;
    setCurrentTime(startTime);
  };

  // ── Trim mutation ──────────────────────────────────────────────────────────
  const trimMutation = trpc.clip.trimVideo.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, {
        status: "done",
        outputUrl: result.url,
        outputDuration: result.duration,
      });
      setPreviewMode("output");
      toast.success("剪辑完成");
    },
    onError: (err) => {
      updateNodeData(id, { status: "failed", errorMessage: err.message });
      toast.error("剪辑失败：" + err.message);
    },
  });

  const handleTrim = () => {
    if (trimMutation.isPending || payload.status === "processing") return;
    if (!activeVideoUrl) { toast.error("请先连接视频节点"); return; }
    if (endTime <= startTime) { toast.error("出点必须大于入点"); return; }

    update("status", "processing");
    trimMutation.mutate({
      inputUrl: activeVideoUrl,
      startTime,
      endTime,
      speed: Math.abs(speed - 1.0) > 0.01 ? speed : undefined,
      audioUrl: activeAudioUrl ?? undefined,
      audioVolume: activeAudioUrl ? audioVolume : undefined,
    });
  };

  const handleReset = () => {
    updateNodeData(id, { status: "idle", outputUrl: undefined, outputDuration: undefined, errorMessage: undefined });
    setPreviewMode("source");
  };

  const handleDownload = () => {
    if (!payload.outputUrl) return;
    void downloadMedia(payload.outputUrl, `clip-${Date.now()}.mp4`);
  };

  const isProcessing = trimMutation.isPending || payload.status === "processing";
  const clipDuration = (endTime - startTime) / speed;

  const displayUrl = previewMode === "output" && payload.outputUrl
    ? payload.outputUrl
    : activeVideoUrl ?? undefined;

  return (
    <BaseNode id={id} selected={selected} nodeType="clip" title={data.title} minHeight={280} resizable showHandles={false}>
      {/* Input handles — square = target/receives */}
      <Handle
        type="target"
        position={Position.Left}
        id="video-in"
        style={{ ...handleStyle(accent, handlesActive, "square"), top: "35%", left: -7 }}
        title="视频输入 ← 连接视频任务或素材"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="audio-in"
        style={{ ...handleStyle("oklch(0.68 0.20 340)", handlesActive, "square"), top: "65%", left: -7 }}
        title="音频输入 ← 连接音频节点"
      />
      {/* Output handle — circle = source/sends */}
      <Handle
        type="source"
        position={Position.Right}
        id="clip-out"
        style={{ ...handleStyle(accent, handlesActive, "circle"), right: -7 }}
        title="剪辑输出 → 连接素材节点保存"
      />

      <div className="flex flex-col gap-3 p-3.5">

        {/* No source state */}
        {!activeVideoUrl && (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg py-6"
            style={{ background: accentA(0.05), border: `1.5px dashed ${accentA(0.25)}` }}
          >
            <ArrowRight style={{ width: 20, height: 20, color: "var(--c-t4)" }} />
            <span style={{ fontSize: 11, color: "var(--c-t4)" }}>连接视频任务或素材节点</span>
          </div>
        )}

        {/* Video player */}
        {activeVideoUrl && (
          <>
            {/* Mode toggle */}
            {payload.outputUrl && (
              <div
                className="flex gap-0.5 p-0.5 rounded-lg"
                style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}
              >
                {(["source", "output"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPreviewMode(m)}
                    className="nodrag flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10.5px] font-medium transition-all"
                    style={{
                      background: previewMode === m ? accentA(0.18) : "transparent",
                      border: `1px solid ${previewMode === m ? accentA(0.40) : "transparent"}`,
                      color: previewMode === m ? accent : "var(--c-t3)",
                      cursor: "pointer",
                    }}
                  >
                    {m === "source" ? <Film style={{ width: 10, height: 10 }} /> : <Scissors style={{ width: 10, height: 10 }} />}
                    {m === "source" ? "原视频" : "剪辑结果"}
                  </button>
                ))}
              </div>
            )}

            {/* Video */}
            <div className="relative rounded-lg overflow-hidden" style={{ background: "var(--c-canvas)", border: `1px solid ${accentA(0.25)}` }}>
              <video
                key={displayUrl}
                ref={videoRef}
                src={displayUrl}
                className="w-full nodrag"
                style={{ maxHeight: 200, display: "block" }}
                onLoadedMetadata={handleVideoMetadata}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
                preload="metadata"
              />
              {/* Controls overlay */}
              <div
                className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1.5"
                style={{ background: "oklch(0.06 0.004 260 / 0.8)" }}
              >
                <button
                  onClick={seekToStart}
                  className="nodrag flex items-center justify-center w-5 h-5 rounded transition-all"
                  style={{ color: "var(--c-t2)", background: "none", border: "none", cursor: "pointer" }}
                >
                  <RotateCcw style={{ width: 11, height: 11 }} />
                </button>
                <button
                  onClick={togglePlay}
                  className="nodrag flex items-center justify-center w-6 h-6 rounded-full transition-all"
                  style={{ background: accentA(0.25), border: `1px solid ${accentA(0.5)}`, color: accent, cursor: "pointer" }}
                >
                  {isPlaying ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
                </button>
                <span style={{ fontSize: 10, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(currentTime)}
                </span>
                {/* Mini progress */}
                {duration > 0 && (
                  <div className="flex-1 h-1 rounded-full" style={{ background: "var(--c-bd2)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(currentTime / duration) * 100}%`, background: accent }}
                    />
                  </div>
                )}
                <span style={{ fontSize: 10, color: "var(--c-t4)", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(duration)}
                </span>
              </div>
            </div>

            {/* Only show trim controls in source mode */}
            {previewMode === "source" && duration > 0 && selected && (
              <>
                {/* Trim bar */}
                <TrimBar
                  duration={duration}
                  startTime={startTime}
                  endTime={endTime}
                  currentTime={currentTime}
                  onStartChange={(v) => {
                    update("startTime", v);
                    if (videoRef.current) videoRef.current.currentTime = v;
                  }}
                  onEndChange={(v) => {
                    update("endTime", v);
                  }}
                  onSeek={(v) => {
                    if (videoRef.current) videoRef.current.currentTime = v;
                    setCurrentTime(v);
                  }}
                />

                {/* Clip info */}
                <div
                  className="flex justify-between items-center px-2 py-1.5 rounded-lg"
                  style={{ background: accentA(0.06), border: `1px solid ${accentA(0.20)}` }}
                >
                  <span style={{ fontSize: 10.5, color: "var(--c-t3)" }}>
                    选段时长
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: accent, fontVariantNumeric: "tabular-nums" }}>
                    {fmt(clipDuration)}
                  </span>
                </div>

                {/* Speed control */}
                <div>
                  <label style={labelStyle}>播放速度</label>
                  <div className="flex items-center gap-2">
                    {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((v) => (
                      <button
                        key={v}
                        onClick={() => update("speed", v)}
                        className="nodrag flex-1 py-1 rounded text-[10px] font-medium transition-all"
                        style={{
                          background: Math.abs(speed - v) < 0.01 ? accentA(0.18) : "var(--c-input)",
                          border: `1px solid ${Math.abs(speed - v) < 0.01 ? accentA(0.4) : "var(--c-bd2)"}`,
                          color: Math.abs(speed - v) < 0.01 ? accent : "var(--c-t3)",
                          cursor: "pointer",
                        }}
                      >
                        {v}×
                      </button>
                    ))}
                  </div>
                </div>

                {/* Audio section */}
                {activeAudioUrl && (
                  <div>
                    <label style={labelStyle}>
                      <span className="flex items-center gap-1">
                        <Music style={{ width: 10, height: 10 }} />
                        音频音量
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <Volume2 style={{ width: 12, height: 12, color: "var(--c-t3)", flexShrink: 0 }} />
                      <input
                        type="range"
                        min={0}
                        max={2.0}
                        step={0.05}
                        value={audioVolume}
                        onChange={(e) => update("audioVolume", Number(e.target.value))}
                        className="nodrag flex-1"
                        style={{ accentColor: accent }}
                      />
                      <span style={{ fontSize: 11, color: "var(--c-t3)", width: 32, textAlign: "right" }}>
                        {(audioVolume * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 4 }}>
                      已连接音频轨道，将替换原始音频
                    </p>
                  </div>
                )}

                {/* Process button */}
                <button
                  onClick={handleTrim}
                  disabled={isProcessing}
                  className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: isProcessing ? "var(--c-surface)" : accentA(0.18),
                    borderWidth: 1, borderStyle: "solid",
                    borderColor: isProcessing ? BORDER_DEFAULT : accentA(0.45),
                    color: isProcessing ? "var(--c-t4)" : accent,
                    cursor: isProcessing ? "not-allowed" : "pointer",
                  }}
                >
                  {isProcessing
                    ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
                    : <Scissors style={{ width: 13, height: 13 }} />}
                  {isProcessing ? "处理中，请稍候..." : "执行剪辑"}
                </button>

                {payload.status === "failed" && payload.errorMessage && (
                  <p style={{ fontSize: 10, color: "oklch(0.60 0.18 25)", textAlign: "center" }}>
                    {payload.errorMessage}
                  </p>
                )}
              </>
            )}

            {/* Output result bar */}
            {payload.status === "done" && payload.outputUrl && previewMode === "output" && (
              <div className="flex gap-1.5">
                <div
                  className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                  style={{ background: "oklch(0.72 0.18 155 / 0.08)", border: "1px solid oklch(0.72 0.18 155 / 0.30)" }}
                >
                  <Scissors style={{ width: 11, height: 11, color: "oklch(0.72 0.18 155)", flexShrink: 0 }} />
                  <span style={{ fontSize: 10.5, color: "var(--c-t2)" }}>
                    剪辑完成 · {fmt(payload.outputDuration ?? clipDuration)}
                  </span>
                </div>
                <button
                  onClick={handleDownload}
                  className="nodrag w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                  style={{ background: accentA(0.10), border: `1px solid ${accentA(0.30)}`, color: accent, cursor: "pointer", flexShrink: 0 }}
                  title="下载剪辑"
                >
                  <Download style={{ width: 13, height: 13 }} />
                </button>
                <button
                  onClick={handleReset}
                  className="nodrag w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                  style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer", flexShrink: 0 }}
                  title="重新剪辑"
                >
                  <RotateCcw style={{ width: 13, height: 13 }} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </BaseNode>
  );
});
