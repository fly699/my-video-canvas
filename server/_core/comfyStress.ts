// ComfyUI 压力测试任务管理器（仅管理员）。
//
// 设计：
// - 压测是长任务（单次生图常达数分钟），不能在一个同步 tRPC 请求里跑完。
//   因此 start 立即返回 jobId，真正的循环在后台 worker 池里跑。
// - 状态保存在内存（进程级 Map）。容器重启即丢失——压测结果是即时诊断数据，
//   不需要落库。前端通过 status 查询轮询，同时后台尽力通过 Socket.IO 推送进度。
// - 并发由固定大小的 worker 池控制：concurrency 个 worker 同时从计数器领取任务，
//   各自调用 runComfyProbe，直到累计完成 total 次。
// - 多地址：派发任务时按轮询（round-robin）把每次请求分配到不同的 ComfyUI 服务器，
//   并按服务器分桶统计，便于横向对比每台机器的吞吐/延迟/错误。
// - 时间序列：运行期间每秒采样一次（瞬时吞吐 + 累计延迟 + 每服务器指标），
//   供前端画实时曲线图。

import type { Server as SocketIOServer } from "socket.io";
import { runComfyProbe, type ComfyProbeResult } from "./comfyui";

// 安全上限——防止管理员误填超大值把服务器或目标 ComfyUI 打挂。
const MAX_TOTAL = 1000;
const MAX_CONCURRENCY = 32;
const MAX_SERVERS = 16;
const JOB_RETENTION_MS = 30 * 60_000; // 完成后保留 30 分钟供前端读取
const MAX_ERROR_SAMPLES = 20;
const SAMPLE_INTERVAL_MS = 1000; // 时间序列采样间隔
const MAX_SAMPLES = 1800; // 上限（约 30 分钟 @1s），超出后丢最旧的点

let _io: SocketIOServer | null = null;
export function setStressSocketIO(io: SocketIOServer): void { _io = io; }
/** 前端订阅压测进度的房间名。仅管理员可加入（见 index.ts）。 */
export const STRESS_ROOM = "comfystress";

export interface StressStartOptions {
  baseUrls: string[];
  workflowJson: string;
  mode: "lean" | "full";
  concurrency: number;
  total: number;
  randomizeSeed: boolean;
  startedBy: { id: number; email: string | null };
  /** 压测来源摘要（前端展示 + 历史落库）：工作流 JSON 或 服务器模型（含 ckpt 名）。 */
  meta?: { source: "json" | "model"; ckpt?: string };
}

interface RunRecord {
  ok: boolean;
  baseUrl: string;
  submitMs?: number;
  waitMs?: number;
  downloadMs?: number;
  totalMs?: number;
  error?: string;
}

// 一组延迟/吞吐统计（基于成功样本的 totalMs，单位毫秒）。整体与每服务器共用此结构。
interface Stats {
  completed: number;
  succeeded: number;
  failed: number;
  throughputPerSec: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  avgSubmitMs: number | null;
  avgWaitMs: number | null;
  avgDownloadMs: number | null;
}

export interface ServerStatView extends Stats {
  baseUrl: string;
  inFlight: number;
  lastError: string | null;
}

// 单个时间采样点：整体瞬时吞吐 + 累计延迟，以及每服务器的瞬时吞吐/在途/延迟。
export interface TimeSample {
  t: number; // 距任务开始的毫秒数
  completed: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  throughputPerSec: number; // 整体瞬时吞吐（本采样区间内）
  avgMs: number | null; // 整体累计平均延迟
  perServer: { baseUrl: string; throughputPerSec: number; inFlight: number; avgMs: number | null }[];
}

export interface StressJobView extends Stats {
  id: string;
  status: "running" | "completed" | "cancelled" | "failed";
  mode: "lean" | "full";
  concurrency: number;
  total: number;
  inFlight: number;
  startedAt: number;
  finishedAt: number | null;
  baseUrls: string[];
  servers: ServerStatView[];
  timeSeries: TimeSample[];
  errorSamples: string[];
  /** 来源摘要 + 发起人（随 view 下发给前端、随历史落库）。 */
  meta?: { source: "json" | "model"; ckpt?: string };
  startedByEmail: string | null;
}

interface StressJob extends StressJobView {
  records: RunRecord[];
  cancelRequested: boolean;
  workflowJson: string;
  randomizeSeed: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  sampleTimer: ReturnType<typeof setInterval> | null;
  inFlightByServer: Record<string, number>;
  _lastSampleAt: number;
  _lastSucceeded: number;
  _lastServerSucceeded: Record<string, number>;
  // Hard-stop controller: aborting cancels all in-flight ComfyUI fetches immediately.
  abort: AbortController;
}

