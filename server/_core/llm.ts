import { ENV } from "./env";
import { isKieLLMModel, invokeKieLLM, type OAMessage } from "./kieLLM";

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

const resolveApiUrl = (model?: string) => {
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

/** Extract plain text from an LLM response, handling both string and array content. */
export function extractTextContent(response: InvokeResult): string {
  const raw = response.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((p) => (p.type === "text" ? p.text : "")).join("");
  return "";
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
  // 这里用公用 key（KIE_API_KEY）统一接入：所有走 invokeLLM 的功能（脚本/分镜/看图/
  // 增强/agent 等）因此都能用 kie 模型。AI 对话节点另走带用户 key 的 invokeKieLLM，不受影响。
  if (isKieLLMModel(resolvedModel)) {
    const apiKey = ENV.kieApiKey;
    if (!apiKey) throw new Error("kie.ai LLM 模型需要配置公用 key（KIE_API_KEY）");
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

  payload.max_tokens = resolveMaxTokens(resolvedModel, params.maxTokens ?? params.max_tokens ?? 4096);

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
