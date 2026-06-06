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
}

interface Conn {
  ws: WebSocket | null;
  // Crystools reports EVERY GPU on the host (gpus[0], gpus[1]…). When several
  // ComfyUI instances share a multi-GPU machine, each must read the GPU IT uses
  // (matched by device index from /system_stats) — not always gpus[0], which made
  // every server show the first GPU's load.
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
      c.gpus = gpus.map((g) => ({
        index: typeof g.index === "number" ? g.index : undefined,
        gpuUtilization: typeof g.gpu_utilization === "number" ? clamp(g.gpu_utilization) : undefined,
        gpuTemperature: typeof g.gpu_temperature === "number" ? Math.round(g.gpu_temperature) : undefined,
        vramUsedPercent: typeof g.vram_used_percent === "number" ? clamp(g.vram_used_percent) : undefined,
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

/** Latest FRESH crystools reading for a server's GPU, or undefined. `deviceIndex`
 *  (from the server's own /system_stats) selects the right GPU on a multi-GPU
 *  host — matched by reported index, then positionally, falling back to gpus[0]. */
export function getCrystoolsReading(baseUrl: string, deviceIndex?: number): CrystoolsReading | undefined {
  const c = conns.get(baseUrl);
  if (!c?.gpus || c.gpus.length === 0 || Date.now() - (c.gpusAt ?? 0) >= FRESH_MS) return undefined;
  let g: GpuStat | undefined;
  if (typeof deviceIndex === "number") {
    g = c.gpus.find((x) => x.index === deviceIndex) ?? c.gpus[deviceIndex];
  }
  g = g ?? c.gpus[0];
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
