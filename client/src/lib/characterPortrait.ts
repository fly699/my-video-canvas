// 角色「定妆照」生成的共享事实源——角色卡上的「一键定妆照」按钮与画布助手的
// 「角色自动定妆照」选项共用同一份提示词组装与比例，防止两个入口漂移。
// 定妆照 = 单人全身正面、素背景、影棚均匀打光的角色主体照，生成后写入
// referenceImageUrl 作为该角色的「主参考图」（下游生图/生视频锁脸的单一来源）。
import type { CharacterNodeData } from "../../../shared/types";
import { characterToPromptInjection } from "./characterPrompt";

/** 人像竖构图。kie GPT Image 2 / Imagen / Z-Image / Wan2.7 等枚举原生含 3:4；
 *  不含的模型走服务端 clampAspectTo 就近夹取（如 GPT Image 1.5 → 2:3），不会被拒。 */
export const PORTRAIT_ASPECT = "3:4";

/** 定妆照提示词。角色没有任何可用描述（名字/外貌/服装/身份全空）或是场景节点时
 *  返回空串——调用方应跳过生成，不要拿空描述烧一次生图。 */
export function buildPortraitPrompt(p: CharacterNodeData): string {
  if ((p.characterKind ?? "person") === "scene") return "";
  const subject = characterToPromptInjection(p).trim()
    || [p.name, p.appearance, p.outfit, p.role]
      .filter((s): s is string => !!s && !!s.trim())
      .join(", ");
  if (!subject.trim()) return "";
  return (
    `角色定妆照：${subject}。` +
    "单人全身像，正面站立面向镜头，中性浅灰纯色背景，柔和均匀的影棚打光，" +
    "五官、发型与服装细节清晰锐利，电影级角色定妆照，高清，画面中不出现任何文字或水印"
  ).slice(0, 2000);
}
