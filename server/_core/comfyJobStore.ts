// #163 ComfyUI 节点生成防隧道超时：executeWorkflow 是一次超长同步 HTTP（提交→服务端轮询
// history，可达 5–10 分钟）。当整个应用经 cloudflared 隧道访问时，浏览器→应用服务器 的这条
// tRPC 请求本身在 ~100s 被隧道切断——**但服务端不因客户端断开而取消**（pollHistory 未接收请求
// 的 abort 信号），仍会跑到完成并已把产物落库。缺的只是「结果回传给前端」。
//
// 本 store 在服务端内存里按 jobId（前端生成的一次性随机串）暂存运行终局结果，配合 socket 回灌
// 与 workflowResult 轮询查询，让隧道切断 HTTP 后前端仍能拿到结果、结束「运行中」。TTL 到期清理，
// 写入时顺带 prune 并限量，避免无界增长。

export type ComfyJobResult =
  | { status: "done"; urls: string[]; outputType: "image" | "video"; at: number }
  | { status: "error"; error: string; at: number };

const store = new Map<string, ComfyJobResult>();
const TTL_MS = 20 * 60 * 1000; // 20 分钟：覆盖最慢的视频工作流 + 前端轮询窗口
const MAX_ENTRIES = 2000;       // 内存上限兜底（每条极小；到顶时先清最旧）

/** 清理过期条目；若仍超上限，按写入时间从旧到新裁到上限内。 */
export function pruneComfyJobs(now = Date.now()): void {
  for (const [k, v] of Array.from(store.entries())) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
  if (store.size > MAX_ENTRIES) {
    const sorted = Array.from(store.entries()).sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < sorted.length - MAX_ENTRIES; i++) store.delete(sorted[i][0]);
  }
}

export function setComfyJobDone(jobId: string, urls: string[], outputType: "image" | "video", now = Date.now()): void {
  if (!jobId) return;
  store.set(jobId, { status: "done", urls, outputType, at: now });
  pruneComfyJobs(now);
}

export function setComfyJobError(jobId: string, error: string, now = Date.now()): void {
  if (!jobId) return;
  store.set(jobId, { status: "error", error, at: now });
  pruneComfyJobs(now);
}

/** 取一个 job 的终局结果；过期则视为不存在（返回 null）。 */
export function getComfyJob(jobId: string, now = Date.now()): ComfyJobResult | null {
  const v = store.get(jobId);
  if (!v) return null;
  if (now - v.at > TTL_MS) { store.delete(jobId); return null; }
  return v;
}

/** 仅测试用：清空 store。 */
export function _clearComfyJobs(): void { store.clear(); }
/** 仅测试用：当前条目数。 */
export function _comfyJobCount(): number { return store.size; }
