import { describe, it, expect } from "vitest";
import { runPreflight, type PFNode, type PFEdge } from "./preflight";

function node(id: string, nodeType: string, payload: Record<string, unknown> = {}, title = id): PFNode {
  return { id, data: { nodeType: nodeType as PFNode["data"]["nodeType"], title, payload } };
}

describe("runPreflight", () => {
  it("clean chain passes with no issues", () => {
    const nodes = [
      node("s", "script", { synopsis: "一个故事" }),
      node("b", "storyboard", { description: "镜头一" }),
      node("v", "video_task"),
    ];
    const edges: PFEdge[] = [
      { source: "s", target: "b" },
      { source: "b", target: "v" },
    ];
    const r = runPreflight(nodes, edges);
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(0);
    expect(r.runnableCount).toBe(2); // storyboard + video_task
  });

  it("flags orphan node", () => {
    const r = runPreflight([node("s", "script", { synopsis: "x" })], []);
    expect(r.warningCount).toBe(1);
    expect(r.issues[0].message).toContain("孤立节点");
  });

  it("flags consumer node missing input as error", () => {
    // v (video_task) has an outgoing edge (not orphan) but no incoming → must error.
    const nodes = [node("v", "video_task"), node("m", "merge")];
    const r = runPreflight(nodes, [{ source: "v", target: "m" }]);
    const err = r.issues.find((i) => i.nodeId === "v");
    expect(err?.severity).toBe("error");
    expect(err?.message).toContain("缺少输入");
  });

  it("flags missing required field", () => {
    const nodes = [node("s", "script", {}), node("b", "storyboard", {})];
    const r = runPreflight(nodes, [{ source: "s", target: "b" }]);
    const msgs = r.issues.map((i) => i.message).join(" ");
    expect(msgs).toContain("剧情梗概");
    expect(msgs).toContain("分镜描述");
  });

  it("detects a cycle as error", () => {
    const nodes = [node("a", "video_task"), node("b", "merge"), node("c", "overlay")];
    const edges: PFEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
    ];
    const r = runPreflight(nodes, edges);
    expect(r.issues.some((i) => i.message.includes("循环依赖"))).toBe(true);
  });

  it("ignores agent and note nodes", () => {
    const r = runPreflight([node("ag", "agent"), node("nt", "note")], []);
    expect(r.issues.length).toBe(0);
  });

  it("estimates whole-canvas budget over nodes", () => {
    const nodes = [node("v1", "video_task"), node("v2", "video_task"), node("c", "comfyui_image")];
    const r = runPreflight(nodes, [
      { source: "x", target: "v1" }, // give them inputs so no error noise
    ]);
    expect(r.budget.byModelCount).toBe(2);
    expect(r.budget.localCount).toBe(1);
  });
});
