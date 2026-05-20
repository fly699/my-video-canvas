import { useState, useCallback, useRef, useEffect, memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { Check, X } from "lucide-react";

export const CustomEdge = memo(function CustomEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  selected, label,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const { updateEdgeLabel } = useCanvasStore();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(typeof label === "string" ? label : "");
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

  const hasLabel = typeof label === "string" && label.trim().length > 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        interactionWidth={16}
        style={{
          stroke: selected ? "oklch(0.68 0.22 285)" : "oklch(0.32 0.012 260)",
          strokeWidth: selected ? 2 : 1.5,
          filter: selected ? "drop-shadow(0 0 5px oklch(0.68 0.22 285 / 0.45))" : undefined,
          transition: "stroke 120ms ease, stroke-width 120ms ease",
        }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
          onDoubleClick={handleDoubleClick}
        >
          {editing ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "oklch(0.12 0.007 260)",
                border: "1px solid oklch(0.68 0.22 285 / 0.55)",
                borderRadius: 6,
                padding: "3px 6px",
                boxShadow: "0 4px 20px oklch(0 0 0 / 0.55), 0 0 0 1px oklch(0.68 0.22 285 / 0.15)",
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
                  width: 72,
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
                style={{ color: "oklch(0.50 0.008 260)", padding: 1, lineHeight: 0 }}
              >
                <X style={{ width: 10, height: 10 }} />
              </button>
            </div>
          ) : hasLabel ? (
            <div
              style={{
                background: "oklch(0.12 0.007 260 / 0.92)",
                border: `1px solid ${selected ? "oklch(0.68 0.22 285 / 0.50)" : "oklch(0.24 0.008 260)"}`,
                borderRadius: 99,
                padding: "2px 9px",
                fontSize: 10,
                fontFamily: "var(--font-sans)",
                color: selected ? "oklch(0.82 0.12 285)" : "oklch(0.58 0.008 260)",
                backdropFilter: "blur(10px)",
                cursor: "pointer",
                transition: "all 120ms ease",
                userSelect: "none",
                whiteSpace: "nowrap",
                letterSpacing: "0.01em",
              }}
              title="双击编辑标签"
            >
              {label as string}
            </div>
          ) : selected ? (
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); setEditValue(""); }}
              style={{
                background: "oklch(0.13 0.007 260 / 0.90)",
                border: "1px dashed oklch(0.30 0.010 260)",
                borderRadius: 99,
                padding: "2px 9px",
                fontSize: 10,
                fontFamily: "var(--font-sans)",
                color: "oklch(0.42 0.006 260)",
                cursor: "pointer",
                backdropFilter: "blur(10px)",
                transition: "all 120ms ease",
                letterSpacing: "0.01em",
              }}
            >
              + 标签
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
