import { ENV } from "./env";

// ── 自定义 LLM 模型（用户自带 API Key，直连 OpenAI / Anthropic）─────────────────
//
// 与 kieLLM 同理，但这里【不经任何平台网关】，而是直接打到官方端点，用「前端录入 >
// 后端 env」解析出的用户/管理员密钥。两个模型：
//   - custom_openai (ChatGPT)：OpenAI /v1/chat/completions（Bearer 鉴权）
//   - custom_claude (Claude) ：Anthropic /v1/messages（x-api-key + anthropic-version）
//
// 底层实际模型名默认取 defaultModel，可被 env（OPENAI_MODEL/ANTHROPIC_MODEL）或前端
// 请求头（x-openai-model/x-anthropic-model）覆盖，故称「自定义模型」。

type CustomLLMFormat = "openai-chat" | "claude";

export interface CustomLLMSpec {
  label: string;
  provider: "GPT" | "Claude";
  format: CustomLLMFormat;
  url: string;
  /** 默认底层模型名（可被 env / 请求头覆盖）。 */
  defaultModel: string;
  /** 后端 env 密钥兜底。 */
  envKey: () => string;
  /** env 覆盖的底层模型名（可空）。 */
  envModel: () => string;
  /** 前端录入密钥的请求头名。 */
  keyHeader: string;
  /** 前端录入底层模型名的请求头名。 */
  modelHeader: string;
}

export const CUSTOM_LLM_MODELS: Record<string, CustomLLMSpec> = {
  custom_openai: {
    label: "ChatGPT（自定义密钥）",
    provider: "GPT",
    format: "openai-chat",
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o",
    envKey: () => ENV.openaiApiKey,
    envModel: () => ENV.customOpenaiModel,
    keyHeader: "x-openai-key",
    modelHeader: "x-openai-model",
  },
  custom_claude: {
    label: "Claude（自定义密钥）",
    provider: "Claude",
    format: "claude",
    url: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-4-5",
    envKey: () => ENV.anthropicApiKey,
    envModel: () => ENV.customAnthropicModel,
    keyHeader: "x-anthropic-key",
    modelHeader: "x-anthropic-model",
  },
};

export function isCustomLLMModel(model?: string): boolean {
  return !!model && model in CUSTOM_LLM_MODELS;
}

// OpenAI-style message shape coming from the chat router (与 kieLLM 同型)。
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface OAMessage { role: "system" | "user" | "assistant" | string; content: string | ContentPart[] }

const partsToText = (c: string | ContentPart[]): string =>
  typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).join("");
const partsImages = (c: string | ContentPart[]): string[] =>
  typeof c === "string" ? [] : c.filter((p): p is Extract<ContentPart, { type: "image_url" }> => p.type === "image_url").map((p) => p.image_url.url);

export interface CustomLLMResult { text: string }

// 看起来像「真实模型 ID」吗——OpenAI/Anthropic 的 model 名一定含数字（gpt-4o /
// claude-sonnet-4-5 / o3 …）。用来挡掉用户误填的产品名（ChatGPT/Claude），否则直接发去
// 官方端点会 404（`The model 'ChatGPT' does not exist`）。
function looksLikeModelId(v?: string): boolean {
  return !!v && /\d/.test(v);
}

/** 解析底层模型名：前端请求头 > env 覆盖 > 默认；忽略明显非法（不含数字）的值，回退默认。 */
export function resolveCustomModelName(spec: CustomLLMSpec, headerModel?: string | null): string {
  const wanted = headerModel?.trim() || spec.envModel().trim();
  return looksLikeModelId(wanted) ? wanted : spec.defaultModel;
}

/** 直连官方端点调用自定义模型。apiKey 已由调用方按「前端 > env」解析。 */
export async function invokeCustomLLM(opts: {
  model: string; messages: OAMessage[]; apiKey: string; maxTokens?: number; modelName?: string;
}): Promise<CustomLLMResult> {
  const spec = CUSTOM_LLM_MODELS[opts.model];
  if (!spec) throw new Error(`未知自定义 LLM 模型：${opts.model}`);
  const maxTokens = opts.maxTokens ?? 4096;
  // 忽略不含数字的非法模型名（产品名误填）——挡掉直连端点的 404。
  const modelName = looksLikeModelId(opts.modelName?.trim()) ? opts.modelName!.trim() : spec.defaultModel;

  let headers: Record<string, string>;
  let body: Record<string, unknown>;

  if (spec.format === "claude") {
    // Anthropic Messages：system 独立字段；x-api-key + anthropic-version 鉴权（非 Bearer）。
    headers = { "Content-Type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" };
    const system = opts.messages.filter((m) => m.role === "system").map((m) => partsToText(m.content)).join("\n\n");
    const msgs = opts.messages.filter((m) => m.role !== "system").map((m) => {
      const imgs = partsImages(m.content);
      const text = partsToText(m.content);
      const blocks: unknown[] = [];
      if (text) blocks.push({ type: "text", text });
      for (const u of imgs) blocks.push({ type: "image", source: { type: "url", url: u } });
      return { role: m.role === "assistant" ? "assistant" : "user", content: blocks.length ? blocks : text };
    });
    body = { model: modelName, system: system || undefined, messages: msgs, max_tokens: maxTokens, stream: false };
  } else {
    // OpenAI /v1/chat/completions：消息已是 OpenAI 兼容形态，直接透传。
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };
    body = { model: modelName, messages: opts.messages, max_tokens: maxTokens, stream: false };
  }

  const res = await fetch(spec.url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${spec.label} 调用失败 (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = await res.json() as Record<string, unknown>;
  return { text: extractCustomLLMText(spec.format, data) };
}

function extractCustomLLMText(format: CustomLLMFormat, data: Record<string, unknown>): string {
  if (format === "claude") {
    const content = (data.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    return content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("");
  }
  // openai-chat
  const choices = (data.choices as Array<{ message?: { content?: string } }> | undefined) ?? [];
  return choices[0]?.message?.content ?? "";
}
