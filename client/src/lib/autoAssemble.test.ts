import { describe, it, expect } from "vitest";
import { planAutoAssemble } from "./autoAssemble";

const node = (id: string, nodeType: string, payload: Record<string, unknown>) => ({ id, data: { nodeType, payload } });

describe("planAutoAssemble", () => {
  it("挑出有视频产出的视频源，跳过未完成/图像/音频", () => {
    const sel = [
      node("v1", "video_task", { resultVideoUrl: "https://x/a.mp4" }),
      node("v2", "comfyui_workflow", { outputUrl: "https://x/b.mp4", outputType: "video", status: "done" }),
      node("img", "image_gen", { imageUrl: "https://x/i.png" }),       // 图像 → 不算
      node("v3", "video_task", { status: "processing" }),                // 未完成 → 无 url → 不算
    ];
    const plan = planAutoAssemble(sel);
    expect(plan.videoNodeIds).toEqual(["v1", "v2"]);
    expect(plan.audioNodeId).toBeNull();
  });

  it("选中的音频节点识别为配乐（取第一个），不混入视频轨", () => {
    const sel = [
      node("v1", "video_task", { resultVideoUrl: "https://x/a.mp4" }),
      node("a1", "audio", { url: "https://x/music.mp3" }),
      node("a2", "audio", { url: "https://x/sfx.mp3" }),               // 第二个音频忽略
      node("v2", "clip", { outputUrl: "https://x/c.mp4" }),
    ];
    const plan = planAutoAssemble(sel);
    expect(plan.videoNodeIds).toEqual(["v1", "v2"]);
    expect(plan.audioNodeId).toBe("a1");
  });

  it("音频 asset（type=audio）也算配乐；视频 asset 仍算视频", () => {
    const sel = [
      node("va", "asset", { type: "video", url: "https://x/v.mp4" }),
      node("aa", "asset", { type: "audio", url: "https://x/m.mp3" }),
      node("v2", "video_task", { resultVideoUrl: "https://x/b.mp4" }),
    ];
    const plan = planAutoAssemble(sel);
    expect(plan.videoNodeIds).toContain("va");
    expect(plan.videoNodeIds).toContain("v2");
    expect(plan.audioNodeId).toBe("aa");
  });

  it("无视频源 → 空数组（调用方据此提示「至少 2 段」）", () => {
    expect(planAutoAssemble([node("a1", "audio", { url: "https://x/m.mp3" })])).toEqual({ videoNodeIds: [], audioNodeId: "a1" });
  });
});
