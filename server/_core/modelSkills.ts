/**
 * #203 模型技能库——合并读取层（独立库，本批不接任何智能体）。
 *
 * 语义（#155 DB优先+代码兜底模式）：
 * - 代码种子（shared/modelSkillSeeds.ts）是出厂内容；
 * - DB 行（管理后台维护）按 modelId 覆盖种子：改内容=覆盖，enabled=false=停用
 *   （连同种子一起停用，读取方拿不到）；删除 DB 行=回退到种子。
 *
 * 未来调用方统一从 getModelSkillText(modelId) 取文本（enabled 的才返回），
 * 或 getMergedModelSkills() 取全量清单（管理后台列表用，带 origin 标记）。
 */
import { MODEL_SKILL_SEEDS, type ModelSkillKind } from "../../shared/modelSkillSeeds";
import { listModelSkillRows } from "../db";

export interface MergedModelSkill {
  modelId: string;
  kind: string;
  tips: string;
  source: string | null;
  enabled: boolean;
  /** builtin=纯种子；custom=DB 新增（种子没有）；overridden=DB 覆盖了同名种子。 */
  origin: "builtin" | "custom" | "overridden";
  updatedAt: string | null;
}

export async function getMergedModelSkills(): Promise<MergedModelSkill[]> {
  const rows = await listModelSkillRows();
  const byId = new Map(rows.map((r) => [r.modelId, r]));
  const seedIds = new Set(MODEL_SKILL_SEEDS.map((s) => s.modelId));
  const out: MergedModelSkill[] = [];
  for (const seed of MODEL_SKILL_SEEDS) {
    const row = byId.get(seed.modelId);
    if (row) {
      out.push({ modelId: row.modelId, kind: row.kind, tips: row.tips, source: row.source ?? null, enabled: !!row.enabled, origin: "overridden", updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null });
    } else {
      out.push({ modelId: seed.modelId, kind: seed.kind, tips: seed.tips, source: seed.source, enabled: true, origin: "builtin", updatedAt: null });
    }
  }
  for (const row of rows) {
    if (seedIds.has(row.modelId)) continue;
    out.push({ modelId: row.modelId, kind: row.kind, tips: row.tips, source: row.source ?? null, enabled: !!row.enabled, origin: "custom", updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null });
  }
  return out.sort((a, b) => a.modelId.localeCompare(b.modelId));
}

/** 未来调用方入口：取某模型的技能文本（停用/不存在返回 null）。 */
export async function getModelSkillText(modelId: string): Promise<string | null> {
  const all = await getMergedModelSkills();
  const hit = all.find((s) => s.modelId === modelId);
  return hit && hit.enabled && hit.tips.trim() ? hit.tips : null;
}

export type { ModelSkillKind };
export const MODEL_SKILL_KINDS: ModelSkillKind[] = ["image", "video", "audio", "music", "llm", "other"];
