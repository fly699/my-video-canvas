// #257 videoDurationCap 守卫：快捷设置把锁定视频模型的单镜时长上限算成准数注入提示词，
// 上限语义必须与 PROVIDER_PARAMS 参数表（节点参数控件同源）一致——参数表改档位这里自动跟随。
import { describe, it, expect } from "vitest";
import { videoDurationCap, PROVIDER_PARAMS } from "../shared/videoModelParams";

describe("videoDurationCap", () => {
  it("range 型 duration 取 max（poyo_seedance 4-15s → 15）", () => {
    const d = PROVIDER_PARAMS.poyo_seedance.find((x) => x.key === "duration");
    expect(d?.type).toBe("range");
    expect(videoDurationCap("poyo_seedance")).toBe(d && d.type === "range" ? d.max : undefined);
  });

  it("select 型 duration 取最大档（与参数表同源，逐模型自动跟随）", () => {
    for (const [provider, defs] of Object.entries(PROVIDER_PARAMS)) {
      const d = defs.find((x) => x.key === "duration");
      if (!d || d.type !== "select" || !d.options?.length) continue;
      const nums = d.options.map((o) => Number(o.value)).filter((n) => Number.isFinite(n) && n > 0);
      if (!nums.length) continue;
      expect(videoDurationCap(provider)).toBe(Math.max(...nums));
    }
  });

  it("无 duration 参数（固定时长模型）/ 未知 provider / 未锁定 → undefined", () => {
    const fixed = Object.entries(PROVIDER_PARAMS).find(([, defs]) => !defs.some((x) => x.key === "duration"));
    if (fixed) expect(videoDurationCap(fixed[0])).toBeUndefined();
    expect(videoDurationCap("no_such_provider")).toBeUndefined();
    expect(videoDurationCap(undefined)).toBeUndefined();
    expect(videoDurationCap("")).toBeUndefined();
  });
});
