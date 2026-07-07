import { create } from "zustand";
import { nanoid } from "nanoid";
import type { EditorDoc, Clip, ClipKind, Track, TrackType, TransformKeyframe } from "@shared/editorTypes";
import { editorDocDuration } from "@shared/editorTypes";
import { arrangeClips } from "@/lib/arrangeClips";

/** Visible duration of a clip on the timeline (seconds), accounting for speed. */
export function clipDuration(c: Clip): number {
  return Math.max(0.05, (c.trimOut - c.trimIn) / (c.speed ?? 1));
}

// Split a clip's keyframes at `offset` (timeline seconds from the clip's start).
// Keyframe `t` is clip-start-relative timeline seconds (see transformAt /
// addKeyframe: `playhead - clip.start`). The left half keeps its start, so kf
// in [0, offset] carry over verbatim; the right half's start moves forward by
// `offset`, so every kept kf MUST be re-based by `t - offset` — otherwise the
// split clip's animation jumps to the wrong times. Boundary keyframes stay on
// both sides for visual continuity across the cut.
export function splitKeyframesAt(
  kfs: TransformKeyframe[] | undefined,
  offset: number,
): { left?: TransformKeyframe[]; right?: TransformKeyframe[] } {
  if (!kfs?.length) return { left: undefined, right: undefined };
  const EPS = 1e-6;
  const left = kfs.filter((k) => k.t <= offset + EPS);
  const right = kfs.filter((k) => k.t >= offset - EPS).map((k) => ({ ...k, t: k.t - offset }));
  return { left: left.length ? left : undefined, right: right.length ? right : undefined };
}

// Re-base a clip's keyframes when its LEFT edge is trimmed by `shift` timeline
// seconds (shift>0 = trimmed inward from the head; shift<0 = extended leftward).
// Keyframe `t` is clip-start-relative, so the whole set moves by `-shift`; content
// trimmed away (t<shift) is dropped — identical to splitClip's right half. Pure.
export function rebaseKeyframesForLeftTrim(
  kfs: TransformKeyframe[] | undefined,
  shift: number,
): TransformKeyframe[] | undefined {
  if (!kfs?.length) return kfs;
  if (Math.abs(shift) < 1e-6) return kfs;
  if (shift > 0) return splitKeyframesAt(kfs, shift).right; // 头部裁进：丢裁掉段、其余重基准（含边界）
  return kfs.map((k) => ({ ...k, t: k.t - shift })); // 向左扩展：整体右移，全部保留
}

// ── Merge (join adjacent, the inverse of split) ─────────────────────────────────
// Tolerance for "adjacent on timeline" / "contiguous in source". Slightly above
// splitClip's 0.05 edge threshold so a just-split pair always re-joins cleanly.
const MERGE_EPS = 0.06;

/** Whether clip `b` is the same source continuing right after clip `a` (so they
 *  can be joined back into one). Mirrors what splitClip produces in reverse:
 *  same media/speed/direction, b starts where a ends, b's source in-point equals
 *  a's source out-point. Pure → unit-tested. */
export function canMergeClips(a: Clip, b: Clip): boolean {
  if (a.kind !== b.kind) return false;
  if ((a.assetUrl ?? "") !== (b.assetUrl ?? "")) return false;
  if ((a.assetId ?? null) !== (b.assetId ?? null)) return false;
  if ((a.speed ?? 1) !== (b.speed ?? 1)) return false;
  if (!!a.reverse !== !!b.reverse) return false;
  if (Math.abs(b.start - (a.start + clipDuration(a))) > MERGE_EPS) return false; // adjacent on timeline
  if (Math.abs(b.trimIn - a.trimOut) > MERGE_EPS) return false;                  // contiguous in source
  return true;
}

/** The immediate right-neighbour clip on the same track (smallest start strictly
 *  greater than `clip`'s), or undefined. */
export function rightNeighbour(track: Track, clip: Clip): Clip | undefined {
  let best: Clip | undefined;
  for (const c of track.clips) {
    if (c.id === clip.id) continue;
    if (c.start <= clip.start) continue;
    if (!best || c.start < best.start) best = c;
  }
  return best;
}

/** Join clip `a` with its contiguous right neighbour `b`: extend a's source
 *  out-point to b's, concatenating keyframes (b's re-based by +a's visible
 *  duration; the duplicate boundary keyframe is dropped). Pure. */
export function mergeClips(a: Clip, b: Clip): Clip {
  const durA = clipDuration(a);
  const aKfs = a.keyframes ?? [];
  const aMaxT = aKfs.length ? Math.max(...aKfs.map((k) => k.t)) : -1;
  const bKfs = (b.keyframes ?? [])
    .map((k) => ({ ...k, t: k.t + durA }))
    .filter((k) => Math.abs(k.t - aMaxT) > 1e-4); // drop the boundary dup
  const keyframes = [...aKfs, ...bKfs];
  return { ...a, trimOut: b.trimOut, keyframes: keyframes.length ? keyframes : undefined };
}

