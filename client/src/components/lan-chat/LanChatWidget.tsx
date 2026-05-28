import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Minus, X, ExternalLink } from "lucide-react";
import { usePersistentState } from "@/hooks/usePersistentState";
import { useLanChat } from "@/hooks/useLanChat";
import { useLanChatNotifications } from "@/hooks/useLanChatNotifications";
import { NicknamePicker } from "./NicknamePicker";
import { LanChatPanel } from "./LanChatPanel";

type WidgetState = "hidden" | "bubble" | "open";

interface FloatLayout {
  pos: { x: number; y: number };
  size: { w: number; h: number };
}
interface BubblePos { right: number; bottom: number; }

const DEFAULT_LAYOUT: FloatLayout = { pos: { x: 120, y: 120 }, size: { w: 520, h: 560 } };
const DEFAULT_BUBBLE: BubblePos = { right: 24, bottom: 100 };

const MIN_W = 360, MIN_H = 360;
const MAX_W = 900, MAX_H = 900;

interface LanChatWidgetProps {
  /** External control of widget state (so a toolbar button can toggle). */
  state: WidgetState;
  onStateChange: (s: WidgetState) => void;
}

/**
 * Canvas-overlay version of LAN chat. Three states:
 *   hidden → completely off-screen (toolbar button still toggles state)
 *   bubble → 48px circle bottom-right with unread badge
 *   open   → draggable + resizable floating window (portal to body)
 */
