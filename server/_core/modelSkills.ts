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

/** #224 自动更新草稿：草稿与正式技能同表存储，modelId 加此前缀区分（varchar(128) 足够）。
 *  零迁移；草稿 enabled 恒 false 双保险。所有「正式技能」读取口径必须过滤此前缀。 */
export const SKILL_DRAFT_PREFIX = "draft:";

export async function getMergedModelSkills(): Promise<MergedModelSkill[]> {
  // 草稿行绝不混入正式技能清单（管理列表/智能体注入都从这里走）。
  const rows = (await listModelSkillRows()).filter((r) => !r.modelId.startsWith(SKILL_DRAFT_PREFIX));
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

/**
 * #211 画布助手「模型技能」注入段（首个调用方）：给定最终使用的模型 id 列表
 * （当前 = 快速设置锁定的图/视频模型），拼出附在「云端生成模型清单」之后的
 * 提示词技法参考段。无命中/全部停用/读库失败 → 返回 ""（调用方原样拼接即零改动）。
 * 措辞明确「仅作写作参考、不改字段与 JSON 输出格式」，不触碰 # 输出要求 的位置。
 */
export async function buildAgentModelSkillSection(modelIds: (string | undefined)[]): Promise<string> {
  const ids = Array.from(new Set(modelIds.filter((v): v is string => !!v && !!v.trim())));
  if (!ids.length) return "";
  const parts: string[] = [];
  for (const id of ids) {
    try {
      const t = await getModelSkillText(id);
      if (t) parts.push(`### ${id}\n${t.trim()}`);
    } catch { /* 技能库不可用绝不影响规划主链路 */ }
  }
  if (!parts.length) return "";
  return `\n\n# 模型提示词技法（用户已开启「模型技能」开关；为下列锁定模型撰写 prompt/params 时【必须运用】这些官方技法——每条相应模型节点的提示词都应体现技法要点，而非泛泛描述。技法只影响提示词/参数的写法——不新增/更改任何节点字段，绝不改变输出 JSON 格式）\n${parts.join("\n\n")}`;
}
