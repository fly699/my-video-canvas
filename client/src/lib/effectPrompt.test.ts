import { describe, it, expect } from "vitest";
import { connectedEffectPrompts, connectedEmotionPhrases, connectedInjectedPrompts, appendEffectPrompts } from "./effectPrompt";

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

describe("#336 批2 connectedEmotionPhrases（上游图片情绪→视频提示词）", () => {
  const em = (cellId: string, name: string, en: string, intensity: string) =>
    ({ appliedEmotion: { cellId, name, en, intensity } });
  const nodes: N[] = [
    { id: "imgA", data: { nodeType: "image_gen", payload: em("r1c3", "强忍悲戚", "restrained grief", "strong") } },
    { id: "imgB", data: { nodeType: "image_gen", payload: {} } }, // 无情绪 → 跳过
    { id: "imgC", data: { nodeType: "asset", payload: em("r2c2", "淡然自若", "calm composure", "moderate") } },
    { id: "vid", data: { nodeType: "video_task", payload: {} } },
  ];

  it("从连线上游「已应用情绪」的图片节点取出表情短语（含中英文命名与强度）", () => {
    const out = connectedEmotionPhrases("vid", [{ source: "imgA", target: "vid" }], nodes);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("restrained grief");
    expect(out[0]).toContain("强忍悲戚");
    expect(out[0]).toContain("intense and dramatic");
  });

  it("无 appliedEmotion 的上游节点被跳过；多个情绪源去重收集", () => {
    const edges = [{ source: "imgA", target: "vid" }, { source: "imgB", target: "vid" }, { source: "imgC", target: "vid" }];
    const out = connectedEmotionPhrases("vid", edges, nodes);
    expect(out).toHaveLength(2);
    expect(out.some((p) => p.includes("calm composure"))).toBe(true);
  });

  it("connectedInjectedPrompts = 后处理效果 + 上游情绪（效果在前）", () => {
    const withPP: N[] = [...nodes, { id: "pp", data: { nodeType: "post_process", payload: { generatedPrompt: "film grain" } } }];
    const edges = [{ source: "pp", target: "vid" }, { source: "imgA", target: "vid" }];
    const out = connectedInjectedPrompts("vid", edges, withPP);
    expect(out[0]).toBe("film grain");
    expect(out[1]).toContain("restrained grief");
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
