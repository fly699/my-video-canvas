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

interface GpuStat {
  index?: number;
  gpuUtilization?: number;
  gpuTemperature?: number;
  vramUsedPercent?: number;
  vramTotalMB?: number;
  vramUsedMB?: number;
}

/** Hint used to pick THIS instance's GPU out of all the host's GPUs. */
export interface GpuMatch {
  deviceIndex?: number;   // from /system_stats (reliable only with --cuda-device)
  vramTotalMB?: number;   // the instance's GPU total VRAM
  vramUsedMB?: number;    // the instance's GPU used VRAM (total - free)
}

interface Conn {
  ws: WebSocket | null;
  // Crystools reports EVERY GPU on the host (gpus[0], gpus[1]…). When several
  // ComfyUI instances share a multi-GPU machine, each must read the GPU IT uses —
  // not always gpus[0], which made every server show the first GPU's load. We
  // correlate by VRAM usage (works even when CUDA_VISIBLE_DEVICES hides the real
  // index), with device-index and position as fallbacks.
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
      c.gpus = gpus.map((g) => ({
        index: typeof g.index === "number" ? g.index : undefined,
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

/** Latest FRESH crystools reading for THIS instance's GPU, or undefined. On a
 *  multi-GPU host Crystools reports every GPU, so we must pick the one this
 *  instance uses. Order of signals: single GPU → it; VRAM-usage match (works even
 *  when CUDA_VISIBLE_DEVICES masks the index); reported index; position; gpus[0]. */
export function getCrystoolsReading(baseUrl: string, match?: GpuMatch): CrystoolsReading | undefined {
  const c = conns.get(baseUrl);
  if (!c?.gpus || c.gpus.length === 0 || Date.now() - (c.gpusAt ?? 0) >= FRESH_MS) return undefined;
  const gpus = c.gpus;
  let g: GpuStat | undefined;
  if (gpus.length === 1) {
    g = gpus[0];
  } else if (match) {
    // 1) VRAM-usage correlation — the instance's /system_stats GPU vram should
    //    match exactly one of the host GPUs (total within tolerance, used closest).
    if (typeof match.vramUsedMB === "number") {
      const cand = gpus.filter((x) =>
        typeof x.vramUsedMB === "number" &&
        (match.vramTotalMB == null || x.vramTotalMB == null ||
          Math.abs(x.vramTotalMB - match.vramTotalMB) <= Math.max(64, match.vramTotalMB * 0.02)));
      if (cand.length) {
        g = cand.reduce((best, x) =>
          Math.abs((x.vramUsedMB ?? 0) - match.vramUsedMB!) < Math.abs((best.vramUsedMB ?? 0) - match.vramUsedMB!) ? x : best);
      }
    }
    // 2) Reported index. 3) Positional.
    if (!g && typeof match.deviceIndex === "number") {
      g = gpus.find((x) => x.index === match.deviceIndex) ?? gpus[match.deviceIndex];
    }
  }
  g = g ?? gpus[0];
  if (!g) return undefined;
  return { gpuUtilization: g.gpuUtilization, gpuTemperature: g.gpuTemperature, vramUsedPercent: g.vramUsedPercent, at: c.gpusAt ?? Date.now() };
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
