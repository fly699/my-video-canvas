// #268 守卫：口令版动态样片的镜头收集口径（镜号排序 / disabled / 无图跳过 / 配音对位）
// 与解组动作的 apply 层行为。渲染轮询走真实 tRPC，不在单测覆盖（真机验证）。
import { describe, it, expect, beforeEach } from "vitest";
import { collectAnimaticShots } from "./animaticRun";
import { applyAgentOperations } from "./agentApply";
import { useCanvasStore } from "../hooks/useCanvasStore";
import type { AgentOperation } from "../../../shared/types";

const N = (id: string, nodeType: string, payload: Record<string, unknown>) =>
  ({ id, data: { nodeType, payload } });

describe("collectAnimaticShots（#268）", () => {
  it("按镜号排序、disabled 与无图跳过、逐镜配音对位（sfx 排除）", () => {
    const nodes = [
      N("s2", "storyboard", { sceneNumber: 2, imageUrl: "b.png", duration: 4, transition: "dissolve" }),
      N("s1", "storyboard", { sceneNumber: 1, imageUrl: "a.png", duration: 3 }),
      N("s3", "storyboard", { sceneNumber: 3 }),                                  // 无图 → 跳过但计数
      N("s4", "storyboard", { sceneNumber: 4, imageUrl: "d.png", disabled: true }), // 跳过参与 → 不计
      N("v1", "audio", { url: "voice.mp3", duration: 2.5 }),
      N("fx", "audio", { url: "boom.mp3", audioCategory: "sfx" }),
    ];
    const edges = [
      { source: "s1", target: "v1" },
      { source: "s2", target: "fx" }, // sfx 不算配音
    ];
    const r = collectAnimaticShots(nodes, edges);
    expect(r.total).toBe(3);            // s1/s2/s3（s4 disabled 不计）
    expect(r.skippedNoImage).toBe(1);   // s3
    expect(r.shots.map((s) => s.imageUrl)).toEqual(["a.png", "b.png"]); // 镜号升序
    expect(r.shots[0].voiceUrl).toBe("voice.mp3");
    expect(r.shots[0].voiceDuration).toBe(2.5);
    expect(r.shots[1].voiceUrl).toBeNull(); // sfx 不进配音轨
  });
});

describe("#268 ungroup 口令（apply 层）", () => {
  beforeEach(() => {
    useCanvasStore.getState().resetCanvas();
    useCanvasStore.getState().setProjectId(1);
  });

  it("唯一群组省略 targetRef 直接解组：组容器删除、成员保留", () => {
    const st = useCanvasStore.getState();
    const a = st.addNode("script", { x: 0, y: 0 });
    const b = st.addNode("storyboard", { x: 0, y: 300 });
    st.groupSelected([a.id, b.id], "第一幕");
    expect(useCanvasStore.getState().nodes.some((n) => n.data.nodeType === "group")).toBe(true);
    const r = applyAgentOperations([{ op: "canvas", action: "ungroup" } as AgentOperation], { x: 0, y: 0 });
    expect(r.failures).toEqual([]);
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.some((n) => n.data.nodeType === "group")).toBe(false); // 容器已删
    expect(nodes.some((n) => n.id === a.id)).toBe(true);                // 成员保留
    expect(nodes.some((n) => n.id === b.id)).toBe(true);
  });

  it("无群组 / 目标不是群组 → failures 明确报错", () => {
    const r1 = applyAgentOperations([{ op: "canvas", action: "ungroup" } as AgentOperation], { x: 0, y: 0 });
    expect(r1.failures[0].reason).toContain("没有群组");
    const st = useCanvasStore.getState();
    const n = st.addNode("script", { x: 0, y: 0 });
    const r2 = applyAgentOperations([{ op: "canvas", action: "ungroup", targetRef: n.id } as AgentOperation], { x: 0, y: 0 });
    expect(r2.failures[0].reason).toContain("不是群组");
  });

  it("animatic 动作在 apply 层不消费（返回引导性失败——正常路径由聊天窗提前抽走）", () => {
    const r = applyAgentOperations([{ op: "canvas", action: "animatic" } as AgentOperation], { x: 0, y: 0 });
    expect(r.failures.length).toBe(1);
    expect(r.failures[0].reason).toContain("画布助手");
  });
});
