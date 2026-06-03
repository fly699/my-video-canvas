import { create } from "zustand";
import { nanoid } from "nanoid";
import type { EditorDoc, Clip, ClipKind, Track, TrackType, TransformKeyframe } from "@shared/editorTypes";
import { editorDocDuration } from "@shared/editorTypes";

/** Visible duration of a clip on the timeline (seconds), accounting for speed. */
export function clipDuration(c: Clip): number {
  return Math.max(0.05, (c.trimOut - c.trimIn) / (c.speed ?? 1));
}

function findClip(doc: EditorDoc, clipId: string): { trackIdx: number; clipIdx: number } | null {
  for (let ti = 0; ti < doc.tracks.length; ti++) {
    const ci = doc.tracks[ti].clips.findIndex((c) => c.id === clipId);
    if (ci >= 0) return { trackIdx: ti, clipIdx: ci };
  }
  return null;
}

/** Drop a selection that no longer exists in the given doc (e.g. after undoing a paste). */
function clampSelection(doc: EditorDoc, sel: string | null): string | null {
  return sel && findClip(doc, sel) ? sel : null;
}

// ── Undo/redo history ──────────────────────────────────────────────────────────
// Snapshot-based: every doc-mutating action records the PRIOR doc on `past`.
// Rapid bursts (clip drag, slider scrub) within COALESCE_MS collapse into a
// single undo step so one drag isn't dozens of tiny undos.
const HISTORY_CAP = 80;
const COALESCE_MS = 450;

export interface EditorStore {
  doc: EditorDoc | null;
  selectedClipId: string | null;
  playhead: number;     // seconds
  playing: boolean;
  pxPerSec: number;     // timeline zoom
  dirty: boolean;       // unsaved changes since last markClean

  // history
  past: EditorDoc[];
  future: EditorDoc[];
  _lastMutateTs: number;

  load: (doc: EditorDoc) => void;
  markClean: () => void;
  undo: () => void;
  redo: () => void;

  // clip ops (all mark dirty + record history)
  addClip: (trackId: string, clip: Omit<Clip, "id"> & { id?: string }) => string;
  moveClip: (clipId: string, targetTrackId: string, newStart: number) => void;
  trimClip: (clipId: string, patch: { trimIn?: number; trimOut?: number; start?: number }) => void;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  // transform keyframes (animation)
  addKeyframe: (clipId: string, t: number) => void;
  removeKeyframe: (clipId: string, t: number) => void;
  clearKeyframes: (clipId: string) => void;
  splitClip: (clipId: string, atTime: number) => void;
  duplicateClip: (clipId: string) => void;
  selectClip: (id: string | null) => void;

  // track ops
  updateTrack: (trackId: string, patch: Partial<Pick<Track, "muted" | "hidden" | "locked" | "name">>) => void;
  addTrack: (type: TrackType) => void;
  removeTrack: (trackId: string) => void;

  // output canvas (ratio / resolution / fps)
  setCanvas: (width: number, height: number, fps?: number) => void;

  // playback / view
  setPlayhead: (t: number) => void;
  setPlaying: (b: boolean) => void;
  setPxPerSec: (n: number) => void;

  duration: () => number;
  selectedClip: () => Clip | null;
}

/** Build a state patch that applies `nextDoc` and records the prior doc on the
 *  undo stack (coalescing rapid bursts). `s.doc` must be non-null. */
