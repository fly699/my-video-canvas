import { listUpstreamVideoSources, listUpstreamAudioSources, mentionedMediaUrls } from "./comfyWorkflowParams";
import { effectiveCharacterVideoRefs, effectiveCharacterAudioRefs } from "./characterConditioning";

// 视频任务的多模态参考能力（哪些 provider 接受参考视频 / 参考音频）。单一真源，供
// 逐节点「生成」按钮(VideoTaskNode)与「运行全部」批量执行(useWorkflowRunner)共用——
// 此前 SUPPORTS 集合与收集逻辑只存在于 VideoTaskNode，runner 没有，导致批量跑时参考
// 视频/音频被静默丢弃。集中在此防止两边漂移。
export const SUPPORTS_REF_VIDEO = new Set<string>([
  "poyo_seedance", "poyo_seedance2_fast", "kie_seedance2", "kie_seedance2_fast", "kie_seedance2_mini",
  // Wan 2.7 参考生：可用参考视频做多模态参考
  "poyo_wan27_ref",
  "poyo_omni_flash",  // V2V：源视频

  // 动作控制 / Animate / 放大 / Aleph：需连线源视频
  "kie_kling26_motion", "kie_kling30_motion", "kie_wan_animate_move", "kie_wan_animate_replace",
  "kie_topaz_upscale", "kie_runway_aleph",
  "kie_volcengine_lipsync",  // 视频对口型：源视频
  // #151 round2 poyo 新模型：Wan Animate 需要源视频；seedance-2-mini 支持参考视频
  "poyo_wan_animate_move", "poyo_wan_animate_replace",
  "poyo_seedance2_mini",
  "poyo_happy_horse",  // #151 二轮核查：happy-horse 视频编辑模式（video_url，3-60s 源视频）
]);
export const SUPPORTS_REF_AUDIO = new Set<string>([
  "poyo_seedance", "poyo_seedance2_fast", "kie_seedance2", "kie_seedance2_fast", "kie_seedance2_mini",
  // 数字人 / 对口型：需连线音频
  "kie_kling_avatar_std", "kie_kling_avatar_pro",
  "kie_omnihuman15", "kie_volcengine_lipsync",
  // #151 round2 poyo 新模型：Kling Avatar 2.0 需驱动音频；seedance-2-mini 支持参考音频
  "poyo_kling_avatar2_std", "poyo_kling_avatar2_pro",
  "poyo_seedance2_mini",
]);

// ── 角色参考图参与计划（#228）─────────────────────────────────────────────────
// 视频任务里「角色/场景参考图（定妆照等）」如何参与本次生成的单一决策源：
// VideoTaskNode 的提交路径（buildRefUrls / refModeForSubmit）与配置区的状态提示行
// 共用它，保证「提示说会发送」与「实际发送」永不分叉。口径与「运行全部」runner 一致：
// 首帧优先——已有手动参考图或上游首帧图时角色参考不直接发送（一致性由首帧画面继承，
// 首帧本身由生图节点吃角色定妆照生成）。
export type CharRefPlan = {
  /** reference=以主体参考(多图锁脸)发送；frame=作为单图首帧输入发送；none=本次不发送。 */
  mode: "reference" | "frame" | "none";
  /** 给用户看的一句话说明（配置区提示行直接渲染）。 */
  note: string;
};

/** 角色/场景参考图的参与计划；没有角色参考图时返回 null（不渲染提示、不影响提交）。 */
export function planCharacterRefs(opts: {
  charRefCount: number;
  manualRefCount: number;
  hasUpstreamFrame: boolean;
  providerMaxRefs: number;
}): CharRefPlan | null {
  const { charRefCount, manualRefCount, hasUpstreamFrame, providerMaxRefs } = opts;
  if (charRefCount <= 0) return null;
  if (manualRefCount > 0) {
    return { mode: "none", note: "已手动附参考图，角色定妆照本次不发送（以手动参考图为准）" };
  }
  if (hasUpstreamFrame) {
    return { mode: "none", note: "已有首帧图（手填或上游连线），角色一致性经首帧画面继承，定妆照不直接发送" };
  }
  if (providerMaxRefs === 0) {
    return { mode: "none", note: "当前模型为文生视频不支持图片输入，角色定妆照不生效（可换支持参考图的模型）" };
  }
  if (providerMaxRefs > 1) {
    return { mode: "reference", note: `角色定妆照 ×${charRefCount} 将以主体参考发送（多图锁脸）` };
  }
  return { mode: "frame", note: "角色定妆照将作为首帧输入发送（当前模型仅支持单图）" };
}

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
