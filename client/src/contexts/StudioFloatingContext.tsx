import { createContext, useContext, type ReactNode } from "react";
import { useUIStyle } from "./UIStyleContext";
import { useCanvasMode } from "./CanvasModeContext";

// True when a node's body (`children`) is being rendered INSIDE the studio
// floating param panel (below the node card). The card already shows the node's
// result media as its hero preview, so result-media blocks inside the body are a
// duplicate there — media-result nodes wrap their in-body preview to skip it.
// Presentation-only: it hides a redundant preview, never changes any logic/gating.
export const StudioFloatingContext = createContext(false);

export function useStudioFloating(): boolean {
  return useContext(StudioFloatingContext);
}

// Wrapper that renders its children everywhere EXCEPT where the node card already
// shows the same result media as its hero preview — i.e. inside the studio floating
// panel AND in creative (LibTV) mode, where the hero band always shows the result
// (selected or not) and the controls live in the screen-constant bottom input bar.
// Rendering the in-body preview there duplicates the hero (image/video nodes) or,
// once hidden, would leave the body empty (BaseNode drops the min-height floor in
// creative+hasHero so no gray gap remains). Presentation-only: hides a redundant
// preview, never changes any logic/gating.
// Must be used as an element in the node's body JSX (NOT read as a hook at the node
// component's top level) — the studio-floating context value only takes effect at
// the element's own mount position, which is inside BaseNode's provider.
export function HideWhenStudioFloating({ children }: { children: ReactNode }) {
  const floating = useStudioFloating();
  const { uiStyle } = useUIStyle();
  const { mode } = useCanvasMode();
  const creative = uiStyle !== "studio" && mode === "creative";
  return (floating || creative) ? null : <>{children}</>;
}
