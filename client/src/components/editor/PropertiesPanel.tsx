import { Trash2 } from "lucide-react";
import { EC } from "./theme";
import { useEditorStore } from "./editorStore";
import type { Clip } from "@shared/editorTypes";

const FILTERS: [string, string][] = [["", "无"], ["cinematic", "电影感"], ["vintage", "复古"], ["warm", "暖色"], ["cool", "冷色"], ["bw", "黑白"]];
const TRANSITIONS: [string, string][] = [["none", "无"], ["fade", "淡入淡出"], ["dissolve", "叠化"], ["slide", "滑动"], ["wipe", "擦除"]];
const MOTIONS: [string, string][] = [["none", "无"], ["fade", "淡入"], ["roll", "滚动"], ["karaoke", "卡拉OK"], ["bounce", "弹跳"]];

export function PropertiesPanel() {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const doc = useEditorStore((s) => s.doc);
  const update = useEditorStore((s) => s.updateClip);
  const remove = useEditorStore((s) => s.removeClip);

  let clip: Clip | null = null;
  if (doc && selectedClipId) {
    for (const t of doc.tracks) { const c = t.clips.find((x) => x.id === selectedClipId); if (c) { clip = c; break; } }
  }

  if (!clip) {
    return <aside style={panel}><div style={{ padding: 14, fontSize: 12, color: EC.t4 }}>选中一个片段以编辑属性</div></aside>;
  }
  const c = clip;
  const isVisual = c.kind === "video" || c.kind === "image" || c.kind === "text";
  const isMedia = c.kind === "video" || c.kind === "audio";
  const eff = c.effects ?? {};
  const tf = c.transform ?? {};

  const setEff = (k: keyof NonNullable<Clip["effects"]>, v: number | string | undefined) => update(c.id, { effects: { ...eff, [k]: v } });
  const setTf = (k: keyof NonNullable<Clip["transform"]>, v: number) => update(c.id, { transform: { ...tf, [k]: v } });

  return (
    <aside style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${EC.border}` }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: EC.t1, flex: 1 }}>{labelKind(c.kind)} 属性</span>
        <button onClick={() => remove(c.id)} title="删除片段" style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 7, border: `1px solid ${EC.border}`, background: "transparent", color: "oklch(0.62 0.20 25)", cursor: "pointer" }}><Trash2 size={14} /></button>
      </div>

      <div style={{ overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
        {c.kind === "text" && (
          <Section title="文字">
            <textarea value={c.text?.content ?? ""} onChange={(e) => update(c.id, { text: { ...c.text, content: e.target.value } })}
              rows={2} style={{ ...input, resize: "vertical" }} placeholder="输入文字…" />
            <Row label="字号"><input type="number" value={c.text?.size ?? 48} onChange={(e) => update(c.id, { text: { ...c.text, content: c.text?.content ?? "", size: Number(e.target.value) } })} style={input} /></Row>
            <Row label="颜色"><input type="color" value={c.text?.color ?? "#ffffff"} onChange={(e) => update(c.id, { text: { ...c.text, content: c.text?.content ?? "", color: e.target.value } })} style={{ ...input, height: 30, padding: 2 }} /></Row>
            <Row label="动效"><Select value={c.text?.motionStyle ?? "none"} options={MOTIONS} onChange={(v) => update(c.id, { text: { ...c.text, content: c.text?.content ?? "", motionStyle: v as NonNullable<Clip["text"]>["motionStyle"] } })} /></Row>
          </Section>
        )}

        {isMedia && (
          <Section title="播放">
            <Slider label={`速度 ${(c.speed ?? 1).toFixed(2)}x`} min={0.25} max={4} step={0.05} value={c.speed ?? 1} onChange={(v) => update(c.id, { speed: v })} />
            <Slider label={`音量 ${Math.round((c.volume ?? 1) * 100)}%`} min={0} max={2} step={0.05} value={c.volume ?? 1} onChange={(v) => update(c.id, { volume: v })} />
            <Slider label={`淡入 ${(c.fadeIn ?? 0).toFixed(1)}s`} min={0} max={5} step={0.1} value={c.fadeIn ?? 0} onChange={(v) => update(c.id, { fadeIn: v })} />
            <Slider label={`淡出 ${(c.fadeOut ?? 0).toFixed(1)}s`} min={0} max={5} step={0.1} value={c.fadeOut ?? 0} onChange={(v) => update(c.id, { fadeOut: v })} />
          </Section>
        )}

        {isVisual && c.kind !== "text" && (
          <Section title="调色 / 滤镜">
            <Slider label={`亮度 ${(eff.brightness ?? 0).toFixed(2)}`} min={-1} max={1} step={0.02} value={eff.brightness ?? 0} onChange={(v) => setEff("brightness", v)} />
            <Slider label={`对比度 ${(eff.contrast ?? 1).toFixed(2)}`} min={0} max={2} step={0.02} value={eff.contrast ?? 1} onChange={(v) => setEff("contrast", v)} />
            <Slider label={`饱和度 ${(eff.saturation ?? 1).toFixed(2)}`} min={0} max={3} step={0.02} value={eff.saturation ?? 1} onChange={(v) => setEff("saturation", v)} />
            <Row label="滤镜"><Select value={eff.filter ?? ""} options={FILTERS} onChange={(v) => setEff("filter", v || undefined)} /></Row>
          </Section>
        )}

        {isVisual && (
          <Section title="位置 / 大小">
            <Slider label={`X ${Math.round((tf.x ?? 0) * 100)}%`} min={0} max={1} step={0.01} value={tf.x ?? 0} onChange={(v) => setTf("x", v)} />
            <Slider label={`Y ${Math.round((tf.y ?? 0) * 100)}%`} min={0} max={1} step={0.01} value={tf.y ?? 0} onChange={(v) => setTf("y", v)} />
            <Slider label={`缩放 ${Math.round((tf.scale ?? 1) * 100)}%`} min={0.05} max={1.5} step={0.01} value={tf.scale ?? 1} onChange={(v) => setTf("scale", v)} />
            <Slider label={`不透明度 ${Math.round((tf.opacity ?? 1) * 100)}%`} min={0} max={1} step={0.01} value={tf.opacity ?? 1} onChange={(v) => setTf("opacity", v)} />
            <Slider label={`旋转 ${tf.rotation ?? 0}°`} min={-180} max={180} step={1} value={tf.rotation ?? 0} onChange={(v) => setTf("rotation", v)} />
          </Section>
        )}

        <Section title="入场转场">
          <Row label="类型"><Select value={c.transitionIn?.type ?? "none"} options={TRANSITIONS} onChange={(v) => update(c.id, { transitionIn: { type: v as never, duration: c.transitionIn?.duration ?? 0.5 } })} /></Row>
          {c.transitionIn && c.transitionIn.type !== "none" && (
            <Slider label={`时长 ${c.transitionIn.duration.toFixed(1)}s`} min={0.1} max={2} step={0.1} value={c.transitionIn.duration} onChange={(v) => update(c.id, { transitionIn: { type: c.transitionIn!.type, duration: v } })} />
          )}
        </Section>
      </div>
    </aside>
  );
}

function labelKind(k: string) { return k === "video" ? "视频" : k === "audio" ? "音频" : k === "image" ? "图片" : "文字"; }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: EC.t3, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 11, color: EC.t3, width: 52, flexShrink: 0 }}>{label}</span><div style={{ flex: 1 }}>{children}</div></div>;
}
function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: EC.t2, marginBottom: 3 }}>{label}</div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: EC.accent }} />
    </div>
  );
}
function Select({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, cursor: "pointer" }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const panel: React.CSSProperties = { width: 250, flexShrink: 0, borderLeft: `1px solid ${EC.border}`, display: "flex", flexDirection: "column", minHeight: 0, background: EC.surface };
const input: React.CSSProperties = { width: "100%", padding: "5px 7px", fontSize: 12, borderRadius: 6, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none" };
