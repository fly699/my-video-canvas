import { describe, it, expect } from "vitest";
import { characterReferenceImages, characterHasConditioning, deriveCharacterConditioning, connectedCharacterRefImages, connectedSceneRefImages, connectedCharacterLora, mentionedCharacters, stripCharacterMentions, effectiveCharacters, effectiveCharacterRefImages, effectiveSceneRefImages, setLibraryCharacters, libraryOverlayByName, characterReferenceAudios, characterReferenceVideos, characterHasMedia, effectiveCharacterAudioRefs, effectiveCharacterVideoRefs } from "./characterConditioning";
import type { CharacterNodeData } from "../../../shared/types";

const char = (over: Partial<CharacterNodeData>): CharacterNodeData => ({ characterKind: "person", ...over });

describe("characterReferenceImages", () => {
  it("collects main + extra views, de-duped and trimmed", () => {
    expect(characterReferenceImages(char({ referenceImageUrl: "a.png", additionalImageUrls: ["b.png", "a.png", "  "] }))).toEqual(["a.png", "b.png"]);
    expect(characterReferenceImages(char({}))).toEqual([]);
  });
});

describe("characterHasConditioning", () => {
  it("true when there's a ref image or a LoRA", () => {
    expect(characterHasConditioning(char({ referenceImageUrl: "a.png" }))).toBe(true);
    expect(characterHasConditioning(char({ loraName: "hero.safetensors" }))).toBe(true);
    expect(characterHasConditioning(char({ name: "Bob" }))).toBe(false);
  });
});

describe("deriveCharacterConditioning", () => {
  it("fills IPAdapter images + weight when the node has none", () => {
    const p = deriveCharacterConditioning(char({ referenceImageUrl: "face.png", additionalImageUrls: ["side.png"], ipadapterWeight: 1.1 }), {});
    expect(p.ipadapter).toEqual({ model: "", imageUrl: "face.png", imageUrls: ["face.png", "side.png"], clipVision: undefined, weight: 1.1 });
  });

  it("preserves an existing IPAdapter model/clipVision/weight while filling images", () => {
    const p = deriveCharacterConditioning(char({ referenceImageUrl: "face.png" }), { ipadapter: { model: "ip-adapter.safetensors", imageUrl: "", clipVision: "clip_vision.safetensors", weight: 0.5 } });
    expect(p.ipadapter).toEqual({ model: "ip-adapter.safetensors", imageUrl: "face.png", imageUrls: ["face.png"], clipVision: "clip_vision.safetensors", weight: 0.5 });
  });

  it("does NOT touch IPAdapter when the node already has reference images (non-destructive)", () => {
    const p = deriveCharacterConditioning(char({ referenceImageUrl: "face.png" }), { ipadapter: { model: "m", imageUrl: "", imageUrls: ["user.png"] } });
    expect(p.ipadapter).toBeUndefined();
  });

  it("appends the character LoRA once, without duplicating", () => {
    const p1 = deriveCharacterConditioning(char({ loraName: "hero.safetensors", loraStrength: 0.7 }), { loras: [{ name: "style.safetensors", strengthModel: 1 }] });
    expect(p1.loras).toEqual([{ name: "style.safetensors", strengthModel: 1 }, { name: "hero.safetensors", strengthModel: 0.7 }]);

    const p2 = deriveCharacterConditioning(char({ loraName: "hero.safetensors" }), { loras: [{ name: "hero.safetensors", strengthModel: 1 }] });
    expect(p2.loras).toBeUndefined();
  });

  it("returns an empty patch for a text-only character", () => {
    expect(deriveCharacterConditioning(char({ name: "Bob", outfit: "suit" }), {})).toEqual({});
  });
});

