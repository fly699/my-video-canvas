// localStorage-backed custom video parameter presets, keyed by provider.

export interface CustomVideoPreset {
  id: string;           // stable client-generated id
  label: string;        // user-supplied name
  params: Record<string, unknown>;
  negativePrompt?: string;
}

const STORAGE_KEY = "videoCustomPresets:v1";
const MAX_PER_PROVIDER = 20;
const MAX_LABEL_LEN = 24;

type Store = Record<string, CustomVideoPreset[]>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded or storage unavailable — silently ignore
  }
}

export function listCustomPresets(provider: string): CustomVideoPreset[] {
  return read()[provider] ?? [];
}

export function saveCustomPreset(
  provider: string,
  label: string,
  params: Record<string, unknown>,
  negativePrompt?: string,
): CustomVideoPreset | null {
  const trimmed = label.trim().slice(0, MAX_LABEL_LEN);
  if (!trimmed) return null;
  const store = read();
  const list = store[provider] ?? [];
  if (list.length >= MAX_PER_PROVIDER) return null;
  // Avoid serializing huge objects — only keep primitive-y values
  const safeParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") {
      safeParams[k] = v;
    }
  }
  const preset: CustomVideoPreset = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: trimmed,
    params: safeParams,
    ...(negativePrompt ? { negativePrompt } : {}),
  };
  store[provider] = [...list, preset];
  write(store);
  return preset;
}

export function deleteCustomPreset(provider: string, presetId: string): void {
  const store = read();
  const list = store[provider];
  if (!list) return;
  store[provider] = list.filter((p) => p.id !== presetId);
  write(store);
}
