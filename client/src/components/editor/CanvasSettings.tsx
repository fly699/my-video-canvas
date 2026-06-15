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
  const setNormalizeAudio = useEditorStore((s) => s.setNormalizeAudio);
  const setMasterFade = useEditorStore((s) => s.setMasterFade);
  const reframe = useEditorStore((s) => s.reframe);
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
          <Label>一键重构图（转比例并填满）</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            {([["竖屏 9:16", 9, 16], ["横屏 16:9", 16, 9], ["方形 1:1", 1, 1], ["4:5", 4, 5]] as const).map(([label, rw, rh]) => {
              const active = curRatio === ratioLabel(rw, rh);
              return (
                <button key={label} onClick={() => {
                    // preserve resolution: keep the current long edge as the new frame's longer side
                    const longEdge = Math.max(doc.width, doc.height);
                    const d = rw >= rh ? { w: even(longEdge), h: even(longEdge * rh / rw) } : { w: even(longEdge * rw / rh), h: even(longEdge) };
                    reframe(d.w, d.h, doc.fps);
                  }}
                  title="切换到该比例，并把所有主轨片段自动填满（cover）以消除黑边（一步撤销）"
                  style={{ flex: 1, padding: "7px 0", fontSize: 11, borderRadius: 7, cursor: "pointer", border: `1px solid ${active ? EC.accent : EC.border}`, background: active ? EC.accentSoft : "transparent", color: active ? EC.accent : EC.t2 }}>{label}</button>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: EC.t4, lineHeight: 1.5, marginBottom: 12 }}>一键转比例并让所有片段铺满新画框。需精确取景/跟随主体，可再用「位置/大小」的缩放+X/Y（关键帧可做推拉跟随）。</div>

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

          <Label>音频</Label>
          <button onClick={() => setNormalizeAudio(!doc.normalizeAudio)}
            title="导出时把最终音轨整体响度归一化到 -14 LUFS（YouTube/Spotify 等流媒体标准），不同片段/项目响度一致；仅在导出时生效"
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", fontSize: 12, borderRadius: 7, cursor: "pointer", border: `1px solid ${doc.normalizeAudio ? EC.accent : EC.border}`, background: doc.normalizeAudio ? EC.accentSoft : "transparent", color: doc.normalizeAudio ? EC.accent : EC.t2 }}>
            <span>响度归一化（-14 LUFS）</span>
            <span style={{ fontWeight: 800 }}>{doc.normalizeAudio ? "开" : "关"}</span>
          </button>

          <Label>整片首尾淡入淡出</Label>
          <div style={{ fontSize: 11, color: EC.t3, marginBottom: 6, lineHeight: 1.5 }}>整片开头从黑淡入、结尾淡到黑（画面+声音一起），作专业片头/片尾。</div>
          {(["in", "out"] as const).map((w) => {
            const v = (w === "in" ? doc.masterFadeIn : doc.masterFadeOut) ?? 0;
            return (
              <div key={w} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: EC.t2, width: 36, flexShrink: 0 }}>{w === "in" ? "淡入" : "淡出"}</span>
                <input type="range" min={0} max={5} step={0.1} value={v} onChange={(e) => setMasterFade(w, Number(e.target.value))} style={{ flex: 1, accentColor: EC.accent }} />
                <span style={{ fontSize: 11, color: EC.t2, width: 34, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{v.toFixed(1)}s</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: EC.t3, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{children}</div>;
}
const numIn: React.CSSProperties = { width: "100%", minWidth: 0, padding: "6px 8px", fontSize: 12, borderRadius: 7, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none" };
