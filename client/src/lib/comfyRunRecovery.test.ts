import { describe, it, expect } from "vitest";
import { isTransportCutError, pollComfyRun, type ComfyResultQuery, type PendingComfyResult } from "./comfyRunRecovery";

describe("isTransportCutError", () => {
  it("传输/隧道类错误 → true", () => {
    for (const m of ["Failed to fetch", "network error", "The operation was aborted", "signal is aborted", "request timeout", "timed out", "502 Bad Gateway", "504 Gateway Timeout", "ECONNRESET", "socket hang up", "连接被重置", "请求超时", "网络异常"]) {
      expect(isTransportCutError(m), m).toBe(true);
    }
  });
  it("业务错误 → false", () => {
    for (const m of ["缺少节点：FooNode 未安装", "ComfyUI 未返回 prompt_id", "Workflow JSON 格式错误", "取值非法"]) {
      expect(isTransportCutError(m), m).toBe(false);
    }
  });
});

const noSleep = () => Promise.resolve();

describe("pollComfyRun", () => {
  it("socket 回灌优先：pendingComfyResult 命中即返回，不轮询", async () => {
    let fetchCalls = 0;
    const pend: PendingComfyResult = { jobId: "j1", ok: true, urls: ["http://x/a.png"], outputType: "image" };
    const r = await pollComfyRun({
      jobId: "j1",
      readPending: () => pend,
      fetchResult: async () => { fetchCalls++; return { status: "pending" }; },
      sleep: noSleep,
    });
    expect(r).toEqual({ ok: true, urls: ["http://x/a.png"], outputType: "image" });
    expect(fetchCalls).toBe(0);
  });

  it("回灌为失败 → 返回 ok:false", async () => {
    const pend: PendingComfyResult = { jobId: "j1", ok: false, error: "boom" };
    const r = await pollComfyRun({ jobId: "j1", readPending: () => pend, fetchResult: async () => ({ status: "pending" }), sleep: noSleep });
    expect(r).toEqual({ ok: false, error: "boom" });
  });

  it("jobId 不匹配的回灌被忽略，转轮询", async () => {
    const stale: PendingComfyResult = { jobId: "OTHER", ok: true, urls: ["x"], outputType: "image" };
    const r = await pollComfyRun({
      jobId: "j1",
      readPending: () => stale,
      fetchResult: async () => ({ status: "done", urls: ["http://x/b.mp4"], outputType: "video" }),
      sleep: noSleep,
    });
    expect(r).toEqual({ ok: true, urls: ["http://x/b.mp4"], outputType: "video" });
  });

  it("轮询：pending 数轮后转 done", async () => {
    const seq: ComfyResultQuery[] = [{ status: "pending" }, { status: "pending" }, { status: "done", urls: ["http://x/c.png"], outputType: "image" }];
    let i = 0;
    const r = await pollComfyRun({
      jobId: "j1",
      readPending: () => undefined,
      fetchResult: async () => seq[Math.min(i++, seq.length - 1)],
      sleep: noSleep,
      intervalMs: 1,
    });
    expect(r).toEqual({ ok: true, urls: ["http://x/c.png"], outputType: "image" });
    expect(i).toBe(3);
  });

  it("轮询：error → ok:false", async () => {
    const r = await pollComfyRun({ jobId: "j1", readPending: () => undefined, fetchResult: async () => ({ status: "error", error: "服务端失败" }), sleep: noSleep });
    expect(r).toEqual({ ok: false, error: "服务端失败" });
  });

  it("fetch 抛错被吞并重试，下轮成功", async () => {
    let i = 0;
    const r = await pollComfyRun({
      jobId: "j1",
      readPending: () => undefined,
      fetchResult: async () => { if (i++ === 0) throw new Error("隧道抖动"); return { status: "done", urls: ["u"], outputType: "image" }; },
      sleep: noSleep,
    });
    expect(r).toEqual({ ok: true, urls: ["u"], outputType: "image" });
  });

  it("超时仍无终局 → 返回 null", async () => {
    // now 每次调用推进 5s；maxMs=10s → 首轮(0) 检查、pending → 到 10s(=maxMs) 达上限返回 null
    let t = 0;
    const r = await pollComfyRun({
      jobId: "j1",
      readPending: () => undefined,
      fetchResult: async () => ({ status: "pending" }),
      sleep: noSleep,
      maxMs: 10_000,
      intervalMs: 1,
      now: () => (t += 5000) - 5000, // 返回 0,5000,10000,...（首值 0）
    });
    expect(r).toBeNull();
  });
});
