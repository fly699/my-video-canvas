import { useCallback, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { User, Mountain } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";

export interface MentionItem { name: string; kind: "person" | "scene" }

/** 当前画布上所有「角色 / 场景」节点的名字（去重）。用快照读取，不订阅 store，避免每个输入框
 *  都随节点变化而重渲染。仅在用户输入「@」触发下拉时调用。 */
function listCanvasCharacters(): MentionItem[] {
  const nodes = useCanvasStore.getState().nodes;
  const out: MentionItem[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.data.nodeType !== "character") continue;
    const p = n.data.payload as { characterKind?: string; name?: string; sceneName?: string };
    const kind: MentionItem["kind"] = (p.characterKind ?? "person") === "scene" ? "scene" : "person";
    const name = (kind === "scene" ? p.sceneName : p.name)?.trim();
    if (name && !seen.has(name)) { seen.add(name); out.push({ name, kind }); }
  }
  return out;
}

interface MentionState { open: boolean; query: string; start: number; items: MentionItem[]; active: number; rect: DOMRect | null }
const CLOSED: MentionState = { open: false, query: "", start: -1, items: [], active: 0, rect: null };

/**
 * 在文本框里输入「@」自动弹出角色/场景列表，方向键/回车选择后把名字插入文本。
 * 适配 textarea 与 input；与 NodeTextInput 的 IME 安全逻辑配合（select 通过 commit 写回）。
 */
export function useMention(
  enabled: boolean,
  elRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  commit: (next: string) => void,
) {
  const [st, setSt] = useState<MentionState>(CLOSED);
  const stRef = useRef(st); stRef.current = st;

  const close = useCallback(() => setSt((s) => (s.open ? CLOSED : s)), []);

  // 探测光标前的「@查询」：从光标往回到最近的 @（中间不含空白/@），用它过滤候选。
  const probe = useCallback(() => {
    const el = elRef.current;
    if (!enabled || !el) { close(); return; }
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) { close(); return; }
    const query = m[1];
    const all = listCanvasCharacters();
    const items = (query
      ? all.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
      : all
    ).slice(0, 8);
    if (items.length === 0) { close(); return; }
    setSt({ open: true, query, start: caret - m[0].length, items, active: 0, rect: el.getBoundingClientRect() });
  }, [enabled, elRef, close]);

  const select = useCallback((item: MentionItem) => {
    const el = elRef.current; const s = stRef.current;
    if (!el || s.start < 0) { close(); return; }
    const caret = el.selectionStart ?? el.value.length;
    // 保留「@」前缀，插入成 @角色名（s.start 指向「@」位置，覆盖原「@查询」）
    const insert = "@" + item.name + " ";
    const next = el.value.slice(0, s.start) + insert + el.value.slice(caret);
    commit(next);
    close();
    requestAnimationFrame(() => {
      el.focus();
      const pos = s.start + insert.length;
      try { el.setSelectionRange(pos, pos); } catch { /* input type may not support */ }
    });
  }, [elRef, commit, close]);

  // 下拉打开时拦截上下/回车/Tab/Esc 做导航与选择。
  const onKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    const s = stRef.current;
    if (!s.open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setSt((x) => ({ ...x, active: (x.active + 1) % x.items.length })); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSt((x) => ({ ...x, active: (x.active - 1 + x.items.length) % x.items.length })); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); select(s.items[s.active]); return true; }
    if (e.key === "Escape") { e.preventDefault(); close(); return true; }
    return false;
  }, [select, close]);

  const dropdown = st.open && st.rect ? createPortal(
    <div
      className="nodrag nowheel"
      onMouseDown={(e) => e.preventDefault()} // 防止输入框失焦
      style={{
        position: "fixed", left: st.rect.left, top: st.rect.bottom + 4, zIndex: 100002,
        minWidth: Math.max(180, st.rect.width), maxWidth: 320, maxHeight: 240, overflowY: "auto",
        background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 10,
        boxShadow: "0 12px 36px oklch(0 0 0 / 0.45)", padding: 4,
      }}
    >
      <div style={{ fontSize: 9.5, color: "var(--c-t4)", padding: "3px 8px 4px" }}>选择角色 / 场景插入</div>
      {st.items.map((it, i) => (
        <button
          key={it.kind + it.name}
          onClick={() => select(it)}
          onMouseEnter={() => setSt((x) => ({ ...x, active: i }))}
          className="nodrag flex items-center gap-2 w-full text-left"
          style={{
            padding: "6px 8px", borderRadius: 7, cursor: "pointer", border: "none",
            background: i === st.active ? "oklch(0.66 0.18 30 / 0.14)" : "transparent",
            color: "var(--c-t1)", fontSize: 12,
          }}
        >
          {it.kind === "scene"
            ? <Mountain className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--c-t4)" }} />
            : <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.66 0.18 30)" }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
          <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--c-t4)" }}>{it.kind === "scene" ? "场景" : "人物"}</span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return { probe, onKeyDown, close, dropdown, open: st.open };
}
