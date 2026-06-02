import { describe, expect, it } from "vitest";
import * as dev from "./_core/devStore";
import { resolveDownloadKey } from "./_core/downloadAuth";

describe("download grant lifecycle (dev store)", () => {
  it("request → approve → usable → consume once → exhausted", () => {
    const g = dev.devCreateDownloadGrant({ userId: 7, scope: "asset", storageKey: "u/7/a.png", origin: "request", status: "pending", createdBy: 7 });
    // pending → not usable
    expect(dev.devFindUsableDownloadGrant({ userId: 7, storageKey: "u/7/a.png" })).toBeNull();
    // approve
    dev.devUpdateDownloadGrant(g.id, { status: "active", decidedBy: 1, decidedAt: new Date() });
    const usable = dev.devFindUsableDownloadGrant({ userId: 7, storageKey: "u/7/a.png" });
    expect(usable?.id).toBe(g.id);
    // consume once
    expect(dev.devConsumeDownloadGrant(g.id, 7, "u/7/a.png", null)).toBe(true);
    // second time exhausted
    expect(dev.devConsumeDownloadGrant(g.id, 7, "u/7/a.png", null)).toBe(false);
    // and no longer usable (consumed)
    expect(dev.devFindUsableDownloadGrant({ userId: 7, storageKey: "u/7/a.png" })).toBeNull();
  });

  it("project-scope grant covers files by projectId, asset grant doesn't leak across users", () => {
    const proj = dev.devCreateDownloadGrant({ userId: 8, scope: "project", projectId: 42, origin: "admin", status: "active", createdBy: 1 });
    expect(dev.devFindUsableDownloadGrant({ userId: 8, storageKey: "u/8/x.mp4", projectId: 42 })?.id).toBe(proj.id);
    // wrong project → not covered
    expect(dev.devFindUsableDownloadGrant({ userId: 8, storageKey: "u/8/y.mp4", projectId: 99 })).toBeNull();
    // different user → not covered
    expect(dev.devFindUsableDownloadGrant({ userId: 9, storageKey: "u/8/x.mp4", projectId: 42 })).toBeNull();
  });

  it("expired grant is not usable", () => {
    const g = dev.devCreateDownloadGrant({ userId: 10, scope: "asset", storageKey: "u/10/old.png", origin: "admin", status: "active", createdBy: 1, expiresAt: new Date(Date.now() - 1000) });
    expect(dev.devFindUsableDownloadGrant({ userId: 10, storageKey: "u/10/old.png" })).toBeNull();
    void g;
  });
});

describe("resolveDownloadKey", () => {
  it("uses the bare param key from the storage proxy", () => {
    expect(resolveDownloadKey({ paramKey: "u/1/a.png" })).toBe("u/1/a.png");
  });
  it("strips /manus-storage/ from own-storage URLs", () => {
    expect(resolveDownloadKey({ rawUrl: "/manus-storage/u/1/a.png" })).toBe("u/1/a.png");
    expect(resolveDownloadKey({ rawUrl: "https://app.example.com/manus-storage/gen/x.mp4" })).toBe("gen/x.mp4");
  });
  it("keeps external URLs verbatim as the key", () => {
    expect(resolveDownloadKey({ rawUrl: "https://cdn.poyo.ai/v/123.mp4" })).toBe("https://cdn.poyo.ai/v/123.mp4");
  });
});
