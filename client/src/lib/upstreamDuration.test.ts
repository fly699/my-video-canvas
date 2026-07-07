import { describe, it, expect } from "vitest";
import { detectUpstreamStoryboardDuration, resolveComfyFramesFromDuration } from "./comfyWorkflowParams";
import { clampDurationForProvider } from "./storyboardGen";

const N = (id: string, nodeType: string, payload: unknown) => ({ id, data: { nodeType, payload } });

describe("resolveComfyFramesFromDuration（comfyui 视频按分镜时长换算 frames，保守版）", () => {
  const sb = (d: number) => [N("sb", "storyboard", { duration: d }), N("v", "comfyui_video", {})];
  const e = [{ source: "sb", target: "v" }];
  it("连分镜 + frames 未设 → 按 时长×fps 换算", () => {
    expect(resolveComfyFramesFromDuration("v", e, sb(5), undefined, 8)).toBe(40); // 5×8
    expect(resolveComfyFramesFromDuration("v", e, sb(10), undefined, 16)).toBe(160);
  });
  it("frames 仍是模板预设默认(16/25/81/97) → 覆盖", () => {
    expect(resolveComfyFramesFromDuration("v", e, sb(5), 16, 8)).toBe(40);   // animatediff 默认 16
    expect(resolveComfyFramesFromDuration("v", e, sb(3), 81, 16)).toBe(48);  // wan 默认 81
  });
  it("用户手调过帧数(非预设默认) → 尊重，不覆盖", () => {
    expect(resolveComfyFramesFromDuration("v", e, sb(20), 48, 8)).toBe(48);
  });
  it("无上游分镜 → 返回原值(不动)", () => {
    expect(resolveComfyFramesFromDuration("v", [], [N("v", "comfyui_video", {})], 16, 8)).toBe(16);
    expect(resolveComfyFramesFromDuration("v", [], [N("v", "comfyui_video", {})], undefined, 8)).toBeUndefined();
  });
  it("clamp 防跑飞：超长时长夹到 300 帧上限", () => {
    expect(resolveComfyFramesFromDuration("v", e, sb(100), undefined, 16)).toBe(300); // 100×16=1600 → 300
  });
});

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
