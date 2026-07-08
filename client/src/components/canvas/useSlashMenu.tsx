import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Hash, FolderOpen, CornerDownLeft } from "lucide-react";
import { favoriteSlots, promptsInCategory, subscribePromptLibrary, getPromptLibrary } from "../../lib/promptLibraryStore";
import { PROMPT_PRESETS, flatPresets } from "../../lib/promptLibraryPresets";

// 在文本框输入「/」唤出「快捷提示词」菜单：根层先列 10 个常用槽位（编号 1-10），
// 槽位可是「提示词」（直接插入）或「类别入口」（点击展开二级菜单进一步选择）；输入
// 「/关键词」则跨「库 + 预设」搜索。镜像 useMention 的探测/键盘/portal 结构，与「@」并存。

interface SlashItem { kind: "prompt" | "category"; label: string; text?: string; category?: string; badge?: string }

interface SlashState {
  open: boolean; query: string; start: number; rect: DOMRect | null;
  level: "root" | "sub"; subCategory: string;
  items: SlashItem[]; active: number;
}
const CLOSED: SlashState = { open: false, query: "", start: -1, rect: null, level: "root", subCategory: "", items: [], active: 0 };

/** 根层候选：有 query 时跨库+预设搜索（仅提示词）；无 query 时先列填充的槽位，再补预设类别入口。 */
function buildRootItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (q) {
    const out: SlashItem[] = [];
    for (const it of getPromptLibrary()) {
      if (it.slotKind === "category") continue;
      if (it.label.toLowerCase().includes(q) || it.text.toLowerCase().includes(q)) out.push({ kind: "prompt", label: it.label, text: it.text, badge: it.category });
    }
    for (const p of flatPresets()) {
      if (p.label.toLowerCase().includes(q) || p.text.toLowerCase().includes(q)) out.push({ kind: "prompt", label: p.label, text: p.text, badge: p.category });
    }
    return out.slice(0, 10);
  }
  // 无 query：10 个槽位（填充的）→ 编号；再补预设类别入口（方便没设槽位时也能用）。
  const out: SlashItem[] = [];
  favoriteSlots().forEach((slot, i) => {
    if (!slot) return;
    if (slot.slotKind === "category") out.push({ kind: "category", label: slot.label, category: slot.category || slot.label, badge: `${i + 1}` });
    else out.push({ kind: "prompt", label: slot.label, text: slot.text, badge: `${i + 1}` });
  });
  for (const c of PROMPT_PRESETS) {
    if (out.some((o) => o.kind === "category" && o.category === c.category)) continue;
    out.push({ kind: "category", label: c.category, category: c.category });
  }
  // 16：预设已扩到 11 个类别 + 最多 10 个槽位，12 会截断新增类别；下拉自带滚动。
  return out.slice(0, 16);
}

/** 二级菜单：某类别下的「库提示词 + 预设提示词」。 */
function buildSubItems(category: string): SlashItem[] {
  const lib = promptsInCategory(category).filter((it) => it.slotKind !== "category").map((it) => ({ kind: "prompt" as const, label: it.label, text: it.text }));
  const preset = flatPresets().filter((p) => p.category === category).map((p) => ({ kind: "prompt" as const, label: p.label, text: p.text }));
  return [...lib, ...preset];
}

