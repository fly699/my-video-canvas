// #255 阻塞式生成管线的「隧道切断兜底」通用结果暂存（首批接 image_gen）。
// 背景与 comfyJobStore（#163）完全同构：云端生图是一次长同步 HTTP（kie 慢模型可达 1–3 分钟），
// 应用经 cloudflared 隧道访问时该请求 ~100s 被切断——但服务端不因此取消，仍跑完并已计费。
// 缺的只是「结果回传给前端」。本 store 按客户端传入的一次性 recoveryJobId 暂存终局结果，
// 前端仅在收到「传输类错误」时轮询取回。
//
// 【零回归约束（用户拍板）】本 store 只在 mutation 正常完成/失败后追加一次写入，
// 不改变任何请求的同步返回路径——本机/局域网直连时行为与从前完全一致。
//
// 与 comfyJobStore 的差异：值为任意 JSON（管线自己的响应形状），且带 userId 归属校验
// （jobId 由客户端生成，读取时必须验属主，防止撞串探测他人结果）。

export type GenJobResult =
  | { status: "done"; value: unknown; userId: number; at: number }
  | { status: "error"; error: string; userId: number; at: number };

const store = new Map<string, GenJobResult>();
const TTL_MS = 20 * 60 * 1000; // 20 分钟：覆盖最慢云端生图 + 前端轮询窗口
const MAX_ENTRIES = 2000;

/** 清理过期条目；若仍超上限，按写入时间从旧到新裁到上限内。 */
export function pruneGenJobs(now = Date.now()): void {
  for (const [k, v] of Array.from(store.entries())) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
  if (store.size > MAX_ENTRIES) {
    const sorted = Array.from(store.entries()).sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < sorted.length - MAX_ENTRIES; i++) store.delete(sorted[i][0]);
  }
}

export function setGenJobDone(jobId: string, userId: number, value: unknown, now = Date.now()): void {
  if (!jobId) return;
  store.set(jobId, { status: "done", value, userId, at: now });
  pruneGenJobs(now);
}

export function setGenJobError(jobId: string, userId: number, error: string, now = Date.now()): void {
  if (!jobId) return;
  store.set(jobId, { status: "error", error: error.slice(0, 2000), userId, at: now });
  pruneGenJobs(now);
}

/** 取终局结果；过期或属主不符视为不存在（返回 null）。 */
export function getGenJob(jobId: string, userId: number, now = Date.now()): GenJobResult | null {
  const v = store.get(jobId);
  if (!v) return null;
  if (now - v.at > TTL_MS) { store.delete(jobId); return null; }
  if (v.userId !== userId) return null;
  return v;
}

/** 仅测试用：清空 store。 */
export function _clearGenJobs(): void { store.clear(); }
/** 仅测试用：当前条目数。 */
export function _genJobCount(): number { return store.size; }
