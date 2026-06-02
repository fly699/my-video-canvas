import { useState, useCallback, useRef, useEffect, memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useWorkflowRunState } from "../../contexts/WorkflowRunContext";
import { useCanvasMode } from "../../contexts/CanvasModeContext";
import { getNodeConfig } from "../../lib/nodeConfig";
import { Check, X, Trash2 } from "lucide-react";

function arrowPoints(tx: number, ty: number, pos: Position, sz: number, hw: number): string {
  if (pos === Position.Left)  return `${tx+sz},${ty-hw} ${tx+sz},${ty+hw} ${tx},${ty}`;
  if (pos === Position.Right) return `${tx-sz},${ty-hw} ${tx-sz},${ty+hw} ${tx},${ty}`;
  if (pos === Position.Top)   return `${tx-hw},${ty+sz} ${tx+hw},${ty+sz} ${tx},${ty}`;
  return `${tx-hw},${ty-sz} ${tx+hw},${ty-sz} ${tx},${ty}`;
}

const PARTICLE_COUNT = 3;

export const CustomEdge = memo(function CustomEdge({
  id,
  source,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  selected, label,
}: EdgeProps) {
  const { running, completedIds, currentNodeId, failedIds } = useWorkflowRunState();
  const sourceRunning = running && currentNodeId === source;
  const sourceCompleted = completedIds.includes(source ?? "");
  const sourceFailed = failedIds.includes(source ?? "");

  const nodes = useCanvasStore(s => s.nodes);
  const sourceNodeType = nodes.find(n => n.id === source)?.data.nodeType as string | undefined;
  const typeColor = sourceNodeType ? getNodeConfig(sourceNodeType as Parameters<typeof getNodeConfig>[0]).color : null;
  const { mode: canvasMode } = useCanvasMode();
  const isCreative = canvasMode === "creative";

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const { updateEdgeLabel, onEdgesChange } = useCanvasStore();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(typeof label === "string" ? label : "");
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const edgeCancelingRef = useRef(false);

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.focus(), 10);
  }, [editing]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(typeof label === "string" ? label : "");
    setEditing(true);
  }, [label]);

  const handleSave = useCallback(() => {
    if (edgeCancelingRef.current) { edgeCancelingRef.current = false; return; }
    updateEdgeLabel(id, editValue.trim());
    setEditing(false);
  }, [id, editValue, updateEdgeLabel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") { edgeCancelingRef.current = true; setEditing(false); }
    e.stopPropagation();
  }, [handleSave]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onEdgesChange([{ type: "remove", id }]);
  }, [id, onEdgesChange]);

  const hasLabel = typeof label === "string" && label.trim().length > 0;
  const showControls = hovered || selected;

  // Colored by source node type; idle lines are slightly translucent so the
  // canvas feels lighter, hover/selected go solid for clear emphasis.
  const strokeColor = sourceCompleted
    ? "oklch(0.64 0.22 155 / 0.9)"
    : sourceFailed
      ? "oklch(0.62 0.24 25 / 0.9)"
      : selected
        ? (typeColor ?? "oklch(0.68 0.24 285)")
        : hovered
          ? (typeColor ?? "oklch(0.72 0.18 285)")
          : isCreative
            ? (typeColor ? `${typeColor}99` : "oklch(0.70 0.12 260 / 0.6)")
            : typeColor
              ? `${typeColor}c0`
              : "oklch(0.68 0.16 260 / 0.75)";

  // Slightly thinner than the bold pass (user asked to slim down a touch);
  // hover/selection still step up for emphasis.
  const strokeWidth = isCreative
    ? selected ? 2.75 : hovered ? 2.25 : 1.5
    : selected ? 3.5 : hovered ? 2.75 : 2;

  // ── Particle flow ───────────────────────────────────────────────────────────
  const svgPathId = `pp-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const durSeconds = sourceRunning ? 0.75 : isCreative ? 3.5 : 2.6;
  // Smaller particles — visible but not chunky. Running state stays slightly
  // bigger so the user can tell at a glance that something is in flight.
  const particleR = sourceRunning ? (isCreative ? 2.4 : 2.8) : isCreative ? 1.9 : 2.3;
  const particleColor = sourceRunning
    ? "oklch(0.92 0.28 142)"
    : sourceCompleted
      ? "oklch(0.78 0.22 155)"
      : sourceFailed
        ? "oklch(0.74 0.22 25)"
        : isCreative
          ? (typeColor ?? "oklch(0.68 0.16 260)")
          : (typeColor ?? "oklch(0.72 0.14 260)");
  const particleOpacity = sourceRunning
    ? 1.0
    : sourceCompleted ? (isCreative ? 0.9 : 0.95)
    : sourceFailed ? 0.9
    : isCreative ? 0.8 : 0.92;
  // Modest glow halo — visible direction cue without dominating the canvas.
  const glowR = particleR * 2.4;
  const glowOpacity = sourceRunning ? 0.36 : isCreative ? 0.12 : 0.18;
  // A second, larger soft halo for extra depth (renders behind core).
  const outerGlowR = particleR * 3.8;
  const outerGlowOpacity = sourceRunning ? 0.18 : isCreative ? 0.05 : 0.08;

  return (
    <>
      {/* Path reference for animateMotion particles */}
      <defs>
        <path id={svgPathId} d={edgePath} />
      </defs>

      {/* Invisible wider hit area */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: "pointer" }}
      />

      <BaseEdge
        id={id}
        path={edgePath}
        interactionWidth={0}
        style={{
          stroke: strokeColor,
          strokeWidth,
          // Persistent soft glow on every edge so colored lines feel luminous,
          // upgraded for selected / completed / failed states.
          filter: selected
            ? "drop-shadow(0 0 6px oklch(0.68 0.22 285 / 0.55))"
            : sourceCompleted
              ? "drop-shadow(0 0 5px oklch(0.65 0.20 155 / 0.45))"
              : sourceFailed
                ? "drop-shadow(0 0 5px oklch(0.62 0.22 25 / 0.45))"
                : sourceRunning
                  ? "drop-shadow(0 0 6px oklch(0.85 0.26 142 / 0.55))"
                  : typeColor
                    ? `drop-shadow(0 0 4px ${typeColor}77)`
                    : undefined,
          transition: "stroke 300ms ease, stroke-width 140ms ease, filter 300ms ease",
          pointerEvents: "none",
        }}
      />

      {/* Flowing particles — always visible, indicating data direction.
          Three layers per particle: outer soft halo (largest, faintest),
          inner glow halo (medium), and bright core. */}
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const beginOffset = -((i / PARTICLE_COUNT) * durSeconds);
        return (
          <g key={i}>
            {/* Outer soft halo */}
            <circle r={outerGlowR} fill={particleColor} opacity={outerGlowOpacity}>
              <animateMotion
                dur={`${durSeconds}s`}
                begin={`${beginOffset}s`}
                repeatCount="indefinite"
              >
                <mpath href={`#${svgPathId}`} />
              </animateMotion>
            </circle>
            {/* Glow halo */}
            <circle r={glowR} fill={particleColor} opacity={glowOpacity}>
              <animateMotion
                dur={`${durSeconds}s`}
                begin={`${beginOffset}s`}
                repeatCount="indefinite"
              >
                <mpath href={`#${svgPathId}`} />
              </animateMotion>
            </circle>
            {/* Core particle */}
            <circle r={particleR} fill={particleColor} opacity={particleOpacity}>
              <animateMotion
                dur={`${durSeconds}s`}
                begin={`${beginOffset}s`}
                repeatCount="indefinite"
              >
                <mpath href={`#${svgPathId}`} />
              </animateMotion>
            </circle>
          </g>
        );
      })}

      {/* Arrowhead at target end — slightly larger to match the thicker strokes */}
      <polygon
        points={arrowPoints(targetX, targetY, targetPosition, isCreative ? 10 : 13, isCreative ? 5.5 : 7.5)}
        fill={strokeColor}
        opacity={isCreative ? 0.9 : 1.0}
        pointerEvents="none"
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onDoubleClick={handleDoubleClick}
        >
          {editing ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "var(--c-surface)",
                border: "1px solid oklch(0.68 0.22 285 / 0.50)",
                borderRadius: 8,
                padding: "4px 8px",
                boxShadow: "0 4px 20px oklch(0 0 0 / 0.55)",
                backdropFilter: "blur(12px)",
              }}
            >
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSave}
                placeholder="标签..."
                style={{
                  background: "transparent",
                  color: "var(--c-t1)",
                  fontSize: 11,
                  outline: "none",
                  width: 80,
                  fontFamily: "var(--font-sans)",
                }}
              />
              <button
                onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
                style={{ color: "oklch(0.72 0.18 155)", padding: 1, lineHeight: 0 }}
              >
                <Check style={{ width: 10, height: 10 }} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); setEditing(false); }}
                style={{ color: "var(--c-t4)", padding: 1, lineHeight: 0 }}
              >
                <X style={{ width: 10, height: 10 }} />
              </button>
            </div>
          ) : showControls ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                background: "var(--c-base)",
                border: `1px solid ${selected ? "oklch(0.68 0.22 285 / 0.45)" : "var(--c-bd3)"}`,
                borderRadius: 20,
                padding: "3px 6px",
                backdropFilter: "blur(12px)",
                boxShadow: "0 2px 12px oklch(0 0 0 / 0.40)",
                opacity: showControls ? 1 : 0,
                transition: "opacity 140ms ease",
              }}
            >
              {hasLabel ? (
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-sans)",
                    color: selected ? "oklch(0.82 0.12 285)" : "var(--c-t3)",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                    paddingLeft: 2,
                    paddingRight: 2,
                  }}
                  title="双击编辑标签"
                >
                  {label as string}
                </span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(true); setEditValue(""); }}
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-sans)",
                    color: "var(--c-t4)",
                    cursor: "pointer",
                    background: "transparent",
                    border: "none",
                    padding: "0 2px",
                  }}
                  title="添加标签"
                >
                  + 标签
                </button>
              )}
              <div style={{ width: 1, height: 10, background: "var(--c-bd3)", margin: "0 2px" }} />
              <button
                onClick={handleDelete}
                style={{
                  color: "var(--c-t4)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 2,
                  lineHeight: 0,
                  borderRadius: 4,
                  transition: "color 120ms ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.65 0.22 25)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
                title="删除连线"
              >
                <Trash2 style={{ width: 10, height: 10 }} />
              </button>
            </div>
          ) : hasLabel ? (
            <div
              style={{
                background: "var(--c-base)",
                border: "1px solid var(--c-bd2)",
                borderRadius: 20,
                padding: "2px 8px",
                fontSize: 10,
                fontFamily: "var(--font-sans)",
                color: "var(--c-t3)",
                backdropFilter: "blur(8px)",
                userSelect: "none",
                whiteSpace: "nowrap",
              }}
            >
              {label as string}
            </div>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
