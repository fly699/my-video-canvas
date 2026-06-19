import { createContext, useContext, type ReactNode } from "react";

// True when a node's body (`children`) is being rendered INSIDE the studio
// floating param panel (below the node card). The card already shows the node's
// result media as its hero preview, so result-media blocks inside the body are a
// duplicate there — media-result nodes wrap their in-body preview to skip it.
// Presentation-only: it hides a redundant preview, never changes any logic/gating.
export const StudioFloatingContext = createContext(false);

export function useStudioFloating(): boolean {
  return useContext(StudioFloatingContext);
}

// Wrapper that renders its children everywhere EXCEPT inside the studio floating
// panel. Must be used as an element in the node's body JSX (NOT read as a hook at
// the node component's top level) — the context value only takes effect at the
// element's own mount position, which is inside BaseNode's provider.
export function HideWhenStudioFloating({ children }: { children: ReactNode }) {
  return useStudioFloating() ? null : <>{children}</>;
}
