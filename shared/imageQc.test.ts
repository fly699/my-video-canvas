import { describe, it, expect } from "vitest";
import { parseQcVerdict, buildQcRetryPrompt, QC_FIX_TAG } from "./imageQc";

describe("parseQcVerdict", () => {
  it("解析标准通过判定", () => {
    const v = parseQcVerdict('{"pass":true,"score":92,"issues":[],"suggestion":""}');
    expect(v).toEqual({ pass: true, score: 92, issues: [], suggestion: "" });
  });

  it("解析未过判定（含问题与修正意见）", () => {
    const v = parseQcVerdict('{"pass":false,"score":38,"issues":["右手六指","背景乱码"],"suggestion":"正确的双手五指，画面无文字"}');
    expect(v?.pass).toBe(false);
    expect(v?.issues).toEqual(["右手六指", "背景乱码"]);
    expect(v?.suggestion).toContain("五指");
  });

  it("容忍 markdown 代码块与前后杂讯", () => {
    const v = parseQcVerdict('好的，判定如下：\n```json\n{"pass":true,"score":85,"issues":[],"suggestion":""}\n```\n以上。');
    expect(v?.pass).toBe(true);
  });

  it("容忍字符串型 pass 与越界 score", () => {
    const v = parseQcVerdict('{"pass":"false","score":-20,"issues":["黑屏"],"suggestion":"清晰的画面"}');
    expect(v?.pass).toBe(false);
    expect(v?.score).toBe(0);
    const v2 = parseQcVerdict('{"pass":"true","score":250,"issues":[]}');
    expect(v2?.pass).toBe(true);
    expect(v2?.score).toBe(100);
  });

  it("pass 缺失/非法 → null；未过但零信息 → null", () => {
    expect(parseQcVerdict('{"score":50,"issues":[]}')).toBeNull();
    expect(parseQcVerdict("完全不是 JSON")).toBeNull();
    expect(parseQcVerdict('{"pass":false,"score":40,"issues":[],"suggestion":""}')).toBeNull();
  });

  it("issues 截断到 5 条、每条 60 字；pass=true 时 suggestion 清空", () => {
    const many = JSON.stringify({ pass: false, score: 30, issues: ["a", "b", "c", "d", "e", "f", "x".repeat(100)], suggestion: "s".repeat(300) });
    const v = parseQcVerdict(many);
    expect(v?.issues.length).toBe(5);
    const passed = parseQcVerdict('{"pass":true,"score":90,"issues":[],"suggestion":"不该有的意见"}');
    expect(passed?.suggestion).toBe("");
  });
});

describe("buildQcRetryPrompt", () => {
  it("追加修正段", () => {
    expect(buildQcRetryPrompt("一只猫", "正确的四肢")).toBe(`一只猫\n${QC_FIX_TAG}正确的四肢`);
  });

  it("重试替换而非叠加旧修正段", () => {
    const once = buildQcRetryPrompt("一只猫", "正确的四肢");
    const twice = buildQcRetryPrompt(once, "画面无文字");
    expect(twice).toBe(`一只猫\n${QC_FIX_TAG}画面无文字`);
    expect(twice.split(QC_FIX_TAG).length).toBe(2);
  });

  it("空 suggestion 返回剥掉修正段的基础提示词", () => {
    const once = buildQcRetryPrompt("一只猫", "正确的四肢");
    expect(buildQcRetryPrompt(once, "")).toBe("一只猫");
  });
});
