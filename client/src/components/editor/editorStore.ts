import { create } from "zustand";
import { nanoid } from "nanoid";
import type { EditorDoc, Clip, ClipKind } from "@shared/editorTypes";
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

export interface EditorStore {
  doc: EditorDoc | null;
  selectedClipId: string | null;
  playhead: number;     // seconds
  playing: boolean;
  pxPerSec: number;     // timeline zoom
  dirty: boolean;       // unsaved changes since last markClean

  load: (doc: EditorDoc) => void;
  markClean: () => void;

  // clip ops (all mark dirty)
  addClip: (trackId: string, clip: Omit<Clip, "id"> & { id?: string }) => string;
  moveClip: (clipId: string, targetTrackId: string, newStart: number) => void;
  trimClip: (clipId: string, patch: { trimIn?: number; trimOut?: number; start?: number }) => void;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  selectClip: (id: string | null) => void;

  // output canvas (ratio / resolution / fps)
  setCanvas: (width: number, height: number, fps?: number) => void;

  // playback / view
  setPlayhead: (t: number) => void;
  setPlaying: (b: boolean) => void;
  setPxPerSec: (n: number) => void;

  duration: () => number;
  selectedClip: () => Clip | null;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  doc: null,
  selectedClipId: null,
  playhead: 0,
  playing: false,
  pxPerSec: 60,
  dirty: false,

  load: (doc) => set({ doc, dirty: false, selectedClipId: null, playhead: 0, playing: false }),
  markClean: () => set({ dirty: false }),

  addClip: (trackId, clip) => {
    const id = clip.id ?? `c_${nanoid(8)}`;
    set((s) => {
      if (!s.doc) return s;
      const tracks = s.doc.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, { ...clip, id }] } : t,
      );
      return { doc: { ...s.doc, tracks }, dirty: true, selectedClipId: id };
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
    return { doc: { ...s.doc, tracks }, dirty: true };
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
    return { doc: { ...s.doc, tracks }, dirty: true };
  }),

  updateClip: (clipId, patch) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const tracks = s.doc.tracks.map((t, ti) => ti !== loc.trackIdx ? t : {
      ...t,
      clips: t.clips.map((c) => c.id === clipId ? { ...c, ...patch } : c),
    });
    return { doc: { ...s.doc, tracks }, dirty: true };
  }),

  removeClip: (clipId) => set((s) => {
    if (!s.doc) return s;
    const tracks = s.doc.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
    return { doc: { ...s.doc, tracks }, dirty: true, selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId };
  }),

  selectClip: (id) => set({ selectedClipId: id }),

  setCanvas: (width, height, fps) => set((s) => {
    if (!s.doc) return s;
    const w = Math.max(16, Math.min(7680, Math.round(width)));
    const h = Math.max(16, Math.min(7680, Math.round(height)));
    return { doc: { ...s.doc, width: w, height: h, fps: fps ?? s.doc.fps }, dirty: true };
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