/** Fold a run of clips (sorted by start): merge each contiguous, same-source
 *  neighbour into the running accumulator; a non-contiguous break starts a new
 *  clip. Returns 1+ clips. Pure → unit-tested. */
export function mergeContiguousRun(sorted: Clip[]): Clip[] {
  if (sorted.length <= 1) return sorted.slice();
  const out: Clip[] = [];
  let acc = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (canMergeClips(acc, next)) acc = mergeClips(acc, next);
    else { out.push(acc); acc = next; }
  }
  out.push(acc);
  return out;
}

/** Ripple-merge ONE track: fold maximal runs of selected, source-contiguous,
 *  timeline-adjacent (no clip sitting between them) pieces into a single clip, then
 *  shift later clips left by exactly the gap each merge collapsed — the SAME
 *  "close the freed space, keep other gaps" rule as ripple-delete (consistency).
 *  Pure → unit-tested. Returns the new clip list + merged clip ids, or null if no
 *  change. `allClips` may be unsorted. */
export function rippleMergeTrack(allClips: Clip[], selIds: Set<string>): { clips: Clip[]; mergedIds: string[] } | null {
  const sorted = [...allClips].sort((a, b) => a.start - b.start);
  const result: Clip[] = [];
  const mergedIds: string[] = [];
  let changed = false;
  let shift = 0; // cumulative left-shift accrued from earlier collapsed gaps
  let i = 0;
  while (i < sorted.length) {
    const c = sorted[i];
    if (!selIds.has(c.id)) { result.push(shift ? { ...c, start: Math.max(0, c.start - shift) } : c); i++; continue; }
    // Grow a run of consecutive selected, source-contiguous pieces (an unselected
    // clip in between breaks the run, so we never merge across other content).
    const run: Clip[] = [c];
    let j = i + 1;
    while (j < sorted.length && selIds.has(sorted[j].id) && canMergeSource(run[run.length - 1], sorted[j])) { run.push(sorted[j]); j++; }
    if (run.length < 2) { result.push(shift ? { ...c, start: Math.max(0, c.start - shift) } : c); i++; continue; }
    changed = true;
    const m = mergeSourceRun(run)[0]; // source-contiguous run folds to exactly one clip
    const mergedClip = { ...m, start: Math.max(0, m.start - shift) };
    mergedIds.push(mergedClip.id);
    result.push(mergedClip);
    const last = run[run.length - 1];
    const runSpan = (last.start + clipDuration(last)) - run[0].start;
    shift += Math.max(0, runSpan - clipDuration(mergedClip)); // gap collapsed within the run
    i = j;
  }
  return changed ? { clips: result, mergedIds } : null;
}

/** Like canMergeClips but IGNORING timeline position — same source continuing in
 *  source (b.trimIn ≈ a.trimOut), used by ripple-merge to rejoin pieces that drifted
 *  apart on the timeline. Pure. */
export function canMergeSource(a: Clip, b: Clip): boolean {
  if (a.kind !== b.kind) return false;
  if ((a.assetUrl ?? "") !== (b.assetUrl ?? "")) return false;
  if ((a.assetId ?? null) !== (b.assetId ?? null)) return false;
  if ((a.speed ?? 1) !== (b.speed ?? 1)) return false;
  if (!!a.reverse !== !!b.reverse) return false;
  return Math.abs(b.trimIn - a.trimOut) <= MERGE_EPS;
}

/** Fold a start-sorted run by SOURCE contiguity (timeline-gap tolerant). The merged
 *  clip keeps the first clip's start; gaps are dropped. Pure → unit-tested. */
export function mergeSourceRun(sorted: Clip[]): Clip[] {
  if (sorted.length <= 1) return sorted.slice();
  const out: Clip[] = [];
  let acc = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (canMergeSource(acc, next)) acc = mergeClips(acc, next);
    else { out.push(acc); acc = next; }
  }
  out.push(acc);
  return out;
}

function findClip(doc: EditorDoc, clipId: string): { trackIdx: number; clipIdx: number } | null {
  for (let ti = 0; ti < doc.tracks.length; ti++) {
    const ci = doc.tracks[ti].clips.findIndex((c) => c.id === clipId);
    if (ci >= 0) return { trackIdx: ti, clipIdx: ci };
  }
  return null;
}

/** Keep only the selection ids that still resolve to a clip in `doc`. */
function clampIds(doc: EditorDoc, ids: string[]): string[] {
  return ids.filter((id) => findClip(doc, id) !== null);
}

