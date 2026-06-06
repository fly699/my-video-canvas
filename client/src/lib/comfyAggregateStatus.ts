// Aggregate live status across one or more ComfyUI servers for the topbar
// indicator. Pure + side-effect free so it can be unit-tested.

export interface ComfyServerStatus {
  baseUrl: string;
  online: boolean;
  version?: string;
  vramTotalMB?: number;
  vramFreeMB?: number;
  ramTotalMB?: number;
  ramFreeMB?: number;
  deviceName?: string;
  gpuUtilization?: number;
  queueRunning?: number;
  queuePending?: number;
  error?: string;
}

export interface ComfyAggregate {
  /** number of probed servers */
  total: number;
  /** how many responded online */
  online: number;
  /** Σ(running)+Σ(pending) across online servers */
  queue: number;
  /** 0-100 VRAM used percentage across online servers, or null when unknown */
  vramPct: number | null;
  /** 0-100 system-RAM used percentage across online servers, or null */
  ramPct: number | null;
  /** 0-100 average GPU compute utilization across servers that report it
   *  (Crystools), or null when none report it */
  gpuPct: number | null;
  /** overall health for the dot colour */
  health: "unconfigured" | "offline" | "degraded" | "ok";
}

const pct = (used: number, total: number): number | null =>
  total > 0 ? Math.max(0, Math.min(100, Math.round((used / total) * 100))) : null;

/** Combine many per-server statuses into one summary for the compact bar. */
export function aggregateComfyStatus(statuses: ComfyServerStatus[]): ComfyAggregate {
  const total = statuses.length;
  if (total === 0) {
    return { total: 0, online: 0, queue: 0, vramPct: null, ramPct: null, gpuPct: null, health: "unconfigured" };
  }
  const onlineList = statuses.filter((s) => s.online);
  const online = onlineList.length;

  let queue = 0;
  let vramUsed = 0, vramTotal = 0;
  let ramUsed = 0, ramTotal = 0;
  let gpuSum = 0, gpuCount = 0;
  for (const s of onlineList) {
    queue += (s.queueRunning ?? 0) + (s.queuePending ?? 0);
    if (typeof s.vramTotalMB === "number" && typeof s.vramFreeMB === "number" && s.vramTotalMB > 0) {
      vramTotal += s.vramTotalMB;
      vramUsed += Math.max(0, s.vramTotalMB - s.vramFreeMB);
    }
    if (typeof s.ramTotalMB === "number" && typeof s.ramFreeMB === "number" && s.ramTotalMB > 0) {
      ramTotal += s.ramTotalMB;
      ramUsed += Math.max(0, s.ramTotalMB - s.ramFreeMB);
    }
    if (typeof s.gpuUtilization === "number") { gpuSum += s.gpuUtilization; gpuCount += 1; }
  }

  const vramPct = pct(vramUsed, vramTotal);
  const ramPct = pct(ramUsed, ramTotal);
  const gpuPct = gpuCount > 0 ? Math.max(0, Math.min(100, Math.round(gpuSum / gpuCount))) : null;

  // Health: all offline = offline; some offline OR any load gauge ≥ 90% = degraded; else ok.
  const hot = [vramPct, ramPct, gpuPct].some((p) => p != null && p >= 90);
  const health: ComfyAggregate["health"] =
    online === 0 ? "offline" : (online < total || hot) ? "degraded" : "ok";

  return { total, online, queue, vramPct, ramPct, gpuPct, health };
}
