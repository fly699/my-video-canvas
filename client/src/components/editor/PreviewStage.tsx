import { useEffect, useRef, useCallback } from "react";
import { Play, Pause, SkipBack } from "lucide-react";
import { EC, fmtTime } from "./theme";
import { useEditorStore, clipDuration } from "./editorStore";
import type { Clip, ClipTransform, EditorDoc } from "@shared/editorTypes";

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

/** CSS for a text clip — mirrors the ASS styling used at export (approximate). */
function textCss(t: Clip["text"], canvasH: number): React.CSSProperties {
  const size = t?.size ?? 48;
  const stroke = t?.strokeWidth ?? 0;
  const css: React.CSSProperties = {
    fontSize: `${(size / canvasH) * 100}cqh`,
    color: t?.color ?? "#fff",
    fontFamily: t?.font,
    fontWeight: t?.bold ? 800 : 600,
    fontStyle: t?.italic ? "italic" : undefined,
    background: t?.bgColor,
    padding: t?.bgColor ? "0.12em 0.32em" : 0,
    borderRadius: t?.bgColor ? "0.1em" : undefined,
    whiteSpace: "pre-wrap",
    lineHeight: 1.25,
  };
  // stroke (scaled to font via em so it tracks the preview zoom)
  if (stroke > 0) (css as Record<string, unknown>).WebkitTextStroke = `${(stroke / size).toFixed(3)}em ${t?.strokeColor ?? "#000"}`;
  if (t?.shadow) css.textShadow = `0 0.05em 0.12em ${t?.shadowColor ?? "rgba(0,0,0,0.65)"}`;
  return css;
}

function activeAt(doc: EditorDoc, t: number): { clip: Clip; trackType: string; muted: boolean }[] {
  const out: { clip: Clip; trackType: string; muted: boolean }[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const c of track.clips) {
      if (t >= c.start && t < c.start + clipDuration(c)) out.push({ clip: c, trackType: track.type, muted: !!track.muted });
    }
  }
  return out;
}

type DragState =
  | { mode: "move"; id: string; px: number; py: number; tf: ClipTransform }
  | { mode: "scale"; id: string; cx: number; cy: number; startW: number; startScale: number; aspect: number }
  | { mode: "rotate"; id: string; cx: number; cy: number; start: number };

