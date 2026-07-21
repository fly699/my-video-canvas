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

import { assembleFromStoryboards, mapShotTransition, removeMergeSegmentPatch, reorderMergeSegmentsPatch } from "./storyboardGen";

describe("#281 合并段列表删段/重排：平行数组确定性跟随（此前静默错位）", () => {
  const urls = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"];
  const p = {
    inputVideoUrls: urls,
    segTransitions: ["t0", "t1", "t2"],                       // t_j = 段 j 自己的转场（管辖接缝 j→j+1）
    voiceUrls: ["va", "vb", "vc", "vd"],
    sfxUrls: [null, "sb", null, null] as (string | null)[],
    segDialogues: ["da", "db", "dc", "dd"],
    segVoiceDurations: [1, 2, 3, 4] as (number | null)[],
    sourceShots: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }],
  };
  it("删中间段：删它自己的转场，其后接缝不再前移错套；逐镜配音等同步删", () => {
    const r = removeMergeSegmentPatch(p, urls, 1); // 删 b
    expect(r.inputVideoUrls).toEqual(["a.mp4", "c.mp4", "d.mp4"]);
    expect(r.segTransitions).toEqual(["t0", "t2"]); // a→c 用 a 的 t0；c→d 仍是 t2（旧逻辑会错成 t1）
    expect(r.voiceUrls).toEqual(["va", "vc", "vd"]);
    expect(r.sfxUrls).toEqual([null, null, null]);
    expect(r.segVoiceDurations).toEqual([1, 3, 4]);
  });
  it("删末段：删最后一个接缝；删到只剩 1 段时 segTransitions 清空", () => {
    const r = removeMergeSegmentPatch(p, urls, 3);
    expect(r.segTransitions).toEqual(["t0", "t1"]);
    const two = { inputVideoUrls: ["a.mp4", "b.mp4"], segTransitions: ["t0"], voiceUrls: ["va", "vb"] };
    const r2 = removeMergeSegmentPatch(two, ["a.mp4", "b.mp4"], 0);
    expect(r2.inputVideoUrls).toEqual(["b.mp4"]);
    expect(r2.segTransitions).toBeUndefined();
  });
  it("重排：转场随段携带（段的属性），配音/音效按同一置换", () => {
    const r = reorderMergeSegmentsPatch(p, urls, 0, 2); // a 拖到第 3 位 → b,c,a,d
    expect(r.inputVideoUrls).toEqual(["b.mp4", "c.mp4", "a.mp4", "d.mp4"]);
    expect(r.segTransitions).toEqual(["t1", "t2", "t0"]); // 各段自带转场随行；末段 d 的 none 被裁掉
    expect(r.voiceUrls).toEqual(["vb", "vc", "va", "vd"]);
    expect(r.sourceShots).toEqual([{ n: 2 }, { n: 3 }, { n: 1 }, { n: 4 }]);
  });
  it("【混合态审查修复】装配后新连视频再删【追加段】：数组保留、删完健康恢复完全对齐", () => {
    // 快照 prev=[a,b,c]（装配产物），画布又连了 d → orderItems=[a,b,c,d]
    const mixed = { ...p, inputVideoUrls: ["a.mp4", "b.mp4", "c.mp4"], segTransitions: ["t0", "t1"], voiceUrls: ["va", "vb", "vc"] };
    const cur = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"];
    const r = removeMergeSegmentPatch(mixed, cur, 3); // 删追加段 d
    expect(r.inputVideoUrls).toEqual(["a.mp4", "b.mp4", "c.mp4"]);
    expect(r.segTransitions).toBeUndefined(); // 补丁未动 → 原 ["t0","t1"] 保留，与恢复后的 3 段重新完全对齐
    expect(r.voiceUrls).toBeUndefined();
  });
  it("【混合态审查修复】装配后新连视频再删【原装配段】：数组永失对位 → 清 segTransitions（长度守卫会被骗过，绝不错位发送）", () => {
    const mixed = { inputVideoUrls: ["a.mp4", "b.mp4", "c.mp4"], segTransitions: ["t0", "t1"], voiceUrls: ["va", "vb", "vc"] };
    const cur = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"];
    const r = removeMergeSegmentPatch(mixed, cur, 1); // 删原装配段 b → 剩 [a,c,d]（3 段）而 transitions 长 2 恰=3-1，若不清会错位直发
    expect(r.inputVideoUrls).toEqual(["a.mp4", "c.mp4", "d.mp4"]);
    expect(r.segTransitions).toBeUndefined(); // 显式清除
    expect("segTransitions" in r).toBe(true);
  });
  it("【混合态审查修复】重排：只在追加区内挪动（prev 仍是前缀）→ 保留；挪动原装配段 → 清转场", () => {
    const mixed = { inputVideoUrls: ["a.mp4", "b.mp4"], segTransitions: ["t0"] };
    const cur = ["a.mp4", "b.mp4", "x.mp4", "y.mp4"];
    const keep = reorderMergeSegmentsPatch(mixed, cur, 2, 3); // x/y 互换，prev [a,b] 仍是前缀
    expect(keep.inputVideoUrls).toEqual(["a.mp4", "b.mp4", "y.mp4", "x.mp4"]);
    expect("segTransitions" in keep).toBe(false); // 保留原值
    const broke = reorderMergeSegmentsPatch(mixed, cur, 0, 3); // a 挪到末尾，prev 不再是前缀
    expect(broke.inputVideoUrls).toEqual(["b.mp4", "x.mp4", "y.mp4", "a.mp4"]);
    expect(broke.segTransitions).toBeUndefined();
    expect("segTransitions" in broke).toBe(true); // 显式清除
  });
  it("#283 规划期转场（无 inputVideoUrls 快照、数量吻合）：删段/重排按位置精确跟随（用户实报删分镜后转场回退）", () => {
    const planned = { segTransitions: ["t0", "t1", "t2"] }; // 助手规划期写入，无快照
    const cur = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"];
    const del = removeMergeSegmentPatch(planned, cur, 1);
    expect(del.inputVideoUrls).toEqual(["a.mp4", "c.mp4", "d.mp4"]);
    expect(del.segTransitions).toEqual(["t0", "t2"]); // 删 b 自己的 t1，不再整体回退
    const ro = reorderMergeSegmentsPatch(planned, cur, 0, 2);
    expect(ro.inputVideoUrls).toEqual(["b.mp4", "c.mp4", "a.mp4", "d.mp4"]);
    expect(ro.segTransitions).toEqual(["t1", "t2", "t0"]); // 转场随段携带
  });
  it("长度失配的历史数据原样不动（绝不伪造）；越界/原地操作返回空补丁", () => {
    const stale = { segTransitions: ["t0"], voiceUrls: ["va"] }; // 与 4 段不匹配
    const r = removeMergeSegmentPatch(stale, urls, 1);
    expect(r.inputVideoUrls).toEqual(["a.mp4", "c.mp4", "d.mp4"]);
    expect(r.segTransitions).toBeUndefined(); // 未写入补丁 = 原样保留
    expect(r.voiceUrls).toBeUndefined();
    expect(removeMergeSegmentPatch(p, urls, 9)).toEqual({});
    expect(reorderMergeSegmentsPatch(p, urls, 2, 2)).toEqual({});
  });
});

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

  it("#300 无分镜段的配音对位：回溯最近上游 prompt 节点的下游音频（排除分镜工作流）", () => {
    const n = [
      N("m", "merge", {}),
      N("p1", "prompt", { positivePrompt: "陈默：夜色真美。" }, "镜头 1"),
      N("p2", "prompt", { positivePrompt: "街角空镜" }, "镜头 2"),
      N("ig", "image_gen", {}),
      N("v1", "video_task", { resultVideoUrl: "v1.mp4" }, "镜头 1 视频"),
      N("v2", "video_task", { resultVideoUrl: "v2.mp4" }, "镜头 2 视频"),
      N("a1", "audio", { url: "dub1.mp3", audioCategory: "dubbing", duration: 3 }),
      N("bgm", "audio", { url: "bgm.mp3", audioCategory: "music" }), // music 不作对位
    ];
    const e = [
      { source: "p1", target: "ig" }, { source: "ig", target: "v1" }, // imageFirst 隔一跳也要回溯到
      { source: "p2", target: "v2" },
      { source: "v2", target: "m" }, { source: "v1", target: "m" },
      { source: "p1", target: "a1" }, { source: "p1", target: "bgm" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    expect(r.inputVideoUrls).toEqual(["v1.mp4", "v2.mp4"]); // 标题镜号排序
    expect(r.voiceUrls).toEqual(["dub1.mp3", null]);        // prompt 下游配音对位进段 1
    expect(r.voiceDurations).toEqual([3, null]);
  });

  it("#280 多跳回溯：分镜→image_gen 出图工位→视频 的标准管线也按镜号排序（此前一跳直查回溯断链、退化成连线顺序）", () => {
    const n = [
      N("m", "merge", {}),
      N("sb1", "storyboard", { sceneNumber: 1, transition: "dissolve" }),
      N("sb2", "storyboard", { sceneNumber: 2 }),
      N("sb3", "storyboard", { sceneNumber: 3 }),
      N("ig1", "image_gen", {}), N("ig2", "image_gen", {}), N("ig3", "image_gen", {}),
      N("v1", "video_task", { resultVideoUrl: "v1.mp4" }),
      N("v2", "video_task", { resultVideoUrl: "v2.mp4" }),
      N("v3", "video_task", { resultVideoUrl: "v3.mp4" }),
    ];
    const e = [
      { source: "sb1", target: "ig1" }, { source: "ig1", target: "v1" },
      { source: "sb2", target: "ig2" }, { source: "ig2", target: "v2" },
      { source: "sb3", target: "ig3" }, { source: "ig3", target: "v3" },
      // 故意按 3→1→2 乱序连入合并
      { source: "v3", target: "m" }, { source: "v1", target: "m" }, { source: "v2", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    expect(r.inputVideoUrls).toEqual(["v1.mp4", "v2.mp4", "v3.mp4"]); // 隔工位仍按镜号
    expect(r.transitions[0]).toBe("dissolve");                        // 镜1 转场也回溯到了
    expect(r.sourceShots.map((s) => s.sb)).toEqual(["sb1", "sb2", "sb3"]);
  });

  it("#280 disabled 分镜隔着工位也整段剔除；穿透不跨 merge（不会把别镜分镜错认成本段的）", () => {
    const n = [
      N("m", "merge", {}),
      N("sb1", "storyboard", { sceneNumber: 1, disabled: true }),
      N("sb2", "storyboard", { sceneNumber: 2 }),
      N("ig1", "image_gen", {}),
      N("v1", "video_task", { resultVideoUrl: "v1.mp4" }),
      N("v2", "video_task", { resultVideoUrl: "v2.mp4" }),
      // v3 上游是另一个 merge（汇聚节点）——不得穿透去认 sb2
      N("m0", "merge", { outputUrl: "pre.mp4" }),
      N("v3", "video_task", { resultVideoUrl: "v3.mp4" }),
    ];
    const e = [
      { source: "sb1", target: "ig1" }, { source: "ig1", target: "v1" },
      { source: "sb2", target: "v2" },
      { source: "sb2", target: "m0" }, { source: "m0", target: "v3" },
      { source: "v1", target: "m" }, { source: "v2", target: "m" }, { source: "v3", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    // v1 因 sb1 disabled 剔除；v3 穿不过 merge → 无分镜 → 垫底但仍纳入
    expect(r.inputVideoUrls).toEqual(["v2.mp4", "v3.mp4"]);
    expect(r.sourceShots.map((s) => s.sb)).toEqual(["sb2", null]);
  });

  it("#280 无分镜画布也能装配：按视频节点标题镜号排序（SH 前缀/数字不在结尾都认）", () => {
    const n = [
      N("m", "merge", {}),
      N("va", "video_task", { resultVideoUrl: "a.mp4" }, "SH03 高潮"),
      N("vb", "video_task", { resultVideoUrl: "b.mp4" }, "SH01 开场"),
      N("vc", "video_task", { resultVideoUrl: "c.mp4" }, "SH02 追逐"),
    ];
    const e = [
      { source: "va", target: "m" }, { source: "vb", target: "m" }, { source: "vc", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    expect(r.inputVideoUrls).toEqual(["b.mp4", "c.mp4", "a.mp4"]); // SH01→SH02→SH03
    expect(r.shots.map((s) => s.sceneNumber)).toEqual([1, 2, 3]);
  });

  it("#280 装配保留已配置的逐缝转场（按接缝内容对齐）：助手写的 segTransitions 不再被冲成全局回退", () => {
    const n = [
      N("m", "merge", {
        // 助手已按 SH01→SH02→SH03 写好逐缝转场
        inputVideoUrls: ["b.mp4", "c.mp4", "a.mp4"],
        segTransitions: ["smoothleft", "fadeblack"],
      }),
      N("va", "video_task", { resultVideoUrl: "a.mp4" }, "SH03 高潮"),
      N("vb", "video_task", { resultVideoUrl: "b.mp4" }, "SH01 开场"),
      N("vc", "video_task", { resultVideoUrl: "c.mp4" }, "SH02 追逐"),
    ];
    const e = [
      { source: "va", target: "m" }, { source: "vb", target: "m" }, { source: "vc", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    expect(r.inputVideoUrls).toEqual(["b.mp4", "c.mp4", "a.mp4"]);
    expect(r.transitions).toEqual(["smoothleft", "fadeblack"]); // 重装配后原逐缝转场按接缝保留
  });

  it("#283 位置继承：助手规划期写入 segTransitions（无 inputVideoUrls 快照）→ 手动装配按位置继承", () => {
    const n = [
      // 助手规划期只写了 segTransitions（视频未出片、无 URL 可写快照）
      N("m", "merge", { segTransitions: ["smoothleft", "fadeblack"] }),
      N("va", "video_task", { resultVideoUrl: "a.mp4" }, "SH03 高潮"),
      N("vb", "video_task", { resultVideoUrl: "b.mp4" }, "SH01 开场"),
      N("vc", "video_task", { resultVideoUrl: "c.mp4" }, "SH02 追逐"),
    ];
    const e = [
      { source: "va", target: "m" }, { source: "vb", target: "m" }, { source: "vc", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    expect(r.inputVideoUrls).toEqual(["b.mp4", "c.mp4", "a.mp4"]);         // 仍按标题镜号排序
    expect(r.transitions).toEqual(["smoothleft", "fadeblack"]);            // 按位置继承（此前被冲成 ["none","none"]）
  });
  it("#283 位置继承数量不符 → 不继承回退（绝不错位套用）；有 URL 快照时仍以内容对齐优先", () => {
    const n = [
      N("m", "merge", { segTransitions: ["smoothleft"] }), // 1 个转场 vs 2 个接缝 → 不继承
      N("va", "video_task", { resultVideoUrl: "a.mp4" }, "SH03"),
      N("vb", "video_task", { resultVideoUrl: "b.mp4" }, "SH01"),
      N("vc", "video_task", { resultVideoUrl: "c.mp4" }, "SH02"),
    ];
    const e = [
      { source: "va", target: "m" }, { source: "vb", target: "m" }, { source: "vc", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    expect(r.transitions).toEqual(["none", "none"]); // 回退全局（默认 none），不错位
  });
  it("#280 分镜显式 transition 仍最高优先（不被旧接缝值顶掉）", () => {
    const n = [
      N("m", "merge", { inputVideoUrls: ["v1.mp4", "v2.mp4"], segTransitions: ["fadeblack"] }),
      N("sb1", "storyboard", { sceneNumber: 1, transition: "dissolve" }),
      N("sb2", "storyboard", { sceneNumber: 2 }),
      N("v1", "video_task", { resultVideoUrl: "v1.mp4" }),
      N("v2", "video_task", { resultVideoUrl: "v2.mp4" }),
    ];
    const e = [
      { source: "sb1", target: "v1" }, { source: "sb2", target: "v2" },
      { source: "v1", target: "m" }, { source: "v2", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    expect(r.transitions).toEqual(["dissolve"]); // 分镜说了算，旧接缝 fadeblack 不顶替
  });

  it("#134 参与范围：disabled 的视频工位与分镜整段跳过（与运行/估价同口径）", () => {
    const n3 = [
      N("m", "merge", {}),
      N("sb1", "storyboard", { sceneNumber: 1 }),
      N("sb2", "storyboard", { sceneNumber: 2, disabled: true }),   // 分镜被排除 → 其工位段不进
      N("sb3", "storyboard", { sceneNumber: 3 }),
      N("v1", "video_task", { resultVideoUrl: "v1.mp4" }),
      N("v2", "video_task", { resultVideoUrl: "v2.mp4" }),
      N("v3", "video_task", { resultVideoUrl: "v3.mp4", disabled: true }), // 工位被排除
      N("v4", "video_task", { resultVideoUrl: "v4.mp4" }),
      N("sb4", "storyboard", { sceneNumber: 4 }),
    ];
    const e3 = [
      { source: "sb1", target: "v1" }, { source: "sb2", target: "v2" },
      { source: "sb3", target: "v3" }, { source: "sb4", target: "v4" },
      { source: "v1", target: "m" }, { source: "v2", target: "m" },
      { source: "v3", target: "m" }, { source: "v4", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n3, e3);
    if ("error" in r) throw new Error(r.error);
    expect(r.inputVideoUrls).toEqual(["v1.mp4", "v4.mp4"]); // 镜2（分镜禁）与镜3（工位禁）都被剔除
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

  // ── #264 装配后全直切修复：三档语义 + 全局转场回退 ──────────────────────────
  it("#264 mapShotTransition 三档：显式 cut 永远硬切；已知值用自身；未设/未知才回退 fallback", () => {
    expect(mapShotTransition("cut", "dissolve")).toBe("none");        // 档1：显式硬切不被全局覆盖
    expect(mapShotTransition("match-cut", "dissolve")).toBe("none");
    expect(mapShotTransition("fade", "dissolve")).toBe("fade");       // 档2：逐镜意图最优先
    expect(mapShotTransition(undefined, "dissolve")).toBe("dissolve"); // 档3：未设 → 跟全局
    expect(mapShotTransition("", "fadeblack")).toBe("fadeblack");
    expect(mapShotTransition("某种未知转场", "fade")).toBe("fade");
    expect(mapShotTransition(undefined)).toBe("none");                // 无 fallback：旧行为不变
  });

  it("#264 中文别名映射（LLM/用户写中文不再被收敛成直切）", () => {
    expect(mapShotTransition("叠化")).toBe("dissolve");
    expect(mapShotTransition("黑场")).toBe("fadeblack");
    expect(mapShotTransition("白场")).toBe("fadewhite");
    expect(mapShotTransition("擦除")).toBe("wipe");
    expect(mapShotTransition("淡入淡出")).toBe("fade");
  });

  it("#264 装配回退全局转场：merge 设了 dissolve → 未指定转场的接缝= dissolve、显式 cut 仍= none", () => {
    const n = [
      N("m", "merge", { transition: "dissolve" }),   // 用户在合并节点设了全局叠化
      N("sb1", "storyboard", { sceneNumber: 1 }),                        // 未设转场 → 跟全局
      N("sb2", "storyboard", { sceneNumber: 2, transition: "cut" }),     // 显式硬切 → none
      N("sb3", "storyboard", { sceneNumber: 3, transition: "fadeblack" }), // 显式黑场 → 用自身
      N("v1", "video_task", { resultVideoUrl: "v1.mp4" }),
      N("v2", "video_task", { resultVideoUrl: "v2.mp4" }),
      N("v3", "video_task", { resultVideoUrl: "v3.mp4" }),
    ];
    const e = [
      { source: "sb1", target: "v1" }, { source: "sb2", target: "v2" }, { source: "sb3", target: "v3" },
      { source: "v1", target: "m" }, { source: "v2", target: "m" }, { source: "v3", target: "m" },
    ];
    const r = assembleFromStoryboards("m", n, e);
    if ("error" in r) throw new Error(r.error);
    expect(r.transitions).toEqual(["dissolve", "none"]); // 接缝1=镜1(未设→全局叠化)，接缝2=镜2(显式cut)
  });

  it("#264 零回归：merge 未设全局转场（默认直切）→ 装配行为与旧版完全一致", () => {
    const r = assembleFromStoryboards("m", nodes, edges); // fixture 的 merge payload 为空
    if ("error" in r) throw new Error(r.error);
    expect(r.transitions).toEqual(["dissolve"]); // 镜1 显式 dissolve；镜2 的 cut 语义不受影响
  });
});
