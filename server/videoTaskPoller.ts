import type { Server as SocketIOServer } from "socket.io";
import { getPendingVideoTasks, updateVideoTask, claimVideoTaskForSubmit } from "./db";
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
          // CRITICAL: claim atomically (pending → processing) BEFORE the
          // upstream call. Two paths race for the same row — the router's
          // `videoTasks.create` and this poller — and without the lock, a
          // single dropped DB update after a successful paid submit would
          // cause this poller cycle to re-charge the user every 10 seconds.
          // The production incident burned 6×160 credits in 60s on a single
          // user click before the previous error-counter ceiling intervened.
          if (task.status === "pending") {
            const claimed = await claimVideoTaskForSubmit(task.id);
            if (!claimed) {
              // Lost the race to the router (or a parallel poller); skip — the
              // winner is responsible for completing the submit.
              continue;
            }
            let submitResult: SubmitResult;
            try {
              if (isPoyoVideoProvider(task.provider)) {
                // Poyo.ai: Seedance 2 / Veo 3.1 / Wan 2.6 / etc.
                submitResult = await submitPoyoVideo({
                  provider: task.provider,
                  prompt: task.prompt ?? "",
                  negativePrompt: task.negativePrompt ?? undefined,
                  referenceImageUrl: task.referenceImageUrl ?? undefined,
                  params: (task.params as Record<string, unknown>) ?? undefined,
                });
              } else if (isHiggsfieldVideoProvider(task.provider)) {
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
            } catch (submitErr) {
              // Upstream submit threw — mark failed (we don't know whether
              // the upstream actually received the request, but retrying
              // risks double-billing). Surface the error to the client.
              const msg = submitErr instanceof Error ? submitErr.message : String(submitErr);
              console.error(`[VideoPoller] submit failed for task ${task.id}, marking failed: ${msg}`);
              await updateVideoTask(task.id, {
                status: "failed",
                errorMessage: `[CHARGED?] 提交失败: ${msg.slice(0, 200)}`,
              }).catch(() => { /* best-effort — task is in 'processing' state, no further submit will happen */ });
              pollErrorCounts.delete(task.id);
              continue;
            }
            // Submit succeeded — save the external id. If this update fails,
            // the task is stuck in 'processing' without an externalTaskId.
            // The poll loop's `if (!task.externalTaskId) continue` guard
            // prevents the duplicate-submit credit burn; credits leak ONCE on
            // this single attempt but never compound.
            await updateVideoTask(task.id, {
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
                // Upstream said "finished" but we couldn't extract any video
                // URL — credits ARE spent but our parser missed the response
                // field. Flag with [CHARGED] so the UI can block one-click
                // resubmit (the previous behavior of marking failed silently
                // led users to retry and double-charge).
                result = { status: "failed", errorMessage: "[CHARGED] 视频已在上游生成完成，但本系统未识别 URL（积分已扣，请勿重试；联系管理员查看 Poyo 控制台）" };
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
              // Higgsfield 已扣费但 URL 解析失败 — 同上加 [CHARGED] 标识
              result = { status: "failed", errorMessage: "[CHARGED] 视频已在 Higgsfield 生成完成，但本系统未识别 URL（积分已扣，请勿重试）" };
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
