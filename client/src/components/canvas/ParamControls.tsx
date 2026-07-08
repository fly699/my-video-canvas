import { useState, useEffect, useRef } from "react";
import { type ParamDef, paramOptions } from "@/lib/paramDefs";

interface Props {
  defs: ParamDef[];
  /** Current node payload (read param values from here). */
  values: Record<string, unknown>;
  /** Persist a changed param. */
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 9px",
  fontSize: 12,
  background: "var(--c-input)",
  border: "1px solid var(--c-bd2)",
  borderRadius: 8,
  color: "var(--c-t1)",
  outline: "none",
};

// 带钳制的数字输入：编辑期间保留草稿字符串，失焦/回车才解析→按 step 归一→钳到
// [min,max] 再提交（裸 input 只判 isFinite，不钳制，max=8 手打 999 会照写入）。
// 声明了 min&max 的连续量额外渲染滑块。
function NumberField({ value, min, max, step, disabled, onCommit }: {
  value: number; min?: number; max?: number; step?: number; disabled?: boolean; onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);
  useEffect(() => { if (!focusedRef.current) setDraft(String(value)); }, [value]);
  const clamp = (n: number) => {
    let v = n;
    if (typeof step === "number" && step > 0 && typeof min === "number") v = min + Math.round((v - min) / step) * step;
    if (typeof min === "number") v = Math.max(min, v);
    if (typeof max === "number") v = Math.min(max, v);
    return Math.round(v * 1e6) / 1e6;
  };
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    const v = clamp(n);
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  const hasRange = typeof min === "number" && typeof max === "number";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {hasRange && (
        <input type="range" className="nodrag" min={min} max={max} step={step ?? 1} value={value} disabled={disabled}
          onChange={(e) => { const v = clamp(Number(e.target.value)); if (v !== value) onCommit(v); }}
          style={{ flex: 1, accentColor: "var(--ui-accent, oklch(0.68 0.2 285))", cursor: disabled ? "not-allowed" : "pointer" }} />
      )}
      <input
        type="number" className="nodrag" value={draft} min={min} max={max} step={step ?? 1} disabled={disabled}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { focusedRef.current = false; commit(draft); }}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(draft); (e.target as HTMLInputElement).blur(); } }}
        style={{ ...fieldStyle, width: hasRange ? 62 : "100%", flexShrink: 0 }}
      />
    </div>
  );
}

// Schema-driven param renderer shared by image (and later video) nodes.
export function ParamControls({ defs, values, onChange, disabled }: Props) {
  if (defs.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {defs.map((def) => {
        if (def.type === "select") {
          const opts = paramOptions(def);
          const cur = (values[def.key] as string | undefined) ?? def.default ?? opts[0]?.value ?? "";
          return (
            <div key={def.key}>
              <label style={labelStyle}>{def.label}</label>
              <select
                className="nodrag"
                value={cur}
                disabled={disabled}
                onChange={(e) => onChange(def.key, e.target.value)}
                style={fieldStyle}
              >
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          );
        }
        if (def.type === "number") {
          const cur = (values[def.key] as number | undefined) ?? def.default ?? def.min ?? 1;
          return (
            <div key={def.key}>
              <label style={labelStyle}>{def.label}</label>
              <NumberField value={cur} min={def.min} max={def.max} step={def.step ?? 1} disabled={disabled}
                onCommit={(n) => onChange(def.key, n)} />
            </div>
          );
        }
        // toggle
        const cur = (values[def.key] as boolean | undefined) ?? def.default ?? false;
        return (
          <label key={def.key} className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", alignSelf: "end", paddingBottom: 6 }}>
            <input
              type="checkbox"
              checked={cur}
              disabled={disabled}
              onChange={(e) => onChange(def.key, e.target.checked)}
            />
            <span style={{ fontSize: 12, color: "var(--c-t2)" }}>{def.label}</span>
          </label>
        );
      })}
    </div>
  );
}
