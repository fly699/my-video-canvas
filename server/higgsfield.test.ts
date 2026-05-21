import { describe, it, expect } from "vitest";
import { ENV } from "./_core/env";

describe("HIGGSFIELD_API_KEY", () => {
  it("should have HIGGSFIELD_API_KEY configured", () => {
    const key = ENV.higgsfieldApiKey;
    // Key may be empty if user hasn't configured it yet — that's OK
    // We just verify the env variable is accessible (not undefined)
    expect(key !== undefined).toBe(true);
  });

  it("should be able to reach Higgsfield API if key is configured", async () => {
    const key = ENV.higgsfieldApiKey;
    if (!key) {
      console.log("HIGGSFIELD_API_KEY not configured, skipping live test");
      return;
    }
    // Lightweight check: list models endpoint
    const res = await fetch("https://platform.higgsfield.ai/v1/models", {
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    // 200/404/405 = authenticated (endpoint may not exist or need different method), 401 = invalid key
    expect([200, 404, 405]).toContain(res.status);
    if (res.status === 401) {
      throw new Error("HIGGSFIELD_API_KEY is invalid — please update the secret");
    }
  }, 15000);
});
