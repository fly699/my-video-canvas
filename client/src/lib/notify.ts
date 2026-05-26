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