function withHistory(s: EditorStore, nextDoc: EditorDoc, extra: Partial<EditorStore> = {}): Partial<EditorStore> {
  const now = Date.now();
  const coalesce = now - s._lastMutateTs < COALESCE_MS;
  const past = coalesce ? s.past : [...s.past, s.doc as EditorDoc].slice(-HISTORY_CAP);
  return { doc: nextDoc, past, future: [], dirty: true, _lastMutateTs: now, ...extra };
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  doc: null,
  selectedClipId: null,
  playhead: 0,
  playing: false,
  pxPerSec: 60,
  dirty: false,
  past: [],
  future: [],
  _lastMutateTs: 0,

  load: (doc) => set({ doc, dirty: false, selectedClipId: null, playhead: 0, playing: false, past: [], future: [], _lastMutateTs: 0 }),
  markClean: () => set({ dirty: false }),

  undo: () => set((s) => {
    if (!s.doc || s.past.length === 0) return s;
    const prev = s.past[s.past.length - 1];
    return {
      doc: prev,
      past: s.past.slice(0, -1),
      future: [s.doc, ...s.future].slice(0, HISTORY_CAP),
      dirty: true,
      _lastMutateTs: 0, // break coalescing so the next edit records cleanly
      selectedClipId: clampSelection(prev, s.selectedClipId),
    };
  }),

  redo: () => set((s) => {
    if (!s.doc || s.future.length === 0) return s;
    const next = s.future[0];
    return {
      doc: next,
      past: [...s.past, s.doc].slice(-HISTORY_CAP),
      future: s.future.slice(1),
      dirty: true,
      _lastMutateTs: 0,
      selectedClipId: clampSelection(next, s.selectedClipId),
    };
  }),

  addClip: (trackId, clip) => {
    const id = clip.id ?? `c_${nanoid(8)}`;
    set((s) => {
      if (!s.doc) return s;
      const tracks = s.doc.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, { ...clip, id }] } : t,
      );
      return withHistory(s, { ...s.doc, tracks }, { selectedClipId: id });
    });
    return id;
  },

  moveClip: (clipId, targetTrackId, newStart) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const clip = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    const start = Math.max(0, newStart);
    const tracks = s.doc.tracks.map((t, ti) => {
      // remove from old track
      let clips = ti === loc.trackIdx ? t.clips.filter((c) => c.id !== clipId) : t.clips;
      // add to target track
      if (t.id === targetTrackId) clips = [...clips, { ...clip, start }];
      return { ...t, clips };
    });
    return withHistory(s, { ...s.doc, tracks });
  }),

  trimClip: (clipId, patch) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const tracks = s.doc.tracks.map((t, ti) => ti !== loc.trackIdx ? t : {
      ...t,
      clips: t.clips.map((c) => {
        if (c.id !== clipId) return c;
        const trimIn = patch.trimIn != null ? Math.max(0, patch.trimIn) : c.trimIn;
        const trimOut = patch.trimOut != null ? Math.max(trimIn + 0.05, patch.trimOut) : Math.max(trimIn + 0.05, c.trimOut);
        const start = patch.start != null ? Math.max(0, patch.start) : c.start;
        return { ...c, trimIn, trimOut, start };
      }),
    });
    return withHistory(s, { ...s.doc, tracks });
  }),

  updateClip: (clipId, patch) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const tracks = s.doc.tracks.map((t, ti) => ti !== loc.trackIdx ? t : {
      ...t,
      clips: t.clips.map((c) => c.id === clipId ? { ...c, ...patch } : c),
    });
    return withHistory(s, { ...s.doc, tracks });
  }),

  removeClip: (clipId) => set((s) => {
    if (!s.doc) return s;
    const tracks = s.doc.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
    return withHistory(s, { ...s.doc, tracks }, { selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId });
  }),

  // Cut a clip in two at the given timeline time (only if the time is inside it).
  splitClip: (clipId, atTime) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const c = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    const speed = c.speed ?? 1;
    const dur = clipDuration(c);
    const offset = atTime - c.start;                 // seconds into the clip (timeline)
    if (offset <= 0.05 || offset >= dur - 0.05) return s; // too close to an edge
    const cutSrc = c.trimIn + offset * speed; // source time at the cut
    const left: Clip = { ...c, trimOut: cutSrc };
    const right: Clip = { ...c, id: `c_${nanoid(8)}`, start: atTime, trimIn: cutSrc };
    const tracks = s.doc.tracks.map((t, ti) => ti !== loc.trackIdx ? t : {
      ...t, clips: t.clips.flatMap((x) => x.id === clipId ? [left, right] : [x]),
    });
    return withHistory(s, { ...s.doc, tracks }, { selectedClipId: right.id });
  }),

  // Copy a clip and drop the copy right after the original on the same track.
  duplicateClip: (clipId) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const c = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    const copy: Clip = { ...c, id: `c_${nanoid(8)}`, start: c.start + clipDuration(c) };
    const tracks = s.doc.tracks.map((t, ti) => ti !== loc.trackIdx ? t : { ...t, clips: [...t.clips, copy] });
    return withHistory(s, { ...s.doc, tracks }, { selectedClipId: copy.id });
  }),

  // Snapshot the clip's current (base) transform as a keyframe at time `t`
  // (seconds from the clip start), replacing any keyframe at the same instant.
  addKeyframe: (clipId, t) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const c = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    const tr = c.transform ?? {};
    const at = Math.max(0, t);
    const kf: TransformKeyframe = { t: at, x: tr.x ?? 0, y: tr.y ?? 0, scale: tr.scale ?? 1, opacity: tr.opacity ?? 1, rotation: tr.rotation ?? 0 };
    const keyframes = [...(c.keyframes ?? []).filter((k) => Math.abs(k.t - at) > 0.02), kf].sort((a, b) => a.t - b.t);
    const tracks = s.doc.tracks.map((tk, ti) => ti !== loc.trackIdx ? tk : {
      ...tk, clips: tk.clips.map((x) => x.id === clipId ? { ...x, keyframes } : x),
    });
    return withHistory(s, { ...s.doc, tracks });
  }),

  removeKeyframe: (clipId, t) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const c = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    const keyframes = (c.keyframes ?? []).filter((k) => Math.abs(k.t - t) > 0.02);
    const tracks = s.doc.tracks.map((tk, ti) => ti !== loc.trackIdx ? tk : {
      ...tk, clips: tk.clips.map((x) => x.id === clipId ? { ...x, keyframes: keyframes.length ? keyframes : undefined } : x),
    });
    return withHistory(s, { ...s.doc, tracks });
  }),

  clearKeyframes: (clipId) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const tracks = s.doc.tracks.map((tk, ti) => ti !== loc.trackIdx ? tk : {
      ...tk, clips: tk.clips.map((x) => x.id === clipId ? { ...x, keyframes: undefined } : x),
    });
    return withHistory(s, { ...s.doc, tracks });
  }),

  selectClip: (id) => set({ selectedClipId: id }),

  updateTrack: (trackId, patch) => set((s) => {
    if (!s.doc) return s;
    const tracks = s.doc.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t));
    return withHistory(s, { ...s.doc, tracks });
  }),

  addTrack: (type) => set((s) => {
    if (!s.doc) return s;
    const track: Track = { id: `${type[0]}_${nanoid(6)}`, type, clips: [] };
    // place video/overlay near the top, audio at the bottom, text in the middle.
    const order: Record<TrackType, number> = { video: 0, overlay: 1, text: 2, audio: 3 };
    const tracks = [...s.doc.tracks, track].sort((a, b) => order[a.type] - order[b.type]);
    return withHistory(s, { ...s.doc, tracks });
  }),

  removeTrack: (trackId) => set((s) => {
    if (!s.doc || s.doc.tracks.length <= 1) return s;
    const tracks = s.doc.tracks.filter((t) => t.id !== trackId);
    const goneIds = new Set(s.doc.tracks.find((t) => t.id === trackId)?.clips.map((c) => c.id));
    return withHistory(s, { ...s.doc, tracks }, { selectedClipId: goneIds.has(s.selectedClipId ?? "") ? null : s.selectedClipId });
  }),

  setCanvas: (width, height, fps) => set((s) => {
    if (!s.doc) return s;
    // even dimensions only — libx264/yuv420p reject odd sizes at export
    const even = (n: number) => { const v = Math.max(16, Math.min(7680, Math.round(n))); return v - (v % 2); };
    return withHistory(s, { ...s.doc, width: even(width), height: even(height), fps: fps ?? s.doc.fps });
  }),

  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (b) => set({ playing: b }),
  setPxPerSec: (n) => set({ pxPerSec: Math.min(400, Math.max(8, n)) }),

  duration: () => { const d = get().doc; return d ? editorDocDuration(d) : 0; },
  selectedClip: () => {
    const s = get();
    if (!s.doc || !s.selectedClipId) return null;
    const loc = findClip(s.doc, s.selectedClipId);
    return loc ? s.doc.tracks[loc.trackIdx].clips[loc.clipIdx] : null;
  },
}));

/** Map an asset's media type to an editor clip kind. */
export function kindFromAssetType(type: string): ClipKind {
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  if (type === "image") return "image";
  return "video";
}

/** End time (seconds) of the last clip on a track — where a new clip appends. */
export function trackEnd(doc: EditorDoc, trackId: string): number {
  const t = doc.tracks.find((x) => x.id === trackId);
  if (!t) return 0;
  return t.clips.reduce((max, c) => Math.max(max, c.start + clipDuration(c)), 0);
}