export function PreviewStage() {
  const doc = useEditorStore((s) => s.doc);
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);
  const duration = useEditorStore((s) => s.duration());
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateClip = useEditorStore((s) => s.updateClip);

  const mediaRefs = useRef<Map<string, HTMLVideoElement | HTMLAudioElement>>(new Map());
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  // Playback loop
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; return; }
    lastTsRef.current = performance.now();
    const tick = (ts: number) => {
      const dt = (ts - lastTsRef.current) / 1000; lastTsRef.current = ts;
      const next = useEditorStore.getState().playhead + dt;
      if (next >= duration) { setPlayhead(duration); setPlaying(false); return; }
      setPlayhead(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, duration, setPlayhead, setPlaying]);

  // Sync media time/playstate
  useEffect(() => {
    if (!doc) return;
    const active = new Set<string>();
    for (const { clip, muted } of activeAt(doc, playhead)) {
      if (clip.kind !== "video" && clip.kind !== "audio") continue;
      active.add(clip.id);
      const el = mediaRefs.current.get(clip.id);
      if (!el) continue;
      const localSrc = clip.trimIn + (playhead - clip.start) * (clip.speed ?? 1);
      if (Math.abs(el.currentTime - localSrc) > 0.25) el.currentTime = localSrc;
      el.playbackRate = clip.speed ?? 1;
      el.volume = muted ? 0 : Math.min(1, clip.volume ?? 1);
      if (playing && el.paused) el.play().catch(() => {});
      if (!playing && !el.paused) el.pause();
    }
    mediaRefs.current.forEach((el, id) => { if (!active.has(id) && !el.paused) el.pause(); });
  }, [doc, playhead, playing]);

  const stageSize = () => { const r = stageRef.current?.getBoundingClientRect(); return { w: r?.width ?? 1, h: r?.height ?? 1, left: r?.left ?? 0, top: r?.top ?? 0 }; };

  // ── direct-manipulation drag (move / scale / rotate) ──
  const onWinMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const { w, h, left, top } = stageSize();
    if (d.mode === "move") {
      const nx = d.tf.x! + (e.clientX - d.px) / w;
      const ny = d.tf.y! + (e.clientY - d.py) / h;
      updateClip(d.id, { transform: { ...d.tf, x: Math.max(-0.5, Math.min(1, nx)), y: Math.max(-0.5, Math.min(1, ny)) } });
    } else if (d.mode === "scale") {
      const distX = Math.abs(e.clientX - left - d.cx);
      const newW = Math.max(0.04, (distX * 2) / w);             // width fraction (symmetric from center)
      const newH = newW / d.aspect;                              // height fraction (keep media aspect)
      const cxFrac = d.cx / w, cyFrac = d.cy / h;
      const st = useEditorStore.getState();
      const cur = findClip(st.doc, d.id);
      updateClip(d.id, { transform: { ...(cur?.transform ?? {}), scale: newW, x: cxFrac - newW / 2, y: cyFrac - newH / 2 } });
    } else if (d.mode === "rotate") {
      const ang = Math.atan2(e.clientY - top - d.cy, e.clientX - left - d.cx) * 180 / Math.PI + 90;
      updateClip(d.id, { transform: { ...(findClip(useEditorStore.getState().doc, d.id)?.transform ?? {}), rotation: Math.round(ang) } });
    }
  }, [updateClip]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onWinMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onWinMove]);

  const beginMove = useCallback((e: React.PointerEvent, clip: Clip) => {
    e.stopPropagation(); selectClip(clip.id);
    const tf = { x: clip.transform?.x ?? 0.1, y: clip.transform?.y ?? 0.1, scale: clip.transform?.scale ?? 0.4, rotation: clip.transform?.rotation ?? 0, opacity: clip.transform?.opacity ?? 1 };
    dragRef.current = { mode: "move", id: clip.id, px: e.clientX, py: e.clientY, tf };
    window.addEventListener("pointermove", onWinMove); window.addEventListener("pointerup", endDrag);
  }, [selectClip, onWinMove, endDrag]);

  const beginScale = useCallback((e: React.PointerEvent, clip: Clip, boxEl: HTMLElement | null) => {
    e.stopPropagation(); e.preventDefault();
    const { left, top, w } = stageSize();
    const r = boxEl?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2 - left, cy = r.top + r.height / 2 - top;
    const aspect = r.width / Math.max(1, r.height);
    dragRef.current = { mode: "scale", id: clip.id, cx, cy, startW: r.width / w, startScale: clip.transform?.scale ?? 0.4, aspect };
    window.addEventListener("pointermove", onWinMove); window.addEventListener("pointerup", endDrag);
  }, [onWinMove, endDrag]);

  const beginRotate = useCallback((e: React.PointerEvent, clip: Clip, boxEl: HTMLElement | null) => {
    e.stopPropagation(); e.preventDefault();
    const { left, top } = stageSize();
    const r = boxEl?.getBoundingClientRect(); if (!r) return;
    dragRef.current = { mode: "rotate", id: clip.id, cx: r.left + r.width / 2 - left, cy: r.top + r.height / 2 - top, start: clip.transform?.rotation ?? 0 };
    window.addEventListener("pointermove", onWinMove); window.addEventListener("pointerup", endDrag);
  }, [onWinMove, endDrag]);

  if (!doc) return null;
  const visible = activeAt(doc, playhead);
  const aspect = doc.width / doc.height;

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--c-bg, #0c0c10)" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, minHeight: 0 }}>
        <div ref={stageRef} onPointerDown={() => selectClip(null)} onContextMenu={(e) => e.preventDefault()}
          style={{ position: "relative", aspectRatio: `${aspect}`, maxWidth: "100%", maxHeight: "100%", width: aspect >= 1 ? "100%" : "auto", height: aspect >= 1 ? "auto" : "100%", background: "#000", borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 32px oklch(0 0 0 / 0.5)" }}>
          {visible.map(({ clip, trackType }) => {
            const tf = clip.transform;
            const fullFrame = !tf && trackType === "video";
            const selected = clip.id === selectedClipId;
            const objFit: React.CSSProperties["objectFit"] = fullFrame
              ? (clip.fit === "cover" ? "cover" : clip.fit === "stretch" ? "fill" : "contain")
              : "cover";

            if (fullFrame) {
              // main full-frame clip — click to select; sizing via 画面适配
              const common = { onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); selectClip(clip.id); } };
              const st: React.CSSProperties = { position: "absolute", inset: 0, objectFit: objFit, filter: cssFilter(clip), outline: selected ? `2px solid ${EC.accent}` : "none", outlineOffset: -2 };
              if (clip.kind === "image") return <img key={clip.id} {...common} src={clip.assetUrl} alt="" style={st} />;
              if (clip.kind === "video") return <video key={clip.id} {...common} ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }} src={clip.assetUrl} playsInline style={st} />;
              return null;
            }

            // positioned (overlay / PiP / text) — interactive box with handles
            const boxStyle: React.CSSProperties = {
              position: "absolute",
              left: `${(tf?.x ?? 0.1) * 100}%`, top: `${(tf?.y ?? 0.1) * 100}%`,
              width: `${(tf?.scale ?? 0.4) * 100}%`,
              opacity: tf?.opacity ?? 1,
              transform: `rotate(${tf?.rotation ?? 0}deg)`,
              cursor: "move", touchAction: "none",
              outline: selected ? `2px solid ${EC.accent}` : "none",
            };
            return (
              <div key={clip.id} data-clip-box={clip.id} style={boxStyle}
                onPointerDown={(e) => beginMove(e, clip)}>
                {clip.kind === "text" ? (
                  <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: clip.text?.align === "left" ? "flex-start" : clip.text?.align === "right" ? "flex-end" : "center", textAlign: clip.text?.align ?? "center", pointerEvents: "none" }}>
                    <span style={textCss(clip.text, doc.height)}>{clip.text?.content}</span>
                  </div>
                ) : clip.kind === "image" ? (
                  <img src={clip.assetUrl} alt="" draggable={false} style={{ width: "100%", height: "auto", display: "block", filter: cssFilter(clip), pointerEvents: "none" }} />
                ) : clip.kind === "video" ? (
                  <video ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }} src={clip.assetUrl} playsInline muted={false} style={{ width: "100%", height: "auto", display: "block", filter: cssFilter(clip), pointerEvents: "none" }} />
                ) : null}

                {selected && <SelectionHandles clip={clip} onScale={beginScale} onRotate={beginRotate} />}
              </div>
            );
          })}

          {visible.filter(({ clip }) => clip.kind === "audio").map(({ clip }) => (
            <audio key={clip.id} ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }} src={clip.assetUrl} />
          ))}
          {visible.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: EC.t4, fontSize: 13, pointerEvents: "none" }}>把素材拖到时间轴开始剪辑</div>}
        </div>
      </div>

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

