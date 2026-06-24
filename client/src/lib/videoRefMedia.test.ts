import { describe, it, expect } from "vitest";
import { collectVideoRefMedia, SUPPORTS_REF_VIDEO, SUPPORTS_REF_AUDIO } from "./videoRefMedia";

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
