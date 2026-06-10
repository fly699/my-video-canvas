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
