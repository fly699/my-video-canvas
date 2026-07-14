import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { TRANSCRIBE_MODELS, type TranscribeModelMeta } from "@/lib/models";

// 转写模型候选（方案B：多后端并存）——只列出【已配置 provider】真正能用的模型：
// - 自建端点已配 → 置顶其 model（标「自建」）。
// - Groq 已配（GROQ_API_KEY）→ 列 Groq 模型（whisper-large-v3(-turbo)）。
// - 内置 Forge/OpenAI 已配 → 列 Forge 模型（whisper-1 / gpt-4o(-mini)-transcribe）。
// 这样「选什么就真走什么后端」，杜绝「选 Groq 实际走本地」的歧义。
// 数据未就绪 / 全未配置时，回退完整内置目录（避免选择器空白）。
export function useTranscribeModels(): TranscribeModelMeta[] {
  const q = trpc.config.transcribeProviders.useQuery(undefined, { staleTime: 60_000 });
  return useMemo(() => {
    const d = q.data;
    if (!d) return [...TRANSCRIBE_MODELS];
    const out: TranscribeModelMeta[] = [];
    // 自建端点模型置顶（有具体 model 才加）。
    if (d.self.configured && d.self.model.trim()) {
      const model = d.self.model.trim();
      out.push({ value: model, label: `自建 · ${model}`, desc: "本地/自建端点 · 免费", group: "SelfHosted", provider: "SelfHosted", costNote: "本地" });
    }
    for (const m of TRANSCRIBE_MODELS) {
      if (m.provider === "Groq" && !d.groq) continue;
      if (m.provider === "Forge" && !d.forge) continue;
      if (out.some((o) => o.value === m.value)) continue; // 去重（自建 model 恰好同名）
      out.push(m);
    }
    // 全部被过滤空 → 回退完整目录，保证选择器不空白。
    return out.length ? out : [...TRANSCRIBE_MODELS];
  }, [q.data]);
}
