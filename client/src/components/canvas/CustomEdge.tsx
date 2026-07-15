import { useState, useCallback, useRef, useEffect, memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useHoverStore } from "../../hooks/useHoverStore";
import { edgeOrderIndex } from "../../lib/inputOrder";
import { useWorkflowRunState } from "../../contexts/WorkflowRunContext";
import { useCanvasMode } from "../../contexts/CanvasModeContext";
import { useUIStyle } from "../../contexts/UIStyleContext";
import { getNodeConfig } from "../../lib/nodeConfig";
import { Check, X, Trash2, Plus } from "lucide-react";
import { useEdgeInsert } from "../../hooks/useEdgeInsert";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

function arrowPoints(tx: number, ty: number, pos: Position, sz: number, hw: number): string {
  if (pos === Position.Left)  return `${tx+sz},${ty-hw} ${tx+sz},${ty+hw} ${tx},${ty}`;
  if (pos === Position.Right) return `${tx-sz},${ty-hw} ${tx-sz},${ty+hw} ${tx},${ty}`;
  if (pos === Position.Top)   return `${tx-hw},${ty+sz} ${tx+hw},${ty+sz} ${tx},${ty}`;
  return `${tx-hw},${ty-sz} ${tx+hw},${ty-sz} ${tx},${ty}`;
}

// Replicate ReactFlow's bezier control-point math so we can place a point exactly
// ON the curve (not on the straight chord between endpoints, which drifts far from
// the rendered line when many edges fan out — the order badges then float off-line).
function ctrlOffset(distance: number, curvature: number): number {
  return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
}
function bezierControl(pos: Position, x1: number, y1: number, x2: number, y2: number, c = 0.25): [number, number] {
  switch (pos) {
    case Position.Left:   return [x1 - ctrlOffset(x1 - x2, c), y1];
    case Position.Right:  return [x1 + ctrlOffset(x2 - x1, c), y1];
    case Position.Top:    return [x1, y1 - ctrlOffset(y1 - y2, c)];
    default:              return [x1, y1 + ctrlOffset(y2 - y1, c)]; // Bottom
  }
}
// Cubic bezier point at parameter t (0=source … 1=target).
function bezierAt(t: number, p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
  return { x: a * p0[0] + b * p1[0] + cc * p2[0] + d * p3[0], y: a * p0[1] + b * p1[1] + cc * p2[1] + d * p3[1] };
}

const PARTICLE_COUNT = 3;

