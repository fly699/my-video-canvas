import { useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";
import { IMAGE_MODELS, platformBadge, modelGroupOrder } from "@/lib/models";
import { useDisabledModels } from "@/lib/useDisabledModels";

// Shared, classified model picker used by image / video / LLM nodes.
// Generalizes LLMModelPicker's createPortal + backdrop anchoring. Options are
// grouped by `group`; each row shows a family badge, capability tags and a cost
// badge. The current value always renders in the trigger even if `hidden` or
// absent from the list (so retired/legacy models don't blank out).
export interface ModelPickerOption {
  value: string;
  label: string;
  group: string;
  family?: string;
  costLabel?: string; // e.g. "≈5 cr" / "模型页" / "—"
  caps?: string[];
  tag?: string;
  color?: string;
  hidden?: boolean; // excluded from the list but valid as current value
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: ModelPickerOption[];
  disabled?: boolean;
  searchable?: boolean;
  accent?: string;
  /** trigger min width */
  minWidth?: number;
}

const ACCENT = "oklch(0.72 0.20 330)";

export function ModelPicker({ value, onChange, options, disabled, searchable = true, accent = ACCENT, minWidth = 180 }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);

  const current = options.find((o) => o.value === value);
  const disabledModels = useDisabledModels();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = options.filter((o) => {
      if (o.hidden) return false;
      // 管理员禁用的模型不出现在列表里；但当前已选中的值即便被禁用也保留，避免旧节点失选。
      if (disabledModels.has(o.value) && o.value !== value) return false;
      if (!q) return true;
      return (
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.family ?? "").toLowerCase().includes(q) ||
        o.group.toLowerCase().includes(q)
      );
    });
    const map = new Map<string, ModelPickerOption[]>();
    for (const o of visible) {
      const arr = map.get(o.group) ?? [];
      arr.push(o);
      map.set(o.group, arr);
    }
    // 分组排序：Kie 排在 Poyo 之前（统一优先级，见 modelGroupOrder）。
    return Array.from(map.entries()).sort((a, b) => modelGroupOrder(a[0]) - modelGroupOrder(b[0]));
  }, [options, query, disabledModels, value]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (disabled) return;
          if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
          setQuery("");
          setOpen((o) => !o);
        }}
        className="nodrag flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all w-full"
        style={{
          fontSize: 12,
          fontWeight: 600,
          background: disabled ? "var(--c-base)" : "var(--c-input)",
          border: `1px solid ${open ? `${accent}80` : "var(--c-bd2)"}`,
          color: disabled ? "var(--c-t4)" : "var(--c-t1)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.label ?? value ?? "选择模型"}
        </span>
        {current?.costLabel && (
          <span style={{ fontSize: 9, color: "var(--c-t3)", fontWeight: 600 }}>{current.costLabel}</span>
        )}
        <ChevronDown style={{ width: 12, height: 12, opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }} />
      </button>

      {open && btnRect && createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99980 }}
            onMouseDown={(e) => {
              if (btnRef.current?.contains(e.target as Node)) return;
              setOpen(false);
            }}
          />
          <div
            className="nodrag rounded-xl overflow-hidden"
            style={{
              position: "fixed",
              zIndex: 99981,
              top: btnRect.bottom + 6,
              left: btnRect.left,
              width: Math.max(btnRect.width, minWidth),
              maxHeight: 380,
              overflowY: "auto",
              background: "var(--c-base)",
              border: "1px solid var(--c-bd2)",
              boxShadow: "0 8px 32px oklch(0 0 0 / 0.6)",
            }}
          >
            {searchable && (
              <div style={{ position: "sticky", top: 0, background: "var(--c-base)", padding: 6, borderBottom: "1px solid var(--c-elevated)", zIndex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 7, padding: "4px 8px" }}>
                  <Search style={{ width: 12, height: 12, color: "var(--c-t4)" }} />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索模型 / 家族…"
                    className="nodrag"
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--c-t1)", fontSize: 11 }}
                  />
                </div>
              </div>
            )}

            {groups.length === 0 && (
              <div style={{ padding: "14px 12px", fontSize: 11, color: "var(--c-t4)", textAlign: "center" }}>无匹配模型</div>
            )}

            {groups.map(([group, items]) => (
              <div key={group}>
                {/* 来源平台分色标签（与脚本/对话节点一致），让「这是哪个平台的模型」一眼可辨 */}
                <div style={{ display: "flex", alignItems: "center", padding: "7px 10px 4px", background: "var(--c-surface)" }}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: platformBadge(group).bg,
                      color: platformBadge(group).fg,
                    }}
                  >
                    {group}
                  </span>
                </div>
                {items.map((o) => {
                  const selected = o.value === value;
                  return (
                    <button
                      key={o.value}
                      onMouseDown={(e) => { e.stopPropagation(); onChange(o.value); setOpen(false); }}
                      className="nodrag flex items-center gap-2 w-full px-3 py-2 transition-all"
                      style={{
                        background: selected ? `${accent}15` : "transparent",
                        border: "none",
                        borderTop: "1px solid var(--c-elevated)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11.5, color: selected ? "var(--c-t1)" : "var(--c-t2)", fontWeight: selected ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.label}
                          </span>
                          {o.family && (
                            <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: "var(--c-bd1)", color: "var(--c-t4)", flexShrink: 0 }}>
                              {o.family}
                            </span>
                          )}
                        </div>
                        {o.caps && o.caps.length > 0 && (
                          <div style={{ fontSize: 8.5, color: "var(--c-t4)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.caps.join(" · ")}
                          </div>
                        )}
                      </div>
                      {o.costLabel && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: 4,
                            background: selected ? `${accent}25` : "var(--c-bd1)",
                            color: selected ? accent : "var(--c-t2)",
                            flexShrink: 0,
                          }}
                        >
                          {o.costLabel}
                        </span>
                      )}
                      {selected && <Check style={{ width: 11, height: 11, color: accent, flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/** Format an image-model cost into a short badge label. */
export function imageCostLabel(meta: { cost?: number; costNote?: string }): string {
  if (typeof meta.cost === "number") return `≈${meta.cost} cr`;
  return meta.costNote ?? "—";
}

// Precomputed, stable picker options for the image models — IMAGE_MODELS is a
// module constant, so this projection never changes. Sharing one frozen array
// (instead of `IMAGE_MODELS.map(...)` inline in each node's render) keeps the
// reference stable so ModelPicker's `groups` useMemo isn't busted every render.
export const IMAGE_MODEL_PICKER_OPTIONS: ModelPickerOption[] = IMAGE_MODELS.map((m) => ({
  value: m.value,
  label: m.label,
  group: m.group,
  family: m.family,
  caps: m.caps,
  costLabel: imageCostLabel(m),
}));
