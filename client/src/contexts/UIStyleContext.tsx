import React, { createContext, useContext, useEffect, useState } from "react";

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
