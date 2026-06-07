import { describe, it, expect } from "vitest";
import { connectedEffectPrompts, appendEffectPrompts } from "./effectPrompt";

type N = { id: string; data: { nodeType: string; payload?: unknown } };

describe("connectedEffectPrompts", () => {
  const nodes: N[] = [
    { id: "pp1", data: { nodeType: "post_process", payload: { generatedPrompt: "cinematic lighting, film grain" } } },
    { id: "pp2", data: { nodeType: "post_process", payload: { generatedPrompt: "warm color grade" } } },
    { id: "pp3", data: { nodeType: "post_process", payload: { generatedPrompt: "" } } }, // empty → skipped
    { id: "img", data: { nodeType: "image_gen", payload: {} } }, // not post_process → ignored
    { id: "t", data: { nodeType: "video_task", payload: {} } },
  ];

  it("collects generatedPrompt from connected post_process nodes only", () => {
    const edges = [{ source: "pp1", target: "t" }, { source: "pp2", target: "t" }, { source: "img", target: "t" }];
    expect(connectedEffectPrompts("t", edges, nodes)).toEqual(["cinematic lighting, film grain", "warm color grade"]);
  });

  it("skips empty generatedPrompt and non-connected nodes", () => {
    const edges = [{ source: "pp3", target: "t" }, { source: "pp1", target: "other" }];
    expect(connectedEffectPrompts("t", edges, nodes)).toEqual([]);
  });
});

describe("appendEffectPrompts", () => {
  it("appends effects comma-joined after the base", () => {
    expect(appendEffectPrompts("a girl in a park", ["cinematic", "warm grade"]))
      .toBe("a girl in a park, cinematic, warm grade");
  });
  it("no effects → base unchanged", () => {
    expect(appendEffectPrompts("base", [])).toBe("base");
  });
  it("empty base → just the effects", () => {
    expect(appendEffectPrompts("", ["x", "y"])).toBe("x, y");
  });
  it("clamps to maxLength (surrogate-safe)", () => {
    const out = appendEffectPrompts("基础", ["细".repeat(5000)], 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });
});
