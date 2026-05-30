import { useRef } from "react";
import { GripHorizontal, PanelLeft, Users, Pin, PinOff, X, ExternalLink, ZoomIn, ZoomOut } from "lucide-react";
import { usePersistentState } from "@/hooks/usePersistentState";
import { useState } from "react";
import { ChatProvider } from "@/hooks/useChat";
import { ConversationList } from "./ConversationList";
import { ChatView } from "./ChatView";
import { MembersPanel } from "./MembersPanel";
import { C } from "./chatTheme";

interface Box { x: number; y: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Floating, draggable, resizable, pinnable chat window for inside the canvas.
 *  Mirrors the AI-assistant node feel: drag by header, resize from corner, pin. */
export function CanvasChatWindow({ onClose }: { onClose: () => void }) {
  const [box, setBox] = usePersistentState<Box>(
    "ui:chat-window:v2",
    { x: Math.max(24, (typeof window !== "undefined" ? window.innerWidth : 1200) - 460), y: 76, w: 440, h: 620 },
    { validate: (p) => (p && typeof p === "object" && "x" in p && "w" in p ? (p as Box) : null) },
  );
  const [pinned, setPinned] = usePersistentState<boolean>("ui:chat-window:pinned:v1", false,
    { validate: (p) => (typeof p === "boolean" ? p : null) });
  const [sidebar, setSidebar] = useState(true);
  const [members, setMembers] = useState(false);
  const dragRef = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);
  const rezRef = useRef<{ mx: number; my: number; w: number; h: number } | null>(null);
  // UI scale (zoom) of the window content — independent of window size.
  const [scale, setScale] = usePersistentState<number>("ui:chat-window:scale:v1", 1,
    { validate: (p) => (typeof p === "number" && p >= 0.6 && p <= 1.6 ? p : null) });
  const bumpScale = (d: number) => setScale((s) => Math.round(clamp(s + d, 0.6, 1.6) * 100) / 100);

  function onHeaderDown(e: React.MouseEvent) {
    if (pinned) return;
    e.preventDefault();
    dragRef.current = { mx: e.clientX, my: e.clientY, x: box.x, y: box.y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      setBox((b) => ({ ...b, x: clamp(d.x + ev.clientX - d.mx, 0, window.innerWidth - 120), y: clamp(d.y + ev.clientY - d.my, 0, window.innerHeight - 60) }));
    };
    const up = () => { dragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  }

  function onResizeDown(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    rezRef.current = { mx: e.clientX, my: e.clientY, w: box.w, h: box.h };
    const move = (ev: MouseEvent) => {
      const r = rezRef.current; if (!r) return;
      // Window is rendered scaled, so convert cursor delta (screen px) to the
      // window's own (unscaled) coordinates by dividing by the scale factor.
      const dx = (ev.clientX - r.mx) / scale;
      const dy = (ev.clientY - r.my) / scale;
      setBox((b) => ({ ...b, w: clamp(r.w + dx, 260, window.innerWidth - b.x), h: clamp(r.h + dy, 300, window.innerHeight - b.y) }));
    };
    const up = () => { rezRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  }

  return (
    <ChatProvider>
      <div style={{
        position: "fixed", left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 1000,
        background: C.bg, border: `1px solid ${C.borderStrong}`, borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column", boxShadow: "0 18px 50px rgba(0,0,0,0.55)", color: C.t1,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        // Scale the WHOLE window (chrome + body) from its top-left corner so its
        // anchored position doesn't shift when zooming.
        transform: `scale(${scale})`, transformOrigin: "top left",
      }}>
        {/* window chrome / drag handle */}
        <div onMouseDown={onHeaderDown} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", flexShrink: 0,
          borderBottom: `1px solid ${C.border}`, cursor: pinned ? "default" : "move", userSelect: "none", background: C.bg2,
        }}>
          <GripHorizontal size={15} style={{ color: C.t4 }} />
          <img src="/chat-icon.svg" width={18} height={18} alt="" style={{ borderRadius: 5 }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: C.accent }}>聊天</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            <Btn title="缩小界面" onClick={() => bumpScale(-0.1)}><ZoomOut size={15} /></Btn>
            <span title="界面缩放比例" onMouseDown={(e) => e.stopPropagation()} onClick={() => setScale(1)} style={{ fontSize: 11, color: C.t3, minWidth: 30, textAlign: "center", cursor: "pointer", userSelect: "none" }}>{Math.round(scale * 100)}%</span>
            <Btn title="放大界面" onClick={() => bumpScale(0.1)}><ZoomIn size={15} /></Btn>
            <Btn title={sidebar ? "隐藏会话栏" : "显示会话栏"} active={sidebar} onClick={() => setSidebar((v) => !v)}><PanelLeft size={15} /></Btn>
            <Btn title="成员/在线" active={members} onClick={() => setMembers((v) => !v)}><Users size={15} /></Btn>
            <Btn title={pinned ? "已固定（点解锁可拖动）" : "固定窗口"} active={pinned} onClick={() => setPinned((v) => !v)}>{pinned ? <Pin size={15} /> : <PinOff size={15} />}</Btn>
            <Btn title="在新标签打开完整页面" onClick={() => window.open("/chat", "_blank")}><ExternalLink size={15} /></Btn>
            <Btn title="关闭" onClick={onClose}><X size={15} /></Btn>
          </div>
        </div>

        {/* body */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
          {sidebar && <Drawer side="left" onClose={() => setSidebar(false)}><ConversationList /></Drawer>}
          <ChatView />
          {members && <Drawer side="right" onClose={() => setMembers(false)}><MembersPanel /></Drawer>}
        </div>

        {/* resize handle */}
        <div onMouseDown={onResizeDown} title="拖动调整大小" style={{
          position: "absolute", right: 0, bottom: 0, width: 18, height: 18, cursor: "nwse-resize",
          background: `linear-gradient(135deg, transparent 50%, ${C.borderStrong} 50%)`,
        }} />
      </div>
    </ChatProvider>
  );
}

function Btn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} onMouseDown={(e) => e.stopPropagation()} style={{
      width: 28, height: 28, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center",
      border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accentSoft : "transparent",
      color: active ? C.accent : C.t2, cursor: "pointer",
    }}>{children}</button>
  );
}

function Drawer({ side, onClose, children }: { side: "left" | "right"; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 30, display: "flex", justifyContent: side === "left" ? "flex-start" : "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ height: "100%" }}>{children}</div>
    </div>
  );
}
