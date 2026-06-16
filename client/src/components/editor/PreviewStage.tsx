import { Fragment, useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { Play, Pause, SkipBack, Grid3x3, Maximize, Minimize } from "lucide-react";
import { EC, fmtTime } from "./theme";
import { useEditorStore, clipDuration } from "./editorStore";
import { usePersistentState } from "@/hooks/usePersistentState";
import { computeSafeRect } from "@/lib/safeZone";
import { shapeToDataUrl } from "@shared/shapeSvg";
import type { Clip, ClipTransform, EditorDoc, FitMode } from "@shared/editorTypes";
import { transformAt, applyEase } from "@shared/editorTypes";

/** Reduce W:H to a tidy ratio label (e.g. 1920×1080 → "16:9"). */
function ratioLabel(w: number, h: number): string {
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const d = g(w, h) || 1;
  return `${Math.round(w / d)}:${Math.round(h / d)}`;
}

/** CSS approximation of the ffmpeg color effects (preview only; export is exact). */
function cssFilter(c: Clip): string {
  const e = c.effects;
  const parts: string[] = [];
  if (e) {
    if (e.brightness != null) parts.push(`brightness(${(1 + e.brightness).toFixed(3)})`);
    if (e.contrast != null) parts.push(`contrast(${e.contrast})`);
    if (e.saturation != null) parts.push(`saturate(${e.saturation})`);
    switch (e.filter) {
      case "vintage": parts.push("sepia(0.5) contrast(0.95) saturate(0.9)"); break;
      case "cool": parts.push("hue-rotate(-15deg) saturate(1.1)"); break;
      case "warm": parts.push("sepia(0.25) saturate(1.2)"); break;
      case "bw": case "mono": parts.push("grayscale(1)"); break;
      case "cinematic": parts.push("contrast(1.1) saturate(1.15)"); break;
      case "teal_orange": parts.push("contrast(1.08) saturate(1.25) hue-rotate(-6deg)"); break;
      case "sepia": parts.push("sepia(0.85)"); break;
      case "noir": parts.push("grayscale(1) contrast(1.35) brightness(0.97)"); break;
      case "faded": parts.push("brightness(1.08) saturate(0.72) contrast(0.9)"); break;
      case "vivid": parts.push("saturate(1.4) contrast(1.08)"); break;
      case "cyberpunk": parts.push("saturate(1.35) contrast(1.05) hue-rotate(8deg)"); break;
      case "moody": parts.push("saturate(0.9) contrast(1.1) brightness(0.93)"); break;
      case "gold": parts.push("sepia(0.35) saturate(1.15) brightness(1.03)"); break;
    }
    // 锐化：CSS 无真正卷积锐化，用轻微对比度提升近似（导出由 ffmpeg unsharp 精确处理）。
    if (e.sharpen != null && e.sharpen > 0) parts.push(`contrast(${(1 + e.sharpen * 0.28).toFixed(3)})`);
  }
  return parts.join(" ");
}

/** 形状蒙版的 CSS 近似（叠加层/画中画）：椭圆用 radial-gradient mask（支持羽化/反转），
 *  矩形用 clip-path inset（硬边、非反转）。导出由 ffmpeg geq 精确处理。 */
function maskCss(m: Clip["mask"]): React.CSSProperties {
  if (!m) return {};
  const cx = ((m.x + m.w / 2) * 100).toFixed(2), cy = ((m.y + m.h / 2) * 100).toFixed(2);
  const rx = ((m.w / 2) * 100).toFixed(2), ry = ((m.h / 2) * 100).toFixed(2);
  if (m.type === "ellipse") {
    const f = Math.max(0, Math.min(1, m.feather ?? 0));
    const inner = (Math.max(0, 1 - f) * 100).toFixed(1);
    const aIn = m.invert ? 0 : 1, aOut = m.invert ? 1 : 0;
    const g = `radial-gradient(ellipse ${rx}% ${ry}% at ${cx}% ${cy}%, rgba(0,0,0,${aIn}) ${inner}%, rgba(0,0,0,${aOut}) 100%)`;
    return { WebkitMaskImage: g, maskImage: g };
  }
  if (m.invert) return {}; // 矩形反转预览从略（导出精确）
  const inset = `inset(${(m.y * 100).toFixed(2)}% ${((1 - m.x - m.w) * 100).toFixed(2)}% ${((1 - m.y - m.h) * 100).toFixed(2)}% ${(m.x * 100).toFixed(2)}%)`;
  return { clipPath: inset, WebkitClipPath: inset };
}

/** 暗角预览叠加层（近似 ffmpeg vignette；导出精确）。无暗角时返回 null（零回归）。 */
function vignetteOverlay(c: Clip): React.CSSProperties | null {
  const v = c.effects?.vignette;
  if (v == null || v <= 0) return null;
  const edge = Math.min(0.85, 0.22 + v * 0.6).toFixed(3); // 边角变暗强度随 v 提升
  return {
    position: "absolute", inset: 0, pointerEvents: "none", borderRadius: "inherit",
    background: `radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,${edge}) 100%)`,
  };
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
    ...(t?.vertical ? { writingMode: "vertical-rl" as const } : {}), // 竖排
  };
  // stroke (scaled to font via em so it tracks the preview zoom). paint-order:stroke
  // 让描边绘制在文字填充「之下」——否则居中描边会盖住字形、看起来粗一倍（用户反馈
  // 「描边 1 也太粗」）。改成真正的外描边后，同样的数值看起来细得多、更接近导出效果。
  // 颜色支持 8 位十六进制(#RRGGBBAA) / rgba()，故透明度直接由颜色字符串带过来。
  if (stroke > 0) {
    (css as Record<string, unknown>).WebkitTextStroke = `${(stroke / size).toFixed(3)}em ${t?.strokeColor ?? "#000"}`;
    (css as Record<string, unknown>).paintOrder = "stroke";
  }
  if (t?.shadow) css.textShadow = `0 0.05em 0.12em ${t?.shadowColor ?? "rgba(0,0,0,0.65)"}`;
  return css;
}