const jobs = new Map<string, StressJob>();

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function computeStats(recs: RunRecord[], elapsedSec: number): Stats {
  const oks = recs.filter((r) => r.ok);
  const totals = oks.map((r) => r.totalMs ?? 0).sort((a, b) => a - b);
  const succeeded = oks.length;
  const completed = recs.length;
  return {
    completed,
    succeeded,
    failed: completed - succeeded,
    avgMs: avg(totals),
    p50Ms: percentile(totals, 50),
    p95Ms: percentile(totals, 95),
    maxMs: totals.length ? totals[totals.length - 1] : null,
    avgSubmitMs: avg(oks.map((r) => r.submitMs ?? 0)),
    avgWaitMs: avg(oks.map((r) => r.waitMs ?? 0)),
    avgDownloadMs: avg(oks.map((r) => r.downloadMs ?? 0)),
    throughputPerSec: elapsedSec > 0 ? +(succeeded / elapsedSec).toFixed(3) : 0,
  };
}

function recompute(job: StressJob): void {
  const elapsedSec = ((job.finishedAt ?? Date.now()) - job.startedAt) / 1000;
  Object.assign(job, computeStats(job.records, elapsedSec));
  job.servers = job.baseUrls.map((url) => {
    const recs = job.records.filter((r) => r.baseUrl === url);
    const lastError = [...recs].reverse().find((r) => !r.ok && r.error)?.error ?? null;
    return {
      baseUrl: url,
      inFlight: job.inFlightByServer[url] ?? 0,
      lastError,
      ...computeStats(recs, elapsedSec),
    };
  });
}

export function toView(job: StressJob): StressJobView {
  // Destructure out every internal-only field; the inferred `view` is exactly
  // StressJobView. The compiler flags any internal field added to StressJob that
  // isn't listed here, so it can never silently leak into the client payload.
  const {
    records, cancelRequested, workflowJson, randomizeSeed, cleanupTimer,
    sampleTimer, inFlightByServer, _lastSampleAt, _lastSucceeded,
    _lastServerSucceeded, abort, ...view
  } = job;
  void records; void cancelRequested; void workflowJson; void randomizeSeed;
  void cleanupTimer; void sampleTimer; void inFlightByServer; void _lastSampleAt;
  void _lastSucceeded; void _lastServerSucceeded; void abort;
  return view;
}

function emit(job: StressJob): void {
  _io?.to(STRESS_ROOM).emit("comfystress:progress", toView(job));
}

// 采样一个时间点：计算整体瞬时吞吐与每服务器瞬时吞吐，追加到 timeSeries。
// Throughput is succeeded-based to match the headline `throughputPerSec` stat
// (a server that fails fast must not inflate the curve).
function sample(job: StressJob): void {
  recompute(job); // refreshes job.servers (per-server succeeded/inFlight/avgMs)
  const now = Date.now();
  const dtSec = (now - job._lastSampleAt) / 1000;
  const overallTp = dtSec > 0 ? +(((job.succeeded - job._lastSucceeded) / dtSec)).toFixed(3) : 0;

  // Read per-server counts straight off the servers[] recompute just built —
  // no second scan of job.records.
  const perServer = job.servers.map((srv) => {
    const prev = job._lastServerSucceeded[srv.baseUrl] ?? 0;
    const tp = dtSec > 0 ? +(((srv.succeeded - prev) / dtSec)).toFixed(3) : 0;
    job._lastServerSucceeded[srv.baseUrl] = srv.succeeded;
    return { baseUrl: srv.baseUrl, throughputPerSec: tp, inFlight: srv.inFlight, avgMs: srv.avgMs };
  });

  job.timeSeries.push({
    t: now - job.startedAt,
    completed: job.completed,
    succeeded: job.succeeded,
    failed: job.failed,
    inFlight: job.inFlight,
    throughputPerSec: overallTp,
    avgMs: job.avgMs,
    perServer,
  });
  if (job.timeSeries.length > MAX_SAMPLES) job.timeSeries.shift();
  job._lastSampleAt = now;
  job._lastSucceeded = job.succeeded;
  emit(job);
}

export function getJob(id: string): StressJob | undefined {
  return jobs.get(id);
}

export function listJobs(): StressJobView[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(toView);
}

/** 优雅取消：不再派发新请求，已在途的请求会先跑完。 */
export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return false;
  job.cancelRequested = true;
  return true;
}

/** 立即停止：在优雅取消基础上，abort 所有在途的 ComfyUI HTTP 请求，不等其完成。 */
export function stopJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return false;
  job.cancelRequested = true;
  job.abort.abort();
  return true;
}

