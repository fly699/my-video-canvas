import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NODE_TYPE_LIST } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import {
  FileText, Copy, Trash2, Plus, Play,
} from "lucide-react";
import { NODE_ICONS } from "../../lib/nodeConfig";

interface ContextMenuProps {
  x: number;
  y: number;
  type: "canvas" | "node";
  nodeId?: string;
  onClose: () => void;
  onAddNode?: (type: NodeType) => void;
  onDeleteNode?: () => void;
  onDuplicateNode?: () => void;
  onRunWorkflow?: () => void;
}

export function ContextMenu({
  x, y, type, nodeId,
  onClose, onAddNode, onDeleteNode, onDuplicateNode, onRunWorkflow,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  // Close on outside click / Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Measure actual rendered size, then compute smart position
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;

    // Horizontal: prefer right of cursor, flip left if needed
    let left = x;
    if (x + width + gap > vw) left = Math.max(gap, x - width);

    // Vertical: prefer below cursor, flip above if needed
    let top = y;
    const maxHeight = Math.min(height, vh - gap * 2);
    if (y + maxHeight + gap > vh) {
      top = Math.max(gap, vh - maxHeight - gap);
    }

    setPos({ left, top, maxHeight });
  }, [x, y]);

  const menuWidth = 210;

  return (
    <div
      ref={menuRef}
      className="animate-scale-in"
      style={{
        position: "fixed",
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        zIndex: 9999,
        background: "var(--c-base)",
        border: "1px solid var(--c-bd2)",
        borderRadius: 12,
        boxShadow: "0 8px 40px oklch(0 0 0 / 0.65), 0 2px 8px oklch(0 0 0 / 0.4)",
        minWidth: menuWidth,
        overflow: "hidden",
        // Before measurement: invisible to avoid position flash
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {type === "canvas" ? (
        <>
          <div
            style={{
              padding: "8px 10px 6px",
              borderBottom: "1px solid var(--c-bd1)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Plus className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
            <span style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>
              添加节点
            </span>
          </div>
          <div style={{
            padding: "4px",
            overflowY: "auto",
            maxHeight: pos ? pos.maxHeight - 40 : "none",
            scrollbarWidth: "thin",
            scrollbarColor: "var(--c-bd3) transparent",
          }}>
            {/* ComfyUI nodes pinned to the top — same sort policy as NodePicker */}
            {[...NODE_TYPE_LIST].sort((a, b) => {
              const aIsComfy = a.type === "comfyui_image" || a.type === "comfyui_video";
              const bIsComfy = b.type === "comfyui_image" || b.type === "comfyui_video";
              if (aIsComfy && !bIsComfy) return -1;
              if (!aIsComfy && bIsComfy) return 1;
              return 0;
            }).map((config) => {
              const Icon = NODE_ICONS[config.icon] ?? FileText;
              const showSubtitle = config.defaultTitle !== config.label;
              return (
                <button
                  key={config.type}
                  onClick={() => { onAddNode?.(config.type); onClose(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "7px 8px",
                    fontSize: 12,
                    cursor: "pointer",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    color: "var(--c-t2)",
                    borderRadius: 8,
                    transition: "all 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                    (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
                  }}
                >
                  <div
                    style={{
                      width: 22, height: 22, borderRadius: 6,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: `${config.color}18`,
                      border: `1px solid ${config.color}35`,
                      flexShrink: 0,
                    }}
                  >
                    <Icon className="w-3 h-3" style={{ color: config.color }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, lineHeight: 1.2 }}>{config.label}</div>
                    {showSubtitle && (
                      <div style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 1 }}>{config.defaultTitle}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ padding: "4px" }}>
          {onRunWorkflow && (
            <button
              onClick={() => { onRunWorkflow(); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "7px 8px", fontSize: 12,
                cursor: "pointer", background: "transparent", border: "none",
                textAlign: "left", color: "oklch(0.72 0.22 142)", borderRadius: 8,
                transition: "all 120ms ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.72 0.22 142 / 0.10)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.22 142)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.72 0.22 142)"; }}
            >
              <Play className="w-3.5 h-3.5" />
              从此节点运行工作流
            </button>
          )}
          {onRunWorkflow && (onDuplicateNode || onDeleteNode) && (
            <div style={{ height: 1, background: "var(--c-bd1)", margin: "3px 6px" }} />
          )}
          {onDuplicateNode && (
            <button
              onClick={() => { onDuplicateNode(); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "7px 8px", fontSize: 12,
                cursor: "pointer", background: "transparent", border: "none",
                textAlign: "left", color: "var(--c-t2)", borderRadius: 8,
                transition: "all 120ms ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t2)"; }}
            >
              <Copy className="w-3.5 h-3.5" style={{ color: "var(--c-t3)" }} />
              复制节点
            </button>
          )}
          {onDuplicateNode && onDeleteNode && (
            <div style={{ height: 1, background: "var(--c-bd1)", margin: "3px 6px" }} />
          )}
          {onDeleteNode && (
            <button
              onClick={() => { onDeleteNode(); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "7px 8px", fontSize: 12,
                cursor: "pointer", background: "transparent", border: "none",
                textAlign: "left", color: "oklch(0.62 0.20 25)", borderRadius: 8,
                transition: "all 120ms ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.62 0.20 25 / 0.10)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.70 0.22 25)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.62 0.20 25)"; }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除节点
            </button>
          )}
        </div>
      )}
    </div>
  );
}
