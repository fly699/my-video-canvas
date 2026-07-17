import { describe, it, expect } from "vitest";
import { collectVideoRefMedia, SUPPORTS_REF_VIDEO, SUPPORTS_REF_AUDIO, planCharacterRefs } from "./videoRefMedia";

type N = { id: string; data: { nodeType: string; payload?: Record<string, unknown>; title?: string }; position: { x: number; y: number } };
const node = (id: string, nodeType: string, payload: Record<string, unknown> = {}, y = 0): N =>
  ({ id, data: { nodeType, payload, title: id }, position: { x: 0, y } });
const edge = (source: string, target = "vt") => ({ source, target });

describe("collectVideoRefMedia — 批量/单跑共用的多模态参考收集", () => {
  it("provider 不支持参考视频/音频 → 空对象（不发字段）", () => {
    const nodes = [node("c", "clip", { outputUrl: "c.mp4" })];
    expect(collectVideoRefMedia("vt", "", "poyo_veo_fast", [edge("c")], nodes)).toEqual({});
  });

  it("Seedance-2：上游 clip/merge 视频 → videoRefs（含合成类视频源）", () => {
    const nodes = [
      node("c", "clip", { outputUrl: "clip.mp4" }),
      node("m", "merge", { outputUrl: "merge.mp4" }),
    ];
    const r = collectVideoRefMedia("vt", "", "kie_seedance2", [edge("c"), edge("m")], nodes);
    expect(r.videoRefs).toEqual(["clip.mp4", "merge.mp4"]);
  });

  it("数字人(avatar)provider：上游 audio → audioRefs", () => {
    const nodes = [node("a", "audio", { url: "voice.mp3" })];
    const r = collectVideoRefMedia("vt", "", "kie_kling_avatar_std", [edge("a")], nodes);
    expect(r.audioRefs).toEqual(["voice.mp3"]);
  });

  it("视频/音频参考各截断到 3 条", () => {
    const nodes = Array.from({ length: 5 }, (_, i) => node(`c${i}`, "clip", { outputUrl: `c${i}.mp4` }, i));
    const r = collectVideoRefMedia("vt", "", "kie_seedance2", nodes.map((n) => edge(n.id)), nodes);
    expect(r.videoRefs).toHaveLength(3);
  });

  it("SUPPORTS 集合包含新增的 Wan 2.7 参考生", () => {
    expect(SUPPORTS_REF_VIDEO.has("poyo_wan27_ref")).toBe(true);
    expect(SUPPORTS_REF_AUDIO.has("kie_kling_avatar_pro")).toBe(true);
  });
});

// planCharacterRefs 是视频节点「角色参考图参与方式」的单一决策源（#228）：
// 提交路径（buildRefUrls / refModeForSubmit）与配置区提示行共用，口径 = 首帧优先。
describe("planCharacterRefs — 角色定妆照 → 视频节点参与计划", () => {
  it("无角色参考图 → null（不提示、不影响提交）", () => {
    expect(planCharacterRefs({ charRefCount: 0, manualRefCount: 0, hasUpstreamFrame: false, providerMaxRefs: 9 })).toBeNull();
  });

  it("有手动参考图 → 不发送（以手动为准）", () => {
    const plan = planCharacterRefs({ charRefCount: 3, manualRefCount: 2, hasUpstreamFrame: false, providerMaxRefs: 9 });
    expect(plan?.mode).toBe("none");
    expect(plan?.note).toContain("手动");
  });

  it("有首帧图（手填或上游）→ 不直接发送，一致性经首帧继承（与「运行全部」runner 同口径）", () => {
    const plan = planCharacterRefs({ charRefCount: 3, manualRefCount: 0, hasUpstreamFrame: true, providerMaxRefs: 9 });
    expect(plan?.mode).toBe("none");
    expect(plan?.note).toContain("首帧");
  });

  it("纯文生视频模型（max=0）→ 不生效并提示换模型", () => {
    const plan = planCharacterRefs({ charRefCount: 2, manualRefCount: 0, hasUpstreamFrame: false, providerMaxRefs: 0 });
    expect(plan?.mode).toBe("none");
    expect(plan?.note).toContain("文生视频");
  });

  it("多参考模型（max>1）→ 以主体参考发送（多图锁脸），note 带张数", () => {
    const plan = planCharacterRefs({ charRefCount: 3, manualRefCount: 0, hasUpstreamFrame: false, providerMaxRefs: 9 });
    expect(plan?.mode).toBe("reference");
    expect(plan?.note).toContain("×3");
  });

  it("单图模型（max=1）→ 定妆照作首帧输入发送", () => {
    const plan = planCharacterRefs({ charRefCount: 1, manualRefCount: 0, hasUpstreamFrame: false, providerMaxRefs: 1 });
    expect(plan?.mode).toBe("frame");
    expect(plan?.note).toContain("首帧");
  });
});
