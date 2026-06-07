import { describe, it, expect } from "vitest";
import { ownerAgentIdOf, ownedNodeIds, agentBadge } from "./agentOwnership";

const N = (id: string, nodeType: string, ownerAgentId?: string) =>
  ({ id, data: { nodeType, payload: ownerAgentId ? { ownerAgentId } : {} } });

describe("agent ownership", () => {
  const nodes = [
    N("ag1", "agent"),
    N("ag2", "agent"),
    N("n1", "comfyui_image", "ag1"),
    N("n2", "video_task", "ag1"),
    N("n3", "comfyui_image", "ag2"),
    N("n4", "script"), // unowned
  ];

  it("reads the owner agent id from payload", () => {
    expect(ownerAgentIdOf(nodes[2])).toBe("ag1");
    expect(ownerAgentIdOf(nodes[5])).toBeUndefined();
  });

  it("scopes owned node ids per agent", () => {
    expect(ownedNodeIds(nodes, "ag1").sort()).toEqual(["n1", "n2"]);
    expect(ownedNodeIds(nodes, "ag2")).toEqual(["n3"]);
    expect(ownedNodeIds(nodes, "nope")).toEqual([]);
  });

  it("assigns stable, distinct colors/indices by agent order", () => {
    const b1 = agentBadge("ag1", nodes);
    const b2 = agentBadge("ag2", nodes);
    expect(b1.index).toBe(1);
    expect(b2.index).toBe(2);
    expect(b1.color).not.toBe(b2.color);
    // stable across calls
    expect(agentBadge("ag1", nodes).color).toBe(b1.color);
  });
});
