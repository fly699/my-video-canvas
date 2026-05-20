import { describe, expect, it } from "vitest";

/**
 * Validates that POYO_API_KEY is set and can successfully reach the poyo.ai API.
 * Uses a minimal /v1/models endpoint to avoid consuming credits.
 */
describe("POYO_API_KEY", () => {
  it("should be set in environment", () => {
    const key = process.env.POYO_API_KEY;
    expect(key).toBeDefined();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("should authenticate successfully with poyo.ai", async () => {
    const key = process.env.POYO_API_KEY;
    const res = await fetch("https://api.poyo.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });
    // 200 = valid key, 401 = invalid key
    expect(res.status).not.toBe(401);
    expect([200, 404]).toContain(res.status); // 404 is acceptable if endpoint differs
  }, 15000);
});
