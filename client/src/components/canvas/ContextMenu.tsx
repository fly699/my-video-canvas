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

  // Resize state — only active when persistent
  const MIN_W = 180;
  const MIN_H = 160;
  const [panelSize, setPanelSize] = useState<{ w: number; h: number | null }>({ w: 210, h: null });
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    initW: number;
    initH: number;
    onMove: (e: MouseEvent) => void;
    onUp: () => void;
  } | null>(null);

  // Reset size when unpinned; cancel any in-flight resize drag to avoid listener leak
  useEffect(() => {
    if (!persistent) {
      if (resizeRef.current) {
        window.removeEventListener("mousemove", resizeRef.current.onMove);
        window.removeEventListener("mouseup", resizeRef.current.onUp);
        resizeRef.current = null;
      }
      setPanelSize({ w: 210, h: null });
    }
  }, [persistent]);

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

  // Resize the panel from the bottom-right handle (persistent only).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    // Compute max dimensions from the menu's current position so the menu
    // can't be dragged past the viewport's right/bottom edge.
    const maxW = window.innerWidth - rect.left - 8;
    const maxH = window.innerHeight - rect.top - 8;
    const onMove = (mv: MouseEvent) => {
      if (!resizeRef.current) return;
      setPanelSize({
        w: Math.min(maxW, Math.max(MIN_W, resizeRef.current.initW + mv.clientX - resizeRef.current.startX)),
        h: Math.min(maxH, Math.max(MIN_H, resizeRef.current.initH + mv.clientY - resizeRef.current.startY)),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    resizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      initW: rect.width, initH: rect.height,
      onMove, onUp,
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Cleanup any in-flight drag/resize listeners on unmount.
  useEffect(() => {
    return () => {
      if (dragRef.current) {
        window.removeEventListener("mousemove", dragRef.current.onMove);
        window.removeEventListener("mouseup", dragRef.current.onUp);
        dragRef.current = null;
      }
      if (resizeRef.current) {
        window.removeEventListener("mousemove", resizeRef.current.onMove);
        window.removeEventListener("mouseup", resizeRef.current.onUp);
        resizeRef.current = null;
      }
    };
  }, []);

  // Measure actual rendered size, then compute smart position.
  // Also re-runs on panelSize.w change so widening the menu re-checks
  // horizontal overflow and shifts pos if needed (dragPos takes priority
  // over pos for display, so this only matters when the user hasn't dragged).
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;

    let left = x;
    if (x + width + gap > vw) left = Math.max(gap, x - width);

    let top = y;
    const maxHeight = Math.min(height, vh - gap * 2);
    if (y + maxHeight + gap > vh) {
      top = Math.max(gap, vh - maxHeight - gap);
    }

    setPos({ left, top, maxHeight });
  }, [x, y, panelSize.w, panelSize.h]);

  const menuWidth = 210;
  // When persistent and user has set a size, use it; otherwise fall back to menuWidth
  const currentW = persistent ? panelSize.w : menuWidth;
  const currentH = persistent && panelSize.h != null ? panelSize.h : null;

  return (
    // Outer shell: handles position + size. overflow:visible so the resize handle
    // is not clipped. Visual styling (border-radius, clip) is on the inner shell.
    <div
      ref={menuRef}
      className={persistent ? undefined : "animate-scale-in"}
      style={{
        position: "fixed",
        left: dragPos?.left ?? pos?.left ?? x,
        top: dragPos?.top ?? pos?.top ?? y,
        zIndex: 9999,
        width: currentW,
        ...(currentH != null ? { height: currentH } : {}),
        minWidth: MIN_W,
        ...(persistent ? { minHeight: MIN_H } : {}),
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {/* Inner shell: carries all visual styles + clips content to border-radius */}
      <div
        style={{
          width: "100%",
          height: currentH != null ? "100%" : undefined,
          background: "var(--c-base)",
          border: `1px solid ${persistent ? "oklch(0.68 0.22 285 / 0.45)" : "var(--c-bd2)"}`,
          borderRadius: 12,
          boxShadow: persistent
            ? "0 8px 40px oklch(0 0 0 / 0.65), 0 0 0 1px oklch(0.68 0.22 285 / 0.25)"
            : "0 8px 40px oklch(0 0 0 / 0.65), 0 2px 8px oklch(0 0 0 / 0.4)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
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
                flexShrink: 0,
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
              // When height is user-controlled via resize, fill remaining space;
              // otherwise cap at viewport-aware maxHeight from initial measurement.
              flex: currentH != null ? 1 : undefined,
              maxHeight: currentH != null ? undefined : (pos ? pos.maxHeight - 40 : "none"),
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

      {/* Resize handle — only shown when the canvas menu is pinned.
          Lives on the outer shell (overflow:visible) so it's not clipped
          by the inner shell's overflow:hidden + border-radius. */}
      {persistent && type === "canvas" && (
        <div
          onMouseDown={startResize}
          title="拖拽调整大小"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            padding: "3px",
            zIndex: 1,
          }}
        >
          {/* Three-dot diagonal resize indicator */}
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.45 }}>
            <circle cx="1.5" cy="7.5" r="1" fill="oklch(0.78 0.16 285)" />
            <circle cx="4.5" cy="4.5" r="1" fill="oklch(0.78 0.16 285)" />
            <circle cx="7.5" cy="1.5" r="1" fill="oklch(0.78 0.16 285)" />
          </svg>
        </div>
      )}
    </div>
  );
}
