// #151 round2 新模型接入守卫：提交体构建行为逐模型锁定。
// 权威依据：Poyo 官方 api-manual/*（经 MCP 文档取回）+ docs/incremental-models/
// 2026-07-round2-final-v2.json。任何字段路由/必填校验回归都会在此失败。
import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.POYO_API_KEY = "test-key";

let lastBody: { model: string; input: Record<string, unknown> } | null = null;

beforeEach(() => {
  lastBody = null;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    lastBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ code: 200, data: { task_id: "t_151" } }) } as unknown as Response;
  }));
});

const IMG = "https://cdn.example.com/a.png";
const IMG2 = "https://cdn.example.com/b.png";
const VID = "https://cdn.example.com/v.mp4";
const AUD = "https://cdn.example.com/a.mp3";

async function submit(opts: Record<string, unknown>) {
  const { submitPoyoVideo } = await import("./_core/poyoVideo");
  await submitPoyoVideo(opts as Parameters<typeof submitPoyoVideo>[0]);
  return lastBody!;
}

describe("#151 poyo 视频新模型提交体", () => {
  it("grok-imagine-video-1.5：单图必填走 image_urls，参数只透传 resolution/duration", async () => {
    const body = await submit({ provider: "poyo_grok_video_15", prompt: "hi", referenceImageUrl: IMG, params: { resolution: "480p", duration: 8, seed: 42, aspect_ratio: "16:9" } });
    expect(body.model).toBe("grok-imagine-video-1.5");
    expect(body.input.image_urls).toEqual([IMG]);
    expect(body.input.resolution).toBe("480p");
    expect(body.input.duration).toBe(8);
    expect(body.input.seed).toBeUndefined();          // schema 无 seed
    expect(body.input.aspect_ratio).toBeUndefined();  // schema 无 aspect_ratio
  });

  it("grok-imagine-video-1.5：缺图直接友好报错（不白扣费）", async () => {
    await expect(submit({ provider: "poyo_grok_video_15", prompt: "hi", params: {} })).rejects.toThrow(/输入图片/);
  });

  it("kling-avatar-2.0：驱动音频 → 单数 audio_url；缺音频报错；图片恰 1 张", async () => {
    const body = await submit({ provider: "poyo_kling_avatar2_std", prompt: "hi", referenceImageUrl: IMG, referenceAudioUrls: [AUD], params: {} });
    expect(body.model).toBe("kling-avatar-2.0/standard");
    expect(body.input.audio_url).toBe(AUD);
    expect(body.input.reference_audio_urls).toBeUndefined();
    expect(body.input.image_urls).toEqual([IMG]);
    await expect(submit({ provider: "poyo_kling_avatar2_pro", prompt: "hi", referenceImageUrl: IMG, params: {} })).rejects.toThrow(/驱动音频/);
  });

  it("wan-animate：源视频 → 单数 video_url，且不发 prompt/negative_prompt（schema 无此字段）", async () => {
    const body = await submit({ provider: "poyo_wan_animate_move", prompt: "should-be-dropped", negativePrompt: "neg", referenceImageUrl: IMG, referenceVideoUrls: [VID], params: { resolution: "580p" } });
    expect(body.model).toBe("wan-animate-move");
    expect(body.input.video_url).toBe(VID);
    expect(body.input.image_urls).toEqual([IMG]);
    expect(body.input.resolution).toBe("580p");
    expect(body.input.prompt).toBeUndefined();
    expect(body.input.negative_prompt).toBeUndefined();
    await expect(submit({ provider: "poyo_wan_animate_replace", prompt: "hi", referenceImageUrl: IMG, params: {} })).rejects.toThrow(/源视频/);
  });

  it("wan2.5：t2v 纯文生跳过参考图；i2v 单图 image_urls + negative_prompt 透传", async () => {
    const t = await submit({ provider: "poyo_wan25_text", prompt: "hi", referenceImageUrl: IMG, params: { aspect_ratio: "1280*720", duration: 10 } });
    expect(t.model).toBe("wan2.5-text-to-video");
    expect(t.input.image_urls).toBeUndefined();
    expect(t.input.aspect_ratio).toBe("1280*720");
    const i = await submit({ provider: "poyo_wan25_image", prompt: "hi", negativePrompt: "blurry", referenceImageUrl: IMG, params: { resolution: "1080p", duration: 5 } });
    expect(i.model).toBe("wan2.5-image-to-video");
    expect(i.input.image_urls).toEqual([IMG]);
    expect(i.input.negative_prompt).toBe("blurry");
  });

  it("seedance-2-mini：duration 必填缺省注入 5；无 seed/camera_fixed 透传", async () => {
    const body = await submit({ provider: "poyo_seedance2_mini", prompt: "hi", params: { resolution: "480p", seed: 7, camera_fixed: true } });
    expect(body.model).toBe("seedance-2-mini");
    expect(body.input.duration).toBe(5);
    expect(body.input.seed).toBeUndefined();
    expect(body.input.camera_fixed).toBeUndefined();
  });
});

