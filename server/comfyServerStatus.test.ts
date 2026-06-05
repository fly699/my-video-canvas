import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchComfyServerStatus } from "./_core/comfyui";

// Phase 2: live server status probe — parses /system_stats (version/VRAM) and
// /queue (depth), and degrades gracefully when a server is unreachable.
describe("fetchComfyServerStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses system_stats (VRAM→MB, version) and queue depth", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/system_stats")) {
        return { ok: true, json: async () => ({
          system: { comfyui_version: "0.3.4" },
          devices: [{ vram_total: 24 * 1024 * 1024 * 1024, vram_free: 12 * 1024 * 1024 * 1024 }],
        }) } as unknown as Response;
      }
      if (String(url).includes("/queue")) {
        return { ok: true, json: async () => ({ queue_running: [1], queue_pending: [1, 2, 3] }) } as unknown as Response;
      }
      return { ok: false } as unknown as Response;
    }));
    const s = await fetchComfyServerStatus("http://127.0.0.1:8188");
    expect(s.online).toBe(true);
    expect(s.version).toBe("0.3.4");
    expect(s.vramTotalMB).toBe(24 * 1024);
    expect(s.vramFreeMB).toBe(12 * 1024);
    expect(s.queueRunning).toBe(1);
    expect(s.queuePending).toBe(3);
    expect(s.baseUrl).toBe("http://127.0.0.1:8188"); // echoes raw input for 1:1 mapping
  });

  it("reports offline (never throws) when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect ECONNREFUSED"); }));
    const s = await fetchComfyServerStatus("http://127.0.0.1:9999");
    expect(s.online).toBe(false);
    expect(s.error).toBeTruthy();
    expect(s.queueRunning).toBeUndefined();
  });

  it("stays online even when /queue is unavailable (older builds)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/system_stats")) {
        return { ok: true, json: async () => ({ devices: [] }) } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response; // /queue 404
    }));
    const s = await fetchComfyServerStatus("http://127.0.0.1:8188");
    expect(s.online).toBe(true);
    expect(s.queueRunning).toBeUndefined();
  });
});