describe("connectedCharacterRefImages", () => {
  const N = (id: string, nodeType: string, payload?: unknown) => ({ id, data: { nodeType, payload } });
  it("collects all views from connected character nodes (de-duped), ignoring non-characters", () => {
    const nodes = [
      N("c1", "character", { characterKind: "person", referenceImageUrl: "a.png", additionalImageUrls: ["b.png"] }),
      N("c2", "character", { characterKind: "person", referenceImageUrl: "b.png", additionalImageUrls: ["c.png"] }),
      N("p1", "prompt", { positivePrompt: "x" }),
      N("vt", "video_task", {}),
    ];
    const edges = [
      { source: "c1", target: "vt" },
      { source: "c2", target: "vt" },
      { source: "p1", target: "vt" },
    ];
    expect(connectedCharacterRefImages("vt", edges, nodes)).toEqual(["a.png", "b.png", "c.png"]);
  });
  it("returns [] when no character is connected", () => {
    const nodes = [N("a", "asset", { url: "x.png" })];
    expect(connectedCharacterRefImages("vt", [{ source: "a", target: "vt" }], nodes)).toEqual([]);
  });
  it("orders by position (topmost character is primary) regardless of edge order", () => {
    const P = (id: string, y: number, url: string) => ({ id, data: { nodeType: "character", payload: { characterKind: "person", referenceImageUrl: url } }, position: { x: 0, y } });
    const nodes = [P("low", 500, "low.png"), P("high", 100, "high.png"), N("vt", "video_task", {})];
    // edges list the low character first, but the higher (smaller y) wins priority
    const edges = [{ source: "low", target: "vt" }, { source: "high", target: "vt" }];
    expect(connectedCharacterRefImages("vt", edges, nodes)).toEqual(["high.png", "low.png"]);
  });
});

describe("connectedCharacterLora", () => {
  const N = (id: string, nodeType: string, payload?: unknown, y = 0) => ({ id, data: { nodeType, payload }, position: { x: 0, y } });
  it("returns the topmost connected character's LoRA", () => {
    const nodes = [
      N("c1", "character", { characterKind: "person", loraName: "low.safetensors" }, 500),
      N("c2", "character", { characterKind: "person", loraName: "hi.safetensors", loraStrength: 0.6 }, 100),
      N("wf", "comfyui_workflow", {}),
    ];
    const edges = [{ source: "c1", target: "wf" }, { source: "c2", target: "wf" }];
    expect(connectedCharacterLora("wf", edges, nodes)).toEqual({ name: "hi.safetensors", strengthModel: 0.6 });
  });
  it("returns null when no connected character has a LoRA", () => {
    const nodes = [N("c1", "character", { characterKind: "person" }), N("wf", "comfyui_workflow", {})];
    expect(connectedCharacterLora("wf", [{ source: "c1", target: "wf" }], nodes)).toBeNull();
  });
});

describe("scene characters are excluded from identity (image/LoRA)", () => {
  const N = (id: string, payload: unknown, y = 0) => ({ id, data: { nodeType: "character", payload }, position: { x: 0, y } });
  it("connectedCharacterRefImages skips scene-kind nodes", () => {
    const nodes = [
      N("person", { characterKind: "person", referenceImageUrl: "face.png" }, 100),
      N("scene", { characterKind: "scene", referenceImageUrl: "street.png" }, 200),
    ];
    const edges = [{ source: "person", target: "x" }, { source: "scene", target: "x" }];
    expect(connectedCharacterRefImages("x", edges, nodes)).toEqual(["face.png"]);
  });
  it("connectedCharacterLora skips scene-kind nodes", () => {
    const nodes = [N("scene", { characterKind: "scene", loraName: "loc.safetensors" }, 100), N("person", { characterKind: "person", loraName: "hero.safetensors" }, 200)];
    const edges = [{ source: "scene", target: "x" }, { source: "person", target: "x" }];
    expect(connectedCharacterLora("x", edges, nodes)?.name).toBe("hero.safetensors");
  });
  it("deriveCharacterConditioning returns empty for a scene", () => {
    expect(deriveCharacterConditioning({ characterKind: "scene", referenceImageUrl: "street.png" }, {})).toEqual({});
  });
  it("connectedSceneRefImages returns ONLY scene-kind images (the complement)", () => {
    const nodes = [
      N("person", { characterKind: "person", referenceImageUrl: "face.png" }, 100),
      N("scene", { characterKind: "scene", referenceImageUrl: "street.png", additionalImageUrls: ["alley.png"] }, 200),
    ];
    const edges = [{ source: "person", target: "x" }, { source: "scene", target: "x" }];
    expect(connectedSceneRefImages("x", edges, nodes)).toEqual(["street.png", "alley.png"]);
    // person + scene refs are disjoint
    expect(connectedCharacterRefImages("x", edges, nodes)).toEqual(["face.png"]);
  });
});

