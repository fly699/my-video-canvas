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

function sweep() {
  const now = Date.now();
  for (const [id, j] of Array.from(jobs.entries())) if (j.status !== "running" && now - j.createdAt > JOB_TTL_MS) jobs.delete(id);
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