/** Build a consistent selection patch (full set + mirrored primary). */
function selPatch(ids: string[]): Pick<EditorStore, "selectedClipIds" | "selectedClipId"> {
  return { selectedClipIds: ids, selectedClipId: ids.length ? ids[ids.length - 1] : null };
}

// ── Undo/redo history ──────────────────────────────────────────────────────────
// Snapshot-based: every doc-mutating action records the PRIOR doc on `past`.
// Rapid bursts (clip drag, slider scrub) within COALESCE_MS collapse into a
// single undo step so one drag isn't dozens of tiny undos.
const HISTORY_CAP = 80;
const COALESCE_MS = 450;

export interface EditorStore {
  doc: EditorDoc | null;
  selectedClipId: string | null;   // primary (last-selected) clip, for the properties panel
  selectedClipIds: string[];       // full selection
  playhead: number;     // seconds
  playing: boolean;
  pxPerSec: number;     // timeline zoom
  dirty: boolean;       // unsaved changes since last markClean

  // history
  past: EditorDoc[];
  future: EditorDoc[];
  _lastMutateTs: number;

  load: (doc: EditorDoc) => void;
  /** Replace the whole doc but keep it undoable (AI 智能剪辑：用户可一键撤销回原时间轴). */
  applyDoc: (doc: EditorDoc) => void;
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
  splitAllAtPlayhead: (atTime: number) => void;
  /** 合并：把片段与同轨右侧相邻、同源连续的片段拼回一段（split 的逆操作）。无可合并目标则空操作。 */
  mergeClipWithNext: (clipId: string) => void;
  duplicateClip: (clipId: string) => void;
  rippleDeleteClip: (clipId: string) => void;

  // selection — `selectedClipIds` is the source of truth; `selectedClipId` mirrors
  // the primary (last-added) clip for the single-clip properties panel.
  selectClip: (id: string | null) => void;
  toggleClipSelection: (id: string) => void;
  setSelection: (ids: string[]) => void;
  selectAll: () => void;
  clearSelection: () => void;
  selectedClips: () => Clip[];

  // multi-clip ops (operate on the whole selection)
  removeSelected: () => void;
  rippleDeleteSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  moveSelectedTo: (primaryClipId: string, newPrimaryStart: number) => void;
  nudgeSelected: (dx: number) => void;    // shift selection by ±dx seconds (clamped at 0)
  mergeSelectedClips: () => void;         // 合并选区里每条轨道上「连续同源」的多段为一段（多段连续合并）
  rippleMergeSelected: () => void;        // 波纹合并：按源连续合并（容忍时间间隙），并从合并点起把本轨后续片段左移紧凑
  closeGapsSelected: () => void;          // pack selected clips end-to-end per track
  alignSelectedStartTo: (time: number) => void; // shift selection so its earliest clip starts at `time`
  updateSelected: (patch: Partial<Clip>) => void; // apply a patch to every selected clip (nested effects/transform merged)

  // clipboard — copy clip(s) then paste at the playhead, preserving each clip's
  // offset relative to the earliest. Survives across clips/sessions within a page
  // life; not part of undo history.
  clipboard: { clips: { clip: Clip; trackType: TrackType; offset: number }[] } | null;
  copyClip: (clipId: string) => void;
  pasteClip: (atTime: number) => void;

  // track ops
  updateTrack: (trackId: string, patch: Partial<Pick<Track, "muted" | "volume" | "hidden" | "locked" | "name">>) => void;
  arrangeTrack: (trackId: string, clipIds?: string[]) => void; // 首尾衔接排布本轨片段（clipIds 为空=全部）
  addTrack: (type: TrackType) => void;
  reorderTrack: (trackId: string, toIndex: number) => void;
  removeTrack: (trackId: string) => void;

  // output canvas (ratio / resolution / fps)
  setCanvas: (width: number, height: number, fps?: number) => void;
  setNormalizeAudio: (on: boolean) => void;
  setMasterFade: (which: "in" | "out", seconds: number) => void;
  reframe: (width: number, height: number, fps?: number) => void; // 转比例 + 所有主轨可视片段自动 cover 填满

  // playback / view
  setPlayhead: (t: number) => void;
  setPlaying: (b: boolean) => void;
  setPxPerSec: (n: number) => void;

  // export range (in/out points) — transient UI state, not part of the doc/history.
  inPoint: number | null;
  outPoint: number | null;
  setInPoint: (t: number | null) => void;
  setOutPoint: (t: number | null) => void;

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
  selectedClipIds: [],
  playhead: 0,
  playing: false,
  pxPerSec: 60,
  dirty: false,
  clipboard: null,
  inPoint: null,
  outPoint: null,
  past: [],
  future: [],
  _lastMutateTs: 0,

