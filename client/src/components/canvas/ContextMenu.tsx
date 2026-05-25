import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NODE_TYPE_LIST } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import {
  FileText, Copy, Trash2, Plus, Play, Pin, PinOff, ChevronUp, X, GripHorizontal,
} from "lucide-react";
import { NODE_ICONS } from "../../lib/nodeConfig";

interface ContextMenuProps {
  x: number;
  y: number;
  type: "canvas" | "node";
  nodeId?: string;
  nodePinned?: boolean;
  onClose: () => void;
  onAddNode?: (type: NodeType) => void;
  onDeleteNode?: () => void;
  onDuplicateNode?: () => void;
  onRunWorkflow?: () => void;
  onTogglePin?: () => void;
  onCollapse?: () => void;
}

export function ContextMenu({
  x, y, type, nodeId, nodePinned,
  onClose, onAddNode, onDeleteNode, onDuplicateNode, onRunWorkflow,
  onTogglePin, onCollapse,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  // Canvas (node picker) only: persist + drag controls so the picker can stay
  // open on canvas as a floating palette. The per-node menu doesn't need these.
  const [persistent, setPersistent] = useState(false);
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    initLeft: number;
    initTop: number;
    onMove: (e: MouseEvent) => void;
    onUp: () => void;
  } | null>(null);

  // Close on outside click / Escape — but skip when canvas menu is persistent
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (persistent) return; // pinned menu doesn't auto-close
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose, persistent]);

  // Drag the menu by its header. Only matters when persistent — but allowed
  // always so user can reposition before pinning.
  // Track the active mousemove/mouseup pair on the dragRef itself so we can
  // detach them from a useEffect cleanup if the menu unmounts mid-drag
  // (e.g. user presses Escape while holding the mouse button).
  const startDrag = (e: React.MouseEvent) => {
    if (!menuRef.current) return;
    // Don't start drag when clicking the pin / close buttons inside the header
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const rect = menuRef.current.getBoundingClientRect();
    const menuW = rect.width;
    const menuH = rect.height;
    const onMove = (mv: MouseEvent) => {
      if (!dragRef.current) return;
      // Clamp using the menu's actual rendered size so it can't be dragged
      // mostly off-screen (was hardcoded 100/60, which let a 210-wide menu
      // hang off the right with its close button outside the viewport).
      const next = {
        left: Math.max(0, Math.min(window.innerWidth - menuW, dragRef.current.initLeft + mv.clientX - dragRef.current.startX)),
        top:  Math.max(0, Math.min(window.innerHeight - menuH, dragRef.current.initTop  + mv.clientY - dragRef.current.startY)),
      };
      setDragPos(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      initLeft: rect.left, initTop: rect.top,
      onMove, onUp,
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Cleanup any in-flight drag listeners on unmount so they don't leak +
  // setState on the unmounted component.
  useEffect(() => {
    return () => {
      if (dragRef.current) {
        window.removeEventListener("mousemove", dragRef.current.onMove);
        window.removeEventListener("mouseup", dragRef.current.onUp);
        dragRef.current = null;
      }
    };
  }, []);

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
      className={persistent ? undefined : "animate-scale-in"}
      style={{
        position: "fixed",
        left: dragPos?.left ?? pos?.left ?? x,
        top: dragPos?.top ?? pos?.top ?? y,
        zIndex: 9999,
        background: "var(--c-base)",
        border: `1px solid ${persistent ? "oklch(0.68 0.22 285 / 0.45)" : "var(--c-bd2)"}`,
        borderRadius: 12,
        boxShadow: persistent
          ? "0 8px 40px oklch(0 0 0 / 0.65), 0 0 0 1px oklch(0.68 0.22 285 / 0.25)"
          : "0 8px 40px oklch(0 0 0 / 0.65), 0 2px 8px oklch(0 0 0 / 0.4)",
        minWidth: menuWidth,
        overflow: "hidden",
        // Before measurement: invisible to avoid position flash
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {type === "canvas" ? (
        <>
          {/* Header — draggable when persistent; hosts pin + close buttons */}
          <div
            onMouseDown={startDrag}
            style={{
              padding: "6px 6px 6px 10px",
              borderBottom: "1px solid var(--c-bd1)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: persistent ? "move" : "default",
              userSelect: "none",
              background: persistent ? "oklch(0.68 0.22 285 / 0.08)" : "transparent",
            }}
          >
            {persistent && <GripHorizontal className="w-3 h-3" style={{ color: "oklch(0.78 0.16 285)" }} />}
            {!persistent && <Plus className="w-3 h-3" style={{ color: "var(--c-t4)" }} />}
            <span style={{
              fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em",
              color: persistent ? "oklch(0.82 0.16 285)" : "var(--c-t4)",
              flex: 1,
            }}>
              {persistent ? "添加节点（已固定）" : "添加节点"}
            </span>
            <button
              onClick={() => setPersistent((v) => !v)}
              title={persistent ? "取消固定 — 关闭后将自动隐藏" : "固定显示 — 保持菜单在画布上，可拖拽位置"}
              style={{
                background: "none", border: "none", padding: 3, borderRadius: 4,
                cursor: "pointer",
                color: persistent ? "oklch(0.82 0.16 285)" : "var(--c-t3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {persistent ? <PinOff size={11} /> : <Pin size={11} />}
            </button>
            <button
              onClick={onClose}
              title="关闭"
              style={{
                background: "none", border: "none", padding: 3, borderRadius: 4,
                cursor: "pointer", color: "var(--c-t3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
            >
              <X size={12} />
            </button>
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
                  onClick={() => { onAddNode?.(config.type); if (!persistent) onClose(); }}
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
          {onRunWorkflow && (onTogglePin || onCollapse) && (
            <div style={{ height: 1, background: "var(--c-bd1)", margin: "3px 6px" }} />
          )}
          {/* Pin / Unpin — keeps the node's input panel expanded regardless of selection.
              Useful when you want to watch several nodes' output side by side without
              having to keep clicking them. */}
          {onTogglePin && (
            <button
              onClick={() => { onTogglePin(); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "7px 8px", fontSize: 12,
                cursor: "pointer", background: "transparent", border: "none",
                textAlign: "left",
                color: nodePinned ? "oklch(0.72 0.20 285)" : "var(--c-t2)",
                borderRadius: 8,
                transition: "all 120ms ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {nodePinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              {nodePinned ? "取消固定（恢复自动折叠）" : "固定显示（始终展开）"}
            </button>
          )}
          {/* Collapse — quick "fold this node now". Clears pin and de-selects so the
              node returns to its compact preview-only state. */}
          {onCollapse && (
            <button
              onClick={() => { onCollapse(); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "7px 8px", fontSize: 12,
                cursor: "pointer", background: "transparent", border: "none",
                textAlign: "left", color: "var(--c-t2)", borderRadius: 8,
                transition: "all 120ms ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--c-t3)" }} />
              立即折叠
            </button>
          )}
          {(onTogglePin || onCollapse) && (onDuplicateNode || onDeleteNode) && (
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