describe("@角色 提及解析", () => {
  const N = (id: string, payload: Partial<CharacterNodeData>, pos?: { x: number; y: number }) =>
    ({ id, data: { nodeType: "character", payload: { characterKind: "person", ...payload } }, position: pos });
  const nodes = [
    N("c1", { name: "张三", referenceImageUrl: "z3.png" }, { x: 0, y: 0 }),
    N("c2", { name: "张三丰", referenceImageUrl: "z3f.png" }, { x: 0, y: 100 }),
    N("s1", { characterKind: "scene", sceneName: "竹林", referenceImageUrl: "zl.png" }, { x: 0, y: 200 }),
    { id: "p1", data: { nodeType: "prompt", payload: {} } },
  ];

  it("识别 @名字 提及（长名优先，不被短名吃掉）", () => {
    const m = mentionedCharacters("一个男人 @张三丰 在 @竹林", nodes).map((c) => c.name ?? c.sceneName);
    expect(m).toContain("张三丰");
    expect(m).toContain("竹林");
    expect(m).not.toContain("张三"); // @张三丰 不应额外匹配出 @张三
  });

  it("无 @ 时返回空、原样", () => {
    expect(mentionedCharacters("普通提示词", nodes)).toEqual([]);
    expect(stripCharacterMentions("普通提示词", nodes)).toBe("普通提示词");
  });

  it("去掉字面量 @名字", () => {
    expect(stripCharacterMentions("男人 @张三 跑步", nodes)).toBe("男人 跑步");
  });

  it("effectiveCharacters 合并连线 + 提及并去重", () => {
    const edges = [{ source: "c1", target: "vt" }];
    const names = effectiveCharacters("vt", "还有 @张三丰", edges, nodes).map((c) => c.name);
    expect(names).toEqual(["张三", "张三丰"]); // 连线的张三 + 提及的张三丰
  });

  it("effectiveCharacterRefImages 含被 @ 的人物参考图（场景不计入身份参考）", () => {
    expect(effectiveCharacterRefImages("vt", "@张三 @竹林", [], nodes)).toEqual(["z3.png"]);
  });

  it("同名节点去重：两个同名「林晓」+ 两个同名「场景1」都连线时，各只引用一个（修复凭空多出相同角色/场景）", () => {
    const dup = [
      N("a1", { name: "林晓", referenceImageUrl: "lx-a.png" }, { x: 0, y: 0 }),
      N("a2", { name: "林晓", referenceImageUrl: "lx-b.png" }, { x: 0, y: 100 }),
      N("sc1", { characterKind: "scene", sceneName: "场景1", referenceImageUrl: "s-a.png" }, { x: 0, y: 200 }),
      N("sc2", { characterKind: "scene", sceneName: "场景1", referenceImageUrl: "s-b.png" }, { x: 0, y: 300 }),
    ];
    const edges = [
      { source: "a1", target: "ig" }, { source: "a2", target: "ig" },
      { source: "sc1", target: "ig" }, { source: "sc2", target: "ig" },
    ];
    // 位置靠上的（先出现的）优先，同名的第二个被去重丢弃。
    expect(effectiveCharacterRefImages("ig", "", edges, dup)).toEqual(["lx-a.png"]);
    expect(effectiveSceneRefImages("ig", "", edges, dup)).toEqual(["s-a.png"]);
    expect(effectiveCharacters("ig", "", edges, dup).map((c) => c.name ?? c.sceneName)).toEqual(["林晓", "场景1"]);
  });

  it("角色库回退：画布无该角色节点，@引用库里角色也生效；画布同名节点优先", () => {
    // 库里有「阿狸」(人物) + 「茶室」(场景)，画布上都没有对应节点。
    setLibraryCharacters([
      { id: "lib:1", data: { nodeType: "character", payload: { characterKind: "person", name: "阿狸", referenceImageUrl: "ali.png" } } },
      { id: "lib:2", data: { nodeType: "character", payload: { characterKind: "scene", sceneName: "茶室", referenceImageUrl: "teahouse.png" } } },
    ]);
    try {
      // 画布 nodes 为空，但 @阿狸 / @茶室 仍能命中库里的角色并注入参考图。
      expect(mentionedCharacters("@阿狸 @茶室", []).map((c) => c.name ?? c.sceneName)).toEqual(["阿狸", "茶室"]);
      expect(effectiveCharacterRefImages("ig", "@阿狸", [], [])).toEqual(["ali.png"]);
      expect(effectiveSceneRefImages("ig", "@茶室", [], [])).toEqual(["teahouse.png"]);
      // 画布上有同名「阿狸」节点（不同图）时，画布优先。
      const onCanvas = [N("c1", { name: "阿狸", referenceImageUrl: "ali-canvas.png" })];
      expect(effectiveCharacterRefImages("ig", "@阿狸", [], onCanvas)).toEqual(["ali-canvas.png"]);
    } finally {
      setLibraryCharacters([]); // 复位，避免污染其它用例
    }
  });
});

