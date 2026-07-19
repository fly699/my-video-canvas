// #255 genJobStore（阻塞式生成管线隧道兜底暂存）守卫测试。
import { describe, it, expect, beforeEach } from "vitest";
import {
  setGenJobDone, setGenJobError, getGenJob, pruneGenJobs,
  _clearGenJobs, _genJobCount,
} from "./_core/genJobStore";

const T0 = 1_700_000_000_000;

describe("genJobStore", () => {
  beforeEach(() => _clearGenJobs());

  it("done 结果按 jobId+userId 取回", () => {
    setGenJobDone("j1", 7, { url: "https://x/a.png" }, T0);
    const r = getGenJob("j1", 7, T0 + 1000);
    expect(r?.status).toBe("done");
    expect(r?.status === "done" && (r.value as { url: string }).url).toBe("https://x/a.png");
  });

  it("属主不符视为不存在（防撞串探测他人结果）", () => {
    setGenJobDone("j1", 7, { url: "u" }, T0);
    expect(getGenJob("j1", 8, T0 + 1000)).toBeNull();
    // 且不影响真属主后续读取
    expect(getGenJob("j1", 7, T0 + 2000)?.status).toBe("done");
  });

  it("error 结果带截断（2000 字符）", () => {
    setGenJobError("j2", 7, "x".repeat(5000), T0);
    const r = getGenJob("j2", 7, T0 + 1000);
    expect(r?.status).toBe("error");
    expect(r?.status === "error" && r.error.length).toBe(2000);
  });

  it("TTL 过期后视为不存在", () => {
    setGenJobDone("j3", 7, { url: "u" }, T0);
    expect(getGenJob("j3", 7, T0 + 21 * 60 * 1000)).toBeNull();
  });

  it("空 jobId 不写入", () => {
    setGenJobDone("", 7, { url: "u" }, T0);
    setGenJobError("", 7, "e", T0);
    expect(_genJobCount()).toBe(0);
  });

  it("prune 清过期并按上限裁最旧", () => {
    for (let i = 0; i < 2100; i++) setGenJobDone(`k${i}`, 1, { i }, T0 + i);
    pruneGenJobs(T0 + 2100);
    expect(_genJobCount()).toBeLessThanOrEqual(2000);
    // 最旧的被裁掉、最新的保留
    expect(getGenJob("k0", 1, T0 + 2200)).toBeNull();
    expect(getGenJob("k2099", 1, T0 + 2200)?.status).toBe("done");
  });
});
