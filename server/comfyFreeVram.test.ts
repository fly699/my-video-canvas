import { describe, it, expect } from "vitest";
import { shouldFreeVram } from "./_core/comfyui";

describe("shouldFreeVram — post-run VRAM cleanup decision", () => {
  it("frees only when enabled, local, and the queue is fully idle", () => {
    expect(shouldFreeVram({ enabled: true, isCloud: false, queue: { running: 0, pending: 0 } })).toBe(true);
  });

  it("does not free when the toggle is off", () => {
    expect(shouldFreeVram({ enabled: false, isCloud: false, queue: { running: 0, pending: 0 } })).toBe(false);
  });

  it("never frees on the shared cloud", () => {
    expect(shouldFreeVram({ enabled: true, isCloud: true, queue: { running: 0, pending: 0 } })).toBe(false);
  });

  it("does not free while another task is running", () => {
    expect(shouldFreeVram({ enabled: true, isCloud: false, queue: { running: 1, pending: 0 } })).toBe(false);
  });

  it("does not free while tasks are pending", () => {
    expect(shouldFreeVram({ enabled: true, isCloud: false, queue: { running: 0, pending: 2 } })).toBe(false);
  });

  it("treats an unknown queue (null) as not-idle → skips, never disrupts other work", () => {
    expect(shouldFreeVram({ enabled: true, isCloud: false, queue: null })).toBe(false);
  });
});
