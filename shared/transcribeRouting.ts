// 转写模型 → provider 归属（前后端共用，决定路由到哪个转写后端）。
// - forge：内置 Forge 代理（OpenAI 兼容）/ 或 OpenAI 官方兜底。whisper-1 / gpt-4o(-mini)-transcribe。
// - groq：Groq 云端 whisper（独立 GROQ_API_KEY，不再与自建抢 TRANSCRIBE_API_URL）。whisper-large-v3(-turbo)。
// - ""（未知）：不在内置目录里的自定义 model id（通常就是自建 whisper 的 HF id，如
//   Systran/faster-whisper-large-v3）→ 视为「自建 / 自定义端点」provider。
export type TranscribeProvider = "forge" | "groq" | "self" | "openai";

const GROQ_MODELS = new Set(["whisper-large-v3", "whisper-large-v3-turbo"]);
const FORGE_MODELS = new Set(["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"]);

/** 返回内置目录里该 model 的 provider；未知 model 返回 ""（按「自建/自定义」处理）。 */
export function transcribeProviderOf(model: string): "forge" | "groq" | "" {
  const m = (model || "").trim();
  if (GROQ_MODELS.has(m)) return "groq";
  if (FORGE_MODELS.has(m)) return "forge";
  return "";
}
