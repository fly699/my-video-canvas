import { useReactFlow } from "@xyflow/react";
import {
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
} from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useSelectionScreenBox } from "../../hooks/useSelectionScreenBox";

// ◆2 对齐 / 分布工具条：选中 ≥2 个节点时浮在底部(所有皮肤通用)。用 ReactFlow 的 measured 尺寸
// 计算目标位置，批量落位(batchUpdateNodePositions 入历史，可撤销)。
type Rect = { id: string; x: number; y: number; w: number; h: number };

export function AlignToolbar() {
  const rf = useReactFlow();
  // 仅在「≥2 个非 group 节点被选中」时显示；用稳定 key 触发重渲染。
  const selKey = useCanvasStore((s) => s.nodes.filter((n) => n.selected && n.data.nodeType !== "group").map((n) => n.id).join(","));
  const box = useSelectionScreenBox();
  const ids = selKey ? selKey.split(",") : [];
  if (ids.length < 2) return null;

  // 吸附到框选区域「上边」；顶部空间不足时下压，水平中心夹在视口内，避免飞出屏幕。
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const anchorPos = box
    ? { top: Math.max(box.top, 88), left: Math.min(Math.max(box.cx, 180), vw - 180), transform: "translate(-50%, calc(-100% - 10px))" as const }
    : { top: 64, left: "50%" as const, transform: "translateX(-50%)" as const };

  const rects = (): Rect[] => ids.map((id) => {
    const n = rf.getNode(id);
    const w = n?.measured?.width ?? n?.width ?? 240;
    const h = n?.measured?.height ?? n?.height ?? 120;
    return { id, x: n?.position.x ?? 0, y: n?.position.y ?? 0, w, h };
  });
  const apply = (updates: { id: string; position: { x: number; y: number } }[]) => {
    if (updates.length) useCanvasStore.getState().batchUpdateNodePositions(updates);
  };
  const align = (mode: "l" | "hc" | "r" | "t" | "vc" | "b") => {
    const rs = rects();
    const minX = Math.min(...rs.map((r) => r.x)), maxR = Math.max(...rs.map((r) => r.x + r.w));
    const minY = Math.min(...rs.map((r) => r.y)), maxB = Math.max(...rs.map((r) => r.y + r.h));
    const cx = (minX + maxR) / 2, cy = (minY + maxB) / 2;
    apply(rs.map((r) => {
      let x = r.x, y = r.y;
      if (mode === "l") x = minX;
      else if (mode === "r") x = maxR - r.w;
      else if (mode === "hc") x = Math.round(cx - r.w / 2);
      else if (mode === "t") y = minY;
      else if (mode === "b") y = maxB - r.h;
      else if (mode === "vc") y = Math.round(cy - r.h / 2);
      return { id: r.id, position: { x: Math.round(x), y: Math.round(y) } };
    }));
  };
  // 等距分布：按各自中心排序，让相邻中心间距相等(需 ≥3 个才有意义)。
  const distribute = (axis: "h" | "v") => {
    const rs = rects();
    if (rs.length < 3) return;
    const key = axis === "h" ? (r: Rect) => r.x + r.w / 2 : (r: Rect) => r.y + r.h / 2;
    const sorted = [...rs].sort((a, b) => key(a) - key(b));
    const first = key(sorted[0]), last = key(sorted[sorted.length - 1]);
    const step = (last - first) / (sorted.length - 1);
    apply(sorted.map((r, i) => {
      const center = first + step * i;
      return axis === "h"
        ? { id: r.id, position: { x: Math.round(center - r.w / 2), y: Math.round(r.y) } }
        : { id: r.id, position: { x: Math.round(r.x), y: Math.round(center - r.h / 2) } };
    }));
  };

  const canDist = ids.length >= 3;
  return (
    <div className="nodrag" style={{ position: "fixed", top: anchorPos.top, left: anchorPos.left, transform: anchorPos.transform, zIndex: 44,
      display: "flex", alignItems: "center", gap: 2, padding: "5px 7px", borderRadius: 12,
      background: "color-mix(in oklch, var(--c-elevated) 92%, transparent)", backdropFilter: "blur(18px)",
      border: "1px solid var(--c-bd2)", boxShadow: "var(--c-node-shadow-hover)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", padding: "0 6px" }}>对齐 {ids.length}</span>
      <Btn onClick={() => align("l")} title="左对齐"><AlignHorizontalJustifyStart size={15} /></Btn>
      <Btn onClick={() => align("hc")} title="水平居中"><AlignHorizontalJustifyCenter size={15} /></Btn>
      <Btn onClick={() => align("r")} title="右对齐"><AlignHorizontalJustifyEnd size={15} /></Btn>
      <span style={{ width: 1, height: 16, background: "var(--c-bd2)", margin: "0 3px" }} />
      <Btn onClick={() => align("t")} title="顶对齐"><AlignVerticalJustifyStart size={15} /></Btn>
      <Btn onClick={() => align("vc")} title="垂直居中"><AlignVerticalJustifyCenter size={15} /></Btn>
      <Btn onClick={() => align("b")} title="底对齐"><AlignVerticalJustifyEnd size={15} /></Btn>
      <span style={{ width: 1, height: 16, background: "var(--c-bd2)", margin: "0 3px" }} />
      <Btn onClick={() => distribute("h")} title="水平等距分布(≥3)" disabled={!canDist}><AlignHorizontalDistributeCenter size={15} /></Btn>
      <Btn onClick={() => distribute("v")} title="垂直等距分布(≥3)" disabled={!canDist}><AlignVerticalDistributeCenter size={15} /></Btn>
    </div>
  );
}

function Btn({ onClick, title, children, disabled }: { onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button className="studio-toolbtn" onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }} disabled={disabled} title={title}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 28, borderRadius: 8,
        border: "1px solid transparent", background: "transparent", color: disabled ? "var(--c-t4)" : "var(--c-t2)",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }}>
      {children}
    </button>
  );
}
