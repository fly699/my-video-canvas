import { ENV } from "./env";
import { isKieLLMModel, invokeKieLLM, type OAMessage } from "./kieLLM";
import { isCustomLLMModel, invokeCustomLLM, CUSTOM_LLM_MODELS } from "./customLlm";
import { isSelfHostedLlmModel, getSelfHostedConfig, selfHostedChatUrl } from "./selfHostedLlm";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  model?: string;
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /** kie.ai 自有对话模型（kie_*）用的密钥；由调用方按「临时>分配>公用」解析后传入。
   *  缺省时回退公用 key（KIE_API_KEY）。非 kie 模型忽略此字段。 */
  kieApiKey?: string;
  /** 自定义模型（custom_openai / custom_claude）的前端录入密钥；缺省回退后端 env。
   *  由 invokeLLMWithKie 从请求头解析后传入。非自定义模型忽略。 */
  customApiKey?: string;
  /** 自定义模型的底层模型名覆盖（前端录入）；缺省回退 env 覆盖，再回退默认。 */
  customModel?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const isGptModel = (model?: string) => !!model && /^gpt/i.test(model);

// Models served via Poyo rather than Forge. GPT-* and the Poyo Claude
// (claude-sonnet-4-5-20250929, per docs/poyo-llm-api.md) route to Poyo;
// claude-sonnet-4-6 and the rest are served by Forge. Keep in sync with the
// provider labels in client/src/lib/models.ts.
const POYO_MODEL_IDS = new Set(["claude-sonnet-4-5-20250929"]);
const routesToPoyo = (model?: string) => isGptModel(model) || (!!model && POYO_MODEL_IDS.has(model));

// Self-hosted model detection lives in selfHostedLlm.ts (shared with whitelist gating).
const isSelfHostedModel = isSelfHostedLlmModel;

const resolveApiUrl = (model?: string) => {
  // Self-hosted OpenAI-compatible endpoint — only for its OWN model ids, so it never
  // redirects Forge/Poyo/kie models. Takes priority over everything else.
  if (isSelfHostedModel(model)) return selfHostedChatUrl(getSelfHostedConfig().url);
  // Poyo-routed models (GPT-*, Poyo Claude) → Poyo API when key is available
  if (ENV.poyoApiKey && routesToPoyo(model)) return "https://api.poyo.ai/v1/chat/completions";
  // Other models (Gemini, Claude Sonnet 4.6 / Haiku, etc.) → Forge/Manus API
  if (ENV.forgeApiUrl?.trim()) return `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`;
  if (ENV.forgeApiKey) return "https://forge.manus.im/v1/chat/completions";
  // Fallback: Poyo for any model if it's the only key configured
  if (ENV.poyoApiKey) return "https://api.poyo.ai/v1/chat/completions";
  return "https://forge.manus.im/v1/chat/completions";
};

const getApiKey = (model?: string) => {
  // Self-hosted endpoint: its own key (may be empty for no-auth vLLM/Ollama; send a
  // placeholder so the Authorization header is well-formed and ignored by the server).
  if (isSelfHostedModel(model)) return getSelfHostedConfig().apiKey || "sk-local-noauth";
  if (ENV.poyoApiKey && routesToPoyo(model)) return ENV.poyoApiKey;
  // When a custom forge URL is configured, require the forge key — don't fall through to poyoApiKey
  // which would send the wrong credentials to the custom proxy.
  if (ENV.forgeApiUrl?.trim()) {
    if (!ENV.forgeApiKey) throw new Error("BUILT_IN_FORGE_API_URL is set but BUILT_IN_FORGE_API_KEY is missing");
    return ENV.forgeApiKey;
  }
  const key = ENV.forgeApiKey || ENV.poyoApiKey;
  if (!key) throw new Error("No AI API key configured (POYO_API_KEY or BUILT_IN_FORGE_API_KEY)");
  return key;
};

const assertApiKey = (model?: string) => { getApiKey(model); };

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

