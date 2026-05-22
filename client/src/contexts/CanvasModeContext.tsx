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

export function CanvasModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<CanvasMode>(() => {
    const stored = localStorage.getItem("avc:canvas-mode");
    return stored === "creative" || stored === "professional" ? stored : "professional";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-canvas-mode", mode);
    localStorage.setItem("avc:canvas-mode", mode);
  }, [mode]);

  // Apply persisted value synchronously before first paint
  useEffect(() => {
    const stored = localStorage.getItem("avc:canvas-mode");
    const validated: CanvasMode = stored === "creative" || stored === "professional" ? stored : "professional";
    document.documentElement.setAttribute("data-canvas-mode", validated);
  }, []);

  return (
    <CanvasModeContext.Provider value={{ mode, setMode: setModeState }}>
      {children}
    </CanvasModeContext.Provider>
  );
}

export function useCanvasMode() {
  return useContext(CanvasModeContext);
}