describe("角色携带音频/视频参考（@音频 / @视频）", () => {
  const N = (id: string, payload: Partial<CharacterNodeData>, pos?: { x: number; y: number }) =>
    ({ id, data: { nodeType: "character", payload }, position: pos ?? { x: 0, y: 0 } });

  it("characterReferenceAudios / Videos：主项 + 附加项，去重去空", () => {
    expect(characterReferenceAudios(char({ referenceAudioUrl: "a.mp3", additionalAudioUrls: ["b.mp3", "a.mp3", " "] }))).toEqual(["a.mp3", "b.mp3"]);
    expect(characterReferenceVideos(char({ referenceVideoUrl: "v.mp4", additionalVideoUrls: ["w.mp4"] }))).toEqual(["v.mp4", "w.mp4"]);
    expect(characterReferenceAudios(char({}))).toEqual([]);
  });

  it("characterHasMedia：有音频或视频参考即为真", () => {
    expect(characterHasMedia(char({ referenceAudioUrl: "a.mp3" }))).toBe(true);
    expect(characterHasMedia(char({ referenceVideoUrl: "v.mp4" }))).toBe(true);
    expect(characterHasMedia(char({ referenceImageUrl: "i.png" }))).toBe(false);
  });

  it("effectiveCharacterAudioRefs / VideoRefs：连线 + @提及合并去重", () => {
    const nodes = [
      N("c1", { name: "主角", referenceAudioUrl: "voice1.mp3", referenceVideoUrl: "move1.mp4" }, { x: 0, y: 0 }),
      N("c2", { name: "配角", referenceAudioUrl: "voice2.mp3" }, { x: 0, y: 100 }),
    ];
    // c1 连线 → 拿到其音/视频；@配角 → 补充 voice2。
    const edges = [{ source: "c1", target: "vt" }];
    expect(effectiveCharacterAudioRefs("vt", "@配角", edges, nodes)).toEqual(["voice1.mp3", "voice2.mp3"]);
    expect(effectiveCharacterVideoRefs("vt", "@配角", edges, nodes)).toEqual(["move1.mp4"]);
    // 无连线无提及 → 空。
    expect(effectiveCharacterAudioRefs("vt", "", [], nodes)).toEqual([]);
  });
});

