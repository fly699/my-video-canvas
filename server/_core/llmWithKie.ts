import { invokeLLM, type InvokeParams, type InvokeResult } from "./llm";
import { isKieLLMModel } from "./kieLLM";
import { resolveKieKey } from "./kie";
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
  return invokeLLM(params);
}
