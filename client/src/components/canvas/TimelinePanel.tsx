import { useState, useRef, useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { X, Play, Pause, Clock, Film, Pin, GripHorizontal } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import { isOwnStorageUrl } from "../../lib/ownStorage";
import { usePersistentState } from "../../hooks/usePersistentState";
import { useHorizontalWheelScroll } from "../../hooks/useHorizontalWheelScroll";
import { resizePanelByCorner, resizePanelByEdge, type Corner, type Edge } from "../../lib/panelCornerResize";

interface TimelinePanelProps {
  onClose: () => void;
}

// Floating panel layout — mirrors FilmstripPanel's pattern. Docked mode pins
// to bottom (above the toolbar gap, matching legacy behavior); floating mode
// uses absolute left/top/width.
interface TimelineLayout {
  docked: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

const TL_MIN_W = 240;
const TL_MIN_H = 96;
const TL_MAX_H = 360;
const TL_DEFAULT_H = 148;
const TL_DOCK_BOTTOM = 72; // matches the legacy bottom offset that clears the toolbar
// 失焦隐藏 header(28)+片段下方名称(22) 时面板收缩量，使框高贴合片段、无上下空白。
const TL_CHROME_COLLAPSE = 50;

const TL_DEFAULT_LAYOUT: TimelineLayout = {
  docked: true,
  left: 80,
  top: 220,
  width: 760,
  height: TL_DEFAULT_H,
};

function validateTimelineLayout(v: unknown): TimelineLayout | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<TimelineLayout>;
  if (typeof o.docked !== "boolean") return null;
  if (typeof o.height !== "number" || o.height < TL_MIN_H || o.height > TL_MAX_H) return null;
  if (typeof o.left !== "number" || typeof o.top !== "number") return null;
  if (typeof o.width !== "number" || o.width < TL_MIN_W) return null;
  return { docked: o.docked, left: o.left, top: o.top, width: o.width, height: o.height };
}

interface VideoClip {
  nodeId: string;
  title: string;
  videoUrl: string;
  duration?: number;
  nodeType: NodeType;
  accentColor: string;
  isSelected: boolean;
}

export function TimelinePanel({ onClose }: TimelinePanelProps) {
  const { nodes } = useCanvasStore();
  const reactFlow = useReactFlow();
  const wheelScrollRef = useHorizontalWheelScroll<HTMLDivElement>();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [layout, setLayout] = usePersistentState<TimelineLayout>(
    "ui:timeline:layout:v1",
    TL_DEFAULT_LAYOUT,
    { validate: validateTimelineLayout },
  );

  // Keep the floating panel on-screen when the window shrinks (e.g. exiting F11).
  useEffect(() => {
    const fix = () => setLayout((l) => {
      if (l.docked) return l;
      const width = Math.min(l.width, window.innerWidth);
      const height = Math.min(l.height, window.innerHeight);
      const left = Math.max(0, Math.min(l.left, window.innerWidth - width));
      const top = Math.max(0, Math.min(l.top, window.innerHeight - height));
      return left === l.left && top === l.top && width === l.width && height === l.height ? l : { ...l, left, top, width, height };
    });
    window.addEventListener("resize", fix);
    fix();
    return () => window.removeEventListener("resize", fix);
  }, [setLayout]);
  const dragRef = useRef<{
    mode: "move" | "resize-height" | "resize-corner" | "resize-edge";
    startX: number; startY: number;
    initLeft: number; initTop: number; initW: number; initH: number;
  } | null>(null);

  // 浮动模式下鼠标离开面板时自动隐藏标题栏 + 片段下方名称，移入恢复；
  // 拖动/缩放进行中不隐藏；吸附模式始终常显。
  const [hovered, setHovered] = useState(false);
  const showChrome = layout.docked || hovered;

  const startTopResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: "resize-height",
      startX: e.clientX, startY: e.clientY,
      initLeft: layout.left, initTop: layout.top, initW: layout.width, initH: layout.height,
    };
    const onMove = (mv: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = d.startY - mv.clientY;
      const next = Math.max(TL_MIN_H, Math.min(TL_MAX_H, d.initH + delta));
      setLayout((cur) => ({
        ...cur,
        height: next,
        top: cur.docked ? cur.top : d.initTop - (next - d.initH),
      }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startHeaderDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const initLeft = layout.docked ? 0 : layout.left;
    const initTop = layout.docked ? window.innerHeight - layout.height - TL_DOCK_BOTTOM : layout.top;
    const initW = layout.docked ? window.innerWidth : layout.width;
    if (layout.docked) {
      setLayout((cur) => ({ ...cur, docked: false, left: initLeft, top: initTop, width: initW }));
    }
    dragRef.current = {
      mode: "move",
      startX: e.clientX, startY: e.clientY,
      initLeft, initTop, initW, initH: layout.height,
    };
    const onMove = (mv: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - d.initW, d.initLeft + (mv.clientX - d.startX)));
      const nextTop = Math.max(0, Math.min(window.innerHeight - d.initH, d.initTop + (mv.clientY - d.startY)));
      setLayout((cur) => ({ ...cur, left: nextLeft, top: nextTop }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startCornerResize = (corner: Corner) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: "resize-corner",
      startX: e.clientX, startY: e.clientY,
      initLeft: layout.left, initTop: layout.top, initW: layout.width, initH: layout.height,
    };
    const onMove = (mv: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const r = resizePanelByCorner(
        corner,
        { left: d.initLeft, top: d.initTop, width: d.initW, height: d.initH },
        mv.clientX - d.startX, mv.clientY - d.startY,
        { minW: TL_MIN_W, minH: TL_MIN_H, maxH: TL_MAX_H, vw: window.innerWidth },
      );
      setLayout((cur) => ({ ...cur, left: r.left, top: r.top, width: r.width, height: r.height }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Left/right edge resize — width only, opposite edge anchored. Floating only.
  const startEdgeResize = (edge: Edge) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: "resize-edge",
      startX: e.clientX, startY: e.clientY,
      initLeft: layout.left, initTop: layout.top, initW: layout.width, initH: layout.height,
    };
    const onMove = (mv: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const r = resizePanelByEdge(
        edge,
        { left: d.initLeft, top: d.initTop, width: d.initW, height: d.initH },
        mv.clientX - d.startX,
        { minW: TL_MIN_W, vw: window.innerWidth },
      );
      setLayout((cur) => ({ ...cur, left: r.left, width: r.width }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const redock = () => setLayout((cur) => ({ ...cur, docked: true }));

  const videoClips: VideoClip[] = nodes
    .filter((node) => {
      const p = node.data.payload as Record<string, unknown>;
      if (node.data.nodeType === "video_task") return !!p.resultVideoUrl;
      if (node.data.nodeType === "comfyui_video") return !!p.resultVideoUrl;
      if (node.data.nodeType === "clip") return !!p.outputUrl;
      if (node.data.nodeType === "merge") return !!p.outputUrl;
      if (node.data.nodeType === "overlay") return !!p.outputUrl;
      // Custom-workflow nodes only count when their run produced a video output.
      if (node.data.nodeType === "comfyui_workflow") return !!p.outputUrl && p.outputType === "video";
      return false;
    })
    .sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y;
      return a.position.x - b.position.x;
    })
    .map((node) => {
      const p = node.data.payload as Record<string, unknown>;
      const videoUrl =
        (p.resultVideoUrl as string | undefined) ??
        (p.outputUrl as string | undefined) ?? "";
      const duration =
        (p.outputDuration as number | undefined) ??
        (p.sourceDuration as number | undefined);
      const config = getNodeConfig(node.data.nodeType as NodeType);
      return {
        nodeId: node.id,
        title: node.data.title,
        videoUrl,
        duration,
        nodeType: node.data.nodeType as NodeType,
        accentColor: config.color,
        isSelected: !!node.selected,
      };
    });

  const totalDuration = videoClips.reduce((sum, c) => sum + (c.duration ?? 0), 0);

  // Clear playing state when the playing clip is removed from the canvas
  useEffect(() => {
    if (playingId !== null && !videoClips.some((c) => c.nodeId === playingId)) {
      videoRefs.current[playingId]?.pause();
      delete videoRefs.current[playingId];
      setPlayingId(null);
    }
  }, [videoClips, playingId]);

  const handleFrameClick = (nodeId: string) => {
    const node = reactFlow.getNode(nodeId);
    if (!node) { reactFlow.fitView({ nodes: [{ id: nodeId }], padding: 0.5, duration: 400 }); return; }
    const internal = reactFlow.getInternalNode(nodeId);
    const pos = internal?.internals.positionAbsolute ?? node.position;
    const w = node.measured?.width ?? 240;
    const h = node.measured?.height ?? 160;
    reactFlow.setCenter(pos.x + w / 2, pos.y + h / 2, { zoom: Math.max(reactFlow.getZoom(), 1), duration: 500 });
    const store = useCanvasStore.getState();
    const changes = store.nodes
      .filter((n) => n.selected || n.id === nodeId)
      .map((n) => ({ id: n.id, type: "select" as const, selected: n.id === nodeId }));
    if (changes.length) store.onNodesChange(changes);
  };

  const handlePlay = (nodeId: string) => {
    const el = videoRefs.current[nodeId];
    if (!el) return;
    if (playingId === nodeId) {
      el.pause();
      setPlayingId(null);
    } else {
      if (playingId) {
        videoRefs.current[playingId]?.pause();
      }
      el.play().catch(() => {});
      setPlayingId(nodeId);
    }
  };

  const proxySrc = (url: string) =>
    url.startsWith("http") ? `/api/video-proxy?url=${encodeURIComponent(url)}` : url;

  // Docked auto-width: panel grows with clip count, capped at viewport width
  // (horizontal scroll inside takes over past the cap). Floating mode uses
  // the user's persisted width.
  // Clips auto-scale to the panel height (taller panel → bigger previews),
  // keeping the original 120:90 video aspect; 22px footer below.
  const FOOTER_H = 22;
  const clipVideoH = Math.max(56, Math.min(layout.height - 28 /*header*/ - 16 /*padding*/ - FOOTER_H, 220));
  const CLIP_W = Math.round(clipVideoH * (120 / 90));
  const CLIP_GAP = 8;
  const SIDE_PADDING = 24;
  const HEADER_MIN = 360;
  const autoWidth = Math.max(
    HEADER_MIN,
    videoClips.length === 0
      ? HEADER_MIN
      : videoClips.length * (CLIP_W + CLIP_GAP) - CLIP_GAP + SIDE_PADDING,
  );
  // Floating mode: manual resize sets the baseline; auto-width can still
  // push it wider as clips are added — never narrower than what the user set.
  // Floating mode: user's manual width as-is, so narrowing lets the inner
  // overflow-x scroll hide overflow clips (no force-expand to fit them all).
  const floatingWidth = layout.width;
  const rectStyle = layout.docked
    ? {
        left: "50%" as const,
        transform: "translateX(-50%)",
        bottom: TL_DOCK_BOTTOM,
        right: undefined,
        top: undefined,
        width: autoWidth,
        maxWidth: "calc(100vw - 16px)",
      }
    : { left: layout.left, top: layout.top, right: undefined, bottom: undefined, width: floatingWidth };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!dragRef.current) setHovered(false); }}
      style={{
        position: "absolute",
        ...rectStyle,
        // 失焦（仅浮动模式）时收缩掉 header+名称高度，使框高贴合片段、无上下空白。
        height: showChrome ? layout.height : Math.max(0, layout.height - TL_CHROME_COLLAPSE),
        transition: "height 180ms ease",
        background: "color-mix(in oklch, var(--c-base) 97%, transparent)",
        border: layout.docked ? undefined : "1px solid var(--c-bd1)",
        borderTop: layout.docked ? "1px solid var(--c-bd1)" : undefined,
        borderRadius: layout.docked ? 0 : 10,
        boxShadow: layout.docked ? undefined : "0 8px 32px oklch(0 0 0 / 0.45)",
        backdropFilter: "blur(20px)",
        display: "flex",
        flexDirection: "column",
        // z-index 18 sits between filmstrip (15) and the bottom toolbar (20),
        // so toolbar popups (theme picker, etc.) render above the timeline.
        zIndex: 18,
      }}
    >
      {/* Top-edge grip: height resize */}
      <div
        onMouseDown={startTopResize}
        title="拖动调整时间轴高度"
        style={{
          position: "absolute",
          top: -3, left: 0, right: 0, height: 6,
          cursor: "row-resize",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1,
        }}
      >
        <GripHorizontal style={{ width: 24, height: 10, color: "var(--c-bd3)", opacity: 0.6, pointerEvents: "none" }} />
      </div>
      {/* Header — drag to move */}
      <div
        onMouseDown={startHeaderDrag}
        style={{
          height: showChrome ? 28 : 0,
          opacity: showChrome ? 1 : 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 12,
          paddingRight: 8,
          flexShrink: 0,
          borderBottom: showChrome ? "1px solid var(--c-bd1)" : "none",
          cursor: "move",
          userSelect: "none",
          transition: "height 180ms ease, opacity 180ms ease",
          pointerEvents: showChrome ? undefined : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Film style={{ width: 11, height: 11, color: "oklch(0.62 0.20 25)" }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--c-t4)",
            }}
          >
            时间轴
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--c-t4)",
            }}
          >
            {videoClips.length} 个片段
          </span>
          {totalDuration > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                marginLeft: 4,
                padding: "1px 6px",
                borderRadius: 99,
                background: "oklch(0.62 0.20 25 / 0.10)",
                border: "1px solid oklch(0.62 0.20 25 / 0.25)",
              }}
            >
              <Clock style={{ width: 9, height: 9, color: "oklch(0.62 0.20 25)" }} />
              <span style={{ fontSize: 10, color: "oklch(0.62 0.20 25)", fontVariantNumeric: "tabular-nums" }}>
                {formatDuration(totalDuration)}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {!layout.docked && (
            <button
              onClick={redock}
              title="吸附到底部"
              style={{
                width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 6, border: "none", background: "transparent", cursor: "pointer",
                color: "var(--c-t4)", transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t2)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
            >
              <Pin style={{ width: 12, height: 12 }} />
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 6, border: "none", background: "transparent", cursor: "pointer",
              color: "var(--c-t4)", transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t2)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
          >
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>

      {/* Scroll area — mouse wheel scrolls the timeline clips horizontally */}
      <div
        ref={wheelScrollRef}
        className="nowheel"
        style={{
          flex: 1,
          overflowX: "auto",
          overflowY: "hidden",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          scrollbarWidth: "thin",
          scrollbarColor: "var(--c-bd3) transparent",
        }}
      >
        {videoClips.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--c-t4)",
              fontSize: 12,
              userSelect: "none",
            }}
          >
            暂无视频片段，先生成或处理视频
          </div>
        ) : (
          videoClips.map((clip, index) => (
            <TimelineClip
              key={clip.nodeId}
              index={index}
              clipW={CLIP_W}
              videoH={clipVideoH}
              clip={clip}
              isPlaying={playingId === clip.nodeId}
              showFooter={showChrome}
              videoRef={(el) => { videoRefs.current[clip.nodeId] = el; }}
              proxySrc={proxySrc}
              onNavigate={() => handleFrameClick(clip.nodeId)}
              onPlay={() => handlePlay(clip.nodeId)}
              onEnded={() => setPlayingId(null)}
            />
          ))
        )}
      </div>

      {/* Left/right edge resize — width only (floating mode only) */}
      {!layout.docked && (["l", "r"] as Edge[]).map((edge) => (
        <div
          key={edge}
          onMouseDown={startEdgeResize(edge)}
          title="拖动左右边缘调整宽度"
          style={{
            position: "absolute", top: 18, bottom: 18, width: 8, zIndex: 2,
            cursor: "ew-resize",
            ...(edge === "l" ? { left: -2 } : { right: -2 }),
          }}
        />
      ))}
      {/* Four-corner resize — floating only */}
      {!layout.docked && (["tl", "tr", "bl", "br"] as Corner[]).map((corner) => (
        <div
          key={corner}
          onMouseDown={startCornerResize(corner)}
          title="拖动四角调整大小"
          style={{
            position: "absolute", width: 18, height: 18, zIndex: 2,
            cursor: corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize",
            ...(corner.includes("t") ? { top: 0 } : { bottom: 0 }),
            ...(corner.includes("l") ? { left: 0 } : { right: 0 }),
            display: "flex",
            alignItems: corner.includes("t") ? "flex-start" : "flex-end",
            justifyContent: corner.includes("l") ? "flex-start" : "flex-end",
            padding: 2,
          }}
        >
          {corner === "br" && (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.45 }}>
              <circle cx="1.5" cy="7.5" r="1" fill="var(--c-t3)" />
              <circle cx="4.5" cy="4.5" r="1" fill="var(--c-t3)" />
              <circle cx="7.5" cy="1.5" r="1" fill="var(--c-t3)" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

interface TimelineClipProps {
  index: number;
  clipW: number;
  videoH: number;
  clip: VideoClip;
  isPlaying: boolean;
  showFooter: boolean;
  videoRef: (el: HTMLVideoElement | null) => void;
  proxySrc: (url: string) => string;
  onNavigate: () => void;
  onPlay: () => void;
  onEnded: () => void;
}

function TimelineClip({ index, clipW, videoH, clip, isPlaying, showFooter, videoRef, proxySrc, onNavigate, onPlay, onEnded }: TimelineClipProps) {
  const storedInMinio = isOwnStorageUrl(clip.videoUrl);

  // Drag-to-attach: timeline clips are always videos, which LLMs can't read
  // as images. Attach them as a text-file reference so the chat node shows a
  // clean chip and the model gets the clip title/URL as written context.
  const dragUrl = clip.videoUrl;
  const onDragStart = (e: React.DragEvent) => {
    if (!dragUrl) return;
    const payload = {
      type: "file" as const,
      url: "",
      mimeType: "video/mp4",
      name: clip.title || "video",
      textContent: `[Video reference] title="${clip.title}" url="${dragUrl}"`,
    };
    e.dataTransfer.setData("application/x-avc-attachment", JSON.stringify(payload));
    e.dataTransfer.setData("text/uri-list", dragUrl);
    e.dataTransfer.setData("text/plain", dragUrl);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      draggable={!!dragUrl}
      onDragStart={onDragStart}
      style={{
        width: clipW,
        height: videoH + (showFooter ? 22 : 0),
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--c-surface)",
        border: clip.isSelected
          ? `1.5px solid ${clip.accentColor}`
          : "1.5px solid var(--c-bd2)",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: clip.isSelected
          ? `0 0 0 1px ${clip.accentColor}40, 0 4px 16px oklch(0 0 0 / 0.5)`
          : "0 2px 8px oklch(0 0 0 / 0.4)",
        transition: "border-color 150ms ease, box-shadow 150ms ease, height 180ms ease",
        position: "relative",
      }}
    >
      {/* Clip index badge */}
      <div
        style={{
          position: "absolute",
          top: 4,
          left: 4,
          minWidth: 18,
          height: 18,
          paddingLeft: 5,
          paddingRight: 5,
          borderRadius: 5,
          background: `${clip.accentColor}cc`,
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 700,
          color: "white",
          lineHeight: 1,
          zIndex: 2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {index + 1}
      </div>

      {/* Video preview */}
      <div
        style={{ width: "100%", height: videoH, position: "relative", overflow: "hidden", flexShrink: 0, cursor: "pointer" }}
        onClick={onNavigate}
      >
        <video
          ref={videoRef}
          src={proxySrc(clip.videoUrl)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          preload="metadata"
          onEnded={onEnded}
          onError={(e) => console.error("[TimelinePanel] Video load error:", (e.currentTarget as HTMLVideoElement).error?.message)}
        />
        {storedInMinio && (
          <div
            title="已存储到 MinIO·长期有效"
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "oklch(0.72 0.18 155)",
              boxShadow: "0 0 0 2px oklch(0.72 0.18 155 / 0.35)",
              pointerEvents: "none",
              zIndex: 3,
            }}
          />
        )}

        {/* Duration badge */}
        {clip.duration !== undefined && clip.duration > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: 4,
              right: 4,
              padding: "1px 4px",
              borderRadius: 4,
              background: "oklch(0 0 0 / 0.65)",
              backdropFilter: "blur(4px)",
              fontSize: 9,
              color: "white",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatDuration(clip.duration)}
          </div>
        )}

        {/* Play/pause overlay button */}
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "oklch(0 0 0 / 0.55)",
            backdropFilter: "blur(6px)",
            border: "1px solid oklch(1 0 0 / 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            opacity: isPlaying ? 1 : 0,
            transition: "opacity 150ms ease",
            color: "white",
          }}
          className="clip-play-btn"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isPlaying ? "1" : "0"; }}
        >
          {isPlaying
            ? <Pause style={{ width: 12, height: 12 }} />
            : <Play style={{ width: 12, height: 12 }} />
          }
        </button>
      </div>

      {/* Footer strip — collapses when chrome is hidden (floating + mouse away) */}
      <div
        style={{
          height: showFooter ? 22 : 0,
          opacity: showFooter ? 1 : 0,
          overflow: "hidden",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          paddingLeft: 5,
          paddingRight: 5,
          background: "var(--c-base)",
          borderTop: showFooter ? "1px solid var(--c-bd1)" : "none",
          transition: "height 180ms ease, opacity 180ms ease",
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: clip.isSelected ? clip.accentColor : "var(--c-t3)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            width: "100%",
            textAlign: "left",
            lineHeight: 1,
            transition: "color 150ms ease",
          }}
        >
          {clip.title}
        </span>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}`;
  return `${s}s`;
}
