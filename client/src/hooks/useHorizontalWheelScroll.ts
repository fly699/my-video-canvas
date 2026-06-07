import { useEffect, useRef } from "react";

/**
 * Make a horizontally-scrolling strip (filmstrip / timeline) respond to a regular
 * mouse wheel: vertical wheel ticks move the content left/right. Real horizontal
 * input (trackpad two-finger swipe, which already carries deltaX) is left to the
 * browser's native overflow scroll. Stops propagation so the wheel never reaches
 * the React Flow canvas underneath (which would otherwise zoom).
 *
 * Uses a native, NON-passive listener so preventDefault actually works (React's
 * synthetic onWheel can be passive and silently ignore preventDefault).
 */
export function useHorizontalWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Nothing to scroll → let the event pass (e.g. zoom the canvas).
      if (el.scrollWidth <= el.clientWidth) return;
      const verticalDominant = Math.abs(e.deltaY) > Math.abs(e.deltaX);
      if (verticalDominant) {
        el.scrollLeft += e.deltaY;
        e.preventDefault(); // we consumed the vertical wheel → don't scroll the page
      }
      // Always keep it from bubbling to the canvas (no zoom while over the strip).
      e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return ref;
}