describe("#151 二轮核查修正（hailuo-02 / happy-horse）", () => {
  it("hailuo-02：两张图 → image_urls[首帧] + end_image_url[尾帧]，并强制 768P", async () => {
    const body = await submit({ provider: "poyo_hailuo02", prompt: "hi", referenceImageUrls: [IMG, IMG2], params: { resolution: "512p", duration: 6 } });
    expect(body.input.image_urls).toEqual([IMG]);
    expect(body.input.end_image_url).toBe(IMG2);
    expect(body.input.resolution).toBe("768P"); // 尾帧模式官方要求 768P（且大写规范化）
  });

  it("hailuo-02：单图走 image_urls（不再落 reference_image_url 兜底）；小写分辨率规范化为大写", async () => {
    const body = await submit({ provider: "poyo_hailuo02", prompt: "hi", referenceImageUrl: IMG, params: { resolution: "512p" } });
    expect(body.input.image_urls).toEqual([IMG]);
    expect(body.input.reference_image_url).toBeUndefined();
    expect(body.input.resolution).toBe("512P");
  });

  it("hailuo-02-pro：不发 duration/resolution（官方标注 hailuo-02 only）", async () => {
    const body = await submit({ provider: "poyo_hailuo02_pro", prompt: "hi", params: { resolution: "1080p", duration: 6, prompt_optimizer: true } });
    expect(body.input.resolution).toBeUndefined();
    expect(body.input.duration).toBeUndefined();
    expect(body.input.prompt_optimizer).toBe(true);
  });

  it("happy-horse：连源视频 → video_url（视频编辑模式）+ audio_setting 透传", async () => {
    const body = await submit({ provider: "poyo_happy_horse", prompt: "hi", referenceVideoUrls: [VID], params: { audio_setting: "origin", resolution: "1080p" } });
    expect(body.input.video_url).toBe(VID);
    expect(body.input.audio_setting).toBe("origin");
  });
});

describe("#151 poyo 图像新模型（buildPoyoImageInput）", () => {
  it("grok-imagine-image-quality：枚举外比例钳回 16:9；枚举内原样；带图走同 wire（unifiedRef）", async () => {
    const { buildPoyoImageInput, POYO_IMAGE_SPECS } = await import("./_core/imageGeneration");
    const spec = POYO_IMAGE_SPECS.poyo_grok_image_quality;
    const a = await buildPoyoImageInput(spec, { prompt: "p", size: "4:3" });
    expect(a.input.aspect_ratio).toBe("16:9");
    const b = await buildPoyoImageInput(spec, { prompt: "p", size: "2:3", resolution: "2K" });
    expect(b.input.aspect_ratio).toBe("2:3");
    expect(b.input.resolution).toBe("2K");
    const c = await buildPoyoImageInput(spec, { prompt: "p", originalImages: [{ url: IMG }] });
    expect(c.model).toBe("grok-imagine-image-quality"); // 无 -edit 后缀，同 wire 编辑
    expect(c.input.image_urls).toEqual([IMG]);
  });

  it("seedream-5.0-pro / nano-banana-2-lite：带参考图切到 -edit wire；flux-schnell 纯文生丢弃参考图", async () => {
    const { buildPoyoImageInput, POYO_IMAGE_SPECS } = await import("./_core/imageGeneration");
    const sp = await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_seedream_5_pro, { prompt: "p", originalImages: [{ url: IMG }] });
    expect(sp.model).toBe("seedream-5.0-pro-edit");
    const nb = await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_nano_banana_2_lite, { prompt: "p", originalImages: [{ url: IMG }] });
    expect(nb.model).toBe("nano-banana-2-lite-edit");
    const fs = await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_flux_schnell, { prompt: "p", originalImages: [{ url: IMG }] });
    expect(fs.model).toBe("flux-schnell");
    expect(fs.input.image_urls).toBeUndefined(); // schema 无 image_urls
  });
});

