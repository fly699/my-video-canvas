import { describe, it, expect } from "vitest";
import { detectUpstreamStoryboardDuration } from "./comfyWorkflowParams";
import { clampDurationForProvider } from "./storyboardGen";

const N = (id: string, nodeType: string, payload: unknown) => ({ id, data: { nodeType, payload } });

describe("detectUpstreamStoryboardDuration（修「分镜都 6 秒」：video_task 继承上游分镜时长）", () => {
  it("直连上游分镜有正数 duration → 返回它", () => {
    const nodes = [N("sb", "storyboard", { duration: 5 }), N("v", "video_task", {})];
    const edges = [{ source: "sb", target: "v" }];
    expect(detectUpstreamStoryboardDuration("v", edges, nodes)).toBe(5);
  });

  it("上游分镜无 duration / 非正数 → undefined（交给 provider 默认或自身 params）", () => {
    expect(detectUpstreamStoryboardDuration("v", [{ source: "sb", target: "v" }], [N("sb", "storyboard", {}), N("v", "video_task", {})])).toBeUndefined();
    expect(detectUpstreamStoryboardDuration("v", [{ source: "sb", target: "v" }], [N("sb", "storyboard", { duration: 0 }), N("v", "video_task", {})])).toBeUndefined();
  });

  it("上游不是分镜（如 prompt 节点）→ undefined", () => {
    expect(detectUpstreamStoryboardDuration("v", [{ source: "p", target: "v" }], [N("p", "prompt", { duration: 8 }), N("v", "video_task", {})])).toBeUndefined();
  });

  it("无上游连线 → undefined", () => {
    expect(detectUpstreamStoryboardDuration("v", [], [N("v", "video_task", {})])).toBeUndefined();
  });

  it("端到端：分镜 duration=5 经 clampDurationForProvider 落到 kie_grok_i2v 的 6-30 range（clamp 到 6）", () => {
    // kie_grok_i2v duration range min 6 → 5 会被夹到 6（合法档位）；关键是「传了」而非丢默认。
    const grokDefs = [{ type: "range", key: "duration", min: 6, max: 30 }];
    expect(clampDurationForProvider(grokDefs, 5)).toBe(6);   // 5 < min → 6
    expect(clampDurationForProvider(grokDefs, 12)).toBe(12); // range 内原样
    // range provider 且未提供 duration → undefined（用模型默认），不是硬塞
    expect(clampDurationForProvider(grokDefs, undefined)).toBeUndefined();
  });

  it("select 型 provider：分镜 duration 就近映射到合法档位", () => {
    const selDefs = [{ type: "select", key: "duration", options: [{ value: 5 }, { value: 10 }] }];
    expect(clampDurationForProvider(selDefs, 5)).toBe(5);
    expect(clampDurationForProvider(selDefs, 7)).toBe(5);  // 就近（|7-5|<|7-10|）
    expect(clampDurationForProvider(selDefs, 9)).toBe(10);
  });
});
