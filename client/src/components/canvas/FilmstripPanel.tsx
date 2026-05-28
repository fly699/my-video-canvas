import { useReactFlow } from "@xyflow/react";
import { useRef } from "react";
import { X, Film, ImageOff, GripHorizontal, Pin } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import { useLocalMedia } from "../../lib/useLocalMedia";
import { usePersistentState } from "../../hooks/usePersistentState";

interface FilmstripPanelProps {
  onClose: () => void;
}

// Layout state lives entirely in one persisted record. When `docked` is true,
// the panel ignores left/width and pins to the bottom edge spanning full
// viewport width — the legacy behavior. The user enters floating mode by
// dragging the header; the pin button snaps back to docked.
interface FilmstripLayout {
  docked: boolean;
  left: number;   // floating only
  top: number;    // floating only
  width: number;  // floating only
  height: number; // both modes
}

const MIN_WIDTH = 240;
const MIN_HEIGHT = 84;
const MAX_HEIGHT = 360;
const DEFAULT_HEIGHT = 140;

const DEFAULT_LAYOUT: FilmstripLayout = {
  docked: true,
  left: 80,
  top: 200,
  width: 720,
  height: DEFAULT_HEIGHT,
};

function validateLayout(v: unknown): FilmstripLayout | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<FilmstripLayout>;
  if (typeof o.docked !== "boolean") return null;
  if (typeof o.height !== "number" || o.height < MIN_HEIGHT || o.height > MAX_HEIGHT) return null;
  if (typeof o.left !== "number" || typeof o.top !== "number") return null;
  if (typeof o.width !== "number" || o.width < MIN_WIDTH) return null;
  return { docked: o.docked, left: o.left, top: o.top, width: o.width, height: o.height };
}

