import { describe, it, expect } from "vitest";
import { sanitizeOperation } from "./_core/agentCatalog";

describe("agentCatalog.sanitizeOperation", () => {
  it("accepts a valid create op and filters unknown payload fields", () => {
    const op = sanitizeOperation({
      op: "create", tempId: "n1", nodeType: "prompt", title: "P",
      payload: { positivePrompt: "hi", bogusField: "x", style: "anime" },
      note: "why",
    });
    expect(op).not.toBeNull();
    expect(op!.op).toBe("create");
    expect(op!.nodeType).toBe("prompt");
    expect(op!.payload).toEqual({ positivePrompt: "hi", style: "anime" });
    expect((op!.payload as Record<string, unknown>).bogusField).toBeUndefined();
  });

  it("rejects a create op with an unknown/forbidden node type", () => {
    expect(sanitizeOperation({ op: "create", nodeType: "definitely_not_a_node", payload: {} })).toBeNull();
    // admin/niche types are not in the agent catalog → rejected
    expect(sanitizeOperation({ op: "create", nodeType: "voice_clone", payload: {} })).toBeNull();
  });

  it("accepts connect only with both refs", () => {
    expect(sanitizeOperation({ op: "connect", sourceRef: "n1", targetRef: "n2" })).not.toBeNull();
    expect(sanitizeOperation({ op: "connect", sourceRef: "n1" })).toBeNull();
  });

  it("accepts update/delete with a targetRef, rejects without", () => {
    expect(sanitizeOperation({ op: "update", targetRef: "abc", payload: { foo: 1 } })).not.toBeNull();
    expect(sanitizeOperation({ op: "delete", targetRef: "abc" })).not.toBeNull();
    expect(sanitizeOperation({ op: "delete" })).toBeNull();
  });

  it("rejects structurally invalid input", () => {
    expect(sanitizeOperation(null)).toBeNull();
    expect(sanitizeOperation({ op: "explode" })).toBeNull();
    expect(sanitizeOperation("nope")).toBeNull();
  });
});
