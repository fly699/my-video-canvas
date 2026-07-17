import { describe, it, expect } from "vitest";
import { computeThrottleWaitMs } from "./_core/poyoUpload";

// #232 Poyo 流式上传官方限流（5 次/分/Key）的滑动窗口节流：批量提交排队错峰，
// 不再撞 429 后放弃回落（回落 presign 在「存储不对公网开放」的部署下＝参考图丢失）。
describe("computeThrottleWaitMs（Poyo 暂存 5次/分 滑动窗口）", () => {
  it("窗口未满 → 0（立即可发）", () => {
    expect(computeThrottleWaitMs([], 100_000)).toBe(0);
    expect(computeThrottleWaitMs([1000, 2000, 3000, 4000], 5000)).toBe(0);
  });

  it("窗口满 5 条 → 等到第 5 早的一条滚出 60s（含 250ms 余量）", () => {
    const stamps = [0, 1000, 2000, 3000, 4000];
    // now=5000：最早一条 t=0 还需 55s 滚出 → 等 60000-(5000-0)+250
    expect(computeThrottleWaitMs(stamps, 5000)).toBe(60_000 - 5000 + 250);
  });

  it("过期时间戳不计入窗口", () => {
    const stamps = [0, 1000, 2000, 3000, 4000];
    // now=61000：t=0 与 t=1000 已滚出（>=60s），窗口剩 3 条 → 可发
    expect(computeThrottleWaitMs(stamps, 61_500)).toBe(0);
  });

  it("窗口超满（并发堆积 >5 条）按「倒数第 5 条」计算等待", () => {
    const stamps = [0, 100, 200, 300, 400, 500, 600];
    // 存活 7 条，倒数第 5 条 t=200 → 等 60000-(1000-200)+250
    expect(computeThrottleWaitMs(stamps, 1000)).toBe(60_000 - 800 + 250);
  });
});
