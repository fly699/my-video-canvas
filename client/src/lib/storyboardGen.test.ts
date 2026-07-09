import { describe, it, expect } from "vitest";
import { buildStoryboardGenInput } from "./storyboardGen";
import { resolvePoyoImageSize } from "./paramDefs";
import type { StoryboardNodeData } from "../../../shared/types";

describe("resolvePoyoImageSize（poyo 尺寸/比例解析优先级）", () => {
  it("用户显式 imageSize 最高优先", () => {
    expect(resolvePoyoImageSize("poyo_flux", "1:1", "9:16")).toBe("1:1");
  });
  it("无显式值 + 统一比例在模型选项内 → 采用统一比例", () => {
    expect(resolvePoyoImageSize("poyo_flux", undefined, "9:16")).toBe("9:16");
  });
  it("统一比例不在模型选项内（WAN token 模型）→ 回退模型默认", () => {
    expect(resolvePoyoImageSize("poyo_wan_image", undefined, "9:16")).toBe("1024x1024");
  });
  it("既无显式值也无统一比例 → 模型默认", () => {
    expect(resolvePoyoImageSize("poyo_flux", undefined, undefined)).toBe("16:9");
  });
});

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

  it("projectId 透传进 input（生成的关键帧才归属项目、入素材库）", () => {
    const r = buildStoryboardGenInput({ id: "sb", payload: base, nodes: [], edges: [], projectId: 42 });
    expect(r.input.projectId).toBe(42);
    // 未传时为 undefined（服务端落 null），不报错
    const r2 = buildStoryboardGenInput({ id: "sb", payload: base, nodes: [], edges: [] });
    expect(r2.input.projectId).toBeUndefined();
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

  it("镜头表运镜/景别/焦段/灯光追加进生成提示词（Shot List 真正生效）", () => {
    const p: StoryboardNodeData = { ...base, shotType: "CU", cameraMovement: "zoom-in", lens: "35mm", lighting: "golden hour" };
    const r = buildStoryboardGenInput({ id: "sb", payload: p, nodes: [], edges: [] });
    const prompt = String(r.input.prompt);
    expect(prompt).toContain("城市夜景");
    expect(prompt).toContain("close-up");        // CU → 映射成自然语
    expect(prompt).toContain("camera zooms in");  // zoom-in → 映射
    expect(prompt).toContain("35mm lens");
    expect(prompt).toContain("golden hour");
  });

  it("无运镜/灯光字段时提示词不追加多余内容", () => {
    const r = buildStoryboardGenInput({ id: "sb", payload: base, nodes: [], edges: [] });
    expect(String(r.input.prompt).trimEnd()).toBe("城市夜景");
  });

  it("soul 批量张数计入 count；普通模型 imageN 计入", () => {
    const soul = buildStoryboardGenInput({ id: "sb", payload: { ...base, imageModel: "hf_soul_standard" as StoryboardNodeData["imageModel"], batchSize: 4 }, nodes: [], edges: [] });
    expect(soul.count).toBe(4);
    expect(soul.input.batchSize).toBe(4);
  });

  it("poyo 分镜：统一比例（poyoAspectRatio）升级为 imageSize，不再被默认遮蔽", () => {
    // poyo_flux 的 imageSize 选项含比例串 → 统一比例 9:16 应成为 imageSize（而非默认 16:9）。
    const p = { ...base, imageModel: "poyo_flux" as StoryboardNodeData["imageModel"], poyoAspectRatio: "9:16" } as StoryboardNodeData;
    const r = buildStoryboardGenInput({ id: "sb", payload: p, nodes: [], edges: [] });
    expect(r.input.imageSize).toBe("9:16");
  });

  it("poyo 分镜：WAN 只收 WxH token，统一比例不适用 → 回退默认尺寸", () => {
    const p = { ...base, imageModel: "poyo_wan_image" as StoryboardNodeData["imageModel"], poyoAspectRatio: "9:16" } as StoryboardNodeData;
    const r = buildStoryboardGenInput({ id: "sb", payload: p, nodes: [], edges: [] });
    expect(r.input.imageSize).toBe("1024x1024"); // 默认 token，未被非法的 9:16 污染
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
    expect(r.sfxUrls).toEqual([null, null]);                // 无音效节点
  });

  it("音频按类别分轨：sfx→音效轨、music 排除、dubbing/未标→配音轨", () => {
    const withSfx = [
      ...nodes,
      N("fx2", "audio", { url: "rain.mp3", audioCategory: "sfx" }),
      N("bgm", "audio", { url: "bgm.mp3", audioCategory: "music" }),
    ];
    const e2 = [...edges, { source: "sb2", target: "fx2" }, { source: "sb2", target: "bgm" }];
    const r = assembleFromStoryboards("m", withSfx, e2);
    if ("error" in r) throw new Error(r.error);
    expect(r.voiceUrls).toEqual(["voice1.mp3", null]);  // music 不进配音轨
    expect(r.sfxUrls).toEqual([null, "rain.mp3"]);      // sfx 进音效轨
    expect(r.shots[1].hasSfx).toBe(true);
    expect(r.shots[1].hasVoice).toBe(false);
  });

  it("comfyui_workflow 视频运行纳入装配、出图运行跳过；sourceShots 绑定段↔节点", () => {
    const withComfy = [
      N("m2", "merge", {}),
      N("sb1", "storyboard", { sceneNumber: 1, transition: "fade" }),
      N("sb2", "storyboard", { sceneNumber: 2 }),
      N("cw1", "comfyui_workflow", { outputUrl: "w1.mp4", outputType: "video" }),
      N("cw2", "comfyui_workflow", { outputUrl: "w2.mp4" }),          // outputType 未标 → 视频对待
      N("cwImg", "comfyui_workflow", { outputUrl: "x.png", outputType: "image" }), // 出图运行 → 跳过
    ];
    const e2 = [
      { source: "sb1", target: "cw1" }, { source: "sb2", target: "cw2" },
      { source: "cw1", target: "m2" }, { source: "cw2", target: "m2" }, { source: "cwImg", target: "m2" },
    ];
    const r = assembleFromStoryboards("m2", withComfy, e2);
    if ("error" in r) throw new Error(r.error);
    expect(r.inputVideoUrls).toEqual(["w1.mp4", "w2.mp4"]);
    expect(r.sourceShots).toEqual([
      { sb: "sb1", vid: "cw1", num: 1 },
      { sb: "sb2", vid: "cw2", num: 2 },
    ]);
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
