import { describe, it, expect } from "vitest";
import { EMOTION_GRID, EMOTION_DEFAULT_CELL, EMOTION_INTENSITIES, buildEmotionPrompt, emotionCellAt, regionToLocationPhrase, isValidEmotionRegion, withEmotionRegion, emotionTargetPhrase, withEmotionFocus, toAppliedEmotion, emotionVideoPhrase } from "../shared/emotionGrid";
import { buildImageEditInstruction, comfyDenoiseForOp, getImageEditOp } from "../shared/imageEdit";

// #336 情绪调节：25 格情绪坐标表 + 提示词组装 + emotion 编辑操作接线。
describe("#336 EMOTION_GRID（25 格情绪坐标表）", () => {
  it("恰好 25 格，覆盖 5×5 每个行列组合", () => {
    expect(EMOTION_GRID).toHaveLength(25);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      expect(emotionCellAt(r, c), `缺格 r${r}c${c}`).toBeTruthy();
    }
  });

  it("id / 中文命名 全局唯一，命名为 4 字", () => {
    expect(new Set(EMOTION_GRID.map((c) => c.id)).size).toBe(25);
    expect(new Set(EMOTION_GRID.map((c) => c.name)).size).toBe(25);
    for (const c of EMOTION_GRID) expect(c.name).toHaveLength(4);
  });

  it("每格都有情绪徽章 emoji（预览用）", () => {
    for (const c of EMOTION_GRID) expect(c.emoji.length).toBeGreaterThan(0);
  });

  it("锚点与 LibTV 实录对齐：中心=淡然自若、右上=心跳骤停、中上偏右=强忍悲戚、左下=积郁憋闷", () => {
    expect(emotionCellAt(2, 2)!.name).toBe("淡然自若");
    expect(EMOTION_DEFAULT_CELL.id).toBe("r2c2");
    expect(emotionCellAt(1, 4)!.name).toBe("心跳骤停");
    expect(emotionCellAt(1, 3)!.name).toBe("强忍悲戚");
    expect(emotionCellAt(4, 0)!.name).toBe("积郁憋闷");
  });

  it("表情脸参数全部在合法区间（SVG 预览不越界）", () => {
    for (const c of EMOTION_GRID) {
      expect(c.face.browRaise).toBeGreaterThanOrEqual(0); expect(c.face.browRaise).toBeLessThanOrEqual(1);
      expect(c.face.browAngle).toBeGreaterThanOrEqual(-1); expect(c.face.browAngle).toBeLessThanOrEqual(1);
      expect(c.face.eyeOpen).toBeGreaterThanOrEqual(0.1); expect(c.face.eyeOpen).toBeLessThanOrEqual(1.4);
      expect(c.face.mouthCurve).toBeGreaterThanOrEqual(-1); expect(c.face.mouthCurve).toBeLessThanOrEqual(1);
      expect(c.face.mouthOpen).toBeGreaterThanOrEqual(0); expect(c.face.mouthOpen).toBeLessThanOrEqual(1);
    }
  });

  it("唤醒度语义一致：激动行(0)平均睁眼/张嘴大于平静行(4)", () => {
    const rowAvg = (r: number, k: "eyeOpen" | "mouthOpen") =>
      EMOTION_GRID.filter((c) => c.row === r).reduce((s, c) => s + c.face[k], 0) / 5;
    expect(rowAvg(0, "eyeOpen")).toBeGreaterThan(rowAvg(4, "eyeOpen"));
    expect(rowAvg(0, "mouthOpen")).toBeGreaterThan(rowAvg(4, "mouthOpen"));
  });

  it("亲疏度语义一致：亲近列(0)平均嘴角弧度高于疏离列(4)（暖→冷）", () => {
    const colAvg = (col: number) => EMOTION_GRID.filter((c) => c.col === col).reduce((s, c) => s + c.face.mouthCurve, 0) / 5;
    expect(colAvg(0)).toBeGreaterThan(colAvg(4));
  });
});

describe("#336 buildEmotionPrompt + emotion 编辑操作接线", () => {
  it("提示词含英文情绪短语、中文命名与强度描述", () => {
    const p = buildEmotionPrompt(emotionCellAt(1, 3)!, "strong");
    expect(p).toContain("restrained grief");
    expect(p).toContain("强忍悲戚");
    expect(p).toContain("intense and dramatic");
  });

  it("默认强度为适中；三档强度描述互不相同", () => {
    const cell = EMOTION_DEFAULT_CELL;
    expect(buildEmotionPrompt(cell)).toBe(buildEmotionPrompt(cell, "moderate"));
    const texts = EMOTION_INTENSITIES.map((i) => buildEmotionPrompt(cell, i.value));
    expect(new Set(texts).size).toBe(3);
  });

  it("emotion 操作已入编辑目录：instruction 硬约束身份/姿势/构图不变", () => {
    expect(getImageEditOp("emotion")?.label).toBe("情绪调节");
    const ins = buildImageEditInstruction("emotion", buildEmotionPrompt(emotionCellAt(1, 4)!));
    expect(ins).toContain("ONLY the character's facial expression");
    expect(ins).toContain("heart-stopping shock");
    expect(ins).toMatch(/identity/);
    expect(ins).toMatch(/pose/);
    expect(ins).toMatch(/lighting/);
  });

  it("emotion 的 ComfyUI denoise 介于 upscale 与 reangle 之间（改脸不漂移结构）", () => {
    const d = comfyDenoiseForOp("emotion");
    expect(d).toBeGreaterThan(comfyDenoiseForOp("upscale"));
    expect(d).toBeLessThan(comfyDenoiseForOp("reangle"));
  });
});

