// #244 批1 合并转场纯函数守卫：接缝决策 / 归一链 / fps 解析。
// 关键历史结论（勿因重构丢失）：
//  - "none" 必须映射为 2 帧极短 fade（1/15s）——亚帧 duration 会让 xfade 在第一路 EOF
//    提前终止、截断成片（真机复现过），dur 只能 ≥ 1/15，勿改小。
//  - 转场时长必须夹取 ≤ 相邻两段各自时长，防止短镜被转场洗掉/offset 倒退。
//  - 归一链必须含 fps= 统一帧率（#244 新增）：混帧率源直接 xfade 时基错乱。
import { describe, it, expect } from "vitest";
import { computeMergeSeam, buildMergeNormChain, parseFpsBase } from "./_core/videoEditor";
import { MERGE_TRANSITION_OPTIONS } from "../shared/types";

describe("computeMergeSeam", () => {
  const durations = [5, 5, 5];

  it("全局 none（默认直切）→ 2 帧极短 fade（1/15s，硬切观感；勿改小）", () => {
    const c = computeMergeSeam(0, "none", 0.5, durations);
    expect(c.type).toBe("fade");
    expect(c.dur).toBeCloseTo(1 / 15, 6);
  });

  it("新增转场值映射为 ffmpeg xfade 原生名（fadeblack/fadewhite/smoothleft 原样，wipe→wipeleft）", () => {
    expect(computeMergeSeam(0, "fadeblack", 0.6, durations).type).toBe("fadeblack");
    expect(computeMergeSeam(0, "fadewhite", 0.6, durations).type).toBe("fadewhite");
    expect(computeMergeSeam(0, "smoothleft", 0.6, durations).type).toBe("smoothleft");
    expect(computeMergeSeam(0, "wipe", 0.6, durations).type).toBe("wipeleft");
    expect(computeMergeSeam(0, "dissolve", 0.6, durations).type).toBe("dissolve");
  });

  it("逐接缝 segTransitions 优先于全局值，且逐索引取值", () => {
    const segs = ["dissolve", "fadeblack"];
    expect(computeMergeSeam(0, "none", 0.5, durations, segs)).toEqual({ type: "dissolve", dur: 0.5 });
    expect(computeMergeSeam(1, "none", 0.5, durations, segs)).toEqual({ type: "fadeblack", dur: 0.5 });
  });

  it("segTransitions 中的 none 仍是硬切（装配 cut/match-cut 镜头）", () => {
    const c = computeMergeSeam(0, "dissolve", 0.5, durations, ["none"]);
    expect(c.type).toBe("fade");
    expect(c.dur).toBeCloseTo(1 / 15, 6);
  });

  it("转场时长夹取 ≤ 相邻两段各自时长（短镜不被洗掉）", () => {
    expect(computeMergeSeam(0, "fade", 2.0, [0.8, 5]).dur).toBeCloseTo(0.8, 6);
    expect(computeMergeSeam(0, "fade", 2.0, [5, 0.3]).dur).toBeCloseTo(0.3, 6);
    expect(computeMergeSeam(0, "fade", 0.5, [5, 5]).dur).toBeCloseTo(0.5, 6);
  });

  it("未知转场值回退 fade（前向兼容坏数据）", () => {
    expect(computeMergeSeam(0, "sparkle", 0.5, durations).type).toBe("fade");
  });

  it("UI 全部转场选项（shared 单一事实源）都能被接缝决策消化", () => {
    for (const o of MERGE_TRANSITION_OPTIONS) {
      const c = computeMergeSeam(0, o.value, 0.5, durations);
      expect(c.type).toBeTruthy();
      expect(c.dur).toBeGreaterThan(0);
    }
  });
});

describe("buildMergeNormChain", () => {
  it("含 尺寸contain + setsar + fps 统一（#146 尺寸/#244 帧率，缺一 xfade 都会炸）", () => {
    const s = buildMergeNormChain(2, 1280, 720, 24);
    expect(s).toBe("[2:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[nv2];");
  });
});

describe("parseFpsBase", () => {
  it("分数形式解析并取整（NTSC 29.97→30；24000/1001→24）", () => {
    expect(parseFpsBase("30000/1001")).toBe(30);
    expect(parseFpsBase("24000/1001")).toBe(24);
    expect(parseFpsBase("25/1")).toBe(25);
  });
  it("非法/缺失回退 30，异常值钳 12~60", () => {
    expect(parseFpsBase(undefined)).toBe(30);
    expect(parseFpsBase("")).toBe(30);
    expect(parseFpsBase("0/0")).toBe(30);
    expect(parseFpsBase("1000/1")).toBe(60);
    expect(parseFpsBase("2/1")).toBe(12);
  });
});
