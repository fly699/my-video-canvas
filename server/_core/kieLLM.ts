import { KIE_BASE_URL } from "./kie";

// ── kie.ai LLM / chat ─────────────────────────────────────────────────────────
//
// kie exposes three DIFFERENT chat API shapes (verbatim from docs/kie-api.md);
// this module adapts all three behind one invokeKieLLM() so the chat router
// stays untouched and the core OpenAI-compatible invokeLLM() is never modified:
//
//   - "openai-chat":  OpenAI /v1/chat/completions, but the model lives in the
//                     PATH (e.g. /gemini-3-pro/v1/chat/completions). Response in
//                     choices[0].message.content. (Gemini 3 Pro/Flash, GPT 5.2)
//   - "claude":       Anthropic /claude/v1/messages — separate `system` field,
//                     `max_tokens` required, response in content[].text.
//   - "responses":    OpenAI Responses API /codex/v1/responses — uses `input`
//                     (not messages), response in output[].content[].text.
//                     (GPT 5.5 / 5.4)
//
// The resolved kie key is passed in by the router (resolveKieKey); credits are
// per-million-tokens (docs/kie-pricing.md).

import { NATIVE_WEB_SEARCH_LLMS } from "../../shared/webSearchModels";

type KieLLMFormat = "openai-chat" | "claude" | "responses";
export interface KieLLMSpec {
  model: string;          // wire model string
  path: string;           // POST path (model-prefixed for openai-chat)
  format: KieLLMFormat;
  label: string;
  provider: "Claude" | "Gemini" | "GPT" | "Grok";
  creditNote: string;     // 入/出 点·百万tokens
}

