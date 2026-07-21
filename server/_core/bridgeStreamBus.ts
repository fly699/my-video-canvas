// #306 桥接流式回显——进程内增量文本总线。
//
// 背景：画布助手规划走「submitChat 任务 + chatStatus 轮询」，LLM 调用经 invokeLLM 以
// HTTP 打到本进程的桥接回环端点（/api/claude-bridge/...），端点内 spawn `claude -p`
// 收完 stdout 才返回完整 JSON——传输层没有任何流式。要把「生成中的文字」实时带给
// 用户，不必改传输协议（SSE/WS 过隧道各有坑，真机血泪见 CLAUDE.md「实时通信」章）：
// 桥接端点与 agent 任务本就在【同一个 Node 进程】里，子进程的增量 delta 直接经这个
// 极简总线旁路发布，agent 任务订阅后累进 job.partial，chatStatus 轮询顺路捎回前端。
//
// 契约：
// - channel 由调用方（submitChat）生成并随请求体 stream_channel 字段送到桥接端点；
//   桥接端点用 isValidStreamChannel 校验（严格字符白名单，防怪串进日志/Map 键）。
// - 一个 channel 同时只有一个订阅者（后订阅覆盖先订阅——正常流程不会发生，仅防泄漏）。
// - 订阅方回调抛错绝不回传桥接（发布侧 try/catch 吞掉），生成主流程零风险。
// - 订阅方负责在任务结束时 unsubscribe（subscribe 返回退订函数）；桥接侧发布到
//   已退订的 channel 是 no-op。
const subs = new Map<string, (delta: string) => void>();

/** stream_channel 合法性：8-64 位字母数字/下划线/连字符（jobId `acj_...` 天然满足）。 */
export function isValidStreamChannel(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

/** 订阅某 channel 的增量文本；返回退订函数。 */
export function subscribeBridgeStream(channel: string, onDelta: (delta: string) => void): () => void {
  subs.set(channel, onDelta);
  return () => { subs.delete(channel); };
}

/** 发布一段增量文本（无订阅者/空串 = no-op；订阅方异常吞掉，不影响桥接主流程）。 */
export function publishBridgeDelta(channel: string, delta: string): void {
  if (!delta) return;
  const fn = subs.get(channel);
  if (!fn) return;
  try { fn(delta); } catch { /* 订阅方异常绝不还传桥接 */ }
}

/** 当前订阅数（仅测试/诊断用）。 */
export function bridgeStreamSubscriberCount(): number { return subs.size; }
