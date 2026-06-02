import { useCallback } from "react";
import type { ReferenceImage } from "../../../shared/types";
import { useCanvasStore } from "./useCanvasStore";
import { normalizeRefImages, refPatch, makeRefImage } from "../lib/referenceImages";

type RefSource = ReferenceImage["source"];

interface RefPayload {
  referenceImageUrl?: string;
  referenceImages?: ReferenceImage[];
}

/**
 * Manages a node's multi-reference-image list. Reads the live, normalized list
 * (legacy `referenceImageUrl` folded in) and exposes add/remove/move/insert
 * operations that persist via updateNodeData, always keeping the first entry
 * mirrored to `referenceImageUrl` for backend & downstream compatibility.
 * Numbering is implicit (1-based index), so any mutation auto-renumbers.
 */
export function useReferenceImages(id: string, payload: RefPayload) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const images = normalizeRefImages(payload);

  const commit = useCallback(
    (next: ReferenceImage[], silent = false) => updateNodeData(id, refPatch(next), silent),
    [id, updateNodeData],
  );

  // Read the LIVE list from the store rather than the render-snapshot `payload`.
  // Critical for back-to-back mutations (e.g. uploading several files in a loop,
  // or a multi-URL drop): the component hasn't re-rendered between iterations,
  // so the closed-over `payload` is stale and each commit would clobber the
  // previous one — leaving only the last image. Falling back to `payload` keeps
  // it correct if the node isn't in the store yet.
  const liveImages = useCallback((): ReferenceImage[] => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === id);
    return normalizeRefImages((node?.data.payload as RefPayload) ?? payload);
  }, [id, payload]);

  // Append new URLs (de-duplicated against existing), skipping blanks.
  const addUrls = useCallback((urls: string[], source: RefSource = "url") => {
    const cur = liveImages();
    const seen = new Set(cur.map((r) => r.url));
    const add = urls
      .map((u) => (u ?? "").trim())
      .filter((u) => u.length > 0 && !seen.has(u))
      .map((u) => makeRefImage(u, source));
    if (add.length) commit([...cur, ...add]);
    return add.length;
  }, [liveImages, commit]);

  // Insert URLs at a position (smart-sort drop). De-dupes; clamps index.
  const insertUrls = useCallback((urls: string[], index: number, source: RefSource = "drop") => {
    const cur = liveImages();
    const seen = new Set(cur.map((r) => r.url));
    const add = urls
      .map((u) => (u ?? "").trim())
      .filter((u) => u.length > 0 && !seen.has(u))
      .map((u) => makeRefImage(u, source));
    if (!add.length) return 0;
    const at = Math.max(0, Math.min(index, cur.length));
    commit([...cur.slice(0, at), ...add, ...cur.slice(at)]);
    return add.length;
  }, [liveImages, commit]);

  const removeId = useCallback((rid: string) => {
    commit(liveImages().filter((r) => r.id !== rid));
  }, [liveImages, commit]);

  // Move an existing entry to a target index (reorder within the strip).
  const moveId = useCallback((rid: string, toIndex: number) => {
    const cur = liveImages();
    const from = cur.findIndex((r) => r.id === rid);
    if (from < 0) return;
    const next = cur.slice();
    const [moved] = next.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, next.length));
    next.splice(clamped, 0, moved);
    commit(next);
  }, [liveImages, commit]);

  const clear = useCallback(() => commit([]), [commit]);

  return { images, addUrls, insertUrls, removeId, moveId, clear };
}
