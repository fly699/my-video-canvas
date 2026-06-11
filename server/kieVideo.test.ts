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

import { parseKieJobStatus } from "./_core/kieVideo";

describe("parseKieJobStatus — 多形态兼容（seedance-2 / grok 卡死修复）", () => {
  it("successFlag=1 + response.result_urls（文档标准形态）", () => {
    const r = parseKieJobStatus({ successFlag: 1, response: { result_urls: ["https://x/v.mp4"] } });
    expect(r).toEqual({ status: "finished", resultVideoUrls: ["https://x/v.mp4"] });
  });
  it("state=\"success\" 而非 successFlag（新模型 seedance-2 / grok 实测形态）", () => {
    const r = parseKieJobStatus({ state: "success", response: { resultUrls: ["https://x/g.mp4"] } });
    expect(r.status).toBe("finished");
    expect(r.resultVideoUrls).toEqual(["https://x/g.mp4"]);
  });
  it("successFlag 为字符串 \"1\"", () => {
    const r = parseKieJobStatus({ successFlag: "1", response: { videoUrl: "https://x/s.mp4" } });
    expect(r.status).toBe("finished");
  });
  it("videos:[{url}] 数组形态", () => {
    const r = parseKieJobStatus({ state: "completed", response: { videos: [{ url: "https://x/a.mp4" }] } });
    expect(r.resultVideoUrls).toEqual(["https://x/a.mp4"]);
  });
  it("resultJson 字符串内嵌 URL", () => {
    const r = parseKieJobStatus({ successFlag: 1, response: { resultJson: JSON.stringify({ resultUrls: ["https://x/j.mp4"] }) } });
    expect(r.resultVideoUrls).toEqual(["https://x/j.mp4"]);
  });
  it("成功但无 URL → [CHARGED] 失败", () => {
    const r = parseKieJobStatus({ successFlag: 1, response: {} });
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toContain("CHARGED");
  });
  it("进行中（successFlag=0 / 无终态信号）→ processing", () => {
    expect(parseKieJobStatus({ successFlag: 0, progress: "0.5" }).status).toBe("processing");
    expect(parseKieJobStatus({ state: "generating" }).status).toBe("processing");
  });
  it("失败（successFlag=2 / state=failed）", () => {
    expect(parseKieJobStatus({ successFlag: 2, errorMessage: "boom" }).status).toBe("failed");
    expect(parseKieJobStatus({ state: "failed" }).status).toBe("failed");
  });
});

describe("parseKieJobStatus — 音频字段（TTS/SFX 共用）", () => {
  it("response.audio_url / audioUrl 提取", () => {
    expect(parseKieJobStatus({ state: "success", response: { audio_url: "https://x/v.mp3" } }).resultVideoUrls).toEqual(["https://x/v.mp3"]);
    expect(parseKieJobStatus({ successFlag: 1, response: { audioUrl: "https://x/a.mp3" } }).resultVideoUrls).toEqual(["https://x/a.mp3"]);
  });
});