export function FilmstripPanel({ onClose }: FilmstripPanelProps) {
  const { nodes } = useCanvasStore();
  const reactFlow = useReactFlow();
  const [layout, setLayout] = usePersistentState<FilmstripLayout>(
    "ui:filmstrip:layout:v2",
    DEFAULT_LAYOUT,
    { validate: validateLayout },
  );
  const dragRef = useRef<{
    mode: "move" | "resize-height" | "resize-corner";
    startX: number; startY: number;
    initLeft: number; initTop: number; initW: number; initH: number;
  } | null>(null);

  // Top-edge grip: vertical-only resize (grow panel upward by dragging up).
  // Works in both docked and floating modes.
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
      const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, d.initH + delta));
      setLayout((cur) => ({
        ...cur,
        height: next,
        // In floating mode, anchor the top to follow the bottom edge so the
        // panel grows upward (matches docked-mode expectation).
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

  // Header drag → move panel. If currently docked, snap to floating mode
  // using the panel's current viewport rect as the floating origin.
  const startHeaderDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const initLeft = layout.docked ? 0 : layout.left;
    const initTop = layout.docked ? window.innerHeight - layout.height : layout.top;
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

  // Bottom-right corner resize — width + height. Floating only (docked is
  // always full-width by design). When docked, only top-edge resize applies.
  const startCornerResize = (e: React.MouseEvent) => {
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
      const nextW = Math.max(MIN_WIDTH, Math.min(window.innerWidth - d.initLeft, d.initW + (mv.clientX - d.startX)));
      const nextH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, d.initH + (mv.clientY - d.startY)));
      setLayout((cur) => ({ ...cur, width: nextW, height: nextH }));
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

  // Filter nodes that have an imageUrl, resultVideoUrl, or imageUrls in payload
  const mediaNodes = nodes.filter((node) => {
    const p = node.data.payload as Record<string, unknown>;
    return !!(p.imageUrl || p.resultVideoUrl || (Array.isArray(p.imageUrls) && (p.imageUrls as string[]).length > 0));
  });

  // Sort by Y position ascending, then X position for natural storyboard order
  const sortedNodes = [...mediaNodes].sort((a, b) => {
    if (a.position.y !== b.position.y) return a.position.y - b.position.y;
    return a.position.x - b.position.x;
  });

  const handleFrameClick = (nodeId: string) => {
    reactFlow.fitView({
      nodes: [{ id: nodeId }],
      padding: 0.5,
      duration: 400,
    });
  };

  // Auto-width in docked mode: compute panel width from clip count so few
  // frames render a compact panel and many frames grow it (clamped at the
  // viewport via CSS maxWidth so the horizontal scroll inside keeps working
  // past the cap). Floating mode uses the user's persisted width.
  const FRAME_W = 100;
  const FRAME_GAP = 8;
  const SIDE_PADDING = 24; // 12px each side of the scroll row
  const HEADER_MIN = 320;
  const dockedAutoWidth = Math.max(
    HEADER_MIN,
    sortedNodes.length === 0
      ? HEADER_MIN
      : sortedNodes.length * (FRAME_W + FRAME_GAP) - FRAME_GAP + SIDE_PADDING,
  );
  const rectStyle = layout.docked
    ? {
        left: "50%" as const,
        transform: "translateX(-50%)",
        bottom: 0,
        right: undefined,
        top: undefined,
        width: dockedAutoWidth,
        maxWidth: "calc(100vw - 16px)",
      }
    : { left: layout.left, top: layout.top, right: undefined, bottom: undefined, width: layout.width };

  return (
    <div
      className="canvas-filmstrip"
      style={{
        // z-index 15 keeps the panel above the canvas but below the floating
        // toolbar (z-20). The minimap (z-30) and timeline (z-25) intentionally
        // sit higher so the overview/timeline stay reachable.
        position: "absolute",
        ...rectStyle,
        height: layout.height,
        background: "var(--c-base)",
        backdropFilter: "blur(16px)",
        border: layout.docked ? undefined : "1px solid var(--c-bd1)",
        borderTop: layout.docked ? "1px solid var(--c-bd1)" : undefined,
        borderRadius: layout.docked ? 0 : 10,
        boxShadow: layout.docked ? undefined : "0 8px 32px oklch(0 0 0 / 0.45)",
        display: "flex",
        flexDirection: "column",
        zIndex: 15,
      }}
    >
      {/* Top-edge grip: vertical resize (drag up to grow). Works in both modes. */}
      <div
        onMouseDown={startTopResize}
        title="拖动调整胶片条高度"
        style={{
          position: "absolute",
          top: -3,
          left: 0,
          right: 0,
          height: 6,
          cursor: "row-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        <GripHorizontal
          style={{
            width: 24, height: 10,
            color: "var(--c-bd3)",
            opacity: 0.6,
            transition: "opacity 150ms ease, color 150ms ease",
            pointerEvents: "none",
          }}
        />
      </div>
      {/* Header — drag to move (auto-detaches from docked) */}
      <div
        onMouseDown={startHeaderDrag}
        style={{
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 12,
          paddingRight: 8,
          flexShrink: 0,
          borderBottom: "1px solid var(--c-bd1)",
          cursor: "move",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Film style={{ width: 11, height: 11, color: "var(--c-t4)" }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--c-t4)",
            }}
          >
            胶片条 · {mediaNodes.length} 帧
          </span>
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

      {/* Filmstrip scroll area */}
      <div
        style={{
          flex: 1,
          overflowX: "auto",
          overflowY: "hidden",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          scrollbarWidth: "thin",
          scrollbarColor: "var(--c-bd3) transparent",
        }}
      >
        {sortedNodes.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              color: "var(--c-t4)",
              userSelect: "none",
            }}
          >
            <ImageOff style={{ width: 18, height: 18, opacity: 0.5 }} />
            <span style={{ fontSize: 11 }}>暂无素材，先生成图像或视频</span>
          </div>
        ) : (
          sortedNodes.map((node, index) => {
            const payload = node.data.payload as Record<string, unknown>;
            const mediaUrl = (payload.imageUrl as string | undefined)
              || (Array.isArray(payload.imageUrls) ? (payload.imageUrls as string[])[0] : undefined)
              || undefined;
            const videoUrl = payload.resultVideoUrl as string | undefined;
            const isVideo = !!videoUrl && !mediaUrl;
            const isStoryboard = node.data.nodeType === "storyboard";
            // sceneNumber accepts either number or string ("开场" / "S1-A" / 7);
            // FilmFrame coerces to string for display.
            const sceneNumber = isStoryboard
              ? (payload.sceneNumber as number | string | undefined)
              : undefined;
            const config = getNodeConfig(node.data.nodeType as NodeType);
            const accentColor = config.color;
            const isSelected = node.selected;

            return (
              <FilmFrame
                key={node.id}
                index={index}
                imageUrl={mediaUrl}
                videoUrl={videoUrl}
                isVideo={isVideo}
                title={node.data.title}
                sceneNumber={sceneNumber}
                accentColor={accentColor}
                isSelected={!!isSelected}
                onClick={() => handleFrameClick(node.id)}
              />
            );
          })
        )}
      </div>

      {/* Bottom-right corner — width + height resize. Floating mode only:
          docked panels span full width by definition. */}
      {!layout.docked && (
        <div
          onMouseDown={startCornerResize}
          title="拖动调整大小"
          style={{
            position: "absolute",
            right: 0, bottom: 0,
            width: 16, height: 16,
            cursor: "nwse-resize",
            zIndex: 2,
            display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
            padding: 2,
          }}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.45 }}>
            <circle cx="1.5" cy="7.5" r="1" fill="var(--c-t3)" />
            <circle cx="4.5" cy="4.5" r="1" fill="var(--c-t3)" />
            <circle cx="7.5" cy="1.5" r="1" fill="var(--c-t3)" />
          </svg>
        </div>
      )}
    </div>
  );
}

