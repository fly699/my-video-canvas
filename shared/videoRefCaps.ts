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
  poyo_kling16_std: 2,
  poyo_kling16_pro: 2,
  poyo_kling30turbo_std: 2,
  poyo_kling30turbo_pro: 2,
  poyo_kling30_4k: 2,
  // Wan
  poyo_wan25_t2v: 0,
  poyo_wan25_i2v: 1,
  poyo_wan27_t2v: 0,
  poyo_wan27_i2v: 2,     // [0]start [1]end
  poyo_wan27_ref: 4,     // 参考生：多模态参考图 ≤4（reference_image_urls）
  poyo_wan22_t2v_fast: 0,
  poyo_wan22_i2v_fast: 2,
  // Hailuo（#151：hailuo-02 支持首帧+尾帧 2 图，第 2 张走 end_image_url）
  poyo_hailuo02: 2,
  poyo_hailuo02_pro: 1,
  poyo_hailuo23: 1,
  // others
  poyo_happy_horse: 9,   // reference mode (1-9)
  poyo_happy_horse_11: 9,
  poyo_omni_flash: 3,    // image_urls 0/1/3
  kie_seedance2_mini: 9,
  kie_happyhorse11_r2v: 9,
  // ── #151 round2 poyo 新模型 ──
  poyo_grok_video_15: 1,       // I2V：恰 1 张源图
  poyo_kling_avatar2_std: 1,   // 数字人：单张肖像图 + 驱动音频
  poyo_kling_avatar2_pro: 1,
  poyo_seedance2_mini: 9,      // 首尾帧(≤2)/多模态参考（UI 上限同 seedance-2）
  poyo_wan25_text: 0,
  poyo_wan25_image: 1,
  poyo_wan_animate_move: 1,    // 单张角色图 + 源视频
  poyo_wan_animate_replace: 1,
  kie_omnihuman15: 1,        // 数字人：单张肖像图
  kie_volcengine_lipsync: 0, // 视频对口型：无图，仅源视频+音频
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
  // #328 即梦（dreamina）CLI 视频
  jimeng_text2video: 0,       // 纯文生
  jimeng_image2video: 1,      // 首帧图 --image
  jimeng_frames2video: 2,     // 首尾帧 --first/--last
  jimeng_multiframe2video: 9, // 多帧 --images（3 张以上可用 transition）
  jimeng_multimodal2video: 1, // 全能参考：图 1 张（另可接视频/音频参考，走独立字段）
};

/** Max reference images a provider consumes. Unknown providers default to 1. */
export function maxRefImagesForProvider(provider: string): number {
  return VIDEO_PROVIDER_MAX_REF_IMAGES[provider] ?? 1;
}

/** #246 图参考能力短标注（UI 透明化单一来源：助手模型下拉/警告行/链式回退共用）。
 *  0=纯文生——首帧图、角色参考、链式尾帧全都不生效，必须让用户看得见再权衡。 */
export function videoRefCapBadge(provider: string): string {
  const n = maxRefImagesForProvider(provider);
  if (n === 0) return "不吃图（纯文生）";
  if (n === 1) return "首帧图×1";
  return `首尾帧/多图×${n}`;
}
