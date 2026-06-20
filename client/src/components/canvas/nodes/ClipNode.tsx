import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { ReferenceImageStrip, type StripItem } from "../ReferenceImageStrip";
import { useNodeDocks, useAudioStripItems } from "../../../hooks/useNodeDocks";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { handleStyle } from "../../../lib/handleStyle";
import { useConnectState } from "../../../hooks/useConnectingStore";
import { useHoverStore } from "../../../hooks/useHoverStore";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ClipNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { downloadMedia, mediaFetchUrl } from "@/lib/download";
import { getNodeVideoOutput } from "@/lib/canvasPassthrough";
import {
  Scissors, Play, Pause, Loader2, Download, RotateCcw, Repeat,
  ArrowRight, Volume2, Music, Film, Image as ImageIcon,
  RotateCw, FlipHorizontal, FlipVertical, ChevronDown, ChevronRight, Sliders,
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
  onStartChange, onEndChange, onSeek, markers,
}: {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
  onSeek: (v: number) => void;
  /** 镜头边界标记（上游装配成片的 segStarts）：轨道上画刻度、下方镜号 chips 点击跳转。 */
  markers?: { time: number; label: string }[];
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
        {/* 镜界刻度（来自装配成片 segStarts；纯视觉，不挡拖拽） */}
        {markers?.map((m, i) => (
          <div key={`mk-${i}`} className="absolute top-0 bottom-0"
            style={{ left: pct(Math.min(Math.max(m.time, 0), duration)), width: 1, background: "oklch(0.65 0.20 160 / 0.55)", pointerEvents: "none" }} />
        ))}
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
          className="trim-range nodrag absolute inset-0 w-full h-full opacity-0 cursor-pointer"
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
          className="trim-range nodrag absolute inset-0 w-full h-full opacity-0 cursor-pointer"
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
      {/* 镜号快跳 chips：点击把播放头定位到该镜起点（裁剪入出点对镜界更顺手） */}
      {(markers?.length ?? 0) > 0 && (
        <div className="nodrag" style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {markers!.map((m, i) => (
            <button key={`mc-${i}`} onClick={() => onSeek(m.time)} title={`跳到 ${m.label} 起点（${fmt(m.time)}）`}
              className="nodrag"
              style={{ fontSize: 8.5, fontWeight: 700, padding: "1px 6px", borderRadius: 5, background: "oklch(0.65 0.20 160 / 0.08)", border: "1px solid oklch(0.65 0.20 160 / 0.3)", color: "oklch(0.65 0.20 160)", cursor: "pointer" }}>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Advanced picture/audio editing (collapsible) ──────────────────────────────

function segBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "4px 2px", fontSize: 10, borderRadius: 6, cursor: "pointer",
    borderWidth: 1, borderStyle: "solid",
    borderColor: active ? accentA(0.45) : BORDER_DEFAULT,
    background: active ? accentA(0.18) : "var(--c-input)",
    color: active ? accent : "var(--c-t3)", fontWeight: active ? 600 : 400,
  };
}

function EqSlider({ label, value, min, max, neutral, onChange }: {
  label: string; value: number; min: number; max: number; neutral: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 40, fontSize: 10, color: "var(--c-t3)", flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} step={0.05} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="nodrag flex-1" style={{ accentColor: accent }} />
      <button onClick={() => onChange(neutral)} title="重置"
        style={{ fontSize: 9, color: "var(--c-t4)", cursor: "pointer", width: 28, textAlign: "right" }}>
        {value.toFixed(2)}
      </button>
    </div>
  );
}

function AdvancedEditPanel({ payload, update, hasAudioTracks }: {
  payload: ClipNodeData;
  update: (field: keyof ClipNodeData, value: unknown) => void;
  hasAudioTracks: boolean;
}) {
  const [open, setOpen] = useState(false);
  const aspect = payload.aspect ?? "original";
  const rotate = payload.rotate ?? 0;
  const preset = payload.colorPreset ?? "none";
  const out = payload.output ?? {};
  return (
    <div style={{ borderTop: `1px solid ${BORDER_DEFAULT}`, paddingTop: 8 }}>
      <button onClick={() => setOpen((o) => !o)}
        className="nodrag flex items-center gap-1 w-full"
        style={{ fontSize: 11, fontWeight: 600, color: "var(--c-t2)", cursor: "pointer" }}>
        {open ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
        <Sliders style={{ width: 11, height: 11 }} /> 高级编辑
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 mt-2">
          {/* Fade in / out */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label style={labelStyle}>淡入 (秒)</label>
              <input type="number" min={0} max={10} step={0.1} value={payload.fadeIn ?? 0}
                onChange={(e) => update("fadeIn", Math.max(0, Number(e.target.value) || 0))}
                className="nodrag w-full px-2 py-1 rounded text-[11px]"
                style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }} />
            </div>
            <div className="flex-1">
              <label style={labelStyle}>淡出 (秒)</label>
              <input type="number" min={0} max={10} step={0.1} value={payload.fadeOut ?? 0}
                onChange={(e) => update("fadeOut", Math.max(0, Number(e.target.value) || 0))}
                className="nodrag w-full px-2 py-1 rounded text-[11px]"
                style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }} />
            </div>
          </div>

          {/* Aspect ratio (center crop) */}
          <div>
            <label style={labelStyle}>画面比例（居中裁剪）</label>
            <div className="flex items-center gap-1.5">
              {(["original", "9:16", "16:9", "1:1"] as const).map((a) => (
                <button key={a} onClick={() => update("aspect", a)} style={segBtn(aspect === a)}>
                  {a === "original" ? "原始" : a}
                </button>
              ))}
            </div>
          </div>

          {/* Rotate / flip */}
          <div>
            <label style={labelStyle}>旋转 / 翻转</label>
            <div className="flex items-center gap-1.5">
              {([[0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"]] as const).map(([deg, lbl]) => (
                <button key={deg} onClick={() => update("rotate", deg)} style={segBtn(rotate === deg)}>
                  {deg === 0 ? lbl : <span className="flex items-center justify-center gap-0.5"><RotateCw style={{ width: 9, height: 9 }} />{lbl}</span>}
                </button>
              ))}
              <button onClick={() => update("flipH", !payload.flipH)} style={segBtn(!!payload.flipH)} title="水平镜像">
                <FlipHorizontal style={{ width: 11, height: 11, margin: "0 auto" }} />
              </button>
              <button onClick={() => update("flipV", !payload.flipV)} style={segBtn(!!payload.flipV)} title="垂直翻转">
                <FlipVertical style={{ width: 11, height: 11, margin: "0 auto" }} />
              </button>
            </div>
          </div>

          {/* Color preset / LUT look */}
          <div>
            <label style={labelStyle}>调色预设</label>
            <div className="flex items-center gap-1 flex-wrap">
              {([["none", "无"], ["cinematic", "电影感"], ["warm", "暖色"], ["cool", "冷色"], ["bw", "黑白"], ["vintage", "复古"], ["vivid", "鲜艳"]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => update("colorPreset", k)} style={{ ...segBtn(preset === k), flex: "0 0 auto", padding: "4px 8px" }}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* Color filters */}
          <div className="flex flex-col gap-1.5">
            <label style={labelStyle}>画面微调</label>
            <EqSlider label="亮度" value={payload.brightness ?? 0} min={-1} max={1} neutral={0} onChange={(v) => update("brightness", v)} />
            <EqSlider label="对比度" value={payload.contrast ?? 1} min={0} max={2} neutral={1} onChange={(v) => update("contrast", v)} />
            <EqSlider label="饱和度" value={payload.saturation ?? 1} min={0} max={3} neutral={1} onChange={(v) => update("saturation", v)} />
          </div>

          {/* Audio processing */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => update("reverse", !payload.reverse)} style={segBtn(!!payload.reverse)} title="视频与音频倒放">倒放</button>
            <button onClick={() => update("muteOriginal", !payload.muteOriginal)} style={segBtn(!!payload.muteOriginal)} title="去掉视频自带的声音">静音原声</button>
            <button onClick={() => update("denoiseAudio", !payload.denoiseAudio)} style={segBtn(!!payload.denoiseAudio)} title="对原声做降噪 (afftdn)">原声降噪</button>
            <button onClick={() => update("loudnorm", !payload.loudnorm)} style={segBtn(!!payload.loudnorm)} title="EBU R128 响度标准化（统一音量）">响度标准化</button>
            {hasAudioTracks && (
              <button onClick={() => update("ducking", !payload.ducking)} style={segBtn(!!payload.ducking)} title="配乐遇到「人声」轨自动压低（需在某条轨标记为人声）">语音闪避</button>
            )}
            {hasAudioTracks && (
              <button onClick={() => update("originalIsVoice", !payload.originalIsVoice)} style={segBtn(!!payload.originalIsVoice)} title="把原声当作人声轨（用于语音闪避）">原声=人声</button>
            )}
          </div>

          {/* Original audio volume (when not muted) */}
          {!payload.muteOriginal && (
            <EqSlider label="原声量" value={payload.originalVolume ?? 1} min={0} max={2} neutral={1} onChange={(v) => update("originalVolume", v)} />
          )}

          {/* Output settings */}
          <div className="flex flex-col gap-1.5">
            <label style={labelStyle}>输出设置</label>
            <div className="flex items-center gap-1.5">
              {(["source", "720p", "1080p", "4k"] as const).map((r) => (
                <button key={r} onClick={() => update("output", { ...out, resolution: r })} style={segBtn((out.resolution ?? "source") === r)}>
                  {r === "source" ? "原始" : r}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {([["mp4", "MP4"], ["webm", "WebM"]] as const).map(([f, lbl]) => (
                <button key={f} onClick={() => update("output", { ...out, format: f })} style={segBtn((out.format ?? "mp4") === f)}>{lbl}</button>
              ))}
              <span style={{ fontSize: 10, color: "var(--c-t4)", marginLeft: 4 }}>帧率</span>
              <input type="number" min={0} max={60} step={1} value={out.fps ?? 0}
                onChange={(e) => update("output", { ...out, fps: Math.max(0, Math.min(60, Number(e.target.value) || 0)) || undefined })}
                placeholder="原始"
                className="nodrag w-14 px-2 py-1 rounded text-[11px]"
                style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Multi-track audio mixer ────────────────────────────────────────────────────

function AudioTracksPanel({ sources, payload, setTrack }: {
  sources: { id: string; title: string; url: string }[];
  payload: ClipNodeData;
  setTrack: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const cfg = payload.audioTracks ?? {};
  const anySolo = sources.some((s) => cfg[s.id]?.solo);
  return (
    <div className="flex flex-col gap-1.5">
      <label style={labelStyle}>
        <span className="flex items-center gap-1"><Music style={{ width: 10, height: 10 }} />音轨（{sources.length}）</span>
      </label>
      {sources.map((s, i) => {
        const c = cfg[s.id] ?? {};
        const dimmed = anySolo && !c.solo;
        return (
          <div key={s.id} className="flex flex-col gap-1 px-2 py-1.5 rounded-lg"
            style={{ background: accentA(0.05), border: `1px solid ${accentA(0.18)}`, opacity: dimmed ? 0.5 : 1 }}>
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--c-t2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1}. {s.title}</span>
              <button onClick={() => setTrack(s.id, { muted: !c.muted })} style={{ ...segBtn(!!c.muted), flex: "0 0 auto", padding: "2px 6px" }} title="静音">M</button>
              <button onClick={() => setTrack(s.id, { solo: !c.solo })} style={{ ...segBtn(!!c.solo), flex: "0 0 auto", padding: "2px 6px" }} title="独奏">S</button>
              <button onClick={() => setTrack(s.id, { isVoice: !c.isVoice })} style={{ ...segBtn(!!c.isVoice), flex: "0 0 auto", padding: "2px 6px" }} title="标记为人声（语音闪避的压低源）">声</button>
            </div>
            <div className="flex items-center gap-2">
              <Volume2 style={{ width: 11, height: 11, color: "var(--c-t3)", flexShrink: 0 }} />
              <input type="range" min={0} max={2} step={0.05} value={c.volume ?? 1}
                onChange={(e) => setTrack(s.id, { volume: Number(e.target.value) })}
                className="nodrag flex-1" style={{ accentColor: accent }} />
              <span style={{ fontSize: 10, color: "var(--c-t4)", width: 30, textAlign: "right" }}>{((c.volume ?? 1) * 100).toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>延迟</span>
              <input type="number" min={0} max={600} step={0.1} value={c.delay ?? 0}
                onChange={(e) => setTrack(s.id, { delay: Math.max(0, Number(e.target.value) || 0) || undefined })}
                className="nodrag w-12 px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }} />
              <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>淡入</span>
              <input type="number" min={0} max={30} step={0.1} value={c.fadeIn ?? 0}
                onChange={(e) => setTrack(s.id, { fadeIn: Math.max(0, Number(e.target.value) || 0) || undefined })}
                className="nodrag w-11 px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }} />
              <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>淡出</span>
              <input type="number" min={0} max={30} step={0.1} value={c.fadeOut ?? 0}
                onChange={(e) => setTrack(s.id, { fadeOut: Math.max(0, Number(e.target.value) || 0) || undefined })}
                className="nodrag w-11 px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }} />
            </div>
          </div>
        );
      })}
      <p style={{ fontSize: 9.5, color: "var(--c-t4)" }}>多条音轨与原声混音；静音原声可仅用外部音轨。</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export const ClipNode = memo(function ClipNode({ id, selected, data }: Props) {
  const handlesActive = useHoverStore((s) => s.nodeId === id) || !!selected;
  const connectState = useConnectState(id, "clip");
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;

  // 左侧吸附窗「音频」波形项：上游音频 + 本节点输入音频（只读，放末尾）。
  const upstreamAudio = useAudioStripItems(id);
  const audioItems: StripItem[] = useMemo(() => {
    const own: StripItem[] = payload.inputAudioUrl?.trim()
      ? [{ id: "inaudio:" + payload.inputAudioUrl, url: payload.inputAudioUrl, name: "输入音频", label: "音频", kind: "audio", removable: false }]
      : [];
    return [...upstreamAudio, ...own];
  }, [upstreamAudio, payload.inputAudioUrl]);
  const docks = useNodeDocks(id, { hasRef: audioItems.length > 0, hasPrompt: false }, { ref: audioItems.map((a) => a.id).join(",") });
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopPlayback, setLoopPlayback] = useState(false);
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
        // Covers: video_task (resultVideoUrl), clip/merge/overlay/subtitle/… (outputUrl),
        // asset (url, video-only), and skips image-output comfyui_workflow runs.
        const url = getNodeVideoOutput(node.data.nodeType, p);
        if (url) return url;
      }
      return null;
    }, [id]),
  );

  // 上游「已装配并完成合并」的成片镜界（segStarts + 镜号）。字符串 key 订阅（zustand
  // 规则：selector 返回原始值），仅当剪辑源就是该成片时才在 TrimBar 上显示镜界标记。
  const shotMarkersKey = useCanvasStore(
    useCallback((s: ReturnType<typeof useCanvasStore.getState>) => {
      for (const edge of s.edges.filter(e => e.target === id && e.targetHandle === "video-in")) {
        const node = s.nodes.find(n => n.id === edge.source);
        if (node?.data.nodeType !== "merge") continue;
        const mp = node.data.payload as { segStarts?: number[]; sourceShots?: { num?: number | string }[]; outputUrl?: string };
        if (!mp.segStarts?.length || !mp.outputUrl) continue;
        return JSON.stringify({ url: mp.outputUrl, starts: mp.segStarts, nums: (mp.sourceShots ?? []).map((x) => x.num ?? null) });
      }
      return "";
    }, [id]),
  );

  // All connected audio sources (multi-track). Stable string key avoids re-subscribe
  // churn; parsed back into objects below.
  const audioSourcesKey = useCanvasStore(
    useCallback((s: ReturnType<typeof useCanvasStore.getState>) => {
      const out: string[] = [];
      for (const edge of s.edges.filter(e => e.target === id && e.targetHandle === "audio-in")) {
        const node = s.nodes.find(n => n.id === edge.source);
        if (!node) continue;
        const p = node.data.payload as Record<string, unknown>;
        // Accept AudioNodes AND uploaded audio ASSETS (mirrors MergeNode bg-music
        // detection) — an audio asset wired to audio-in was previously dropped.
        const isAudioNode = node.data.nodeType === "audio";
        const isAudioAsset = node.data.nodeType === "asset"
          && (p.type === "audio" || (typeof p.mimeType === "string" && (p.mimeType as string).startsWith("audio/")));
        if (!isAudioNode && !isAudioAsset) continue;
        if (p.url) out.push(`${node.id}\t${node.data.title ?? "音频"}\t${p.url as string}`);
      }
      return out.join("\n");
    }, [id]),
  );
  const audioSources = audioSourcesKey
    ? audioSourcesKey.split("\n").map((l) => { const [nid, title, url] = l.split("\t"); return { id: nid, title, url }; })
    : [];

  const activeVideoUrl = inputVideoUrl ?? payload.inputVideoUrl ?? null;

  const shotMarkers = useMemo(() => {
    if (!shotMarkersKey) return [];
    const g = JSON.parse(shotMarkersKey) as { url: string; starts: number[]; nums: (number | string | null)[] };
    if (g.url !== activeVideoUrl) return []; // 剪辑源不是该成片 → 标记会错位，不显示
    return g.starts.map((t, i) => ({ time: t, label: `镜${g.nums[i] ?? i + 1}` }));
  }, [shotMarkersKey, activeVideoUrl]);

  const duration = payload.sourceDuration ?? 0;
  const startTime = payload.startTime ?? 0;
  const endTime = payload.endTime ?? (payload.sourceDuration ?? Infinity);
  const speed = Math.max(0.01, payload.speed ?? 1.0);

  // 在播放头分割为两段：本节点截到播放头，再建一个剪辑节点承接 [播放头, 出点]，
  // 连到同一视频源（并直接带上源 URL，单独也能用）。复制本段的主要视觉/速度设置。
  const handleSplit = useCallback(() => {
    if (!activeVideoUrl) { toast.error("请先连接或设置视频源"); return; }
    const at = currentTime;
    const end = Number.isFinite(endTime) ? endTime : duration;
    if (!(at > startTime + 0.1 && at < end - 0.1)) { toast.error("请把播放头移到选段中间再分割"); return; }
    const st = useCanvasStore.getState();
    const self = st.nodes.find((n) => n.id === id);
    if (!self) return;
    const srcEdge = st.edges.find((e) => e.target === id && e.targetHandle === "video-in");
    const carry: Partial<ClipNodeData> = {
      inputVideoUrl: activeVideoUrl, sourceDuration: duration || undefined,
      startTime: at, endTime: end,
      speed: payload.speed, audioVolume: payload.audioVolume,
      reverse: payload.reverse, rotate: payload.rotate, flipH: payload.flipH, flipV: payload.flipV,
      brightness: payload.brightness, contrast: payload.contrast, saturation: payload.saturation,
      aspect: payload.aspect, muteOriginal: payload.muteOriginal, originalVolume: payload.originalVolume,
    };
    const w = (self.style?.width as number | undefined) ?? 360;
    const newNode = st.addNode("clip", { x: self.position.x + w + 48, y: self.position.y });
    st.updateNodeData(newNode.id, carry);
    if (srcEdge) st.onConnect({ source: srcEdge.source, target: newNode.id, sourceHandle: srcEdge.sourceHandle ?? null, targetHandle: "video-in" });
    update("endTime", at); // 本段截到分割点
    toast.success("已在播放头分割为两段");
  }, [activeVideoUrl, currentTime, startTime, endTime, duration, id, payload, update]);

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
      if (loopPlayback) { v.currentTime = startTime; } // loop the selected range
      else { v.pause(); v.currentTime = startTime; setIsPlaying(false); }
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
        if (loopPlayback) { v.currentTime = startTime; }
        else { v.pause(); v.currentTime = startTime; setIsPlaying(false); }
      }
    }, 100);
    return () => clearInterval(timerId);
  }, [isPlaying, endTime, startTime, loopPlayback]);

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
    const edit = {
      reverse: payload.reverse || undefined,
      rotate: payload.rotate || undefined,
      flipH: payload.flipH || undefined,
      flipV: payload.flipV || undefined,
      brightness: payload.brightness ?? undefined,
      contrast: payload.contrast ?? undefined,
      saturation: payload.saturation ?? undefined,
      aspect: payload.aspect && payload.aspect !== "original" ? payload.aspect : undefined,
      fadeIn: payload.fadeIn || undefined,
      fadeOut: payload.fadeOut || undefined,
      muteOriginal: payload.muteOriginal || undefined,
      originalVolume: payload.originalVolume ?? undefined,
      originalIsVoice: payload.originalIsVoice || undefined,
      denoiseAudio: payload.denoiseAudio || undefined,
    };
    const hasEdit = Object.values(edit).some((v) => v !== undefined);

    // Build multi-track audio: per-source settings keyed by node id; respect solo/mute.
    const trackCfg = payload.audioTracks ?? {};
    const anySolo = audioSources.some((s) => trackCfg[s.id]?.solo);
    const allTracks = audioSources
      .filter((s) => { const c = trackCfg[s.id] ?? {}; return anySolo ? c.solo : !c.muted; })
      .map((s) => { const c = trackCfg[s.id] ?? {}; return {
        url: s.url,
        volume: c.volume ?? 1,
        delay: c.delay || undefined,
        fadeIn: c.fadeIn || undefined,
        fadeOut: c.fadeOut || undefined,
        isVoice: c.isVoice || undefined,
      }; });
    // Server enforces audioTracks.max(8); cap (after solo/mute) to avoid a 400.
    const audioTracks = allTracks.slice(0, 8);
    if (allTracks.length > 8) toast.warning(`音轨过多，仅使用前 8 条（共 ${allTracks.length} 条）`);

    const output = payload.output && (payload.output.resolution && payload.output.resolution !== "source"
      || payload.output.fps || (payload.output.format && payload.output.format !== "mp4"))
      ? payload.output : undefined;

    trimMutation.mutate({
      inputUrl: activeVideoUrl,
      projectId: data.projectId,
      nodeId: id,
      startTime,
      endTime,
      speed: Math.abs(speed - 1.0) > 0.01 ? speed : undefined,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      loudnorm: payload.loudnorm || undefined,
      ducking: payload.ducking || undefined,
      colorPreset: payload.colorPreset && payload.colorPreset !== "none" ? payload.colorPreset : undefined,
      output,
      edit: hasEdit ? edit : undefined,
    });
  };

  // ── Extract the current frame as an image (clip cover / still) ───────────────
  const frameMutation = trpc.clip.extractFrame.useMutation({
    onSuccess: (result) => { void downloadMedia(result.url, `frame-${Date.now()}.png`); toast.success("已截取当前帧"); },
    onError: (err) => toast.error("截取失败：" + err.message),
  });
  const handleExtractFrame = () => {
    if (frameMutation.isPending) return;
    if (!activeVideoUrl) { toast.error("请先连接视频节点"); return; }
    frameMutation.mutate({ inputUrl: activeVideoUrl, time: currentTime, projectId: data.projectId, nodeId: id });
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
    <BaseNode id={id} selected={selected} nodeType="clip" title={data.title} minHeight={280} resizable showHandles={false}
      onHeaderHoverChange={docks.onHeaderHoverChange}
      leftDock={
        <ReferenceImageStrip
          images={audioItems}
          open={docks.refOpen}
          accent={accent}
          readOnly
          title="音频"
          readOnlyHint={<>参与本节点的音频<br />（上游 / 输入音轨）</>}
          onClose={() => docks.setRefOpen(false)}
          onRemove={() => {}}
          onMove={() => {}}
          onInsertUrls={() => {}}
          onDropFiles={() => {}}
          onZoom={() => {}}
          onHoverChange={docks.onDockHoverChange}
          onPin={docks.pinRef}
        />
      }>
      {/* Input handles — square = target/receives */}
      <Handle
        type="target"
        position={Position.Left}
        id="video-in"
        style={{ ...handleStyle(accent, handlesActive, "square", connectState.target), top: "35%", left: -7 }}
        title="视频输入 ← 连接视频任务或素材"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="audio-in"
        style={{ ...handleStyle("oklch(0.68 0.20 340)", handlesActive, "square", connectState.target), top: "65%", left: -7 }}
        title="音频输入 ← 连接音频节点"
      />
      {/* Output handle — circle = source/sends */}
      <Handle
        type="source"
        position={Position.Right}
        id="clip-out"
        style={{ ...handleStyle(accent, handlesActive, "circle", connectState.source), right: -7 }}
        title="剪辑输出 → 连接素材节点保存"
      />

      <div className="flex flex-col gap-3 p-3.5 h-full">

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

            {/* Video — fills the (resizable) node, letterboxed to keep aspect. */}
            <div className="relative rounded-lg overflow-hidden" style={{ background: "var(--c-canvas)", border: `1px solid ${accentA(0.25)}`, flex: 1, minHeight: 160 }}>
              <video
                key={displayUrl}
                ref={videoRef}
                src={displayUrl ? mediaFetchUrl(displayUrl) : undefined}
                className="nodrag"
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                loop={loopPlayback}
                onLoadedMetadata={handleVideoMetadata}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
                preload="metadata"
              />
              {isOwnStorageUrl(displayUrl) && (
                <div
                  title="已存储到 MinIO·长期有效"
                  className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
                  style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
                />
              )}
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
                <button
                  onClick={() => setLoopPlayback((v) => !v)}
                  title={loopPlayback ? "循环播放：开（点击关闭）" : "循环播放：关（点击开启）"}
                  className="nodrag flex items-center justify-center w-5 h-5 rounded transition-all"
                  style={{ background: loopPlayback ? accentA(0.3) : "none", border: loopPlayback ? `1px solid ${accentA(0.5)}` : "none", color: loopPlayback ? accent : "var(--c-t2)", cursor: "pointer" }}
                >
                  <Repeat style={{ width: 11, height: 11 }} />
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
                  markers={shotMarkers}
                />

                {/* Precise numeric in / out (frame-accurate, complements the slider) */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label style={labelStyle}>入点 (秒)</label>
                    <input
                      type="number" min={0} max={duration} step={0.1} value={Number(startTime.toFixed(2))}
                      onChange={(e) => { const v = Math.max(0, Math.min(Number(e.target.value), endTime - 0.1)); update("startTime", v); if (videoRef.current) videoRef.current.currentTime = v; }}
                      className="nodrag w-full px-2 py-1 rounded text-[11px]"
                      style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }}
                    />
                  </div>
                  <div className="flex-1">
                    <label style={labelStyle}>出点 (秒)</label>
                    <input
                      type="number" min={0} max={duration} step={0.1} value={Number(endTime.toFixed(2))}
                      onChange={(e) => { const v = Math.max(startTime + 0.1, Math.min(Number(e.target.value), duration)); update("endTime", v); }}
                      className="nodrag w-full px-2 py-1 rounded text-[11px]"
                      style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }}
                    />
                  </div>
                </div>

                {/* 在播放头分割为两段（裁切已由上方双滑块/数值入出点提供） */}
                <button
                  onClick={handleSplit}
                  className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-medium transition-all"
                  style={{ background: accentA(0.10), border: `1px solid ${accentA(0.30)}`, color: accent, cursor: "pointer" }}
                  title="在播放头把本剪辑分成两段（生成第二个剪辑节点承接后半段）"
                >
                  <Scissors style={{ width: 12, height: 12 }} /> 在播放头分割为两段
                </button>

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
                  <div className="flex items-center gap-2 mt-1.5">
                    <span style={{ fontSize: 10, color: "var(--c-t4)", whiteSpace: "nowrap" }}>自定义</span>
                    <input
                      type="number" min={0.1} max={10} step={0.05} value={Number(speed.toFixed(2))}
                      onChange={(e) => { const v = Math.max(0.1, Math.min(Number(e.target.value) || 1, 10)); update("speed", v); }}
                      className="nodrag flex-1 px-2 py-1 rounded text-[11px]"
                      style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t1)" }}
                    />
                    <span style={{ fontSize: 10, color: "var(--c-t4)" }}>×（0.1–10）</span>
                  </div>
                </div>

                {/* Multi-track audio mixer */}
                {audioSources.length > 0 && (
                  <AudioTracksPanel sources={audioSources} payload={payload}
                    setTrack={(nid, patch) => {
                      const cur = payload.audioTracks ?? {};
                      updateNodeData(id, { audioTracks: { ...cur, [nid]: { ...cur[nid], ...patch } } });
                    }} />
                )}

                {/* Advanced picture/audio editing + pro options */}
                <AdvancedEditPanel payload={payload} update={update} hasAudioTracks={audioSources.length > 0} />

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

                <button
                  onClick={handleExtractFrame}
                  disabled={frameMutation.isPending}
                  className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-medium transition-all"
                  style={{ background: "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, color: "var(--c-t2)", cursor: frameMutation.isPending ? "not-allowed" : "pointer" }}
                  title="把当前预览位置的画面导出为 PNG 图片"
                >
                  {frameMutation.isPending ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <ImageIcon style={{ width: 12, height: 12 }} />}
                  截取当前帧
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