/** Fade-in/out opacity multiplier for a clip at `tInto` seconds from its start
 *  (0..1). Mirrors the export's picture/alpha fade so the preview matches WYSIWYG. */
function clipFadeOpacity(c: Clip, tInto: number, dur: number): number {
  let o = 1;
  if (c.fadeIn && c.fadeIn > 0 && tInto < c.fadeIn) o = Math.min(o, Math.max(0, tInto / c.fadeIn));
  if (c.fadeOut && c.fadeOut > 0 && tInto > dur - c.fadeOut) o = Math.min(o, Math.max(0, (dur - tInto) / c.fadeOut));
  return o;
}

/** Live preview of a text clip's entrance motion at `tInto` seconds from its
 *  start — mirrors the export ASS (\move / \fad / \t scale) over the first ~0.35s
 *  so scrubbing the playhead演示 the animation (WYSIWYG). */
function textMotionPreview(motion: string | undefined, tInto: number): { opacity: number; transform: string } {
  const MD = 0.35;
  if (!motion || motion === "none" || tInto < 0 || tInto >= MD) return { opacity: 1, transform: "" };
  const e = applyEase(tInto / MD, "out");
  switch (motion) {
    case "fade": case "bounce": case "karaoke": return { opacity: e, transform: "" };
    case "slideup": return { opacity: e, transform: `translateY(${((1 - e) * 40).toFixed(1)}px)` };
    case "slidedown": return { opacity: e, transform: `translateY(${(-(1 - e) * 40).toFixed(1)}px)` };
    case "pop": return { opacity: e, transform: `scale(${(0.4 + 0.6 * e).toFixed(3)})` };
    case "roll": return { opacity: e, transform: `translateY(${((1 - e) * 120).toFixed(1)}px)` };
    default: return { opacity: 1, transform: "" };
  }
}

/** 打字机：在 `tInto` 秒已显现的字符数（与导出 ASS 同节奏 ~60ms/字、压到片段时长 80% 内）。 */
function typewriterVisibleCount(content: string, tInto: number, clipDur: number, cps?: number): number {
  const chars = Array.from(content);
  if (chars.length === 0) return 0;
  const perCps = 1 / Math.max(1, Math.min(60, cps ?? 16));
  const per = Math.min(perCps, (Math.max(0, clipDur) * 0.9) / chars.length);
  if (tInto < 0) return 0;
  if (per <= 0) return chars.length;
  return Math.min(chars.length, Math.floor(tInto / per) + 1);
}

function activeAt(doc: EditorDoc, t: number): { clip: Clip; trackType: string; muted: boolean; trackVolume: number }[] {
  const out: { clip: Clip; trackType: string; muted: boolean; trackVolume: number }[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const c of track.clips) {
      if (t >= c.start && t < c.start + clipDuration(c)) out.push({ clip: c, trackType: track.type, muted: !!track.muted, trackVolume: track.volume ?? 1 });
    }
  }
  return out;
}

type DragState =
  | { mode: "move"; id: string; px: number; py: number; tf: ClipTransform; bw: number; bh: number }
  | { mode: "scale"; id: string; cx: number; cy: number; startW: number; startScale: number; aspect: number; kind: string; startSize: number }
  | { mode: "rotate"; id: string; cx: number; cy: number; start: number };

// Composition snap targets (normalized 0..1): edges, thirds, center.
const SNAP_TARGETS = [0, 1 / 3, 0.5, 2 / 3, 1];

// Vertical-platform UI-safe zones (fractions of the frame covered by the app's
// caption / buttons / nav). Keep key content inside the dashed safe rectangle.
const SAFE_ZONES: { id: string; label: string; top: number; bottom: number; left: number; right: number }[] = [
  { id: "tiktok", label: "抖音/TikTok", top: 0.06, bottom: 0.20, left: 0.02, right: 0.12 },
  { id: "reels",  label: "Reels",       top: 0.10, bottom: 0.22, left: 0.02, right: 0.13 },
  { id: "shorts", label: "YT Shorts",   top: 0.06, bottom: 0.14, left: 0.02, right: 0.14 },
  { id: "generic", label: "通用竖屏",    top: 0.08, bottom: 0.22, left: 0.03, right: 0.12 },
];
/** Snap one axis: try aligning the box's left/center/right (pos, pos+size/2, pos+size)
 *  to a target within `thr`. Returns the snapped position + the matched guide line. */
