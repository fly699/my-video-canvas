import { useRef, useCallback, useState } from "react";
import { ZoomIn, ZoomOut, Scissors, Magnet } from "lucide-react";
import { EC, trackColor, trackLabel, fmtTime, probeMediaDuration } from "./theme";
import { useEditorStore, clipDuration } from "./editorStore";
import { MEDIA_DND_MIME, type MediaDragPayload } from "./MediaBin";

const LABEL_W = 56;
const RULER_H = 26;
const TRACK_H = 52;
const SNAP_PX = 7; // snap threshold in screen pixels

type DragMode =
  | { kind: "move"; clipId: string; startX: number; grabDx: number; orig: { start: number; dur: number; trackId: string } }
  | { kind: "trim-l" | "trim-r"; clipId: string; startX: number; orig: { start: number; trimIn: number; trimOut: number; speed: number; isImage: boolean } }
  | { kind: "scrub"; startX: number };

export function Timeline() {
  const doc = useEditorStore((s) => s.doc);
  const pxPerSec = useEditorStore((s) => s.pxPerSec);
  const playhead = useEditorStore((s) => s.playhead);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const duration = useEditorStore((s) => s.duration());

  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const [snapX, setSnapX] = useState<number | null>(null); // guide line (seconds) while snapping
  const [snapOn, setSnapOn] = useState(true);

  const setPxPerSec = useEditorStore((s) => s.setPxPerSec);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectClip = useEditorStore((s) => s.selectClip);

  const contentSec = Math.max(duration + 5, 20);
  const contentW = contentSec * pxPerSec;

  /** All snap targets (seconds): 0, the playhead, and every other clip's edges. */
  const snapPoints = useCallback((excludeClipId?: string): number[] => {
    const st = useEditorStore.getState();
    const pts = [0, st.playhead];
    if (st.doc) for (const t of st.doc.tracks) for (const c of t.clips) {
      if (c.id === excludeClipId) continue;
      pts.push(c.start, c.start + clipDuration(c));
    }
    return pts;
  }, []);

  /** Snap a candidate time to the nearest target within threshold; returns the
   *  snapped time + the matched target (for the guide line), or the input. */
  const snap = useCallback((sec: number, exclude?: string, extra: number[] = []): { sec: number; at: number | null } => {
    if (!snapOn) return { sec, at: null };
    const thr = SNAP_PX / pxPerSec;
    let best: number | null = null, bestD = thr;
    for (const p of [...snapPoints(exclude), ...extra]) {
      const d = Math.abs(p - sec);
      if (d <= bestD) { bestD = d; best = p; }
    }
    return best == null ? { sec, at: null } : { sec: best, at: best };
  }, [snapOn, pxPerSec, snapPoints]);

  // ── clip move / trim ──
  const onClipPointerDown = useCallback((e: React.PointerEvent, clipId: string, mode: "move" | "trim-l" | "trim-r") => {
    e.stopPropagation();
    const st = useEditorStore.getState();
    if (!st.doc) return;
    let clip = null, trackId = "";
    for (const t of st.doc.tracks) { const c = t.clips.find((x) => x.id === clipId); if (c) { clip = c; trackId = t.id; break; } }
    if (!clip) return;
    selectClip(clipId);
    if (mode === "move") {
      const grabDx = e.clientX - (laneRect()?.left ?? 0) - clip.start * pxPerSec; // cursor offset within clip
      dragRef.current = { kind: "move", clipId, startX: e.clientX, grabDx, orig: { start: clip.start, dur: clipDuration(clip), trackId } };
    } else {
      dragRef.current = { kind: mode, clipId, startX: e.clientX, orig: { start: clip.start, trimIn: clip.trimIn, trimOut: clip.trimOut, speed: clip.speed ?? 1, isImage: clip.kind === "image" } };
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pxPerSec, selectClip]);

  const laneRect = () => laneRef.current?.getBoundingClientRect();

  const beginScrub = useCallback((e: React.PointerEvent) => {
    const rect = laneRect(); if (!rect) return;
    setPlaying(false);
    dragRef.current = { kind: "scrub", startX: e.clientX };
    const x = e.clientX - rect.left;
    const { sec, at } = snap(Math.max(0, x / pxPerSec));
    setPlayhead(sec); setSnapX(at);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pxPerSec, snap, setPlayhead, setPlaying]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const store = useEditorStore.getState();
    const rect = laneRect(); if (!rect) return;

    if (d.kind === "scrub") {
      const x = e.clientX - rect.left;
      const { sec, at } = snap(Math.max(0, x / pxPerSec));
      setPlayhead(sec); setSnapX(at);
      return;
    }
    if (d.kind === "move") {
      // retarget track by pointer Y
      let targetTrackId: string | null = null;
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-track-id]").forEach((row) => {
        const r = row.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) targetTrackId = row.dataset.trackId ?? null;
      });
      const rawStart = Math.max(0, (e.clientX - rect.left - d.grabDx) / pxPerSec);
      // snap either the clip's start or its end to a target
      const s1 = snap(rawStart, d.clipId);
      const s2 = snap(rawStart + d.orig.dur, d.clipId);
      let start = rawStart, at: number | null = null;
      if (s1.at != null && (s2.at == null || Math.abs(s1.sec - rawStart) <= Math.abs((s2.sec - d.orig.dur) - rawStart))) { start = s1.sec; at = s1.at; }
      else if (s2.at != null) { start = s2.sec - d.orig.dur; at = s2.at; }
      setSnapX(at);
      store.moveClip(d.clipId, targetTrackId ?? d.orig.trackId, Math.max(0, start));
    } else if (d.kind === "trim-r") {
      const edge = (e.clientX - rect.left) / pxPerSec;       // right edge target (timeline secs)
      const { sec, at } = snap(edge, d.clipId);
      setSnapX(at);
      const newDur = Math.max(0.05, sec - d.orig.start);
      store.trimClip(d.clipId, { trimOut: d.orig.trimIn + newDur * d.orig.speed });
    } else if (d.kind === "trim-l") {
      const edge = Math.max(0, (e.clientX - rect.left) / pxPerSec); // left edge target
      const { sec, at } = snap(edge, d.clipId);
      setSnapX(at);
      const deltaSec = sec - d.orig.start;                   // how far the left edge moved
      if (d.orig.isImage) {
        // keep the right edge fixed; shorten/extend from the left
        const rightEdge = d.orig.start + (d.orig.trimOut - d.orig.trimIn);
        const ns = Math.min(Math.max(0, sec), rightEdge - 0.05);
        store.trimClip(d.clipId, { start: ns, trimIn: 0, trimOut: rightEdge - ns });
      } else {
        const newTrimIn = Math.max(0, d.orig.trimIn + deltaSec * d.orig.speed);
        const applied = newTrimIn - d.orig.trimIn;
        store.trimClip(d.clipId, { trimIn: newTrimIn, start: Math.max(0, d.orig.start + applied / d.orig.speed) });
      }
    }
  }, [pxPerSec, snap, setPlayhead]);

  const onPointerUp = useCallback(() => { dragRef.current = null; setSnapX(null); }, []);

  const onDrop = useCallback(async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(MEDIA_DND_MIME);
    if (!raw) return;
    let p: MediaDragPayload; try { p = JSON.parse(raw); } catch { return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const start = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    let dur = 5;
    if (p.kind === "video" || p.kind === "audio") dur = await probeMediaDuration(p.url, p.kind);
    useEditorStore.getState().addClip(trackId, { kind: p.kind, assetId: p.assetId, assetUrl: p.url, start, trimIn: 0, trimOut: dur });
  }, [pxPerSec]);

  if (!doc) return null;

  const tickSec = pxPerSec > 120 ? 1 : pxPerSec > 50 ? 2 : pxPerSec > 24 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= contentSec; t += tickSec) ticks.push(t);
  const phX = playhead * pxPerSec;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: EC.surface }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: `1px solid ${EC.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: EC.t2, fontVariantNumeric: "tabular-nums" }}>{fmtTime(playhead)} / {fmtTime(duration)}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setSnapOn((v) => !v)} title={snapOn ? "吸附：开（拖动时对齐片段/播放头）" : "吸附：关"} style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, color: snapOn ? EC.accent : EC.t3, borderColor: snapOn ? EC.accent : EC.border, display: "inline-flex", alignItems: "center" }}><Magnet size={13} /><span style={{ fontSize: 11 }}>吸附</span></button>
        <button onClick={() => setPxPerSec(pxPerSec / 1.4)} title="缩小" style={zoomBtn}><ZoomOut size={14} /></button>
        <button onClick={() => setPxPerSec(pxPerSec * 1.4)} title="放大" style={zoomBtn}><ZoomIn size={14} /></button>
      </div>

      {/* scrollable area: labels + tracks */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", position: "relative" }}
        onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div style={{ display: "flex", minWidth: LABEL_W + contentW }}>
          {/* label column */}
          <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 3, background: EC.surface, borderRight: `1px solid ${EC.border}` }}>
            <div style={{ height: RULER_H, borderBottom: `1px solid ${EC.border}` }} />
            {doc.tracks.map((t) => (
              <div key={t.id} style={{ height: TRACK_H, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: trackColor(t.type), borderBottom: `1px solid ${EC.border}` }}>{trackLabel(t.type)}</div>
            ))}
          </div>

          {/* lane area */}
          <div ref={laneRef} style={{ position: "relative", width: contentW }}>
            {/* ruler — click or drag to scrub */}
            <div onPointerDown={beginScrub} style={{ height: RULER_H, position: "relative", borderBottom: `1px solid ${EC.border}`, cursor: "col-resize", userSelect: "none", touchAction: "none" }}>
              {ticks.map((t) => (
                <div key={t} style={{ position: "absolute", left: t * pxPerSec, top: 0, height: "100%", borderLeft: `1px solid ${EC.border}`, pointerEvents: "none" }}>
                  <span style={{ fontSize: 9, color: EC.t4, marginLeft: 3 }}>{fmtTime(t).slice(0, 5)}</span>
                </div>
              ))}
            </div>

            {/* tracks */}
            {doc.tracks.map((t) => (
              <div key={t.id} data-track-id={t.id}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                onDrop={(e) => onDrop(e, t.id)}
                style={{ height: TRACK_H, position: "relative", borderBottom: `1px solid ${EC.border}`, background: "var(--c-bg, #0c0c10)" }}>
                {t.clips.map((c) => {
                  const left = c.start * pxPerSec;
                  const width = Math.max(8, clipDuration(c) * pxPerSec);
                  const col = trackColor(t.type);
                  const selected = c.id === selectedClipId;
                  return (
                    <div key={c.id}
                      onPointerDown={(e) => onClipPointerDown(e, c.id, "move")}
                      className="editor-clip"
                      style={{
                        position: "absolute", left, width, top: 5, bottom: 5,
                        borderRadius: 6, overflow: "hidden", cursor: "grab", touchAction: "none",
                        background: `${col.replace(")", " / 0.25)")}`,
                        border: `1.5px solid ${selected ? "#fff" : col}`,
                        boxShadow: selected ? `0 0 0 2px ${col}` : "none",
                        display: "flex", alignItems: "center",
                      }}>
                      {(c.kind === "image" || c.kind === "video") && c.assetUrl && (
                        <div style={{ position: "absolute", inset: 0, opacity: 0.4, backgroundImage: `url(${c.kind === "image" ? c.assetUrl : ""})`, backgroundSize: "cover", backgroundPosition: "center", pointerEvents: "none" }} />
                      )}
                      <span style={{ position: "relative", fontSize: 10, color: EC.t1, padding: "0 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" }}>
                        {c.kind === "text" ? (c.text?.content ?? "文字") : (c.assetUrl?.split("/").pop() ?? c.kind)}
                      </span>
                      {/* trim handles — wider hit area + visible grip */}
                      <div onPointerDown={(e) => onClipPointerDown(e, c.id, "trim-l")} className="editor-trim"
                        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 3, height: "55%", borderRadius: 2, background: selected ? "#fff" : col }} />
                      </div>
                      <div onPointerDown={(e) => onClipPointerDown(e, c.id, "trim-r")} className="editor-trim"
                        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 3, height: "55%", borderRadius: 2, background: selected ? "#fff" : col }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* snap guide */}
            {snapX != null && (
              <div style={{ position: "absolute", left: snapX * pxPerSec, top: 0, bottom: 0, width: 1, background: "oklch(0.85 0.18 90)", pointerEvents: "none", zIndex: 5 }} />
            )}

            {/* playhead — draggable; wide hit strip + grab handle */}
            <div style={{ position: "absolute", left: phX, top: 0, bottom: 0, width: 2, background: EC.accent, zIndex: 6, pointerEvents: "none" }}>
              {/* grab handle (in ruler) */}
              <div onPointerDown={beginScrub}
                title="拖动定位播放头"
                style={{ position: "absolute", top: 0, left: -8, width: 18, height: RULER_H, cursor: "ew-resize", pointerEvents: "auto", display: "flex", justifyContent: "center", touchAction: "none" }}>
                <div style={{ width: 14, height: 14, marginTop: 1, borderRadius: 3, background: EC.accent, boxShadow: "0 1px 3px oklch(0 0 0 / 0.5)" }} />
              </div>
              {/* wide invisible drag strip along the line */}
              <div onPointerDown={beginScrub}
                style={{ position: "absolute", top: RULER_H, bottom: 0, left: -5, width: 12, cursor: "ew-resize", pointerEvents: "auto", touchAction: "none" }} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderTop: `1px solid ${EC.border}`, fontSize: 10, color: EC.t4, flexShrink: 0 }}>
        <Scissors size={11} /> 拖动片段移动/换轨 · 拖两端裁剪 · 拖标尺或播放头方块定位 · 吸附自动对齐
      </div>
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 24,
  borderRadius: 6, border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2, cursor: "pointer",
};
