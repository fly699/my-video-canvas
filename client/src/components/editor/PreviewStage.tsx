import { useEffect, useRef } from "react";
import { Play, Pause, SkipBack } from "lucide-react";
import { EC, fmtTime } from "./theme";
import { useEditorStore, clipDuration } from "./editorStore";
import type { Clip, EditorDoc } from "@shared/editorTypes";

/** CSS approximation of the ffmpeg color effects (preview only; export is exact). */
function cssFilter(c: Clip): string {
  const e = c.effects;
  const parts: string[] = [];
  if (e) {
    if (e.brightness != null) parts.push(`brightness(${(1 + e.brightness).toFixed(3)})`);
    if (e.contrast != null) parts.push(`contrast(${e.contrast})`);
    if (e.saturation != null) parts.push(`saturate(${e.saturation})`);
    switch (e.filter) {
      case "vintage": parts.push("sepia(0.5)"); break;
      case "cool": parts.push("hue-rotate(-15deg) saturate(1.1)"); break;
      case "warm": parts.push("sepia(0.25) saturate(1.2)"); break;
      case "bw": case "mono": parts.push("grayscale(1)"); break;
      case "cinematic": parts.push("contrast(1.1) saturate(1.15)"); break;
    }
  }
  return parts.join(" ");
}

/** Active clips at a given time, per track (top track last = on top). */
function activeAt(doc: EditorDoc, t: number): { clip: Clip; trackType: string }[] {
  const out: { clip: Clip; trackType: string }[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const c of track.clips) {
      if (t >= c.start && t < c.start + clipDuration(c)) out.push({ clip: c, trackType: track.type });
    }
  }
  return out;
}

export function PreviewStage() {
  const doc = useEditorStore((s) => s.doc);
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);
  const duration = useEditorStore((s) => s.duration());
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);

  const mediaRefs = useRef<Map<string, HTMLVideoElement | HTMLAudioElement>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  // Playback loop: advance the playhead by wall-clock time while playing.
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; return; }
    lastTsRef.current = performance.now();
    const tick = (ts: number) => {
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      const cur = useEditorStore.getState().playhead;
      const next = cur + dt;
      if (next >= duration) { setPlayhead(duration); setPlaying(false); return; }
      setPlayhead(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, duration, setPlayhead, setPlaying]);

  // Sync media element time/playstate to the playhead each render.
  useEffect(() => {
    if (!doc) return;
    const active = new Set<string>();
    for (const { clip } of activeAt(doc, playhead)) {
      if (clip.kind !== "video" && clip.kind !== "audio") continue;
      active.add(clip.id);
      const el = mediaRefs.current.get(clip.id);
      if (!el) continue;
      const localSrc = clip.trimIn + (playhead - clip.start) * (clip.speed ?? 1);
      if (Math.abs(el.currentTime - localSrc) > 0.25) el.currentTime = localSrc;
      el.playbackRate = clip.speed ?? 1;
      el.volume = Math.min(1, clip.volume ?? 1);
      if (playing && el.paused) el.play().catch(() => {});
      if (!playing && !el.paused) el.pause();
    }
    // Pause anything no longer active.
    mediaRefs.current.forEach((el, id) => { if (!active.has(id) && !el.paused) el.pause(); });
  }, [doc, playhead, playing]);

  if (!doc) return null;
  const visible = activeAt(doc, playhead);
  const aspect = doc.width / doc.height;

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--c-bg, #0c0c10)" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, minHeight: 0 }}>
        <div onContextMenu={(e) => e.preventDefault()} style={{ position: "relative", aspectRatio: `${aspect}`, maxWidth: "100%", maxHeight: "100%", width: aspect >= 1 ? "100%" : "auto", height: aspect >= 1 ? "auto" : "100%", background: "#000", borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 32px oklch(0 0 0 / 0.5)" }}>
          {visible.map(({ clip, trackType }) => {
            const tf = clip.transform;
            const fullFrame = !tf && (trackType === "video");
            const boxStyle: React.CSSProperties = fullFrame
              ? { position: "absolute", inset: 0 }
              : {
                  position: "absolute",
                  left: `${(tf?.x ?? 0.1) * 100}%`, top: `${(tf?.y ?? 0.1) * 100}%`,
                  width: `${(tf?.scale ?? 0.4) * 100}%`,
                  opacity: tf?.opacity ?? 1,
                  transform: `rotate(${tf?.rotation ?? 0}deg)`,
                };
            if (clip.kind === "text") {
              return (
                <div key={clip.id} style={{ ...boxStyle, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", pointerEvents: "none" }}>
                  <span style={{ fontSize: `${((clip.text?.size ?? 48) / doc.height) * 100}cqh`, color: clip.text?.color ?? "#fff", fontFamily: clip.text?.font, background: clip.text?.bgColor, padding: clip.text?.bgColor ? "0.1em 0.3em" : 0, fontWeight: 700, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
                    {clip.text?.content}
                  </span>
                </div>
              );
            }
            // full-frame clips honor the per-clip fit mode; PiP/overlay boxes use cover
            const objFit: React.CSSProperties["objectFit"] = fullFrame
              ? (clip.fit === "cover" ? "cover" : clip.fit === "stretch" ? "fill" : "contain")
              : "cover";
            if (clip.kind === "image") {
              return <img key={clip.id} src={clip.assetUrl} alt="" style={{ ...boxStyle, objectFit: objFit, filter: cssFilter(clip) }} />;
            }
            if (clip.kind === "video") {
              return <video key={clip.id} ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }}
                src={clip.assetUrl} playsInline muted={false} style={{ ...boxStyle, objectFit: objFit, filter: cssFilter(clip) }} />;
            }
            return null;
          })}
          {/* hidden audio elements for audio-track clips */}
          {visible.filter(({ clip }) => clip.kind === "audio").map(({ clip }) => (
            <audio key={clip.id} ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }} src={clip.assetUrl} />
          ))}
          {visible.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: EC.t4, fontSize: 13 }}>把素材拖到时间轴开始剪辑</div>}
        </div>
      </div>

      {/* transport */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 0", borderTop: `1px solid ${EC.border}` }}>
        <button onClick={() => { setPlaying(false); setPlayhead(0); }} title="回到开头" style={transBtn}><SkipBack size={16} /></button>
        <button onClick={() => setPlaying(!playing)} title={playing ? "暂停" : "播放"} style={{ ...transBtn, background: EC.accent, color: "#fff", width: 38, height: 38 }}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <span style={{ fontSize: 12, color: EC.t3, fontVariantNumeric: "tabular-nums", minWidth: 110, textAlign: "center" }}>{fmtTime(playhead)} / {fmtTime(duration)}</span>
      </div>
    </main>
  );
}

const transBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
  borderRadius: "50%", border: `1px solid ${EC.border}`, background: "transparent", color: EC.t1, cursor: "pointer",
};
