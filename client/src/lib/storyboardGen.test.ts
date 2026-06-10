import { describe, it, expect } from "vitest";
import { buildStoryboardGenInput } from "./storyboardGen";
import type { StoryboardNodeData } from "../../../shared/types";

const N = (id: string, nodeType: string, payload: unknown, title?: string) => ({ id, data: { nodeType, payload, title }, position: { x: 0, y: 0 } });

describe("buildStoryboardGenInput（分镜生图组装器）", () => {
  const base: StoryboardNodeData = { description: "d", promptText: "城市夜景", imageModel: "manus_forge" as StoryboardNodeData["imageModel"] };

  it("缺提示词时 blocked", () => {
    const r = buildStoryboardGenInput({ id: "sb", payload: { description: "" } as StoryboardNodeData, nodes: [], edges: [] });
    expect(r.blocked).toBeTruthy();
  });

  it("kie 模型：带 kieTempKey 与 aspectRatio（审计修复点）", () => {
    const r = buildStoryboardGenInput({
      id: "sb",
      payload: { ...base, imageModel: "kie_nano_banana" as StoryboardNodeData["imageModel"], aspectRatio: "16:9" },
      nodes: [], edges: [], kieTempKey: "tmp-key",
    });
    expect(r.input.kieTempKey).toBe("tmp-key");
    expect(r.input.aspectRatio).toBe("16:9");
    expect(r.input.model).toBe("kie_nano_banana");
  });

  it("非 kie 模型不带 kie 块", () => {
    const r = buildStoryboardGenInput({ id: "sb", payload: base, nodes: [], edges: [], kieTempKey: "tmp" });
    expect(r.input.kieTempKey).toBeUndefined();
  });

  it("效果注入：连接 post_process 的效果提示词被追加（审计修复点）", () => {
    const nodes = [
      N("sb", "storyboard", base),
      N("fx", "post_process", { generatedPrompt: "lens flare, dust" }),
    ];
    const edges = [{ source: "fx", target: "sb" }];
    const r = buildStoryboardGenInput({ id: "sb", payload: base, nodes, edges });
    expect(String(r.input.prompt)).toContain("城市夜景");
    // 效果词被追加（appendEffectPrompts 的具体拼接格式不锁死，仅断言包含）
    expect(String(r.input.prompt)).toContain("lens flare");
  });

  it("手动多参考图（referenceImages[]）并入 refs", () => {
    const p: StoryboardNodeData = { ...base, referenceImages: [
      { id: "a", url: "a.png" }, { id: "b", url: "b.png" },
    ] };
    const r = buildStoryboardGenInput({ id: "sb", payload: p, nodes: [], edges: [] });
    expect(r.input.referenceImageUrl).toBe("a.png");
    expect(r.input.referenceImageUrls).toEqual(["a.png", "b.png"]);
  });

  it("soul 批量张数计入 count；普通模型 imageN 计入", () => {
    const soul = buildStoryboardGenInput({ id: "sb", payload: { ...base, imageModel: "hf_soul_standard" as StoryboardNodeData["imageModel"], batchSize: 4 }, nodes: [], edges: [] });
    expect(soul.count).toBe(4);
    expect(soul.input.batchSize).toBe(4);
  });

  it("@图像名 提及并入参考（与角色图去重合并）", () => {
    const nodes = [
      N("sb", "storyboard", base),
      N("img1", "image_gen", { imageUrl: "hero.png" }, "主角图"),
    ];
    const p = { ...base, promptText: "城市夜景 @主角图" };
    const r = buildStoryboardGenInput({ id: "sb", payload: p, nodes, edges: [] });
    expect(r.input.referenceImageUrl).toBe("hero.png");
    expect(String(r.input.prompt)).not.toContain("@主角图"); // 字面量被剥离
  });
});

import { clampDurationForProvider } from "./storyboardGen";

describe("clampDurationForProvider（时长夹取）", () => {
  const sel = [{ type: "select", key: "duration", options: [{ value: 5 }, { value: 10 }] }];
  const rng = [{ type: "range", key: "duration", min: 3, max: 15 }];
  it("select：取最接近档位", () => {
    expect(clampDurationForProvider(sel, 7)).toBe(5);
    expect(clampDurationForProvider(sel, 9)).toBe(10);
    expect(clampDurationForProvider(sel, undefined)).toBe(5);
  });
  it("range：夹取到 min/max", () => {
    expect(clampDurationForProvider(rng, 20)).toBe(15);
    expect(clampDurationForProvider(rng, 1)).toBe(3);
    expect(clampDurationForProvider(rng, 8)).toBe(8);
  });
  it("无 duration 定义（固定时长模型）→ undefined", () => {
    expect(clampDurationForProvider([{ type: "select", key: "aspectRatio" }], 8)).toBeUndefined();
    expect(clampDurationForProvider(undefined, 8)).toBeUndefined();
  });
});

import { assembleFromStoryboards, mapShotTransition } from "./storyboardGen";

describe("assembleFromStoryboards（装配端收集）", () => {
  const nodes = [
    N("m", "merge", {}),
    N("sb1", "storyboard", { sceneNumber: 1, transition: "dissolve", dialogue: "hi" }),
    N("sb2", "storyboard", { sceneNumber: 2, transition: "cut" }),
    N("v1", "video_task", { resultVideoUrl: "v1.mp4" }),
    N("v2", "video_task", { resultVideoUrl: "v2.mp4" }),
    N("a1", "audio", { url: "voice1.mp3" }),
  ];
  const edges = [
    { source: "sb1", target: "v1" }, { source: "sb2", target: "v2" },
    { source: "v2", target: "m" }, { source: "v1", target: "m" }, // 故意乱序连入
    { source: "sb1", target: "a1" },
  ];

  it("按镜号排序 + 逐切点转场 + 配音对位", () => {
    const r = assembleFromStoryboards("m", nodes, edges);
    if ("error" in r) throw new Error(r.error);
    expect(r.inputVideoUrls).toEqual(["v1.mp4", "v2.mp4"]); // 连线乱序仍按镜号
    expect(r.transitions).toEqual(["dissolve"]);            // 镜1→镜2 用镜1 的 transition
    expect(r.voiceUrls).toEqual(["voice1.mp3", null]);      // 镜1 有配音、镜2 无
  });

  it("少于 2 个可装配段时报错", () => {
    const r = assembleFromStoryboards("m", nodes, edges.filter((e) => e.source !== "v2"));
    expect("error" in r).toBe(true);
  });

  it("mapShotTransition：cut/match-cut→none", () => {
    expect(mapShotTransition("cut")).toBe("none");
    expect(mapShotTransition("match-cut")).toBe("none");
    expect(mapShotTransition("wipe")).toBe("wipe");
    expect(mapShotTransition(undefined)).toBe("none");
  });
});