export const KIE_LLM_MODELS: Record<string, KieLLMSpec> = {
  // Claude (Anthropic Messages format)
  kie_claude_opus_48:   { model: "claude-opus-4-8", path: "/claude/v1/messages", format: "claude", label: "Claude Opus 4.8（kie）", provider: "Claude", creditNote: "入 400 / 出 2000 点·百万tokens" },
  kie_claude_opus_47:   { model: "claude-opus-4-7", path: "/claude/v1/messages", format: "claude", label: "Claude Opus 4.7（kie）", provider: "Claude", creditNote: "入 285 / 出 1430 点·百万tokens" },
  kie_claude_opus_46:   { model: "claude-opus-4-6", path: "/claude/v1/messages", format: "claude", label: "Claude Opus 4.6（kie）", provider: "Claude", creditNote: "入 285 / 出 1430 点·百万tokens" },
  kie_claude_opus_45:   { model: "claude-opus-4-5", path: "/claude/v1/messages", format: "claude", label: "Claude Opus 4.5（kie）", provider: "Claude", creditNote: "入 285 / 出 1430 点·百万tokens" },
  kie_claude_sonnet_46: { model: "claude-sonnet-4-6", path: "/claude/v1/messages", format: "claude", label: "Claude Sonnet 4.6（kie）", provider: "Claude", creditNote: "入 170 / 出 855 点·百万tokens" },
  kie_claude_sonnet_45: { model: "claude-sonnet-4-5", path: "/claude/v1/messages", format: "claude", label: "Claude Sonnet 4.5（kie）", provider: "Claude", creditNote: "入 170 / 出 855 点·百万tokens" },
  kie_claude_haiku_45:  { model: "claude-haiku-4-5", path: "/claude/v1/messages", format: "claude", label: "Claude Haiku 4.5（kie）", provider: "Claude", creditNote: "入 55 / 出 285 点·百万tokens" },
  // Claude Fable 5：wire id 含官方笔误「cluade」(docs/incremental-models JSON model_id=claude/cluade-fable-5)，
  // body model 取去市场前缀后的字面值；计价 入 800 / 出 4000 点·百万tokens（同 JSON pricing_rows）。
  kie_claude_fable_5:   { model: "cluade-fable-5", path: "/claude/v1/messages", format: "claude", label: "Claude Fable 5（kie）", provider: "Claude", creditNote: "入 800 / 出 4000 点·百万tokens" },
  // Gemini (OpenAI chat/completions, model in path)
  kie_gemini_3_pro:     { model: "gemini-3-pro", path: "/gemini-3-pro/v1/chat/completions", format: "openai-chat", label: "Gemini 3 Pro（kie）", provider: "Gemini", creditNote: "入 100 / 出 700 点·百万tokens" },
  kie_gemini_3_flash:   { model: "gemini-3-flash", path: "/gemini-3-flash/v1/chat/completions", format: "openai-chat", label: "Gemini 3 Flash（kie）", provider: "Gemini", creditNote: "入 30 / 出 180 点·百万tokens" },
  kie_gemini_31_pro:    { model: "gemini-3.1-pro", path: "/gemini-3.1-pro/v1/chat/completions", format: "openai-chat", label: "Gemini 3.1 Pro（kie）", provider: "Gemini", creditNote: "入 100 / 出 700 点·百万tokens" },
  kie_gemini_25_pro:    { model: "gemini-2.5-pro", path: "/gemini-2.5-pro/v1/chat/completions", format: "openai-chat", label: "Gemini 2.5 Pro（kie）", provider: "Gemini", creditNote: "入 76 / 出 600 点·百万tokens" },
  kie_gemini_25_flash:  { model: "gemini-2.5-flash", path: "/gemini-2.5-flash/v1/chat/completions", format: "openai-chat", label: "Gemini 2.5 Flash（kie）", provider: "Gemini", creditNote: "入 18 / 出 150 点·百万tokens" },
  kie_gemini_35_flash:  { model: "gemini-3-5-flash", path: "/gemini-3-5-flash-openai/v1/chat/completions", format: "openai-chat", label: "Gemini 3.5 Flash（kie）", provider: "Gemini", creditNote: "入 90 / 出 540 点·百万tokens" },
  // GPT (5.5/5.4 = Responses API; 5.2 = chat/completions; codex = /api/v1/responses)
  kie_gpt_5_5:          { model: "gpt-5-5", path: "/codex/v1/responses", format: "responses", label: "GPT 5.5（kie）", provider: "GPT", creditNote: "入 280 / 出 1680 点·百万tokens" },
  kie_gpt_5_4:          { model: "gpt-5-4", path: "/codex/v1/responses", format: "responses", label: "GPT 5.4（kie）", provider: "GPT", creditNote: "入 140 / 出 1120 点·百万tokens" },
  kie_gpt_5_2:          { model: "gpt-5-2", path: "/gpt-5-2/v1/chat/completions", format: "openai-chat", label: "GPT 5.2（kie）", provider: "GPT", creditNote: "入 87.5 / 出 700 点·百万tokens" },
  // GPT Codex（统一 /api/v1/responses，model 在 body）
  kie_gpt_5_codex:      { model: "gpt-5-codex", path: "/api/v1/responses", format: "responses", label: "GPT 5 Codex（kie）", provider: "GPT", creditNote: "入 100 / 出 800 点·百万tokens" },
  kie_gpt_51_codex:     { model: "gpt-5.1-codex", path: "/api/v1/responses", format: "responses", label: "GPT 5.1 Codex（kie）", provider: "GPT", creditNote: "入 100 / 出 800 点·百万tokens" },
  kie_gpt_52_codex:     { model: "gpt-5.2-codex", path: "/api/v1/responses", format: "responses", label: "GPT 5.2 Codex（kie）", provider: "GPT", creditNote: "入 140 / 出 1120 点·百万tokens" },
  kie_gpt_53_codex:     { model: "gpt-5.3-codex", path: "/api/v1/responses", format: "responses", label: "GPT 5.3 Codex（kie）", provider: "GPT", creditNote: "入 140 / 出 1120 点·百万tokens" },
  kie_gpt_54_codex:     { model: "gpt-5.4-codex", path: "/api/v1/responses", format: "responses", label: "GPT 5.4 Codex（kie）", provider: "GPT", creditNote: "入 140 / 出 1120 点·百万tokens" },
  // ── #151 round2 新模型（docs/incremental-models/2026-07-round2-final-v2.json）──
  // GPT 5.6 三档（/codex/v1/responses，Responses API）
  kie_gpt_5_6_luna:  { model: "gpt-5-6-luna",  path: "/codex/v1/responses", format: "responses", label: "GPT 5.6 Luna（kie）",  provider: "GPT", creditNote: "入 56 / 出 336 点·百万tokens" },
  kie_gpt_5_6_terra: { model: "gpt-5-6-terra", path: "/codex/v1/responses", format: "responses", label: "GPT 5.6 Terra（kie）", provider: "GPT", creditNote: "入 140 / 出 840 点·百万tokens" },
  kie_gpt_5_6_sol:   { model: "gpt-5-6-sol",   path: "/codex/v1/responses", format: "responses", label: "GPT 5.6 Sol（kie）",   provider: "GPT", creditNote: "入 280 / 出 1680 点·百万tokens" },
  // Claude Sonnet 5：v2 文档 model enum=["claude-sonnet-5"]（页面 slug 的 cluade 是笔误，body 用正确拼写）
  kie_claude_sonnet_5: { model: "claude-sonnet-5", path: "/claude/v1/messages", format: "claude", label: "Claude Sonnet 5（kie）", provider: "Claude", creditNote: "入 170 / 出 855 点·百万tokens" },
  // Grok 4.3 / 4.5（/grok/v1/responses，Responses API）
  kie_grok_4_3: { model: "grok-4-3", path: "/grok/v1/responses", format: "responses", label: "Grok 4.3（kie）", provider: "Grok", creditNote: "入 100 / 出 200 点·百万tokens" },
  kie_grok_4_5: { model: "grok-4-5", path: "/grok/v1/responses", format: "responses", label: "Grok 4.5（kie）", provider: "Grok", creditNote: "入 160 / 出 480 点·百万tokens" },
};

