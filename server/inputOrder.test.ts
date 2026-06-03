import { describe, expect, it } from "vitest";
import { trailingNumber, edgeOrderIndex } from "../client/src/lib/inputOrder";
import { detectUpstreamImages } from "../client/src/lib/comfyWorkflowParams";

describe("trailingNumber", () => {
  it("parses the trailing number in a title", () => {
    expect(trailingNumber("素材1")).toBe(1);
    expect(trailingNumber("分镜 12")).toBe(12);
    expect(trailingNumber("无编号")).toBe(Number.POSITIVE_INFINITY);
    expect(trailingNumber(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("edgeOrderIndex", () => {
  const nodes = [
    { id: "a", position: { y: 300 }, data: { title: "素材2" } },
    { id: "b", position: { y: 100 }, data: { title: "素材1" } },
    { id: "c", position: { y: 50 }, data: { title: "分镜1" } },
    { id: "t", position: { y: 0 }, data: { title: "工作流" } },
  ];
  // edges added in the order a, b, c → but ordering should be by title number then Y
  const edges = [
    { id: "e_a", source: "a", target: "t" }, // 素材2
    { id: "e_b", source: "b", target: "t" }, // 素材1
    { id: "e_c", source: "c", target: "t" }, // 分镜1
  ];
  it("orders incoming edges by [title number, Y, edge order]", () => {
    // number: 素材1=1, 分镜1=1 (tie) → Y: 分镜1(y50) before 素材1(y100); then 素材2=2
    expect(edgeOrderIndex("e_c", "in", "t", edges, nodes).index).toBe(0); // 分镜1
    expect(edgeOrderIndex("e_b", "in", "t", edges, nodes).index).toBe(1); // 素材1
    expect(edgeOrderIndex("e_a", "in", "t", edges, nodes).index).toBe(2); // 素材2
    expect(edgeOrderIndex("e_a", "in", "t", edges, nodes).total).toBe(3);
  });
});

describe("detectUpstreamImages uses the smart order", () => {
  it("returns image URLs ordered by source title number, not connection order", () => {
    const nodes = [
      { id: "a", position: { y: 0 }, data: { nodeType: "image_gen", title: "素材2", payload: { imageUrl: "/2.png" } } },
      { id: "b", position: { y: 0 }, data: { nodeType: "image_gen", title: "素材1", payload: { imageUrl: "/1.png" } } },
      { id: "t", position: { y: 0 }, data: { nodeType: "comfyui_workflow", title: "wf", payload: {} } },
    ];
    const edges = [{ source: "a", target: "t" }, { source: "b", target: "t" }];
    expect(detectUpstreamImages("t", edges, nodes)).toEqual(["/1.png", "/2.png"]);
  });
});
