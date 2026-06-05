import { create } from "zustand";

/**
 * Transient live-preview frames for running ComfyUI nodes, keyed by node id.
 * Kept OUT of the node payload on purpose: previews are large base64 data URLs
 * and must never be persisted to the DB or synced over collab — they're discarded
 * as soon as the run finishes.
 */
interface ComfyPreviewState {
  previews: Record<string, string>; // nodeId → data: URL
  setPreview: (nodeId: string, dataUrl: string) => void;
  clearPreview: (nodeId: string) => void;
}

export const useComfyPreviewStore = create<ComfyPreviewState>((set) => ({
  previews: {},
  setPreview: (nodeId, dataUrl) =>
    set((s) => ({ previews: { ...s.previews, [nodeId]: dataUrl } })),
  clearPreview: (nodeId) =>
    set((s) => {
      if (!(nodeId in s.previews)) return s;
      const next = { ...s.previews };
      delete next[nodeId];
      return { previews: next };
    }),
}));
