import { invokeLLM, extractTextContent, type InvokeParams, type InvokeResult, type Message } from "./llm";
import { isKieLLMModel } from "./kieLLM";
import { isCustomLLMModel, CUSTOM_LLM_MODELS } from "./customLlm";
import { isSelfHostedLlmModel } from "./selfHostedLlm";
import { isBridgeModel, isClaudeBridgeEnabled } from "./claudeBridge";
import { resolveKieKey } from "./kie";
import { assertLLMAllowed } from "./whitelist";
import type { TrpcContext } from "./context";
import { insertLlmUsageLog } from "../db";

// ── LLM 调用日志（统一埋点）────────────────────────────────────────────────
// 全站所有 LLM 入口都收敛在 invokeLLMWithKie（直接 invokeLLM 仅本文件内部三处分支），
// 故在此一处记录即可无遗漏覆盖：谁、哪个入口（scene=tRPC 路径，中间件自动盖章）、
// 什么模型/路由、成败、耗时、prompt/回复（截断存储）。日志失败绝不影响调用本身。

/** prompt/回复全文的入库上限（字符）。text 列 64KB，utf8mb4 中文最多 4 字节/字，
 *  12000 字 ≤ 48KB 稳妥；超长截断并标注原始长度。 */
const LOG_TEXT_CAP = 12000;

export function capLogText(s: string, cap = LOG_TEXT_CAP): string {
  return s.length > cap ? `${s.slice(0, cap)}\n…[已截断，原文共 ${s.length} 字]` : s;
}

/** 把多模态 messages 序列化成可读日志文本：图片/文件部分用占位符（不存 base64 洪流）。 */
export function serializeMessagesForLog(messages: Message[]): string {
  const flat = (c: unknown): string => {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map(flat).join(" ");
    if (c && typeof c === "object") {
      const p = c as { type?: string; text?: string };
      if (p.type === "text" && typeof p.text === "string") return p.text;
      if (p.type === "image_url") return "[图片]";
      if (p.type === "file_url" || p.type === "file") return "[文件]";
      return "[…]";
    }
    return "";
  };
  return messages.map((m) => `【${m.role}】${flat(m.content)}`).join("\n");
}

/** 模型 → 计费/来源路由标签（与本包装的分支逻辑同口径）。 */
export function detectLlmRoute(model?: string): string {
  if (isKieLLMModel(model)) return "kie";
  if (isCustomLLMModel(model)) return "custom";
  if (isSelfHostedLlmModel(model)) return "self_hosted";
  if (isBridgeModel(model) && isClaudeBridgeEnabled()) return "bridge";
  return "platform";
}

/**
 * 所有 LLM 入口的统一包装——唯一接入 kie 自有对话模型的地方，也是 LLM 调用日志的唯一埋点。
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
  const startedAt = Date.now();
  const scene = ctx.rpcPath ?? "unknown";
  const promptText = capLogText(serializeMessagesForLog(params.messages ?? []));
  const promptChars = serializeMessagesForLog(params.messages ?? []).length;
  const writeLog = (status: "success" | "error", replyText: string, errorMessage?: string) => {
    // fire-and-forget：日志失败只 warn，绝不影响调用结果
    void insertLlmUsageLog({
      userId: ctx.user?.id ?? null,
      userName: ctx.user?.name ?? null,
      // 溯源指纹：IP + 设备指纹 + UA + 会话指纹（防多用户共用账号无法追责）
      ip: (ctx.clientIp ?? "unknown").slice(0, 64),
      deviceFp: ctx.deviceFp ?? null,
      userAgent: ctx.userAgent ?? null,
      sessionFp: ctx.sessionFp ?? null,
      scene: scene.slice(0, 128),
      model: (params.model ?? "default").slice(0, 128),
      route: detectLlmRoute(params.model),
      status,
      errorMessage: errorMessage ? errorMessage.slice(0, 1024) : null,
      durationMs: Date.now() - startedAt,
      promptChars,
      replyChars: replyText.length,
      promptText,
      replyText: capLogText(replyText),
    }).catch((err) => console.warn("[llmUsageLog] non-fatal:", err instanceof Error ? err.message : err));
  };
  try {
    const result = await invokeLLMWithKieImpl(ctx, params, tempKey);
    let replyText = "";
    try { replyText = extractTextContent(result); } catch { /* 工具调用等无纯文本时留空 */ }
    writeLog("success", replyText);
    return result;
  } catch (err) {
    writeLog("error", "", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function invokeLLMWithKieImpl(ctx: TrpcContext, params: InvokeParams, tempKey?: string | null): Promise<InvokeResult> {
  if (params.kieApiKey === undefined && isKieLLMModel(params.model)) {
    const r = await resolveKieKey(ctx, tempKey ?? null); // throwing：含三种 key 优先级 + 各自权限门控
    return invokeLLM({ ...params, kieApiKey: r.key });
  }
  // 自定义模型（custom_openai / custom_claude）：从请求头解析「前端录入」的密钥与底层模型名。
  // 权限门控与 kie 同理——用户自带 key（前端录入）= 自费，放行；回退后端 env（平台 key）则需过
  // LLM 白名单门控（防非白名单用户白嫖平台配置的 OpenAI/Anthropic key）。
  if (params.customApiKey === undefined && isCustomLLMModel(params.model)) {
    const spec = CUSTOM_LLM_MODELS[params.model!];
    const h = ctx.req?.headers ?? {};
    const headerKey = typeof h[spec.keyHeader] === "string" ? (h[spec.keyHeader] as string).trim() : "";
    const headerModel = typeof h[spec.modelHeader] === "string" ? (h[spec.modelHeader] as string).trim() : "";
    if (!headerKey) await assertLLMAllowed(ctx, params.model); // 无自带 key → 用 env 平台 key，须门控
    return invokeLLM({ ...params, customApiKey: headerKey || undefined, customModel: headerModel || undefined });
  }
  // 非 kie 模型走平台自有 env key——invokeLLM 只校验 env key 是否存在，不做用户白名单。
  // 故必须在此补 LLM 白名单门控，否则非白名单用户只要传一个非 kie 模型 id，即可绕过管理员
  // 开启的白名单、白嫖平台公用 LLM（enhance/translate/分镜/看图等近 20 个入口都经此包装）。
  // 与 chat.ts 既有范式 `if(!isKieLLMModel) assertLLMAllowed` 一致，收敛到唯一包装处覆盖全部入口。
  // 仅当使用平台 key（kieApiKey 未显式提供）时门控；显式自带 key 的调用不在此列。
  // 传入 model：自建 LLM 模型在 assertLLMAllowed 内走 comfyui 免白名单门控（与 ComfyUI 一致），
  // 云 LLM 仍走原 LLM 白名单。
  if (params.kieApiKey === undefined) await assertLLMAllowed(ctx, params.model);
  return invokeLLM(params);
}
