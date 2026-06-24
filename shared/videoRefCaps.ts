// ── Video provider reference-image capacity ──────────────────────────────────
// How many reference images each video provider's underlying model actually
// consumes (see docs/poyo-video-api.md). Used by the VideoTaskNode UI to tell
// the user how many of the attached references are really sent, and to cap the
// count. The backend (server/_core/poyoVideo.ts MULTI_IMAGE_SPEC) is the source
// of truth for the exact API-field mapping; this mirrors only the total count.
//
// 0 = text-to-video only (reference image ignored); 1 = single image; N>1 =
// genuine multi-image (首尾帧 / reference / elements modes).
export const VIDEO_PROVIDER_MAX_REF_IMAGES: Record<string, number> = {
  mock: 1,
  // Seedance — frame (≤2) or multi-reference (≤9)
  poyo_seedance: 9,
  poyo_seedance2_fast: 9,
  poyo_seedance1_pro: 1,
  poyo_seedance15_pro: 1,
  // Veo 3.1 — fast: frame(2)/reference(3); quality: frame(2); lite: no image
  poyo_veo: 3,
  poyo_veo_fast: 3,
  poyo_veo_quality: 2,
  poyo_veo_lite: 0,
  poyo_veo_fast_official: 3,
  poyo_veo_quality_official: 3,  // 官方版 quality 支持 reference(3 图)
  poyo_veo_lite_official: 2,     // 最多 2 图(首尾帧)，无 reference
  // Kling
  poyo_kling26: 1,
  poyo_kling_o3_std: 4,
  poyo_kling_o3_pro: 4,
  poyo_kling_o3_4k: 4,
  poyo_kling21_std: 1,   // standard: start frame only
  poyo_kling21_pro: 2,   // pro: start + end frame
  poyo_kling25_turbo: 2, // start + end frame
  poyo_kling30_std: 2,   // start + end frame
  poyo_kling30_pro: 2,
  poyo_kling30_4k: 2,
  // Wan
  poyo_wan25_t2v: 0,
  poyo_wan25_i2v: 1,
  poyo_wan27_t2v: 0,
  poyo_wan27_i2v: 2,     // [0]start [1]end
  poyo_wan27_ref: 4,     // 参考生：多模态参考图 ≤4（reference_image_urls）
  poyo_wan22_t2v_fast: 0,
  poyo_wan22_i2v_fast: 2,
  // Hailuo
  poyo_hailuo02: 1,
  poyo_hailuo02_pro: 1,
  poyo_hailuo23: 1,
  // others
  poyo_happy_horse: 9,   // reference mode (1-9)
  poyo_grok_video: 1,
  poyo_runway45: 1,
  // Sora — single guide image at most
  poyo_sora2: 1,
  poyo_sora2_pro: 1,
  poyo_sora2_official: 1,
  poyo_sora2_pro_official: 1,
  // Higgsfield DoP — strictly single-image i2v
  hf_dop_standard: 1,
  hf_dop_lite: 1,
  hf_dop_turbo: 1,
};

/** Max reference images a provider consumes. Unknown providers default to 1. */
export function maxRefImagesForProvider(provider: string): number {
  return VIDEO_PROVIDER_MAX_REF_IMAGES[provider] ?? 1;
}