export const CustomEdge = memo(function CustomEdge({
  id,
  source, target,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  selected, label,
}: EdgeProps) {
  const { running, completedIds, currentNodeId, failedIds } = useWorkflowRunState();
  const reducedMotion = usePrefersReducedMotion(); // 减少动态时不渲染 SVG SMIL 流动粒子
  const sourceRunning = running && currentNodeId === source;
  const sourceCompleted = completedIds.includes(source ?? "");
  const sourceFailed = failedIds.includes(source ?? "");

  const nodes = useCanvasStore(s => s.nodes);
  // Input/output order badge: shown near the relevant handle when the edge's
  // target (input) or source (output) node is hovered, so multi-input ordering
  // (参考图1/2, merge clip order …) is visible right on the connection.
  const hoveredNodeId = useHoverStore(s => s.nodeId);
  const allEdges = useCanvasStore(s => s.edges);
  // ◆11 聚焦模式：有节点被选中时，只有与其相连的边保持高亮，其余淡出，减少大图连线噪音。
  const focusState = useCanvasStore((s) => {
    let anySel = false;
    for (const n of s.nodes) { if (n.selected) { anySel = true; if (n.id === source || n.id === target) return "on"; } }
    return anySel ? "dim" : "none";
  });
  const dimmed = focusState === "dim";
  // LibTV 化 3.1：创意模式连线为「低透明细白直线」——路径与配色都按模式分支，
  // hooks 需在 orderBadge 计算之前取得。
  const { mode: canvasMode, creativeTheme } = useCanvasMode();
  const isCreative = canvasMode === "creative";
  // 创意浅色变体：连线的「反色强调」要翻成深色，否则近白线在浅底上完全看不见。
  const isCreativeLight = isCreative && creativeTheme === "light";
  const inkBase = isCreativeLight ? "0.30 0 0" : "0.97 0 0"; // 浅色→深墨线；深色→近白线
  const { uiStyle } = useUIStyle();
  const isStudio = uiStyle === "studio";
  let orderBadge: { x: number; y: number; n: number } | null = null;
  if (hoveredNodeId && (hoveredNodeId === target || hoveredNodeId === source)) {
    const side = hoveredNodeId === target ? "in" : "out";
    const { index, total } = edgeOrderIndex(id, side, hoveredNodeId, allEdges, nodes);
    if (index >= 0 && total > 1) {
      // Place the badge ON the bezier curve. Many edges converge on one node, so a
      // FIXED distance piles every badge on top of each other near the handle.
      // Stagger each badge's distance along its curve by its order index — since the
      // edge bundle fans out away from the node, different distances separate them.
      // 全模式统一贝塞尔曲线，序号徽标沿真实曲线取点（控制点用与 getBezierPath 同款算法）。
      const sc = bezierControl(sourcePosition, sourceX, sourceY, targetX, targetY);
      const tc = bezierControl(targetPosition, targetX, targetY, sourceX, sourceY);
      const frac = total > 1 ? index / (total - 1) : 0; // 0..1 across the order
      const spread = Math.min(0.34, 0.05 * total); // wider stagger when more edges
      // "in": closest to target for #1, stepping further back; "out": mirror.
      const param = side === "in" ? 0.9 - frac * spread : 0.1 + frac * spread;
      const p = bezierAt(param, [sourceX, sourceY], sc, tc, [targetX, targetY]);
      orderBadge = { x: p.x, y: p.y, n: index + 1 };
    }
  }
  const sourceNodeType = nodes.find(n => n.id === source)?.data.nodeType as string | undefined;
  const typeColor = sourceNodeType ? getNodeConfig(sourceNodeType as Parameters<typeof getNodeConfig>[0]).color : null;

  // 全模式统一平滑贝塞尔曲线（对齐 LibTV/悠船——其连线是平滑曲线，而非早前误判的直线）。
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
      : isCreative
        // LibTV：低透明细「墨线」，交互只加深/提亮不变彩色（反色强调）；完成/失败保留状态色。
        // 深色皮肤=近白线；浅色皮肤=深墨线（否则白线在浅底上不可见），静止态浅色下透明度略高更清晰。
        ? (selected ? `oklch(${inkBase} / 0.95)` : hovered ? `oklch(${inkBase} / ${isCreativeLight ? 0.7 : 0.6})` : `oklch(${inkBase} / ${isCreativeLight ? 0.42 : 0.25})`)
        : selected
          ? (typeColor ?? "oklch(0.68 0.24 285)")
          : hovered
            ? (typeColor ?? "oklch(0.72 0.18 285)")
            : typeColor
              ? `${typeColor}c0`
              : "oklch(0.68 0.16 260 / 0.75)";

  // Slightly thinner than the bold pass (user asked to slim down a touch);
  // hover/selection still step up for emphasis.
  const strokeWidth = isCreative
    ? selected ? 2.25 : hovered ? 1.75 : 1.25
    : isStudio
      ? selected ? 3.5 : hovered ? 3 : 2.4   // studio: a touch thicker/softer flow
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
          // LibTV（创意）极简：常态不带彩色光晕，只留运行/完成/失败的状态辉光。
          filter: selected
            ? (isCreative ? `drop-shadow(0 0 5px oklch(${inkBase} / 0.35))` : "drop-shadow(0 0 6px oklch(0.68 0.22 285 / 0.55))")
            : sourceCompleted
              ? "drop-shadow(0 0 5px oklch(0.65 0.20 155 / 0.45))"
              : sourceFailed
                ? "drop-shadow(0 0 5px oklch(0.62 0.22 25 / 0.45))"
                : sourceRunning
                  ? "drop-shadow(0 0 6px oklch(0.85 0.26 142 / 0.55))"
                  : (!isCreative && typeColor)
                    ? `drop-shadow(0 0 4px ${typeColor}77)`
                    : undefined,
          transition: "stroke 300ms ease, stroke-width 140ms ease, filter 300ms ease, opacity 160ms ease",
          pointerEvents: "none",
          opacity: dimmed ? 0.16 : 1,       // ◆11 聚焦淡出
        }}
      />

      {/* ◆11 流动粒子——只在「运行中」出现(静态时安静),且聚焦淡出的边不画粒子。
          三层/粒子:外柔光晕、内光晕、亮核。 */}
      {(running || sourceRunning || sourceCompleted || sourceFailed) && !dimmed && !reducedMotion && Array.from({ length: PARTICLE_COUNT }, (_, i) => {
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
        opacity={dimmed ? 0.16 : (isCreative ? 0.9 : 1.0)}
        style={{ transition: "opacity 160ms ease" }}
        pointerEvents="none"
      />

      {/* Input/output order number near the hovered node's handle.
          Filled with the (solid) edge/type color and a white, dark-outlined
          number so it stays high-contrast and readable in every theme — the
          old version filled with the page background and drew the digit in the
          (alpha-dimmed) edge color, which read as an unreadable dark blob. */}
      {orderBadge && (() => {
        const badgeColor = typeColor ?? "oklch(0.70 0.20 285)";
        return (
          <g pointerEvents="none" style={{ transition: "opacity 120ms ease" }}>
            <circle cx={orderBadge.x} cy={orderBadge.y} r={10} fill={badgeColor} stroke="var(--c-base)" strokeWidth={2.5} />
            <text
              x={orderBadge.x} y={orderBadge.y}
              textAnchor="middle" dominantBaseline="central"
              fontSize={11.5} fontWeight={800} fill="#ffffff"
              style={{ paintOrder: "stroke", stroke: "oklch(0 0 0 / 0.45)", strokeWidth: 2.5 }}
            >{orderBadge.n}</text>
          </g>
        );
      })()}

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
              {/* ◆1 线上插入节点：点 ⊕ 打开节点选择器，选完把节点插进这条边中点 */}
              <button
                onClick={(e) => { e.stopPropagation(); useEdgeInsert.getState().requestInsert(id); }}
                style={{ color: "var(--c-t4)", background: "transparent", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, borderRadius: 4, transition: "color 120ms ease" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.62 0.19 285)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
                title="在此处插入节点"
              >
                <Plus style={{ width: 11, height: 11 }} />
              </button>
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
