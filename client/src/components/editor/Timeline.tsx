import { useRef, useCallback, useState, useEffect } from "react";
import { ZoomIn, ZoomOut, Maximize2, Scissors, Magnet, Trash2, Copy, ClipboardCopy, ClipboardPaste, SplitSquareHorizontal, Combine, Volume2, VolumeX, Eye, EyeOff, Lock, Unlock, Plus, Blend, AlignHorizontalJustifyStart, GripVertical } from "lucide-react";
import { EC, trackColor, trackLabel, fmtTime, probeMediaDuration } from "./theme";
import { useEditorStore, clipDuration, canMergeClips, canMergeSource, rightNeighbour, trimRightSource, clipSplitTrims } from "./editorStore";
import { ClipThumb } from "./ClipThumb";
import { MEDIA_DND_MIME, type MediaDragPayload } from "./MediaBin";
import { usePersistentState } from "@/hooks/usePersistentState";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ui/dialogService";
import type { TrackType, TransformKeyframe } from "@shared/editorTypes";

const LABEL_W = 132;
const RULER_H = 26;
const TRACK_H = 52;
const SNAP_PX = 7; // snap threshold in screen pixels

type DragMode =
  | { kind: "move"; clipId: string; startX: number; grabDx: number; group: boolean; orig: { start: number; dur: number; trackId: string } }
  | { kind: "trim-l" | "trim-r"; clipId: string; startX: number; orig: { start: number; trimIn: number; trimOut: number; speed: number; reverse: boolean; keyframes?: TransformKeyframe[]; isImage: boolean; isVideo: boolean; dur: number; trackId: string; followers: { id: string; start: number }[] } }
  | { kind: "scrub"; startX: number }
  | { kind: "band"; startX: number; startY: number; additive: boolean; baseIds: string[] };

