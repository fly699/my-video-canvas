import type { Server as SocketIOServer } from "socket.io";
import { getPendingVideoTasks, updateVideoTask } from "./db";
import { isPoyoVideoProvider, submitPoyoVideo, checkPoyoVideoStatus } from "./_core/poyoVideo";
import { isHiggsfieldVideoProvider, submitHiggsfieldVideo, checkHiggsfieldVideoStatus } from "./_core/higgsfield";
import { persistVideoOrFallback, persistVideosOrFallback } from "./_core/persistVideo";


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
              const urls = upstream.resultVideoUrls ?? (upstream.resultVideoUrl ? [upstream.resultVideoUrl] : []);
              if (urls.length > 0) {
                // Re-host so the URL doesn't die after Poyo's 24h CDN TTL.
                // Multi-shot Wan 2.6 jobs return 3 URLs; persist each then
                // newline-join to store inside the existing text column.
                const persistedList = await persistVideosOrFallback(urls, task.provider);
                result = { status: "succeeded", resultVideoUrl: persistedList.join("\n") };
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
