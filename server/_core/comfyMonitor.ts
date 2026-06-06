// Background WebSocket subscriptions to each actively-probed ComfyUI server's
// /ws socket, reading the ComfyUI-Crystools "crystools.monitor" pushes (GPU
// compute %, temperature, VRAM %). Vanilla /system_stats (HTTP) does NOT expose
// GPU compute %, and Crystools only broadcasts it over the socket — the same
// channel the ComfyUI web UI subscribes to. We keep one lightweight, passive
// connection per server and cache its latest reading; idle servers are pruned.
//
// Uses the global (WHATWG) WebSocket — same as the sampling-progress subscription
// in comfyui.ts. Callers pass an already-normalized baseUrl (the Map key).

export interface CrystoolsReading {
  gpuUtilization?: number;   // 0-100
  gpuTemperature?: number;   // °C
  vramUsedPercent?: number;  // 0-100
  at: number;                // ms epoch of last frame
}

export interface GpuStat {
  index: number;             // position in the host's physical-ordered gpus array
  gpuUtilization?: number;
  gpuTemperature?: number;
  vramUsedPercent?: number;
  vramTotalMB?: number;
  vramUsedMB?: number;
}

// Why a USER-CHOSEN GPU index, not auto-correlation (verified against the
// official source, 2026-06):
//   • ComfyUI-Crystools (general/gpu.py, CGPUInfo) enumerates GPUs with pynvml
//     DIRECTLY — nvmlDeviceGetCount()/nvmlDeviceGetHandleByIndex() over ALL
//     physical GPUs, IGNORING CUDA_VISIBLE_DEVICES. Its crystools.monitor frames
//     carry only utilization/temp/vram per GPU — NO index/uuid/pci bus id — in
//     physical order, IDENTICAL for every ComfyUI instance on that host.
//   • ComfyUI (main.py) handles --cuda-device by setting CUDA_VISIBLE_DEVICES
//     before torch loads, so each pinned instance sees its GPU as logical 0 and
//     /system_stats always reports index 0.
// => On a shared multi-GPU host there is NO field that maps an instance to its
//    physical GPU (VRAM only diverges under load). So we let the caller pin an
//    explicit physical index and read gpus[index]; with a single GPU we use it.

interface Conn {
  ws: WebSocket | null;
  // Crystools reports EVERY physical GPU on the host (gpus[0], gpus[1]…) in a
  // stable order, the same for every instance on that machine. We cache the full
  // array; the chosen GPU is selected by explicit index at read time.
  gpus?: GpuStat[];
  gpusAt?: number;
  lastRequested: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  closing: boolean;
}

const conns = new Map<string, Conn>();
const FRESH_MS = 15_000;    // a reading older than this is considered stale
const IDLE_MS = 90_000;     // drop a connection not probed within this window
const RECONNECT_MS = 8_000;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function scheduleReconnect(baseUrl: string, c: Conn): void {
  if (c.closing || c.reconnectTimer) return;
  c.reconnectTimer = setTimeout(() => { c.reconnectTimer = undefined; connect(baseUrl, c); }, RECONNECT_MS);
}

function connect(baseUrl: string, c: Conn): void {
  if (c.closing) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws?clientId=cc_monitor");
  } catch {
    scheduleReconnect(baseUrl, c);
    return;
  }
  c.ws = ws;
  ws.addEventListener("message", (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return; // crystools frames are JSON text
    try {
      const msg = JSON.parse(ev.data) as { type?: string; data?: Record<string, unknown> };
      if (msg.type !== "crystools.monitor" || !msg.data) return;
      const gpus = msg.data.gpus as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(gpus)) return;
      const toMB = (v: unknown) => (typeof v === "number" ? Math.round(v / (1024 * 1024)) : undefined);
      // crystools.monitor frames have NO per-GPU index — the array position IS the
      // physical index (pynvml enumeration order), so we use the position.
      c.gpus = gpus.map((g, i) => ({
        index: i,
        gpuUtilization: typeof g.gpu_utilization === "number" ? clamp(g.gpu_utilization) : undefined,
        gpuTemperature: typeof g.gpu_temperature === "number" ? Math.round(g.gpu_temperature) : undefined,
        vramUsedPercent: typeof g.vram_used_percent === "number" ? clamp(g.vram_used_percent) : undefined,
        vramTotalMB: toMB(g.vram_total),
        vramUsedMB: toMB(g.vram_used),
      }));
      c.gpusAt = Date.now();
    } catch { /* ignore malformed frame */ }
  });
  ws.addEventListener("close", () => { c.ws = null; if (!c.closing) scheduleReconnect(baseUrl, c); });
  ws.addEventListener("error", () => { try { ws.close(); } catch { /* ignore */ } });
}

/** Mark a server as actively watched and ensure a live monitor subscription. */
export function ensureCrystoolsMonitor(baseUrl: string): void {
  const existing = conns.get(baseUrl);
  if (existing) { existing.lastRequested = Date.now(); return; }
  const c: Conn = { ws: null, lastRequested: Date.now(), closing: false };
  conns.set(baseUrl, c);
  connect(baseUrl, c);
}

/** The host's full, FRESH per-GPU array (physical order), or undefined when no
 *  fresh Crystools frame. Used to let the user SEE every GPU and pick the right
 *  one for this server. */
export function getCrystoolsGpus(baseUrl: string): GpuStat[] | undefined {
  const c = conns.get(baseUrl);
  if (!c?.gpus || c.gpus.length === 0 || Date.now() - (c.gpusAt ?? 0) >= FRESH_MS) return undefined;
  return c.gpus;
}

/** Latest FRESH crystools reading for the GPU this server uses, or undefined.
 *  Selection is DETERMINISTIC: an explicit physical `gpuIndex` (the server's
 *  --cuda-device, set by the user) wins; a single-GPU host uses its only GPU;
 *  otherwise we fall back to gpus[0] (ambiguous — the UI prompts the user to
 *  pick). We never guess by VRAM: it only diverges under active load. */
export function getCrystoolsReading(baseUrl: string, gpuIndex?: number): CrystoolsReading | undefined {
  const gpus = getCrystoolsGpus(baseUrl);
  if (!gpus || gpus.length === 0) return undefined;
  let g: GpuStat;
  if (typeof gpuIndex === "number" && gpuIndex >= 0 && gpuIndex < gpus.length) g = gpus[gpuIndex];
  else g = gpus[0];
  return { gpuUtilization: g.gpuUtilization, gpuTemperature: g.gpuTemperature, vramUsedPercent: g.vramUsedPercent, at: Date.now() };
}

// Prune connections to servers nobody is watching anymore.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const url of Array.from(conns.keys())) {
    const c = conns.get(url);
    if (c && now - c.lastRequested > IDLE_MS) {
      c.closing = true;
      if (c.reconnectTimer) clearTimeout(c.reconnectTimer);
      try { c.ws?.close(); } catch { /* ignore */ }
      conns.delete(url);
    }
  }
}, 30_000);
sweep.unref?.();