export function isKieLLMModel(model?: string): boolean {
  return !!model && model in KIE_LLM_MODELS;
}

// OpenAI-style message shape coming from the chat router.
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface OAMessage { role: "system" | "user" | "assistant" | string; content: string | ContentPart[] }

const partsToText = (c: string | ContentPart[]): string =>
  typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).join("");
const partsImages = (c: string | ContentPart[]): string[] =>
  typeof c === "string" ? [] : c.filter((p): p is Extract<ContentPart, { type: "image_url" }> => p.type === "image_url").map((p) => p.image_url.url);

export interface KieLLMResult { text: string; /** 请求确实带着 web_search tools 成功返回（#224 批2b）。 */ webSearchApplied?: boolean }

// ── #224 批2b/2c Web Search grounding（官方契约：docs/kie-api.md）──
// 两个端点、两种 tools 形态（都按文档原样，不猜）：
//  - GPT 5.2（openai-chat）：tools=[{"type":"function","function":{"name":"web_search"}}]
//  - GPT 5.4（responses /codex/v1/responses）：tools=[{"type":"web_search"}]（与 function calling 互斥）
// 只对【文档明确声明支持】的模型启用（清单在 shared/webSearchModels.ts，前后端共享）；
// 网关若拒绝 tools，自动去掉重试一次并把 webSearchApplied=false 冒泡——调用方决定「通知+回退」。
export const KIE_WEB_SEARCH_TOOLS = [{ type: "function", function: { name: "web_search" } }];
export const KIE_WEB_SEARCH_TOOLS_RESPONSES = [{ type: "web_search" }];
export const KIE_WEB_SEARCH_MODELS: ReadonlySet<string> = new Set(NATIVE_WEB_SEARCH_LLMS);
export function kieWebSearchSupported(modelId?: string): boolean {
  if (!modelId || !KIE_WEB_SEARCH_MODELS.has(modelId)) return false;
  const f = KIE_LLM_MODELS[modelId]?.format;
  return f === "openai-chat" || f === "responses"; // 两种契约端点
}

