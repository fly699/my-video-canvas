import React, { createContext, useContext, useEffect, useState } from "react";

export type CanvasMode = "professional" | "creative";

interface CanvasModeContextType {
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
}

const CanvasModeContext = createContext<CanvasModeContextType>({
  mode: "professional",
  setMode: () => {},
});

function readStoredMode(): CanvasMode {
  try {
    const stored = localStorage.getItem("avc:canvas-mode");
    return stored === "creative" || stored === "professional" ? stored : "professional";
  } catch {
    return "professional";
  }
}

export function CanvasModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<CanvasMode>(readStoredMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-canvas-mode", mode);
    try { localStorage.setItem("avc:canvas-mode", mode); } catch { /* restricted environment */ }
  }, [mode]);

  return (
    <CanvasModeContext.Provider value={{ mode, setMode: setModeState }}>
      {children}
    </CanvasModeContext.Provider>
  );
}

export function useCanvasMode() {
  return useContext(CanvasModeContext);
}