describe("#151 kie 新模型注册表", () => {
  it("kie LLM：6 个新模型注册齐全，wire/端点/格式正确（claude-sonnet-5 用正确拼写）", async () => {
    const { KIE_LLM_MODELS } = await import("./_core/kieLLM");
    expect(KIE_LLM_MODELS.kie_gpt_5_6_luna).toMatchObject({ model: "gpt-5-6-luna", path: "/codex/v1/responses", format: "responses" });
    expect(KIE_LLM_MODELS.kie_gpt_5_6_terra.model).toBe("gpt-5-6-terra");
    expect(KIE_LLM_MODELS.kie_gpt_5_6_sol.model).toBe("gpt-5-6-sol");
    expect(KIE_LLM_MODELS.kie_claude_sonnet_5).toMatchObject({ model: "claude-sonnet-5", path: "/claude/v1/messages", format: "claude" });
    expect(KIE_LLM_MODELS.kie_grok_4_3).toMatchObject({ model: "grok-4-3", path: "/grok/v1/responses", format: "responses" });
    expect(KIE_LLM_MODELS.kie_grok_4_5.model).toBe("grok-4-5");
  });

  it("kie 图像：nano-banana-2-lite 配对（15 值 aspect 枚举）+ seedream 5 Pro 编辑（quality 固定 basic）", async () => {
    const { KIE_IMAGE_MODELS, KIE_T2I_TO_I2I } = await import("./_core/kieImage");
    expect(KIE_IMAGE_MODELS.kie_nano_banana_2_lite.id).toBe("nano-banana-2-lite");
    expect(KIE_IMAGE_MODELS.kie_nano_banana_2_lite.aspects).toContain("auto");
    expect(KIE_IMAGE_MODELS.kie_nano_banana_2_lite.aspects).toContain("21:9");
    expect(KIE_IMAGE_MODELS.kie_nano_banana_2_lite_i2i.ref).toBe("image_urls");
    expect(KIE_T2I_TO_I2I.kie_nano_banana_2_lite).toBe("kie_nano_banana_2_lite_i2i");
    expect(KIE_IMAGE_MODELS.kie_seedream_5pro_i2i).toMatchObject({ id: "seedream/5-pro-image-to-image", ref: "image_urls" });
    expect(KIE_IMAGE_MODELS.kie_seedream_5pro_i2i.fixed).toMatchObject({ quality: "basic" });
  });

  it("poyo 3D：5 个可选模型注册且字段白名单互斥（meshy 用 should_texture，hunyuan 用 face_count）", async () => {
    const { POYO_3D_MODELS } = await import("./_core/poyo3d");
    expect(Object.keys(POYO_3D_MODELS).sort()).toEqual(["hunyuan_pro", "hunyuan_rapid", "meshy_6", "tripo_h31", "tripo_p1"]);
    expect(POYO_3D_MODELS.meshy_6.fields.has("should_texture")).toBe(true);
    expect(POYO_3D_MODELS.meshy_6.fields.has("texture")).toBe(false);
    expect(POYO_3D_MODELS.hunyuan_pro.fields.has("face_count")).toBe(true);
    expect(POYO_3D_MODELS.tripo_p1.fields.has("pbr")).toBe(false);
  });
});

describe("#151 poyo TTS 键过滤（严禁跨模型透传）", () => {
  it("gemini/xai 只发 text+voice；elevenlabs turbo 与 v3 同参数族", async () => {
    const { submitAndPollPoyoTTS } = await import("./_core/poyoAudio");
    // 只验证提交体（首个 fetch 即 submit），轮询走不到（mock 直接返回 task_id 后我们不等待）。
    const submitOnce = async (model: string, extra: Record<string, unknown> = {}) => {
      lastBody = null;
      const p = submitAndPollPoyoTTS({ model: model as never, text: "你好", voice: "Kore", stability: 0.5, timestamps: true, languageCode: "zh", applyTextNormalization: "auto", ...extra });
      // 等 submit fetch 完成即可断言（轮询在后台超时无妨——立刻拒绝掉 promise 防泄漏）
      await vi.waitFor(() => { if (!lastBody) throw new Error("not yet"); });
      p.catch(() => { /* 不等待轮询 */ });
      return lastBody!;
    };
    const g = await submitOnce("gemini-3-1-flash-tts");
    expect(g.model).toBe("gemini-3-1-flash-tts");
    expect(g.input.voice).toBe("Kore");
    expect(g.input.stability).toBeUndefined();
    expect(g.input.language_code).toBeUndefined(); // gemini 语言码为长名枚举，不透传 ISO 码
    expect(g.input.timestamps).toBeUndefined();
    const x = await submitOnce("xai-tts-1");
    expect(x.input.stability).toBeUndefined();
    const t = await submitOnce("elevenlabs-tts-turbo-2-5");
    expect(t.input.stability).toBe(0.5);
    expect(t.input.language_code).toBe("zh");
  }, 20_000);
});
