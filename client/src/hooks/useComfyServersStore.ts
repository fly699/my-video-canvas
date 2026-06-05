import { create } from "zustand";

/**
 * A browser-global registry of ComfyUI server addresses, shared across every
 * ComfyUI node and project (persisted to localStorage). ComfyUI servers are
 * machine/network-specific, so this lets a user enter an address once and pick
 * it from any node instead of re-typing it per node. Backed by a store (not just
 * localStorage) so all open nodes update live when one saves/removes an address.
 */
const KEY = "comfyui:servers:v1";
const MAX = 50;

function load(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function save(list: string[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota / private mode — silent */ }
}

interface ComfyServersState {
  servers: string[];
  add: (url: string) => void;
  remove: (url: string) => void;
}

export const useComfyServersStore = create<ComfyServersState>((set, get) => ({
  servers: load(),
  add: (url) => {
    const u = url.trim();
    if (!u || get().servers.includes(u)) return;
    const next = [...get().servers, u].slice(-MAX);
    save(next);
    set({ servers: next });
  },
  remove: (url) => {
    const next = get().servers.filter((s) => s !== url);
    save(next);
    set({ servers: next });
  },
}));
