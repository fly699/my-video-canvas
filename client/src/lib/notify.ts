// Browser Notification helpers — used to alert users when long-running
// generation tasks complete while the tab is backgrounded.

let permissionRequested = false;

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Best-effort permission request — safe to call multiple times. Resolves to
 * `true` only after the user grants permission. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  // Only prompt once per page load to avoid pestering the user.
  if (permissionRequested) return (Notification.permission as string) === "granted";
  permissionRequested = true;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

/** Show a desktop notification. Silently no-ops if permission isn't granted
 * or the page is currently focused (toast already handles that case). */
export function showCompletionNotification(opts: {
  title: string;
  body?: string;
  /** Stable string used as the Notification `tag` so repeated alerts for the
   * same task replace earlier ones rather than stacking. */
  tag?: string;
  /** When true, fire even if the tab is in the foreground. Default: false. */
  force?: boolean;
}): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== "granted") return;
  if (!opts.force && document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: "/favicon.png",
      // Auto-close so a forgotten notification doesn't linger
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    // Belt-and-suspenders close after 8s in case the browser doesn't auto-dismiss
    setTimeout(() => { try { n.close(); } catch { /* ignore */ } }, 8000);
  } catch {
    // Some browsers throw if the page was launched without a user gesture
  }
}

// ── Notification sound (self-contained WebAudio beep — no asset needed) ──────
let _audioCtx: AudioContext | null = null;
let _lastBeep = 0;
/** 播放一声轻提示音（两段短促上行音，类似 IM 到达音）。自带节流，避免消息刷屏时爆音。
 *  依赖用户此前的交互解锁 AudioContext；被浏览器 autoplay 策略拦截时静默失败。 */
export function playMessageSound(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - _lastBeep < 1500) return; // 1.5s 内不重复响
  _lastBeep = now;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!_audioCtx) _audioCtx = new Ctx();
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    const notes = [880, 1174.7]; // A5 → D6，轻快
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + i * 0.12;
      const dur = 0.13;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(start); osc.stop(start + dur);
    });
  } catch { /* autoplay blocked / no audio — 静默 */ }
}
