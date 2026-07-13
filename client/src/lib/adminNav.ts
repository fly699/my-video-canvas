// Deep-linking into a specific Admin page tab.
//
// The Admin page keeps its active tab in local state, so a bare navigate("/admin")
// always lands on the default (whitelist) tab. To send the admin straight to a
// sub-page (e.g. the download-approval tab from a chat/notification "查看"), we:
//   1. navigate to /admin?tab=<tab> (so a fresh mount reads it from the URL), and
//   2. dispatch an event so an ALREADY-mounted Admin page switches immediately
//      (wouter's location is path-only, so a query-only change won't re-render it).

export const ADMIN_TABS = [
  "whitelist", "kie", "users", "logs", "comfyLogs", "llmLogs", "storage", "models", "chat", "comfyServers", "comfyStress", "comfyOps", "assets", "downloads", "tutorialImgs", "system", "config", "tunnel", "auth", "report", "intro", "perms",
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const ADMIN_TAB_EVENT = "admin:set-tab";

/** Read a valid admin tab from the current URL's ?tab= param (fallback: whitelist). */
export function adminTabFromUrl(): AdminTab {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (ADMIN_TABS as readonly string[]).includes(t)) return t as AdminTab;
  } catch { /* ignore */ }
  return "whitelist";
}

/** Navigate to the Admin page with a specific tab pre-selected. */
export function goToAdminTab(navigate: (to: string) => void, tab: AdminTab): void {
  navigate(`/admin?tab=${tab}`);
  // Switch an already-open Admin page (query-only change doesn't remount it).
  try { window.dispatchEvent(new CustomEvent(ADMIN_TAB_EVENT, { detail: tab })); } catch { /* ignore */ }
}
