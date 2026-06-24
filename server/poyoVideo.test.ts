import { describe, expect, it, vi, beforeEach } from "vitest";

// submitPoyoVideo reads ENV.poyoApiKey (from process.env at import) and POSTs to
// Poyo. Set the key before importing, and mock fetch to capture the request body
// so we can assert required-param defaults (Kling `sound`) are injected.
process.env.POYO_API_KEY = "test-key";

let lastBody: { model: string; input: Record<string, unknown> } | null = null;

beforeEach(() => {
  lastBody = null;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    lastBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ code: 200, data: { task_id: "t_123" } }) } as unknown as Response;
  }));
});

async function submit(provider: string, params: Record<string, unknown>) {
  const { submitPoyoVideo } = await import("./_core/poyoVideo");
  await submitPoyoVideo({ provider, prompt: "hi", params });
  return lastBody!;
}

// Submit with reference images. URLs are absolute http(s) so resolveToAbsoluteUrl
// passes them through unchanged, letting us assert the exact field mapping.
async function submitWithRefs(provider: string, urls: string[], params: Record<string, unknown> = {}) {
  const { submitPoyoVideo } = await import("./_core/poyoVideo");
  await submitPoyoVideo({
    provider, prompt: "hi", params,
    referenceImageUrl: urls[0],
    referenceImageUrls: urls.length > 1 ? urls : undefined,
  });
  return lastBody!;
}
const A = "https://cdn.example.com/a.png";
const B = "https://cdn.example.com/b.png";
const C = "https://cdn.example.com/c.png";

describe("submitPoyoVideo required-param defaults", () => {
  it("injects sound:false for Kling o3 standard when the UI didn't provide it", async () => {
    const body = await submit("poyo_kling_o3_std", { aspect_ratio: "16:9", duration: 5 });
    expect(body.model).toBe("kling-o3/standard");
    expect(body.input.sound).toBe(false);
  });

  it("respects an explicit sound value over the default", async () => {
    const body = await submit("poyo_kling_o3_pro", { aspect_ratio: "16:9", duration: 5, sound: true });
    expect(body.input.sound).toBe(true);
  });

  it("injects sound:false for the whole Kling 3.0 / 2.6 family", async () => {
    for (const [provider, model] of [
      ["poyo_kling26", "kling-2.6"],
      ["poyo_kling_o3_4k", "kling-o3/4K"],
    ] as const) {
      const body = await submit(provider, { aspect_ratio: "16:9", duration: 5 });
      expect(body.model).toBe(model);
      expect(body.input.sound).toBe(false);
    }
  });

  it("does not inject sound for models that don't require it", async () => {
    const body = await submit("poyo_kling26", {}); // kling-2.6 requires sound → injected
    expect(body.input.sound).toBe(false);
    const body2 = await submit("poyo_seedance", { resolution: "1080p", duration: 5 });
    expect("sound" in body2.input).toBe(false);
  });
});

describe("submitPoyoVideo single-image mapping (unchanged)", () => {
  it("kling 2.1 → start_image_url", async () => {
    const body = await submitWithRefs("poyo_kling21_std", [A]);
    expect(body.input.start_image_url).toBe(A);
    expect("image_urls" in body.input).toBe(false);
  });
  it("wan i2v / sora-official / veo → image_urls[0]", async () => {
    expect((await submitWithRefs("poyo_wan27_i2v", [A])).input.image_urls).toEqual([A]);
    expect((await submitWithRefs("poyo_sora2_official", [A])).input.image_urls).toEqual([A]);
    expect((await submitWithRefs("poyo_veo_fast", [A])).input.image_urls).toEqual([A]);
  });
  it("seedance 单图 → image_urls[0]（首帧，与 2 图首尾帧一致；不再落非法的单数 reference_image_url）", async () => {
    const b = await submitWithRefs("poyo_seedance", [A]);
    expect(b.model).toBe("seedance-2");
    expect(b.input.image_urls).toEqual([A]);
    expect("reference_image_url" in b.input).toBe(false);
    expect((await submitWithRefs("poyo_seedance2_fast", [A])).input.image_urls).toEqual([A]);
  });
  it("everything else → reference_image_url", async () => {
    expect((await submitWithRefs("poyo_grok_video", [A])).input.reference_image_url).toBe(A);
  });
});

