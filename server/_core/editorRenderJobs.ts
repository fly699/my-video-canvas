import { randomUUID } from "crypto";

// In-process registry of editor export renders. A render runs in this same
// process (ffmpeg child) and reports progress here; the client polls
// editor.exportStatus. Jobs are ephemeral (lost on restart) — acceptable for a
// single-instance deployment; can be promoted to a DB table if needed.
export interface RenderJob {
  id: string;
  userId: number;
  sessionId: number;
  status: "running" | "done" | "error";
  progress: number;   // 0..100
  stage: string;
  url?: string;
  storageKey?: string;
  duration?: number;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, RenderJob>();
const JOB_TTL_MS = 60 * 60_000; // keep finished jobs for an hour
// Hard cap for "running" jobs: if a render never reports done/error (e.g. the
// ffmpeg child crashed or the process was interrupted mid-export), the job
// would otherwise leak forever and never be swept. After this cap we mark it
// errored so it becomes eligible for normal TTL cleanup.
const RUNNING_HARD_CAP_MS = 2 * 60 * 60_000; // 2 hours

function sweep() {
  const now = Date.now();
  for (const [id, j] of Array.from(jobs.entries())) {
    if (j.status === "running") {
      if (now - j.createdAt > RUNNING_HARD_CAP_MS) {
        j.status = "error";
        j.error = j.error || "渲染超时（任务长时间无进度，已自动终止）";
      }
    } else if (now - j.createdAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

/** How many renders this user currently has in flight (each spawns an ffmpeg child). */
export function countRunningRenderJobs(userId: number): number {
  sweep();
  let n = 0;
  for (const j of Array.from(jobs.values())) if (j.userId === userId && j.status === "running") n++;
  return n;
}

export function createRenderJob(userId: number, sessionId: number): RenderJob {
  sweep();
  const job: RenderJob = { id: randomUUID(), userId, sessionId, status: "running", progress: 0, stage: "排队中", createdAt: Date.now() };
  jobs.set(job.id, job);
  return job;
}

export function updateRenderJob(id: string, patch: Partial<RenderJob>): void {
  const j = jobs.get(id);
  if (j) Object.assign(j, patch);
}

/** Owner-scoped fetch so a user can't poll someone else's render. */
export function getRenderJob(id: string, userId: number): RenderJob | undefined {
  const j = jobs.get(id);
  return j && j.userId === userId ? j : undefined;
}

/** 该用户该编辑会话「最新的、非失败」渲染任务——供离开剪辑器再回来时恢复进度/成片（#90）。
 *  返回 running（继续显示进度）或 done（直接展示成片下载）；error 不自动恢复（用户可重导）。 */
export function getActiveRenderJobForSession(userId: number, sessionId: number): RenderJob | undefined {
  sweep();
  let best: RenderJob | undefined;
  for (const j of Array.from(jobs.values())) {
    if (j.userId !== userId || j.sessionId !== sessionId || j.status === "error") continue;
    if (!best || j.createdAt > best.createdAt) best = j;
  }
  return best;
}
