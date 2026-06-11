import { describe, it, expect } from "vitest";
import { AGENT_RECIPES, buildRecipeOps, recipeDefaultConfig, getRecipe, type AgentRecipe, type RecipeConfig } from "./agentRecipes";
import type { AgentOperation } from "../../../shared/types";

const promo = getRecipe("vertical_promo")!;
const base = (over: Partial<RecipeConfig> = {}): RecipeConfig => ({
  topic: "测试", shots: 3, aspect: "9:16", durationEach: 4,
  addMusic: false, addSubtitle: false, imageFirst: false, ...over,
});
const creates = (ops: AgentOperation[], type: string) => ops.filter((o) => o.op === "create" && o.nodeType === type);
const connectsTo = (ops: AgentOperation[], target: string) => ops.filter((o) => o.op === "connect" && o.targetRef === target);

describe("buildRecipeOps — structure", () => {
  it("builds script + N storyboards + N video_task + merge", () => {
    const ops = buildRecipeOps(promo, base({ shots: 3 }));
    expect(creates(ops, "script")).toHaveLength(1);
    expect(creates(ops, "merge")).toHaveLength(1);
    expect(creates(ops, "storyboard")).toHaveLength(3);
    expect(creates(ops, "video_task")).toHaveLength(3);
    // every shot's tail connects into merge (3 video_task → merge)
    expect(connectsTo(ops, "merge")).toHaveLength(3);
  });

  it("respects the chosen shot count", () => {
    const ops = buildRecipeOps(promo, base({ shots: 6 }));
    expect(creates(ops, "storyboard")).toHaveLength(6);
    expect(creates(ops, "video_task")).toHaveLength(6);
  });

  it("merge is created before any connect references it", () => {
    const ops = buildRecipeOps(promo, base());
    const mergeCreateIdx = ops.findIndex((o) => o.op === "create" && o.tempId === "merge");
    const firstMergeConnectIdx = ops.findIndex((o) => o.op === "connect" && o.targetRef === "merge");
    expect(mergeCreateIdx).toBeGreaterThanOrEqual(0);
    expect(mergeCreateIdx).toBeLessThan(firstMergeConnectIdx);
  });
});

describe("buildRecipeOps — prefs honored", () => {
  it("imageFirst keeps storyboard→video direct (storyboard IS the image station — no extra image_gen)", () => {
    // 分镜本身就是生图工位：imageFirst 由 分镜→视频 直连天然满足，不再插冗余 image_gen 静帧，
    // 否则一镜两次生图、且直连断裂会让批量生视频找不到既有工位再新建一个。
    const ops = buildRecipeOps(promo, base({ shots: 2, imageFirst: true }));
    expect(creates(ops, "image_gen")).toHaveLength(0);
    // storyboard → video_task 直连（无中间 image_gen）
    expect(ops.some((o) => o.op === "connect" && o.sourceRef === "sb1" && o.targetRef === "vt1")).toBe(true);
    expect(ops.some((o) => o.op === "connect" && o.sourceRef === "sb2" && o.targetRef === "vt2")).toBe(true);
  });

  it("addMusic adds one audio(music) node into merge", () => {
    const ops = buildRecipeOps(promo, base({ addMusic: true }));
    const audio = creates(ops, "audio");
    expect(audio).toHaveLength(1);
    expect(audio[0].payload).toMatchObject({ audioCategory: "music" });
    expect(ops.some((o) => o.op === "connect" && o.sourceRef === "music" && o.targetRef === "merge")).toBe(true);
  });

  it("addSubtitle inserts subtitle between video_task and merge", () => {
    const ops = buildRecipeOps(promo, base({ shots: 1, addSubtitle: true }));
    expect(creates(ops, "subtitle")).toHaveLength(1);
    expect(ops.some((o) => o.op === "connect" && o.sourceRef === "vt1" && o.targetRef === "sub1")).toBe(true);
    expect(ops.some((o) => o.op === "connect" && o.sourceRef === "sub1" && o.targetRef === "merge")).toBe(true);
  });

  it("voiceOver recipe adds a 配音(dubbing) track", () => {
    const sell = getRecipe("talking_sell")!;
    const ops = buildRecipeOps(sell, base({ shots: 1 }));
    const audio = creates(ops, "audio");
    expect(audio.some((a) => (a.payload as { audioCategory?: string }).audioCategory === "dubbing")).toBe(true);
  });

  it("storyboards carry sceneNumber + per-shot transition for shot-list assembly", () => {
    const ops = buildRecipeOps(promo, base({ shots: 3 }));
    const sbs = creates(ops, "storyboard");
    expect(sbs.map((s) => (s.payload as { sceneNumber?: number }).sceneNumber)).toEqual([1, 2, 3]);
    // 默认逐镜转场 cut；电影感预告配方覆盖为 dissolve
    expect((sbs[0].payload as { transition?: string }).transition).toBe("cut");
    const trailerSbs = creates(buildRecipeOps(getRecipe("cinematic_trailer")!, base({ shots: 4 })), "storyboard");
    expect((trailerSbs[0].payload as { transition?: string }).transition).toBe("dissolve");
  });

  it("AI shot descriptions are written into storyboards", () => {
    const ops = buildRecipeOps(promo, base({ shots: 2, shotDescriptions: ["镜头甲", "镜头乙"] }));
    const sbs = creates(ops, "storyboard");
    expect((sbs[0].payload as { description?: string }).description).toBe("镜头甲");
    expect((sbs[1].payload as { description?: string }).description).toBe("镜头乙");
  });
});

