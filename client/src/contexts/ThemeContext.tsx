import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme =
  | "dark" | "dim" | "midnight"
  | "forest" | "rose" | "ocean"
  | "light" | "warm" | "mint" | "lavender" | "paper";

export interface ThemeMeta {
  id: Theme;
  label: string;
  /** canvas background color for the swatch preview */
  canvas: string;
  /** surface / overlay color for the inner dot preview */
  surface: string;
  /** whether this theme uses the dark Tailwind class */
  dark: boolean;
}

export const THEMES: ThemeMeta[] = [
  { id: "dark",     label: "暗色", canvas: "oklch(0.07 0.005 260)",  surface: "oklch(0.22 0.008 260)",  dark: true  },
  { id: "dim",      label: "柔暗", canvas: "oklch(0.16 0.009 260)",  surface: "oklch(0.35 0.010 260)",  dark: true  },
  { id: "midnight", label: "午夜", canvas: "oklch(0.07 0.012 260)",  surface: "oklch(0.24 0.014 260)",  dark: true  },
  { id: "forest",   label: "深林", canvas: "oklch(0.068 0.018 150)", surface: "oklch(0.230 0.018 150)", dark: true  },
  { id: "rose",     label: "玫瑰", canvas: "oklch(0.068 0.012 10)",  surface: "oklch(0.235 0.017 10)",  dark: true  },
  { id: "ocean",    label: "深海", canvas: "oklch(0.062 0.026 232)", surface: "oklch(0.222 0.028 232)", dark: true  },
  { id: "light",    label: "亮色", canvas: "oklch(0.950 0.004 255)", surface: "oklch(0.845 0.005 255)", dark: false },
  { id: "warm",     label: "暖白", canvas: "oklch(0.948 0.020 85)",  surface: "oklch(0.835 0.022 78)",  dark: false },
  { id: "mint",     label: "薄荷", canvas: "oklch(0.928 0.045 165)", surface: "oklch(0.815 0.055 165)", dark: false },
  { id: "lavender", label: "薰衣草", canvas: "oklch(0.925 0.040 295)", surface: "oklch(0.810 0.052 295)", dark: false },
  { id: "paper",    label: "经典", canvas: "oklch(0.928 0.006 80)",  surface: "oklch(0.792 0.008 80)",  dark: false },
];

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const legacy = localStorage.getItem("theme");
    if (legacy && !localStorage.getItem("avc:theme")) {
      try { localStorage.setItem("avc:theme", legacy); localStorage.removeItem("theme"); } catch { /* quota */ }
    }
    const stored = localStorage.getItem("avc:theme") as Theme;
    return THEMES.some((t) => t.id === stored) ? stored : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = THEMES.find((t) => t.id === theme);
    if (meta?.dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("avc:theme", theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