interface FilmFrameProps {
  index: number;
  imageUrl?: string;
  videoUrl?: string;
  isVideo: boolean;
  title: string;
  sceneNumber?: number | string;
  accentColor: string;
  isSelected: boolean;
  onClick: () => void;
}

function FilmFrame({
  index,
  imageUrl,
  videoUrl,
  isVideo,
  title,
  sceneNumber,
  accentColor,
  isSelected,
  onClick,
}: FilmFrameProps) {
  const mediaUrl = isVideo ? videoUrl : imageUrl;
  const { isLocal, blobUrl, downloadedAt } = useLocalMedia(mediaUrl);

  return (
    <button
      onClick={onClick}
      style={{
        width: 100,
        height: 122,
        flexShrink: 0,
        background: "var(--c-base)",
        border: isSelected
          ? `1.5px solid ${accentColor}`
          : "1.5px solid var(--c-bd2)",
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease",
        boxShadow: isSelected
          ? `0 0 0 1px ${accentColor}40, 0 4px 16px oklch(0 0 0 / 0.15)`
          : "0 2px 8px oklch(0 0 0 / 0.08)",
        position: "relative",
        padding: 0,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = "scale(1.05)";
        if (!isSelected) {
          el.style.borderColor = `${accentColor}80`;
          el.style.boxShadow = `0 0 0 1px ${accentColor}30, 0 6px 20px oklch(0 0 0 / 0.12)`;
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = "scale(1)";
        if (!isSelected) {
          el.style.borderColor = "var(--c-bd2)";
          el.style.boxShadow = "0 2px 8px oklch(0 0 0 / 0.08)";
        }
      }}
    >
      {/* Image/video area */}
      <div style={{ width: "100%", height: 100, position: "relative", overflow: "hidden", flexShrink: 0 }}>
        {isVideo && videoUrl ? (
          <video
            src={blobUrl ?? videoUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            muted
            preload="metadata"
          />
        ) : (
          <img
            src={blobUrl ?? imageUrl}
            alt={title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
            loading="lazy"
          />
        )}
        {isLocal && (
          <div
            title={`已缓存到本地（${new Date(downloadedAt).toLocaleString("zh-CN")}）`}
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

        {/* Scene / sequence number badge */}
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
            background: sceneNumber !== undefined ? `${accentColor}cc` : "oklch(0 0 0 / 0.42)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color: "white",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {sceneNumber ?? index + 1}
        </div>
      </div>

      {/* Footer strip */}
      <div
        style={{
          height: 22,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          paddingLeft: 5,
          paddingRight: 5,
          background: "var(--c-base)",
          borderTop: "1px solid var(--c-bd1)",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: isSelected ? accentColor : "var(--c-t3)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            width: "100%",
            textAlign: "left",
            lineHeight: 1,
            transition: "color 150ms ease",
          }}
        >
          {title}
        </span>
      </div>
    </button>
  );
}
