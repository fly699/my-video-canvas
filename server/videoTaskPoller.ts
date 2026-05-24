import type { Server as SocketIOServer } from "socket.io";
import { getPendingVideoTasks, updateVideoTask } from "./db";
import { isPoyoVideoProvider, submitPoyoVideo, checkPoyoVideoStatus } from "./_core/poyoVideo";
import { isHiggsfieldVideoProvider, submitHiggsfieldVideo, checkHiggsfieldVideoStatus } from "./_core/higgsfield";
import { storagePut } from "./storage";

const MAX_PERSIST_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB hard cap
const PERSIST_FETCH_TIMEOUT_MS = 180_000; // 3 min — large videos can be slow

/**
 * Best-effort: download the upstream video and store it in our own S3 via
 * storagePut(), returning a stable `/manus-storage/...` URL.
 *
 * Why: Poyo file_url expires after 24h (per official docs) and Higgsfield's
 * CDN URLs have similar TTLs. Without re-hosting, every generated video
 * becomes a dead link a day later.
 *
 * Failure mode: returns the original upstream URL so the user can at least
 * view it within the 24h window. We log the failure but never block the
 * task from being marked succeeded — the worst case is a video that
 * expires in 24h, which matches the previous behaviour.
 */
async function persistVideoOrFallback(upstreamUrl: string, provider: string): Promise<string> {
  try {
    const res = await fetch(upstreamUrl, { signal: AbortSignal.timeout(PERSIST_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[videoTaskPoller] persist fetch ${res.status} for ${provider}, falling back to upstream URL`);
      return upstreamUrl;
    }
    // Pre-flight Content-Length check — skip persistence for huge files
    const declared = res.headers.get("content-length");
    if (declared) {
      const n = parseInt(declared, 10);
      if (!isNaN(n) && n > MAX_PERSIST_VIDEO_BYTES) {
        console.warn(`[videoTaskPoller] video too large (${n} bytes) for ${provider}, keeping upstream URL`);
        return upstreamUrl;
      }
    }
    // Streaming reader with running byte-count cap — protects against
    // chunked responses without Content-Length sneaking past the pre-check.
    if (!res.body) return upstreamUrl;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PERSIST_VIDEO_BYTES) {
          await reader.cancel();
          console.warn(`[videoTaskPoller] video stream exceeded ${MAX_PERSIST_VIDEO_BYTES} bytes for ${provider}, keeping upstream URL`);
          return upstreamUrl;
        }
        chunks.push(value);
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const mime = res.headers.get("content-type") ?? "video/mp4";
    const ext = mime.includes("webm") ? "webm" : mime.includes("quicktime") ? "mov" : "mp4";
    const { url } = await storagePut(`generated-videos/${provider}-${Date.now()}.${ext}`, buf, mime);
    return url;
  } catch (err) {
    console.warn(`[videoTaskPoller] persist video failed for ${provider}, keeping upstream URL:`, err instanceof Error ? err.message : String(err));
    return upstreamUrl;
  }
}

// ── Video Provider Adapters ───────────────────────────────────────────────────

interface SubmitResult {
  externalTaskId: string;
}

interface PollResult {
  status: "pending" | "processing" | "succeeded" | "failed";
  resultVideoUrl?: string;
  errorMessage?: string;
}

// ── Mock provider (for testing) ───────────────────────────────────────────────

async function submitMockTask(): Promise<SubmitResult> {
  return { externalTaskId: `mock-${Date.now()}` };
}

async function pollMockTask(externalTaskId: string, createdAt: Date): Promise<PollResult> {
  const elapsed = Date.now() - createdAt.getTime();
  if (elapsed > 15000) {
    return {
      status: "succeeded",
      resultVideoUrl: "https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4",
    };
  }
  return { status: "processing" };
}

// ── Poller ────────────────────────────────────────────────────────────────────

export function setupVideoTaskPoller(io: SocketIOServer) {
  const POLL_INTERVAL = 10_000; // 10 seconds
  const MAX_TRANSIENT_ERRORS = 10; // after this many consecutive errors, mark task failed
  const pollErrorCounts = new Map<number, number>();

  const poll = async () => {
    try {
      const tasks = await getPendingVideoTasks();

      for (const task of tasks) {
        try {
          let result: PollResult;

          // ── Submit if still pending ──────────────────────────────────────
          if (task.status === "pending") {
            let submitResult: SubmitResult;

            if (isPoyoVideoProvider(task.provider)) {
              // Poyo.ai: Seedance 2 / Veo 3.1
              submitResult = await submitPoyoVideo({
                provider: task.provider,
                prompt: task.prompt ?? "",
                negativePrompt: task.negativePrompt ?? undefined,
                referenceImageUrl: task.referenceImageUrl ?? undefined,
                params: (task.params as Record<string, unknown>) ?? undefined,
              });
            } else if (isHiggsfieldVideoProvider(task.provider)) {
              // Higgsfield: DoP / Kling / Seedance
              submitResult = await submitHiggsfieldVideo({
                provider: task.provider,
                prompt: task.prompt ?? "",
                negativePrompt: task.negativePrompt ?? undefined,
                referenceImageUrl: task.referenceImageUrl ?? undefined,
                params: (task.params as Record<string, unknown>) ?? undefined,
              });
            } else if (task.provider === "mock") {
              submitResult = await submitMockTask();
            } else {
              await updateVideoTask(task.id, {
                status: "failed",
                errorMessage: `Unknown provider: ${task.provider}`,
              });
              continue;
            }

            await updateVideoTask(task.id, {
              status: "processing",
              externalTaskId: submitResult.externalTaskId,
            });
            continue;
          }

          // ── Poll status ──────────────────────────────────────────────────
          if (!task.externalTaskId) continue;

          if (isPoyoVideoProvider(task.provider)) {
            // Poyo.ai status check
            const upstream = await checkPoyoVideoStatus(task.externalTaskId);
            if (upstream.status === "finished") {
              if (upstream.resultVideoUrl) {
                // Re-host so the URL doesn't die after Poyo's 24h CDN TTL.
                // Falls back to upstream URL on any failure (user can still
                // view within the 24h window).
                const persisted = await persistVideoOrFallback(upstream.resultVideoUrl, task.provider);
                result = { status: "succeeded", resultVideoUrl: persisted };
              } else {
                result = { status: "failed", errorMessage: "生成完成但无视频 URL" };
              }
            } else if (upstream.status === "failed") {
              result = { status: "failed", errorMessage: upstream.errorMessage ?? "生成失败" };
            } else {
              result = { status: "processing" };
            }
          } else if (isHiggsfieldVideoProvider(task.provider)) {
            // Higgsfield status check
            const upstream = await checkHiggsfieldVideoStatus(task.externalTaskId);
            if (upstream.status === "succeeded" && upstream.resultVideoUrl) {
              // Higgsfield CDN URLs are also temporary — re-host to our own storage.
              const persisted = await persistVideoOrFallback(upstream.resultVideoUrl, task.provider);
              result = { status: "succeeded", resultVideoUrl: persisted };
            } else if (upstream.status === "succeeded" && !upstream.resultVideoUrl) {
              result = { status: "failed", errorMessage: "任务完成但未返回视频 URL" };
            } else if (upstream.status === "failed") {
              result = { status: "failed", errorMessage: upstream.errorMessage ?? "生成失败" };
            } else {
              result = { status: "processing" };
            }
          } else {
            // Mock provider
            result = await pollMockTask(task.externalTaskId, task.createdAt);
          }

          pollErrorCounts.delete(task.id);
          if (result.status !== "processing") {
            await updateVideoTask(task.id, {
              status: result.status,
              resultVideoUrl: result.resultVideoUrl,
              errorMessage: result.errorMessage,
            });

            // Notify via socket
            io.to(`project:${task.projectId}`).emit("collaboration-event", {
              type: "video-task:update",
              userId: task.userId,
              userName: "system",
              color: "",
              projectId: task.projectId,
              payload: {
                taskId: task.id,
                nodeId: task.nodeId,
                status: result.status,
                resultVideoUrl: result.resultVideoUrl,
                errorMessage: result.errorMessage,
              },
            });
          }
        } catch (err) {
          const errCount = (pollErrorCounts.get(task.id) ?? 0) + 1;
          if (errCount >= MAX_TRANSIENT_ERRORS) {
            pollErrorCounts.delete(task.id);
            console.error(`[VideoPoller] Task ${task.id} exceeded max retries, marking failed:`, err);
            await updateVideoTask(task.id, {
              status: "failed",
              errorMessage: err instanceof Error ? err.message : "轮询失败次数过多，请重试",
            });
          } else {
            pollErrorCounts.set(task.id, errCount);
            console.error(`[VideoPoller] Task ${task.id} transient error (attempt ${errCount}/${MAX_TRANSIENT_ERRORS}):`, err);
          }
        }
      }
    } catch (err) {
      console.error("[VideoPoller] Poll cycle error:", err);
    }
  };

  // Start polling
  setInterval(poll, POLL_INTERVAL);
  console.log("[VideoPoller] Started, interval:", POLL_INTERVAL, "ms");
}