describe("buildRecipeOps — comfyOnly", () => {
  it("uses prompt → comfyui_workflow(templateId) per shot and skips audio/subtitle", () => {
    const ops = buildRecipeOps(promo, base({ shots: 2, comfyOnly: true, videoTemplateId: 7, addMusic: true, addSubtitle: true, imageFirst: true }));
    expect(creates(ops, "comfyui_workflow")).toHaveLength(2);
    expect(creates(ops, "prompt")).toHaveLength(2);
    expect(creates(ops, "storyboard")).toHaveLength(0);
    expect(creates(ops, "video_task")).toHaveLength(0);
    expect(creates(ops, "audio")).toHaveLength(0); // comfyOnly drops music/subtitle
    expect(creates(ops, "subtitle")).toHaveLength(0);
    const cw = creates(ops, "comfyui_workflow")[0];
    expect(cw.payload).toMatchObject({ templateId: 7 });
  });

  it("falls back to the normal chain when comfyOnly but no template chosen", () => {
    const ops = buildRecipeOps(promo, base({ shots: 2, comfyOnly: true }));
    expect(creates(ops, "comfyui_workflow")).toHaveLength(0);
    expect(creates(ops, "video_task")).toHaveLength(2);
  });
});

describe("recipeDefaultConfig", () => {
  it("merges planPrefs over recipe defaults", () => {
    const cfg = recipeDefaultConfig(promo, { topic: " 主题 ", comfyOnly: true, prefs: { aspect: "16:9", addMusic: false, imageFirst: true, style: "电影感" } });
    expect(cfg.aspect).toBe("16:9");          // prefs override
    expect(cfg.imageFirst).toBe(true);
    expect(cfg.style).toBe("电影感");
    expect(cfg.comfyOnly).toBe(true);
    expect(cfg.topic).toBe("主题");           // trimmed
    expect(cfg.shots).toBe(promo.defaults.shots);
  });
});

describe("recipe library", () => {
  it("every recipe has a valid shotRange covering its default", () => {
    for (const r of AGENT_RECIPES as AgentRecipe[]) {
      const [min, max] = r.shotRange;
      expect(min).toBeLessThanOrEqual(max);
      expect(r.defaults.shots).toBeGreaterThanOrEqual(min);
      expect(r.defaults.shots).toBeLessThanOrEqual(max);
      expect(r.beats.length).toBeGreaterThan(0);
    }
  });
});