describe("submitPoyoVideo multi-image mapping (per-model)", () => {
  it("kling 2.1 pro / 2.5 turbo → start + end frame", async () => {
    const body = await submitWithRefs("poyo_kling21_pro", [A, B]);
    expect(body.input.start_image_url).toBe(A);
    expect(body.input.end_image_url).toBe(B);
    const t = await submitWithRefs("poyo_kling25_turbo", [A, B]);
    expect(t.input.start_image_url).toBe(A);
    expect(t.input.end_image_url).toBe(B);
  });

  it("wan i2v / kling 3.0 → image_urls (首尾帧, cap 2)", async () => {
    expect((await submitWithRefs("poyo_wan27_i2v", [A, B])).input.image_urls).toEqual([A, B]);
    expect((await submitWithRefs("poyo_kling30_pro", [A, B, C])).input.image_urls).toEqual([A, B]);
  });

  it("veo 3.1 fast → image_urls + generation_type (2=frame, 3=reference)", async () => {
    const frame = await submitWithRefs("poyo_veo_fast", [A, B]);
    expect(frame.input.image_urls).toEqual([A, B]);
    expect(frame.input.generation_type).toBe("frame");
    const ref = await submitWithRefs("poyo_veo_fast", [A, B, C]);
    expect(ref.input.image_urls).toEqual([A, B, C]);
    expect(ref.input.generation_type).toBe("reference");
  });

  it("veo 3.1 fast → explicit generation_type param overrides inference", async () => {
    const body = await submitWithRefs("poyo_veo_fast", [A, B, C], { generation_type: "frame" });
    expect(body.input.generation_type).toBe("frame");
  });

  it("seedance / kling-o3 → image_urls within frame cap, reference_image_urls beyond", async () => {
    // 2 imgs ≤ frame cap (2) → image_urls
    expect((await submitWithRefs("poyo_seedance", [A, B])).input.image_urls).toEqual([A, B]);
    // 3 imgs > frame cap → reference mode
    expect((await submitWithRefs("poyo_seedance", [A, B, C])).input.reference_image_urls).toEqual([A, B, C]);
    // kling-o3 reference cap 4
    expect((await submitWithRefs("poyo_kling_o3_pro", [A, B, C])).input.reference_image_urls).toEqual([A, B, C]);
  });

  it("happy-horse → 1 img keeps legacy single field, 2+ = reference_image_urls", async () => {
    // Single image: unchanged legacy mapping (reference_image_url) — we don't
    // touch working single-image behavior. Multiple: reference mode.
    expect((await submitWithRefs("poyo_happy_horse", [A])).input.reference_image_url).toBe(A);
    expect((await submitWithRefs("poyo_happy_horse", [A, B])).input.reference_image_urls).toEqual([A, B]);
  });

  it("model without multi support → first image only, single mapping", async () => {
    // grok has no multi spec → falls back to reference_image_url on first image
    const body = await submitWithRefs("poyo_grok_video", [A, B]);
    expect(body.input.reference_image_url).toBe(A);
    expect("reference_image_urls" in body.input).toBe(false);
  });

  it("de-dupes repeated URLs before mapping", async () => {
    const body = await submitWithRefs("poyo_kling21_pro", [A, A]);
    expect(body.input.start_image_url).toBe(A);
    expect("end_image_url" in body.input).toBe(false); // dupe dropped → single
  });
});

