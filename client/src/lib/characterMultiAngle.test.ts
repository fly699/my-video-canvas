// #262 守卫：多视角结果落地口径——「有定妆照绝不覆盖」+「无主图维持旧行为逐字段一致」。
import { describe, it, expect } from "vitest";
import { multiAngleResultPatch, MULTI_ANGLE_IDENTITY_CLAUSE } from "./characterMultiAngle";

const SLICED = ["https://s/front.png", "https://s/side.png", "https://s/back.png"];

describe("multiAngleResultPatch", () => {
  it("有定妆照：patch 里【不含】referenceImageUrl 键（主图绝不动），三视图全部进备用", () => {
    const payload = { referenceImageUrl: "https://s/portrait.png", additionalImageUrls: [] };
    const p = multiAngleResultPatch(payload, SLICED, 8);
    expect("referenceImageUrl" in p).toBe(false);       // 连 undefined 都不能出现（合并语义防清空）
    expect("referenceStorageKey" in p).toBe(false);
    expect(p.additionalImageUrls).toEqual(SLICED);
    expect(payload.additionalImageUrls).toEqual([]);     // 纯函数：入参不被改写
  });

  it("有定妆照 + 原有备用视角：新切片在前、旧备用保留在后，去重并剔除与主图相同项，截断上限", () => {
    const payload = {
      referenceImageUrl: "https://s/portrait.png",
      additionalImageUrls: ["https://s/old1.png", "https://s/portrait.png", "https://s/side.png"],
    };
    const p = multiAngleResultPatch(payload, SLICED, 4);
    // 新切片 3 张排前；旧备用中与主图重复的剔除、与新切片重复的去重；截断到 4。
    expect(p.additionalImageUrls).toEqual([...SLICED, "https://s/old1.png"]);
  });

  it("无主参考图：与历史行为逐字段一致（front→主图 + referenceStorageKey 清空，rest→备用）", () => {
    const p = multiAngleResultPatch({ referenceImageUrl: "  " }, SLICED, 8);
    expect(p.referenceImageUrl).toBe("https://s/front.png");
    expect("referenceStorageKey" in p).toBe(true);
    expect(p.referenceStorageKey).toBeUndefined();
    expect(p.additionalImageUrls).toEqual(["https://s/side.png", "https://s/back.png"]);
  });

  it("无主图 + 备用超上限：rest 截断（与旧代码 rest.slice(0,MAX) 同口径）", () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://s/${i}.png`);
    const p = multiAngleResultPatch({}, many, 8);
    expect(p.referenceImageUrl).toBe("https://s/0.png");
    expect(p.additionalImageUrls).toHaveLength(8);
  });

  it("身份约束句为英文追加句式（与 grid 提示词同语言、逗号开头可直接拼接）", () => {
    expect(MULTI_ANGLE_IDENTITY_CLAUSE.startsWith(", ")).toBe(true);
    expect(MULTI_ANGLE_IDENTITY_CLAUSE).toMatch(/same character as the reference image/);
  });
});
