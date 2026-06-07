import { describe, it, expect } from "vitest";
import { computeFreeVramUpdates } from "./comfyFreeVram";
import { injectFreeVramIntoOps } from "./agentApply";
import type { AgentOperation } from "../../../shared/types";

describe("computeFreeVramUpdates — broadcast freeVramAfterRun to comfy nodes", () => {
  const nodes = [
    { id: "a", data: { nodeType: "comfyui_image" } },
    { id: "b", data: { nodeType: "comfyui_video" } },
    { id: "c", data: { nodeType: "comfyui_workflow" } },
    { id: "d", data: { nodeType: "script" } },
    { id: "e", data: { nodeType: "prompt" } },
  ];

  it("targets only the three ComfyUI node types", () => {
    const out = computeFreeVramUpdates(nodes, true);
    expect(out.map((u) => u.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("writes the given value", () => {
    expect(computeFreeVramUpdates(nodes, true).every((u) => u.payload.freeVramAfterRun === true)).toBe(true);
    expect(computeFreeVramUpdates(nodes, false).every((u) => u.payload.freeVramAfterRun === false)).toBe(true);
  });

  it("returns nothing when there are no comfy nodes", () => {
    expect(computeFreeVramUpdates([{ id: "x", data: { nodeType: "script" } }], true)).toEqual([]);
  });
});

describe("injectFreeVramIntoOps — agent plan injection", () => {
  const baseOps = (): AgentOperation[] => [
    { op: "create", nodeType: "comfyui_image", tempId: "i" },
    { op: "create", nodeType: "comfyui_workflow", tempId: "w", payload: { templateId: 3 } },
    { op: "create", nodeType: "script", tempId: "s" },
    { op: "connect", from: "i", to: "w" } as AgentOperation,
  ];

  it("sets freeVramAfterRun=true on comfy create ops only, preserving existing payload", () => {
    const ops = injectFreeVramIntoOps(baseOps(), true);
    expect((ops[0].payload as Record<string, unknown>).freeVramAfterRun).toBe(true);
    expect((ops[1].payload as Record<string, unknown>).freeVramAfterRun).toBe(true);
    expect((ops[1].payload as Record<string, unknown>).templateId).toBe(3); // preserved
    expect(ops[2].payload).toBeUndefined(); // script untouched
  });

  it("is a no-op when disabled", () => {
    const ops = injectFreeVramIntoOps(baseOps(), false);
    expect(ops[0].payload).toBeUndefined();
    expect(ops[1].payload).toEqual({ templateId: 3 });
  });
});