describe("submitPoyoVideo multi-modal references (video/audio)", () => {
  async function submitMM(provider: string, opts: { videos?: string[]; audios?: string[] }) {
    const { submitPoyoVideo } = await import("./_core/poyoVideo");
    await submitPoyoVideo({ provider, prompt: "hi", params: {}, referenceVideoUrls: opts.videos, referenceAudioUrls: opts.audios });
    return lastBody!;
  }
  const V = "https://cdn.example.com/v1.mp4";
  const V2 = "https://cdn.example.com/v2.mp4";
  const AU = "https://cdn.example.com/a1.mp3";

  it("maps reference videos/audios for seedance-2", async () => {
    const body = await submitMM("poyo_seedance", { videos: [V, V2], audios: [AU] });
    expect(body.input.reference_video_urls).toEqual([V, V2]);
    expect(body.input.reference_audio_urls).toEqual([AU]);
  });

  it("caps reference videos at the model's limit (3)", async () => {
    const many = ["1", "2", "3", "4"].map((n) => `https://cdn.example.com/${n}.mp4`);
    const body = await submitMM("poyo_seedance", { videos: many });
    expect((body.input.reference_video_urls as string[]).length).toBe(3);
  });

  it("does NOT forward references to wan2.7 t2v/i2v (reference mode is a separate wire model)", async () => {
    const body = await submitMM("poyo_wan27_t2v", { videos: [V], audios: [AU] });
    expect(body.input.reference_video_urls).toBeUndefined();
    expect(body.input.reference_audio_urls).toBeUndefined();
  });

  it("omits both for a model without multi-modal reference (e.g. kling 2.6)", async () => {
    const body = await submitMM("poyo_kling26", { videos: [V], audios: [AU] });
    expect(body.input.reference_video_urls).toBeUndefined();
    expect(body.input.reference_audio_urls).toBeUndefined();
  });

  it("reference mode is mutually exclusive with image_urls (image → reference_image_urls)", async () => {
    const { submitPoyoVideo } = await import("./_core/poyoVideo");
    await submitPoyoVideo({
      provider: "poyo_seedance", prompt: "hi", params: {},
      referenceImageUrl: "https://cdn.example.com/img.png",
      referenceVideoUrls: [V],
    });
    expect(lastBody!.input.image_urls).toBeUndefined();
    expect(lastBody!.input.reference_image_urls).toEqual(["https://cdn.example.com/img.png"]);
    expect(lastBody!.input.reference_video_urls).toEqual([V]);
  });
});

describe("submitPoyoVideo explicit referenceMode (character SUBJECT references)", () => {
  async function submitMode(provider: string, urls: string[], mode?: "reference" | "frame") {
    const { submitPoyoVideo } = await import("./_core/poyoVideo");
    await submitPoyoVideo({
      provider, prompt: "hi", params: {},
      referenceImageUrl: urls[0],
      referenceImageUrls: urls.length > 1 ? urls : undefined,
      referenceMode: mode,
    });
    return lastBody!;
  }

  it("seedance: 2 SUBJECT refs route to reference_image_urls (NOT首尾帧 image_urls)", async () => {
    // Without the flag, 2 imgs ≤ frame cap → image_urls (start/end frame).
    expect((await submitMode("poyo_seedance", [A, B])).input.image_urls).toEqual([A, B]);
    // With referenceMode:"reference", they're subjects → reference_image_urls.
    const ref = await submitMode("poyo_seedance", [A, B], "reference");
    expect(ref.input.reference_image_urls).toEqual([A, B]);
    expect("image_urls" in ref.input).toBe(false);
  });

  it("seedance: a SINGLE subject ref also goes to reference_image_urls", async () => {
    const ref = await submitMode("poyo_seedance", [A], "reference");
    expect(ref.input.reference_image_urls).toEqual([A]);
    expect("image_urls" in ref.input).toBe(false);
  });

  it("kling-o3: subject refs route to reference_image_urls (cap 4)", async () => {
    const ref = await submitMode("poyo_kling_o3_pro", [A, B], "reference");
    expect(ref.input.reference_image_urls).toEqual([A, B]);
  });

  it("model without a reference mode (wan i2v) falls back to frame image_urls", async () => {
    // wan2.7-i2v has no referenceImages in its spec → reference mode can't apply,
    // so the start image still maps to image_urls (graceful, no regression).
    const ref = await submitMode("poyo_wan27_i2v", [A, B], "reference");
    expect(ref.input.image_urls).toEqual([A, B]);
    expect("reference_image_urls" in ref.input).toBe(false);
  });
});

