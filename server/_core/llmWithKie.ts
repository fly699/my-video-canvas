import { invokeLLM, type InvokeParams, type InvokeResult } from "./llm";
import { isKieLLMModel } from "./kieLLM";
import { resolveKieKey } from "./kie";
import { assertLLMAllowed } from "./whitelist";
import type { TrpcContext } from "./context";

/**
 * 所有 LLM 入口的统一包装——唯一接入 kie 自有对话模型的地方。
 *
 * 当 model 是 kie 模型（kie_*）且调用方未显式给 key 时，用 resolveKieKey 按
 * **临时(请求头 x-kie-temp-key 或显式 tempKey) > 分配 > 公用** 解析密钥；resolveKieKey
 * 会强制各自的权限门控（temp=用户自有放行 / assigned=绑定与 key 均启用 / house=
 * assertKieHouseAllowed 白名单，未授权抛 FORBIDDEN）。**绝不**在权限不足时静默回退公用 key。
 *
 * 把所有功能（AI 对话/脚本/分镜/看图/增强/翻译/agent/模板分析）都收敛到这一处，
 * 既统一了三种 key 的优先级与权限，又避免「某个入口漏接 key 或绕过门控」之类问题再次发生。
 * 非 kie 模型原样透传给 invokeLLM。
 */
export async function invokeLLMWithKie(ctx: TrpcContext, params: InvokeParams, tempKey?: string | null): Promise<InvokeResult> {
  if (params.kieApiKey === undefined && isKieLLMModel(params.model)) {
    const r = await resolveKieKey(ctx, tempKey ?? null); // throwing：含三种 key 优先级 + 各自权限门控
    return invokeLLM({ ...params, kieApiKey: r.key });
  }
  // 非 kie 模型走平台自有 env key——invokeLLM 只校验 env key 是否存在，不做用户白名单。
  // 故必须在此补 LLM 白名单门控，否则非白名单用户只要传一个非 kie 模型 id，即可绕过管理员
  // 开启的白名单、白嫖平台公用 LLM（enhance/translate/分镜/看图等近 20 个入口都经此包装）。
  // 与 chat.ts 既有范式 `if(!isKieLLMModel) assertLLMAllowed` 一致，收敛到唯一包装处覆盖全部入口。
  // 仅当使用平台 key（kieApiKey 未显式提供）时门控；显式自带 key 的调用不在此列。
  // 传入 model：自建 LLM 模型在 assertLLMAllowed 内走 comfyui 免白名单门控（与 ComfyUI 一致），
  // 云 LLM 仍走原 LLM 白名单。
  if (params.kieApiKey === undefined) await assertLLMAllowed(ctx, params.model);
  return invokeLLM(params);
}
