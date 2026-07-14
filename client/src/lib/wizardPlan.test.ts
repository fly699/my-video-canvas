import { describe, it, expect } from "vitest";
import { buildWizardOps, groupCreatedByFunction, WIZARD_DEFAULT, type WizardChoices } from "./wizardPlan";
import type { NodeType } from "../../../shared/types";

const make = (over: Partial<WizardChoices> = {}): WizardChoices => ({ ...WIZARD_DEFAULT, ...over });
const creates = (ops: ReturnType<typeof buildWizardOps>) => ops.filter((o) => o.op === "create");
const typesOf = (ops: ReturnType<typeof buildWizardOps>) => creates(ops).map((o) => o.nodeType);
const connects = (ops: ReturnType<typeof buildWizardOps>) => ops.filter((o) => o.op === "connect");

describe("buildWizardOps — 完整短片", () => {
  it("默认（film, 4 镜, 云端, 先生图, 配乐, 合成, 分镜承载）：脚本+分镜×4+图×4+视频×4+配乐+合成", () => {
    const ops = buildWizardOps(make());
    const t = typesOf(ops);
    expect(t.filter((x) => x === "script").length).toBe(1);
    expect(t.filter((x) => x === "storyboard").length).toBe(4);
    expect(t.filter((x) => x === "image_gen").length).toBe(4);
    expect(t.filter((x) => x === "video_task").length).toBe(4);
    expect(t.filter((x) => x === "audio").length).toBe(1); // 配乐
    expect(t.filter((x) => x === "merge").length).toBe(1);
    // 每镜链：script→sb→img→vid→merge
    expect(connects(ops).length).toBeGreaterThanOrEqual(4 * 3 + 4); // sb 连 4 + (sb→img,img→vid)×4 + vid→merge×4 + music→merge
  });

  it("自建 ComfyUI 来源 → 用 comfyui_image / comfyui_video 节点", () => {
    const t = typesOf(buildWizardOps(make({ source: "comfy" })));
    expect(t).toContain("comfyui_image");
    expect(t).toContain("comfyui_video");
    expect(t).not.toContain("image_gen");
    expect(t).not.toContain("video_task");
  });

  it("关闭先生图 → 无 image 节点，分镜直接连视频", () => {
    const ops = buildWizardOps(make({ imageFirst: false }));
    const t = typesOf(ops);
    expect(t.filter((x) => x === "image_gen").length).toBe(0);
    expect(t.filter((x) => x === "video_task").length).toBe(4);
  });

  it("用提示词承载（关分镜）→ 用 prompt 节点替代 storyboard", () => {
    const t = typesOf(buildWizardOps(make({ useStoryboard: false })));
    expect(t).toContain("prompt");
    expect(t).not.toContain("storyboard");
  });

  it("配音 + 字幕 → 追加 audio(tts) + subtitle 节点", () => {
    const ops = buildWizardOps(make({ addVoice: true, addSubtitle: true }));
    const t = typesOf(ops);
    // 配乐 + 配音 = 2 个 audio
    expect(t.filter((x) => x === "audio").length).toBe(2);
    expect(t).toContain("subtitle");
  });

  it("关合成 → 无 merge / subtitle", () => {
    const t = typesOf(buildWizardOps(make({ addMerge: false, addSubtitle: true })));
    expect(t).not.toContain("merge");
    expect(t).not.toContain("subtitle"); // 字幕挂在 merge 上，无 merge 则不建
  });

  it("镜头数夹在 1–30", () => {
    expect(typesOf(buildWizardOps(make({ shots: 0 }))).filter((x) => x === "storyboard").length).toBe(1);
    expect(typesOf(buildWizardOps(make({ shots: 99 }))).filter((x) => x === "storyboard").length).toBe(30);
  });
});

