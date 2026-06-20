import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Search, Check } from "lucide-react";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS, type ModelPickerOption } from "../ModelPicker";
import { PROVIDER_PICKER_OPTIONS, videoProviderChangePatch } from "../nodes/VideoTaskNode";
import type { NodeType, VideoProvider } from "../../../../../shared/types";

// Node types whose model is switchable via the ⌘K palette + the payload field they write.
export const MODEL_SWITCH_FIELD: Partial<Record<NodeType, string>> = {
  image_gen: "model", storyboard: "imageModel", video_task: "provider",
};

// ⌘K studio command palette: quickly switch the selected generative node's model with
// type-to-filter + ↑/↓/Enter. Writes the same payload field the command bar's ModelPicker
// does (image_gen/storyboard → model/imageModel; video_task → provider via reset patch).
export function ModelQuickSwitch({ nodeId, nodeType, onClose }: { nodeId: string; nodeType: NodeType; onClose: () => void }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const field = MODEL_SWITCH_FIELD[nodeType]!;
  const current = useCanvasStore((s) => {
    const p = s.nodes.find((n) => n.id === nodeId)?.data.payload as Record<string, unknown> | undefined;
    return typeof p?.[field] === "string" ? (p[field] as string) : "";
  });
  const options: ModelPickerOption[] = nodeType === "video_task" ? PROVIDER_PICKER_OPTIONS : IMAGE_MODEL_PICKER_OPTIONS;

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q) || (o.family ?? "").toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => { setActive(0); }, [query]);

  const pick = (v: string) => {
    updateNodeData(nodeId, nodeType === "video_task" ? videoProviderChangePatch(v as VideoProvider) : { [field]: v });
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) pick(o.value); }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100070, background: "oklch(0 0 0 / 0.5)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "16vh" }}>
      <div onClick={(e) => e.stopPropagation()} onKeyDown={onKey}
        style={{ width: "min(520px, 92vw)", maxHeight: "62vh", display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden",
          background: "var(--c-base)", border: "1px solid var(--c-bd2)", boxShadow: "0 24px 70px oklch(0 0 0 / 0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "1px solid var(--c-bd2)" }}>
          <Search size={15} style={{ color: "var(--c-t3)", flexShrink: 0 }} />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="切换模型 — 输入筛选，↑↓ 选择，Enter 确认…"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--c-t1)", fontSize: 13.5 }} />
          <kbd style={{ fontSize: 10, color: "var(--c-t4)", border: "1px solid var(--c-bd2)", borderRadius: 5, padding: "1px 5px" }}>Esc</kbd>
        </div>
        <div style={{ overflowY: "auto", padding: 6 }}>
          {filtered.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--c-t4)", fontSize: 12.5 }}>无匹配模型</div>}
          {filtered.map((o, i) => {
            const sel = o.value === current;
            const hi = i === active;
            return (
              <button key={o.value} onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}
                className="nodrag" style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 9,
                  border: "none", cursor: "pointer", background: hi ? "var(--c-elevated)" : "transparent" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: sel ? 700 : 500, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                    {o.family && <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: "var(--c-bd1)", color: "var(--c-t4)", flexShrink: 0 }}>{o.family}</span>}
                  </div>
                  {o.caps && o.caps.length > 0 && <div style={{ fontSize: 9, color: "var(--c-t4)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.caps.join(" · ")}</div>}
                </div>
                {o.costLabel && <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--c-t3)", flexShrink: 0 }}>{o.costLabel}</span>}
                {sel && <Check size={13} style={{ color: "var(--ui-accent, var(--c-accent))", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
