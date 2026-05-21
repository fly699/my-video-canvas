import { useState, useCallback, useRef, useEffect, memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useWorkflowRunState } from "../../contexts/WorkflowRunContext";
import { Check, X, Trash2 } from "lucide-react";

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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const { updateEdgeLabel, edges, onEdgesChange } = useCanvasStore();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(typeof label === "string" ? label : "");
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.focus(), 10);
  }, [editing]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(typeof label === "string" ? label : "");
    setEditing(true);
  }, [label]);

  const handleSave = useCallback(() => {
    updateEdgeLabel(id, editValue.trim());
    setEditing(false);
  }, [id, editValue, updateEdgeLabel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setEditing(false);
    e.stopPropagation();
  }, [handleSave]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onEdgesChange([{ type: "remove", id }]);
  }, [id, onEdgesChange]);

  const hasLabel = typeof label === "string" && label.trim().length > 0;
  const showControls = hovered || selected;

  return (
    <>
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
          stroke: sourceCompleted
            ? "oklch(0.60 0.18 155 / 0.70)"
            : sourceFailed
              ? "oklch(0.55 0.18 25 / 0.60)"
              : selected
                ? "oklch(0.68 0.22 285)"
                : hovered
                  ? "oklch(0.50 0.015 260)"
                  : "oklch(0.28 0.010 260)",
          strokeWidth: selected ? 1.5 : hovered ? 1.5 : 1,
          filter: selected
            ? "drop-shadow(0 0 4px oklch(0.68 0.22 285 / 0.40))"
            : sourceCompleted
              ? "drop-shadow(0 0 3px oklch(0.65 0.18 155 / 0.35))"
              : undefined,
          transition: "stroke 300ms ease, stroke-width 140ms ease, filter 300ms ease",
          pointerEvents: "none",
        }}
      />

      {/* Flowing animation overlay when source node is executing */}
      {(sourceRunning || sourceCompleted) && (
        <path
          d={edgePath}
          fill="none"
          stroke={sourceRunning ? "oklch(0.78 0.22 142)" : "oklch(0.72 0.18 155)"}
          strokeWidth={sourceRunning ? 1.5 : 1}
          strokeDasharray="8 10"
          strokeLinecap="round"
          style={{
            animation: sourceRunning ? "edge-flow 0.45s linear infinite" : undefined,
            opacity: sourceRunning ? 0.85 : 0.45,
            strokeDashoffset: sourceCompleted && !sourceRunning ? -4 : 0,
          }}
          pointerEvents="none"
        />
      )}

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
                background: "oklch(0.13 0.007 260)",
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
                  color: "oklch(0.92 0.005 260)",
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
                style={{ color: "oklch(0.45 0.008 260)", padding: 1, lineHeight: 0 }}
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
                background: "oklch(0.13 0.007 260 / 0.95)",
                border: `1px solid ${selected ? "oklch(0.68 0.22 285 / 0.45)" : "oklch(0.24 0.008 260)"}`,
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
                    color: selected ? "oklch(0.82 0.12 285)" : "oklch(0.58 0.008 260)",
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
                    color: "oklch(0.40 0.006 260)",
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
              <div style={{ width: 1, height: 10, background: "oklch(0.24 0.008 260)", margin: "0 2px" }} />
              <button
                onClick={handleDelete}
                style={{
                  color: "oklch(0.40 0.008 260)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 2,
                  lineHeight: 0,
                  borderRadius: 4,
                  transition: "color 120ms ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.65 0.22 25)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.40 0.008 260)"; }}
                title="删除连线"
              >
                <Trash2 style={{ width: 10, height: 10 }} />
              </button>
            </div>
          ) : hasLabel ? (
            <div
              style={{
                background: "oklch(0.12 0.007 260 / 0.90)",
                border: "1px solid oklch(0.22 0.008 260)",
                borderRadius: 20,
                padding: "2px 8px",
                fontSize: 10,
                fontFamily: "var(--font-sans)",
                color: "oklch(0.52 0.008 260)",
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