describe("buildWizardOps — 其它目标", () => {
  it("只出图：N 个图像节点，无脚本/视频/合成", () => {
    const t = typesOf(buildWizardOps(make({ goal: "images", shots: 3 })));
    expect(t.filter((x) => x === "image_gen").length).toBe(3);
    expect(t).not.toContain("script");
    expect(t).not.toContain("video_task");
    expect(t).not.toContain("merge");
  });

  it("只出视频：有脚本+分镜+视频，无合成默认仍搭（addMerge 默认 true）", () => {
    const t = typesOf(buildWizardOps(make({ goal: "video" })));
    expect(t).toContain("script");
    expect(t).toContain("video_task");
  });

  it("音频（配乐）：单 audio(music) 节点", () => {
    const ops = buildWizardOps(make({ goal: "audio", addVoice: false }));
    expect(creates(ops).length).toBe(1);
    expect(creates(ops)[0].nodeType).toBe("audio");
    expect((creates(ops)[0].payload as { audioCategory?: string }).audioCategory).toBe("music");
  });

  it("音频（配音）：单 audio(tts) 节点", () => {
    const ops = buildWizardOps(make({ goal: "audio", addVoice: true }));
    expect((creates(ops)[0].payload as { audioCategory?: string }).audioCategory).toBe("tts");
  });
});

describe("buildWizardOps — 比例/风格注入", () => {
  it("指定比例 → 图像节点 payload 带 aspectRatio", () => {
    const ops = buildWizardOps(make({ goal: "images", aspect: "9:16", shots: 1 }));
    expect((creates(ops)[0].payload as { aspectRatio?: string }).aspectRatio).toBe("9:16");
  });
  it("空比例 → 不写 aspectRatio", () => {
    const ops = buildWizardOps(make({ goal: "images", aspect: "", shots: 1 }));
    expect((creates(ops)[0].payload as { aspectRatio?: string }).aspectRatio).toBeUndefined();
  });
  it("风格前缀写入 prompt", () => {
    const ops = buildWizardOps(make({ goal: "images", style: "赛博朋克", shots: 1 }));
    expect((creates(ops)[0].payload as { prompt?: string }).prompt).toContain("赛博朋克");
  });
});

describe("groupCreatedByFunction — 功能分区群组", () => {
  const typeMap = (m: Record<string, NodeType>) => (id: string) => m[id];
  it("同功能 ≥2 个才成组，单节点不成组", () => {
    const groups = groupCreatedByFunction(
      ["s1", "img1", "img2", "vid1"],
      typeMap({ s1: "script", img1: "image_gen", img2: "comfyui_image", vid1: "video_task" }),
    );
    // script 只 1 个 → 不成组；image 2 个 → 成组；video 1 个 → 不成组
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("image");
    expect(keys).not.toContain("script");
    expect(keys).not.toContain("video");
    expect(groups.find((g) => g.key === "image")!.ids).toEqual(["img1", "img2"]);
  });

  it("完整短片默认建出后：分镜/生图/生视频各成组", () => {
    // 模拟 4 镜完整短片的类型分布
    const ops = buildWizardOps(make());
    const created = creates(ops).map((o, i) => ({ id: `n${i}`, type: o.nodeType! }));
    const m = Object.fromEntries(created.map((x) => [x.id, x.type])) as Record<string, NodeType>;
    const groups = groupCreatedByFunction(created.map((x) => x.id), (id) => m[id]);
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("storyboard");
    expect(keys).toContain("image");
    expect(keys).toContain("video");
  });

  it("未知类型 / 无匹配 → 跳过", () => {
    const groups = groupCreatedByFunction(["x1", "x2"], () => undefined);
    expect(groups.length).toBe(0);
  });

  it("按固定功能顺序返回", () => {
    const groups = groupCreatedByFunction(
      ["a1", "a2", "s1", "s2"],
      typeMap({ a1: "audio", a2: "audio", s1: "script", s2: "script" }),
    );
    expect(groups.map((g) => g.key)).toEqual(["script", "audio"]); // script 在 audio 之前
  });
});
