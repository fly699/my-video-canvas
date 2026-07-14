import React, { createContext, useContext, useEffect, useState } from "react";

export type CanvasMode = "professional" | "creative";
// 创意模式的明暗变体（仅创意模式生效）：dark=现有近黑皮肤；light=朴素浅色（不刺眼、防疲劳）。
export type CreativeTheme = "dark" | "light";

interface CanvasModeContextType {
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
  creativeTheme: CreativeTheme;
  setCreativeTheme: (t: CreativeTheme) => void;
  toggleCreativeTheme: () => void;
}

const CanvasModeContext = createContext<CanvasModeContextType>({
  mode: "creative",
  setMode: () => {},
  creativeTheme: "dark",
  setCreativeTheme: () => {},
  toggleCreativeTheme: () => {},
});

function readStoredMode(): CanvasMode {
  // 首次进入默认「创意」（LibTV 模式）——用户显式切换过则尊重其选择（localStorage）。
  try {
    const stored = localStorage.getItem("avc:canvas-mode");
    return stored === "creative" || stored === "professional" ? stored : "creative";
  } catch {
    return "creative";
  }
}

function readStoredCreativeTheme(): CreativeTheme {
  try {
    return localStorage.getItem("avc:creative-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function CanvasModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<CanvasMode>(readStoredMode);
  const [creativeTheme, setCreativeThemeState] = useState<CreativeTheme>(readStoredCreativeTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-canvas-mode", mode);
    try { localStorage.setItem("avc:canvas-mode", mode); } catch { /* restricted environment */ }
  }, [mode]);

  // data-canvas-theme 只在创意模式下参与配色（CSS 选择器带 [data-canvas-mode="creative"] 前缀）；
  // 专业模式下留着该属性无害。
  useEffect(() => {
    document.documentElement.setAttribute("data-canvas-theme", creativeTheme);
    try { localStorage.setItem("avc:creative-theme", creativeTheme); } catch { /* restricted */ }
  }, [creativeTheme]);

  return (
    <CanvasModeContext.Provider value={{
      mode, setMode: setModeState,
      creativeTheme, setCreativeTheme: setCreativeThemeState,
      toggleCreativeTheme: () => setCreativeThemeState((t) => (t === "light" ? "dark" : "light")),
    }}>
      {children}
    </CanvasModeContext.Provider>
  );
}

export function useCanvasMode() {
  return useContext(CanvasModeContext);
}
