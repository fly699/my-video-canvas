import type { Server as SocketIOServer } from "socket.io";
import { getPendingVideoTasks, updateVideoTask } from "./db";
import { isPoyoVideoProvider, submitPoyoVideo, checkPoyoVideoStatus } from "./_core/poyoVideo";

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
            } else {
              // Mock provider (and any unconfigured provider falls back to mock)
              submitResult = await submitMockTask();
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
              result = { status: "succeeded", resultVideoUrl: upstream.resultVideoUrl };
            } else if (upstream.status === "failed") {
              result = { status: "failed", errorMessage: upstream.errorMessage ?? "生成失败" };
            } else {
              result = { status: "processing" };
            }
          } else {
            // Mock provider
            result = await pollMockTask(task.externalTaskId, task.createdAt);
          }

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
          console.error(`[VideoPoller] Task ${task.id} error:`, err);
          await updateVideoTask(task.id, {
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          });
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
