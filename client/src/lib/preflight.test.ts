import { describe, it, expect } from "vitest";
import { runPreflight, buildSelfHealInstruction, type PFNode, type PFEdge } from "./preflight";

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
    // m (merge) has an incoming-less... 用 clip 作纯消费型示例：无输入必 error。
    const nodes = [node("c", "clip"), node("m", "merge")];
    const r = runPreflight(nodes, [{ source: "c", target: "m" }]);
    const err = r.issues.find((i) => i.nodeId === "c");
    expect(err?.severity).toBe("error");
    expect(err?.message).toContain("缺少输入");
  });

  it("空 video_task（无提示词无输入）报错；有提示词的 t2v 不报错", () => {
    // 无提示词、无输入 → error。
    const empty = [node("v", "video_task"), node("m", "merge")];
    const r1 = runPreflight(empty, [{ source: "v", target: "m" }]);
    expect(r1.issues.find((i) => i.nodeId === "v")?.severity).toBe("error");
    // 有提示词、无输入(纯文生 t2v) → 不应有该节点的 error。
    const t2v = [node("v", "video_task", { prompt: "一只猫在跳舞" }), node("m", "merge")];
    const r2 = runPreflight(t2v, [{ source: "v", target: "m" }]);
    expect(r2.issues.find((i) => i.nodeId === "v" && i.severity === "error")).toBeUndefined();
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

  it("shot-list readiness: flags mixed missing sceneNumbers and duplicates, stays quiet otherwise", () => {
    // 部分有镜号、部分没有 → 提示补全
    const mixed = runPreflight(
      [node("s", "script", { synopsis: "x" }), node("b1", "storyboard", { description: "a", sceneNumber: 1 }), node("b2", "storyboard", { description: "b" })],
      [{ source: "s", target: "b1" }, { source: "s", target: "b2" }],
    );
    expect(mixed.issues.some((i) => i.message.includes("缺镜号"))).toBe(true);
    // 重复镜号 → 提示重编号
    const dup = runPreflight(
      [node("s", "script", { synopsis: "x" }), node("b1", "storyboard", { description: "a", sceneNumber: 2 }), node("b2", "storyboard", { description: "b", sceneNumber: 2 })],
      [{ source: "s", target: "b1" }, { source: "s", target: "b2" }],
    );
    expect(dup.issues.some((i) => i.message.includes("镜号重复"))).toBe(true);
    // 全都没有镜号（未在用镜头表）→ 不产生镜号噪声
    const none = runPreflight(
      [node("s", "script", { synopsis: "x" }), node("b1", "storyboard", { description: "a" }), node("b2", "storyboard", { description: "b" })],
      [{ source: "s", target: "b1" }, { source: "s", target: "b2" }],
    );
    expect(none.issues.some((i) => i.message.includes("镜号"))).toBe(false);
  });

  it("merge assemble hint: fires when ≥2 storyboard-traceable videos have output, silent when assembled", () => {
    const mk = (mergePayload: Record<string, unknown>) => runPreflight(
      [
        node("b1", "storyboard", { description: "a", sceneNumber: 1 }),
        node("b2", "storyboard", { description: "b", sceneNumber: 2 }),
        node("v1", "video_task", { resultVideoUrl: "https://x/1.mp4" }),
        node("v2", "video_task", { outputUrl: "https://x/2.mp4" }),
        node("m", "merge", mergePayload),
      ],
      [
        { source: "b1", target: "v1" }, { source: "b2", target: "v2" },
        { source: "v1", target: "m" }, { source: "v2", target: "m" },
      ],
    );
    expect(mk({}).issues.some((i) => i.message.includes("按镜头表装配"))).toBe(true);
    // 已装配（segTransitions 存在）→ 不再提示
    expect(mk({ segTransitions: ["fade"] }).issues.some((i) => i.message.includes("按镜头表装配"))).toBe(false);
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

describe("buildSelfHealInstruction", () => {
  const mk = (id: string, type: string, payload?: Record<string, unknown>): PFNode =>
    ({ id, data: { nodeType: type as PFNode["data"]["nodeType"], title: `${type}#${id}`, payload } });

  it("点名失败节点：id + 截断的失败原因", () => {
    const nodes = [
      mk("a", "comfyui_image", { status: "failed", errorMessage: "未配置 ComfyUI 服务器地址" }),
      mk("b", "video_task", { status: "failed", errorMessage: "x".repeat(200) }),
      mk("c", "image_gen", { status: "success" }),
    ];
    const text = buildSelfHealInstruction(nodes, []);
    expect(text).toContain("【运行失败的节点】");
    expect(text).toContain("（id=a）：未配置 ComfyUI 服务器地址");
    expect(text).toContain("…"); // 长错误截断
    expect(text).not.toContain("（id=c）"); // 成功节点不进清单
    expect(text).toContain("最小化修复");
  });

  it("体检问题清单带节点定位与严重级别", () => {
    const text = buildSelfHealInstruction([], [
      { severity: "error", nodeId: "s1", nodeTitle: "分镜#1", message: "分镜描述未填写" },
      { severity: "warning", message: "画布存在孤立节点" },
    ]);
    expect(text).toContain("【体检发现】");
    expect(text).toContain("[错误] 分镜#1（id=s1）分镜描述未填写");
    expect(text).toContain("[提醒] 画布存在孤立节点");
  });

  it("无失败且无体检问题时退回通用检查指令", () => {
    const text = buildSelfHealInstruction([mk("a", "image_gen", { status: "success" })], []);
    expect(text).toContain("请检查当前画布");
    expect(text).not.toContain("【运行失败的节点】");
  });
});
