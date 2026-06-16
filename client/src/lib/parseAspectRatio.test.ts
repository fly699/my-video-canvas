import { describe, it, expect } from "vitest";
import { parseAspectRatioFromText } from "./comfyWorkflowParams";

describe("parseAspectRatioFromText（数字边界）", () => {
  it("识别独立的比例 token", () => {
    expect(parseAspectRatioFromText("竖屏 9:16 电影感")).toBe("9:16");
    expect(parseAspectRatioFromText("16：9 全角冒号")).toBe("16:9"); // 全角冒号
  });

  it("紧贴长数字串不再误切（216:9 / 1216:9 不命中 16:9）", () => {
    expect(parseAspectRatioFromText("216:9 typo")).toBeUndefined();
    expect(parseAspectRatioFromText("1216:9")).toBeUndefined();
    expect(parseAspectRatioFromText("16:90")).toBeUndefined(); // 后缀数字
  });

  it("无可识别比例 → undefined", () => {
    expect(parseAspectRatioFromText("1920:1080")).toBeUndefined(); // 不在白名单
    expect(parseAspectRatioFromText(undefined)).toBeUndefined();
    expect(parseAspectRatioFromText("普通文本")).toBeUndefined();
  });
});
