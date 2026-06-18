import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Bot } from "lucide-react";
import { LLM_MODELS as ALL_LLM_MODELS, platformBadge, modelGroupOrder } from "@/lib/models";
import { useDisabledModels } from "@/lib/useDisabledModels";
import { useSelfHostedLlmModels } from "@/lib/useSelfHostedModels";

// Re-export for existing consumers (ScriptNode imports LLM_MODELS + LLMModelId
// from here). Single source lives in lib/models.ts.
export const LLM_MODELS = ALL_LLM_MODELS;
export type LLMModelId = (typeof ALL_LLM_MODELS)[number]["id"];

// Visible models in the dropdown (hide back-compat aliases). The current value
// is still resolved against the full list so an aliased pick renders fine.
const VISIBLE_MODELS = ALL_LLM_MODELS.filter((m) => !m.hidden);

interface Props {
  value: LLMModelId;
  onChange: (v: LLMModelId) => void;
  disabled?: boolean;
  /** 可选：进一步筛选可选模型（如只显示支持视觉的模型）。 */
  filter?: (m: (typeof ALL_LLM_MODELS)[number]) => boolean;
}

export function LLMModelPicker({ value, onChange, disabled, filter }: Props) {
  const disabledModels = useDisabledModels();
  const selfHosted = useSelfHostedLlmModels(); // 管理员后台配置的自建模型，动态并入
  // 自建模型置顶 + 内置模型；按 id 去重。过滤：管理员禁用的不显示（当前已选值除外）。
  const pool = selfHosted.length
    ? [...selfHosted.filter((s) => !VISIBLE_MODELS.some((m) => m.id === s.id)), ...VISIBLE_MODELS]
    : VISIBLE_MODELS;
  const visible = (filter ? pool.filter(filter) : pool)
    .filter((m) => !disabledModels.has(m.id) || m.id === value)
    .slice()
    .sort((a, b) => modelGroupOrder(a.provider) - modelGroupOrder(b.provider));
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);
  const current = [...selfHosted, ...ALL_LLM_MODELS].find((m) => m.id === value) ?? ALL_LLM_MODELS[0];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (disabled) return;
          if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
          setOpen((o) => !o);
        }}
        className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-all"
        style={{
          fontSize: 9,
          fontWeight: 600,
          background: disabled ? "var(--c-base)" : "var(--c-surface)",
          border: `1px solid ${open ? `${current.color}50` : "var(--c-bd2)"}`,
          color: disabled ? "var(--c-t4)" : current.color,
          cursor: disabled ? "not-allowed" : "pointer",
          letterSpacing: "0.03em",
        }}
      >
        <Bot style={{ width: 10, height: 10 }} />
        <span>{current.short}</span>
        <ChevronDown
          style={{
            width: 8,
            height: 8,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 150ms ease",
            opacity: 0.7,
          }}
        />
      </button>

      {open && btnRect && createPortal(
        <>
          {/* Backdrop to close on outside click — skip if mousedown target is the toggle button itself */}
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
              bottom: window.innerHeight - btnRect.top + 6,
              // 钳制左缘：窄触发器下拉更宽时不溢出视口右缘。
              left: Math.max(8, Math.min(btnRect.left, window.innerWidth - 244 - 8)),
              background: "var(--c-base)",
              border: "1px solid var(--c-bd2)",
              boxShadow: "0 8px 32px oklch(0 0 0 / 0.6)",
              minWidth: 244,
              maxHeight: "min(60vh, 420px)",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                background: "var(--c-base)",
                zIndex: 1,
                fontSize: 8,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--c-t4)",
                padding: "6px 10px 4px",
              }}
            >
              选择 AI 模型
            </div>
            {visible.map((m) => {
              const selected = m.id === value;
              return (
                <button
                  key={m.id}
                  onMouseDown={(e) => { e.stopPropagation(); onChange(m.id); setOpen(false); }}
                  className="nodrag flex items-center gap-2.5 w-full px-3 py-2 transition-all"
                  style={{
                    background: selected ? `${m.color}15` : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    borderTop: "1px solid var(--c-elevated)",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: m.color,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: selected ? "var(--c-t1)" : "var(--c-t3)", fontWeight: selected ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.label}
                    </div>
                    {m.costNote && (
                      <div style={{ fontSize: 8.5, color: "var(--c-t3)", marginTop: 1, fontWeight: 600 }}>{m.costNote} 点/百万tokens</div>
                    )}
                  </div>
                  {/* Upstream provider (Forge / Poyo / Kie) — 统一分色标签 */}
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: platformBadge(m.provider).bg,
                      color: platformBadge(m.provider).fg,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {m.provider}
                  </span>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: selected ? `${m.color}25` : "var(--c-bd1)",
                      color: selected ? m.color : "var(--c-t4)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {m.tag}
                  </span>
                  {selected && <Check style={{ width: 10, height: 10, color: m.color, flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </>
  );
}
