/**
 * #297 角色卡音色徽标的取值逻辑（纯函数，单测覆盖见 characterVoice.test.ts）。
 *
 * 「锁定音色」在系统里有两层落点，徽标必须都遍历到（用户明确要求覆盖所有锁定途径）：
 *  1. 角色节点声音档案 payload.voiceModel/voiceId ——
 *     助手一句话 set_voice（#295）、镜头表批量配音回写（ShotListPanel）、
 *     角色库快照带入（整包 payload 写回）都会落在这里；配音取值时作兜底。
 *  2. 脚本节点 payload.castVoices[角色名] ——
 *     脚本「配音」Casting 面板手动分配【只写这里、不回写角色档案】；
 *     配音取值时脚本表优先。没有这层遍历，配音面板锁的音色在角色卡上就是隐形的。
 *
 * 优先级：档案优先（角色级持久锁，跨脚本生效）→ 无档案时扫脚本表（按节点顺序取
 * 第一个命中）。两处都没有 → null（角色卡不显示徽标，避免噪声）。
 */
import { DUBBING_VOICE_CATALOG, dubbingVoiceLabel } from "../../../shared/dubbingVoices";

export interface CharVoiceInfo {
  model: string;
  voice: string;
  /** profile=角色声音档案（持久锁）；script=仅存在于某脚本配音表（未升级为角色级） */
  source: "profile" | "script";
  /** source=script 时：来源脚本节点标题（提示用） */
  scriptTitle?: string;
}

/** 徽标上的短标签：目录内取中文音色名（如「瑞秋 Rachel」），目录外回退原始 id。
 *  voxcpm-local 是参考音频克隆、无可枚举音色，统一显示「克隆音色」。 */
export function voiceShortLabel(model: string, voice: string): string {
  if (model === "voxcpm-local") return "克隆音色";
  const entry = DUBBING_VOICE_CATALOG.find((m) => m.model === model);
  const v = entry?.voices.find((x) => x.value === voice);
  return v?.label ?? voice;
}

/** hover 提示用的完整标签（音色·性别描述（模型名）），复用 shared 单一真源。 */
export function voiceFullLabel(model: string, voice: string): string {
  if (model === "voxcpm-local") return `克隆音色（本地 VoxCPM，参考音频驱动）`;
  return dubbingVoiceLabel(model, voice);
}

/** 最小结构化节点形状：与 useCanvasStore 适配层保持一致（只取用到的字段，便于测试直造）。 */
export interface VoiceScanNode {
  nodeType: string;
  title?: string;
  payload: Record<string, unknown>;
}

export function resolveCharacterVoice(
  charName: string,
  payload: { voiceModel?: string; voiceId?: string },
  nodes: VoiceScanNode[],
): CharVoiceInfo | null {
  const vm = (payload.voiceModel ?? "").trim();
  const vid = (payload.voiceId ?? "").trim();
  if (vm && vid) return { model: vm, voice: vid, source: "profile" };
  const name = (charName ?? "").trim();
  if (!name) return null;
  for (const n of nodes) {
    if (n.nodeType !== "script") continue;
    const cast = (n.payload as { castVoices?: Record<string, { model?: string; voice?: string }> }).castVoices;
    const cv = cast?.[name];
    // model/voice 必须成对才算有效分配（半截数据当没锁，与配音面板的提交口径一致）
    if (cv?.model && cv?.voice) return { model: cv.model, voice: cv.voice, source: "script", scriptTitle: n.title };
  }
  return null;
}
