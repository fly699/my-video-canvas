// #163 ComfyUI 自定义工作流运行的「隧道切断兜底」纯逻辑：
// 整个应用经 cloudflared 隧道时，executeWorkflow 的超长同步 HTTP 在 ~100s 被切断，浏览器收到
// fetch/abort/超时类错误——但服务端不因此取消，仍跑完并经 socket 回灌 + 存入 comfyJobStore。
// 这里把「是否传输类错误」判定 + 「socket 回灌优先 + workflowResult 轮询」的取回循环抽成可注入依赖
// 的纯函数，便于单测（不碰真实 socket / tRPC / 定时器）。

export type PendingComfyResult = { jobId: string; ok: boolean; urls?: string[]; outputType?: "image" | "video"; error?: string };
export type ComfyResultQuery =
  | { status: "pending" }
  | { status: "done"; urls: string[]; outputType: "image" | "video" }
  | { status: "error"; error: string };
export type RecoveredRun =
  | { ok: true; urls: string[]; outputType: "image" | "video" }
  | { ok: false; error?: string }
  | null; // 超时仍无终局

/** 传输/隧道切断类错误——服务端多半仍在跑，应转入兜底取回而非直接判失败。业务错误（服务端明确
 *  返回的具体信息）不匹配，直接判失败。 */
export function isTransportCutError(msg: string): boolean {
  return /fetch|network|abort|aborted|timeout|timed out|gateway|502|503|504|econn|socket hang|连接|超时|网络/i.test(msg);
}

export interface PollDeps {
  jobId: string;
  /** 读取 socket 回灌的瞬态结果（node.payload.pendingComfyResult），无则 undefined。 */
  readPending: () => PendingComfyResult | undefined;
  /** 轮询服务端 workflowResult 查询。 */
  fetchResult: (jobId: string) => Promise<ComfyResultQuery>;
  sleep: (ms: number) => Promise<void>;
  maxMs?: number;      // 兜底总时限（默认 12 分钟，覆盖最慢视频工作流）
  intervalMs?: number; // 轮询间隔（默认 3 秒）
  now?: () => number;
}

/** socket 回灌优先 + workflowResult 轮询兜底，直到拿到终局结果或超时。 */
export async function pollComfyRun(deps: PollDeps): Promise<RecoveredRun> {
  const { jobId, readPending, fetchResult, sleep } = deps;
  const maxMs = deps.maxMs ?? 12 * 60 * 1000;
  const intervalMs = deps.intervalMs ?? 3000;
  const now = deps.now ?? Date.now;
  const started = now();
  // 首轮立即检查一次（覆盖「HTTP 刚被切但结果已就绪」），随后按间隔轮询。
  for (;;) {
    // socket 回灌快路径
    const pend = readPending();
    if (pend && pend.jobId === jobId) {
      if (pend.ok && pend.urls) return { ok: true, urls: pend.urls, outputType: pend.outputType ?? "image" };
      if (!pend.ok) return { ok: false, error: pend.error };
    }
    // 轮询查询兜底
    try {
      const r = await fetchResult(jobId);
      if (r.status === "done") return { ok: true, urls: r.urls, outputType: r.outputType };
      if (r.status === "error") return { ok: false, error: r.error };
    } catch { /* 轮询本身可能被隧道抖动打断——忽略，下一轮再试 */ }
    if (now() - started >= maxMs) return null; // 超时仍无终局
    await sleep(intervalMs);
  }
}
