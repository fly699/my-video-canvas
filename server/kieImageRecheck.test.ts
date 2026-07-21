// #317 kie 图像任务状态判读（轮询与「重新检测」找回共用的纯函数）。
import { describe, it, expect } from "vitest";
import { parseKieImageRecord, kieImageRecordUrl } from "./_core/kieImage";

describe("#317 parseKieImageRecord / kieImageRecordUrl", () => {
  it("flux-kontext：successFlag=1 取 resultImageUrl（单数驼峰）；2/3 失败带原因；其余 pending", () => {
    expect(parseKieImageRecord("flux-kontext", "m", "t1", { data: { successFlag: 1, response: { resultImageUrl: "https://x/1.png" } } }))
      .toEqual({ kind: "finished", urls: ["https://x/1.png"] });
    expect(parseKieImageRecord("flux-kontext", "m", "t1", { data: { successFlag: 2, errorMessage: "内容拦截" } }))
      .toEqual({ kind: "failed", error: "内容拦截" });
    expect(parseKieImageRecord("flux-kontext", "m", "t1", { data: { successFlag: 0 } })).toEqual({ kind: "pending" });
  });

  it("gpt4o：successFlag=1 取 result_urls 数组；无 data 段 pending", () => {
    expect(parseKieImageRecord("gpt4o", "m", "t2", { data: { successFlag: 1, response: { result_urls: ["https://x/a.png", "https://x/b.png"] } } }))
      .toEqual({ kind: "finished", urls: ["https://x/a.png", "https://x/b.png"] });
    expect(parseKieImageRecord("gpt4o", "m", "t2", {})).toEqual({ kind: "pending" });
  });

  it("record URL 按端点映射（jobs 为默认统一端点）", () => {
    expect(kieImageRecordUrl("flux-kontext")).toContain("/flux/kontext/record-info");
    expect(kieImageRecordUrl("gpt4o")).toContain("/gpt4o-image/record-info");
    expect(kieImageRecordUrl("jobs")).toContain("/jobs/recordInfo");
    expect(kieImageRecordUrl("anything-else")).toContain("/jobs/recordInfo");
  });
});
