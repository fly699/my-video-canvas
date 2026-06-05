import { describe, it, expect } from "vitest";
import { distributeServers } from "./agentApply";
import type { AgentOperation } from "../../../shared/types";

const comfy = (tempId: string): AgentOperation => ({ op: "create", nodeType: "comfyui_workflow", tempId, payload: { templateId: 1 } });

describe("distributeServers", () => {
  it("round-robins chosen servers across comfy create ops", () => {
    const ops: AgentOperation[] = [comfy("a"), comfy("b"), comfy("c"), comfy("d")];
    distributeServers(ops, ["http://s1", "http://s2"], "round");
    expect(ops.map((o) => o.payload!.customBaseUrl)).toEqual(["http://s1", "http://s2", "http://s1", "http://s2"]);
  });

  it("only assigns to comfy create ops, leaving others untouched", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "script", tempId: "s" },
      comfy("a"),
      { op: "connect", sourceRef: "s", targetRef: "a" },
      comfy("b"),
    ];
    distributeServers(ops, ["http://s1", "http://s2"], "round");
    expect(ops[0].payload).toBeUndefined();
    expect(ops[1].payload!.customBaseUrl).toBe("http://s1");
    expect(ops[3].payload!.customBaseUrl).toBe("http://s2");
  });

  it("random keeps every assignment within the chosen set", () => {
    const ops: AgentOperation[] = [comfy("a"), comfy("b"), comfy("c")];
    const chosen = ["http://s1", "http://s2", "http://s3"];
    distributeServers(ops, chosen, "random");
    for (const o of ops) expect(chosen).toContain(o.payload!.customBaseUrl);
  });

  it("is a no-op when no servers chosen", () => {
    const ops: AgentOperation[] = [comfy("a")];
    distributeServers(ops, [], "round");
    expect(ops[0].payload!.customBaseUrl).toBeUndefined();
  });
});
