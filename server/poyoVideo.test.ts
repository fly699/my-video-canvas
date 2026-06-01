import { describe, expect, it, vi, beforeEach } from "vitest";

// submitPoyoVideo reads ENV.poyoApiKey (from process.env at import) and POSTs to
// Poyo. Set the key before importing, and mock fetch to capture the request body
// so we can assert required-param defaults (Kling `sound`) are injected.
process.env.POYO_API_KEY = "test-key";

let lastBody: { model: string; input: Record<string, unknown> } | null = null;

beforeEach(() => {
  lastBody = null;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    lastBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ code: 200, data: { task_id: "t_123" } }) } as unknown as Response;
  }));
});

async function submit(provider: string, params: Record<string, unknown>) {
  const { submitPoyoVideo } = await import("./_core/poyoVideo");
  await submitPoyoVideo({ provider, prompt: "hi", params });
  return lastBody!;
}

describe("submitPoyoVideo required-param defaults", () => {
  it("injects sound:false for Kling o3 standard when the UI didn't provide it", async () => {
    const body = await submit("poyo_kling_o3_std", { aspect_ratio: "16:9", duration: 5 });
    expect(body.model).toBe("kling-o3/standard");
    expect(body.input.sound).toBe(false);
  });

  it("respects an explicit sound value over the default", async () => {
    const body = await submit("poyo_kling_o3_pro", { aspect_ratio: "16:9", duration: 5, sound: true });
    expect(body.input.sound).toBe(true);
  });

  it("injects sound:false for the whole Kling 3.0 / 2.6 family", async () => {
    for (const [provider, model] of [
      ["poyo_kling26", "kling-2.6"],
      ["poyo_kling_o3_4k", "kling-o3/4K"],
    ] as const) {
      const body = await submit(provider, { aspect_ratio: "16:9", duration: 5 });
      expect(body.model).toBe(model);
      expect(body.input.sound).toBe(false);
    }
  });

  it("does not inject sound for models that don't require it", async () => {
    const body = await submit("poyo_kling26", {}); // kling-2.6 requires sound → injected
    expect(body.input.sound).toBe(false);
    const body2 = await submit("poyo_seedance", { resolution: "1080p", duration: 5 });
    expect("sound" in body2.input).toBe(false);
  });
});