describe("libraryOverlayByName（@角色 从角色库代入）", () => {
  const libNode = (payload: Partial<CharacterNodeData>, kind: "person" | "scene" = "person") =>
    ({ id: "lib:1", data: { nodeType: "character" as const, payload: { characterKind: kind, ...payload } } });

  const LIN = {
    name: "林晓", role: "侦探", appearance: "短发女性",
    referenceImageUrl: "lin.png", additionalImageUrls: ["lin_side.png"],
    loraName: "lin.safetensors", loraStrength: 0.9, voiceId: "v_lin", consistencySeed: 42,
  } as Partial<CharacterNodeData>;

  it("conditioning：只代入参考图/LoRA/语音，保留智能体写的文字字段", () => {
    setLibraryCharacters([libNode(LIN)]);
    const agent: CharacterNodeData = { characterKind: "person", name: "林晓", appearance: "本剧定制外观", role: "女主" };
    const overlay = libraryOverlayByName("林晓", "person", "conditioning", agent);
    expect(overlay).toMatchObject({ referenceImageUrl: "lin.png", additionalImageUrls: ["lin_side.png"], loraName: "lin.safetensors", loraStrength: 0.9, voiceId: "v_lin", consistencySeed: 42 });
    // 文字字段不在 conditioning 的代入范围内（由调用方保留智能体所写）。
    expect(overlay).not.toHaveProperty("appearance");
    expect(overlay).not.toHaveProperty("role");
  });

  it("full：代入库里全部非空字段（覆盖智能体同名字段，跳过 characterKind）", () => {
    setLibraryCharacters([libNode(LIN)]);
    const agent: CharacterNodeData = { characterKind: "person", name: "林晓", appearance: "本剧定制外观" };
    const overlay = libraryOverlayByName("林晓", "person", "full", agent)!;
    expect(overlay.appearance).toBe("短发女性"); // 库覆盖智能体
    expect(overlay.role).toBe("侦探");
    expect(overlay.referenceImageUrl).toBe("lin.png");
    expect(overlay).not.toHaveProperty("characterKind");
  });

  it("fillEmpty：只补智能体留空的字段，不覆盖已写的", () => {
    setLibraryCharacters([libNode(LIN)]);
    const agent: CharacterNodeData = { characterKind: "person", name: "林晓", appearance: "本剧定制外观" };
    const overlay = libraryOverlayByName("林晓", "person", "fillEmpty", agent)!;
    expect(overlay).not.toHaveProperty("appearance"); // 智能体已写 → 不覆盖
    expect(overlay.role).toBe("侦探");               // 智能体留空 → 补
    expect(overlay.referenceImageUrl).toBe("lin.png");
  });

  it("未命中（无同名角色）返回 null", () => {
    setLibraryCharacters([libNode(LIN)]);
    expect(libraryOverlayByName("不存在", "person", "conditioning", { characterKind: "person" })).toBeNull();
    expect(libraryOverlayByName("", "person", "conditioning", { characterKind: "person" })).toBeNull();
  });

  it("同名跨 kind：优先同 kind 命中", () => {
    setLibraryCharacters([
      libNode({ sceneName: "码头", sceneDescription: "夜晚的港口" }, "scene"),
      libNode({ name: "码头", referenceImageUrl: "person.png" }, "person"),
    ]);
    const sceneOverlay = libraryOverlayByName("码头", "scene", "full", { characterKind: "scene" })!;
    expect(sceneOverlay.sceneDescription).toBe("夜晚的港口");
    expect(sceneOverlay).not.toHaveProperty("referenceImageUrl");
  });
});
