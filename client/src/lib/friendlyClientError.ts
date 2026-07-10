// 客户端 LLM/网络错误的可读化：当经公网隧道的请求被网关掐断（Cloudflare 524 首字节超时、
// 502/504）或连接中断时，浏览器 tRPC/fetch 会拿到 HTML 错误页并抛 `Unexpected token '<',
// "<!DOCTYPE"... is not valid JSON`，或 `Failed to fetch`。这些直接塞进气泡用户看不懂。
// 此函数把这类底层错误映射成一句可行动的中文；其余错误原样返回。纯函数。
export function friendlyClientLLMError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  // 服务端结构化错误（TRPCClientError 带 data.code）= 后端已给出可读中文消息，原样显示。
  // 只有传输层错误（连接断/拿到 HTML 页，data 为空）才做下面的网关/网络映射——否则服务端
  // 消息里引用的 "502"/"<!DOCTYPE" 片段（如 llm.ts 的「响应开头：…」）会被误判成网关中断，
  // 内网用户也会看到「公网 100 秒上限」的误导文案（真实翻车：内网长生成被报成公网超时）。
  const serverCode = (e as { data?: { code?: unknown } } | null)?.data?.code;
  if (typeof serverCode === "string" && msg) return msg;
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
    return "连接被中断或返回了非 JSON 响应：AI 生成太慢或连接被掐断。若经公网隧道访问，网关约有 100 秒上限；内网/本机访问出现此错误多为服务端异常，请查看服务器日志。请稍后重试；若输入很长，建议精简或分几次发送。";
  }
  if (netFail) {
    return "网络请求失败：连接中断或服务器不可达，请检查网络后重试。";
  }
  if (timeout) {
    return "请求超时：生成耗时过长，请稍后重试或缩短输入。";
  }
  return msg || "调用失败";
}
