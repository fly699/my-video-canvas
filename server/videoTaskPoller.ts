import type { Server as SocketIOServer } from "socket.io";
import { getPendingVideoTasks, updateVideoTask, completeVideoTaskIfProcessing, claimVideoTaskForSubmit, recordGeneratedAsset } from "./db";
import { isPoyoVideoProvider, submitPoyoVideo, checkPoyoVideoStatus } from "./_core/poyoVideo";
import { isHiggsfieldVideoProvider, submitHiggsfieldVideo, checkHiggsfieldVideoStatus } from "./_core/higgsfield";
import { isKieVideoProvider, submitKieVideo, checkKieVideoStatus } from "./_core/kieVideo";
import { isJimengVideoProvider, submitJimengVideo, checkJimengVideoStatus } from "./_core/jimengCli";
import { decryptKieKey } from "./_core/kieCrypto";
import { persistVideoOrFallback, persistVideosOrFallback } from "./_core/persistVideo";
import { auditVideoTaskResult } from "./_core/auditLog";


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
  // A `processing` task with no externalTaskId means submit's DB write never
  // landed (crash / transient failure mid-submit) — it can NEVER complete and
  // would otherwise occupy a getPendingVideoTasks slot forever (and, once enough
  // accumulate past the 200 cap, starve fresh pending tasks). Reclaim it as failed
  // after a grace period far beyond the microsecond claim→save window so we never
  // race a normal in-progress submit.
  const STUCK_TASK_MS = 10 * 60_000; // 10 minutes
  const pollErrorCounts = new Map<number, number>();
  let running = false; // reentrancy guard: a slow cycle must not overlap the next

  const poll = async () => {
    if (running) return; // previous cycle (many tasks / video re-hosting) still in flight
    running = true;
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
                // Multi-reference images/videos/audios are stashed in params._reference*Urls
                // by videoTasks.create (the table has no dedicated columns).
                const tp = (task.params as { _referenceImageUrls?: unknown; _referenceVideoUrls?: unknown; _referenceAudioUrls?: unknown; _refMode?: unknown } | null);
                const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : undefined);
                submitResult = await submitPoyoVideo({
                  provider: task.provider,
                  prompt: task.prompt ?? "",
                  negativePrompt: task.negativePrompt ?? undefined,
                  referenceImageUrl: task.referenceImageUrl ?? undefined,
                  referenceImageUrls: arr(tp?._referenceImageUrls),
                  referenceVideoUrls: arr(tp?._referenceVideoUrls),
                  referenceAudioUrls: arr(tp?._referenceAudioUrls),
                  referenceMode: tp?._refMode === "reference" ? "reference" : undefined,
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
              } else if (isKieVideoProvider(task.provider)) {
                // kie key was stashed encrypted by videoTasks.create (the poller
                // has no user context / env key to fall back on).
                const enc = (task.params as { _kieKeyEnc?: string } | null)?._kieKeyEnc;
                if (!enc) throw new Error("kie 视频任务缺少密钥，无法提交");
                const tp = task.params as { _referenceImageUrls?: unknown; _referenceVideoUrls?: unknown; _referenceAudioUrls?: unknown } | null;
                const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : undefined);
                const refs = arr(tp?._referenceImageUrls) ?? (task.referenceImageUrl ? [task.referenceImageUrl] : undefined);
                submitResult = await submitKieVideo({
                  provider: task.provider,
                  prompt: task.prompt ?? "",
                  apiKey: decryptKieKey(enc),
                  referenceImageUrls: refs,
                  referenceVideoUrls: arr(tp?._referenceVideoUrls),
                  referenceAudioUrls: arr(tp?._referenceAudioUrls),
                  negativePrompt: task.negativePrompt ?? undefined,
                  params: (task.params as Record<string, unknown>) ?? undefined,
                });
              } else if (isJimengVideoProvider(task.provider)) {
                // #328 即梦 CLI：无云端 key；多参考素材从 params 暂存字段取回（同 poyo/kie）。
                const tp = task.params as { _referenceImageUrls?: unknown; _referenceVideoUrls?: unknown; _referenceAudioUrls?: unknown } | null;
                const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : undefined);
                submitResult = await submitJimengVideo({
                  provider: task.provider,
                  prompt: task.prompt ?? "",
                  referenceImageUrl: task.referenceImageUrl ?? undefined,
                  referenceImageUrls: arr(tp?._referenceImageUrls),
                  referenceVideoUrls: arr(tp?._referenceVideoUrls),
                  referenceAudioUrls: arr(tp?._referenceAudioUrls),
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
              auditVideoTaskResult(task, false, `[CHARGED?] 提交失败: ${msg.slice(0, 200)}`);
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
          if (!task.externalTaskId) {
            // Reclaim a permanently-stuck task (submit DB write never landed) so
            // it stops occupying a poll slot. Grace period guards the normal
            // claim→save window. (See STUCK_TASK_MS.)
            if (Date.now() - task.createdAt.getTime() > STUCK_TASK_MS) {
              await updateVideoTask(task.id, {
                status: "failed",
                errorMessage: "提交未完成（处理超时，已回收），请重试",
              }).catch(() => { /* best-effort */ });
              auditVideoTaskResult(task, false, "stuck 'processing' without externalTaskId — reclaimed");
              pollErrorCounts.delete(task.id);
            }
            continue;
          }

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
          } else if (isKieVideoProvider(task.provider)) {
            // kie status check — needs the per-task encrypted key (no env key).
            const enc = (task.params as { _kieKeyEnc?: string } | null)?._kieKeyEnc;
            if (!enc) {
              result = { status: "failed", errorMessage: "kie 视频任务缺少密钥，无法查询状态" };
            } else {
              const upstream = await checkKieVideoStatus(task.provider, task.externalTaskId, decryptKieKey(enc));
              if (upstream.status === "finished") {
                const urls = upstream.resultVideoUrls ?? [];
                if (urls.length > 0) {
                  // kie media expires in 14 days — re-host to our storage.
                  const persistedList = await persistVideosOrFallback(urls, task.provider);
                  result = { status: "succeeded", resultVideoUrl: persistedList.join("\n") };
                } else {
                  result = { status: "failed", errorMessage: "[CHARGED] 视频已在 kie 生成完成，但本系统未识别 URL（积分已扣，请勿重试）" };
                }
              } else if (upstream.status === "failed") {
                result = { status: "failed", errorMessage: upstream.errorMessage ?? "生成失败" };
              } else {
                result = { status: "processing" };
              }
            }
          } else if (isJimengVideoProvider(task.provider)) {
            // #328/#333 即梦 CLI：query_result --download_dir 下载本地视频文件，
            // checkJimengVideoStatus 内已上传到本项目存储并返回我方 URL，无需再转存。
            const upstream = await checkJimengVideoStatus(task.externalTaskId);
            if (upstream.status === "finished") {
              const urls = upstream.resultVideoUrls ?? (upstream.resultVideoUrl ? [upstream.resultVideoUrl] : []);
              if (urls.length > 0) {
                if (upstream.creditCount != null) console.log(`[jimeng] task ${task.id} 消耗即梦积分 ${upstream.creditCount}`);
                result = { status: "succeeded", resultVideoUrl: urls.join("\n") };
              } else {
                result = { status: "failed", errorMessage: "[CHARGED] 视频已在即梦生成完成，但下载/转存失败（积分已扣，请勿重试；可用 dreamina query_result --download_dir 手动取回）" };
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
            // CAS：仅首个把 processing→终态的调用方 record/audit，避免与客户端 poll 双写重复素材/审计。
            const won = await completeVideoTaskIfProcessing(task.id, {
              status: result.status,
              resultVideoUrl: result.resultVideoUrl,
              errorMessage: result.errorMessage,
            });
            if (won) {
              auditVideoTaskResult(task, result.status === "succeeded", result.errorMessage);

              // Index succeeded videos into the unified media library.
              if (result.status === "succeeded" && result.resultVideoUrl) {
                const model = (task.params as { model?: string } | null)?.model ?? task.provider;
                for (const u of result.resultVideoUrl.split("\n").filter(Boolean)) {
                  await recordGeneratedAsset({ userId: task.userId, projectId: task.projectId, nodeId: task.nodeId, type: "video", source: "generated", provider: task.provider, model, url: u, name: task.provider });
                }
              }
            }

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
            auditVideoTaskResult(task, false, err instanceof Error ? err.message : "轮询失败次数过多");
          } else {
            pollErrorCounts.set(task.id, errCount);
            console.error(`[VideoPoller] Task ${task.id} transient error (attempt ${errCount}/${MAX_TRANSIENT_ERRORS}):`, err);
          }
        }
      }
    } catch (err) {
      console.error("[VideoPoller] Poll cycle error:", err);
    } finally {
      running = false;
    }
  };

  // Start polling
  setInterval(poll, POLL_INTERVAL);
  console.log("[VideoPoller] Started, interval:", POLL_INTERVAL, "ms");
}
