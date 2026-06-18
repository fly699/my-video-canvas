import { ENV } from "./env";

// Built-in self-hosted model ids (keep in sync with client models.ts provider:"SelfHosted").
// Used as the default SELF_HOSTED_LLM_MODELS so a deployer only has to set the URL.
export const DEFAULT_SELF_HOSTED_MODELS = ["Qwen3.6-35B-A3B-FP8"];

/** True when `model` is served by the deployer's own self-hosted OpenAI-compatible
 *  endpoint (SELF_HOSTED_LLM_URL configured + model id in the list/default). Standalone
 *  module so both llm.ts (routing) and whitelist.ts (gating) can use it without a
 *  circular import. */
export function isSelfHostedLlmModel(model?: string): boolean {
  if (!model || !ENV.selfHostedLlmUrl.trim()) return false;
  const list = ENV.selfHostedLlmModels.length ? ENV.selfHostedLlmModels : DEFAULT_SELF_HOSTED_MODELS;
  return list.includes(model);
}
