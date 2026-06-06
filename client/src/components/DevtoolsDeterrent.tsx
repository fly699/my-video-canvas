import { useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Weak anti-leech DETERRENT (admin-toggled): blocks the context menu and common
 * devtools key shortcuts for non-admin users. This is NOT real security — it is
 * trivially bypassed (open devtools before the page, browser menu, disable JS,
 * proxy capture). It only raises the bar for casual users; admins are exempt so
 * they can still debug. Renders nothing; just attaches listeners while enabled.
 */
export function DevtoolsDeterrent() {
  const { user } = useAuth();
  const { data } = trpc.system.mediaProtection.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isAdmin = (user as { role?: string } | null)?.role === "admin";
  const active = !!user && !isAdmin && !!data?.devtoolsBlock;

  useEffect(() => {
    if (!active) return;
    const onContext = (e: MouseEvent) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const block =
        k === "F12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "I" || k === "J" || k === "C" || k === "i" || k === "j" || k === "c")) ||
        ((e.ctrlKey || e.metaKey) && (k === "U" || k === "u"));
      if (block) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active]);

  return null;
}
