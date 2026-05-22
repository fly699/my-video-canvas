import { useEffect, useRef } from "react";
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

  const menuWidth = 210;
  const menuHeight = type === "canvas" ? 360 : (onRunWorkflow ? 148 : 110);
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="animate-scale-in"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9999,
        background: "var(--c-base)",
        border: "1px solid var(--c-bd2)",
        borderRadius: 12,
        boxShadow: "0 8px 40px oklch(0 0 0 / 0.65), 0 2px 8px oklch(0 0 0 / 0.4)",
        minWidth: menuWidth,
        overflow: "hidden",
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
          <div style={{ padding: "4px" }}>
            {NODE_TYPE_LIST.map((config) => {
              const Icon = NODE_ICONS[config.icon] ?? FileText;
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
                    <div style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 1 }}>{config.defaultTitle}</div>
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