export function LanChatWidget({ state, onStateChange }: LanChatWidgetProps) {
  const chat = useLanChat();
  const { session, join, messages, fingerprint } = chat;

  const [layout, setLayout] = usePersistentState<FloatLayout>(
    "ui:lan-chat:layout:v1",
    DEFAULT_LAYOUT,
    {
      validate: (v) => {
        if (!v || typeof v !== "object") return null;
        const o = v as Partial<FloatLayout>;
        if (!o.pos || !o.size) return null;
        if (typeof o.pos.x !== "number" || typeof o.pos.y !== "number") return null;
        if (typeof o.size.w !== "number" || typeof o.size.h !== "number") return null;
        if (o.size.w < MIN_W || o.size.h < MIN_H) return null;
        return { pos: { x: o.pos.x, y: o.pos.y }, size: { w: o.size.w, h: o.size.h } };
      },
    },
  );
  const [bubblePos, setBubblePos] = usePersistentState<BubblePos>(
    "ui:lan-chat:bubble-pos:v1",
    DEFAULT_BUBBLE,
    {
      validate: (v) => {
        if (!v || typeof v !== "object") return null;
        const o = v as Partial<BubblePos>;
        if (typeof o.right !== "number" || typeof o.bottom !== "number") return null;
        return { right: o.right, bottom: o.bottom };
      },
    },
  );

  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const { unread } = useLanChatNotifications({
    latestMessage,
    ownNickname: session?.nickname ?? null,
    isOpen: state === "open",
  });

  // Drag/resize refs — pattern cloned from AIChatNode floating mode.
  const dragRef = useRef<{ kind: "move" | "resize" | "bubble"; sx: number; sy: number; init: { x: number; y: number; w: number; h: number; r: number; b: number } } | null>(null);

  const startMove = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = {
      kind: "move",
      sx: e.clientX, sy: e.clientY,
      init: { x: layout.pos.x, y: layout.pos.y, w: layout.size.w, h: layout.size.h, r: 0, b: 0 },
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const nx = Math.max(0, Math.min(window.innerWidth - d.init.w, d.init.x + (ev.clientX - d.sx)));
      const ny = Math.max(0, Math.min(window.innerHeight - 40, d.init.y + (ev.clientY - d.sy)));
      setLayout((cur) => ({ ...cur, pos: { x: nx, y: ny } }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind: "resize",
      sx: e.clientX, sy: e.clientY,
      init: { x: layout.pos.x, y: layout.pos.y, w: layout.size.w, h: layout.size.h, r: 0, b: 0 },
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const nw = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - d.init.x - 8, d.init.w + (ev.clientX - d.sx)));
      const nh = Math.max(MIN_H, Math.min(MAX_H, window.innerHeight - d.init.y - 8, d.init.h + (ev.clientY - d.sy)));
      setLayout((cur) => ({ ...cur, size: { w: nw, h: nh } }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startBubbleDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind: "bubble",
      sx: e.clientX, sy: e.clientY,
      init: { x: 0, y: 0, w: 0, h: 0, r: bubblePos.right, b: bubblePos.bottom },
    };
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 4) moved = true;
      setBubblePos({
        right: Math.max(8, Math.min(window.innerWidth - 56, d.init.r - (ev.clientX - d.sx))),
        bottom: Math.max(8, Math.min(window.innerHeight - 56, d.init.b - (ev.clientY - d.sy))),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // If the user didn't actually drag (just a click), open the panel.
      if (!moved) onStateChange("open");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Force-close on Esc when open.
  useEffect(() => {
    if (state !== "open") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onStateChange("bubble"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onStateChange]);

  if (state === "hidden") return null;

  // Bubble
  if (state === "bubble") {
    return createPortal(
      <button
        onMouseDown={startBubbleDrag}
        title={session ? `LAN 聊天（${session.nickname}）` : "LAN 聊天 — 点击进入"}
        className="fixed z-[60] rounded-full flex items-center justify-center"
        style={{
          right: bubblePos.right,
          bottom: bubblePos.bottom,
          width: 48,
          height: 48,
          background: "oklch(0.68 0.22 285)",
          color: "white",
          border: "none",
          boxShadow: "0 6px 24px oklch(0.68 0.22 285 / 0.45), 0 2px 8px oklch(0 0 0 / 0.4)",
          cursor: "grab",
        }}
      >
        <MessageSquare style={{ width: 20, height: 20 }} />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 rounded-full flex items-center justify-center"
            style={{
              minWidth: 18,
              height: 18,
              padding: "0 4px",
              background: "oklch(0.62 0.22 25)",
              color: "white",
              fontSize: 10,
              fontWeight: 700,
              border: "2px solid var(--c-base)",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>,
      document.body,
    );
  }

  // Open panel — portal to body so it floats above everything.
  return createPortal(
    <div
      className="fixed z-[60] flex flex-col"
      style={{
        left: layout.pos.x,
        top: layout.pos.y,
        width: layout.size.w,
        height: layout.size.h,
        background: "var(--c-base)",
        border: "1px solid var(--c-bd2)",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 16px 48px oklch(0 0 0 / 0.5), 0 4px 12px oklch(0 0 0 / 0.3)",
      }}
    >
      {/* Header — drag */}
      <div
        onMouseDown={startMove}
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--c-bd1)", cursor: "move", userSelect: "none" }}
      >
        <MessageSquare style={{ width: 13, height: 13, color: "oklch(0.78 0.20 285)" }} />
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-xs font-semibold" style={{ color: "var(--c-t1)" }}>
            局域网聊天
          </span>
          <span className="text-[9px] truncate" style={{ color: "oklch(0.70 0.20 50)" }}>
            ⚠ 非加密通讯，严禁传输版权素材
          </span>
        </div>
        {session && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
            background: session.color + "22",
            color: session.color,
            border: `1px solid ${session.color}44`,
          }}>
            {session.nickname}
          </span>
        )}
        <button
          onClick={() => {
            // "popup" features ask the browser to open a chromeless window
            // (no address bar, no tab strip). Width/height/top/left give it
            // small-tool-window dimensions. Naming the window ("lan-chat-pop")
            // means subsequent clicks reuse the same window instead of
            // spawning duplicates. Browser security forbids hiding the OS
            // close button — that's the one piece of "cannot be closed"
            // that's literally impossible from a web page.
            window.open(
              "/lan-chat",
              "lan-chat-pop",
              "popup,width=420,height=640,top=80,left=80,noopener,noreferrer",
            );
          }}
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ color: "var(--c-t3)" }}
          title="在独立小窗打开（同昵称同房间）"
        >
          <ExternalLink style={{ width: 12, height: 12 }} />
        </button>
        <button
          onClick={() => onStateChange("bubble")}
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ color: "var(--c-t3)" }}
          title="收起为气泡"
        >
          <Minus style={{ width: 12, height: 12 }} />
        </button>
        <button
          onClick={() => onStateChange("hidden")}
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ color: "var(--c-t3)" }}
          title="关闭"
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* Nickname picker overlay if no session */}
      {!session && (
        <div className="flex-1 relative">
          <NicknamePicker fingerprint={fingerprint} onSubmit={async (n) => { await join(n); }} />
        </div>
      )}
      {session && (
        <div className="flex-1 min-h-0">
          <LanChatPanel visible={state === "open"} compact />
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute"
        style={{
          right: 0, bottom: 0,
          width: 16, height: 16,
          cursor: "nwse-resize",
          display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
          padding: 2,
        }}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.5 }}>
          <circle cx="1.5" cy="7.5" r="1" fill="var(--c-t3)" />
          <circle cx="4.5" cy="4.5" r="1" fill="var(--c-t3)" />
          <circle cx="7.5" cy="1.5" r="1" fill="var(--c-t3)" />
        </svg>
      </div>
    </div>,
    document.body,
  );
}
