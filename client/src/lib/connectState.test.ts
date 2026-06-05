import { describe, it, expect } from "vitest";
import { computeConnectState } from "../hooks/useConnectingStore";

const NO_DRAG = { fromType: null, fromId: null, fromHandleType: null } as const;

describe("computeConnectState", () => {
  it("returns no override when no drag is active", () => {
    expect(computeConnectState(NO_DRAG, "n1", "storyboard")).toEqual({ target: undefined, source: undefined });
  });

  it("does not highlight the drag's origin node", () => {
    const drag = { fromType: "script" as const, fromId: "n1", fromHandleType: "source" as const };
    expect(computeConnectState(drag, "n1", "script")).toEqual({ target: undefined, source: undefined });
  });

  it("from a source handle: valid target lights up, source is muted", () => {
    const drag = { fromType: "script" as const, fromId: "n1", fromHandleType: "source" as const };
    // script → storyboard is allowed by the matrix
    expect(computeConnectState(drag, "n2", "storyboard")).toEqual({ target: "valid", source: "muted" });
  });

  it("from a source handle: invalid target fades, source muted", () => {
    const drag = { fromType: "script" as const, fromId: "n1", fromHandleType: "source" as const };
    // script → audio is NOT in the matrix
    expect(computeConnectState(drag, "n2", "audio")).toEqual({ target: "invalid", source: "muted" });
  });

  it("from a target handle: looks for a valid SOURCE on the candidate", () => {
    // Dragging backwards from storyboard's target → a script's source can feed it
    const drag = { fromType: "storyboard" as const, fromId: "n2", fromHandleType: "target" as const };
    expect(computeConnectState(drag, "n1", "script")).toEqual({ source: "valid", target: "muted" });
    // audio cannot feed storyboard
    expect(computeConnectState(drag, "n3", "audio")).toEqual({ source: "invalid", target: "muted" });
  });
});
