import { useMemo } from "react";
import { trpc } from "./trpc";
import type { LLMModelMeta } from "./models";

/** Self-hosted LLM models configured in the admin backend (or env fallback), mapped to
 *  the LLMModelMeta shape so they merge into every model picker. id/label only — never
 *  the endpoint url or api key. */
export function useSelfHostedLlmModels(): LLMModelMeta[] {
  const q = trpc.config.selfHostedLlmModels.useQuery(undefined, { staleTime: 60_000 });
  return useMemo(() => (q.data?.models ?? []).map((m): LLMModelMeta => ({
    id: m.id,
    label: m.label || m.id,
    short: (m.label || m.id).length > 12 ? (m.label || m.id).slice(0, 12) : (m.label || m.id),
    family: "Qwen",
    tag: "自建",
    provider: "SelfHosted",
    color: "oklch(0.70 0.16 200)",
    costTier: "低",
  })), [q.data]);
}

/** Static LLM_MODELS + dynamic self-hosted models. Use anywhere a full model list is needed. */
export function useAllLlmModels(staticModels: readonly LLMModelMeta[]): LLMModelMeta[] {
  const selfHosted = useSelfHostedLlmModels();
  return useMemo(() => {
    if (selfHosted.length === 0) return staticModels as LLMModelMeta[];
    const ids = new Set(staticModels.map((m) => m.id));
    // self-hosted first (so they're visible up top), then the static set; de-dup by id.
    return [...selfHosted.filter((m) => !ids.has(m.id)), ...staticModels];
  }, [staticModels, selfHosted]);
}
