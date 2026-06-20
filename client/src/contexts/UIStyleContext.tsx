import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

// Orthogonal to color theme (data-theme) and canvas mode (data-canvas-mode):
// the UI *style* selects which presentation skin renders the app —
//   "pro"    = the existing professional UI (unchanged).
//   "studio" = the new media-first "cinema studio" skin.
//   "simple" = a future light, beginner-friendly skin (reserved).
// Persisted to localStorage and applied as the document `data-ui` attribute so
// pure-CSS overrides ([data-ui="studio"] {…}) work without touching components.
// Logic stays single-sourced (Layer 1); skins are presentation only.
export type UIStyle = "pro" | "studio" | "simple";

interface UIStyleContextType {
  uiStyle: UIStyle;
  setUIStyle: (s: UIStyle) => void;
}

const UIStyleContext = createContext<UIStyleContextType>({
  uiStyle: "pro",
  setUIStyle: () => {},
});

function readStoredUIStyle(): UIStyle {
  try {
    const stored = localStorage.getItem("avc:ui-style");
    return stored === "studio" || stored === "simple" || stored === "pro" ? stored : "pro";
  } catch {
    return "pro";
  }
}

export function UIStyleProvider({ children }: { children: React.ReactNode }) {
  const [uiStyle, setUIStyleState] = useState<UIStyle>(readStoredUIStyle);

  useEffect(() => {
    document.documentElement.setAttribute("data-ui", uiStyle);
    try { localStorage.setItem("avc:ui-style", uiStyle); } catch { /* restricted environment */ }
  }, [uiStyle]);

  return (
    <UIStyleContext.Provider value={{ uiStyle, setUIStyle: setUIStyleState }}>
      {children}
    </UIStyleContext.Provider>
  );
}

export function useUIStyle() {
  return useContext(UIStyleContext);
}

// Cross-device persistence: hydrate the UI style from the user's server prefs on login
// (overriding the local default), then write it back whenever the user changes it. Pure
// side-effect component — render once inside both UIStyleProvider and the tRPC provider.
// Falls back silently to localStorage-only when unauthenticated.
export function UIStyleServerSync() {
  const { uiStyle, setUIStyle } = useUIStyle();
  const { isAuthenticated } = useAuth();
  const pref = trpc.userPrefs.get.useQuery({ key: "uiStyle" }, { enabled: isAuthenticated, staleTime: Infinity, refetchOnWindowFocus: false });
  const setPref = trpc.userPrefs.set.useMutation();
  const hydrated = useRef(false);

  // hydrate once from the server (server value wins over the local default)
  useEffect(() => {
    if (hydrated.current || !isAuthenticated || pref.data === undefined) return;
    hydrated.current = true;
    const v = pref.data?.value;
    if ((v === "pro" || v === "studio" || v === "simple") && v !== uiStyle) setUIStyle(v as UIStyle);
  }, [isAuthenticated, pref.data, uiStyle, setUIStyle]);

  // persist on user change (after hydration so we don't echo the hydrated value needlessly)
  useEffect(() => {
    if (!isAuthenticated || !hydrated.current) return;
    setPref.mutate({ key: "uiStyle", value: uiStyle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiStyle]);

  return null;
}
