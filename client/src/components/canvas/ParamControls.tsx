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
              <input
                type="number"
                className="nodrag"
                value={cur}
                min={def.min}
                max={def.max}
                step={def.step ?? 1}
                disabled={disabled}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) onChange(def.key, n);
                }}
                style={fieldStyle}
              />
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
