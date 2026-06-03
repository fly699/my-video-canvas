import { useRef, useCallback } from "react";
import { ZoomIn, ZoomOut, Scissors } from "lucide-react";
import { EC, trackColor, trackLabel, fmtTime, probeMediaDuration } from "./theme";
import { useEditorStore, clipDuration } from "./editorStore";
import { MEDIA_DND_MIME, type MediaDragPayload } from "./MediaBin";
import { kindFromAssetType } from "./editorStore";

const LABEL_W = 56;
const RULER_H = 24;
const TRACK_H = 52;

type DragMode = { kind: "move" | "trim-l" | "trim-r"; clipId: string; startX: number; orig: { start: number; trimIn: number; trimOut: number; speed: number } };

export function Timeline() {
  const doc = useEditorStore((s) => s.doc);
  const pxPerSec = useEditorStore((s) => s.pxPerSec);
  const playhead = useEditorStore((s) => s.playhead);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const duration = useEditorStore((s) => s.duration());

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);

  const setPxPerSec = useEditorStore((s) => s.setPxPerSec);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const selectClip = useEditorStore((s) => s.selectClip);

  // Width of the scrollable timeline content (at least viewport-ish).
  const contentSec = Math.max(duration + 5, 20);
  const contentW = contentSec * pxPerSec;

  const onClipPointerDown = useCallback((e: React.PointerEvent, clipId: string, mode: DragMode["kind"]) => {
    e.stopPropagation();
    const st = useEditorStore.getState();
    if (!st.doc) return;
    let found: { start: number; trimIn: number; trimOut: number; speed: number } | null = null;
    for (const t of st.doc.tracks) { const c = t.clips.find((x) => x.id === clipId); if (c) { found = { start: c.start, trimIn: c.trimIn, trimOut: c.trimOut, speed: c.speed ?? 1 }; break; } }
    if (!found) return;
    dragRef.current = { kind: mode, clipId, startX: e.clientX, orig: found };
    selectClip(clipId);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [selectClip]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dxSec = (e.clientX - d.startX) / pxPerSec;
    const store = useEditorStore.getState();
    if (d.kind === "move") {
      // Optionally retarget track by pointer Y.
      let targetTrackId: string | null = null;
      const rows = scrollRef.current?.querySelectorAll<HTMLElement>("[data-track-id]");
      rows?.forEach((row) => {
        const r = row.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) targetTrackId = row.dataset.trackId ?? null;
      });
      const curTrack = store.doc?.tracks.find((t) => t.clips.some((c) => c.id === d.clipId))?.id ?? null;
      store.moveClip(d.clipId, targetTrackId ?? curTrack ?? "", Math.max(0, d.orig.start + dxSec));
    } else if (d.kind === "trim-r") {
      store.trimClip(d.clipId, { trimOut: d.orig.trimOut + dxSec * d.orig.speed });
    } else if (d.kind === "trim-l") {
      const deltaSrc = dxSec * d.orig.speed;
      const newTrimIn = Math.max(0, d.orig.trimIn + deltaSrc);
      const applied = newTrimIn - d.orig.trimIn; // honor clamp at 0
      store.trimClip(d.clipId, { trimIn: newTrimIn, start: Math.max(0, d.orig.start + applied / d.orig.speed) });
    }
  }, [pxPerSec]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  // Seek by clicking the ruler.
  const onRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    setPlayhead(Math.max(0, x / pxPerSec));
  }, [pxPerSec, setPlayhead]);

  // Drop a media asset from the bin onto a track.
  const onDrop = useCallback(async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(MEDIA_DND_MIME);
    if (!raw) return;
    let p: MediaDragPayload;
    try { p = JSON.parse(raw); } catch { return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const start = Math.max(0, x / pxPerSec);
    let dur = 5;
    if (p.kind === "video" || p.kind === "audio") dur = await probeMediaDuration(p.url, p.kind);
    useEditorStore.getState().addClip(trackId, { kind: p.kind, assetId: p.assetId, assetUrl: p.url, start, trimIn: 0, trimOut: dur });
  }, [pxPerSec]);

  if (!doc) return null;

  // Ruler ticks every N seconds (keep ~80px spacing).
  const tickSec = pxPerSec > 120 ? 1 : pxPerSec > 50 ? 2 : pxPerSec > 24 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= contentSec; t += tickSec) ticks.push(t);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: EC.surface }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: `1px solid ${EC.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: EC.t2, fontVariantNumeric: "tabular-nums" }}>{fmtTime(playhead)} / {fmtTime(duration)}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setPxPerSec(pxPerSec / 1.4)} title="缩小" style={zoomBtn}><ZoomOut size={14} /></button>
        <button onClick={() => setPxPerSec(pxPerSec * 1.4)} title="放大" style={zoomBtn}><ZoomIn size={14} /></button>
      </div>

      {/* scrollable area: labels + tracks */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", position: "relative" }}
        onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <div style={{ display: "flex", minWidth: LABEL_W + contentW }}>
          {/* label column */}
          <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 3, background: EC.surface, borderRight: `1px solid ${EC.border}` }}>
            <div style={{ height: RULER_H, borderBottom: `1px solid ${EC.border}` }} />
            {doc.tracks.map((t) => (
              <div key={t.id} style={{ height: TRACK_H, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: trackColor(t.type), borderBottom: `1px solid ${EC.border}` }}>{trackLabel(t.type)}</div>
            ))}
          </div>

          {/* lane area */}
          <div style={{ position: "relative", width: contentW }}>
            {/* ruler */}
            <div onClick={onRulerClick} style={{ height: RULER_H, position: "relative", borderBottom: `1px solid ${EC.border}`, cursor: "text", userSelect: "none" }}>
              {ticks.map((t) => (
                <div key={t} style={{ position: "absolute", left: t * pxPerSec, top: 0, height: "100%", borderLeft: `1px solid ${EC.border}` }}>
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
                      style={{
                        position: "absolute", left, width, top: 5, bottom: 5,
                        borderRadius: 6, overflow: "hidden", cursor: "grab",
                        background: `${col.replace(")", " / 0.25)")}`,
                        border: `1.5px solid ${selected ? "#fff" : col}`,
                        boxShadow: selected ? `0 0 0 1px ${col}` : "none",
                        display: "flex", alignItems: "center",
                      }}>
                      {(c.kind === "image" || c.kind === "video") && c.assetUrl && (
                        <div style={{ position: "absolute", inset: 0, opacity: 0.4, backgroundImage: `url(${c.kind === "image" ? c.assetUrl : ""})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                      )}
                      <span style={{ position: "relative", fontSize: 10, color: EC.t1, padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" }}>
                        {c.kind === "text" ? (c.text?.content ?? "文字") : (c.assetUrl?.split("/").pop() ?? c.kind)}
                      </span>
                      {/* trim handles */}
                      <div onPointerDown={(e) => onClipPointerDown(e, c.id, "trim-l")}
                        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 7, cursor: "ew-resize", background: selected ? col : "transparent" }} />
                      <div onPointerDown={(e) => onClipPointerDown(e, c.id, "trim-r")}
                        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 7, cursor: "ew-resize", background: selected ? col : "transparent" }} />
                    </div>
                  );
                })}
              </div>
            ))}

            {/* playhead */}
            <div style={{ position: "absolute", left: playhead * pxPerSec, top: 0, bottom: 0, width: 2, background: EC.accent, pointerEvents: "none", zIndex: 4 }}>
              <div style={{ position: "absolute", top: -1, left: -4, width: 10, height: 10, borderRadius: "50%", background: EC.accent }} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderTop: `1px solid ${EC.border}`, fontSize: 10, color: EC.t4, flexShrink: 0 }}>
        <Scissors size={11} /> 拖动片段移动/换轨；拖动两端裁剪；点击标尺定位
      </div>
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 24,
  borderRadius: 6, border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2, cursor: "pointer",
};
