import { invokeLLM, type InvokeParams, type InvokeResult } from "./llm";
import { isKieLLMModel } from "./kieLLM";
import { resolveKieKeyOrNull } from "./kie";
import type { TrpcContext } from "./context";

/**
 * 调 invokeLLM 的统一包装：当 model 是 kie 自有对话模型（kie_*）且调用方未显式给 key 时，
 * 按「临时(请求头 x-kie-temp-key) > 分配 > 公用」解析用户 key 注入。这样脚本/分镜/看图/
 * 增强/agent 等所有 LLM 入口都用上用户自己的 kie key，而不仅是公用 key。非 kie 模型原样透传。
 */
export async function invokeLLMWithKie(ctx: TrpcContext, params: InvokeParams): Promise<InvokeResult> {
  if (params.kieApiKey === undefined && isKieLLMModel(params.model)) {
    const r = await resolveKieKeyOrNull(ctx, null);
    return invokeLLM({ ...params, kieApiKey: r?.key });
  }
  return invokeLLM(params);
}
