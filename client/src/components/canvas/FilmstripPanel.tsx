import { useReactFlow } from "@xyflow/react";
import { X } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";

interface FilmstripPanelProps {
  onClose: () => void;
}

export function FilmstripPanel({ onClose }: FilmstripPanelProps) {
  const { nodes } = useCanvasStore();
  const reactFlow = useReactFlow();

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

  return (
    <div
      style={{
        position: "absolute",
        bottom: 72,
        left: 0,
        right: 0,
        height: 140,
        background: "var(--c-base)",
        backdropFilter: "blur(16px)",
        borderTop: "1px solid var(--c-bd1)",
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
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--c-t4)",
          }}
        >
          {mediaNodes.length} 帧
        </span>
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

      {/* Filmstrip scroll area */}
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
        {sortedNodes.length === 0 ? (
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
            暂无素材，先生成图像或视频
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
            const sceneNumber = isStoryboard
              ? (payload.sceneNumber as number | undefined)
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
    </div>
  );
}

interface FilmFrameProps {
  index: number;
  imageUrl?: string;
  videoUrl?: string;
  isVideo: boolean;
  title: string;
  sceneNumber?: number;
  accentColor: string;
  isSelected: boolean;
  onClick: () => void;
}

function FilmFrame({
  imageUrl,
  videoUrl,
  isVideo,
  title,
  sceneNumber,
  accentColor,
  isSelected,
  onClick,
}: FilmFrameProps) {
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
            src={videoUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            muted
            preload="metadata"
          />
        ) : (
          <img
            src={imageUrl}
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

        {/* Scene number badge */}
        {sceneNumber !== undefined && (
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
              background: `${accentColor}cc`,
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
            {sceneNumber}
          </div>
        )}
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
