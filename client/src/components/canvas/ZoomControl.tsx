import { useEffect, useRef, useState } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";

/**
 * 底部工具条的缩放控件：把原来「− / 百分比 / +」三个按钮，合并成一个百分比药丸，
 * 点击后向上弹出 LibTV 风格的缩放菜单（可编辑输入框 + 放大/缩小/适合屏幕 + 快捷档位）。
 *
 * 三种界面模式（专业/创意/工作室）通用——本组件只读画布视口、调用 reactFlow 的缩放 API，
 * 不依赖任何皮肤态，样式全部走主题 CSS 变量，随皮肤自动适配。
 *
 * 键盘：⌘/Ctrl + 加号/减号/0 对应 放大/缩小/适合屏幕（仅在焦点不在输入框时生效，
 * preventDefault 掉浏览器自身的页面缩放，避免干扰画布）。
 */
const ZOOM_MIN = 0.05; // 与 ReactFlow minZoom 对齐
const ZOOM_MAX = 6;    // 与 ReactFlow maxZoom 对齐（600% 顶格；图一的 800% 超出本画布范围，取顶格）
// 快捷档位（图一为 50/100/800；本画布 maxZoom=6，故顶格用 600%）
const PRESETS: number[] = [0.5, 1, 6];

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, width: "100%",
  padding: "8px 12px", fontSize: 13, cursor: "pointer",
  background: "transparent", border: "none", textAlign: "left",
  color: "var(--c-t1)", whiteSpace: "nowrap",
};
const kbd: React.CSSProperties = {
  marginLeft: "auto", flexShrink: 0, fontSize: 11, lineHeight: 1.4,
  fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "var(--c-t4)",
};

export function ZoomControl() {
  const reactFlow = useReactFlow();
  const { zoom } = useViewport();
  const pct = Math.round(zoom * 100);

  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(String(pct));
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时用当前缩放初始化输入框并聚焦选中，方便直接改数字。
  useEffect(() => {
    if (open) {
      setInputVal(String(Math.round(reactFlow.getZoom() * 100)));
      const t = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
      return () => clearTimeout(t);
    }
  }, [open, reactFlow]);

  // 点击外部 / Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const zoomIn = () => reactFlow.zoomIn({ duration: 200 });
  const zoomOut = () => reactFlow.zoomOut({ duration: 200 });
  const fit = () => reactFlow.fitView({ padding: 0.15, duration: 400 });
  const zoomTo = (z: number) => reactFlow.zoomTo(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)), { duration: 300 });

  // ⌘/Ctrl + +/-/0 键盘缩放（焦点不在可编辑控件时才拦截，避免影响正常输入 / 浏览器缩放）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomIn(); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomOut(); }
      else if (e.key === "0") { e.preventDefault(); fit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactFlow]);

  const commitInput = () => {
    const n = parseInt(inputVal.replace(/[^\d]/g, ""), 10);
    if (!isNaN(n) && n > 0) zoomTo(n / 100);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-7 px-2 rounded-lg text-[11px] font-mono transition-all tabular-nums"
        style={{
          color: open ? "var(--c-t1)" : "var(--c-t3)",
          background: open ? "var(--c-bd1)" : "transparent",
          minWidth: 44, textAlign: "center",
        }}
        onMouseEnter={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; } }}
        onMouseLeave={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; } }}
        title="缩放"
      >
        {pct}%
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            width: 232,
            padding: 6,
            borderRadius: 14,
            background: "var(--c-base)",
            border: "1px solid var(--c-bd2)",
            boxShadow: "0 12px 40px oklch(0 0 0 / 0.55), 0 2px 8px oklch(0 0 0 / 0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {/* 可编辑百分比输入框 */}
          <div style={{ display: "flex", alignItems: "center", padding: "2px 4px 6px" }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%", background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", borderRadius: 9, padding: "0 12px" }}>
              <input
                ref={inputRef}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                onKeyDown={(e) => { if (e.key === "Enter") commitInput(); }}
                onBlur={commitInput}
                inputMode="numeric"
                style={{ flex: 1, minWidth: 0, height: 34, background: "transparent", border: "none", outline: "none", color: "var(--c-t1)", fontSize: 15, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
              />
              <span style={{ flexShrink: 0, color: "var(--c-t3)", fontSize: 14 }}>%</span>
            </div>
          </div>

          <MenuRow label="放大" kbd="⌘ +" onClick={() => { zoomIn(); }} />
          <MenuRow label="缩小" kbd="⌘ -" onClick={() => { zoomOut(); }} />
          <MenuRow label="适合屏幕" kbd="⌘ 0" onClick={() => { fit(); setOpen(false); }} />

          <div style={{ height: 1, background: "var(--c-bd1)", margin: "5px 8px" }} />

          {PRESETS.map((z) => (
            <MenuRow key={z} label={`缩放至${Math.round(z * 100)}%`} onClick={() => { zoomTo(z); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuRow({ label, kbd: kbdText, onClick }: { label: string; kbd?: string; onClick: () => void }) {
  return (
    <button
      // 关键修复「按钮无效」：菜单里的百分比输入框自动聚焦，点任意行会先触发它的 onBlur→commitInput→
      // setOpen(false)（在 mousedown 阶段），在按钮的 onClick(mouseup) 之前就卸载了菜单，导致 onClick
      // 永不触发。preventDefault 掉 mousedown 阻止输入框失焦，onClick 才能正常执行。
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ ...rowStyle, borderRadius: 9 }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {label}
      {kbdText && <span style={kbd}>{kbdText}</span>}
    </button>
  );
}
