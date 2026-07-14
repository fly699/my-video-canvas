import { describe, it, expect, beforeEach } from "vitest";
import { setComfyJobDone, setComfyJobError, getComfyJob, pruneComfyJobs, _clearComfyJobs, _comfyJobCount } from "./_core/comfyJobStore";

describe("comfyJobStore", () => {
  beforeEach(() => _clearComfyJobs());

  it("存/取 done", () => {
    setComfyJobDone("j1", ["http://x/a.png"], "image", 1000);
    expect(getComfyJob("j1", 1000)).toEqual({ status: "done", urls: ["http://x/a.png"], outputType: "image", at: 1000 });
  });

  it("存/取 error", () => {
    setComfyJobError("j2", "boom", 1000);
    expect(getComfyJob("j2", 1000)).toEqual({ status: "error", error: "boom", at: 1000 });
  });

  it("未知 jobId → null", () => {
    expect(getComfyJob("nope")).toBeNull();
  });

  it("空 jobId 不写入", () => {
    setComfyJobDone("", ["x"], "image");
    expect(_comfyJobCount()).toBe(0);
  });

  it("过期（>20min）→ 视为不存在并清除", () => {
    setComfyJobDone("j3", ["x"], "image", 0);
    const TTL = 20 * 60 * 1000;
    expect(getComfyJob("j3", TTL - 1)).not.toBeNull(); // 未到期
    expect(getComfyJob("j3", TTL + 1)).toBeNull();     // 到期
    expect(_comfyJobCount()).toBe(0);                  // 已被清除
  });

  it("pruneComfyJobs 清过期条目", () => {
    setComfyJobDone("a", ["x"], "image", 0);
    setComfyJobDone("b", ["x"], "image", 0);
    pruneComfyJobs(21 * 60 * 1000);
    expect(_comfyJobCount()).toBe(0);
  });

  it("新结果覆盖同 jobId 旧结果", () => {
    setComfyJobError("j", "err", 1000);
    setComfyJobDone("j", ["u"], "video", 2000);
    expect(getComfyJob("j", 2000)).toEqual({ status: "done", urls: ["u"], outputType: "video", at: 2000 });
  });
});
