// 快捷设置徽标计数：只数「与出厂默认不同」的项（用户实报「· 11 统计不对」修复）。
import { describe, it, expect } from "vitest";
import { countDiffFromDefaults } from "./quickPrefsCount";

const DEF = { aspect: "16:9", style: "电影感", noStoryboard: true, addMusic: false, durationSec: 0, genNodes: [] as string[], summaryMode: "compressed", streamEcho: false };

describe("countDiffFromDefaults（快捷设置改动数）", () => {
  it("全默认 → 0（不再把出厂真值算成改动）", () => {
    expect(countDiffFromDefaults(DEF, { ...DEF })).toBe(0);
  });

  it("布尔翻转 / 字符串改值 / 数字改值 各计 1", () => {
    expect(countDiffFromDefaults(DEF, { ...DEF, addMusic: true })).toBe(1);
    expect(countDiffFromDefaults(DEF, { ...DEF, aspect: "9:16", durationSec: 30 })).toBe(2);
    // 把默认开的项关掉也算一项改动（noStoryboard true→false）
    expect(countDiffFromDefaults(DEF, { ...DEF, noStoryboard: false })).toBe(1);
  });

  it("数组按内容比较：空→非空计 1，内容相同不计", () => {
    expect(countDiffFromDefaults(DEF, { ...DEF, genNodes: ["image_gen"] })).toBe(1);
    expect(countDiffFromDefaults(DEF, { ...DEF, genNodes: [] })).toBe(0);
  });

  it("后加字段自动纳入（streamEcho/summaryMode 无需手动登记）", () => {
    expect(countDiffFromDefaults(DEF, { ...DEF, streamEcho: true, summaryMode: "full" })).toBe(2);
  });
});