/** Adapt + dispatch a chat request to the right kie endpoint/format. */
export async function invokeKieLLM(opts: { model: string; messages: OAMessage[]; apiKey: string; maxTokens?: number; webSearch?: boolean }): Promise<KieLLMResult> {
  const spec = KIE_LLM_MODELS[opts.model];
  if (!spec) throw new Error(`未知 kie LLM 模型：${opts.model}`);
  const maxTokens = opts.maxTokens ?? 4096;
  const url = `${KIE_BASE_URL}${spec.path}`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };

  let body: Record<string, unknown>;
  if (spec.format === "claude") {
    // Anthropic: system is a separate field; messages carry text/image blocks.
    const system = opts.messages.filter((m) => m.role === "system").map((m) => partsToText(m.content)).join("\n\n");
    const msgs = opts.messages.filter((m) => m.role !== "system").map((m) => {
      const imgs = partsImages(m.content);
      const text = partsToText(m.content);
      const blocks: unknown[] = [];
      if (text) blocks.push({ type: "text", text });
      for (const u of imgs) blocks.push({ type: "image", source: { type: "url", url: u } });
      return { role: m.role === "assistant" ? "assistant" : "user", content: blocks.length ? blocks : text };
    });
    body = { model: spec.model, system: system || undefined, messages: msgs, max_tokens: maxTokens, stream: false };
  } else if (spec.format === "responses") {
    // kie Responses API：请求侧 InputContentItem 的 type 枚举只有 input_text /
    // input_image / input_file（docs/kie-api.md，无 output_text）——assistant 历史
    // 文本若发 output_text 会被判非法，故所有角色的文本一律用 input_text；角色由
    // role 字段区分。
    const input = opts.messages.map((m) => {
      const isAssistant = m.role === "assistant";
      const text = partsToText(m.content);
      const content: unknown[] = [];
      if (text) content.push({ type: "input_text", text });
      for (const u of partsImages(m.content)) content.push({ type: "input_image", image_url: u });
      return { role: m.role === "system" ? "system" : (isAssistant ? "assistant" : "user"), content };
    });
    // 推理模型（GPT-5.x / Grok 4.x 等 Responses API）：max_output_tokens 同时覆盖
    // 「推理 + 正文」。默认 4096 常被推理吃光 → 正文为空（用户反馈「kie 的 gpt 模型回复为空」）。
    // 双保险：① reasoning.effort=low 大幅压低推理 token 占用（更快更省、正文更可靠）；
    // ② max_output_tokens 给足余量（下限 8000 再 +8192）。
    body = { model: spec.model, input, max_output_tokens: Math.max(maxTokens, 8000) + 8192, reasoning: { effort: "low" }, stream: false };
    // #224 批2c：GPT-5.4 responses 端点的 Web Search（官方 tools 契约；与 function calling 互斥，
    // 本调用不传自定义函数，无冲突）。
    if (opts.webSearch && kieWebSearchSupported(opts.model)) body.tools = KIE_WEB_SEARCH_TOOLS_RESPONSES;
  } else {
    // OpenAI chat/completions (model in the path; include in body too — harmless).
    body = { model: spec.model, messages: opts.messages, max_tokens: maxTokens, stream: false };
    // #224 批2b：Web Search grounding（仅 openai-chat 端点、按官方 tools 契约）。
    if (opts.webSearch && spec.format === "openai-chat") body.tools = KIE_WEB_SEARCH_TOOLS;
  }
  let webSearchApplied = "tools" in body;

  const doPost = (b: Record<string, unknown>) => fetch(url, { method: "POST", headers, body: JSON.stringify(b), signal: AbortSignal.timeout(120_000) });
  let res = await doPost(body);
  // 网关不认可选附加字段（tools=web_search / reasoning）时逐个剥掉重试，避免附加字段
  // 拖垮整个请求：先去 tools（联网回退，标志冒泡给调用方通知用户），再去 reasoning。
  if (!res.ok) {
    const firstErr = await res.text().catch(() => "");
    for (const field of ["tools", "reasoning"] as const) {
      if (res.ok || !(field in body)) continue;
      delete (body as Record<string, unknown>)[field];
      if (field === "tools") webSearchApplied = false;
      res = await doPost(body);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`kie LLM 调用失败 (${res.status}): ${(t || firstErr).slice(0, 300)}`);
    }
  }
  const data = await res.json() as Record<string, unknown>;
  const text = extractKieLLMText(spec.format, data);
  // 正文为空（responses 推理模型的常见坑）→ 抛带「响应形态」的诊断错误，而非静默返回空串让上层
  // 显示「模型未返回内容」。形态含 status / 未完成原因 / output 各项 type，便于精准定位（推理占满
  // token？还是结构变了解析漏了？），不泄露正文内容。
  if (!text && spec.format === "responses") {
    const status = typeof data.status === "string" ? data.status : "?";
    const reason = (data.incomplete_details as { reason?: string } | undefined)?.reason;
    const outTypes = Array.isArray(data.output) ? (data.output as Array<{ type?: string }>).map((o) => o?.type ?? "?").join(",") : "无 output";
    throw new Error(`kie 模型未产出正文（status=${status}${reason ? `, 未完成原因=${reason}` : ""}, output=[${outTypes}]）——多因推理占满 token，请重试、换模型或调低提问复杂度`);
  }
  return { text, webSearchApplied };
}

// Pull the assistant text out of each format's response envelope.
export function extractKieLLMText(format: KieLLMFormat, data: Record<string, unknown>): string {
  if (format === "claude") {
    const content = (data.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    return content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("");
  }
  if (format === "responses") {
    // Prefer the convenience field when present, else dig output[].content[].text.
    if (typeof data.output_text === "string" && data.output_text) return data.output_text;
    const output = (data.output as Array<{ type?: string; text?: string; content?: unknown }> | undefined) ?? [];
    // 扫描全部 output 项收集正文——推理模型（GPT-5.x）常先出 reasoning 项再出 message 项，也可能
    // 有多段 message；结构还可能是 content 为字符串、或文本挂在 item.text 上。尽量宽容地取，
    // 只跳过 reasoning 项（其 summary/text 不是正文）。
    const texts: string[] = [];
    for (const o of output) {
      if (o?.type === "reasoning") continue; // 推理摘要不作正文
      const c = o?.content;
      if (typeof c === "string" && c) { texts.push(c); continue; }
      if (Array.isArray(c)) {
        for (const part of c as Array<{ type?: string; text?: string }>) {
          if (typeof part?.text === "string" && part.text && /text/.test(part.type ?? "text")) texts.push(part.text);
        }
      }
      // 兜底：文本直接挂在 item 上（少数变体 message 项无 content 数组）。
      if (!c && typeof o?.text === "string" && o.text && o.type !== "reasoning") texts.push(o.text);
    }
    return texts.join("");
  }
  // openai-chat
  const choices = (data.choices as Array<{ message?: { content?: string } }> | undefined) ?? [];
  return choices[0]?.message?.content ?? "";
}
