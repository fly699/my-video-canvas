import { describe, it, expect } from "vitest";
import { aggregateComfyStatus, type ComfyServerStatus } from "./comfyAggregateStatus";

const s = (p: Partial<ComfyServerStatus>): ComfyServerStatus => ({ baseUrl: "u", online: true, ...p });

describe("aggregateComfyStatus", () => {
  it("returns unconfigured for an empty list", () => {
    const a = aggregateComfyStatus([]);
    expect(a).toMatchObject({ total: 0, online: 0, health: "unconfigured", vramPct: null, ramPct: null, gpuPct: null });
  });

  it("sums queue and computes VRAM/RAM usage % across online servers", () => {
    const a = aggregateComfyStatus([
      s({ vramTotalMB: 1000, vramFreeMB: 250, ramTotalMB: 2000, ramFreeMB: 1000, queueRunning: 1, queuePending: 2 }),
      s({ vramTotalMB: 1000, vramFreeMB: 750, ramTotalMB: 2000, ramFreeMB: 1000, queueRunning: 0, queuePending: 1 }),
    ]);
    expect(a.total).toBe(2);
    expect(a.online).toBe(2);
    expect(a.queue).toBe(4);
    // VRAM used = (750 + 250) / 2000 = 50%
    expect(a.vramPct).toBe(50);
    // RAM used = (1000 + 1000) / 4000 = 50%
    expect(a.ramPct).toBe(50);
    expect(a.health).toBe("ok");
  });

  it("averages GPU utilization only over servers that report it", () => {
    const a = aggregateComfyStatus([
      s({ gpuUtilization: 80 }),
      s({ /* no gpu */ }),
      s({ gpuUtilization: 40 }),
    ]);
    expect(a.gpuPct).toBe(60);
  });

  it("returns null gpuPct when no server reports Crystools data", () => {
    expect(aggregateComfyStatus([s({}), s({})]).gpuPct).toBeNull();
  });

  it("marks offline when all servers are down", () => {
    const a = aggregateComfyStatus([s({ online: false, error: "x" })]);
    expect(a.health).toBe("offline");
    expect(a.online).toBe(0);
  });

  it("marks degraded when some servers are offline", () => {
    const a = aggregateComfyStatus([s({ online: true }), s({ online: false })]);
    expect(a.health).toBe("degraded");
  });

  it("marks degraded when a load gauge is >= 90%", () => {
    const a = aggregateComfyStatus([s({ vramTotalMB: 100, vramFreeMB: 5, ramTotalMB: 100, ramFreeMB: 100 })]);
    expect(a.vramPct).toBe(95);
    expect(a.health).toBe("degraded");
  });
});
