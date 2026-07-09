import { describe, expect, it } from "vitest";
import { sanitizeTaskForClient } from "./routers/canvas";

// Guards the credential-leak fix: server-internal `_`-prefixed params (esp. the encrypted
// kie key) must be stripped before a video task is returned to any client (project members).
describe("sanitizeTaskForClient", () => {
  it("strips all _-prefixed internal params, keeps the rest", () => {
    const task = {
      id: 1, status: "processing", params: {
        resolution: "1080p", duration: 5,
        _kieKeyEnc: "iv:tag:cipher", _referenceImageUrls: ["a", "b"], _estimatedCost: 42,
      },
    };
    const out = sanitizeTaskForClient(task);
    expect(out.params).toEqual({ resolution: "1080p", duration: 5 });
    expect((out.params as Record<string, unknown>)._kieKeyEnc).toBeUndefined();
    // original object is not mutated
    expect((task.params as Record<string, unknown>)._kieKeyEnc).toBe("iv:tag:cipher");
  });

  it("passes through tasks with no params / null / non-object params", () => {
    expect(sanitizeTaskForClient(null)).toBeNull();
    expect(sanitizeTaskForClient(undefined)).toBeUndefined();
    expect(sanitizeTaskForClient({ id: 1 })).toEqual({ id: 1 });
    expect(sanitizeTaskForClient({ id: 1, params: null })).toEqual({ id: 1, params: null });
  });

  it("yields an empty object when every param is internal", () => {
    const out = sanitizeTaskForClient({ id: 2, params: { _kieKeyEnc: "x", _refMode: "reference" } });
    expect(out.params).toEqual({});
  });
});
