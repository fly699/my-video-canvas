import { useState, useRef, useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { X, Play, Pause, Clock, Film } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import { useLocalMedia } from "../../lib/useLocalMedia";

interface TimelinePanelProps {
  onClose: () => void;
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
  const [playingId, setPlayingId] = useState<string | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const videoClips: VideoClip[] = nodes
    .filter((node) => {
      const p = node.data.payload as Record<string, unknown>;
      if (node.data.nodeType === "video_task") return !!p.resultVideoUrl;
      if (node.data.nodeType === "clip") return !!p.outputUrl;
      if (node.data.nodeType === "merge") return !!p.outputUrl;
      if (node.data.nodeType === "overlay") return !!p.outputUrl;
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
    // Use the store's authoritative node position rather than fitView's
    // `nodes: [{ id }]` filter (which silently no-ops when React Flow's
    // internal node measurement hasn't completed). setCenter is direct.
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const w = (node.measured?.width ?? node.width ?? 320) as number;
    const h = (node.measured?.height ?? node.height ?? 200) as number;
    const cx = node.position.x + w / 2;
    const cy = node.position.y + h / 2;
    reactFlow.setCenter(cx, cy, { zoom: 1, duration: 400 });
    reactFlow.setNodes((curr) =>
      curr.map((n) => ({ ...n, selected: n.id === nodeId })),
    );
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

  return (
    <div
      style={{
        position: "absolute",
        bottom: 72,
        left: 0,
        right: 0,
        height: 148,
        background: "color-mix(in oklch, var(--c-base) 97%, transparent)",
        borderTop: "1px solid var(--c-bd1)",
        backdropFilter: "blur(20px)",
        display: "flex",
        flexDirection: "column",
        zIndex: 25,
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 12,
          paddingRight: 8,
          flexShrink: 0,
          borderBottom: "1px solid var(--c-bd1)",
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
        <button
          onClick={onClose}
          style={{
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--c-t4)",
            transition: "all 150ms ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)";
            (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
          }}
        >
          <X style={{ width: 13, height: 13 }} />
        </button>
      </div>

      {/* Scroll area */}
      <div
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
              clip={clip}
              isPlaying={playingId === clip.nodeId}
              videoRef={(el) => { videoRefs.current[clip.nodeId] = el; }}
              proxySrc={proxySrc}
              onNavigate={() => handleFrameClick(clip.nodeId)}
              onPlay={() => handlePlay(clip.nodeId)}
              onEnded={() => setPlayingId(null)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface TimelineClipProps {
  index: number;
  clip: VideoClip;
  isPlaying: boolean;
  videoRef: (el: HTMLVideoElement | null) => void;
  proxySrc: (url: string) => string;
  onNavigate: () => void;
  onPlay: () => void;
  onEnded: () => void;
}

function TimelineClip({ index, clip, isPlaying, videoRef, proxySrc, onNavigate, onPlay, onEnded }: TimelineClipProps) {
  const { isLocal, blobUrl, downloadedAt } = useLocalMedia(clip.videoUrl);

  // Drag-to-attach: dropping a clip on an AI chat node attaches it as
  // a video reference (the chat node consumes the URL without re-upload).
  const dragUrl = blobUrl ?? clip.videoUrl;
  const onDragStart = (e: React.DragEvent) => {
    if (!dragUrl) return;
    const payload = {
      type: "image" as const, // AIChatNode treats video URLs the same as image attachments
      url: dragUrl,
      mimeType: "video/*",
      name: clip.title || "video",
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
        width: 120,
        height: 112,
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
        transition: "border-color 150ms ease, box-shadow 150ms ease",
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
        style={{ width: "100%", height: 90, position: "relative", overflow: "hidden", flexShrink: 0, cursor: "pointer" }}
        onClick={onNavigate}
      >
        <video
          ref={videoRef}
          src={blobUrl ?? proxySrc(clip.videoUrl)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          preload="metadata"
          onEnded={onEnded}
          onError={(e) => console.error("[TimelinePanel] Video load error:", (e.currentTarget as HTMLVideoElement).error?.message)}
        />
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