export function startStressTest(opts: StressStartOptions): StressJobView {
  const total = Math.min(Math.max(1, Math.floor(opts.total)), MAX_TOTAL);
  const concurrency = Math.min(Math.max(1, Math.floor(opts.concurrency)), MAX_CONCURRENCY);

  // 规整地址列表：去空白、去重、限量；至少一个。
  const baseUrls = Array.from(
    new Set(opts.baseUrls.map((u) => u.trim()).filter((u) => u.length > 0)),
  ).slice(0, MAX_SERVERS);
  if (baseUrls.length === 0) {
    throw new Error("未提供任何 ComfyUI 服务器地址");
  }

  // 提前校验 workflow JSON，避免起了任务才发现格式错误。
  try {
    JSON.parse(opts.workflowJson);
  } catch {
    throw new Error("Workflow JSON 格式错误，无法解析");
  }

  const id = `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const job: StressJob = {
    id,
    status: "running",
    mode: opts.mode,
    concurrency,
    total,
    completed: 0,
    succeeded: 0,
    failed: 0,
    inFlight: 0,
    startedAt: now,
    finishedAt: null,
    throughputPerSec: 0,
    avgMs: null, p50Ms: null, p95Ms: null, maxMs: null,
    avgSubmitMs: null, avgWaitMs: null, avgDownloadMs: null,
    errorSamples: [],
    baseUrls,
    servers: baseUrls.map((url) => ({
      baseUrl: url, inFlight: 0, lastError: null,
      completed: 0, succeeded: 0, failed: 0, throughputPerSec: 0,
      avgMs: null, p50Ms: null, p95Ms: null, maxMs: null,
      avgSubmitMs: null, avgWaitMs: null, avgDownloadMs: null,
    })),
    timeSeries: [],
    meta: opts.meta,
    startedByEmail: opts.startedBy.email,
    records: [],
    cancelRequested: false,
    workflowJson: opts.workflowJson,
    randomizeSeed: opts.randomizeSeed,
    cleanupTimer: null,
    sampleTimer: null,
    inFlightByServer: Object.fromEntries(baseUrls.map((u) => [u, 0])),
    _lastSampleAt: now,
    _lastSucceeded: 0,
    _lastServerSucceeded: Object.fromEntries(baseUrls.map((u) => [u, 0])),
    abort: new AbortController(),
  };
  jobs.set(id, job);

  // 后台启动 worker 池——不 await，立即返回。
  void runPool(job);

  return toView(job);
}

async function runPool(job: StressJob): Promise<void> {
  let dispatched = 0; // 已派发（不一定完成）的任务数

  // 时间序列采样器：运行期间每秒打点。
  job.sampleTimer = setInterval(() => sample(job), SAMPLE_INTERVAL_MS);

  const worker = async (): Promise<void> => {
    while (true) {
      if (job.cancelRequested) return;
      if (dispatched >= job.total) return;
      // 轮询分配到各服务器，把负载均匀打散。
      const serverUrl = job.baseUrls[dispatched % job.baseUrls.length];
      dispatched++;
      job.inFlight++;
      job.inFlightByServer[serverUrl] = (job.inFlightByServer[serverUrl] ?? 0) + 1;
      let rec: RunRecord | null;
      try {
        const r: ComfyProbeResult = await runComfyProbe(serverUrl, {
          workflowJson: job.workflowJson,
          mode: job.mode,
          randomizeSeed: job.randomizeSeed,
          signal: job.abort.signal,
        });
        rec = { ok: true, baseUrl: serverUrl, submitMs: r.submitMs, waitMs: r.waitMs, downloadMs: r.downloadMs, totalMs: r.totalMs };
      } catch (err) {
        // 立即停止 abort 的在途请求不计入失败统计——它是用户主动中断，不是 ComfyUI 的问题。
        if (job.abort.signal.aborted) {
          rec = null;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          rec = { ok: false, baseUrl: serverUrl, error: msg };
          if (job.errorSamples.length < MAX_ERROR_SAMPLES) job.errorSamples.push(`[${serverUrl}] ${msg}`);
        }
      } finally {
        job.inFlight--;
        job.inFlightByServer[serverUrl] = Math.max(0, (job.inFlightByServer[serverUrl] ?? 1) - 1);
      }
      if (rec) {
        // Keep the live counters fresh for polled reads; the 1s sampler owns the
        // (heavier) emit + time-series so we don't serialize the whole growing
        // job — including its time-series — on every single completed request.
        job.records.push(rec);
        recompute(job);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: job.concurrency }, () => worker()));
  } catch {
    // worker 内部已捕获单次错误；此处兜底，整体不应抛出。
  }

  if (job.sampleTimer) { clearInterval(job.sampleTimer); job.sampleTimer = null; }
  job.finishedAt = Date.now();
  job.status = (job.cancelRequested || job.abort.signal.aborted) ? "cancelled" : "completed";
  sample(job); // 收尾再打一个点（内部 recompute + emit），保证曲线到达终态

  // 历史落库：完整 view（含 timeSeries/servers/errorSamples），供压测页「历史记录」
  // 重新渲染图表与导出。动态 import 避免 _core ↔ db 静态依赖；失败静默（dev 无 DB）。
  void (async () => {
    try {
      const dbMod = await import("../db");
      await dbMod.insertComfyStressHistory({
        jobId: job.id,
        status: job.status,
        startedByEmail: job.startedByEmail,
        config: {
          baseUrls: job.baseUrls, mode: job.mode, concurrency: job.concurrency,
          total: job.total, randomizeSeed: job.randomizeSeed, meta: job.meta ?? null,
        },
        result: toView(job),
        startedAt: new Date(job.startedAt),
        finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
      });
    } catch (e) {
      console.warn("[ComfyStress] 历史落库失败（不影响压测）：", e instanceof Error ? e.message : e);
    }
  })();

  // 完成后延迟清理，给前端留出读取窗口。
  job.cleanupTimer = setTimeout(() => { jobs.delete(job.id); }, JOB_RETENTION_MS);
}
