import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the ComfyUI probe so the stress manager runs without a real server.
// Each call records which baseUrl it received and returns a fixed timing so we
// can assert round-robin distribution and per-server bucketing deterministically.
const calls: string[] = [];
vi.mock("./_core/comfyui", () => ({
  runComfyProbe: vi.fn(async (baseUrl: string) => {
    calls.push(baseUrl);
    return { submitMs: 10, waitMs: 20, downloadMs: 0, totalMs: 30, outputCount: 1 };
  }),
}));

import { startStressTest, getJob, toView } from "./_core/comfyStress";

async function waitUntilDone(id: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = getJob(id);
    if (job && job.status !== "running") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("stress job did not finish in time");
}

const baseOpts = {
  workflowJson: JSON.stringify({ "1": { class_type: "x", inputs: {} } }),
  mode: "lean" as const,
  randomizeSeed: false,
  startedBy: { id: 1, email: null },
};

describe("comfyStress multi-address", () => {
  beforeEach(() => { calls.length = 0; });

  it("distributes requests round-robin across servers and buckets stats per server", async () => {
    const view = startStressTest({
      ...baseOpts,
      baseUrls: ["http://a:8188", "http://b:8188"],
      concurrency: 1,
      total: 4,
    });
    await waitUntilDone(view.id);
    const job = toView(getJob(view.id)!);

    expect(job.status).toBe("completed");
    expect(job.succeeded).toBe(4);
    expect(job.failed).toBe(0);
    // Round-robin: a, b, a, b
    expect(calls).toEqual(["http://a:8188", "http://b:8188", "http://a:8188", "http://b:8188"]);

    expect(job.servers).toHaveLength(2);
    for (const s of job.servers) {
      expect(s.succeeded).toBe(2); // 4 requests split evenly across 2 servers
      expect(s.failed).toBe(0);
      expect(s.avgMs).toBe(30);
    }
  });

  it("dedupes and trims blank addresses; falls back to a single server", async () => {
    const view = startStressTest({
      ...baseOpts,
      baseUrls: ["http://a:8188", " http://a:8188 ", ""],
      concurrency: 2,
      total: 3,
    });
    await waitUntilDone(view.id);
    const job = toView(getJob(view.id)!);

    expect(job.baseUrls).toEqual(["http://a:8188"]);
    expect(job.servers).toHaveLength(1);
    expect(job.succeeded).toBe(3);
  });

  it("records a time-series sample with per-server entries", async () => {
    const view = startStressTest({
      ...baseOpts,
      baseUrls: ["http://a:8188", "http://b:8188"],
      concurrency: 2,
      total: 6,
    });
    await waitUntilDone(view.id);
    const job = toView(getJob(view.id)!);

    expect(job.timeSeries.length).toBeGreaterThanOrEqual(1);
    const last = job.timeSeries[job.timeSeries.length - 1];
    expect(last.perServer).toHaveLength(2);
    expect(last.completed).toBe(6);
  });

  it("rejects when no addresses are provided", () => {
    expect(() => startStressTest({ ...baseOpts, baseUrls: ["", "  "], concurrency: 1, total: 1 }))
      .toThrow(/未提供任何 ComfyUI 服务器地址/);
  });
});
