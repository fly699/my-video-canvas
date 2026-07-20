// 角色/场景「入库快照」组装的共享事实源（#272 抽取）——角色卡「存库」按钮与画布助手
// 「将画布内所有角色/场景入库」口令共用同一份剥离/清洗规则，防止两个入口漂移
//（与 characterPortrait.ts 定妆照提示词的「单一事实源」哲学一致）。
import type { CharacterNodeData } from "../../../shared/types";

// 图谱专属/瞬态字段：再实例化的角色不该继承原节点的智能体归属/场景分组/创建者，
// 也不该把 #271 的生成运行态（status/progress/errorMessage）快照进库。
const TRANSIENT_KEYS = ["createdBy", "ownerAgentId", "sceneGroup", "status", "progress", "errorMessage"];
// 人物↔场景切换过的节点会残留对侧类别的隐藏字段——入库只保留本类别字段 + 共享字段，
// 否则库条目日后再切类别时旧字段会诈尸（与角色卡「存库」原有规则逐字段一致）。
const PERSON_ONLY = ["name", "role", "gender", "age", "appearance", "personality", "outfit", "signature", "loraName", "loraStrength", "ipadapterWeight", "consistencySeed"];
const SCENE_ONLY = ["sceneName", "locationType", "sceneDescription", "atmosphere", "timeOfDay"];

export interface LibrarySaveInput {
  name: string;
  characterKind: "person" | "scene";
  payload: Record<string, unknown>;
  thumbnail?: string;
}

/** 把角色/场景节点 payload 组装成 characterLibrary.create 的入参。
 *  名字为空（人物无 name / 场景无 sceneName 兜底）返回 null——调用方自行提示/跳过。
 *  sourceProjectId：入库来源项目（#272 零迁移方案：写进库条目 payload JSON 的
 *  librarySourceProjectId 键，角色库面板据此做分项目检索；不动数据库 schema）。 */
export function buildLibrarySaveInput(payload: CharacterNodeData, sourceProjectId?: number | null): LibrarySaveInput | null {
  const kind: "person" | "scene" = (payload.characterKind ?? "person") === "scene" ? "scene" : "person";
  const name = (payload.name || payload.sceneName || "").trim();
  if (!name) return null;
  const rest = Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter(([k]) => !TRANSIENT_KEYS.includes(k)));
  const stripKeys = kind === "scene" ? PERSON_ONLY : SCENE_ONLY;
  const clean = Object.fromEntries(Object.entries(rest).filter(([k]) => !stripKeys.includes(k)));
  clean.characterKind = kind; // pin authoritatively (covers legacy/undefined)
  if (sourceProjectId != null) clean.librarySourceProjectId = sourceProjectId;
  return { name, characterKind: kind, payload: clean, thumbnail: payload.referenceImageUrl || undefined };
}

/** 读库条目的来源项目 id（老条目无此键返回 null——面板按「未标记」处理）。 */
export function librarySourceProjectOf(entryPayload: Record<string, unknown> | undefined | null): number | null {
  const v = entryPayload?.librarySourceProjectId;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
