import { useState, useRef, useEffect } from "react";
import { Proportions, Lock, Unlock, ChevronDown } from "lucide-react";
import { EC } from "./theme";
import { useEditorStore } from "./editorStore";

// Aspect presets (ratio) — applied at the current long-edge resolution.
const RATIOS: { label: string; w: number; h: number; hint: string }[] = [
  { label: "16:9", w: 16, h: 9, hint: "横屏 / YouTube" },
  { label: "9:16", w: 9, h: 16, hint: "竖屏 / 抖音·快手" },
  { label: "1:1", w: 1, h: 1, hint: "方形 / 朋友圈" },
  { label: "4:5", w: 4, h: 5, hint: "竖图 / Instagram" },
  { label: "4:3", w: 4, h: 3, hint: "传统" },
  { label: "21:9", w: 21, h: 9, hint: "电影宽屏" },
];
const TIERS = [480, 720, 1080, 1440, 2160]; // long-edge px
const FPSES = [24, 25, 30, 50, 60];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
// Tiers (720p / 1080p …) are defined by the VERTICAL edge = height — the "p" number
// is the count of vertical scan lines, i.e. the height. 720p = 1280×720 (16:9),
// 1080p = 1920×1080. Width is derived from the aspect ratio.
function dims(rw: number, rh: number, vEdge: number) {
  return { w: even(vEdge * rw / rh), h: even(vEdge) };
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }
function ratioLabel(w: number, h: number) { const g = gcd(w, h) || 1; return `${w / g}:${h / g}`; }

export function CanvasSettings() {
  const doc = useEditorStore((s) => s.doc);
  const setCanvas = useEditorStore((s) => s.setCanvas);
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!doc) return null;
  const vEdge = doc.height;
  const curTier = TIERS.reduce((a, b) => (Math.abs(b - vEdge) < Math.abs(a - vEdge) ? b : a), TIERS[0]);
  const curRatio = ratioLabel(doc.width, doc.height);

  const applyRatio = (rw: number, rh: number) => { const d = dims(rw, rh, vEdge); setCanvas(d.w, d.h, doc.fps); };
  const applyTier = (tier: number) => { const g = gcd(doc.width, doc.height) || 1; const d = dims(doc.width / g, doc.height / g, tier); setCanvas(d.w, d.h, doc.fps); };

  // custom edits (respect aspect lock)
  const setW = (w: number) => setCanvas(w, locked ? Math.round(w * doc.height / doc.width) : doc.height, doc.fps);
  const setH = (h: number) => setCanvas(locked ? Math.round(h * doc.width / doc.height) : doc.width, h, doc.fps);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} title="画布比例 / 分辨率 / 帧率"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, fontSize: 12, cursor: "pointer" }}>
        <Proportions size={14} style={{ color: EC.accent }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{curRatio} · {doc.width}×{doc.height} · {doc.fps}fps</span>
        <ChevronDown size={13} style={{ color: EC.t3 }} />
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, width: 290, padding: 12, borderRadius: 12, background: EC.surface, border: `1px solid ${EC.border}`, boxShadow: "0 12px 40px oklch(0 0 0 / 0.5)" }}>
          <Label>比例</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
            {RATIOS.map((r) => {
              const active = curRatio === ratioLabel(r.w, r.h);
              const boxW = r.w >= r.h ? 26 : 26 * r.w / r.h, boxH = r.w >= r.h ? 26 * r.h / r.w : 26;
              return (
                <button key={r.label} onClick={() => applyRatio(r.w, r.h)} title={r.hint}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 0", borderRadius: 8, cursor: "pointer", border: `1px solid ${active ? EC.accent : EC.border}`, background: active ? EC.accentSoft : "transparent", color: active ? EC.accent : EC.t2 }}>
                  <span style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ width: boxW, height: boxH, border: `1.5px solid currentColor`, borderRadius: 2 }} />
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{r.label}</span>
                </button>
              );
            })}
          </div>

          <Label>分辨率（纵边 / 高）</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {TIERS.map((t) => (
              <button key={t} onClick={() => applyTier(t)}
                style={{ flex: 1, padding: "6px 0", fontSize: 11, borderRadius: 7, cursor: "pointer", border: `1px solid ${curTier === t ? EC.accent : EC.border}`, background: curTier === t ? EC.accentSoft : "transparent", color: curTier === t ? EC.accent : EC.t2 }}>{t === 2160 ? "4K" : t + "p"}</button>
            ))}
          </div>

          <Label>自定义尺寸</Label>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
            <input type="number" value={doc.width} onChange={(e) => setW(Number(e.target.value) || doc.width)} style={numIn} />
            <span style={{ color: EC.t3 }}>×</span>
            <input type="number" value={doc.height} onChange={(e) => setH(Number(e.target.value) || doc.height)} style={numIn} />
            <button onClick={() => setLocked((v) => !v)} title={locked ? "已锁定宽高比" : "未锁定"}
              style={{ width: 30, height: 30, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 7, cursor: "pointer", border: `1px solid ${locked ? EC.accent : EC.border}`, background: locked ? EC.accentSoft : "transparent", color: locked ? EC.accent : EC.t3 }}>
              {locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
          </div>

          <Label>帧率</Label>
          <div style={{ display: "flex", gap: 6 }}>
            {FPSES.map((f) => (
              <button key={f} onClick={() => setCanvas(doc.width, doc.height, f)}
                style={{ flex: 1, padding: "6px 0", fontSize: 11, borderRadius: 7, cursor: "pointer", border: `1px solid ${doc.fps === f ? EC.accent : EC.border}`, background: doc.fps === f ? EC.accentSoft : "transparent", color: doc.fps === f ? EC.accent : EC.t2 }}>{f}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: EC.t3, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{children}</div>;
}
const numIn: React.CSSProperties = { width: "100%", minWidth: 0, padding: "6px 8px", fontSize: 12, borderRadius: 7, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none" };
