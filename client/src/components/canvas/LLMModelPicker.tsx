import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export const LLM_MODELS = [
  { id: "gemini-2.5-flash",          short: "Gemini",  label: "Gemini 2.5 Flash",  tag: "默认", color: "oklch(0.68 0.18 160)" },
  { id: "claude-haiku-4-5-20251001", short: "Haiku",   label: "Claude Haiku 4.5",  tag: "快速", color: "oklch(0.68 0.18 55)"  },
  { id: "claude-sonnet-4-6",         short: "Sonnet",  label: "Claude Sonnet 4.6", tag: "智能", color: "oklch(0.68 0.18 280)" },
  { id: "gpt-5.2",                   short: "GPT-5.2", label: "GPT-5.2",           tag: "Poyo", color: "oklch(0.62 0.16 240)" },
] as const;

export type LLMModelId = (typeof LLM_MODELS)[number]["id"];

interface Props {
  value: LLMModelId;
  onChange: (v: LLMModelId) => void;
  disabled?: boolean;
}

export function LLMModelPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LLM_MODELS.find((m) => m.id === value) ?? LLM_MODELS[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
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
        <span style={{ fontSize: 10 }}>🤖</span>
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

      {open && (
        <div
          className="nodrag absolute z-50 rounded-xl overflow-hidden"
          style={{
            bottom: "calc(100% + 6px)",
            left: 0,
            background: "var(--c-base)",
            border: "1px solid var(--c-bd2)",
            boxShadow: "0 8px 32px oklch(0 0 0 / 0.6)",
            minWidth: 196,
          }}
        >
          <div
            style={{
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
          {LLM_MODELS.map((m) => {
            const selected = m.id === value;
            return (
              <button
                key={m.id}
                onClick={() => { onChange(m.id); setOpen(false); }}
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
                <span style={{ fontSize: 11, color: selected ? "var(--c-t1)" : "var(--c-t3)", flex: 1, fontWeight: selected ? 600 : 400 }}>
                  {m.label}
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
      )}
    </div>
  );
}
