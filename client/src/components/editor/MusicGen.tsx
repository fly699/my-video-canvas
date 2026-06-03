import { useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Music, X, Loader2, Sparkles } from "lucide-react";
import { EC } from "./theme";
import { useEditorStore } from "./editorStore";
import { probeMediaDuration } from "./theme";

const MUSIC_MODELS: [string, string][] = [
  ["suno-v4.5", "Suno V4.5"],
  ["suno-v5", "Suno V5"],
  ["suno-v5.5", "Suno V5.5"],
  ["minimax-music-2.6", "MiniMax 2.6"],
];
const STYLE_PRESETS = ["轻松愉快", "史诗激昂", "悬疑紧张", "温馨抒情", "电子节奏", "古风国韵", "赛博朋克", "温柔钢琴"];

/** AI 配乐: generate background music from a prompt and drop it on the audio track. */
export function MusicGen({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("suno-v4.5");
  const [instrumental, setInstrumental] = useState(true);
  const gen = trpc.audioGen.generateMusic.useMutation();

  const run = async () => {
    if (!prompt.trim()) { toast.error("请描述想要的配乐风格"); return; }
    const doc = useEditorStore.getState().doc;
    const audioTrack = doc?.tracks.find((t) => t.type === "audio");
    if (!audioTrack) { toast.error("没有音频轨道"); return; }
    toast.info("正在生成配乐，可能需要 1-2 分钟…");
    try {
      const r = await gen.mutateAsync({ model: model as Parameters<typeof gen.mutateAsync>[0]["model"], prompt: prompt.trim(), instrumental });
      const dur = r.duration || (await probeMediaDuration(r.url, "audio"));
      useEditorStore.getState().addClip(audioTrack.id, { kind: "audio", assetUrl: r.url, start: 0, trimIn: 0, trimOut: dur, volume: 0.8 });
      toast.success("配乐已生成并加入音频轨");
      onClose();
    } catch (e) { toast.error("生成失败：" + (e instanceof Error ? e.message : "")); }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 92vw)", padding: 18, borderRadius: 14, background: EC.surface, border: `1px solid ${EC.border}`, boxShadow: "0 16px 48px oklch(0 0 0 / 0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Music size={18} style={{ color: EC.accent }} />
          <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: EC.t1 }}>AI 配乐</span>
          <button onClick={onClose} style={{ width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 7, border: `1px solid ${EC.border}`, background: "transparent", color: EC.t3, cursor: "pointer" }}><X size={15} /></button>
        </div>

        <label style={lbl}>风格描述</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="例如：轻快的电子背景音乐，适合产品宣传片…"
          style={{ ...inp, resize: "vertical", marginBottom: 8 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
          {STYLE_PRESETS.map((s) => (
            <button key={s} onClick={() => setPrompt((p) => (p ? p + "，" + s : s))} style={{ padding: "3px 9px", fontSize: 11, borderRadius: 12, cursor: "pointer", border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2 }}>{s}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>模型</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              {MUSIC_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <button onClick={() => setInstrumental((v) => !v)} title="纯音乐（无人声）"
              style={{ height: 34, padding: "0 12px", fontSize: 12, borderRadius: 8, cursor: "pointer", border: `1px solid ${instrumental ? EC.accent : EC.border}`, background: instrumental ? EC.accentSoft : "transparent", color: instrumental ? EC.accent : EC.t2 }}>
              纯音乐
            </button>
          </div>
        </div>

        <button disabled={gen.isPending} onClick={run}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", background: EC.accent, color: "#fff", cursor: gen.isPending ? "default" : "pointer" }}>
          {gen.isPending ? <><Loader2 size={15} className="animate-spin" /> 生成中…</> : <><Sparkles size={15} /> 生成配乐并加入音频轨</>}
        </button>
      </div>
    </div>,
    document.body,
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: EC.t3, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 12, borderRadius: 8, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none" };
