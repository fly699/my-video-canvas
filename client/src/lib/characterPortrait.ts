// 角色「定妆照」生成的共享事实源——角色卡上的「一键定妆照」按钮与画布助手的
// 「角色自动定妆照」选项共用同一份提示词组装与比例，防止两个入口漂移。
// 定妆照 = 单人全身正面、素背景、影棚均匀打光的角色主体照，生成后写入
// referenceImageUrl 作为该角色的「主参考图」（下游生图/生视频锁脸的单一来源）。
import type { CharacterNodeData } from "../../../shared/types";
import { characterToPromptInjection } from "./characterPrompt";

/** 人像竖构图。kie GPT Image 2 / Imagen / Z-Image / Wan2.7 等枚举原生含 3:4；
 *  不含的模型走服务端 clampAspectTo 就近夹取（如 GPT Image 1.5 → 2:3），不会被拒。 */
export const PORTRAIT_ASPECT = "3:4";
/** #271 场景概念图用横构图（环境空镜天然横幅；不含 16:9 的模型同样走服务端就近夹取）。 */
export const SCENE_ASPECT = "16:9";

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

/** #271 场景概念图提示词（用户实报：勾选自动定妆后场景节点没被覆盖——因为此前根本
 *  没有场景版提示词组装）。场景没有任何可用描述（名字/地点/氛围/描述/时段全空）或
 *  是人物节点时返回空串——调用方跳过，不拿空描述烧生图（与 buildPortraitPrompt 同约定）。 */
export function buildScenePrompt(p: CharacterNodeData): string {
  if ((p.characterKind ?? "person") !== "scene") return "";
  const subject = [p.name || p.sceneName, p.locationType, p.sceneDescription, p.atmosphere, p.timeOfDay]
    .filter((s): s is string => !!s && !!s.trim())
    .map((s) => s.trim())
    .join("，");
  if (!subject.trim()) return "";
  return (
    `场景概念图：${subject}。` +
    "空镜头环境图，画面中不出现任何人物或动物主体，构图完整展现空间与纵深，" +
    "光影氛围符合场景设定，电影级美术概念图质感，高清，画面中不出现任何文字或水印"
  ).slice(0, 2000);
}

/** #271 统一入口：按节点类别（人物/场景）分派提示词——角色卡按钮与画布助手
 *  「自动定妆」共用，保证两个入口对两种类别的行为完全一致。 */
export function buildCharacterImagePrompt(p: CharacterNodeData): string {
  return (p.characterKind ?? "person") === "scene" ? buildScenePrompt(p) : buildPortraitPrompt(p);
}

/** #271 统一入口：按类别给画面比例（人物竖构图 3:4 / 场景横构图 16:9）。 */
export function characterImageAspect(p: CharacterNodeData): string {
  return (p.characterKind ?? "person") === "scene" ? SCENE_ASPECT : PORTRAIT_ASPECT;
}
