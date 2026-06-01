import { ENV } from "./env";

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

const resolveApiUrl = (model?: string) => {
  // GPT models → Poyo API when key is available
  if (ENV.poyoApiKey && isGptModel(model)) return "https://api.poyo.ai/v1/chat/completions";
  // Non-GPT models (Gemini, Claude, etc.) → Forge/Manus API
  if (ENV.forgeApiUrl?.trim()) return `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`;
  if (ENV.forgeApiKey) return "https://forge.manus.im/v1/chat/completions";
  // Fallback: Poyo for any model if it's the only key configured
  if (ENV.poyoApiKey) return "https://api.poyo.ai/v1/chat/completions";
  return "https://forge.manus.im/v1/chat/completions";
};

const getApiKey = (model?: string) => {
  if (ENV.poyoApiKey && isGptModel(model)) return ENV.poyoApiKey;
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
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", tag: "智能" },
  { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5",  tag: "快速" },
  { id: "gpt-5.2",                    label: "GPT-5.2",           tag: "Poyo" },
  // Back-compat alias for older node payloads (resolves like a Claude model).
  { id: "claude-sonnet-4-6",          label: "Claude Sonnet 4.6", tag: "兼容" },
] as const;

export const DEFAULT_MODEL = "gemini-2.5-flash";

/** Extract plain text from an LLM response, handling both string and array content. */
export function extractTextContent(response: InvokeResult): string {
  const raw = response.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((p) => (p.type === "text" ? p.text : "")).join("");
  return "";
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

  const resolvedModel = model ?? DEFAULT_MODEL;
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

  payload.max_tokens = params.maxTokens ?? params.max_tokens ?? 4096;

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const response = await fetch(resolveApiUrl(resolvedModel), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getApiKey(resolvedModel)}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}