export function snapAxis(pos: number, size: number, thr: number): { pos: number; guide: number | null } {
  let best: { pos: number; guide: number; dist: number } | null = null;
  for (const anchor of [pos, pos + size / 2, pos + size]) {
    for (const g of SNAP_TARGETS) {
      const dist = Math.abs(anchor - g);
      if (dist < thr && (!best || dist < best.dist)) best = { pos: pos + (g - anchor), guide: g, dist };
    }
  }
  return best ? { pos: best.pos, guide: best.guide } : { pos, guide: null };
}

// Snap a width fraction to tidy sizes (25/33/50/66/75/100%) within `thr`.
const NICE_SCALES = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1];
export function snapScale(w: number, thr: number): number {
  let best = w, bestDist = thr;
  for (const s of NICE_SCALES) { const dist = Math.abs(w - s); if (dist < bestDist) { best = s; bestDist = dist; } }
  return best;
}

// Snap a rotation (degrees) to the nearest 15° increment within `thr` degrees.
export function snapAngle(deg: number, thr: number): number {
  const nearest = Math.round(deg / 15) * 15;
  return Math.abs(deg - nearest) <= thr ? nearest : deg;
}

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
  const [thirds, setThirds] = usePersistentState<boolean>("ui:editor:preview-thirds:v1", false, { validate: (p) => (typeof p === "boolean" ? p : null) });
  const [safeZone, setSafeZone] = usePersistentState<string>("ui:editor:preview-safezone:v1", "", { validate: (p) => (typeof p === "string" ? p : null) });
  // 自定义安全区（可拖动/缩放）。safeZone === "custom" 时用它，否则用 SAFE_ZONES 预设。
  const [safeRect, setSafeRect] = usePersistentState<{ top: number; bottom: number; left: number; right: number }>(
    "ui:editor:preview-saferect:v1", { top: 0.08, bottom: 0.22, left: 0.03, right: 0.12 },
    { validate: (p) => (p && typeof p === "object" && ["top", "bottom", "left", "right"].every((k) => typeof (p as Record<string, unknown>)[k] === "number") ? (p as { top: number; bottom: number; left: number; right: number }) : null) },
  );
  const [snapGuide, setSnapGuide] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const mediaRefs = useRef<Map<string, HTMLVideoElement | HTMLAudioElement>>(new Map());
  const stageRef = useRef<HTMLDivElement>(null);
  const frameWrapRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const docAspect = useEditorStore((s) => (s.doc && s.doc.height ? s.doc.width / s.doc.height : 16 / 9));
  // 预览框尺寸 = 把「画布比例」的盒子完整放进可用区域（letterbox）。用 JS 实测，避免
  // aspect-ratio + max-* 在「方形画布/宽容器」等组合下算错比例（1:1 被压成长方形）。
  useLayoutEffect(() => {
    const el = frameWrapRef.current; if (!el) return;
    const recompute = () => {
      const availW = Math.max(1, el.clientWidth - 32), availH = Math.max(1, el.clientHeight - 32); // 减 padding(16×2)
      let w = availW, h = availW / docAspect;
      if (h > availH) { h = availH; w = availH * docAspect; }
      setFrameSize({ w: Math.round(w), h: Math.round(h) });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [docAspect]);
  const mainRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 全屏：把整个预览区(含播放控件)送入浏览器全屏；监听变化以同步图标。
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else mainRef.current?.requestFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const dragRef = useRef<DragState | null>(null);
  const safeDragRef = useRef<{ mode: "move" | "nw" | "ne" | "sw" | "se"; sx: number; sy: number; start: { x: number; y: number; w: number; h: number } } | null>(null);
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
    for (const { clip, muted, trackVolume } of activeAt(doc, playhead)) {
      if (clip.kind !== "video" && clip.kind !== "audio") continue;
      active.add(clip.id);
      const el = mediaRefs.current.get(clip.id);
      if (!el) continue;
      const localSrc = clip.trimIn + (playhead - clip.start) * (clip.speed ?? 1);
      if (Math.abs(el.currentTime - localSrc) > 0.25) el.currentTime = localSrc;
      el.playbackRate = clip.speed ?? 1;
      // 预览音量 = 片段音量 × 轨道音量（HTML media 上限 1；导出可超过 1）。
      el.volume = muted ? 0 : Math.max(0, Math.min(1, (clip.volume ?? 1) * trackVolume));
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
      let nx = d.tf.x! + (e.clientX - d.px) / w;
      let ny = d.tf.y! + (e.clientY - d.py) / h;
      // snap edges/center to thirds/center/edges (hold Alt to bypass)
      if (!e.altKey) {
        const sx = snapAxis(nx, d.bw, 8 / w);
        const sy = snapAxis(ny, d.bh, 8 / h);
        nx = sx.pos; ny = sy.pos;
        setSnapGuide({ x: sx.guide, y: sy.guide });
      } else {
        setSnapGuide({ x: null, y: null });
      }
      updateClip(d.id, { transform: { ...d.tf, x: Math.max(-0.5, Math.min(1, nx)), y: Math.max(-0.5, Math.min(1, ny)) } });
    } else if (d.mode === "scale") {
      const distX = Math.abs(e.clientX - left - d.cx);
      let newW = Math.max(0.04, (distX * 2) / w);                // width fraction (symmetric from center)
      if (!e.altKey) newW = snapScale(newW, 0.02);               // snap to tidy sizes (Alt bypasses)
      const newH = newW / d.aspect;                              // height fraction (keep box aspect)
      const cxFrac = d.cx / w, cyFrac = d.cy / h;
      const st = useEditorStore.getState();
      const cur = findClip(st.doc, d.id);
      const pos = { x: cxFrac - newW / 2, y: cyFrac - newH / 2 };
      if (d.kind === "shape") {
        // 形状：拖动手柄改 shape.w/h（保持形状比例），位置随之居中。
        updateClip(d.id, { shape: { ...(cur?.shape ?? { type: "rect" }), w: newW, h: newH } as NonNullable<Clip["shape"]>, transform: { ...(cur?.transform ?? {}), ...pos } });
      } else if (d.kind === "text") {
        // 文字：拖动手柄同时缩放字号（按宽度比例）+ 文本框宽度，所见即所得。
        const ratio = newW / Math.max(0.001, d.startW);
        const newSize = Math.max(6, Math.round(d.startSize * ratio));
        updateClip(d.id, { transform: { ...(cur?.transform ?? {}), scale: newW, ...pos }, text: { ...(cur?.text ?? { content: "" }), size: newSize } as NonNullable<Clip["text"]> });
      } else {
        updateClip(d.id, { transform: { ...(cur?.transform ?? {}), scale: newW, ...pos } });
      }
    } else if (d.mode === "rotate") {
      let ang = Math.round(Math.atan2(e.clientY - top - d.cy, e.clientX - left - d.cx) * 180 / Math.PI + 90);
      if (!e.altKey) ang = snapAngle(ang, 6);                    // snap to 15° steps (Alt bypasses)
      updateClip(d.id, { transform: { ...(findClip(useEditorStore.getState().doc, d.id)?.transform ?? {}), rotation: ang } });
    }
  }, [updateClip]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setSnapGuide({ x: null, y: null });
    window.removeEventListener("pointermove", onWinMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onWinMove]);

  const beginMove = useCallback((e: React.PointerEvent, clip: Clip) => {
    e.stopPropagation(); selectClip(clip.id);
    const tf = { x: clip.transform?.x ?? 0.1, y: clip.transform?.y ?? 0.1, scale: clip.transform?.scale ?? 0.4, rotation: clip.transform?.rotation ?? 0, opacity: clip.transform?.opacity ?? 1 };
    // capture the box's normalized size for edge/center snapping
    const { w, h } = stageSize();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = { mode: "move", id: clip.id, px: e.clientX, py: e.clientY, tf, bw: r.width / w, bh: r.height / h };
    window.addEventListener("pointermove", onWinMove); window.addEventListener("pointerup", endDrag);
  }, [selectClip, onWinMove, endDrag]);

  const beginScale = useCallback((e: React.PointerEvent, clip: Clip, boxEl: HTMLElement | null) => {
    e.stopPropagation(); e.preventDefault();
    const { left, top, w } = stageSize();
    const r = boxEl?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2 - left, cy = r.top + r.height / 2 - top;
    const aspect = r.width / Math.max(1, r.height);
    dragRef.current = { mode: "scale", id: clip.id, cx, cy, startW: r.width / w, startScale: clip.transform?.scale ?? 0.4, aspect, kind: clip.kind, startSize: clip.text?.size ?? 48 };
    window.addEventListener("pointermove", onWinMove); window.addEventListener("pointerup", endDrag);
  }, [onWinMove, endDrag]);

  const beginRotate = useCallback((e: React.PointerEvent, clip: Clip, boxEl: HTMLElement | null) => {
    e.stopPropagation(); e.preventDefault();
    const { left, top } = stageSize();
    const r = boxEl?.getBoundingClientRect(); if (!r) return;
    dragRef.current = { mode: "rotate", id: clip.id, cx: r.left + r.width / 2 - left, cy: r.top + r.height / 2 - top, start: clip.transform?.rotation ?? 0 };
    window.addEventListener("pointermove", onWinMove); window.addEventListener("pointerup", endDrag);
  }, [onWinMove, endDrag]);

  // ── 安全区拖动 / 缩放（边框拖动=移动，四角=缩放；内部仍可点选片段）──
  const onSafeMove = useCallback((e: PointerEvent) => {
    const d = safeDragRef.current; if (!d) return;
    const { w, h } = stageSize();
    setSafeRect(computeSafeRect(d.start, d.mode, (e.clientX - d.sx) / w, (e.clientY - d.sy) / h));
  }, [setSafeRect]);
  const endSafeDrag = useCallback(() => {
    safeDragRef.current = null;
    window.removeEventListener("pointermove", onSafeMove);
    window.removeEventListener("pointerup", endSafeDrag);
  }, [onSafeMove]);
  const beginSafeDrag = useCallback((e: React.PointerEvent, mode: "move" | "nw" | "ne" | "sw" | "se", rect: { top: number; bottom: number; left: number; right: number }) => {
    e.stopPropagation(); e.preventDefault();
    // 拖动预设安全区时，原地转为「自定义」并以当前矩形为起点，之后可自由移动/缩放。
    if (safeZone !== "custom") { setSafeRect({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }); setSafeZone("custom"); }
    safeDragRef.current = { mode, sx: e.clientX, sy: e.clientY, start: { x: rect.left, y: rect.top, w: 1 - rect.left - rect.right, h: 1 - rect.top - rect.bottom } };
    window.addEventListener("pointermove", onSafeMove); window.addEventListener("pointerup", endSafeDrag);
  }, [safeZone, setSafeRect, setSafeZone, onSafeMove, endSafeDrag]);

  if (!doc) return null;
  const visible = activeAt(doc, playhead);
  const aspect = doc.width / doc.height;
  // 整片首尾淡入淡出的黑场不透明度（预览与导出一致）
  const masterFadeOpacity = (() => {
    const fi = doc.masterFadeIn ?? 0, fo = doc.masterFadeOut ?? 0;
    let o = 0;
    if (fi > 0 && playhead < fi) o = Math.max(o, 1 - playhead / fi);
    if (fo > 0 && duration > 0 && playhead > duration - fo) o = Math.max(o, 1 - (duration - playhead) / fo);
    return Math.max(0, Math.min(1, o));
  })();

  // Cross-dissolve preview: when the playhead is in the last `d` seconds before an
  // adjacent main-track clip that has a transitionIn, crossfade the outgoing clip
  // out and the incoming clip in (opacity approximation of the export's xfade).
  const fade = new Map<string, number>();
  const incoming: { clip: Clip; trackType: string; muted: boolean }[] = [];
  for (const track of doc.tracks) {
    if (track.type !== "video" || track.hidden) continue;
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < clips.length; i++) {
      const A = clips[i - 1], B = clips[i];
      const d = B.transitionIn?.duration ?? 0;
      if (!B.transitionIn || B.transitionIn.type === "none" || d <= 0) continue;
      if (Math.abs(B.start - (A.start + clipDuration(A))) > 0.05) continue; // not adjacent
      const winStart = B.start - d;
      if (playhead >= winStart && playhead < B.start) {
        const p = Math.max(0, Math.min(1, (playhead - winStart) / d));
        fade.set(A.id, 1 - p);
        fade.set(B.id, p);
        incoming.push({ clip: B, trackType: "video", muted: true }); // B not active yet
      }
    }
  }
  const renderList = incoming.length ? [...visible, ...incoming] : visible;
  const fadeOf = (id: string) => fade.get(id) ?? 1;

  // The selected main-track visual clip whose framing the 适配 buttons control.
  let fitClip: Clip | null = null;
  if (selectedClipId) {
    for (const tr of doc.tracks) {
      if (tr.type !== "video") continue;
      const c = tr.clips.find((x) => x.id === selectedClipId && (x.kind === "video" || x.kind === "image"));
      if (c) { fitClip = c; break; }
    }
  }
  const FIT_MODES: [FitMode, string][] = [["contain", "维持比例"], ["cover", "撑满"], ["stretch", "拉伸"], ["blur", "模糊填充"], ["none", "原始1:1"]];
  const fitBtn = (active: boolean): React.CSSProperties => ({
    padding: "3px 9px", fontSize: 11, borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${active ? EC.accent : EC.border}`, background: active ? EC.accentSoft : "transparent", color: active ? EC.accent : EC.t2,
  });

  return (
    <main ref={mainRef} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--c-canvas, #0c0c10)" }}>
      {/* preview toolbar: export-frame readout + thirds guide + per-clip 适配 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", flexShrink: 0, borderBottom: `1px solid ${EC.border}` }}>
        <span title="最终导出画面比例与分辨率（画布设置）" style={{ fontSize: 11, color: EC.t3, fontVariantNumeric: "tabular-nums" }}>
          {doc.width}×{doc.height} · {ratioLabel(doc.width, doc.height)}
        </span>
        <div style={{ flex: 1 }} />
        {fitClip && (
          <>
            <span style={{ fontSize: 11, color: EC.t4 }}>适配</span>
            {FIT_MODES.map(([v, label]) => (
              <button key={v} title={`将选中素材：${label}（整屏适配）`} style={fitBtn((fitClip!.fit ?? "contain") === v)} onClick={() => updateClip(fitClip!.id, { fit: v, transform: undefined, keyframes: undefined })}>{label}</button>
            ))}
            <span style={{ width: 1, height: 16, background: EC.border, margin: "0 2px" }} />
          </>
        )}
        <button title="三分参考线（构图辅助）" onClick={() => setThirds((v) => !v)}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, ...fitBtn(thirds) }}>
          <Grid3x3 size={12} /> 参考线
        </button>
        <button title="竖屏平台安全区：标出抖音/Reels/Shorts 等界面遮挡区，把关键内容留在虚线框内。点击切换平台预设；直接拖动虚线框边可移动、拖四角可缩放（转为「自定义」）"
          onClick={() => { const idx = SAFE_ZONES.findIndex((z) => z.id === safeZone); setSafeZone(idx + 1 >= SAFE_ZONES.length ? "" : SAFE_ZONES[idx + 1].id); }}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, ...fitBtn(!!safeZone) }}>
          安全区{safeZone ? "·" + (safeZone === "custom" ? "自定义" : SAFE_ZONES.find((z) => z.id === safeZone)?.label ?? "") : ""}
        </button>
        <button title={isFullscreen ? "退出全屏 (Esc)" : "全屏预览"} onClick={toggleFullscreen}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, ...fitBtn(isFullscreen) }}>
          {isFullscreen ? <Minimize size={12} /> : <Maximize size={12} />} 全屏
        </button>
      </div>
      <div ref={frameWrapRef} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, minHeight: 0, overflow: "hidden" }}>
        <div ref={stageRef} onPointerDown={() => selectClip(null)} onContextMenu={(e) => e.preventDefault()}
          style={{ position: "relative", width: frameSize.w || undefined, height: frameSize.h || undefined, aspectRatio: frameSize.w ? undefined : `${aspect}`, background: "#000", borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 32px oklch(0 0 0 / 0.5)", outline: `1px solid ${EC.border}`, outlineOffset: -1 }}>
          {/* 内层尺寸容器：让文字 cqh 单位按「舞台高度」解析（=导出画布高度等比）。container-type
              不能放在带 aspect-ratio 的外框上——尺寸containment 会破坏按比例自适应（1:1 变长方形）。
              内层 inset:0 充满外框、不带 aspect-ratio，既给 cqh 上下文又不影响外框比例。 */}
          <div style={{ position: "absolute", inset: 0, containerType: "size" } as React.CSSProperties}>
          {renderList.map(({ clip, trackType }) => {
            const hasKf = !!clip.keyframes && clip.keyframes.length > 0;
            const tf = hasKf ? transformAt(clip, playhead - clip.start) : clip.transform;
            // Main-track (video) clips are ALWAYS full-frame; their transform means
            // zoom(scale≥1)/pan within the frame (matches the export). Overlay-track
            // clips stay positioned PiP boxes.
            const fullFrame = trackType === "video";
            const selected = clip.id === selectedClipId;
            const xfade = fadeOf(clip.id);
            const fadeMul = clipFadeOpacity(clip, playhead - clip.start, clipDuration(clip)); // 片段淡入淡出（预览=透明度，导出=画面/alpha 渐变）
            // 镜像/翻转：最右(最内)应用，与导出在 pre 阶段先 hflip/vflip 一致
            const flipFrag = `${clip.flipH ? " scaleX(-1)" : ""}${clip.flipV ? " scaleY(-1)" : ""}`;
            // zoom/pan CSS for a full-frame clip that has a transform — same clamp
            // as the export: pan only once zoomed (scale≥1), bounded to the room.
            let mainTransform: string | undefined;
            if (fullFrame && tf) {
              const s = Math.max(1, tf.scale ?? 1);
              const maxFrac = (s - 1) / 2;
              const px = Math.max(-maxFrac, Math.min(maxFrac, tf.x ?? 0));
              const py = Math.max(-maxFrac, Math.min(maxFrac, tf.y ?? 0));
              mainTransform = `translate(${(px * 100).toFixed(2)}%, ${(py * 100).toFixed(2)}%) scale(${s.toFixed(3)}) rotate(${tf.rotation ?? 0}deg)${flipFrag}`;
            } else if (fullFrame && flipFrag) {
              mainTransform = flipFrag.trim(); // 仅翻转、无其它变换
            }
            const mainOpacity = xfade * fadeMul * (fullFrame && tf ? (tf.opacity ?? 1) : 1);
            const objFit: React.CSSProperties["objectFit"] = fullFrame
              ? (clip.fit === "cover" ? "cover" : clip.fit === "stretch" ? "fill" : clip.fit === "none" ? "none" : "contain")
              : "cover";

            if (fullFrame) {
              // main full-frame clip — click to select; sizing via 画面适配 + zoom/pan
              const common = { onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); selectClip(clip.id); } };
              // width/height:100% are REQUIRED — without them a replaced element
              // (img/video) keeps its intrinsic size under inset:0, so object-fit
              // (contain/cover/stretch) has nothing to fit into and the media sits
              // un-centered at its native size.
              const st: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: objFit, opacity: mainOpacity, transform: mainTransform, transformOrigin: "center", filter: cssFilter(clip), outline: selected ? `2px solid ${EC.accent}` : "none", outlineOffset: -2 };
              // 模糊填充：近似预览 = 模糊放大的同画面铺满作背景 + 原画完整居中（导出由后端为准）
              if (clip.fit === "blur") {
                const bg: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(22px) brightness(0.85)", transform: "scale(1.12)", pointerEvents: "none" };
                const fg: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", filter: cssFilter(clip), outline: selected ? `2px solid ${EC.accent}` : "none", outlineOffset: -2 };
                return (
                  <div key={clip.id} style={{ position: "absolute", inset: 0, opacity: mainOpacity, transform: mainTransform, transformOrigin: "center" }}>
                    {clip.kind === "image" ? (
                      <><img src={clip.assetUrl} alt="" style={bg} /><img {...common} src={clip.assetUrl} alt="" style={fg} /></>
                    ) : (
                      <><video src={clip.assetUrl} muted autoPlay loop playsInline style={bg} /><video {...common} ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }} src={clip.assetUrl} playsInline style={fg} /></>
                    )}
                  </div>
                );
              }
              const vig = vignetteOverlay(clip);
              const media = clip.kind === "image"
                ? <img {...common} src={clip.assetUrl} alt="" style={st} />
                : clip.kind === "video"
                ? <video {...common} ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }} src={clip.assetUrl} playsInline style={st} />
                : null;
              if (!media) return null;
              if (!vig) return <Fragment key={clip.id}>{media}</Fragment>;
              return <Fragment key={clip.id}>{media}<div style={vig} /></Fragment>;
            }

            // positioned (overlay / PiP / text / shape) — interactive box with handles.
            // 文字片段叠加入场动效（按播放头实时演示，与导出 ASS 同步）。
            const tmo = clip.kind === "text" ? textMotionPreview(clip.text?.motionStyle, playhead - clip.start) : { opacity: 1, transform: "" };
            const isShape = clip.kind === "shape";
            // 片尾滚动：整段文字在本片段时长内从画面底部下方(top 100%)持续上滚至顶部上方
            // (top -100%)，用相对舞台的 % 定位（与导出 \move 从 H→-H 一致）。
            const isCredits = clip.kind === "text" && clip.text?.motionStyle === "credits";
            const creditsP = isCredits ? Math.min(1, Math.max(0, (playhead - clip.start) / Math.max(0.01, clipDuration(clip)))) : 0;
            const sh = clip.shape;
            const boxStyle: React.CSSProperties = {
              position: "absolute",
              left: `${(tf?.x ?? 0.1) * 100}%`, top: isCredits ? `${(100 - creditsP * 200).toFixed(1)}%` : `${(tf?.y ?? 0.1) * 100}%`,
              width: isShape ? `${(sh?.w ?? 0.3) * 100}%` : `${(tf?.scale ?? 0.4) * 100}%`,
              ...(isShape ? { height: `${(sh?.h ?? 0.2) * 100}%`, boxSizing: "border-box" as const } : {}),
              opacity: (tf?.opacity ?? 1) * xfade * fadeMul * tmo.opacity * (isShape ? (sh?.opacity ?? 1) : 1),
              transform: `${tmo.transform} rotate(${tf?.rotation ?? 0}deg)${flipFrag}`,
              cursor: "move", touchAction: "none",
              outline: selected ? `2px solid ${EC.accent}` : "none",
            };
            return (
              <div key={clip.id} data-clip-box={clip.id} style={boxStyle}
                onPointerDown={(e) => beginMove(e, clip)}>
                {clip.kind === "text" ? (
                  <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: clip.text?.align === "left" ? "flex-start" : clip.text?.align === "right" ? "flex-end" : "center", textAlign: clip.text?.align ?? "center", pointerEvents: "none" }}>
                    <span style={textCss(clip.text, doc.height)}>{clip.text?.motionStyle === "typewriter"
                      ? Array.from(clip.text?.content ?? "").slice(0, typewriterVisibleCount(clip.text?.content ?? "", playhead - clip.start, clipDuration(clip), clip.text?.typewriterCps)).join("")
                      : clip.text?.content}</span>
                  </div>
                ) : clip.kind === "image" ? (
                  <img src={clip.assetUrl} alt="" draggable={false} style={{ width: "100%", height: "auto", display: "block", filter: cssFilter(clip), pointerEvents: "none", ...maskCss(clip.mask) }} />
                ) : clip.kind === "video" ? (
                  <video ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }} src={clip.assetUrl} playsInline muted={false} style={{ width: "100%", height: "auto", display: "block", filter: cssFilter(clip), pointerEvents: "none", ...maskCss(clip.mask) }} />
                ) : isShape && sh ? (
                  <img src={shapeToDataUrl(sh, 600, Math.max(1, Math.round(600 * (sh.h ?? 0.2) / (sh.w ?? 0.3))))} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none", objectFit: "fill" }} />
                ) : null}

                {!isShape && clip.kind !== "text" && vignetteOverlay(clip) && <div style={vignetteOverlay(clip)!} />}
                {selected && <SelectionHandles clip={clip} onScale={beginScale} onRotate={beginRotate} />}
              </div>
            );
          })}

          {visible.filter(({ clip }) => clip.kind === "audio").map(({ clip }) => (
            <audio key={clip.id} ref={(el) => { if (el) mediaRefs.current.set(clip.id, el); else mediaRefs.current.delete(clip.id); }} src={clip.assetUrl} />
          ))}
          {visible.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: EC.t4, fontSize: 13, pointerEvents: "none" }}>把素材拖到时间轴开始剪辑</div>}

          {/* rule-of-thirds composition guides (overlay; never intercepts pointers) */}
          {thirds && (
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 9 }}>
              {[1 / 3, 2 / 3].map((f) => (
                <div key={`v${f}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${f * 100}%`, width: 1, background: "oklch(1 0 0 / 0.28)" }} />
              ))}
              {[1 / 3, 2 / 3].map((f) => (
                <div key={`h${f}`} style={{ position: "absolute", left: 0, right: 0, top: `${f * 100}%`, height: 1, background: "oklch(1 0 0 / 0.28)" }} />
              ))}
            </div>
          )}

          {/* vertical-platform UI-safe zone: dim the covered margins; dashed box is
              draggable (edges = move, corners = resize). Interior stays click-through
              so clips beneath remain selectable/movable. */}
          {safeZone && (() => {
            const z = safeZone === "custom" ? safeRect : SAFE_ZONES.find((s) => s.id === safeZone);
            if (!z) return null;
            const dim = "oklch(0 0 0 / 0.34)";
            const GRN = "oklch(0.86 0.17 145 / 0.95)";
            const box: React.CSSProperties = { position: "absolute", top: `${z.top * 100}%`, bottom: `${z.bottom * 100}%`, left: `${z.left * 100}%`, right: `${z.right * 100}%` };
            const cBase: React.CSSProperties = { position: "absolute", width: 13, height: 13, background: GRN, border: "1.5px solid #06281a", borderRadius: 3, pointerEvents: "auto" };
            return (
              <>
                {/* dim margins + dashed frame (click-through) */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 9 }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${z.top * 100}%`, background: dim }} />
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${z.bottom * 100}%`, background: dim }} />
                  <div style={{ position: "absolute", top: `${z.top * 100}%`, bottom: `${z.bottom * 100}%`, left: 0, width: `${z.left * 100}%`, background: dim }} />
                  <div style={{ position: "absolute", top: `${z.top * 100}%`, bottom: `${z.bottom * 100}%`, right: 0, width: `${z.right * 100}%`, background: dim }} />
                  <div style={{ ...box, border: `1px dashed ${GRN}` }} />
                </div>
                {/* interactive handles: edges move, corners resize (rest is click-through) */}
                <div style={{ ...box, pointerEvents: "none", zIndex: 11 }}>
                  <div title="拖动边框移动安全区" onPointerDown={(e) => beginSafeDrag(e, "move", z)} style={{ position: "absolute", top: -4, left: 6, right: 6, height: 9, cursor: "move", pointerEvents: "auto" }} />
                  <div title="拖动边框移动安全区" onPointerDown={(e) => beginSafeDrag(e, "move", z)} style={{ position: "absolute", bottom: -4, left: 6, right: 6, height: 9, cursor: "move", pointerEvents: "auto" }} />
                  <div title="拖动边框移动安全区" onPointerDown={(e) => beginSafeDrag(e, "move", z)} style={{ position: "absolute", left: -4, top: 6, bottom: 6, width: 9, cursor: "move", pointerEvents: "auto" }} />
                  <div title="拖动边框移动安全区" onPointerDown={(e) => beginSafeDrag(e, "move", z)} style={{ position: "absolute", right: -4, top: 6, bottom: 6, width: 9, cursor: "move", pointerEvents: "auto" }} />
                  <div title="拖动缩放" onPointerDown={(e) => beginSafeDrag(e, "nw", z)} style={{ ...cBase, left: -6, top: -6, cursor: "nwse-resize" }} />
                  <div title="拖动缩放" onPointerDown={(e) => beginSafeDrag(e, "ne", z)} style={{ ...cBase, right: -6, top: -6, cursor: "nesw-resize" }} />
                  <div title="拖动缩放" onPointerDown={(e) => beginSafeDrag(e, "sw", z)} style={{ ...cBase, left: -6, bottom: -6, cursor: "nesw-resize" }} />
                  <div title="拖动缩放" onPointerDown={(e) => beginSafeDrag(e, "se", z)} style={{ ...cBase, right: -6, bottom: -6, cursor: "nwse-resize" }} />
                </div>
              </>
            );
          })()}

          {/* live alignment guides while dragging an overlay into snap */}
          {snapGuide.x != null && (
            <div data-snap-guide="x" style={{ position: "absolute", top: 0, bottom: 0, left: `${snapGuide.x * 100}%`, width: 1, background: EC.accent, boxShadow: `0 0 4px ${EC.accent}`, pointerEvents: "none", zIndex: 10 }} />
          )}
          {snapGuide.y != null && (
            <div data-snap-guide="y" style={{ position: "absolute", left: 0, right: 0, top: `${snapGuide.y * 100}%`, height: 1, background: EC.accent, boxShadow: `0 0 4px ${EC.accent}`, pointerEvents: "none", zIndex: 10 }} />
          )}
          {/* 整片首尾淡入淡出：覆盖整台的黑场，按播放头实时演示（与导出一致） */}
          {masterFadeOpacity > 0.001 && (
            <div style={{ position: "absolute", inset: 0, background: "#000", opacity: masterFadeOpacity, pointerEvents: "none", zIndex: 20 }} />
          )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 0", borderTop: `1px solid ${EC.border}` }}>
        <button onClick={() => { setPlaying(false); setPlayhead(0); }} title="回到开头 (Home)" style={transBtn}><SkipBack size={16} /></button>
        <button onClick={() => setPlaying(!playing)} title={playing ? "暂停 (空格)" : "播放 (空格)"} style={{ ...transBtn, background: EC.accent, color: "#fff", width: 38, height: 38 }}>
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