  load: (doc) => set({ doc, dirty: false, selectedClipId: null, selectedClipIds: [], playhead: 0, playing: false, past: [], future: [], _lastMutateTs: 0, inPoint: null, outPoint: null }),
  applyDoc: (doc) => set((s) => {
    if (!s.doc) return { doc, dirty: true, selectedClipId: null, selectedClipIds: [] };
    // push current doc to history (break coalescing) so 撤销 restores the prior timeline
    const past = [...s.past, s.doc].slice(-HISTORY_CAP);
    return { doc, past, future: [], dirty: true, _lastMutateTs: 0, selectedClipId: null, selectedClipIds: [], playhead: 0 };
  }),
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
      ...selPatch(clampIds(prev, s.selectedClipIds)),
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
      ...selPatch(clampIds(next, s.selectedClipIds)),
    };
  }),

  addClip: (trackId, clip) => {
    const id = clip.id ?? `c_${nanoid(8)}`;
    set((s) => {
      if (!s.doc) return s;
      const tracks = s.doc.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, { ...clip, id }] } : t,
      );
      return withHistory(s, { ...s.doc, tracks }, selPatch([id]));
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
        // 左裁（start 与 trimIn 同时变，从片段头部裁掉/补回内容）时，关键帧必须按新起点重基准——
        // 关键帧 t 是「相对片段起点的时间轴秒」，起点前移后原 t 全部指向了错误时刻（且裁掉部分的
        // 关键帧要丢弃）。与 splitClip 右半、sliceEditorDoc 的左切重基准同理。纯移动（只改 start）
        // 不走 trimClip，故这里以「start 与 trimIn 同时存在」判定为左裁。
        let keyframes = c.keyframes;
        if (keyframes?.length && patch.start != null && patch.trimIn != null) {
          keyframes = rebaseKeyframesForLeftTrim(keyframes, start - c.start);
        }
        return { ...c, trimIn, trimOut, start, keyframes };
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
    return withHistory(s, { ...s.doc, tracks }, selPatch(s.selectedClipIds.filter((x) => x !== clipId)));
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
    const { left: lkf, right: rkf } = splitKeyframesAt(c.keyframes, offset);
    const left: Clip = { ...c, trimOut: cutSrc, keyframes: lkf };
    const right: Clip = { ...c, id: `c_${nanoid(8)}`, start: atTime, trimIn: cutSrc, keyframes: rkf };
    const tracks = s.doc.tracks.map((t, ti) => ti !== loc.trackIdx ? t : {
      ...t, clips: t.clips.flatMap((x) => x.id === clipId ? [left, right] : [x]),
    });
    return withHistory(s, { ...s.doc, tracks }, selPatch([right.id]));
  }),

  // Join the clip with its same-source, contiguous right neighbour (inverse of
  // split). No-op when there's no mergeable neighbour (UI gates/toasts via
  // canMergeClips + rightNeighbour).
  mergeClipWithNext: (clipId) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const track = s.doc.tracks[loc.trackIdx];
    const a = track.clips[loc.clipIdx];
    const b = rightNeighbour(track, a);
    if (!b || !canMergeClips(a, b)) return s;
    const merged = mergeClips(a, b);
    const tracks = s.doc.tracks.map((t, ti) => ti !== loc.trackIdx ? t : {
      ...t, clips: t.clips.flatMap((x) => x.id === a.id ? [merged] : x.id === b.id ? [] : [x]),
    });
    return withHistory(s, { ...s.doc, tracks }, selPatch([merged.id]));
  }),

  // Multi-segment merge: on each track, fold the SELECTED clips' contiguous,
  // same-source runs into single clips (e.g. select 4 pieces split from one
  // source → one clip). Non-contiguous selections are left as separate clips.
  mergeSelectedClips: () => set((s) => {
    if (!s.doc) return s;
    const selSet = new Set(s.selectedClipIds);
    if (selSet.size < 2) return s;
    let changed = false;
    const newSel: string[] = [];
    const tracks = s.doc.tracks.map((t) => {
      const sel = t.clips.filter((c) => selSet.has(c.id)).sort((a, b) => a.start - b.start);
      if (sel.length < 2) { sel.forEach((c) => newSel.push(c.id)); return t; }
      const merged = mergeContiguousRun(sel);
      merged.forEach((c) => newSel.push(c.id));
      if (merged.length === sel.length) return t; // nothing folded on this track
      changed = true;
      const others = t.clips.filter((c) => !selSet.has(c.id));
      const clips = [...others, ...merged].sort((a, b) => a.start - b.start);
      return { ...t, clips };
    });
    if (!changed) return s;
    return withHistory(s, { ...s.doc, tracks }, selPatch(newSel));
  }),

  // Ripple-merge: like mergeSelectedClips but source-contiguity is gap-tolerant
  // (rejoins same-source pieces even with a timeline gap), then packs the affected
  // track end-to-end FROM the merge point rightward so no gap is left (紧凑排布).
  // Clips before the merge point stay put.
  rippleMergeSelected: () => set((s) => {
    if (!s.doc) return s;
    const selSet = new Set(s.selectedClipIds);
    if (selSet.size < 2) return s;
    let changed = false;
    const newSel: string[] = [];
    const tracks = s.doc.tracks.map((t) => {
      const res = rippleMergeTrack(t.clips, selSet);
      if (!res) { t.clips.forEach((c) => { if (selSet.has(c.id)) newSel.push(c.id); }); return t; }
      changed = true;
      // Re-select the merged clips + any still-selected (unmerged) clips on this track.
      const mergedSet = new Set(res.mergedIds);
      for (const c of res.clips) if (mergedSet.has(c.id) || selSet.has(c.id)) newSel.push(c.id);
      return { ...t, clips: res.clips };
    });
    if (!changed) return s;
    return withHistory(s, { ...s.doc, tracks }, selPatch(newSel));
  }),

  // Copy a clip and drop the copy right after the original on the same track.
  duplicateClip: (clipId) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const c = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    const copy: Clip = { ...c, id: `c_${nanoid(8)}`, start: c.start + clipDuration(c) };
    const tracks = s.doc.tracks.map((t, ti) => ti !== loc.trackIdx ? t : { ...t, clips: [...t.clips, copy] });
    return withHistory(s, { ...s.doc, tracks }, selPatch([copy.id]));
  }),

  // Razor at the playhead across EVERY track at once: any clip the time passes
  // through is cut in two (locked tracks are left untouched). Mirrors splitClip's
  // source-time math so cuts are frame-accurate per clip speed.
  splitAllAtPlayhead: (atTime) => set((s) => {
    if (!s.doc) return s;
    let changed = false;
    const tracks = s.doc.tracks.map((t) => {
      if (t.locked) return t;
      const clips = t.clips.flatMap((c) => {
        const speed = c.speed ?? 1;
        const dur = clipDuration(c);
        const offset = atTime - c.start;
        if (offset <= 0.05 || offset >= dur - 0.05) return [c];
        changed = true;
        const cutSrc = c.trimIn + offset * speed;
        const { left: lkf, right: rkf } = splitKeyframesAt(c.keyframes, offset);
        const left: Clip = { ...c, trimOut: cutSrc, keyframes: lkf };
        const right: Clip = { ...c, id: `c_${nanoid(8)}`, start: atTime, trimIn: cutSrc, keyframes: rkf };
        return [left, right];
      });
      return { ...t, clips };
    });
    if (!changed) return s;
    return withHistory(s, { ...s.doc, tracks });
  }),

  // Delete a clip AND pull every later clip on the same track left by its
  // duration, so no gap is left behind (a.k.a. ripple delete).
  rippleDeleteClip: (clipId) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const removed = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    const dur = clipDuration(removed);
    const tracks = s.doc.tracks.map((t, ti) => {
      if (ti !== loc.trackIdx) return t;
      const clips = t.clips
        .filter((c) => c.id !== clipId)
        // 与 rippleDeleteSelected 的严格 `>` 一致：只左移「起点严格晚于被删片段」的幸存者；
        // 同起点的（罕见的叠放）不动——它并不在被删片段之后。
        .map((c) => (c.start > removed.start ? { ...c, start: Math.max(0, c.start - dur) } : c));
      return { ...t, clips };
    });
    return withHistory(s, { ...s.doc, tracks }, selPatch(s.selectedClipIds.filter((x) => x !== clipId)));
  }),

  // Snapshot a single clip into the clipboard (deep clone so later edits to the
  // original don't bleed into the copy). Pure UI state — no doc change, no history.
  copyClip: (clipId) => set((s) => {
    if (!s.doc) return s;
    const loc = findClip(s.doc, clipId);
    if (!loc) return s;
    const clip = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    return { clipboard: { clips: [{ clip: JSON.parse(JSON.stringify(clip)) as Clip, trackType: s.doc.tracks[loc.trackIdx].type, offset: 0 }] } };
  }),

  // Paste every clipboard clip at `atTime` (+ its stored offset) onto the first
  // track of each clip's original type, as fresh clips, and select them all.
  pasteClip: (atTime) => set((s) => {
    if (!s.doc || !s.clipboard || s.clipboard.clips.length === 0) return s;
    const base = Math.max(0, atTime);
    const newIds: string[] = [];
    const additions = new Map<string, Clip[]>(); // trackId -> new clips
    for (const entry of s.clipboard.clips) {
      const target = s.doc.tracks.find((t) => t.type === entry.trackType) ?? s.doc.tracks[0];
      if (!target) continue;
      const id = `c_${nanoid(8)}`;
      newIds.push(id);
      const fresh: Clip = { ...(JSON.parse(JSON.stringify(entry.clip)) as Clip), id, start: Math.max(0, base + entry.offset) };
      additions.set(target.id, [...(additions.get(target.id) ?? []), fresh]);
    }
    if (newIds.length === 0) return s;
    const tracks = s.doc.tracks.map((t) => (additions.has(t.id) ? { ...t, clips: [...t.clips, ...additions.get(t.id)!] } : t));
    return withHistory(s, { ...s.doc, tracks }, selPatch(newIds));
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

  selectClip: (id) => set(selPatch(id ? [id] : [])),

  toggleClipSelection: (id) => set((s) => {
    const has = s.selectedClipIds.includes(id);
    return selPatch(has ? s.selectedClipIds.filter((x) => x !== id) : [...s.selectedClipIds, id]);
  }),

  setSelection: (ids) => set(selPatch(ids)),
  clearSelection: () => set(selPatch([])),

  selectAll: () => set((s) => {
    if (!s.doc) return s;
    const ids: string[] = [];
    for (const t of s.doc.tracks) for (const c of t.clips) ids.push(c.id);
    return selPatch(ids);
  }),

  selectedClips: () => {
    const { doc, selectedClipIds } = get();
    if (!doc) return [];
    const byId = new Map<string, Clip>();
    for (const t of doc.tracks) for (const c of t.clips) byId.set(c.id, c);
    return selectedClipIds.map((id) => byId.get(id)).filter((c): c is Clip => !!c);
  },

  // Delete every selected clip (across tracks) in a single history step.
  removeSelected: () => set((s) => {
    if (!s.doc || s.selectedClipIds.length === 0) return s;
    const kill = new Set(s.selectedClipIds);
    const tracks = s.doc.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !kill.has(c.id)) }));
    return withHistory(s, { ...s.doc, tracks }, selPatch([]));
  }),

  // Ripple-delete the whole selection: on each affected track, remove the selected
  // clips and pull every remaining later clip left by the total duration of the
  // removed clips that started before it, closing the gaps.
  rippleDeleteSelected: () => set((s) => {
    if (!s.doc || s.selectedClipIds.length === 0) return s;
    const sel = new Set(s.selectedClipIds);
    const tracks = s.doc.tracks.map((t) => {
      const removed = t.clips.filter((c) => sel.has(c.id));
      if (removed.length === 0) return t;
      const clips = t.clips.filter((c) => !sel.has(c.id)).map((c) => {
        const shift = removed.reduce((acc, r) => acc + (r.start < c.start ? clipDuration(r) : 0), 0);
        return shift > 0 ? { ...c, start: Math.max(0, c.start - shift) } : c;
      });
      return { ...t, clips };
    });
    return withHistory(s, { ...s.doc, tracks }, selPatch([]));
  }),

  // Duplicate each selected clip in place (offset after itself on its own track);
  // the new copies become the selection.
  duplicateSelected: () => set((s) => {
    if (!s.doc || s.selectedClipIds.length === 0) return s;
    const sel = new Set(s.selectedClipIds);
    const newIds: string[] = [];
    const tracks = s.doc.tracks.map((t) => {
      const copies: Clip[] = [];
      for (const c of t.clips) {
        if (!sel.has(c.id)) continue;
        const id = `c_${nanoid(8)}`;
        newIds.push(id);
        copies.push({ ...c, id, start: c.start + clipDuration(c) });
      }
      return copies.length ? { ...t, clips: [...t.clips, ...copies] } : t;
    });
    return withHistory(s, { ...s.doc, tracks }, selPatch(newIds));
  }),

  // Snapshot the whole selection to the clipboard, each clip's `offset` measured
  // from the earliest selected start so paste preserves their relative layout.
  copySelected: () => set((s) => {
    if (!s.doc || s.selectedClipIds.length === 0) return s;
    const sel = new Set(s.selectedClipIds);
    const picked: { clip: Clip; trackType: TrackType }[] = [];
    for (const t of s.doc.tracks) for (const c of t.clips) {
      if (sel.has(c.id)) picked.push({ clip: JSON.parse(JSON.stringify(c)) as Clip, trackType: t.type });
    }
    if (picked.length === 0) return s;
    const base = Math.min(...picked.map((p) => p.clip.start));
    return { clipboard: { clips: picked.map((p) => ({ ...p, offset: p.clip.start - base })) } };
  }),

  // Shift the entire selection so the primary clip lands at `newPrimaryStart`,
  // clamped so no selected clip crosses below 0. Tracks are preserved.
  moveSelectedTo: (primaryClipId, newPrimaryStart) => set((s) => {
    if (!s.doc) return s;
    const sel = new Set(s.selectedClipIds);
    if (!sel.has(primaryClipId)) return s;
    const loc = findClip(s.doc, primaryClipId);
    if (!loc) return s;
    const primary = s.doc.tracks[loc.trackIdx].clips[loc.clipIdx];
    let dx = Math.max(0, newPrimaryStart) - primary.start;
    // don't let the earliest selected clip go negative
    let minStart = Infinity;
    for (const t of s.doc.tracks) for (const c of t.clips) if (sel.has(c.id)) minStart = Math.min(minStart, c.start);
    if (minStart + dx < 0) dx = -minStart;
    if (dx === 0) return s;
    const tracks = s.doc.tracks.map((t) => ({
      ...t, clips: t.clips.map((c) => (sel.has(c.id) ? { ...c, start: Math.max(0, c.start + dx) } : c)),
    }));
    return withHistory(s, { ...s.doc, tracks });
  }),

  // Apply a partial patch to every selected clip in one history step. `effects`
  // and `transform` are merged per-clip so a single field (e.g. opacity) can be
  // bulk-set without wiping a clip's other adjustments.
  updateSelected: (patch) => set((s) => {
    if (!s.doc || s.selectedClipIds.length === 0) return s;
    const sel = new Set(s.selectedClipIds);
    const apply = (c: Clip): Clip => {
      const next: Clip = { ...c, ...patch };
      if (patch.effects) next.effects = { ...(c.effects ?? {}), ...patch.effects };
      if (patch.transform) next.transform = { ...(c.transform ?? {}), ...patch.transform };
      return next;
    };
    const tracks = s.doc.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (sel.has(c.id) ? apply(c) : c)) }));
    return withHistory(s, { ...s.doc, tracks });
  }),

  // Nudge the whole selection by ±dx seconds, clamped so the earliest clip
  // never crosses below 0. Used for frame-precise keyboard positioning.
  nudgeSelected: (dx) => set((s) => {
    if (!s.doc || s.selectedClipIds.length === 0) return s;
    const sel = new Set(s.selectedClipIds);
    let minStart = Infinity;
    for (const t of s.doc.tracks) for (const c of t.clips) if (sel.has(c.id)) minStart = Math.min(minStart, c.start);
    if (!isFinite(minStart)) return s;
    let d = dx;
    if (minStart + d < 0) d = -minStart;
    if (d === 0) return s;
    const tracks = s.doc.tracks.map((t) => ({
      ...t, clips: t.clips.map((c) => (sel.has(c.id) ? { ...c, start: Math.max(0, c.start + d) } : c)),
    }));
    return withHistory(s, { ...s.doc, tracks });
  }),

  // 紧排：on each track, pack the SELECTED clips end-to-end (in time order),
  // starting from the earliest selected clip's current start. Unselected clips and
  // other tracks are untouched, so cross-track A/V sync is the user's call.
  closeGapsSelected: () => set((s) => {
    if (!s.doc || s.selectedClipIds.length < 2) return s;
    const sel = new Set(s.selectedClipIds);
    let changed = false;
    const tracks = s.doc.tracks.map((t) => {
      const onTrack = t.clips.filter((c) => sel.has(c.id)).sort((a, b) => a.start - b.start);
      if (onTrack.length < 2) return t;
      const newStart = new Map<string, number>();
      let cursor = onTrack[0].start;
      for (const c of onTrack) { newStart.set(c.id, cursor); cursor += clipDuration(c); }
      if (onTrack.some((c) => Math.abs(newStart.get(c.id)! - c.start) > 1e-9)) changed = true;
      return { ...t, clips: t.clips.map((c) => (newStart.has(c.id) ? { ...c, start: newStart.get(c.id)! } : c)) };
    });
    if (!changed) return s;
    return withHistory(s, { ...s.doc, tracks });
  }),

  // Shift the whole selection so its earliest clip starts exactly at `time`.
  arrangeTrack: (trackId, clipIds) => set((s) => {
    if (!s.doc) return s;
    const ids = clipIds && clipIds.length ? new Set(clipIds) : null;
    const tracks = s.doc.tracks.map((t) => (t.id !== trackId ? t : { ...t, clips: arrangeClips(t.clips, clipDuration, ids) }));
    return withHistory(s, { ...s.doc, tracks });
  }),

  alignSelectedStartTo: (time) => set((s) => {
    if (!s.doc || s.selectedClipIds.length === 0) return s;
    const sel = new Set(s.selectedClipIds);
    let earliest = Infinity;
    for (const t of s.doc.tracks) for (const c of t.clips) if (sel.has(c.id)) earliest = Math.min(earliest, c.start);
    if (!isFinite(earliest)) return s;
    const dx = Math.max(0, time) - earliest;
    if (dx === 0) return s;
    const tracks = s.doc.tracks.map((t) => ({
      ...t, clips: t.clips.map((c) => (sel.has(c.id) ? { ...c, start: Math.max(0, c.start + dx) } : c)),
    }));
    return withHistory(s, { ...s.doc, tracks });
  }),

  updateTrack: (trackId, patch) => set((s) => {
    if (!s.doc) return s;
    const tracks = s.doc.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t));
    return withHistory(s, { ...s.doc, tracks });
  }),

  addTrack: (type) => set((s) => {
    if (!s.doc) return s;
    const track: Track = { id: `${type[0]}_${nanoid(6)}`, type, clips: [] };
    // 不再整体重排（保留用户手动拖动的轨道顺序）；新轨道按类型插入到合适位置：
    // 落在第一个「类型序更大」的轨道之前，否则追加到末尾。
    const order: Record<TrackType, number> = { video: 0, overlay: 1, attachment: 2, text: 3, audio: 4 };
    const tracks = [...s.doc.tracks];
    let idx = tracks.findIndex((t) => order[t.type] > order[type]);
    if (idx < 0) idx = tracks.length;
    tracks.splice(idx, 0, track);
    return withHistory(s, { ...s.doc, tracks });
  }),

  // 拖动重排轨道：把 trackId 移动到目标索引（影响预览/导出的图层叠放顺序）。
  reorderTrack: (trackId: string, toIndex: number) => set((s) => {
    if (!s.doc) return s;
    const tracks = [...s.doc.tracks];
    const from = tracks.findIndex((t) => t.id === trackId);
    if (from < 0) return s;
    const [t] = tracks.splice(from, 1);
    tracks.splice(Math.max(0, Math.min(tracks.length, toIndex)), 0, t);
    return withHistory(s, { ...s.doc, tracks });
  }),

  removeTrack: (trackId) => set((s) => {
    if (!s.doc || s.doc.tracks.length <= 1) return s;
    const tracks = s.doc.tracks.filter((t) => t.id !== trackId);
    const goneIds = new Set(s.doc.tracks.find((t) => t.id === trackId)?.clips.map((c) => c.id));
    // 经 selPatch 把删掉轨道里的片段从 selectedClipIds（选择的真源）里剔除，并同步 primary——
    // 否则残留悬空 id、且存活的选中片段失去 primary，后续 updateSelected/rippleDelete 会作用于脏状态。
    return withHistory(s, { ...s.doc, tracks }, selPatch(s.selectedClipIds.filter((id) => !goneIds.has(id))));
  }),

  setCanvas: (width, height, fps) => set((s) => {
    if (!s.doc) return s;
    // even dimensions only — libx264/yuv420p reject odd sizes at export
    const even = (n: number) => { const v = Math.max(16, Math.min(7680, Math.round(n))); return v - (v % 2); };
    return withHistory(s, { ...s.doc, width: even(width), height: even(height), fps: fps ?? s.doc.fps });
  }),

  setNormalizeAudio: (on) => set((s) => s.doc ? withHistory(s, { ...s.doc, normalizeAudio: on }) : s),

  setMasterFade: (which, seconds) => set((s) => s.doc
    ? withHistory(s, { ...s.doc, [which === "in" ? "masterFadeIn" : "masterFadeOut"]: Math.max(0, Math.min(10, seconds)) || undefined })
    : s),

  // One-click reframe: change the canvas aspect AND fill every main-track visual clip
  // (fit: cover) so nothing letterboxes into the new frame — single undo step.
  reframe: (width, height, fps) => set((s) => {
    if (!s.doc) return s;
    const even = (n: number) => { const v = Math.max(16, Math.min(7680, Math.round(n))); return v - (v % 2); };
    const tracks = s.doc.tracks.map((t) => t.type !== "video" ? t : {
      ...t,
      clips: t.clips.map((c) => (c.kind === "video" || c.kind === "image") ? { ...c, fit: "cover" as const } : c),
    });
    return withHistory(s, { ...s.doc, width: even(width), height: even(height), fps: fps ?? s.doc.fps, tracks });
  }),

  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (b) => set({ playing: b }),
  setPxPerSec: (n) => set({ pxPerSec: Math.min(400, Math.max(8, n)) }),
  setInPoint: (t) => set((s) => ({ inPoint: t == null ? null : Math.max(0, t), outPoint: t != null && s.outPoint != null && s.outPoint <= t ? null : s.outPoint })),
  setOutPoint: (t) => set((s) => ({ outPoint: t == null ? null : Math.max(0, t), inPoint: t != null && s.inPoint != null && s.inPoint >= t ? null : s.inPoint })),

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
