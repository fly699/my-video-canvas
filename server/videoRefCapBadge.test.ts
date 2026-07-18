// #246 吃图能力透明化守卫：badge 三档口径 + 与清单一致（0=纯文生的模型必须标出来，
// 否则用户选它时看不到「首帧/尾帧/角色参考不生效」的警示）。
import { describe, it, expect } from "vitest";
import { VIDEO_PROVIDER_MAX_REF_IMAGES, maxRefImagesForProvider, videoRefCapBadge } from "../shared/videoRefCaps";

describe("videoRefCapBadge", () => {
  it("三档标注：0→不吃图；1→首帧；≥2→首尾帧/多图×N", () => {
    expect(videoRefCapBadge("poyo_veo_lite")).toBe("不吃图（纯文生）");   // 清单里 0
    expect(videoRefCapBadge("poyo_sora2")).toBe("首帧图×1");             // 清单里 1
    expect(videoRefCapBadge("poyo_wan27_i2v")).toBe("首尾帧/多图×2");     // 清单里 2
    expect(videoRefCapBadge("poyo_seedance")).toBe("首尾帧/多图×9");      // 清单里 9
  });

  it("未知模型回退默认 1（与 maxRefImagesForProvider 同口径）", () => {
    expect(maxRefImagesForProvider("some_future_model")).toBe(1);
    expect(videoRefCapBadge("some_future_model")).toBe("首帧图×1");
  });

  it("清单中每个 0 值模型的 badge 都含「不吃图」（透明化不漏标）", () => {
    for (const [p, n] of Object.entries(VIDEO_PROVIDER_MAX_REF_IMAGES)) {
      if (n === 0) expect(videoRefCapBadge(p), p).toContain("不吃图");
      else expect(videoRefCapBadge(p), p).not.toContain("不吃图");
    }
  });
});