export function useSlashMenu(
  enabled: boolean,
  elRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  commit: (next: string) => void,
) {
  const [st, setSt] = useState<SlashState>(CLOSED);
  const stRef = useRef(st); stRef.current = st;
  // 库变更时若菜单开着，刷新当前层候选。
  useEffect(() => subscribePromptLibrary(() => {
    const s = stRef.current;
    if (!s.open) return;
    setSt((x) => ({ ...x, items: x.level === "sub" ? buildSubItems(x.subCategory) : buildRootItems(x.query), active: 0 }));
  }), []);

  const close = useCallback(() => setSt((s) => (s.open ? CLOSED : s)), []);

  const probe = useCallback(() => {
    const el = elRef.current;
    if (!enabled || !el) { close(); return; }
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const m = before.match(/\/([^\s/]*)$/);
    if (!m) { close(); return; }
    const query = m[1];
    const items = buildRootItems(query);
    if (items.length === 0) { close(); return; }
    setSt({ open: true, query, start: caret - m[0].length, rect: el.getBoundingClientRect(), level: "root", subCategory: "", items, active: 0 });
  }, [enabled, elRef, close]);

  const insertText = useCallback((text: string) => {
    const el = elRef.current; const s = stRef.current;
    if (!el || s.start < 0) { close(); return; }
    const caret = el.selectionStart ?? el.value.length;
    const insert = text + " ";
    const next = el.value.slice(0, s.start) + insert + el.value.slice(caret);
    commit(next);
    close();
    requestAnimationFrame(() => {
      el.focus();
      const pos = s.start + insert.length;
      try { el.setSelectionRange(pos, pos); } catch { /* input type may not support */ }
    });
  }, [elRef, commit, close]);

  const select = useCallback((item: SlashItem) => {
    if (item.kind === "category") {
      const cat = item.category ?? item.label;
      const subs = buildSubItems(cat);
      setSt((x) => ({ ...x, level: "sub", subCategory: cat, items: subs, active: 0 }));
      // 聚焦保持
      requestAnimationFrame(() => elRef.current?.focus());
      return;
    }
    if (item.text != null) insertText(item.text);
  }, [insertText, elRef]);

  const onKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    const s = stRef.current;
    if (!s.open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setSt((x) => ({ ...x, active: (x.active + 1) % Math.max(1, x.items.length) })); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSt((x) => ({ ...x, active: (x.active - 1 + x.items.length) % Math.max(1, x.items.length) })); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); if (s.items[s.active]) select(s.items[s.active]); return true; }
    if (e.key === "Escape") {
      e.preventDefault();
      if (s.level === "sub") setSt((x) => ({ ...x, level: "root", subCategory: "", items: buildRootItems(x.query), active: 0 }));
      else close();
      return true;
    }
    return false;
  }, [select, close]);

  // 视口下方空间不足时向上翻，避免靠近屏幕底部的节点其技能下拉被裁切。
  const SLASH_MENU_MAX = 280;
  const flipUp = !!st.rect && typeof window !== "undefined" && st.rect.bottom + SLASH_MENU_MAX + 8 > window.innerHeight && st.rect.top > SLASH_MENU_MAX;
  const dropdown = st.open && st.rect ? createPortal(
    <div
      className="nodrag nowheel"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed", left: st.rect.left, zIndex: 100002,
        ...(flipUp ? { bottom: window.innerHeight - st.rect.top + 4 } : { top: st.rect.bottom + 4 }),
        minWidth: Math.max(200, st.rect.width), maxWidth: 360, maxHeight: SLASH_MENU_MAX, overflowY: "auto",
        background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 10,
        boxShadow: "0 12px 36px oklch(0 0 0 / 0.45)", padding: 4,
      }}
    >
      <div style={{ fontSize: 9.5, color: "var(--c-t4)", padding: "3px 8px 4px", display: "flex", alignItems: "center", gap: 4 }}>
        {st.level === "sub"
          ? (<><CornerDownLeft className="w-2.5 h-2.5" /> {st.subCategory}（Esc 返回）</>)
          : "快捷提示词 · 输入 / 搜索，数字为常用槽位"}
      </div>
      {st.items.map((it, i) => (
        <button
          key={it.kind + it.label + i}
          onClick={() => select(it)}
          onMouseEnter={() => setSt((x) => ({ ...x, active: i }))}
          className="nodrag flex items-center gap-2 w-full text-left"
          style={{
            padding: "6px 8px", borderRadius: 7, cursor: "pointer", border: "none",
            background: i === st.active ? "oklch(0.66 0.18 30 / 0.14)" : "transparent",
            color: "var(--c-t1)", fontSize: 12,
          }}
        >
          {it.badge && /^\d+$/.test(it.badge)
            ? <span className="flex items-center justify-center flex-shrink-0" style={{ width: 16, height: 16, borderRadius: 4, background: "oklch(0.66 0.18 30 / 0.16)", color: "oklch(0.66 0.18 30)", fontSize: 9.5, fontWeight: 700 }}>{it.badge}</span>
            : it.kind === "category"
            ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.62 0.16 240)" }} />
            : <Hash className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--c-t4)" }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
          {it.kind === "category" && <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--c-t4)" }}>类别 ›</span>}
          {it.kind === "prompt" && it.badge && !/^\d+$/.test(it.badge) && <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>{it.badge}</span>}
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return { probe, onKeyDown, close, dropdown, open: st.open };
}
