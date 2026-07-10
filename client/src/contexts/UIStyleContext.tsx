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

// 画布默认风格：pro 皮肤（配合 CanvasMode 默认 creative = 「创意/LibTV 模式」——
// 首次进入即 LibTV 观感，快速黏住 LibTV 用户）。只有用户「显式切换过」才尊重其选择，
// 否则一律用该默认——这样改默认能同时覆盖新用户与从未主动选过的老用户，而不会顶掉
// 主动选了专业/工作室的人（他们切换时会打上 explicit 标记）。
const DEFAULT_UI_STYLE: UIStyle = "pro";
const EXPLICIT_KEY = "avc:ui-style-explicit";

const UIStyleContext = createContext<UIStyleContextType>({
  uiStyle: DEFAULT_UI_STYLE,
  setUIStyle: () => {},
});

function readStoredUIStyle(): UIStyle {
  try {
    if (localStorage.getItem(EXPLICIT_KEY) !== "1") return DEFAULT_UI_STYLE; // 未显式选过 → 用默认
    const stored = localStorage.getItem("avc:ui-style");
    return stored === "studio" || stored === "simple" || stored === "pro" ? stored : DEFAULT_UI_STYLE;
  } catch {
    return DEFAULT_UI_STYLE;
  }
}

export function UIStyleProvider({ children }: { children: React.ReactNode }) {
  const [uiStyle, setUIStyleState] = useState<UIStyle>(readStoredUIStyle);

  useEffect(() => {
    document.documentElement.setAttribute("data-ui", uiStyle);
    try { localStorage.setItem("avc:ui-style", uiStyle); } catch { /* restricted environment */ }
  }, [uiStyle]);

  // 任何一次「设置」都视为用户显式选择（来自切换器点击或服务端偏好回灌），打标记后此后尊重之。
  const setUIStyle = (s: UIStyle) => {
    try { localStorage.setItem(EXPLICIT_KEY, "1"); } catch { /* restricted */ }
    setUIStyleState(s);
  };

  return (
    <UIStyleContext.Provider value={{ uiStyle, setUIStyle }}>
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
