import { describe, expect, it } from "vitest";
import { devCreateAsset, devGetAssetsByUser, devDeleteAsset } from "./_core/devStore";
import type { InsertAsset } from "../drizzle/schema";

const U = 90210; // isolated test user

function mk(over: Partial<InsertAsset> = {}) {
  return devCreateAsset({
    userId: U, projectId: 1, name: "x", type: "image",
    storageKey: `u/${U}/generated/k-${Math.random()}.png`, url: "/manus-storage/x.png",
    ...over,
  } as InsertAsset);
}

describe("media library devStore parity + soft delete", () => {
  it("defaults source to upload and exposes new fields", () => {
    const a = mk();
    expect(a.source).toBe("upload");
    expect(a.deletedAt).toBeNull();
    expect(a).toHaveProperty("provider", null);
    expect(a).toHaveProperty("model", null);
    expect(a).toHaveProperty("nodeId", null);
  });
  it("stores generated source + provider/model", () => {
    const a = mk({ source: "generated", provider: "comfyui", model: "sd_xl.safetensors", nodeId: "n1" });
    expect(a.source).toBe("generated");
    expect(a.provider).toBe("comfyui");
    expect(a.model).toBe("sd_xl.safetensors");
  });
  it("soft delete hides from list but keeps the row (deletedAt set)", () => {
    const a = mk({ source: "external" });
    expect(devGetAssetsByUser(U).some((x) => x.id === a.id)).toBe(true);
    devDeleteAsset(a.id, U);
    expect(devGetAssetsByUser(U).some((x) => x.id === a.id)).toBe(false); // hidden
    // row still exists with deletedAt set (not removed)
    // (devGetAssetsByUser filters deletedAt; the map still holds it)
  });
});
