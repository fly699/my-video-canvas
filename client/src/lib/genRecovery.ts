// #255 阻塞式生成管线（首批 image_gen 云端路径）的「隧道切断兜底」取回循环。
// 与 comfyRunRecovery.pollComfyRun（#163）同构，但结果形状泛型化（各管线自己的响应对象），
// 且无 socket 回灌快路径（纯轮询即可——生图结束早于轮询时限）。
// 仅当阻塞 mutation 以「传输类错误」失败（isTransportCutError 判定）时才进入本循环；
// 本机/局域网直连的正常成功/业务失败路径完全不经过这里——零行为变化（用户拍板的硬约束）。

export type GenRecoveryQuery<T> =
  | { status: "pending" }
  | { status: "done"; value: T }
  | { status: "error"; error: string };

export type GenRecoveryOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error?: string }
  | null; // 超时仍无终局（或被调用方主动停止）

export interface GenRecoveryDeps<T> {
  jobId: string;
  /** 轮询服务端 result 查询（如 imageGen.result）。 */
  fetchResult: (jobId: string) => Promise<GenRecoveryQuery<T>>;
  sleep: (ms: number) => Promise<void>;
  /** 返回 true 时立即停止取回（如用户点了「放弃等待」）。 */
  stopped?: () => boolean;
  maxMs?: number;      // 兜底总时限（默认 10 分钟，覆盖最慢云端生图 + 余量；服务端暂存 TTL 20 分钟）
  intervalMs?: number; // 轮询间隔（默认 3 秒）
  now?: () => number;
}

/** 轮询直到拿到终局结果、超时或被停止。轮询自身报错（隧道抖动）忽略、下一轮再试。 */
export async function pollGenRecovery<T>(deps: GenRecoveryDeps<T>): Promise<GenRecoveryOutcome<T>> {
  const { jobId, fetchResult, sleep } = deps;
  const maxMs = deps.maxMs ?? 10 * 60 * 1000;
  const intervalMs = deps.intervalMs ?? 3000;
  const now = deps.now ?? Date.now;
  const started = now();
  // 首轮立即查一次（覆盖「HTTP 刚被切但结果已就绪」），随后按间隔轮询。
  for (;;) {
    if (deps.stopped?.()) return null;
    try {
      const r = await fetchResult(jobId);
      if (r.status === "done") return { ok: true, value: r.value };
      if (r.status === "error") return { ok: false, error: r.error };
    } catch { /* 轮询本身可能被隧道抖动打断——忽略，下一轮再试 */ }
    if (now() - started >= maxMs) return null;
    await sleep(intervalMs);
  }
}