describe("submitPoyoVideo Wan 2.7 参考生视频（多模态参考，docs:166）", () => {
  const V = "https://cdn.example.com/ref.mp4";
  async function submitRef(opts: { images?: string[]; videos?: string[] }) {
    const { submitPoyoVideo } = await import("./_core/poyoVideo");
    await submitPoyoVideo({
      provider: "poyo_wan27_ref", prompt: "hi", params: { resolution: "720p", duration: 5 },
      referenceImageUrl: opts.images?.[0],
      referenceImageUrls: opts.images && opts.images.length > 1 ? opts.images : undefined,
      referenceVideoUrls: opts.videos,
    });
    return lastBody!;
  }

  it("参考图 → reference_image_urls（多模态参考，不走首尾帧 image_urls）", async () => {
    const b = await submitRef({ images: [A, B] });
    expect(b.model).toBe("wan2.7-reference-to-video");
    expect(b.input.reference_image_urls).toEqual([A, B]);
    expect("image_urls" in b.input).toBe(false);
  });

  it("参考图截断到 4 张", async () => {
    const D = "https://cdn.example.com/d.png", E = "https://cdn.example.com/e.png";
    const b = await submitRef({ images: [A, B, C, D, E] });
    expect(b.input.reference_image_urls).toEqual([A, B, C, D]);
  });

  it("仅参考视频也可（reference_video_urls）", async () => {
    const b = await submitRef({ videos: [V] });
    expect(b.input.reference_video_urls).toEqual([V]);
  });

  it("既无参考图也无参考视频 → 抛错（docs:166 至少一种）", async () => {
    const { submitPoyoVideo } = await import("./_core/poyoVideo");
    await expect(submitPoyoVideo({ provider: "poyo_wan27_ref", prompt: "hi", params: {} }))
      .rejects.toThrow(/参考/);
  });
});

describe("submitPoyoVideo Veo 3.1 官方版（docs:74-85）", () => {
  it("fast-official：单图 → image_urls(i2v)，sound 透传", async () => {
    const b = await submitWithRefs("poyo_veo_fast_official", [A], { sound: false, duration: 6 });
    expect(b.model).toBe("veo3.1-fast-official");
    expect(b.input.image_urls).toEqual([A]);
    expect(b.input.sound).toBe(false);
    expect(b.input.duration).toBe(6);
  });
  it("lite-official：最多 2 图(首尾帧)、不强制 reference", async () => {
    const b = await submitWithRefs("poyo_veo_lite_official", [A, B]);
    expect(b.model).toBe("veo3.1-lite-official");
    expect(b.input.image_urls).toEqual([A, B]);
    expect("reference_image_urls" in b.input).toBe(false);
  });
});

describe("submitPoyoVideo Veo 3.1 档位约束（docs:64-71）", () => {
  it("veo3.1-lite 纯文生：附参考图也不发任何图字段（lite 不支持 image_urls）", async () => {
    const b = await submitWithRefs("poyo_veo_lite", [A]);
    expect(b.model).toBe("veo3.1-lite");
    expect("image_urls" in b.input).toBe(false);
    expect("reference_image_url" in b.input).toBe(false);
    expect("reference_image_urls" in b.input).toBe(false);
  });
  it("veo3.1-quality 丢弃非法的 generation_type:reference（quality 不支持 reference）", async () => {
    const b = await submit("poyo_veo_quality", { generation_type: "reference", resolution: "1080p" });
    expect(b.model).toBe("veo3.1-quality");
    expect("generation_type" in b.input).toBe(false);
  });
  it("veo3.1-fast 仍可显式 frame，且保留 reference 能力", async () => {
    const b = await submit("poyo_veo_fast", { generation_type: "frame" });
    expect(b.input.generation_type).toBe("frame");
  });
});
