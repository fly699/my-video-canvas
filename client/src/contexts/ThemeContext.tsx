import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light" | "dim" | "midnight";

export const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: "dark",     label: "暗色",   icon: "🌑" },
  { id: "dim",      label: "柔暗",   icon: "🌘" },
  { id: "midnight", label: "午夜",   icon: "🌌" },
  { id: "light",    label: "亮色",   icon: "☀️" },
];

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // One-time migration from the old key name used before the avc: namespace
    const legacy = localStorage.getItem("theme");
    if (legacy) { localStorage.setItem("avc:theme", legacy); localStorage.removeItem("theme"); }
    return (localStorage.getItem("avc:theme") as Theme) || "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    // keep .dark class for Tailwind dark: utilities
    if (theme === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
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
