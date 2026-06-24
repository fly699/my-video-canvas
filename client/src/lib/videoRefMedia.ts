import { listUpstreamVideoSources, listUpstreamAudioSources, mentionedMediaUrls } from "./comfyWorkflowParams";
import { effectiveCharacterVideoRefs, effectiveCharacterAudioRefs } from "./characterConditioning";

// 视频任务的多模态参考能力（哪些 provider 接受参考视频 / 参考音频）。单一真源，供
// 逐节点「生成」按钮(VideoTaskNode)与「运行全部」批量执行(useWorkflowRunner)共用——
// 此前 SUPPORTS 集合与收集逻辑只存在于 VideoTaskNode，runner 没有，导致批量跑时参考
// 视频/音频被静默丢弃。集中在此防止两边漂移。
export const SUPPORTS_REF_VIDEO = new Set<string>([
  "poyo_seedance", "poyo_seedance2_fast", "kie_seedance2", "kie_seedance2_fast",
  // Wan 2.7 参考生：可用参考视频做多模态参考
  "poyo_wan27_ref",
  // 动作控制 / Animate / 放大 / Aleph：需连线源视频
  "kie_kling26_motion", "kie_kling30_motion", "kie_wan_animate_move", "kie_wan_animate_replace",
  "kie_topaz_upscale", "kie_runway_aleph",
]);
export const SUPPORTS_REF_AUDIO = new Set<string>([
  "poyo_seedance", "poyo_seedance2_fast", "kie_seedance2", "kie_seedance2_fast",
  // 数字人：需连线音频
  "kie_kling_avatar_std", "kie_kling_avatar_pro",
]);

// 取更严的 character 系列签名（position 要求 {x,y}），它同时满足较松的
// listUpstreamVideoSources / mentionedMediaUrls 的 MiniNode 参数。
type RefEdges = Parameters<typeof effectiveCharacterVideoRefs>[2];
type RefNodes = Parameters<typeof effectiveCharacterVideoRefs>[3];

/**
 * 收集视频任务的多模态参考视频 / 参考音频 URL（各 ≤3，去重保序），来源含：
 *  - 上游连线（video_task/comfyui_video/clip/merge/... 视频；audio/asset 音频）
 *  - 连线角色 + @提及角色携带的视频/音频
 *  - 提示词里 @视频名 / @音频名 的独立节点
 * provider 不支持参考视频/音频时返回空对象（不发该字段）。
 */
export function collectVideoRefMedia(
  nodeId: string,
  prompt: string | undefined,
  provider: string,
  edges: RefEdges,
  nodes: RefNodes,
): { videoRefs?: string[]; audioRefs?: string[] } {
  const wantsVideo = SUPPORTS_REF_VIDEO.has(provider), wantsAudio = SUPPORTS_REF_AUDIO.has(provider);
  if (!wantsVideo && !wantsAudio) return {};
  const p = prompt ?? "";
  const pushUniq = (arr: string[], seen: Set<string>, u?: string) => {
    const v = u?.trim();
    if (v && !seen.has(v)) { seen.add(v); arr.push(v); }
  };
  const vids: string[] = [], auds: string[] = [];
  const vSeen = new Set<string>(), aSeen = new Set<string>();
  if (wantsVideo) {
    for (const v of listUpstreamVideoSources(nodeId, edges, nodes)) pushUniq(vids, vSeen, v.url);
    for (const u of effectiveCharacterVideoRefs(nodeId, p, edges, nodes)) pushUniq(vids, vSeen, u);
    for (const u of mentionedMediaUrls(p, "video", nodes)) pushUniq(vids, vSeen, u);
  }
  if (wantsAudio) {
    for (const a of listUpstreamAudioSources(nodeId, edges, nodes)) pushUniq(auds, aSeen, a.url);
    for (const u of effectiveCharacterAudioRefs(nodeId, p, edges, nodes)) pushUniq(auds, aSeen, u);
    for (const u of mentionedMediaUrls(p, "audio", nodes)) pushUniq(auds, aSeen, u);
  }
  return { videoRefs: vids.length ? vids.slice(0, 3) : undefined, audioRefs: auds.length ? auds.slice(0, 3) : undefined };
}
