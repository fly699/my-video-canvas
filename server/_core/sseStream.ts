// #309a Poyo 官方 SSE 流式——chat.completions 流式分块的纯解析器。
//
// 契约依据（docs/poyo-llm-api.md，官方文档原样，不猜）：
//   - `stream: true` → 响应为 SSE：一行行 `data: {chat.completion.chunk JSON}`，
//     以 `data: [DONE]` 结束；增量文本在 choices[0].delta.content。
//   - 末段 chunk 可能带 finish_reason / usage（有就收，没有不强求）。
// 解析器与传输解耦（只吃字符串 chunk），跨 chunk 半行自动缓冲；`event:`/注释（:开头）/
// 空行/非法 JSON 行一律忽略——SSE 规范允许这些行存在，宽容解析防网关实现差异。
// 上层（llm.ts consumePoyoSseResponse）拿 acc.text 组装最终 InvokeResult；acc.text 为空
// 视为「流式没拿到正文」→ 上层回退非流式重试，绝不让解析器的宽容变成静默空回复。

export interface ChatSseAccum {
  /** 全部 delta.content 拼接（即最终正文）。 */
  text: string;
  /** 最后一个非空 finish_reason（通常在末段 chunk）。 */
  finishReason: string | null;
  /** 末段 chunk 若带 usage 则捕获（poyo 文档：可选）。 */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  id?: string;
  model?: string;
  /** 是否收到 `data: [DONE]` 终止标记。 */
  done: boolean;
}

/** 建一个 chat.completions SSE 喂食器：feed() 吃原始字符串 chunk，acc 随喂随更新，
 *  每段新增正文回调 onDelta。纯函数工厂（无 IO、无全局态）。 */
export function makeChatSseFeeder(onDelta?: (text: string) => void): { feed: (chunk: string) => void; acc: ChatSseAccum } {
  const acc: ChatSseAccum = { text: "", finishReason: null, done: false };
  let buf = "";
  const feed = (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).replace(/\r$/, "").trim();
      buf = buf.slice(i + 1);
      if (!line || line.startsWith(":")) continue;          // 空行 / SSE 注释
      if (!line.startsWith("data:")) continue;              // event:/id: 等字段忽略
      const data = line.slice(5).trim();
      if (data === "[DONE]") { acc.done = true; continue; }
      try {
        const o = JSON.parse(data) as {
          id?: string; model?: string;
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };
        if (o.id) acc.id = o.id;
        if (o.model) acc.model = o.model;
        const c = o.choices?.[0];
        const t = c?.delta?.content;
        if (typeof t === "string" && t) { acc.text += t; try { onDelta?.(t); } catch { /* 订阅方异常不还传解析器 */ } }
        if (typeof c?.finish_reason === "string" && c.finish_reason) acc.finishReason = c.finish_reason;
        if (o.usage) acc.usage = o.usage;
      } catch { /* 半截/非法 JSON 行：忽略（宽容解析，正文完整性由上层空文本回退兜底） */ }
    }
  };
  return { feed, acc };
}
