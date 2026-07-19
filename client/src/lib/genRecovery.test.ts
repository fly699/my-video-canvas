// #255 pollGenRecovery（image_gen 隧道兜底取回循环）守卫测试。
import { describe, it, expect } from "vitest";
import { pollGenRecovery, type GenRecoveryQuery } from "./genRecovery";

const noSleep = () => Promise.resolve();

describe("pollGenRecovery", () => {
  it("首轮即 done → 立即返回结果", async () => {
    const r = await pollGenRecovery<{ url: string }>({
      jobId: "j",
      fetchResult: async () => ({ status: "done", value: { url: "u1" } }),
      sleep: noSleep,
    });
    expect(r).toEqual({ ok: true, value: { url: "u1" } });
  });

  it("pending 若干轮后 done", async () => {
    let n = 0;
    const r = await pollGenRecovery<{ url: string }>({
      jobId: "j",
      fetchResult: async (): Promise<GenRecoveryQuery<{ url: string }>> =>
        ++n < 3 ? { status: "pending" } : { status: "done", value: { url: "u" } },
      sleep: noSleep,
    });
    expect(r?.ok).toBe(true);
    expect(n).toBe(3);
  });

  it("error 终局 → ok:false 带原因", async () => {
    const r = await pollGenRecovery({
      jobId: "j",
      fetchResult: async () => ({ status: "error" as const, error: "余额不足" }),
      sleep: noSleep,
    });
    expect(r).toEqual({ ok: false, error: "余额不足" });
  });

  it("轮询自身抛错被忽略、继续下一轮", async () => {
    let n = 0;
    const r = await pollGenRecovery<{ url: string }>({
      jobId: "j",
      fetchResult: async () => {
        if (++n < 3) throw new Error("fetch failed（隧道抖动）");
        return { status: "done" as const, value: { url: "u" } };
      },
      sleep: noSleep,
    });
    expect(r?.ok).toBe(true);
  });

  it("超时仍无终局 → null", async () => {
    let t = 0;
    const r = await pollGenRecovery({
      jobId: "j",
      fetchResult: async () => ({ status: "pending" as const }),
      sleep: noSleep,
      now: () => (t += 60_000),
      maxMs: 10 * 60_000,
    });
    expect(r).toBeNull();
  });

  it("stopped()（放弃等待）→ 立即 null 退出", async () => {
    let calls = 0;
    const r = await pollGenRecovery({
      jobId: "j",
      fetchResult: async () => { calls++; return { status: "pending" as const }; },
      sleep: noSleep,
      stopped: () => true,
    });
    expect(r).toBeNull();
    expect(calls).toBe(0); // stopped 在首次 fetch 前即检查
  });
});
