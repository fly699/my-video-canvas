// E2 语义素材搜索：素材 AI 打标结果的解析 + 搜索匹配（纯函数，前后端共用，可单测）。
// 打标结果存进 assets.meta（json 列）：{ aiTags, aiDesc, aiModel, taggedAt }。

export interface AssetAiMeta {
  aiTags?: string[];
  aiDesc?: string;
  aiModel?: string;
  taggedAt?: number;
}

const MAX_TAGS = 10;
const MAX_TAG_LEN = 16;
const MAX_DESC_LEN = 120;

/**
 * 从视觉 LLM 文本里稳健解析 {"tags":[...],"desc":"..."}。
 * 容忍 ```json 围栏 / 前后解释文字；tags 去空去重限长；全空（无 tags 且无 desc）视为无效返回 null。
 */
export function parseTagResult(text: string): { tags: string[]; desc: string } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const cands: string[] = [];
  if (fenced?.[1]) cands.push(fenced[1]);
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a !== -1 && b > a) cands.push(text.slice(a, b + 1));
  for (const c of cands) {
    try {
      const obj = JSON.parse(c) as { tags?: unknown; desc?: unknown };
      const rawTags = Array.isArray(obj.tags) ? obj.tags : [];
      const tags = Array.from(new Set(
        rawTags.map((t) => String(t ?? "").trim().slice(0, MAX_TAG_LEN)).filter(Boolean),
      )).slice(0, MAX_TAGS);
      const desc = typeof obj.desc === "string" ? obj.desc.trim().slice(0, MAX_DESC_LEN) : "";
      if (!tags.length && !desc) return null;
      return { tags, desc };
    } catch { /* 试下一个候选 */ }
  }
  return null;
}

/** 从素材行的 meta（json 列，未知形状）安全取出 AI 打标数据。 */
export function readAssetAiMeta(meta: unknown): AssetAiMeta {
  if (!meta || typeof meta !== "object") return {};
  const m = meta as Record<string, unknown>;
  return {
    aiTags: Array.isArray(m.aiTags) ? m.aiTags.map((t) => String(t)).filter(Boolean) : undefined,
    aiDesc: typeof m.aiDesc === "string" ? m.aiDesc : undefined,
    aiModel: typeof m.aiModel === "string" ? m.aiModel : undefined,
    taggedAt: typeof m.taggedAt === "number" ? m.taggedAt : undefined,
  };
}

/**
 * 语义搜索匹配：查询按空白切词，每个词都要能在「文件名 + AI 标签 + AI 描述」里找到
 * （忽略大小写）。空查询恒 true。纯 substring 组合——无向量库依赖，中小规模素材集足够。
 */
export function assetMatchesQuery(
  asset: { name?: string | null; meta?: unknown },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const ai = readAssetAiMeta(asset.meta);
  const hay = [asset.name ?? "", ...(ai.aiTags ?? []), ai.aiDesc ?? ""].join(" ").toLowerCase();
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}
