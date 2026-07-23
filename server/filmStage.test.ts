import { describe, it, expect } from "vitest";
import { deriveFilmStage, FILM_STAGES } from "../shared/filmStage";

const n = (nodeType: string, payload: Record<string, unknown> = {}) => ({ data: { nodeType, payload } });

// 优化D 向导式推进条：成片阶段推导（规划→生成→装配→导出），与画布真实数据同源。
describe("deriveFilmStage", () => {
  it("空画布 → 规划（plan）", () => {
    const s = deriveFilmStage([]);
    expect(s.stage).toBe("plan");
    expect(s.hasGenNode).toBe(false);
    expect(s.hint).toContain("画布助手");
  });

  it("有生成节点但无产物 → 生成（generate）", () => {
    const s = deriveFilmStage([n("storyboard"), n("video_task", { provider: "kie_grok_i2v" })]);
    expect(s.stage).toBe("generate");
    expect(s.hasGenNode).toBe(true);
    expect(s.hasAnyResult).toBe(false);
  });

  it("有图像产物但无视频产物 → 仍在生成（继续出视频）", () => {
    const s = deriveFilmStage([n("image_gen", { imageUrl: "https://x/a.png" }), n("video_task", {})]);
    expect(s.stage).toBe("generate");
    expect(s.hasAnyResult).toBe(true);
    expect(s.hasVideoResult).toBe(false);
  });

  it("有视频产物但无成片 → 装配（assemble）", () => {
    const s = deriveFilmStage([n("video_task", { resultVideoUrl: "https://x/v.mp4" }), n("merge", {})]);
    expect(s.stage).toBe("assemble");
    expect(s.hasVideoResult).toBe(true);
    expect(s.hasMergeNode).toBe(true);
    expect(s.hasFilm).toBe(false);
    expect(s.hint).toContain("装配");
  });

  it("合并节点已出成片 → 导出（export）", () => {
    const s = deriveFilmStage([
      n("video_task", { resultVideoUrl: "https://x/v.mp4" }),
      n("merge", { resultVideoUrl: "https://x/film.mp4" }),
    ]);
    expect(s.stage).toBe("export");
    expect(s.hasFilm).toBe(true);
    expect(s.hint).toContain("导出");
  });

  it("character 有主参考图算产物；imageUrls 数组也算产物", () => {
    expect(deriveFilmStage([n("character", { referenceImageUrl: "https://x/c.png" })]).hasAnyResult).toBe(true);
    expect(deriveFilmStage([n("image_gen", { imageUrls: ["", "https://x/b.png"] })]).hasAnyResult).toBe(true);
  });

  it("四步定义顺序即流程", () => {
    expect(FILM_STAGES.map((s) => s.key)).toEqual(["plan", "generate", "assemble", "export"]);
  });
});
