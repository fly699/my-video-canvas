// 客户端 LLM/网络错误的可读化：当经公网隧道的请求被网关掐断（Cloudflare 524 首字节超时、
// 502/504）或连接中断时，浏览器 tRPC/fetch 会拿到 HTML 错误页并抛 `Unexpected token '<',
// "<!DOCTYPE"... is not valid JSON`，或 `Failed to fetch`。这些直接塞进气泡用户看不懂。
// 此函数把这类底层错误映射成一句可行动的中文；其余错误原样返回。纯函数。
export function friendlyClientLLMError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const m = msg.toLowerCase();
  const gatewayHtml =
    m.includes("<!doctype") ||
    m.includes("unexpected token '<'") ||
    m.includes("is not valid json") ||
    m.includes("<html");
  const gatewayStatus = /\b(502|503|504|524)\b/.test(msg) || m.includes("bad gateway") || m.includes("gateway time");
  const netFail = m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network error") || m.includes("load failed");
  const timeout = m.includes("timeout") || m.includes("timed out") || m.includes("aborted");
  if (gatewayHtml || gatewayStatus) {
    return "服务器处理超时或网关中断（公网访问约 100 秒上限）：AI 生成太慢或连接被掐断。请稍后重试；若输入很长，建议精简或分几次发送。";
  }
  if (netFail) {
    return "网络请求失败：连接中断或服务器不可达，请检查网络后重试。";
  }
  if (timeout) {
    return "请求超时：生成耗时过长，请稍后重试或缩短输入。";
  }
  return msg || "调用失败";
}