// Keep aligned (id set) with client/src/lib/models.ts LLM_MODELS. A const can't
// cross the client/server bundle boundary, so this is the parallel source.
export const AVAILABLE_MODELS = [
  { id: "gemini-3-flash-preview",     label: "Gemini 3 Flash",    tag: "最新" },
  { id: "gemini-2.5-flash",           label: "Gemini 2.5 Flash",  tag: "默认" },
  { id: "claude-sonnet-4-6",          label: "Claude Sonnet 4.6", tag: "旗舰" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", tag: "智能" },
  { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5",  tag: "快速" },
  { id: "gpt-5.2",                    label: "GPT-5.2",           tag: "强力" },
  // 自定义模型（用户自带 key，直连官方端点）。
  { id: "custom_openai",              label: "ChatGPT（自定义密钥）", tag: "自定义" },
  { id: "custom_claude",              label: "Claude（自定义密钥）",  tag: "自定义" },
] as const;

export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

// Model ids that are no longer served by the upstream gateway → remapped to a
// working equivalent so existing node payloads (and any stale picks) keep
// functioning instead of 400ing. `gemini-2.5-flash` returns an unknown-model
// error on every node now; route it to the working Gemini 3 Flash (same family,
// strictly newer). Applied to ALL callers in invokeLLM.
const MODEL_ALIASES: Record<string, string> = {
  "gemini-2.5-flash": "gemini-3-flash-preview",
};

/** Resolve a possibly-stale model id to the one actually served upstream. */
export function resolveModelId(model: string | undefined): string {
  const m = model ?? DEFAULT_MODEL;
  return MODEL_ALIASES[m] ?? m;
}

// Per-model max output-token ceilings. Most models accept a large `max_tokens`
// (the script generator asks for 8000), but the Gemini *preview* reasoning
// models served via Forge reject a budget that high and 400 the whole request —
// which is why Gemini worked in every node EXCEPT the script node (the only
// caller passing 8000). Clamp the requested budget down to a known-good ceiling
// for those models so the request succeeds; other models are left unclamped so
// Claude/GPT keep their full budget. 4096 is proven safe — every other LLM path
// (agent, ai_chat, storyboard, enhance) already uses ≤4096 with Gemini fine.
// NOTE: thinking tokens count toward max_tokens (docs/poyo-llm-api.md), so a
// conservative ceiling also avoids the reasoning budget swallowing the output.
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "gemini-3-flash-preview": 4096,
};

/** Resolve the effective max_tokens for a model, clamping to its ceiling if any. */
export function resolveMaxTokens(model: string | undefined, requested: number): number {
  const ceiling = model ? MODEL_MAX_OUTPUT_TOKENS[model] : undefined;
  return ceiling ? Math.min(requested, ceiling) : requested;
}

// 自建（vLLM/Ollama 等）推理模型（Qwen3、DeepSeek-R1、QwQ…）会先输出一大段 <think> 思维链，
// 随后被 stripReasoning 删掉——但思维 token 照样计入 max_tokens。默认 4096 会被思维吃掉大半，
// 导致可见答案过短甚至从中间被截断。本地推理无 API 成本，故给自建模型更高默认 + 下限保底。
export const SELF_HOSTED_DEFAULT_MAX_TOKENS = 16384;
export const SELF_HOSTED_MIN_MAX_TOKENS = 8192;
export const CLOUD_DEFAULT_MAX_TOKENS = 4096;
/** 选择送给下游的 max_tokens（在按模型上限 resolveMaxTokens 收敛之前）。 */
export function chooseMaxTokens(selfHosted: boolean, requested?: number): number {
  let v = requested ?? (selfHosted ? SELF_HOSTED_DEFAULT_MAX_TOKENS : CLOUD_DEFAULT_MAX_TOKENS);
  if (selfHosted) v = Math.max(v, SELF_HOSTED_MIN_MAX_TOKENS);
  return v;
}

/** Reasoning models (Qwen3, DeepSeek-R1, QwQ…) emit their chain-of-thought as a
 *  <think>…</think> block at the START of the message content. Strip it so the raw
 *  reasoning never leaks into the answer — this caused ai_chat replies to show the
 *  whole "Here's a thinking process…" dump, and broke JSON parsing in other nodes. */
export function stripReasoning(text: string): string {
  if (!text) return text;
  // 1) Remove well-formed <think>…</think> blocks (case-insensitive, spans newlines).
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // 2) Orphan closing tag (some servers stream only </think>, opening lost) → drop
  //    everything up to and including the last </think>.
  const close = out.toLowerCase().lastIndexOf("</think>");
  if (close !== -1) out = out.slice(close + "</think>".length);
  // 3) Orphan opening tag (reasoning truncated before it closed) → drop the tail.
  const open = out.toLowerCase().lastIndexOf("<think>");
  if (open !== -1) out = out.slice(0, open);
  return out.trim();
}

/** Extract plain text from an LLM response, handling both string and array content. */
export function extractTextContent(response: InvokeResult): string {
  const raw = response.choices?.[0]?.message?.content;
  const text = typeof raw === "string"
    ? raw
    : Array.isArray(raw)
      ? raw.map((p) => (p.type === "text" ? p.text : "")).join("")
      : "";
  return stripReasoning(text);
}

// Upstream gateway hiccups (Gemini 3 preview especially) intermittently return
// 5xx "Server exception, please try again later" or 429 rate-limits. These are
// transient, so retry with exponential backoff before surfacing the error. 4xx
// (other than 429) are caller-fixable and not retried. Total ≤3 attempts.
const LLM_MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryableStatus = (s: number) => s === 429 || s >= 500;
const retryBackoffMs = (attempt: number) => 700 * 2 ** attempt + Math.floor(Math.random() * 300);

// Pull the human-readable message out of the gateway's JSON error envelope
// ({"error":{"message":"…"}}) so the UI shows that instead of a raw JSON blob.
function friendlyLLMError(status: number, statusText: string, body: string): string {
  let detail = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: string }; message?: string };
    detail = j?.error?.message ?? j?.message ?? body;
  } catch { /* not JSON — keep raw */ }
  return `LLM invoke failed: ${status} ${statusText} – ${detail}`;
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const {
    messages,
    model,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const resolvedModel = resolveModelId(model);

  // kie.ai 自有对话模型（kie_*）走专属 SDK（claude/openai-chat/responses 三种端点形态），
  // 而非 OpenAI 兼容的 Forge/Poyo 网关——否则会把 kie_* 模型串发去 Forge 导致 404。
  // 密钥必须由调用方（invokeLLMWithKie）按「临时>分配>公用」解析、并经各自权限门控
  // （temp=用户自有放行 / assigned=绑定启用 / house=assertKieHouseAllowed 白名单）校验后注入。
  // 底层这里【绝不】回退 ENV.kieApiKey，否则会绕过 house key 的白名单门控（未授权用户也能用公用 key）。
  if (isKieLLMModel(resolvedModel)) {
    const apiKey = params.kieApiKey?.trim();
    if (!apiKey) throw new Error("kie.ai LLM 模型需经 invokeLLMWithKie 提供已授权的密钥（临时/分配/公用）");
    const { text } = await invokeKieLLM({
      model: resolvedModel,
      messages: messages as unknown as OAMessage[],
      apiKey,
      maxTokens: params.maxTokens ?? params.max_tokens,
    });
    return {
      id: `kie-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: resolvedModel,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    };
  }

  // 自定义模型（custom_openai / custom_claude）：直连官方端点，用「前端录入 > 后端 env」密钥。
  // 密钥与底层模型名由 invokeLLMWithKie 从请求头解析后注入；这里仅做 env 兜底与调用。
  if (isCustomLLMModel(resolvedModel)) {
    const spec = CUSTOM_LLM_MODELS[resolvedModel];
    const apiKey = params.customApiKey?.trim() || spec.envKey().trim();
    if (!apiKey) throw new Error(`${spec.label} 需要 API Key——请在工具栏录入，或在后端设置环境变量`);
    const { text } = await invokeCustomLLM({
      model: resolvedModel,
      messages: messages as unknown as OAMessage[],
      apiKey,
      maxTokens: params.maxTokens ?? params.max_tokens,
      modelName: params.customModel?.trim() || spec.envModel().trim() || undefined,
    });
    return {
      id: `custom-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: resolvedModel,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    };
  }

  assertApiKey(resolvedModel);

  const payload: Record<string, unknown> = {
    model: resolvedModel,
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  // 自建推理模型（vLLM Qwen3 等）思维链会吃掉预算 → 给更高默认/下限，避免可见答案被截断。
  const effectiveMax = chooseMaxTokens(isSelfHostedModel(model), params.maxTokens ?? params.max_tokens);
  payload.max_tokens = resolveMaxTokens(resolvedModel, effectiveMax);

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const url = resolveApiUrl(resolvedModel);
  const body = JSON.stringify(payload);
  const authHeader = `Bearer ${getApiKey(resolvedModel)}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body,
        signal: AbortSignal.timeout(120_000), // fresh per attempt
      });
    } catch (e) {
      // Network error / timeout → transient; retry unless out of attempts.
      lastError = e;
      if (attempt < LLM_MAX_RETRIES) { await sleep(retryBackoffMs(attempt)); continue; }
      throw e;
    }

    if (response.ok) return (await response.json()) as InvokeResult;

    const errorText = await response.text();
    // Retry transient upstream errors (5xx / 429); surface caller-fixable 4xx now.
    if (isRetryableStatus(response.status) && attempt < LLM_MAX_RETRIES) {
      lastError = new Error(friendlyLLMError(response.status, response.statusText, errorText));
      await sleep(retryBackoffMs(attempt));
      continue;
    }
    throw new Error(friendlyLLMError(response.status, response.statusText, errorText));
  }
  // Exhausted retries on network errors.
  throw lastError instanceof Error ? lastError : new Error("LLM invoke failed");
}