describe("#336 多人图选脸（regionToLocationPhrase / withEmotionRegion）", () => {
  it("选框中心 → 方位短语（九宫格覆盖）", () => {
    expect(regionToLocationPhrase({ x: 0.42, y: 0.42, w: 0.16, h: 0.16 })).toBe("the person in the center of the frame");
    expect(regionToLocationPhrase({ x: 0.02, y: 0.02, w: 0.2, h: 0.2 })).toContain("top-left");
    expect(regionToLocationPhrase({ x: 0.75, y: 0.75, w: 0.2, h: 0.2 })).toContain("bottom-right");
    expect(regionToLocationPhrase({ x: 0.75, y: 0.42, w: 0.2, h: 0.16 })).toContain("right");
  });

  it("isValidEmotionRegion：太小的框（误触）不算选中", () => {
    expect(isValidEmotionRegion({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 })).toBe(false);
    expect(isValidEmotionRegion(null)).toBe(false);
    expect(isValidEmotionRegion({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 })).toBe(true);
  });

  it("withEmotionRegion：选了脸 → 前置「只改这张、其他人不动」约束；没选 → 原样", () => {
    const base = buildEmotionPrompt(EMOTION_DEFAULT_CELL);
    expect(withEmotionRegion(base, null)).toBe(base);
    const withBox = withEmotionRegion(base, { x: 0.05, y: 0.05, w: 0.3, h: 0.3 });
    expect(withBox).toContain("ONLY");
    expect(withBox).toContain("top-left");
    expect(withBox).toContain("leave every other person");
    expect(withBox.endsWith(base)).toBe(true);
  });
});

describe("#336 批2 人脸 chip 定位（emotionTargetPhrase / withEmotionFocus）", () => {
  it("emotionTargetPhrase：人物描述 → 自然语言指代；空描述 → 空串", () => {
    expect(emotionTargetPhrase("黑袍剑客，背对镜头")).toBe('the person described as "黑袍剑客，背对镜头"');
    expect(emotionTargetPhrase("  ")).toBe("");
    expect(emotionTargetPhrase('引\n号"注入')).not.toContain('"注入'); // 清理换行/引号防破坏包裹
  });

  it("withEmotionFocus：给定聚焦短语 → 前置硬约束；空聚焦 → 原样", () => {
    const base = buildEmotionPrompt(EMOTION_DEFAULT_CELL);
    expect(withEmotionFocus(base, "")).toBe(base);
    expect(withEmotionFocus(base, null)).toBe(base);
    const f = withEmotionFocus(base, emotionTargetPhrase("角色1"));
    expect(f).toContain('ONLY to the person described as "角色1"');
    expect(f).toContain("leave every other person");
    expect(f.endsWith(base)).toBe(true);
  });

  it("withEmotionRegion 与 withEmotionFocus 同源（框选走方位、chip 走人物，口径一致）", () => {
    const base = buildEmotionPrompt(EMOTION_DEFAULT_CELL);
    const box = { x: 0.05, y: 0.05, w: 0.3, h: 0.3 };
    expect(withEmotionRegion(base, box)).toBe(withEmotionFocus(base, regionToLocationPhrase(box)));
  });
});

describe("#336 批2 情绪注入视频（toAppliedEmotion / emotionVideoPhrase）", () => {
  it("toAppliedEmotion：由格点+强度构造可写回节点的元数据", () => {
    const ae = toAppliedEmotion(emotionCellAt(1, 3)!, "strong");
    expect(ae).toEqual({ cellId: "r1c3", name: "强忍悲戚", en: "restrained grief", intensity: "strong" });
  });

  it("emotionVideoPhrase：含英文情绪短语、中文命名与强度描述；空/无 → 空串", () => {
    const p = emotionVideoPhrase(toAppliedEmotion(emotionCellAt(1, 4)!, "moderate"));
    expect(p).toContain("heart-stopping shock");
    expect(p).toContain("心跳骤停");
    expect(p).toContain("clearly visible and natural");
    expect(emotionVideoPhrase(null)).toBe("");
    expect(emotionVideoPhrase({ cellId: "x", name: "", en: "", intensity: "moderate" })).toBe("");
  });
});
