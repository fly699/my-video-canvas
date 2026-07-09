import { describe, it, expect } from "vitest";
import { detectUpstreamPrompt } from "./comfyWorkflowParams";

type N = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { y?: number } };

// Guards the ordering fix: when a node has 2+ upstream prompt sources, the "primary" prompt must be
// chosen by the same priority as image/video refs (trailing number → Y → connection order), NOT by
// raw edge insertion order.
describe("detectUpstreamPrompt ordering", () => {
  it("picks the lower trailing-number source even when it was connected second", () => {
    const nodes: N[] = [
      { id: "p2", data: { nodeType: "prompt", title: "提示词2", payload: { positivePrompt: "second" } }, position: { y: 0 } },
      { id: "p1", data: { nodeType: "prompt", title: "提示词1", payload: { positivePrompt: "first" } }, position: { y: 100 } },
      { id: "t", data: { nodeType: "comfyui_image" }, position: { y: 50 } },
    ];
    // edges inserted p2 → t BEFORE p1 → t (raw order would wrongly pick "second")
    const edges = [{ source: "p2", target: "t" }, { source: "p1", target: "t" }];
    expect(detectUpstreamPrompt("t", edges, nodes).positive).toBe("first");
  });

  it("falls back to Y position when titles have no trailing number", () => {
    const nodes: N[] = [
      { id: "a", data: { nodeType: "prompt", title: "描述", payload: { positivePrompt: "bottom" } }, position: { y: 500 } },
      { id: "b", data: { nodeType: "prompt", title: "描述", payload: { positivePrompt: "top" } }, position: { y: 10 } },
      { id: "t", data: { nodeType: "comfyui_image" } },
    ];
    const edges = [{ source: "a", target: "t" }, { source: "b", target: "t" }];
    expect(detectUpstreamPrompt("t", edges, nodes).positive).toBe("top");
  });
});
