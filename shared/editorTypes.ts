// ── Video Editor EDL (Edit Decision List) ────────────────────────────────────
// The front-end timeline editor produces an `EditorDoc`; the server renders it
// in a SINGLE ffmpeg `-filter_complex` pass on export, so chaining many edits no
// longer re-encodes repeatedly (the core reason for the dedicated editor).
//
// All time values are in seconds. Positions/sizes for overlays are normalized
// (0..1) relative to the output canvas so the EDL is resolution-independent.

export const EDITOR_DOC_VERSION = 1 as const;

export type TrackType = "video" | "audio" | "text" | "overlay";
export type ClipKind = "video" | "image" | "audio" | "text";

export type TransitionType = "none" | "fade" | "dissolve" | "slide" | "wipe";

/** How a visual clip fills the output frame.
 *  contain = 适应（完整显示，留黑边）; cover = 填充（铺满，裁剪溢出）; stretch = 拉伸（变形铺满）. */
export type FitMode = "contain" | "cover" | "stretch";

/** Preset color/filter adjustments applied to a visual clip. */
export interface ClipEffects {
  brightness?: number;  // -1..1   (ffmpeg eq brightness)
  contrast?: number;    // 0..2    (eq contrast, 1 = neutral)
  saturation?: number;  // 0..3    (eq saturation, 1 = neutral)
  filter?: string;      // named LUT/preset, e.g. "cinematic" | "vintage" | "cool" | "warm"
}

/** Position/size for overlay/PiP/text clips, normalized to the output canvas. */
export interface ClipTransform {
  x?: number;        // 0..1, left edge (0 = left, fraction of width)
  y?: number;        // 0..1, top edge
  scale?: number;    // 0..1+ relative to canvas (1 = full width)
  opacity?: number;  // 0..1
  rotation?: number; // degrees
}

export interface ClipText {
  content: string;
  font?: string;
  size?: number;        // px at output resolution
  color?: string;       // CSS color
  bgColor?: string;     // optional text background box
  motionStyle?: "none" | "fade" | "roll" | "karaoke" | "bounce";
}

export interface Clip {
  id: string;
  kind: ClipKind;
  assetId?: number;
  assetUrl?: string;        // source media URL (own-storage or external)
  start: number;            // position on the timeline (seconds)
  trimIn: number;           // source in-point (seconds)
  trimOut: number;          // source out-point (seconds); for image/text = display duration from start
  speed?: number;           // 0.25..4, default 1
  volume?: number;          // 0..2, default 1 (audio/video)
  fadeIn?: number;          // seconds
  fadeOut?: number;         // seconds
  transitionIn?: { type: TransitionType; duration: number };
  effects?: ClipEffects;
  transform?: ClipTransform;
  fit?: FitMode;            // how a full-frame visual clip fills the canvas (default contain)
  text?: ClipText;
}

export interface Track {
  id: string;
  type: TrackType;
  muted?: boolean;
  hidden?: boolean;
  clips: Clip[];
}

export interface EditorDoc {
  version: typeof EDITOR_DOC_VERSION;
  width: number;   // output canvas width  (e.g. 1080)
  height: number;  // output canvas height (e.g. 1920)
  fps: number;     // output fps (e.g. 30)
  tracks: Track[];
}

/** A sensible empty document for a freshly created editor session. */
export function emptyEditorDoc(width = 1920, height = 1080, fps = 30): EditorDoc {
  return {
    version: EDITOR_DOC_VERSION,
    width,
    height,
    fps,
    tracks: [
      { id: "v1", type: "video", clips: [] },
      { id: "ov1", type: "overlay", clips: [] },
      { id: "t1", type: "text", clips: [] },
      { id: "a1", type: "audio", clips: [] },
    ],
  };
}

/** Total timeline duration (seconds) = furthest clip end across all tracks. */
export function editorDocDuration(doc: EditorDoc): number {
  let max = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      const dur = Math.max(0, (clip.trimOut - clip.trimIn)) / (clip.speed ?? 1);
      max = Math.max(max, clip.start + dur);
    }
  }
  return max;
}

export interface EditSessionSummary {
  id: number;
  name: string;
  projectId: number | null;
  thumbnailUrl: string | null;
  updatedAt: string | Date;
  createdAt: string | Date;
}