/** 4 corner resize handles + a rotation handle, rendered inside the clip box. */
function SelectionHandles({ clip, onScale, onRotate }: {
  clip: Clip;
  onScale: (e: React.PointerEvent, clip: Clip, box: HTMLElement | null) => void;
  onRotate: (e: React.PointerEvent, clip: Clip, box: HTMLElement | null) => void;
}) {
  const box = (e: React.PointerEvent) => (e.currentTarget.closest("[data-clip-box]") as HTMLElement | null);
  const corner = (pos: React.CSSProperties): React.CSSProperties => ({ position: "absolute", width: 12, height: 12, borderRadius: "50%", background: "#fff", border: `2px solid ${EC.accent}`, ...pos, touchAction: "none" });
  return (
    <>
      <div onPointerDown={(e) => onScale(e, clip, box(e))} style={{ ...corner({ left: -6, top: -6, cursor: "nwse-resize" }) }} />
      <div onPointerDown={(e) => onScale(e, clip, box(e))} style={{ ...corner({ right: -6, top: -6, cursor: "nesw-resize" }) }} />
      <div onPointerDown={(e) => onScale(e, clip, box(e))} style={{ ...corner({ left: -6, bottom: -6, cursor: "nesw-resize" }) }} />
      <div onPointerDown={(e) => onScale(e, clip, box(e))} style={{ ...corner({ right: -6, bottom: -6, cursor: "nwse-resize" }) }} />
      {/* rotation handle */}
      <div onPointerDown={(e) => onRotate(e, clip, box(e))} style={{ position: "absolute", left: "50%", top: -26, width: 12, height: 12, marginLeft: -6, borderRadius: "50%", background: EC.accent, border: "2px solid #fff", cursor: "grab", touchAction: "none" }} />
      <div style={{ position: "absolute", left: "50%", top: -16, width: 1, height: 16, background: EC.accent, marginLeft: -0.5, pointerEvents: "none" }} />
    </>
  );
}

function findClip(doc: EditorDoc | null, id: string): Clip | null {
  if (!doc) return null;
  for (const t of doc.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return c; }
  return null;
}

const transBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
  borderRadius: "50%", border: `1px solid ${EC.border}`, background: "transparent", color: EC.t1, cursor: "pointer",
};