export function Timeline() {
  const doc = useEditorStore((s) => s.doc);
  const pxPerSec = useEditorStore((s) => s.pxPerSec);
  const playhead = useEditorStore((s) => s.playhead);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const duration = useEditorStore((s) => s.duration());
  const inPoint = useEditorStore((s) => s.inPoint);
  const outPoint = useEditorStore((s) => s.outPoint);
  // 选中片段：驱动工具栏「分割 / 合并 / 删除」按钮的可用态。
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selCount = useEditorStore((s) => s.selectedClipIds.length);
  const canMergeSel = useEditorStore((s) => {
    if (!s.doc) return false;
    const ids = s.selectedClipIds;
    if (ids.length >= 2) {
      // 多选：选区内同轨存在「连续同源」的相邻对即可合并
      const sset = new Set(ids);
      for (const tr of s.doc.tracks) {
        const sel = tr.clips.filter((c) => sset.has(c.id)).sort((a, b) => a.start - b.start);
        for (let i = 1; i < sel.length; i++) if (canMergeClips(sel[i - 1], sel[i])) return true;
      }
      return false;
    }
    const id = s.selectedClipId; if (!id) return false;
    for (const tr of s.doc.tracks) {
      const a = tr.clips.find((c) => c.id === id);
      if (a) { const b = rightNeighbour(tr, a); return !!b && canMergeClips(a, b); }
    }
    return false;
  });
  const canRippleSel = useEditorStore((s) => {
    if (!s.doc || s.selectedClipIds.length < 2) return false;
    const sset = new Set(s.selectedClipIds);
    for (const tr of s.doc.tracks) {
      const sel = tr.clips.filter((c) => sset.has(c.id)).sort((a, b) => a.start - b.start);
      for (let i = 1; i < sel.length; i++) if (canMergeSource(sel[i - 1], sel[i])) return true;
    }
    return false;
  });
  const doMerge = useCallback(() => {
    const st = useEditorStore.getState();
    if (st.selectedClipIds.length >= 2) st.mergeSelectedClips();
    else if (st.selectedClipId) st.mergeClipWithNext(st.selectedClipId);
  }, []);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const [snapX, setSnapX] = useState<number | null>(null); // guide line (seconds) while snapping
  const [snapOn, setSnapOn] = usePersistentState<boolean>("ui:editor:snap:v1", true, { validate: (p) => (typeof p === "boolean" ? p : null) });
  // 素材从媒体库拖到时间轴时的落点反馈：高亮目标轨 + 落点插入线（秒）。
  const [dropLane, setDropLane] = useState<{ trackId: string; sec: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);

  const setPxPerSec = useEditorStore((s) => s.setPxPerSec);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const arrangeTrack = useEditorStore((s) => s.arrangeTrack);
  const reorderTrack = useEditorStore((s) => s.reorderTrack);
  const [dragTrackId, setDragTrackId] = useState<string | null>(null);
  const [dropTrackIdx, setDropTrackIdx] = useState<number | null>(null);
  const [addMenu, setAddMenu] = useState(false);

  // Keyboard — clip ops. Del 删除 / Shift+Del 波纹删除 / S 或 Ctrl+B(剪映) 分割 / Shift+S 全轨分割 /
  // Q/W 向左/向右裁剪(剪映：裁掉播放头左/右侧) / Ctrl+D 原地复制 / Ctrl+C 拷贝 / Ctrl+X 剪切 /
  // Ctrl+V 粘贴到播放头. Paste needs no selection.
  useEffect(() => {
    // 剪映式 Q/W：把选中片段在播放头处裁掉左/右一侧（单步撤销、关键帧经 trimClip 自动重基准）。
    const cutSide = (side: "left" | "right") => {
      const st = useEditorStore.getState();
      const sel = st.selectedClipId;
      if (!st.doc || !sel) return;
      let clip = null as ReturnType<typeof st.selectedClip> | null;
      for (const tr of st.doc.tracks) { const c = tr.clips.find((x) => x.id === sel); if (c) { clip = c; break; } }
      if (!clip) return;
      const dur = clipDuration(clip);
      const offset = st.playhead - clip.start;
      if (offset <= 0.05 || offset >= dur - 0.05) return; // 播放头不在片段内（或贴边）
      const { left, right } = clipSplitTrims(clip, offset);
      if (side === "left") st.trimClip(sel, { ...right, start: st.playhead }); // 裁掉左侧：片段起点挪到播放头
      else st.trimClip(sel, left);                                            // 裁掉右侧：出点收到播放头
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable='true']")) return;
      const st = useEditorStore.getState();
      // paste & 全轨分割 work without a current selection
      if ((e.key === "v" || e.key === "V") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); st.pasteClip(st.playhead); return; }
      if ((e.key === "s" || e.key === "S") && e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); st.splitAllAtPlayhead(st.playhead); return; }
      // K 打点（批3）：播放头处加/删标记（±0.15s 内已有则删除），无需选中片段。
      if ((e.key === "k" || e.key === "K") && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); st.toggleMarker(st.playhead); return; }
      const sel = st.selectedClipId;
      if (!sel) return;
      const multi = st.selectedClipIds.length > 1;
      if ((e.key === "Delete" || e.key === "Backspace") && e.shiftKey) { e.preventDefault(); multi ? st.rippleDeleteSelected() : st.rippleDeleteClip(sel); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); multi ? st.removeSelected() : st.removeClip(sel); }
      else if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); multi ? st.copySelected() : st.copyClip(sel); }
      // Ctrl+X 剪切（剪映）：拷贝后删除
      else if ((e.key === "x" || e.key === "X") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (multi) { st.copySelected(); useEditorStore.getState().removeSelected(); } else { st.copyClip(sel); useEditorStore.getState().removeClip(sel); } }
      // Ctrl+B 分割（剪映同款；S 为本编辑器原有同义键）
      else if ((e.key === "b" || e.key === "B") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); st.splitClip(sel, st.playhead); }
      else if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); st.splitClip(sel, st.playhead); }
      // Q/W 向左/向右裁剪（剪映）
      else if ((e.key === "q" || e.key === "Q") && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); cutSide("left"); }
      else if ((e.key === "w" || e.key === "W") && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); cutSide("right"); }
      else if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (e.shiftKey) st.rippleMergeSelected(); else multi ? st.mergeSelectedClips() : st.mergeClipWithNext(sel); }
      else if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); multi ? st.duplicateSelected() : st.duplicateClip(sel); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close the clip context menu / add-track menu on any outside click
  useEffect(() => {
    if (!menu && !addMenu) return;
    const close = () => { setMenu(null); setAddMenu(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu, addMenu]);

  const contentSec = Math.max(duration + 5, 20);
  const contentW = contentSec * pxPerSec;

  /** All snap targets (seconds): 0, the playhead, and every other clip's edges.
   *  `exclude` skips a clip (string) or a whole set of clips (e.g. a moving group,
   *  so the group never snaps to its own members). */
  const snapPoints = useCallback((exclude?: string | Set<string>): number[] => {
    const st = useEditorStore.getState();
    const pts = [0, st.playhead];
    const skip = (id: string) => (exclude instanceof Set ? exclude.has(id) : id === exclude);
    if (st.doc) for (const t of st.doc.tracks) for (const c of t.clips) {
      if (skip(c.id)) continue;
      pts.push(c.start, c.start + clipDuration(c));
    }
    return pts;
  }, []);

  /** Snap a candidate time to the nearest target within threshold; returns the
   *  snapped time + the matched target (for the guide line), or the input. */
  const snap = useCallback((sec: number, exclude?: string | Set<string>, extra: number[] = []): { sec: number; at: number | null } => {
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
    let clip = null, trackId = "", trackLocked = false, track = null;
    for (const t of st.doc.tracks) { const c = t.clips.find((x) => x.id === clipId); if (c) { clip = c; trackId = t.id; trackLocked = !!t.locked; track = t; break; } }
    if (!clip || trackLocked || !track) return; // locked tracks: no select/move/trim
    // Shift/Ctrl/⌘ + click on a clip body toggles its membership and starts no drag.
    if (mode === "move" && (e.shiftKey || e.ctrlKey || e.metaKey)) { st.toggleClipSelection(clipId); return; }
    // Plain click on a non-selected clip → single select. Clicking an already-
    // selected clip keeps the whole selection so the group can be dragged together.
    if (!st.selectedClipIds.includes(clipId)) selectClip(clipId);
    // 点击片段：把播放头跟随到点击处，预览该时间点（仅片段体点击，不含裁剪手柄）。
    if (mode === "move") {
      const lr = laneRect();
      if (lr) { st.setPlaying(false); st.setPlayhead(Math.max(0, (e.clientX - lr.left) / pxPerSec)); }
    }
    if (mode === "move") {
      const grabDx = e.clientX - (laneRect()?.left ?? 0) - clip.start * pxPerSec; // cursor offset within clip
      const group = useEditorStore.getState().selectedClipIds.length > 1;
      dragRef.current = { kind: "move", clipId, startX: e.clientX, grabDx, group, orig: { start: clip.start, dur: clipDuration(clip), trackId } };
    } else {
      const dur = clipDuration(clip);
      const myEnd = clip.start + dur;
      // 同轨道、起点在本片段之后的片段（按时间排序）——拉伸时随之平移（联动跟随）。
      const followers = track.clips
        .filter((c) => c.id !== clipId && c.start >= myEnd - 1e-4)
        .map((c) => ({ id: c.id, start: c.start }))
        .sort((a, b) => a.start - b.start);
      dragRef.current = { kind: mode, clipId, startX: e.clientX, orig: { start: clip.start, trimIn: clip.trimIn, trimOut: clip.trimOut, speed: clip.speed ?? 1, reverse: !!clip.reverse, keyframes: clip.keyframes, isImage: clip.kind === "image", isVideo: clip.kind === "video", dur, trackId, followers } };
    }
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* synthetic/no-active-pointer */ }
  }, [pxPerSec, selectClip]);

  const laneRect = () => laneRef.current?.getBoundingClientRect();

  const beginScrub = useCallback((e: React.PointerEvent) => {
    const rect = laneRect(); if (!rect) return;
    setPlaying(false);
    dragRef.current = { kind: "scrub", startX: e.clientX };
    const x = e.clientX - rect.left;
    const { sec, at } = snap(Math.max(0, x / pxPerSec));
    setPlayhead(sec); setSnapX(at);
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* synthetic/no-active-pointer */ }
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
    if (d.kind === "band") {
      setBand((b) => (b ? { ...b, x1: e.clientX, y1: e.clientY } : b));
      const x0 = Math.min(d.startX, e.clientX), x1 = Math.max(d.startX, e.clientX);
      const y0 = Math.min(d.startY, e.clientY), y1 = Math.max(d.startY, e.clientY);
      const t0 = (x0 - rect.left) / pxPerSec, t1 = (x1 - rect.left) / pxPerSec;
      const hit: string[] = [];
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-track-id]").forEach((row) => {
        const r = row.getBoundingClientRect();
        if (r.bottom < y0 || r.top > y1) return; // band doesn't span this track vertically
        const track = store.doc?.tracks.find((t) => t.id === row.dataset.trackId);
        if (!track || track.locked) return;
        for (const c of track.clips) {
          if (c.start + clipDuration(c) >= t0 && c.start <= t1) hit.push(c.id);
        }
      });
      store.setSelection(d.additive ? Array.from(new Set([...d.baseIds, ...hit])) : hit);
      return;
    }
    if (d.kind === "move" && d.group) {
      // drag the whole multi-selection together: snap the primary clip's start/end,
      // then shift every selected clip by the same delta (track-locked, time only).
      const rawStart = Math.max(0, (e.clientX - rect.left - d.grabDx) / pxPerSec);
      // exclude the entire moving group from snap targets (not just the primary)
      const groupIds = new Set(store.selectedClipIds);
      const s1 = snap(rawStart, groupIds);
      const s2 = snap(rawStart + d.orig.dur, groupIds);
      let start = rawStart, at: number | null = null;
      if (s1.at != null && (s2.at == null || Math.abs(s1.sec - rawStart) <= Math.abs((s2.sec - d.orig.dur) - rawStart))) { start = s1.sec; at = s1.at; }
      else if (s2.at != null) { start = s2.sec - d.orig.dur; at = s2.at; }
      setSnapX(at);
      store.moveSelectedTo(d.clipId, Math.max(0, start));
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
      const srcLen = d.orig.trimOut - d.orig.trimIn;
      const ctrl = e.ctrlKey || e.metaKey;
      let realDur = newDur;
      if (d.orig.isVideo && !ctrl) {
        // 视频默认：拉长/缩短 = 变速（保留整段已裁素材，按新长度拉伸播放）。speed=源长/目标长。
        const speed = Math.max(0.25, Math.min(4, srcLen / newDur));
        realDur = srcLen / speed;                            // 受 speed 上下限约束后的实际长度
        // 变速改变可视时长，关键帧 t 是「相对片段起点的时间轴秒」，必须按 realDur/旧时长 比例重基准，
        // 否则动画时序与画面脱节、菱形标记溢出片段（k.t/cd>1）。仅有关键帧时才带上。
        const kfScale = realDur / d.orig.dur;
        const patch: Parameters<typeof store.updateClip>[1] = { speed };
        if (d.orig.keyframes?.length && Math.abs(kfScale - 1) > 1e-6) {
          patch.keyframes = d.orig.keyframes.map((k) => ({ ...k, t: k.t * kfScale }));
        }
        store.updateClip(d.clipId, patch);
      } else {
        // 图片/音频，或视频按住 Ctrl：在素材内裁剪（保持当前速度）。倒放时右缘对应源 trimIn 侧，
        // 改 trimIn、保留 trimOut（trimRightSource 处理正反向）。
        store.trimClip(d.clipId, trimRightSource(d.orig, newDur));
      }
      // 联动跟随：后续片段按本片段右缘的位移整体平移（保持原有间隙、不重叠）。
      const delta = (d.orig.start + realDur) - (d.orig.start + d.orig.dur);
      if (Math.abs(delta) > 1e-4) for (const f of d.orig.followers) store.moveClip(f.id, d.orig.trackId, Math.max(0, f.start + delta));
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
        // 右缘固定，只从左侧裁进/扩展；夹住左缘不越过右缘（与上面图片分支同款守卫，否则快速拖动越过
        // 右缘会让片段瞬移到右侧、脱离原位）。
        const rightEdge = d.orig.start + d.orig.dur;
        const clampedSec = Math.min(Math.max(0, sec), rightEdge - 0.05);
        const clampedDelta = clampedSec - d.orig.start;
        if (d.orig.reverse) {
          // 倒放：时间轴左缘对应源 trimOut 侧，从左裁进=改 trimOut（保留 trimIn，右缘=源 trimIn 侧不变）。
          const newTrimOut = Math.max(d.orig.trimIn + 0.05, d.orig.trimOut - clampedDelta * d.orig.speed);
          const appliedSrc = d.orig.trimOut - newTrimOut;
          store.trimClip(d.clipId, { trimOut: newTrimOut, start: Math.max(0, d.orig.start + appliedSrc / d.orig.speed) });
        } else {
          const newTrimIn = Math.max(0, d.orig.trimIn + clampedDelta * d.orig.speed);
          const applied = newTrimIn - d.orig.trimIn;
          store.trimClip(d.clipId, { trimIn: newTrimIn, start: Math.max(0, d.orig.start + applied / d.orig.speed) });
        }
      }
    }
  }, [pxPerSec, snap, setPlayhead]);

  const onPointerUp = useCallback(() => { dragRef.current = null; setSnapX(null); setBand(null); }, []);

  // Rubber-band selection: pointer-down on empty track space starts a marquee.
  const onLanePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const st = useEditorStore.getState();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    dragRef.current = { kind: "band", startX: e.clientX, startY: e.clientY, additive, baseIds: additive ? [...st.selectedClipIds] : [] };
    setBand({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    if (!additive) st.clearSelection();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
  }, []);

  // Zoom so the whole timeline fits the visible lane width.
  const fitToWindow = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    const avail = el.clientWidth - LABEL_W - 24; // minus labels + a little breathing room
    // 对齐实际渲染的轨道宽度 contentSec（= max(duration+5, 20)），这样「适应窗口」后整条时间轴
    // 真的完整可见、不再残留横向滚动（旧的按 duration+2 缩放，轨道比它更宽 → 仍要滚）。
    const sec = Math.max(duration + 5, 20);
    if (avail > 0) setPxPerSec(Math.min(400, Math.max(8, avail / sec)));
  }, [duration, setPxPerSec]);

  // 场景自动分割：本地 ffmpeg 场景检测（复用画布 #100 的 detectScenes，免 AI 调用）→
  // 切点从源时间映射到时间轴 → 逐点 splitClip（每刀一个撤销步，可逐段撤销）。
  const sceneMut = trpc.clip.detectScenes.useMutation();
  const [sceneSplitting, setSceneSplitting] = useState(false);
  // 批2：场景检测灵敏度（threshold 越低越敏感，切点越多）。持久化；点按钮循环切档。
  const SCENE_LEVELS = [
    { key: "sensitive", threshold: 0.2, label: "敏感" },
    { key: "normal", threshold: 0.3, label: "标准" },
    { key: "loose", threshold: 0.45, label: "宽松" },
  ] as const;
  const [sceneLevel, setSceneLevel] = usePersistentState<string>("ui:editor:scenesplit-level:v1", "normal", {
    validate: (p) => (SCENE_LEVELS.some((l) => l.key === p) ? (p as string) : null),
  });
  const sceneLv = SCENE_LEVELS.find((l) => l.key === sceneLevel) ?? SCENE_LEVELS[1];
  const sceneSplit = useCallback(async () => {
    const st = useEditorStore.getState();
    const doc = st.doc, sel = st.selectedClipId;
    if (!doc || !sel) return;
    let clip: (typeof doc.tracks)[number]["clips"][number] | undefined, trackId = "";
    for (const t of doc.tracks) { const c = t.clips.find((x) => x.id === sel); if (c) { clip = c; trackId = t.id; break; } }
    if (!clip || clip.kind !== "video" || !clip.assetUrl) { toast.error("请先选中一个视频片段"); return; }
    if (clip.reverse) { toast.error("倒放片段暂不支持场景分割"); return; }
    const abs = new URL(clip.assetUrl, location.origin).href;
    const speed = clip.speed || 1;
    setSceneSplitting(true);
    try {
      const { boundaries } = await sceneMut.mutateAsync({ inputUrl: abs, threshold: sceneLv.threshold });
      // 只取落在本片段 trim 区间内的切点（留 0.1s 边距防切出碎渣），映射到时间轴时刻。
      const times = boundaries
        .filter((b) => b > clip!.trimIn + 0.1 && b < clip!.trimOut - 0.1)
        .map((b) => clip!.start + (b - clip!.trimIn) / speed)
        .sort((a, b) => a - b);
      if (!times.length) { toast.info(`未检测到场景切换点（灵敏度「${sceneLv.label}」；可点旁边的灵敏度按钮换档重试）`); return; }
      // 批2：先确认再动刀——切点多时避免一下把片段剁碎。
      const ok = await confirmDialog({
        title: `检测到 ${times.length} 个场景切点，确认分割？`,
        message: `将把选中片段按画面切换点分成 ${times.length + 1} 段（灵敏度「${sceneLv.label}」，每刀均可撤销）。切点过多/过少可取消后换灵敏度档。`,
      });
      if (!ok) return;
      // 逐点分割：每切一刀 clip id 会变，按当前 store 状态在该轨道上重新定位包含此时刻的同源片段。
      let splits = 0;
      for (const t of times) {
        const cur = useEditorStore.getState().doc;
        const track = cur?.tracks.find((tr) => tr.id === trackId);
        const target = track?.clips.find((c) => c.assetUrl === clip!.assetUrl && t > c.start + 0.05 && t < c.start + clipDuration(c) - 0.05);
        if (target) { useEditorStore.getState().splitClip(target.id, t); splits++; }
      }
      toast.success(splits ? `场景分割完成：新增 ${splits} 个切点（可撤销）` : "切点都在片段边缘，未分割");
    } catch (e) {
      toast.error("场景分割失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSceneSplitting(false);
    }
  }, [sceneMut, sceneLv]);

  // 批3 淡入淡出手柄：拖 clip 顶角小三角改 fadeIn/fadeOut（秒；两者合计不超片长-0.05s；
  // 拖回 0 即清除）。updateClip 连续手势合并为一步撤销。
  const beginFadeDrag = useCallback((e: React.PointerEvent, clipId: string, side: "in" | "out") => {
    e.stopPropagation(); e.preventDefault();
    const st0 = useEditorStore.getState();
    let clip: import("@shared/editorTypes").Clip | undefined;
    for (const t of st0.doc?.tracks ?? []) { const c = t.clips.find((x) => x.id === clipId); if (c) { clip = c; break; } }
    if (!clip) return;
    const startX = e.clientX;
    const dur = clipDuration(clip);
    const start = side === "in" ? (clip.fadeIn ?? 0) : (clip.fadeOut ?? 0);
    const other = side === "in" ? (clip.fadeOut ?? 0) : (clip.fadeIn ?? 0);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / pxPerSec;
      const raw = side === "in" ? start + dx : start - dx;
      const v = Math.round(Math.min(Math.max(0, raw), Math.max(0, dur - other - 0.05)) * 100) / 100;
      useEditorStore.getState().updateClip(clipId, side === "in" ? { fadeIn: v > 0.01 ? v : undefined } : { fadeOut: v > 0.01 ? v : undefined });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [pxPerSec]);

  // 批4 卡点套件①：自动踩点——解码选中音/视频片段音轨，能量峰值节拍检测 → 批量写入标记点。
  // 本地 WebAudio 计算、免 AI 调用；强节奏 BGM 效果好，轻音乐检出偏少属预期。
  const [beatDetecting, setBeatDetecting] = useState(false);
  const autoBeat = useCallback(async () => {
    const st = useEditorStore.getState();
    const doc = st.doc, sel = st.selectedClipId;
    if (!doc || !sel) return;
    let clip: import("@shared/editorTypes").Clip | undefined;
    for (const t of doc.tracks) { const c = t.clips.find((x) => x.id === sel); if (c) { clip = c; break; } }
    if (!clip || (clip.kind !== "audio" && clip.kind !== "video") || !clip.assetUrl) { toast.error("请先选中一个音频或视频片段"); return; }
    setBeatDetecting(true);
    try {
      const abs = new URL(clip.assetUrl, location.origin).href;
      const res = await fetch(abs);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 40 * 1024 * 1024) throw new Error("文件超过 40MB，暂不支持踩点分析");
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
      const Ctor = AC.AudioContext ?? AC.webkitAudioContext;
      if (!Ctor) throw new Error("浏览器不支持音频解码");
      const ac = new Ctor();
      try {
        const audio = await ac.decodeAudioData(buf);
        const { energyEnvelope, detectBeats } = await import("@/lib/beatDetect");
        const hop = 0.02;
        const beats = detectBeats(energyEnvelope(audio.getChannelData(0), audio.sampleRate, hop), hop);
        // 源时间 → 时间轴时刻（按 trim 区间过滤 + 变速换算；倒放少见，跳过不支持）。
        if (clip.reverse) { toast.error("倒放片段暂不支持自动踩点"); return; }
        const speed = clip.speed || 1;
        const times = beats
          .filter((b) => b > clip!.trimIn + 0.05 && b < clip!.trimOut - 0.05)
          .map((b) => clip!.start + (b - clip!.trimIn) / speed);
        if (!times.length) { toast.info("未检测到明显节拍（轻音乐/人声检出偏少，可换强节奏 BGM）"); return; }
        const ok = await confirmDialog({
          title: `检测到 ${times.length} 个节拍点，写入标记？`,
          message: "将在时间轴标尺上打点（与已有标记 ±0.1s 去重，总量上限 300）。配合「按标记分割」即可一键卡点剪辑；可撤销。",
        });
        if (!ok) return;
        useEditorStore.getState().addMarkers(times);
        toast.success(`已写入节拍标记（可按 K 增删，右键旗子删除）`);
      } finally { try { await ac.close(); } catch { /* ignore */ } }
    } catch (e) {
      toast.error("自动踩点失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBeatDetecting(false);
    }
  }, []);

  // 批4 卡点套件②：按标记分割——选中片段在其范围内的所有标记处逐点分割（每刀独立撤销步）。
  const splitAtMarkers = useCallback(() => {
    const st = useEditorStore.getState();
    const doc = st.doc, sel = st.selectedClipId;
    if (!doc || !sel) return;
    let clip: import("@shared/editorTypes").Clip | undefined, trackId = "";
    for (const t of doc.tracks) { const c = t.clips.find((x) => x.id === sel); if (c) { clip = c; trackId = t.id; break; } }
    if (!clip) return;
    const end = clip.start + clipDuration(clip);
    const times = (doc.markers ?? []).map((m) => m.t).filter((t) => t > clip!.start + 0.05 && t < end - 0.05).sort((a, b) => a - b);
    if (!times.length) { toast.info("选中片段范围内没有标记点（先用 K 打点或「自动踩点」）"); return; }
    let splits = 0;
    for (const t of times) {
      const cur = useEditorStore.getState().doc;
      const track = cur?.tracks.find((tr) => tr.id === trackId);
      const target = track?.clips.find((c) => c.assetUrl === clip!.assetUrl && c.kind === clip!.kind && t > c.start + 0.05 && t < c.start + clipDuration(c) - 0.05);
      if (target) { useEditorStore.getState().splitClip(target.id, t); splits++; }
    }
    toast.success(splits ? `已按标记分割：${splits} 刀（可撤销）` : "标记都在片段边缘，未分割");
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    setDropLane(null);
    const raw = e.dataTransfer.getData(MEDIA_DND_MIME);
    if (!raw) return;
    let p: MediaDragPayload; try { p = JSON.parse(raw); } catch { return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const start = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    let dur = 5;
    if (p.kind === "video" || p.kind === "audio") dur = await probeMediaDuration(p.url, p.kind);
    useEditorStore.getState().addClip(trackId, { kind: p.kind, assetId: p.assetId, assetUrl: p.url, start, trimIn: 0, trimOut: dur });
  }, [pxPerSec]);

  /** 拖动素材经过轨道：高亮该轨并把落点（吸附后的秒）记下画插入线。 */
  const onLaneDragOver = useCallback((e: React.DragEvent, trackId: string, locked?: boolean) => {
    if (locked) return;
    // 仅对来自媒体库的拖拽做反馈（避免与片段/轨道重排拖拽混淆）。
    if (!e.dataTransfer.types.includes(MEDIA_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const raw = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    const { sec } = snap(raw);
    setDropLane({ trackId, sec });
  }, [pxPerSec, snap]);

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
        {/* 选中片段操作：分割 / 合并 / 删除（与键盘 S / M / Del 等价，按钮更直观） */}
        <button disabled={!selectedClipId}
          onClick={() => { if (selectedClipId) useEditorStore.getState().splitClip(selectedClipId, playhead); }}
          title="在播放头处分割选中片段 (S)"
          style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, display: "inline-flex", alignItems: "center", color: selectedClipId ? EC.t2 : EC.t4, opacity: selectedClipId ? 1 : 0.5, cursor: selectedClipId ? "pointer" : "not-allowed" }}><SplitSquareHorizontal size={13} /><span style={{ fontSize: 11 }}>分割</span></button>
        <button disabled={!canMergeSel}
          onClick={() => { if (canMergeSel) doMerge(); }}
          title={canMergeSel ? "合并相邻同源片段为一段（多选则把选区内连续多段一次合并）(M)" : "合并：选中相邻、同源连续的片段（单选=与右侧相邻段；多选=选区内连续多段）"}
          style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, display: "inline-flex", alignItems: "center", color: canMergeSel ? EC.t2 : EC.t4, opacity: canMergeSel ? 1 : 0.5, cursor: canMergeSel ? "pointer" : "not-allowed" }}><Combine size={13} /><span style={{ fontSize: 11 }}>合并</span></button>
        <button disabled={!canRippleSel}
          onClick={() => { if (canRippleSel) useEditorStore.getState().rippleMergeSelected(); }}
          title={canRippleSel ? "波纹合并：把选区内同源片段（容忍时间间隙）合成一段，并从合并点起把后续片段左移紧凑 (Shift+M)" : "波纹合并：需多选≥2 个同源片段（可有间隙）"}
          style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, display: "inline-flex", alignItems: "center", color: canRippleSel ? EC.t2 : EC.t4, opacity: canRippleSel ? 1 : 0.5, cursor: canRippleSel ? "pointer" : "not-allowed" }}><AlignHorizontalJustifyStart size={13} /><span style={{ fontSize: 11 }}>波纹合并</span></button>
        <button disabled={selCount === 0}
          onClick={() => { const st = useEditorStore.getState(); if (selCount > 1) st.removeSelected(); else if (selectedClipId) st.removeClip(selectedClipId); }}
          title="删除选中片段 (Del)"
          style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, display: "inline-flex", alignItems: "center", color: selCount ? "oklch(0.65 0.2 25)" : EC.t4, opacity: selCount ? 1 : 0.5, cursor: selCount ? "pointer" : "not-allowed" }}><Trash2 size={13} /><span style={{ fontSize: 11 }}>删除</span></button>
        <div style={{ width: 1, height: 16, background: EC.border, flexShrink: 0 }} />
        <button onClick={() => useEditorStore.getState().splitAllAtPlayhead(playhead)} title="全轨分割：在播放头切开所有轨道的片段 (Shift+S)" style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, display: "inline-flex", alignItems: "center" }}><Scissors size={13} /><span style={{ fontSize: 11 }}>全轨分割</span></button>
        <button disabled={!selectedClipId || sceneSplitting}
          onClick={() => { void sceneSplit(); }}
          title="场景分割：本地分析选中视频片段的画面切换点并自动逐点分割（免 AI 调用，可撤销）"
          style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, display: "inline-flex", alignItems: "center", color: selectedClipId && !sceneSplitting ? EC.t2 : EC.t4, opacity: selectedClipId ? 1 : 0.5, cursor: selectedClipId && !sceneSplitting ? "pointer" : "not-allowed" }}><Blend size={13} /><span style={{ fontSize: 11 }}>{sceneSplitting ? "分析中…" : "场景分割"}</span></button>
        <button disabled={sceneSplitting}
          onClick={() => { const i = SCENE_LEVELS.findIndex((l) => l.key === sceneLv.key); setSceneLevel(SCENE_LEVELS[(i + 1) % SCENE_LEVELS.length].key); }}
          title={`场景检测灵敏度：${sceneLv.label}（阈值 ${sceneLv.threshold}）。点击循环切换 敏感→标准→宽松；越敏感切点越多。`}
          style={{ ...zoomBtn, width: "auto", padding: "0 7px", color: EC.t3 }}><span style={{ fontSize: 11 }}>{sceneLv.label}</span></button>
        <button disabled={!selectedClipId || beatDetecting}
          onClick={() => { void autoBeat(); }}
          title="自动踩点：本地分析选中音/视频片段的节拍（免 AI 调用），批量写入标记点；配合「按标记分割」一键卡点剪辑"
          style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, display: "inline-flex", alignItems: "center", color: selectedClipId && !beatDetecting ? EC.t2 : EC.t4, opacity: selectedClipId ? 1 : 0.5, cursor: selectedClipId && !beatDetecting ? "pointer" : "not-allowed" }}><Magnet size={13} /><span style={{ fontSize: 11 }}>{beatDetecting ? "分析中…" : "自动踩点"}</span></button>
        <button disabled={!selectedClipId}
          onClick={splitAtMarkers}
          title="按标记分割：在选中片段范围内的所有标记点处逐点分割（每刀可撤销）"
          style={{ ...zoomBtn, width: "auto", padding: "0 8px", gap: 4, display: "inline-flex", alignItems: "center", color: selectedClipId ? EC.t2 : EC.t4, opacity: selectedClipId ? 1 : 0.5, cursor: selectedClipId ? "pointer" : "not-allowed" }}><SplitSquareHorizontal size={13} /><span style={{ fontSize: 11 }}>按标记分割</span></button>
        {/* 导出区段：在播放头设入/出点，仅导出选定范围 */}
        <button onClick={() => useEditorStore.getState().setInPoint(playhead)} title="设入点（导出区段起点）" style={{ ...zoomBtn, width: "auto", padding: "0 7px", color: inPoint != null ? EC.accent : EC.t3, borderColor: inPoint != null ? EC.accent : EC.border }}><span style={{ fontSize: 11 }}>入点</span></button>
        <button onClick={() => useEditorStore.getState().setOutPoint(playhead)} title="设出点（导出区段终点）" style={{ ...zoomBtn, width: "auto", padding: "0 7px", color: outPoint != null ? EC.accent : EC.t3, borderColor: outPoint != null ? EC.accent : EC.border }}><span style={{ fontSize: 11 }}>出点</span></button>
        {(inPoint != null || outPoint != null) && (
          <button onClick={() => { const st = useEditorStore.getState(); st.setInPoint(null); st.setOutPoint(null); }} title="清除导出区段" style={{ ...zoomBtn, width: "auto", padding: "0 7px", color: "oklch(0.65 0.2 25)" }}><span style={{ fontSize: 11 }}>清除区段</span></button>
        )}
        <button onClick={() => setPxPerSec(pxPerSec / 1.4)} title="缩小" style={zoomBtn}><ZoomOut size={14} /></button>
        <button onClick={() => setPxPerSec(pxPerSec * 1.4)} title="放大" style={zoomBtn}><ZoomIn size={14} /></button>
        <button onClick={fitToWindow} title="适应窗口（缩放至完整显示时间轴）" style={zoomBtn}><Maximize2 size={13} /></button>
      </div>

      {/* scrollable area: labels + tracks */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", position: "relative" }}
        onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div style={{ display: "flex", minWidth: LABEL_W + contentW }}>
          {/* label column — per-track controls (静音/隐藏/锁定/删除) */}
          <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 3, background: EC.surface, borderRight: `1px solid ${EC.border}` }}>
            <div style={{ height: RULER_H, borderBottom: `1px solid ${EC.border}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <button onClick={() => setAddMenu((v) => !v)} title="新增轨道" style={{ ...trackBtn, color: EC.accent }}><Plus size={13} /></button>
              {addMenu && (
                <div onPointerDown={(e) => e.stopPropagation()} style={{ position: "absolute", top: RULER_H, left: 4, zIndex: 20, padding: 4, borderRadius: 8, background: EC.surface, border: `1px solid ${EC.border}`, boxShadow: "0 8px 24px oklch(0 0 0 / 0.4)" }}>
                  {(["video", "overlay", "text", "audio"] as TrackType[]).map((ty) => (
                    <div key={ty} onClick={() => { addTrack(ty); setAddMenu(false); }} style={{ padding: "5px 12px", fontSize: 12, color: trackColor(ty), cursor: "pointer", whiteSpace: "nowrap" }}>+ {trackLabel(ty)}轨</div>
                  ))}
                </div>
              )}
            </div>
            {doc.tracks.map((t, ti) => {
              const hasAudio = t.type === "audio" || t.type === "video";
              const isVisual = t.type === "video" || t.type === "overlay" || t.type === "text";
              return (
                <div key={t.id}
                  onDragOver={(e) => { if (dragTrackId && dragTrackId !== t.id) { e.preventDefault(); setDropTrackIdx(ti); } }}
                  onDrop={(e) => { e.preventDefault(); if (dragTrackId && dragTrackId !== t.id) reorderTrack(dragTrackId, ti); setDragTrackId(null); setDropTrackIdx(null); }}
                  style={{ height: TRACK_H, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, padding: "0 6px", borderBottom: `1px solid ${EC.border}`, opacity: t.hidden ? 0.5 : (dragTrackId === t.id ? 0.4 : 1), borderTop: dropTrackIdx === ti && dragTrackId ? `2px solid ${EC.accent}` : "2px solid transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span draggable title="拖动重排轨道"
                      onDragStart={(e) => { setDragTrackId(t.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", t.id); } catch { /* ignore */ } }}
                      onDragEnd={() => { setDragTrackId(null); setDropTrackIdx(null); }}
                      style={{ cursor: "grab", color: EC.t4, display: "inline-flex", touchAction: "none" }}><GripVertical size={12} /></span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: trackColor(t.type) }}>{t.name ?? trackLabel(t.type)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 2 }}>
                    {hasAudio && <button onClick={() => updateTrack(t.id, { muted: !t.muted })} title={t.muted ? "取消静音" : "静音"} style={{ ...trackBtn, color: t.muted ? "oklch(0.62 0.2 25)" : EC.t3 }}>{t.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>}
                    {isVisual && <button onClick={() => updateTrack(t.id, { hidden: !t.hidden })} title={t.hidden ? "显示" : "隐藏"} style={{ ...trackBtn, color: t.hidden ? "oklch(0.62 0.2 25)" : EC.t3 }}>{t.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>}
                    <button onClick={() => updateTrack(t.id, { locked: !t.locked })} title={t.locked ? "解锁" : "锁定"} style={{ ...trackBtn, color: t.locked ? EC.accent : EC.t3 }}>{t.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
                    {t.clips.length > 1 && <button onClick={() => arrangeTrack(t.id, selectedClipIds.filter((id) => t.clips.some((c) => c.id === id)))} title="一键排布：把本轨已选片段首尾衔接（无缝拼接）；未选则排布全部" style={{ ...trackBtn, color: EC.t3 }}><AlignHorizontalJustifyStart size={12} /></button>}
                    {doc.tracks.length > 1 && <button onClick={() => { if (t.clips.length === 0 || confirm(`删除「${t.name ?? trackLabel(t.type)}」轨道及其 ${t.clips.length} 个片段？`)) removeTrack(t.id); }} title="删除轨道" style={{ ...trackBtn, color: EC.t3 }}><Trash2 size={12} /></button>}
                  </div>
                  {hasAudio && !t.muted && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input className="tl-vol" type="range" min={0} max={2} step={0.05} value={t.volume ?? 1}
                        title={`轨道音量 ${Math.round((t.volume ?? 1) * 100)}%`}
                        onChange={(e) => updateTrack(t.id, { volume: Number(e.target.value) })}
                        style={{ flex: 1, minWidth: 0, color: EC.accent }} />
                      <span style={{ fontSize: 9.5, color: EC.t3, fontVariantNumeric: "tabular-nums", width: 30, textAlign: "right", flexShrink: 0 }}>{Math.round((t.volume ?? 1) * 100)}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* lane area */}
          <div ref={laneRef} style={{ position: "relative", width: contentW }}>
            {/* ruler — click or drag to scrub */}
            <div onPointerDown={beginScrub} style={{ height: RULER_H, position: "relative", borderBottom: `1px solid ${EC.border}`, cursor: "col-resize", userSelect: "none", touchAction: "none" }}>
              {ticks.map((t) => (
                <div key={t} style={{ position: "absolute", left: t * pxPerSec, top: 0, height: "100%", borderLeft: `1px solid ${EC.border}`, pointerEvents: "none" }}>
                  <span style={{ fontSize: 9, color: EC.t4, marginLeft: 3 }}>{fmtTime(t).split(".")[0]}</span>
                </div>
              ))}
              {/* 批3 标记点：K 键打点 → 标尺小旗；点击跳转、右键删除。 */}
              {(doc.markers ?? []).map((m, i) => (
                <div key={`mk-${i}`} title={`标记 ${fmtTime(m.t)}${m.label ? ` · ${m.label}` : ""}（点击跳转 / 右键删除）`}
                  onPointerDown={(e) => { e.stopPropagation(); }}
                  onClick={(e) => { e.stopPropagation(); useEditorStore.getState().setPlayhead(m.t); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); useEditorStore.getState().removeMarker(m.t); }}
                  style={{ position: "absolute", left: m.t * pxPerSec - 5, bottom: 0, width: 10, height: 13, cursor: "pointer", zIndex: 7,
                    clipPath: "polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%)",
                    background: m.color || "oklch(0.8 0.17 90)", boxShadow: "0 0 3px oklch(0 0 0 / 0.5)" }} />
              ))}
            </div>

            {/* tracks */}
            {doc.tracks.map((t) => (
              <div key={t.id} data-track-id={t.id}
                onPointerDown={onLanePointerDown}
                onDragOver={(e) => onLaneDragOver(e, t.id, t.locked)}
                onDragLeave={() => setDropLane((d) => (d?.trackId === t.id ? null : d))}
                onDrop={(e) => { if (!t.locked) onDrop(e, t.id); }}
                style={{ height: TRACK_H, position: "relative", borderBottom: `1px solid ${EC.border}`, background: dropLane?.trackId === t.id ? EC.accentSoft : t.locked ? "oklch(0.5 0 0 / 0.06)" : "var(--c-canvas, #0c0c10)", boxShadow: dropLane?.trackId === t.id ? `inset 0 0 0 1.5px ${EC.accent}` : "none", opacity: t.hidden ? 0.4 : 1, transition: "background .1s" }}>
                {/* 素材落点插入线（拖入时显示） */}
                {dropLane?.trackId === t.id && (
                  <div style={{ position: "absolute", left: dropLane.sec * pxPerSec, top: 0, bottom: 0, width: 2, background: EC.accent, pointerEvents: "none", zIndex: 6, boxShadow: `0 0 4px ${EC.accent}` }} />
                )}
                {t.clips.map((c) => {
                  const left = c.start * pxPerSec;
                  const width = Math.max(8, clipDuration(c) * pxPerSec);
                  const col = trackColor(t.type);
                  const selected = selectedClipIds.includes(c.id);
                  return (
                    <div key={c.id}
                      onPointerDown={(e) => onClipPointerDown(e, c.id, "move")}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); selectClip(c.id); setMenu({ x: e.clientX, y: e.clientY, clipId: c.id }); }}
                      className="editor-clip"
                      style={{
                        position: "absolute", left, width, top: 5, bottom: 5,
                        borderRadius: 6, overflow: "hidden", cursor: "grab", touchAction: "none",
                        background: `${col.replace(")", " / 0.12)")}`,
                        border: `1.5px solid ${selected ? "#fff" : col}`,
                        boxShadow: selected ? `0 0 0 2px ${col}` : "none",
                        display: "flex", alignItems: "center",
                      }}>
                      <ClipThumb kind={c.kind} assetUrl={c.assetUrl} trimIn={c.trimIn} color={col} />
                      {/* 转场标识：该片段设了入场转场时，左缘显示一个交叠图标 */}
                      {c.transitionIn && c.transitionIn.type !== "none" && (
                        <div title={`入场转场：${c.transitionIn.type} ${c.transitionIn.duration}s（与前一片段交叉）`}
                          style={{ position: "absolute", left: -1, top: "50%", transform: "translateY(-50%)", zIndex: 3, width: 14, height: 14, borderRadius: "50%", background: EC.surface, border: `1px solid ${EC.accent}`, color: EC.accent, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                          <Blend size={9} />
                        </div>
                      )}
                      <span style={{ position: "relative", fontSize: 10, color: EC.t1, padding: "0 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" }}>
                        {c.kind === "text" ? (c.text?.content ?? "文字") : c.kind === "shape" ? (c.shape?.fill ? "形状·填充" : "形状·描边") : (c.assetUrl?.split("/").pop() ?? c.kind)}
                      </span>
                      {/* keyframe markers — diamonds along the clip at each keyframe's time */}
                      {(c.keyframes?.length ?? 0) > 0 && (() => {
                        const cd = clipDuration(c);
                        return c.keyframes!.map((k, i) => (
                          <div key={i} title={`关键帧 @ ${k.t.toFixed(2)}s`}
                            style={{ position: "absolute", bottom: 2, left: `${Math.max(0, Math.min(1, k.t / cd)) * 100}%`,
                              width: 6, height: 6, marginLeft: -3, transform: "rotate(45deg)", background: "oklch(0.92 0.16 95)",
                              border: "1px solid oklch(0.3 0 0)", borderRadius: 1, pointerEvents: "none", zIndex: 2 }} />
                        ));
                      })()}
                      {/* 批3 淡入淡出：渐变遮罩可视化 + 顶角拖拽手柄（text/shape 也支持透明度 fade） */}
                      {(c.fadeIn ?? 0) > 0 && (
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.min((c.fadeIn ?? 0) * pxPerSec, width), background: "linear-gradient(to right, oklch(0 0 0 / 0.55), transparent)", pointerEvents: "none", zIndex: 1 }} />
                      )}
                      {(c.fadeOut ?? 0) > 0 && (
                        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: Math.min((c.fadeOut ?? 0) * pxPerSec, width), background: "linear-gradient(to left, oklch(0 0 0 / 0.55), transparent)", pointerEvents: "none", zIndex: 1 }} />
                      )}
                      {selected && width > 40 && (
                        <>
                          <div onPointerDown={(e) => beginFadeDrag(e, c.id, "in")}
                            title={`淡入：${(c.fadeIn ?? 0).toFixed(2)}s（向右拖加长，拖回 0 清除）`}
                            style={{ position: "absolute", top: 0, left: Math.min((c.fadeIn ?? 0) * pxPerSec, width - 14), width: 14, height: 12, cursor: "ew-resize", zIndex: 4,
                              clipPath: "polygon(0 0, 100% 0, 0 100%)", background: (c.fadeIn ?? 0) > 0 ? "oklch(0.85 0.15 200)" : "oklch(1 0 0 / 0.5)" }} />
                          <div onPointerDown={(e) => beginFadeDrag(e, c.id, "out")}
                            title={`淡出：${(c.fadeOut ?? 0).toFixed(2)}s（向左拖加长，拖回 0 清除）`}
                            style={{ position: "absolute", top: 0, right: Math.min((c.fadeOut ?? 0) * pxPerSec, width - 14), width: 14, height: 12, cursor: "ew-resize", zIndex: 4,
                              clipPath: "polygon(0 0, 100% 0, 100% 100%)", background: (c.fadeOut ?? 0) > 0 ? "oklch(0.85 0.15 200)" : "oklch(1 0 0 / 0.5)" }} />
                        </>
                      )}
                      {/* trim handles — wider hit area + visible grip */}
                      <div onPointerDown={(e) => onClipPointerDown(e, c.id, "trim-l")} className="editor-trim"
                        title={c.kind === "video" ? "拖动裁剪片头（按住 Ctrl 同样裁剪）" : "拖动裁剪片头"}
                        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 3, height: "55%", borderRadius: 2, background: selected ? "#fff" : col }} />
                      </div>
                      <div onPointerDown={(e) => onClipPointerDown(e, c.id, "trim-r")} className="editor-trim"
                        title={c.kind === "video" ? "拖动 = 变速（拉长变慢/缩短变快）；按住 Ctrl = 在素材内裁剪" : "拖动裁剪/调整时长"}
                        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 3, height: "55%", borderRadius: 2, background: selected ? "#fff" : col }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* export range — shaded band + in/out marker lines */}
            {(inPoint != null || outPoint != null) && (() => {
              const a = inPoint ?? 0;
              const b = outPoint ?? Math.max(duration, a);
              return (
                <div style={{ position: "absolute", top: 0, bottom: 0, left: a * pxPerSec, width: Math.max(0, (b - a) * pxPerSec), background: "oklch(0.68 0.22 285 / 0.1)", borderLeft: inPoint != null ? `2px solid ${EC.accent}` : "none", borderRight: outPoint != null ? `2px solid ${EC.accent}` : "none", pointerEvents: "none", zIndex: 4 }} />
              );
            })()}

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
        <Scissors size={11} /> 拖动移动/换轨 · Shift/Ctrl 点击多选 · 空白拖拽框选 · Ctrl+A 全选 · ,/. 逐帧微移 · 拖两端 裁切 · Del 删除 · Shift+Del 波纹删除 · S 分割 · M 合并(多选连续多段) · Shift+M 波纹合并(容隙+紧凑) · Shift+S 全轨分割 · K 打点标记 · 选中片段拖顶角三角=淡入淡出 · Ctrl+C/V 拷贝/粘贴 · Ctrl+D 复制 · 空格 播放/暂停
      </div>

      {menu && (() => {
        const st = useEditorStore.getState();
        const act = (fn: () => void) => { fn(); setMenu(null); };
        const item: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", fontSize: 12, color: EC.t1, cursor: "pointer", whiteSpace: "nowrap" };
        return (
          <div style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 1000, minWidth: 150, padding: 4, borderRadius: 10, background: EC.surface, border: `1px solid ${EC.border}`, boxShadow: "0 12px 40px oklch(0 0 0 / 0.5)" }}
            onPointerDown={(e) => e.stopPropagation()}>
            <div style={item} onClick={() => act(() => st.splitClip(menu.clipId, st.playhead))}><SplitSquareHorizontal size={14} /> 在播放头分割<span style={{ marginLeft: "auto", color: EC.t4 }}>S</span></div>
            {(() => {
              const tr = st.doc?.tracks.find((t) => t.clips.some((c) => c.id === menu.clipId));
              const a = tr?.clips.find((c) => c.id === menu.clipId);
              const b = tr && a ? rightNeighbour(tr, a) : undefined;
              const ok = !!a && !!b && canMergeClips(a, b);
              return <div style={{ ...item, opacity: ok ? 1 : 0.4, pointerEvents: ok ? "auto" : "none" }} onClick={() => act(() => st.mergeClipWithNext(menu.clipId))}><Combine size={14} /> 合并右侧相邻段<span style={{ marginLeft: "auto", color: EC.t4 }}>M</span></div>;
            })()}
            <div style={item} onClick={() => act(() => st.duplicateClip(menu.clipId))}><Copy size={14} /> 原地复制<span style={{ marginLeft: "auto", color: EC.t4 }}>Ctrl+D</span></div>
            <div style={item} onClick={() => act(() => st.copyClip(menu.clipId))}><ClipboardCopy size={14} /> 拷贝<span style={{ marginLeft: "auto", color: EC.t4 }}>Ctrl+C</span></div>
            <div style={{ ...item, opacity: st.clipboard ? 1 : 0.4, pointerEvents: st.clipboard ? "auto" : "none" }} onClick={() => act(() => st.pasteClip(st.playhead))}><ClipboardPaste size={14} /> 粘贴到播放头<span style={{ marginLeft: "auto", color: EC.t4 }}>Ctrl+V</span></div>
            <div style={{ ...item, color: "oklch(0.65 0.2 25)" }} onClick={() => act(() => st.removeClip(menu.clipId))}><Trash2 size={14} /> 删除片段<span style={{ marginLeft: "auto", color: EC.t4 }}>Del</span></div>
            <div style={{ ...item, color: "oklch(0.65 0.2 25)" }} onClick={() => act(() => st.rippleDeleteClip(menu.clipId))}><Trash2 size={14} /> 波纹删除（关闭缺口）<span style={{ marginLeft: "auto", color: EC.t4 }}>Shift+Del</span></div>
          </div>
        );
      })()}

      {/* rubber-band selection marquee */}
      {band && (
        <div style={{
          position: "fixed", zIndex: 999, pointerEvents: "none",
          left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1),
          width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0),
          border: `1px solid ${EC.accent}`, background: `${EC.accent.replace(")", " / 0.12)")}`, borderRadius: 2,
        }} />
      )}
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 24,
  borderRadius: 6, border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2, cursor: "pointer",
};
const trackBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 16,
  borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", padding: 0,
};
