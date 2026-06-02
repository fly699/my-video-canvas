// Shared visual constants for the video editor. Sticks to the app's CSS-var
// theme so it adapts to light/dark like the rest of the app.
export const EC = {
  accent: "oklch(0.65 0.19 310)",        // 剪辑器主色（品红紫）
  accentSoft: "oklch(0.65 0.19 310 / 0.15)",
  bg: "var(--c-bg, #0c0c10)",
  surface: "var(--c-surface, #14141a)",
  elevated: "var(--c-elevated, #1a1a20)",
  border: "var(--c-bd2, rgba(255,255,255,0.1))",
  t1: "var(--c-t1)",
  t2: "var(--c-t2)",
  t3: "var(--c-t3)",
  t4: "var(--c-t4)",
};

// Per-track-type tint, so clips read at a glance.
export function trackColor(type: string): string {
  switch (type) {
    case "video": return "oklch(0.62 0.20 25)";    // 红橙
    case "audio": return "oklch(0.68 0.20 145)";   // 绿
    case "text": return "oklch(0.70 0.16 250)";    // 蓝
    case "overlay": return "oklch(0.72 0.18 90)";  // 黄
    default: return "var(--c-t3)";
  }
}

export function trackLabel(type: string): string {
  switch (type) {
    case "video": return "视频";
    case "audio": return "音频";
    case "text": return "文字";
    case "overlay": return "叠加";
    default: return type;
  }
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec * 100) % 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Probe a media URL's intrinsic duration (seconds) client-side. */
export function probeMediaDuration(url: string, kind: "video" | "audio"): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "audio" ? "audio" : "video");
    el.preload = "metadata";
    el.muted = true;
    const done = (d: number) => { resolve(isFinite(d) && d > 0 ? d : 5); el.src = ""; };
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(5);
    el.src = url;
    // Safety timeout — never hang the UI.
    setTimeout(() => done(el.duration), 4000);
  });
}
