import { describe, it, expect } from "vitest";
import { jimengPriceSignature } from "./jimengPricing";

describe("jimengPriceSignature（record 与 lookup 的耦合键，必须稳定一致）", () => {
  it("同 provider+参数 → 同签名", () => {
    const p = { model_version: "seedance2.0fast", video_resolution: "720p", duration: 5, prompt: "无关字段" };
    expect(jimengPriceSignature("jimeng_text2video", p)).toBe("jimeng_text2video|seedance2.0fast|720p|5");
  });
  it("忽略无关参数（prompt/seed 等不进签名）", () => {
    const a = jimengPriceSignature("jimeng_text2video", { model_version: "seedance2.0", video_resolution: "1080p", duration: 8, prompt: "x" });
    const b = jimengPriceSignature("jimeng_text2video", { model_version: "seedance2.0", video_resolution: "1080p", duration: 8, prompt: "y", seed: 42 });
    expect(a).toBe(b);
  });
  it("时长取整、缺省归一（0）", () => {
    expect(jimengPriceSignature("jimeng_image2video", { model_version: "seedance2.0_vip", video_resolution: "720p", duration: 5.4 })).toBe("jimeng_image2video|seedance2.0_vip|720p|5");
    expect(jimengPriceSignature("jimeng_multiframe2video", {})).toBe("jimeng_multiframe2video|||0");
  });
  it("不同分辨率/时长/模型 → 不同签名（分档计价）", () => {
    const base = { model_version: "seedance2.0fast", video_resolution: "720p", duration: 5 };
    expect(jimengPriceSignature("jimeng_text2video", base)).not.toBe(jimengPriceSignature("jimeng_text2video", { ...base, video_resolution: "1080p" }));
    expect(jimengPriceSignature("jimeng_text2video", base)).not.toBe(jimengPriceSignature("jimeng_text2video", { ...base, duration: 10 }));
  });
});
