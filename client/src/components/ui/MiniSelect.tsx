import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

// 自绘下拉（替代原生 <select>）：聊天窗在画布里会被 CSS transform: scale() 缩放，缩放下原生
// <select> 弹层在 Chromium 会错位/点错项——故画成绝对定位菜单，随窗口正确缩放。
// 菜单 portal 到 body 并按可用空间自动上/下展开，避免被父容器 overflow:hidden 裁切
// （画布助手面板顶部的模板选择器就曾因此被标题栏裁掉）。
// 结构色走 var(--c-*)（各主题通用），高亮色由 accent/accentSoft 传入（聊天=琥珀 / 画布助手=紫）。
export interface MiniGroup { label?: string; options: { value: string; label: string; title?: string }[] }

const MENU_MAX_H = 300;

export function MiniSelect({
  value, placeholder, groups, onChange, maxWidth, title,
  accent = "oklch(0.72 0.20 310)", accentSoft = "oklch(0.72 0.20 310 / 0.14)",
}: {
  value: string; placeholder: string; groups: MiniGroup[]; onChange: (v: string) => void;
  maxWidth?: number; title?: string; accent?: string; accentSoft?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 弹层几何：以视口坐标（position: fixed）定位。placement=up 时用 bottom 锚定按钮上沿。
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number }>({ left: 0, width: 0, maxH: MENU_MAX_H });

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const compute = () => {
      const r = ref.current!.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const openUp = spaceBelow < Math.min(MENU_MAX_H, 160) && spaceAbove > spaceBelow;
      const maxH = Math.max(120, Math.min(MENU_MAX_H, openUp ? spaceAbove : spaceBelow));
      setBox(openUp
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, maxH }
        : { left: r.left, width: r.width, top: r.bottom + 4, maxH });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => { window.removeEventListener("resize", compute); window.removeEventListener("scroll", compute, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const cur = groups.flatMap((g) => g.options).find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" title={title} onClick={() => setOpen((o) => !o)}
        style={{ padding: "3px 8px", borderRadius: 7, fontSize: 12, border: "1px solid var(--c-bd2, rgba(128,128,128,0.18))", background: "var(--c-elevated, rgba(128,128,128,0.10))", color: "var(--c-t1)", outline: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, maxWidth }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur?.label ?? placeholder}</span>
        <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="nowheel" style={{ position: "fixed", left: box.left, top: box.top, bottom: box.bottom,
          minWidth: Math.max(170, box.width), maxHeight: box.maxH, overflowY: "auto",
          background: "var(--c-elevated, #1b1b1f)", border: "1px solid var(--c-bd3, rgba(128,128,128,0.32))", borderRadius: 9, boxShadow: "0 10px 30px rgba(0,0,0,0.45)", zIndex: 9999, padding: 4 }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <div style={{ fontSize: 10, color: "var(--c-t4)", padding: "5px 8px 2px", fontWeight: 600 }}>{g.label}</div>}
              {g.options.map((o) => (
                <button key={o.value} type="button" title={o.title} onClick={() => { onChange(o.value); setOpen(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 9px", borderRadius: 6, fontSize: 12, lineHeight: 1.4,
                    background: o.value === value ? accentSoft : "transparent", color: o.value === value ? accent : "var(--c-t1)", border: "none", cursor: "pointer" }}>
                  {o.label}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
