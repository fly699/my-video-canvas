// 模板 ↔ 服务器「按模型匹配」纯逻辑（无网络，便于单测）。
// 用于「一键更新模板服务器列表」：根据各服务器已装模型，算出每个模板能在哪些服务器上跑。

// 模型类字段的 key（payload 的 ckpt/lora/vae… 与 workflowJson 里 *_name widget）。
// 注意：故意不含 sampler/scheduler——它们是算法枚举、几乎所有服务器都有，不应作为约束。
const MODEL_KEY = /(^|_)(ckpt|lora|vae|controlnet|control_net|unet|clip|clip_vision|clipvision|ipadapter|style_model|stylemodel|gligen|upscale_model|upscale|motion_module|model)(_name)?$/i;

function collect(value: unknown, keyHint: string | undefined, out: Set<string>): void {
  if (value == null) return;
  if (typeof value === "string") {
    if (keyHint && MODEL_KEY.test(keyHint) && value.trim()) out.add(value.trim());
    return;
  }
  if (Array.isArray(value)) { for (const v of value) collect(v, keyHint, out); return; }
  if (typeof value === "object") { for (const [k, v] of Object.entries(value)) collect(v, k, out); return; }
}

/** 取一个模板引用的模型名集合：递归扫描 payload 的模型字段 + 解析 workflowJson 的模型 widget。 */
export function extractTemplateModelRefs(template: { payload?: Record<string, unknown> | null }): string[] {
  const out = new Set<string>();
  const payload = template.payload ?? {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "workflowJson") continue; // 字符串，单独解析
    collect(v, k, out);
  }
  const wfRaw = payload.workflowJson;
  if (typeof wfRaw === "string" && wfRaw.trim()) {
    try { collect(JSON.parse(wfRaw), undefined, out); } catch { /* 非法 JSON：忽略 */ }
  }
  return Array.from(out);
}

/** 把 ComfyModelList（各类别字符串数组）展平成一个模型名集合。 */
export function flattenModelList(models: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(models)) if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.push(x);
  return out;
}

/** 给定模板引用的模型名 + 各在线服务器的模型集，返回「能跑该模板」的服务器 URL。
 *  规则：只把「至少某台在线服务器确有」的引用当作真正需要的模型（过滤占位/非模型串）；
 *  某服务器需含全部这些模型才入选。无任何已知模型时所有在线服务器都入选（无模型约束）。 */
export function qualifyingServers(refs: string[], servers: { url: string; models: Set<string> }[]): string[] {
  const known = new Set<string>();
  for (const s of servers) s.models.forEach((m) => known.add(m));
  const required = refs.filter((r) => known.has(r));
  return servers.filter((s) => required.every((r) => s.models.has(r))).map((s) => s.url);
}
