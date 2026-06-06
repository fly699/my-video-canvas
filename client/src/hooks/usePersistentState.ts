import { useEffect, useRef, useState } from "react";

/**
 * useState that mirrors to localStorage. Initial value is read on mount,
 * subsequent updates write through, and changes from other tabs propagate
 * via the `storage` event.
 *
 * Designed for UI layout state (toolbar position, panel sizes, pinned
 * menus, …) — small JSON values that should survive a page reload.
 *
 * Keys are namespaced by version (`v1` suffix) so future migrations can
 * change the shape by bumping the key, leaving old data behind for the
 * browser to garbage-collect rather than crashing on stale JSON.
 *
 * Failure modes are quiet on purpose — quota exceeded, locked storage,
 * legacy JSON shape — we fall back to the default and never throw to a
 * render path.
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  options?: {
    /** Validate parsed JSON; return `null` to reject and fall back to default. */
    validate?: (parsed: unknown) => T | null;
    /** Mirror writes from OTHER tabs/windows into this one (default true). Set
     *  false for per-window UI state (open panels, popups) that must stay
     *  controlled by the window it was toggled in — e.g. multi-monitor popouts. */
    crossTab?: boolean;
  },
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const validateRef = useRef(options?.validate);
  validateRef.current = options?.validate;
  const crossTab = options?.crossTab !== false;

  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      const parsed = JSON.parse(raw);
      if (validateRef.current) {
        const v = validateRef.current(parsed);
        return v ?? defaultValue;
      }
      return parsed as T;
    } catch {
      return defaultValue;
    }
  });

  // Write-through. We don't write on first render unless the value
  // actually differs from what's in storage (avoid noisy localStorage
  // touches when nothing has been edited).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Quota exceeded / Safari private mode / etc. — silent
    }
  }, [key, state]);

  // Cross-tab sync. When another tab writes the same key, mirror in — unless the
  // caller opted out (per-window UI state).
  useEffect(() => {
    if (typeof window === "undefined" || !crossTab) return;
    const handler = (e: StorageEvent) => {
      if (e.key !== key) return;
      if (e.newValue === null) {
        setState(defaultValue);
        return;
      }
      try {
        const parsed = JSON.parse(e.newValue);
        if (validateRef.current) {
          const v = validateRef.current(parsed);
          if (v !== null) setState(v);
          return;
        }
        setState(parsed as T);
      } catch {
        /* ignore malformed payloads from another tab */
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [key, defaultValue, crossTab]);

  return [state, setState];
}

/** Imperative reset (useful for "restore defaults" buttons). Removes the key
 * from storage; the next mount picks up the default. Does NOT update any
 * already-mounted component's state — call the component's setter separately
 * if you want the change visible immediately. */
export function clearPersistentState(key: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

// Stable hook for caller convenience — used by ContextMenu to access the
// shared "pinned menu state" reducer without recomputing the key string.
export function makePersistKey(...parts: (string | number)[]): string {
  return parts.join(":");
}
