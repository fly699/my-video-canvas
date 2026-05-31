// ComfyUI 压力测试任务管理器（仅管理员）。
//
// 设计：
// - 压测是长任务（单次生图常达数分钟），不能在一个同步 tRPC 请求里跑完。
//   因此 start 立即返回 jobId，真正的循环在后台 worker 池里跑。
// - 状态保存在内存（进程级 Map）。容器重启即丢失——压测结果是即时诊断数据，
//   不需要落库。前端通过 status 查询轮询，同时后台尽力通过 Socket.IO 推送进度。
// - 并发由固定大小的 worker 池控制：concurrency 个 worker 同时从计数器领取任务，
//   各自调用 runComfyProbe，直到累计完成 total 次。

import type { Server as SocketIOServer } from "socket.io";
import { runComfyProbe, type ComfyProbeResult } from "./comfyui";

// 安全上限——防止管理员误填超大值把服务器或目标 ComfyUI 打挂。
const MAX_TOTAL = 1000;
const MAX_CONCURRENCY = 32;
const JOB_RETENTION_MS = 30 * 60_000; // 完成后保留 30 分钟供前端读取
const MAX_ERROR_SAMPLES = 20;

let _io: SocketIOServer | null = null;
export function setStressSocketIO(io: SocketIOServer): void { _io = io; }
/** 前端订阅压测进度的房间名。仅管理员可加入（见 index.ts）。 */
export const STRESS_ROOM = "comfystress";

export interface StressStartOptions {
  baseUrl: string;
  workflowJson: string;
  mode: "lean" | "full";
  concurrency: number;
  total: number;
  randomizeSeed: boolean;
  startedBy: { id: number; email: string | null };
}

interface RunRecord {
  ok: boolean;
  submitMs?: number;
  waitMs?: number;
  downloadMs?: number;
  totalMs?: number;
  error?: string;
}

export interface StressJobView {
  id: string;
  status: "running" | "completed" | "cancelled" | "failed";
  mode: "lean" | "full";
  concurrency: number;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  startedAt: number;
  finishedAt: number | null;
  // 统计（基于成功样本的 totalMs，单位毫秒）
  throughputPerSec: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  avgSubmitMs: number | null;
  avgWaitMs: number | null;
  avgDownloadMs: number | null;
  errorSamples: string[];
}

interface StressJob extends StressJobView {
  records: RunRecord[];
  cancelRequested: boolean;
  baseUrl: string;
  workflowJson: string;
  randomizeSeed: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
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

function recompute(job: StressJob): void {
  const oks = job.records.filter((r) => r.ok);
  const totals = oks.map((r) => r.totalMs ?? 0).sort((a, b) => a - b);
  job.succeeded = oks.length;
  job.failed = job.records.length - oks.length;
  job.completed = job.records.length;
  job.avgMs = avg(totals);
  job.p50Ms = percentile(totals, 50);
  job.p95Ms = percentile(totals, 95);
  job.maxMs = totals.length ? totals[totals.length - 1] : null;
  job.avgSubmitMs = avg(oks.map((r) => r.submitMs ?? 0));
  job.avgWaitMs = avg(oks.map((r) => r.waitMs ?? 0));
  job.avgDownloadMs = avg(oks.map((r) => r.downloadMs ?? 0));
  const elapsedSec = ((job.finishedAt ?? Date.now()) - job.startedAt) / 1000;
  job.throughputPerSec = elapsedSec > 0 ? +(job.succeeded / elapsedSec).toFixed(3) : 0;
}

export function toView(job: StressJob): StressJobView {
  const { records, cancelRequested, baseUrl, workflowJson, randomizeSeed, cleanupTimer, ...view } = job;
  void records; void cancelRequested; void baseUrl; void workflowJson; void randomizeSeed; void cleanupTimer;
  return view;
}

function emit(job: StressJob): void {
  _io?.to(STRESS_ROOM).emit("comfystress:progress", toView(job));
}

export function getJob(id: string): StressJob | undefined {
  return jobs.get(id);
}

export function listJobs(): StressJobView[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(toView);
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return false;
  job.cancelRequested = true;
  return true;
}

export function startStressTest(opts: StressStartOptions): StressJobView {
  const total = Math.min(Math.max(1, Math.floor(opts.total)), MAX_TOTAL);
  const concurrency = Math.min(Math.max(1, Math.floor(opts.concurrency)), MAX_CONCURRENCY);

  // 提前校验 workflow JSON，避免起了任务才发现格式错误。
  try {
    JSON.parse(opts.workflowJson);
  } catch {
    throw new Error("Workflow JSON 格式错误，无法解析");
  }

  const id = `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    startedAt: Date.now(),
    finishedAt: null,
    throughputPerSec: 0,
    avgMs: null, p50Ms: null, p95Ms: null, maxMs: null,
    avgSubmitMs: null, avgWaitMs: null, avgDownloadMs: null,
    errorSamples: [],
    records: [],
    cancelRequested: false,
    baseUrl: opts.baseUrl,
    workflowJson: opts.workflowJson,
    randomizeSeed: opts.randomizeSeed,
    cleanupTimer: null,
  };
  jobs.set(id, job);

  // 后台启动 worker 池——不 await，立即返回。
  void runPool(job);

  return toView(job);
}

async function runPool(job: StressJob): Promise<void> {
  let dispatched = 0; // 已派发（不一定完成）的任务数

  const worker = async (): Promise<void> => {
    while (true) {
      if (job.cancelRequested) return;
      if (dispatched >= job.total) return;
      dispatched++;
      job.inFlight++;
      let rec: RunRecord;
      try {
        const r: ComfyProbeResult = await runComfyProbe(job.baseUrl, {
          workflowJson: job.workflowJson,
          mode: job.mode,
          randomizeSeed: job.randomizeSeed,
        });
        rec = { ok: true, submitMs: r.submitMs, waitMs: r.waitMs, downloadMs: r.downloadMs, totalMs: r.totalMs };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        rec = { ok: false, error: msg };
        if (job.errorSamples.length < MAX_ERROR_SAMPLES) job.errorSamples.push(msg);
      } finally {
        job.inFlight--;
      }
      job.records.push(rec);
      recompute(job);
      emit(job);
    }
  };

  try {
    await Promise.all(Array.from({ length: job.concurrency }, () => worker()));
  } catch {
    // worker 内部已捕获单次错误；此处兜底，整体不应抛出。
  }

  job.finishedAt = Date.now();
  job.status = job.cancelRequested ? "cancelled" : "completed";
  recompute(job);
  emit(job);

  // 完成后延迟清理，给前端留出读取窗口。
  job.cleanupTimer = setTimeout(() => { jobs.delete(job.id); }, JOB_RETENTION_MS);
}
