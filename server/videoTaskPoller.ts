import type { Server as SocketIOServer } from "socket.io";
import { getPendingVideoTasks, updateVideoTask } from "./db";

// ── Video Provider Adapters ───────────────────────────────────────────────────

interface SubmitResult {
  externalTaskId: string;
}

interface PollResult {
  status: "pending" | "processing" | "succeeded" | "failed";
  resultVideoUrl?: string;
  errorMessage?: string;
}

async function submitRunwayTask(prompt: string, referenceImageUrl?: string, params?: Record<string, unknown>): Promise<SubmitResult> {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) throw new Error("RUNWAY_API_KEY not configured");

  const body: Record<string, unknown> = {
    promptText: prompt,
    model: (params?.model as string) ?? "gen3a_turbo",
    duration: (params?.duration as number) ?? 5,
    ratio: (params?.ratio as string) ?? "1280:768",
  };

  if (referenceImageUrl) {
    body.promptImage = referenceImageUrl;
  }

  const res = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Runway API error: ${err}`);
  }

  const data = (await res.json()) as { id: string };
  return { externalTaskId: data.id };
}

async function pollRunwayTask(externalTaskId: string): Promise<PollResult> {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) throw new Error("RUNWAY_API_KEY not configured");

  const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${externalTaskId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": "2024-11-06",
    },
  });

  if (!res.ok) throw new Error(`Runway poll error: ${res.status}`);

  const data = (await res.json()) as {
    status: string;
    output?: string[];
    failure?: string;
  };

  if (data.status === "SUCCEEDED") {
    return { status: "succeeded", resultVideoUrl: data.output?.[0] };
  } else if (data.status === "FAILED") {
    return { status: "failed", errorMessage: data.failure ?? "Unknown error" };
  } else {
    return { status: "processing" };
  }
}

async function submitKlingTask(prompt: string, referenceImageUrl?: string, params?: Record<string, unknown>): Promise<SubmitResult> {
  const apiKey = process.env.KLING_API_KEY;
  if (!apiKey) throw new Error("KLING_API_KEY not configured");

  const body: Record<string, unknown> = {
    prompt,
    negative_prompt: (params?.negativePrompt as string) ?? "",
    cfg_scale: (params?.cfgScale as number) ?? 0.5,
    mode: (params?.mode as string) ?? "std",
    duration: (params?.duration as string) ?? "5",
  };

  if (referenceImageUrl) {
    body.image = referenceImageUrl;
  }

  const endpoint = referenceImageUrl
    ? "https://api.klingai.com/v1/videos/image2video"
    : "https://api.klingai.com/v1/videos/text2video";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kling API error: ${err}`);
  }

  const data = (await res.json()) as { data: { task_id: string } };
  return { externalTaskId: data.data.task_id };
}

async function pollKlingTask(externalTaskId: string): Promise<PollResult> {
  const apiKey = process.env.KLING_API_KEY;
  if (!apiKey) throw new Error("KLING_API_KEY not configured");

  const res = await fetch(`https://api.klingai.com/v1/videos/text2video/${externalTaskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`Kling poll error: ${res.status}`);

  const data = (await res.json()) as {
    data: {
      task_status: string;
      task_result?: { videos?: Array<{ url: string }> };
      task_status_msg?: string;
    };
  };

  const status = data.data.task_status;
  if (status === "succeed") {
    return {
      status: "succeeded",
      resultVideoUrl: data.data.task_result?.videos?.[0]?.url,
    };
  } else if (status === "failed") {
    return { status: "failed", errorMessage: data.data.task_status_msg ?? "Failed" };
  } else {
    return { status: "processing" };
  }
}

// Mock provider for testing
async function submitMockTask(): Promise<SubmitResult> {
  return { externalTaskId: `mock-${Date.now()}` };
}

async function pollMockTask(externalTaskId: string, createdAt: Date): Promise<PollResult> {
  const elapsed = Date.now() - createdAt.getTime();
  if (elapsed > 15000) {
    return {
      status: "succeeded",
      resultVideoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
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

          // Submit if still pending
          if (task.status === "pending") {
            let submitResult: SubmitResult;
            if (task.provider === "runway") {
              submitResult = await submitRunwayTask(
                task.prompt ?? "",
                task.referenceImageUrl ?? undefined,
                (task.params as Record<string, unknown>) ?? undefined
              );
            } else if (task.provider === "kling") {
              submitResult = await submitKlingTask(
                task.prompt ?? "",
                task.referenceImageUrl ?? undefined,
                (task.params as Record<string, unknown>) ?? undefined
              );
            } else {
              submitResult = await submitMockTask();
            }

            await updateVideoTask(task.id, {
              status: "processing",
              externalTaskId: submitResult.externalTaskId,
            });
            continue;
          }

          // Poll status
          if (!task.externalTaskId) continue;

          if (task.provider === "runway") {
            result = await pollRunwayTask(task.externalTaskId);
          } else if (task.provider === "kling") {
            result = await pollKlingTask(task.externalTaskId);
          } else {
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
