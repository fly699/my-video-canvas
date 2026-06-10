import { describe, it, expect } from "vitest";
import { KIE_VIDEO_SPECS, isKieVideoProvider, listKieVideoProviders } from "./_core/kieVideo";
import { VIDEO_PROVIDERS } from "../shared/types";

describe("kie video specs", () => {
  it("每个 kie 视频 provider 都在 VIDEO_PROVIDERS 枚举里（前后端同步）", () => {
    const set = new Set<string>(VIDEO_PROVIDERS as readonly string[]);
    for (const k of Object.keys(KIE_VIDEO_SPECS)) {
      expect(set.has(k), `${k} 不在 VIDEO_PROVIDERS`).toBe(true);
    }
  });

  it("VIDEO_PROVIDERS 里所有 kie_ 值都有 spec（无悬空枚举）", () => {
    for (const v of VIDEO_PROVIDERS) {
      if (v.startsWith("kie_")) expect(v in KIE_VIDEO_SPECS, `${v} 缺少 spec`).toBe(true);
    }
  });

  it("isKieVideoProvider 只对已注册 kie 视频模型为真", () => {
    expect(isKieVideoProvider("kie_kling26_t2v")).toBe(true);
    expect(isKieVideoProvider("kie_veo31_fast")).toBe(true);
    expect(isKieVideoProvider("poyo_kling26")).toBe(false);
    expect(isKieVideoProvider("hf_dop_lite")).toBe(false);
    expect(isKieVideoProvider("mock")).toBe(false);
  });

  it("wire id / endpoint / 参考图字段符合文档约定", () => {
    // Veo uses the dedicated endpoint + camelCase top-level imageUrls.
    expect(KIE_VIDEO_SPECS.kie_veo31_quality.endpoint).toBe("veo");
    expect(KIE_VIDEO_SPECS.kie_veo31_quality.wire).toBe("veo3");
    expect(KIE_VIDEO_SPECS.kie_veo31_quality.ref).toMatchObject({ key: "imageUrls", array: true, top: true });
    // Unified jobs models.
    expect(KIE_VIDEO_SPECS.kie_kling26_t2v.endpoint).toBe("jobs");
    expect(KIE_VIDEO_SPECS.kie_kling26_t2v.wire).toBe("kling-2.6/text-to-video");
    // i2v reference field arity (single image_url vs image_urls array) per model.
    expect(KIE_VIDEO_SPECS.kie_kling26_i2v.ref).toMatchObject({ key: "image_urls", array: true, required: true });
    expect(KIE_VIDEO_SPECS.kie_kling25turbo_i2v.ref).toMatchObject({ key: "image_url", array: false, required: true });
    expect(KIE_VIDEO_SPECS.kie_wan25_i2v.ref).toMatchObject({ key: "image_url", array: false });
    expect(KIE_VIDEO_SPECS.kie_wan26_i2v.ref).toMatchObject({ key: "image_urls", array: true });
    expect(KIE_VIDEO_SPECS.kie_hailuo23_pro.ref).toMatchObject({ key: "image_url", required: true });
    // Seedance multimodal first-frame ref (text-only by default, not required).
    expect(KIE_VIDEO_SPECS.kie_seedance2.ref?.key).toBe("first_frame_url");
    expect(KIE_VIDEO_SPECS.kie_seedance2.ref?.required).toBeFalsy();
  });

  it("每个 spec 都带文档计费标注 + 合法 wire/params", () => {
    for (const [k, s] of Object.entries(KIE_VIDEO_SPECS)) {
      expect(s.creditNote.length, `${k} 缺 creditNote`).toBeGreaterThan(0);
      expect(Array.isArray(s.params), `${k} params 非数组`).toBe(true); // 数字人等无可调参数 → 空数组合法
      expect(s.wire.length).toBeGreaterThan(0);
      // 数字人需音频输入，动作控制/Animate 需源视频输入。
      if (k.includes("avatar")) expect(s.audioRef?.key, `${k} 缺 audioRef`).toBeTruthy();
      if (k.includes("motion") || k.includes("animate")) expect(s.videoRef?.key, `${k} 缺 videoRef`).toBeTruthy();
    }
  });

  it("seedance 的 duration 是数值型，kling/wan/hailuo 的 duration 是字符串型（符合文档 enum）", () => {
    const dur = (k: string) => KIE_VIDEO_SPECS[k].params.find((p) => p.key === "duration");
    expect(dur("kie_seedance2")?.type).toBe("num");
    expect(dur("kie_kling26_t2v")?.type).toBe("str");
    expect(dur("kie_wan26_t2v")?.type).toBe("str");
    expect(dur("kie_hailuo23_pro")?.type).toBe("str");
  });

  it("listKieVideoProviders 暴露 needsRef（i2v 必填参考图）", () => {
    const map = new Map(listKieVideoProviders().map((p) => [p.value, p]));
    expect(map.get("kie_kling26_i2v")?.needsRef).toBe(true);
    expect(map.get("kie_kling26_t2v")?.needsRef).toBe(false);
    expect(map.get("kie_seedance2")?.needsRef).toBe(false);
  });
});
