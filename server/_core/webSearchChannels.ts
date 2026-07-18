/**
 * #224 批2c：多渠道联网搜索（技能库「联网搜索提炼」的搜索层）。
 *
 * 三个互相独立的渠道（任一可用即产出材料，全部失败才回退内置知识——调用方负责）：
 *  A. kie 原生联网模型（GPT-5.2 / GPT-5.4，官方 tools 契约，经 invokeLLMWithKie）——调用方直接用通用层，不在本文件。
 *  B. poyo Responses API（docs/poyo-llm-api.md · POST /v1/responses，tools=[{type:"web_search_preview"}]）。
 *  C. DuckDuckGo HTML 搜索结果页抓取（无需 Key 的通用网络来源；标题+链接+摘要作为整理材料）。
 * 各渠道产出统一为 SearchChannelResult，由「整理」LLM 合并去重成一条草稿。
 */
import { ENV } from "./env";
import { extractKieLLMText } from "./kieLLM";
import { htmlToText } from "./webDocFetch";

export interface SearchChannelResult {
  channel: string;      // 渠道展示名
  ok: boolean;
  text?: string;        // 材料正文（ok 时）
  error?: string;       // 失败原因（!ok 时）
}

/** 渠道 B：poyo Responses API 联网搜索（官方 web_search_preview 工具）。 */
export async function searchViaPoyoResponses(query: string): Promise<SearchChannelResult> {
  const channel = "Poyo GPT-5.2 联网";
  if (!ENV.poyoApiKey) return { channel, ok: false, error: "POYO_API_KEY 未配置" };
  try {
    const res = await fetch("https://api.poyo.ai/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ENV.poyoApiKey}` },
      body: JSON.stringify({
        model: "gpt-5.2",
        input: query,
        tools: [{ type: "web_search_preview" }],
        tool_choice: "auto",
        max_output_tokens: 2000,
        store: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { channel, ok: false, error: `HTTP ${res.status} ${t.slice(0, 120)}` };
    }
    const data = await res.json() as Record<string, unknown>;
    // poyo Responses 输出信封与 OpenAI Responses 同构——复用 kie 的 responses 解析器。
    const text = extractKieLLMText("responses", data).trim();
    if (!text) return { channel, ok: false, error: "响应无正文" };
    return { channel, ok: true, text: text.slice(0, 8000) };
  } catch (err) {
    return { channel, ok: false, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
  }
}

/** DDG 结果解析（纯函数，单测用）：result__a 链接 + result__snippet 摘要 → markdown 列表。 */
export function parseDuckDuckGoHtml(html: string, maxResults = 8): string {
  const items: string[] = [];
  // 结果块粗切：每个 <div class="result..."> 到下一个之间
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    if (items.length >= maxResults) break;
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!a) continue;
    let href = a[1];
    // DDG 重定向包装（//duckduckgo.com/l/?uddg=<encoded>&…）→ 还原真实 URL
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch { /* 保留原样 */ } }
    const title = htmlToText(a[2]);
    const sn = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<td[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(block);
    const snippet = sn ? htmlToText(sn[1] ?? sn[2] ?? "") : "";
    if (!title || !href.startsWith("http")) continue;
    items.push(`- ${title}\n  ${href}${snippet ? `\n  摘要：${snippet.slice(0, 300)}` : ""}`);
  }
  return items.join("\n");
}

/** 渠道 C：DuckDuckGo HTML 搜索（无 Key 通用网络来源；固定官方域名，无 SSRF 面）。 */
export async function searchViaDuckDuckGo(query: string): Promise<SearchChannelResult> {
  const channel = "DuckDuckGo 检索";
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; avc-skill-bot/1.0)", accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { channel, ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const list = parseDuckDuckGoHtml(html);
    if (!list) return { channel, ok: false, error: "无法解析搜索结果（页面结构变化或被反爬拦截）" };
    return { channel, ok: true, text: `以下为 DuckDuckGo 搜索结果（标题/链接/摘要）：\n${list}`.slice(0, 8000) };
  } catch (err) {
    return { channel, ok: false, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
  }
}
