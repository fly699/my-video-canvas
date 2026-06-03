import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectsByUser,
  getProjectsSharedWithUser,
  getProjectById,
  getProjectAccess,
  createProject,
  updateProject,
  setProjectThumbnail,
  deleteProject,
  deleteVideoTask,
  getNodesByProject,
  upsertNode,
  deleteNode,
  batchUpsertNodes,
  getEdgesByProject,
  upsertEdge,
  deleteEdge,
  getAssetsByUser,
  getAssetSummary,
  createAsset,
  recordGeneratedAsset,
  deleteAsset,
  getVideoTasksByProject,
  createVideoTask,
  updateVideoTask,
  claimVideoTaskForSubmit,
  getVideoTask,
  findInFlightVideoTask,
  getChatMessages,
  addChatMessage,
  addChatMessagePair,
  clearChatMessages,
} from "../db";
import { storagePut, resolveToAbsoluteUrl, canBrowserReachStorageDirectly, storageBackend, assertObjectStorageWritable, isOwnStorageUrl, toInternalStoragePath, storagePresignPut, isStorageConfigured, finalizeStorageKey } from "../storage";
import { signUploadToken } from "../_core/uploadToken";
import { getCachedStorageSettings } from "../_core/storageConfig";
import { invokeLLM, extractTextContent } from "../_core/llm";
import { generateImage } from "../_core/imageGeneration";
import { generateComfyImage, generateComfyVideo, fetchComfyModels, analyzeWorkflow, executeCustomWorkflow, uploadImageForWorkflow, interruptComfy, emptyModelList } from "../_core/comfyui";
import type { ComfyModelList } from "../_core/comfyui";
import { ENV } from "../_core/env";
import { isPoyoVideoProvider, submitPoyoVideo, checkPoyoVideoStatus } from "../_core/poyoVideo";
import { isHiggsfieldVideoProvider, submitHiggsfieldVideo, checkHiggsfieldVideoStatus } from "../_core/higgsfield";
import { persistVideoOrFallback, persistVideosOrFallback } from "../_core/persistVideo";
import { submitAndPollPoyoMusic, type PoyoMusicModel } from "../_core/poyoAudio";
import { submitAndPollPoyoTTS } from "../_core/poyoAudio";
import { synthesizeOpenAITTS, type OpenAITTSModel } from "../_core/openaiTTS";
import { trimVideo, getVideoDuration, mergeVideos, burnSubtitles, generateSRT, overlayVideo, assertSafeUrl, burnAssSubtitles, smartCutVideo } from "../_core/videoEditor";
import { transcribeAudio } from "../_core/voiceTranscription";
import { VIDEO_PROVIDERS, IMAGE_GEN_MODELS } from "../../shared/types";
import type { SubtitleEntry } from "../../shared/types";
import { assertWhitelisted, assertComfyuiAllowed, assertComfyuiCloudAllowed, isComfyuiCloudAllowed } from "../_core/whitelist";
import { writeAuditLog, truncate } from "../_core/auditLog";
import { dedupe } from "../_core/idempotency";
import { assertProjectAccess, assertProjectOwner } from "../_core/permissions";

/**
 * Resolve a video task and verify the caller has editor+ access to its
 * project. Replaces the old "task.userId === caller" check, which broke
 * once any editor (not just the project owner) could create tasks —
 * tasks would become orphaned the moment the creator was removed or
 * the owner tried to poll/cancel.
 */
async function assertTaskAccess(taskId: number, userId: number) {
  const task = await getVideoTask(taskId);
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
  await assertProjectAccess(task.projectId, userId, "editor");
  return task;
}

function guardUrl(url: string): void {
  // 自有存储合法，豁免 SSRF：① 自身 /manus-storage 代理路径（含绝对同源 URL，
  // 如 https://172.16.0.114:3000/manus-storage/…）；② 直连 MinIO/S3 主机（常在内网）。
  if (toInternalStoragePath(url) || isOwnStorageUrl(url)) return;
  try { assertSafeUrl(url); } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不允许访问私有/本地主机" });
  }
}

// ── Projects ──────────────────────────────────────────────────────────────────

// Recursively collect image URLs from a project's node data so a card cover can
// be auto-filled from any picture in the project. Prefers stable /manus-storage
// paths (they don't expire) over upstream temp URLs.
const COVER_IMG_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)(\?|#|$)/i;
const COVER_IMG_KEY = /(image|img|thumb|cover|poster|frame|photo|avatar|picture)/i;
function isCoverImageUrl(key: string, v: string): boolean {
  if (v.startsWith("data:image/")) return v.length < 600_000; // skip huge base64 blobs
  if (v.startsWith("/manus-storage/")) return COVER_IMG_EXT.test(v) || COVER_IMG_KEY.test(key);
  if (/^https?:\/\//i.test(v)) return COVER_IMG_EXT.test(v) || COVER_IMG_KEY.test(key);
  return false;
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function collectNodeImageUrls(nodes: Array<{ data?: unknown }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (obj: unknown, key: string) => {
    if (typeof obj === "string") {
      if (isCoverImageUrl(key, obj) && !seen.has(obj)) { seen.add(obj); out.push(obj); }
    } else if (Array.isArray(obj)) {
      for (const v of obj) walk(v, key);
    } else if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) walk(v, k);
    }
  };
  for (const n of nodes) walk(n.data, "");
  return out;
}

export const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const [owned, shared] = await Promise.all([
      getProjectsByUser(ctx.user.id),
      getProjectsSharedWithUser(ctx.user.id),
    ]);
    return { owned, shared };
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const access = await getProjectAccess(input.id, ctx.user.id);
      if (!access) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...access.project, role: access.role, source: access.source };
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(255), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await createProject({ userId: ctx.user.id, name: input.name, description: input.description });
      if (!project) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create project" });
      return project;
    }),

  // Save As: duplicate a project (nodes + edges + viewport + thumbnail) into a new
  // one owned by the current user. Node ids are a global primary key, so every
  // node gets a fresh id and edges are remapped onto the new ids.
  saveAs: protectedProcedure
    .input(z.object({ sourceProjectId: z.number(), name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.sourceProjectId, ctx.user.id, "viewer");
      const src = access.project;
      const newProject = await createProject({ userId: ctx.user.id, name: input.name, description: src.description ?? undefined });
      if (!newProject) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "另存为失败：无法创建项目" });
      if (src.viewportState != null || src.thumbnail != null) {
        await updateProject(newProject.id, ctx.user.id, { viewportState: src.viewportState, thumbnail: src.thumbnail });
      }
      const nodes = await getNodesByProject(input.sourceProjectId);
      const idMap = new Map<string, string>();
      for (const n of nodes) idMap.set(n.id, nanoid());
      if (nodes.length > 0) {
        await batchUpsertNodes(nodes.map((n) => {
          // `data` (json column) may come back as a parsed object OR a raw JSON
          // string depending on the driver — parse strings so re-inserting into the
          // json column doesn't double-encode the payload.
          let data: Record<string, unknown> | null = null;
          if (typeof n.data === "string") { try { data = JSON.parse(n.data); } catch { data = null; } }
          else if (n.data && typeof n.data === "object") { data = n.data as Record<string, unknown>; }
          return {
            id: idMap.get(n.id)!, projectId: newProject.id,
            type: n.type, title: n.title, data,
            posX: n.posX, posY: n.posY, width: n.width, height: n.height, zIndex: n.zIndex,
          };
        }));
      }
      const edges = await getEdgesByProject(input.sourceProjectId);
      for (const e of edges) {
        const s = idMap.get(e.sourceNodeId), t = idMap.get(e.targetNodeId);
        if (!s || !t) continue; // skip edges to missing nodes
        await upsertEdge({
          id: nanoid(), projectId: newProject.id,
          sourceNodeId: s, targetNodeId: t,
          sourcePort: e.sourcePort, targetPort: e.targetPort, label: e.label,
        });
      }
      return newProject;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        thumbnail: z.string().optional(),
        viewportState: z
          .object({ x: z.number(), y: z.number(), zoom: z.number() })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // Editor+ may rename / change thumbnail / save viewport
      const access = await assertProjectAccess(id, ctx.user.id, "editor");
      // updateProject uses (id, userId) WHERE clause on owner; route through raw helper
      await updateProject(id, access.project.userId, data as Parameters<typeof updateProject>[2]);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Only the owner can delete the project itself
      await assertProjectOwner(input.id, ctx.user.id);
      await deleteProject(input.id, ctx.user.id);
      return { success: true };
    }),

  // Auto-fill / refresh a project card cover from images in its nodes. With 4+
  // usable images, returns 4 (a 2×2 grid on the card); otherwise a single image.
  // Prefers stable /manus-storage paths (they don't expire). Persisted as a JSON
  // array in `thumbnail` WITHOUT bumping updatedAt — a cover refresh isn't an edit.
  // Editors+ persist; viewers get a computed cover that isn't saved.
  pickCover: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.id, ctx.user.id, "viewer");
      const nodes = await getNodesByProject(input.id);
      const urls = collectNodeImageUrls(nodes);
      if (urls.length === 0) return { covers: [] as string[] };
      // Stable paths first, then the rest — shuffled within each tier so refresh
      // cycles through the available images.
      const stable = shuffle(urls.filter((u) => u.startsWith("/manus-storage/")));
      const rest = shuffle(urls.filter((u) => !u.startsWith("/manus-storage/")));
      const ordered = [...stable, ...rest];
      const covers = ordered.slice(0, ordered.length >= 4 ? 4 : 1);
      if (access.role !== "viewer") {
        await setProjectThumbnail(input.id, access.project.userId, JSON.stringify(covers));
      }
      return { covers };
    }),
});

// ── Nodes ─────────────────────────────────────────────────────────────────────

const nodeDataSchema = z.record(z.string(), z.unknown());

export const nodesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
      return getNodesByProject(input.projectId);
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.number(),
        type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note", "audio", "post_process", "group", "character", "clip", "merge", "subtitle", "overlay", "subtitle_motion", "smart_cut", "pose_control", "voice_clone", "lip_sync", "avatar", "comfyui_image", "comfyui_video", "comfyui_workflow"]),
        title: z.string().optional(),
        data: nodeDataSchema,
        posX: z.number(),
        posY: z.number(),
        width: z.number().default(320),
        height: z.number().default(200),
        zIndex: z.number().default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const id = input.id ?? nanoid();
      const { id: _id, ...rest } = { ...input, id };
      await upsertNode({ ...rest, id, data: input.data as Record<string, unknown> });
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const deleted = await deleteNode(input.id, input.projectId);
      return { success: true, deleted };
    }),

  batchUpsert: protectedProcedure
    .input(
      z.array(
        z.object({
          id: z.string(),
          projectId: z.number(),
          type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note", "audio", "post_process", "group", "character", "clip", "merge", "subtitle", "overlay", "subtitle_motion", "smart_cut", "pose_control", "voice_clone", "lip_sync", "avatar", "comfyui_image", "comfyui_video", "comfyui_workflow"]),
          title: z.string().optional().nullable(),
          data: nodeDataSchema,
          posX: z.number(),
          posY: z.number(),
          width: z.number(),
          height: z.number(),
          zIndex: z.number(),
        })
      ).max(2000)
    )
    .mutation(async ({ ctx, input }) => {
      const projectIds = Array.from(new Set(input.map((n) => n.projectId)));
      await Promise.all(projectIds.map((pid) => assertProjectAccess(pid, ctx.user.id, "editor")));
      await batchUpsertNodes(input.map((n) => ({ ...n, data: n.data as Record<string, unknown> })));
      return { success: true };
    }),
});

// ── Edges ─────────────────────────────────────────────────────────────────────

export const edgesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
      return getEdgesByProject(input.projectId);
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.number(),
        sourceNodeId: z.string(),
        targetNodeId: z.string(),
        sourcePort: z.string().optional(),
        targetPort: z.string().optional(),
        label: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const id = input.id ?? nanoid();
      await upsertEdge({ ...input, id });
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await deleteEdge(input.id, input.projectId);
      return { success: true };
    }),
});

// ── Assets ────────────────────────────────────────────────────────────────────

export const assetsRouter = router({
  list: protectedProcedure
    .input(z.object({
      projectId: z.number().optional(),
      allProjects: z.boolean().optional(),
      type: z.enum(["image", "video", "audio", "other"]).optional(),
      source: z.enum(["upload", "generated", "external"]).optional(),
      model: z.string().max(128).optional(),
      q: z.string().max(128).optional(),
    }).optional())
    .query(({ ctx, input }) => getAssetsByUser(ctx.user.id, {
      projectId: input?.allProjects ? undefined : input?.projectId,
      type: input?.type,
      source: input?.source,
      model: input?.model,
      q: input?.q?.trim() || undefined,
    })),

  // Lightweight summary for the Home 素材库 entry card (count + a few cover URLs).
  summary: protectedProcedure
    .query(({ ctx }) => getAssetSummary(ctx.user.id)),

  // ── Streamed / presigned upload (large files; no base64 ~15MB cap) ──────────
  // Mirror of chat.createUploadUrl: hand the browser a direct upload URL so big
  // files don't go base64 through tRPC. Then confirmUpload indexes the asset.
  createUploadUrl: protectedProcedure
    .input(z.object({
      name: z.string().max(255),
      mimeType: z.string().max(128),
      size: z.number().int().min(1),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // NOTE: no assertWhitelisted here — the whitelist gates THIRD-PARTY AI MODEL
      // usage (cost control), not uploading your own files. Auth + project-ownership
      // below are the only gates for asset ingestion.
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const MAX_BYTES = 5000 * 1024 * 1024; // 5000MB streamed ceiling (not a memory limit — streamed direct, just a runaway/abuse guard)
      if (input.size > MAX_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "文件超过 5000MB 上限" });
      const safeName = input.name.replace(/[^a-zA-Z0-9._\-一-龥]/g, "_").slice(0, 120) || "file";
      const relKey = `u/${ctx.user.id}/uploads/${nanoid()}-${safeName}`;
      // Storage configured but browser can't reach it (internal MinIO, no public
      // endpoint) → stream THROUGH this server via the upload proxy (HMAC token).
      if (isStorageConfigured() && !canBrowserReachStorageDirectly()) {
        await assertObjectStorageWritable();
        const key = finalizeStorageKey(relKey);
        const token = signUploadToken({
          key, conversationId: 0, userId: ctx.user.id,
          maxBytes: MAX_BYTES, contentType: input.mimeType, exp: Date.now() + 60 * 60 * 1000,
        });
        return { mode: "proxy" as const, uploadUrl: `/manus-storage-upload?token=${encodeURIComponent(token)}`, key, url: `/manus-storage/${key}` };
      }
      // No object storage → caller falls back to base64 (assets.upload).
      if (!isStorageConfigured()) return { mode: "base64" as const };
      // Browser-reachable storage (Forge / S3 public) → presigned PUT direct.
      await assertObjectStorageWritable();
      const { uploadUrl, key, url } = await storagePresignPut(relKey, input.mimeType);
      return { mode: "presigned" as const, uploadUrl, key, url };
    }),

  // Index an asset AFTER a successful proxy/presigned PUT. Validates the key
  // belongs to this user's prefix so a client can't claim arbitrary objects.
  confirmUpload: protectedProcedure
    .input(z.object({
      key: z.string().max(512),
      url: z.string().max(1024),
      name: z.string().max(255),
      type: z.enum(["image", "video", "audio", "other"]),
      mimeType: z.string().max(128),
      size: z.number().int().min(1),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const prefix = `u/${ctx.user.id}/`;
      if (!input.key.startsWith(prefix)) throw new TRPCError({ code: "FORBIDDEN", message: "非法的存储键" });
      if (input.url !== `/manus-storage/${input.key}`) throw new TRPCError({ code: "BAD_REQUEST", message: "URL 与存储键不一致" });
      const asset = await createAsset({
        userId: ctx.user.id, projectId: input.projectId ?? null, name: input.name,
        type: input.type, mimeType: input.mimeType, size: input.size, storageKey: input.key, url: input.url,
      });
      if (!asset) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "保存素材失败" });
      return asset;
    }),

  upload: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.enum(["image", "video", "audio", "other"]),
        mimeType: z.string(),
        size: z.number(),
        base64: z.string().max(20_000_000), // ~15 MB file limit
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // No assertWhitelisted: uploading your own files is not third-party AI usage.
      // When projectId is supplied, the caller must have editor+ access on
      // that project — otherwise editors could attach assets to arbitrary
      // projects they don't belong to (IDOR).
      if (input.projectId != null) {
        await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      }
      const buffer = Buffer.from(input.base64, "base64");
      // Per-user "专有仓库" prefix (u/{userId}/...); old assets/{userId}/ keys still resolve.
      const key = `u/${ctx.user.id}/uploads/${nanoid()}-${input.name}`;
      // 「仅允许 MinIO/S3」开关：未配 MinIO/S3 时拒绝写入，不回退 Forge 存储。
      await assertObjectStorageWritable();
      const { url } = await storagePut(key, buffer, input.mimeType);
      const asset = await createAsset({
        userId: ctx.user.id,
        projectId: input.projectId ?? null,
        name: input.name,
        type: input.type,
        mimeType: input.mimeType,
        size: input.size,
        storageKey: key,
        url,
      });
      if (!asset) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save asset record" });
      return asset;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteAsset(input.id, ctx.user.id);
      return { success: true };
    }),

  // Bulk soft-delete (multi-select in the library). Each is user-scoped, so a
  // caller can only delete their own assets even if foreign ids are mixed in.
  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      for (const id of input.ids) await deleteAsset(id, ctx.user.id);
      return { success: true, count: input.ids.length };
    }),

  // External import: server-side download a remote URL (size-capped, SSRF-guarded),
  // re-host into the user's 专有仓库, and index it as source="external".
  importFromUrl: protectedProcedure
    .input(z.object({ url: z.string().url(), projectId: z.number().optional(), name: z.string().max(255).optional() }))
    .mutation(async ({ ctx, input }) => {
      // No assertWhitelisted: importing a link into your own library is not
      // third-party AI usage. SSRF guard + project ownership still apply.
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.url); // SSRF: blocks private/loopback hosts
      const MAX_BYTES = 50 * 1024 * 1024;
      let res: Response;
      try {
        res = await fetch(input.url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "无法下载该链接：" + (err instanceof Error ? err.message : String(err)) });
      }
      if (!res.ok || !res.body) throw new TRPCError({ code: "BAD_REQUEST", message: `下载失败 (HTTP ${res.status})` });
      // Stream with a hard size cap.
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } throw new TRPCError({ code: "BAD_REQUEST", message: "文件过大（上限 50MB）" }); }
          chunks.push(value);
        }
      }
      const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
      const type = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("image/") ? "image" : "other";
      const name = input.name?.trim() || decodeURIComponent(input.url.split("/").pop()?.split("?")[0] || "") || "外部文件";
      await assertObjectStorageWritable();
      const { url, key } = await storagePut(`u/${ctx.user.id}/external/${nanoid()}-${name}`, buffer, mimeType);
      const asset = await createAsset({
        userId: ctx.user.id, projectId: input.projectId ?? null, name, type,
        mimeType, size: buffer.length, storageKey: key, url, source: "external", provider: "manus",
      });
      writeAuditLog({ ctx, action: "asset_import_url", detail: { url: truncate(input.url), type, size: buffer.length } });
      if (!asset) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "保存素材失败" });
      return asset;
    }),
});

// ── Video Tasks ───────────────────────────────────────────────────────────────

const pollLastCheck = new Map<string, number>();
const POLL_THROTTLE_MS = 4_000;

export const videoTasksRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
      return getVideoTasksByProject(input.projectId);
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        nodeId: z.string(),
        provider: z.enum([...VIDEO_PROVIDERS] as [string, ...string[]]),
        prompt: z.string().max(4000),
        negativePrompt: z.string().max(1000).optional(),
        referenceImageUrl: z.string().optional(),
        // Multi-reference images (首尾帧 / reference / elements). [0] mirrors
        // referenceImageUrl; the backend maps the list per-model.
        referenceImageUrls: z.array(z.string()).max(9).optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      // Validate every reference URL (single + multi) the same way.
      const validateRef = (u: string) => {
        if (u.match(/^https?:\/\//)) guardUrl(u);
        else if (!u.startsWith("/")) throw new TRPCError({ code: "BAD_REQUEST", message: "不支持的 URL 协议，仅允许 http/https 或相对路径" });
      };
      if (input.referenceImageUrl) validateRef(input.referenceImageUrl);
      for (const u of input.referenceImageUrls ?? []) if (u?.trim()) validateRef(u.trim());
      // Coalesced reference list: prefer the multi-image array, fall back to the
      // single field. Drives both the inline submit and the persisted params.
      const refList = (input.referenceImageUrls?.length ? input.referenceImageUrls : (input.referenceImageUrl ? [input.referenceImageUrl] : []))
        .map((u) => u?.trim()).filter((u): u is string => Boolean(u));
      // Higgsfield DoP is strictly image-to-video — fail fast at the API edge
      // so the user sees an immediate "需要参考图" error instead of waiting
      // for the background poller to retry 10 times (~100s) before failing.
      if (input.provider.startsWith("hf_dop_") && refList.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Higgsfield DoP 视频模型必须提供参考图（image-to-video 模式）。请连接一个图像节点或填写 referenceImageUrl。",
        });
      }
      // Persist the multi-image list inside params (the video_tasks table has no
      // dedicated column) so the background poller can re-submit with all images.
      // The `_referenceImageUrls` key is filtered out of the upstream payload by
      // VIDEO_PARAM_KEYS, so it never poisons the provider request.
      const mergedParams: Record<string, unknown> | undefined = refList.length > 1
        ? { ...((input.params as Record<string, unknown> | undefined) ?? {}), _referenceImageUrls: refList }
        : (input.params as Record<string, unknown> | undefined);

      // Idempotency: if this node already has a pending/processing task, return it
      // instead of creating a new one. Prevents double-charges when the client is
      // bypassed (devtools, scripts, retried requests) — the in-app flow already
      // guards against this client-side, but server enforcement is the last line
      // of defence for paid external API calls.
      const existing = await findInFlightVideoTask(input.projectId, input.nodeId);
      if (existing) {
        return existing;
      }

      // Create DB record first so the task is tracked even if provider submission fails
      const task = await createVideoTask({
        userId: ctx.user.id,
        projectId: input.projectId,
        nodeId: input.nodeId,
        provider: input.provider,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        referenceImageUrl: refList[0] ?? input.referenceImageUrl,
        params: mergedParams,
        status: "pending",
      });
      if (!task) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create video task" });

      // ── Submit to external provider ──────────────────────────────────────────
      // CRITICAL: claim the task atomically (pending → processing) BEFORE the
      // upstream call. This prevents a credit-burn loop that occurred in
      // production: if the upstream submit succeeded but a transient DB write
      // failure left the row in `pending`, the background poller would see it
      // every 10s and submit again, charging the user repeatedly until the
      // pollErrorCounts ceiling tripped (and even then 6+ duplicate paid jobs
      // had already been created upstream).
      //
      // After this claim:
      // - If we crash/fail before saving externalTaskId, the task is `processing`
      //   without an externalTaskId. The poller's `if (!externalTaskId) continue`
      //   guard skips it forever — credits leak ONCE but no duplicate burn.
      // - If submit itself throws, we explicitly mark `failed` so the leak is
      //   visible to the user and the poller stops touching it.
      let externalTaskId: string | undefined;
      let submitFailed = false;
      const claimed = await claimVideoTaskForSubmit(task.id);
      if (!claimed) {
        // Effectively unreachable for a freshly-created row (poll interval is
        // 10s, the row is microseconds old), but if a parallel worker did
        // claim it, return the task as processing — the winner is responsible
        // for the upstream submit and the client should poll for its result.
        console.warn(`[videoTasks.create] task ${task.id} already claimed by another worker; deferring to it`);
        return { ...task, status: "processing" as const };
      } else {
        try {
          if (isPoyoVideoProvider(input.provider)) {
            const result = await submitPoyoVideo({
              provider: input.provider,
              prompt: input.prompt,
              negativePrompt: input.negativePrompt,
              referenceImageUrl: refList[0] ?? input.referenceImageUrl,
              referenceImageUrls: refList.length > 1 ? refList : undefined,
              params: input.params as Record<string, unknown>,
            });
            externalTaskId = result.externalTaskId;
          } else if (isHiggsfieldVideoProvider(input.provider)) {
            const result = await submitHiggsfieldVideo({
              provider: input.provider,
              prompt: input.prompt,
              negativePrompt: input.negativePrompt,
              referenceImageUrl: input.referenceImageUrl,
              params: input.params as Record<string, unknown>,
            });
            externalTaskId = result.externalTaskId;
          }
          if (externalTaskId) {
            await updateVideoTask(task.id, { externalTaskId });
          }
        } catch (err) {
          // Upstream submit threw before we got an external task ID. Mark
          // failed so the poller doesn't retry — even though a transient
          // network error here could mean upstream actually received the
          // request, retrying without confirmation risks double-billing.
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[videoTasks.create] submit failed for task ${task.id}: ${msg}`);
          submitFailed = true;
          // The submit threw — could be a pre-API error (auth/validation) OR
          // a post-API network timeout (upstream received the request and is
          // already running). We can't distinguish; [CHARGED?] tells the UI
          // to require explicit confirmation before any retry to avoid
          // double-billing in the latter case.
          await updateVideoTask(task.id, { status: "failed", errorMessage: `[CHARGED?] 提交失败: ${msg.slice(0, 200)}` }).catch(() => {});
        }
      }

      // Always audit the generation attempt so failed/retried submissions are visible
      writeAuditLog({
        ctx,
        action: "video_gen",
        detail: {
          provider: input.provider,
          prompt: truncate(input.prompt),
          taskId: task.id,
          nodeId: input.nodeId,
          submitted: !!externalTaskId,
        },
      });

      if (externalTaskId) {
        return { ...task, status: "processing" as const, externalTaskId };
      }
      if (submitFailed) {
        return { ...task, status: "failed" as const };
      }
      // Claim succeeded but no provider matched (unknown provider — shouldn't
      // happen given the enum validator) and no submit attempt was made.
      // Task is now `processing` with no externalTaskId; poller will skip it.
      return { ...task, status: "processing" as const };
    }),

  poll: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const task = await getVideoTask(input.id);
      if (!task) return null;
      // Project-level access (editor+). Previously hard-checked task.userId,
      // which broke once any editor (not just owner) could create tasks —
      // the owner could see the task in the UI but couldn't poll it.
      await assertProjectAccess(task.projectId, ctx.user.id, "editor");

      // For poyo.ai tasks still processing, sync status from upstream (throttled)
      if (task.status === "processing" && task.externalTaskId && isPoyoVideoProvider(task.provider)) {
        const now = Date.now();
        const lastCheck = pollLastCheck.get(task.externalTaskId) ?? 0;
        if (now - lastCheck >= POLL_THROTTLE_MS) {
          pollLastCheck.set(task.externalTaskId, now);
          try {
            const upstream = await checkPoyoVideoStatus(task.externalTaskId);
            if (upstream.status === "finished") {
              pollLastCheck.delete(task.externalTaskId);
              const urls = upstream.resultVideoUrls ?? (upstream.resultVideoUrl ? [upstream.resultVideoUrl] : []);
              if (urls.length === 0) {
                // Credits already spent upstream. The [CHARGED] prefix lets
                // the UI block one-click resubmit so the user isn't tricked
                // into re-paying for our parser miss.
                const update = { status: "failed" as const, errorMessage: "[CHARGED] 视频已在上游生成完成，但本系统未识别 URL（积分已扣，请勿重试；联系管理员查看 Poyo 控制台）" };
                await updateVideoTask(task.id, update);
                return { ...task, ...update };
              }
              // CRITICAL: same persistence step as the background poller —
              // without this, client-driven poll wins the race against the
              // background poller and the upstream 24h URL ends up in DB.
              // Multi-shot Wan 2.6 jobs return 3 URLs; persist each and
              // serialize the list as newline-joined text (URLs can't contain
              // \n) so we don't need a schema migration.
              const persistedList = await persistVideosOrFallback(urls, task.provider);
              const persisted = persistedList.join("\n");
              const update = { status: "succeeded" as const, resultVideoUrl: persisted };
              await updateVideoTask(task.id, update);
              for (const u of persistedList) {
                await recordGeneratedAsset({ userId: task.userId, projectId: task.projectId, nodeId: task.nodeId, type: "video", source: "generated", provider: task.provider, model: (task.params as { model?: string } | null)?.model ?? task.provider, url: u, name: task.provider });
              }
              return { ...task, ...update };
            }
            if (upstream.status === "failed") {
              pollLastCheck.delete(task.externalTaskId);
              const update = { status: "failed" as const, errorMessage: upstream.errorMessage ?? "生成失败" };
              await updateVideoTask(task.id, update);
              return { ...task, ...update };
            }
          } catch (err) {
            pollLastCheck.delete(task.externalTaskId);
            console.error(`[poll] Poyo status check failed for task ${task.id} (${task.externalTaskId}):`, err instanceof Error ? err.message : String(err));
          }
        }
      }

      // For Higgsfield tasks still processing, sync status from upstream (throttled)
      if (task.status === "processing" && task.externalTaskId && isHiggsfieldVideoProvider(task.provider)) {
        const now = Date.now();
        const lastCheck = pollLastCheck.get(task.externalTaskId) ?? 0;
        if (now - lastCheck >= POLL_THROTTLE_MS) {
          pollLastCheck.set(task.externalTaskId, now);
          try {
            const upstream = await checkHiggsfieldVideoStatus(task.externalTaskId);
            if (upstream.status === "succeeded" && upstream.resultVideoUrl) {
              pollLastCheck.delete(task.externalTaskId);
              // Same persistence step as background poller (see comment above).
              const persisted = await persistVideoOrFallback(upstream.resultVideoUrl, task.provider);
              const update = { status: "succeeded" as const, resultVideoUrl: persisted };
              await updateVideoTask(task.id, update);
              await recordGeneratedAsset({ userId: task.userId, projectId: task.projectId, nodeId: task.nodeId, type: "video", source: "generated", provider: task.provider, model: (task.params as { model?: string } | null)?.model ?? task.provider, url: persisted, name: task.provider });
              return { ...task, ...update };
            }
            if (upstream.status === "succeeded" && !upstream.resultVideoUrl) {
              pollLastCheck.delete(task.externalTaskId);
              // Credits spent; [CHARGED] blocks UI from one-click resubmit.
              const update = { status: "failed" as const, errorMessage: "[CHARGED] 视频已在 Higgsfield 生成完成，但本系统未识别 URL（积分已扣，请勿重试）" };
              await updateVideoTask(task.id, update);
              return { ...task, ...update };
            }
            if (upstream.status === "failed") {
              pollLastCheck.delete(task.externalTaskId);
              const update = { status: "failed" as const, errorMessage: upstream.errorMessage ?? "生成失败" };
              await updateVideoTask(task.id, update);
              return { ...task, ...update };
            }
          } catch (err) {
            pollLastCheck.delete(task.externalTaskId);
            console.error(`[poll] Higgsfield status check failed for task ${task.id} (${task.externalTaskId}):`, err instanceof Error ? err.message : String(err));
          }
        }
      }

      return task;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pending", "processing", "succeeded", "failed"]),
        resultVideoUrl: z.string().url().optional(),
        errorMessage: z.string().optional(),
        externalTaskId: z.string().optional(),
        progress: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTaskAccess(input.id, ctx.user.id);
      const { id, ...data } = input;
      await updateVideoTask(id, data);
      return { success: true };
    }),

  // Delete a task record so the node can be re-submitted
  reset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertTaskAccess(input.id, ctx.user.id);
      await deleteVideoTask(input.id);
      return { success: true };
    }),
});

// ── AI Chat ───────────────────────────────────────────────────────────────────

export const aiChatRouter = router({
  getMessages: protectedProcedure
    .input(z.object({ nodeId: z.string(), projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Chat history is part of canvas state viewers are allowed to read,
      // even though only editors can append (sendMessage) or clear.
      await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
      return getChatMessages(input.nodeId, input.projectId);
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        projectId: z.number(),
        message: z.string().max(10_000),
        systemPrompt: z.string().max(2_000).optional(),
        contextContent: z.string().max(8_000).optional(),
        model: z.string().optional(),
        // Multimodal attachments. Images keep `url` (already uploaded via upload.uploadImage).
        // Text files include `textContent` to be inlined into the user message.
        attachments: z.array(z.object({
          type: z.enum(["image", "file"]),
          url: z.string().max(2048),
          mimeType: z.string().max(128),
          name: z.string().max(255),
          textContent: z.string().max(50_000).optional(),
        })).max(8).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Gate on whitelist before access check so banned users get a uniform
      // "not whitelisted" error rather than a project FORBIDDEN; this also
      // closes the gap that let an editor invoke the LLM without any
      // platform-side limit (all other AI mutations call assertWhitelisted).
      await assertWhitelisted(ctx);
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      // Allow empty message when there's at least one attachment — image-only prompts are valid.
      if (!input.message.trim() && !(input.attachments?.length ?? 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "消息内容不能为空" });
      }
      const history = await getChatMessages(input.nodeId, input.projectId);
      const systemContent = [
        input.systemPrompt ?? "You are a professional film and content creation assistant. Help with scripts, storyboards, prompts, and creative direction.",
        input.contextContent ? `\n\nContext from canvas:\n${input.contextContent}` : "",
      ]
        .filter(Boolean)
        .join("");

      // Resolve every attachment URL into something the LLM provider can
      // actually fetch:
      //  - blob:  — tab-scoped IndexedDB cache reference, unreachable from
      //            anyone but the originating browser. SKIP.
      //  - data:  — already inline base64; pass through.
      //  - http(s) — absolute, pass through.
      //  - /manus-storage/{key} — internal proxy path. Resolve via Forge
      //                           presign to a short-lived absolute S3 URL.
      // Without this step, dragged-in images silently fail at the model
      // side because OpenAI/Anthropic/Manus get a relative or blob: URL
      // they can't fetch and return "我看不到你的图片" instead of analysis.
      async function imageUrlForLLM(url: string): Promise<string | null> {
        if (!url) return null;
        if (url.startsWith("blob:")) return null;
        if (url.startsWith("data:")) return url;
        if (/^https?:\/\//i.test(url)) return url;
        if (url.startsWith("/manus-storage/")) {
          try { return await resolveToAbsoluteUrl(url); }
          catch (err) {
            console.warn("[aiChat] resolveToAbsoluteUrl failed:", err instanceof Error ? err.message : err);
            return null;
          }
        }
        return null;
      }

      // Compose the current user message: text + optional inline file content +
      // image_url parts. Text files are spliced into the text body; images
      // become structured content parts the model can see.
      const fileBlocks = (input.attachments ?? [])
        .filter((a) => a.type === "file" && a.textContent)
        .map((a) => `\n\n[Attached file: ${a.name}]\n${a.textContent}`)
        .join("");
      const userText = (input.message + fileBlocks).trim() || "请分析附带的内容。";
      const imageAttachments = (input.attachments ?? []).filter((a) => a.type === "image");
      const resolvedImages = await Promise.all(imageAttachments.map((a) => imageUrlForLLM(a.url)));
      const imageParts = resolvedImages
        .filter((u): u is string => !!u)
        .map((url) => ({ type: "image_url" as const, image_url: { url } }));
      const skippedCount = imageAttachments.length - imageParts.length;
      const skipNote = skippedCount > 0
        ? `\n\n[${skippedCount} 张图片因 URL 不可达被跳过 — 请直接粘贴图片或重新上传]`
        : "";

      const userContent = imageParts.length > 0
        ? [{ type: "text" as const, text: userText + skipNote }, ...imageParts]
        : (skippedCount > 0 ? userText + skipNote : userText);

      // Reconstruct historical messages with their original attachments so the
      // model retains visual context across turns. Same URL resolution as
      // above. SKIP data: URLs in history — they bloat each turn by ~1 MB.
      const historyMessages = await Promise.all(history.map(async (m) => {
        const att = (m.attachments as Array<{ type: string; url: string; name?: string }> | null) ?? null;
        if (m.role === "user" && att && att.length > 0) {
          const imgAtts = att.filter((a) => a.type === "image" && !a.url.startsWith("data:"));
          const resolved = await Promise.all(imgAtts.map((a) => imageUrlForLLM(a.url)));
          const imgs = resolved
            .filter((u): u is string => !!u)
            .map((url) => ({ type: "image_url" as const, image_url: { url } }));
          const skippedDataUrlImgs = att.filter((a) => a.type === "image" && a.url.startsWith("data:"));
          const skippedNote = skippedDataUrlImgs.length > 0
            ? `\n\n[Earlier turn included ${skippedDataUrlImgs.length} image attachment(s) not re-sent.]`
            : "";
          return {
            role: "user" as const,
            content: imgs.length > 0
              ? [{ type: "text" as const, text: m.content + skippedNote }, ...imgs]
              : m.content + skippedNote,
          };
        }
        return { role: m.role as "user" | "assistant", content: m.content };
      }));

      const messages = [
        { role: "system" as const, content: systemContent },
        ...historyMessages,
        { role: "user" as const, content: userContent },
      ];

      let assistantContent: string;
      try {
        const response = await invokeLLM({ messages, model: input.model });
        assistantContent = extractTextContent(response) || "（模型返回内容为空）";
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // Persist user message (with attachments) and assistant reply atomically.
      await addChatMessagePair(
        input.nodeId,
        input.projectId,
        input.message,
        assistantContent,
        input.attachments?.length ? input.attachments : undefined,
      );

      return { content: assistantContent };
    }),

  clearMessages: protectedProcedure
    .input(z.object({ nodeId: z.string(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await clearChatMessages(input.nodeId, input.projectId);
      return { success: true };
    }),
});

// ── Image Generation ──────────────────────────────────────────────────────────

export const imageGenRouter = router({
  generate: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        negativePrompt: z.string().optional(),
        referenceImageUrl: z.string().optional(),
        // Multi-angle reference images (first mirrors referenceImageUrl). Edit/
        // unified models read all of these via `image_urls`.
        referenceImageUrls: z.array(z.string()).max(8).optional(),
        style: z.string().optional(),
        model: z.enum(IMAGE_GEN_MODELS).optional(),
        poyoAspectRatio: z.string().optional(),
        poyoQuality: z.enum(["low", "medium", "high"]).optional(),
        // Generic Poyo image params (schema-driven, extended model set)
        imageSize: z.string().max(64).optional(),
        imageResolution: z.enum(["0.5K", "1K", "2K", "3K", "4K"]).optional(),
        imageN: z.number().int().min(1).max(15).optional(),
        imageOutputFormat: z.enum(["png", "jpg", "jpeg", "webp"]).optional(),
        widthAndHeight: z.string().optional(),
        quality: z.enum(["720p", "1080p"]).optional(),
        batchSize: z.union([z.literal(1), z.literal(4)]).optional(),
        seed: z.number().int().optional(),
        enhancePrompt: z.boolean().optional(),
        // Reve specific params
        reveAspectRatio: z.string().optional(),
        // v2 image endpoints (reve / seedream / flux-pro) use coarse K-tier
        // labels rather than px-based 720p/1080p (those are Soul-only).
        reveResolution: z.enum(["1K", "2K", "4K"]).optional(),
        // Flux Pro Kontext extra params
        fluxGuidanceScale: z.number().min(1).max(20).optional(),
        fluxSeed: z.number().int().optional(),
        fluxNumImages: z.number().int().min(1).max(4).optional(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      if (input.projectId != null) {
        await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      }
      // Build the full reference list (primary + extras), de-duplicated and
      // each validated; tolerate http(s) or our own relative storage paths.
      const allRefUrls = Array.from(new Set([
        ...(input.referenceImageUrl ? [input.referenceImageUrl] : []),
        ...(input.referenceImageUrls ?? []),
      ].map((u) => u.trim()).filter(Boolean)));
      for (const u of allRefUrls) {
        if (u.match(/^https?:\/\//)) {
          guardUrl(u);
        } else if (!u.startsWith("/")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不支持的 URL 协议，仅允许 http/https 或相对路径" });
        }
      }
      // Server-side idempotency: collapse concurrent identical submits (e.g. devtools
      // replay, browser retries) into a single external image-gen call & charge.
      return dedupe("imageGen", ctx.user.id, input, async () => {
      const isHfModel = input.model?.startsWith("hf_");

      // For Higgsfield models, keep prompt clean and pass negativePrompt separately.
      // For other models, embed negative prompt as "Avoid: ..." suffix.
      const fullPrompt = isHfModel
        ? [input.style ? `Style: ${input.style}.` : "", input.prompt].filter(Boolean).join(" ")
        : [
            input.style ? `Style: ${input.style}.` : "",
            input.prompt,
            input.negativePrompt ? `Avoid: ${input.negativePrompt}` : "",
          ]
            .filter(Boolean)
            .join(" ");

      const result = await generateImage({
        prompt: fullPrompt,
        model: input.model,
        ...(isHfModel && input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
        ...(allRefUrls.length
          ? { originalImages: allRefUrls.map((url) => ({ url, mimeType: "image/jpeg" })) }
          : {}),
        // All Poyo image models share the generic param channel; the backend
        // spec table (POYO_IMAGE_SPECS) decides which fields each model actually
        // sends. `imageSize` (new ParamDef field) falls back to the legacy
        // `poyoAspectRatio` so old nodes keep working.
        ...(input.model?.startsWith("poyo_") ? {
          size: input.imageSize ?? input.poyoAspectRatio,
          quality: input.poyoQuality,
          resolution: input.imageResolution,
          n: input.imageN,
          outputFormat: input.imageOutputFormat,
        } : {}),
        ...(input.model === "hf_soul_standard" ? {
          widthAndHeight: input.widthAndHeight,
          quality: input.quality,
          batchSize: input.batchSize,
          seed: input.seed,
          enhancePrompt: input.enhancePrompt,
        } : {}),
        // All three v2 image endpoints (reve / seedream / flux-pro) share the
        // same flat schema: { prompt, aspect_ratio, resolution, image_url? }.
        // Resolution was previously only forwarded for hf_reve, leaving
        // seedream/flux-pro to fall back to upstream defaults.
        ...(input.model === "hf_reve" || input.model === "hf_seedream_v4" || input.model === "hf_flux_pro" ? {
          reveAspectRatio: input.reveAspectRatio,
          reveResolution: input.reveResolution,
        } : {}),
      });

      writeAuditLog({
        ctx,
        action: "image_gen",
        detail: {
          model: input.model ?? "default",
          prompt: truncate(input.prompt),
          resultUrl: result.url ?? result.urls?.[0] ?? null,
          resultCount: result.urls?.length ?? (result.url ? 1 : 0),
        },
      });
      {
        const prov = input.model?.startsWith("hf_") ? "higgsfield" : input.model?.startsWith("poyo_") ? "poyo" : "forge";
        for (const u of (result.urls?.length ? result.urls : (result.url ? [result.url] : []))) {
          await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "image", source: "generated", provider: prov, model: input.model ?? "default", url: u, name: input.model ?? "图像生成" });
        }
      }
      return {
        url: result.url,
        urls: result.urls,
        sourceUrl: result.sourceUrl,
        sourceUrls: result.sourceUrls,
        sourceAt: result.sourceAt,
      };
      });
    }),
});

// ── Scripts ───────────────────────────────────────────────────────────────────

export const scriptsRouter = router({
  generateStoryboards: protectedProcedure
    .input(
      z.object({
        content: z.string().min(1),
        synopsis: z.string().optional(),
        count: z.number().int().min(2).max(8).default(4),
        model: z.string().optional(),
        promptLang: z.enum(["zh", "en"]).default("en"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.generateStoryboards", ctx.user.id, input, async () => {
      const promptLangName = input.promptLang === "zh" ? "Chinese (中文)" : "English";
      const systemPrompt = `You are a professional film director and storyboard artist.
Given a script, break it into exactly ${input.count} visual storyboard scenes.
Output ONLY a valid JSON array with no markdown fences, no explanation.
Each element must have these fields:
- "description": string (2-3 sentences, what the viewer sees)
- "promptText": string (${promptLangName}, detailed cinematic prompt for image generation — write it in ${promptLangName})
- "cameraMovement": string (one of: static, pan-left, pan-right, zoom-in, zoom-out, tilt-up, tilt-down, tracking)
- "duration": number (scene duration in seconds, integer 2-10)`;

      const userContent = [
        input.synopsis ? `Synopsis: ${input.synopsis}\n\n` : "",
        `Script:\n${input.content}`,
      ].join("");

      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userContent },
        ],
        model: input.model ?? "gemini-2.5-flash",
      });

      const text = extractTextContent(response);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });

      let scenes: Array<{ description: string; promptText: string; cameraMovement?: string; duration?: number }>;
      try {
        scenes = JSON.parse(jsonMatch[0]);
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" });
      }
      return { scenes: scenes.slice(0, input.count) };
      });
    }),

  generateFullScript: protectedProcedure
    .input(
      z.object({
        synopsis: z.string().min(1).max(2000),
        genre: z.string().optional(),
        style: z.string().optional(),
        mood: z.string().optional(),
        sceneCount: z.number().int().min(2).max(12).default(5),
        totalDuration: z.number().int().min(10).max(600).default(60),
        targetVideoModel: z.string().optional(),
        aspectRatio: z.string().default("16:9"),
        model: z.string().optional(),
        promptLang: z.enum(["zh", "en"]).default("en"),
        /** Optional template-specific writing instructions appended to the
         *  system prompt. Sourced from client/src/lib/scriptCreationTemplates.ts
         *  by id (UI passes `systemPromptAddon` of the applied template). */
        templatePromptOverride: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // P0 dedupe: single most expensive mutation (claude-sonnet-4-6 + 8k maxTokens).
      // Long latency (20-40s) makes user-driven retry probable; we collapse identical
      // concurrent submits into one external LLM call & charge.
      return dedupe("scripts.generateFullScript", ctx.user.id, input, async () => {
      const MODEL_PROMPT_GUIDES: Record<string, string> = {
        kling: "Kling (Kuaishou): Excellent precise camera control. Use detailed camera moves: push-in, dolly, orbital pan, crane shot. Rich motion expression with emotional narrative. Describe subject actions precisely.",
        veo: "Veo 3.1 (Google): Natural language understanding. Use flowing natural English. Emphasize realistic physics, human emotions, complex interactions. Write like a film scene description. No keyword lists.",
        runway: "Runway Gen-4.5: Concise style-focused prompts under 60 words. Lead with aesthetic style, then subject and action. Format: [cinematography style], [subject] [action], [environment], [lighting].",
        wan: "Wan 2.5 (Alibaba): Structured keyword prompts. Format: subject, action description, environment/background, visual style, lighting condition, camera angle. Good for stylized artistic content.",
        seedance: "Seedance 2 (ByteDance): Photorealistic output. Include: shot type (ECU/CU/MS/LS), lens focal length, lighting setup, color grade style, specific camera movement. Professional cinematography terminology.",
        dop: "DoP/Higgsfield: Professional director's language. Specify: focal length, aperture suggestion, lighting type and color temperature, film stock style, composition rule, emotional subtext. Cinematic excellence.",
      };

      const modelGuide = input.targetVideoModel
        ? (MODEL_PROMPT_GUIDES[input.targetVideoModel] ?? "General cinematic: descriptive English prompts with visual details, lighting, and camera information.")
        : "General cinematic: descriptive English prompts with visual details, lighting, camera information, and mood.";

      const avgDuration = Math.round(input.totalDuration / input.sceneCount);
      const promptLangName = input.promptLang === "zh" ? "Chinese (中文)" : "English";

      // ── Plan B: two separate LLM calls ──────────────────────────────────────
      // Call 1 generates ONLY the Chinese narrative script as plain text, and
      // Call 2 derives the scene breakdown from it. Splitting fixes two issues of
      // the old single-JSON call: (a) a long script + many scenes sharing one
      // 8000-token budget truncated the script mid-JSON, leaving the content box
      // incomplete; (b) the English prompt-language toggle bleeding into the
      // narrative. The script call is pure-Chinese with no English field, so the
      // narrative is always 中文 regardless of the promptLang toggle (which only
      // affects scene promptText in Call 2).

      // ── Call 1: Chinese narrative script (plain text, full token budget) ──
      const scriptSystemPrompt = `你是专业编剧和 AI 视频导演。根据故事梗概创作一部完整的中文分镜剧本。

制作要求：
- 类型：${input.genre ?? "通用"}
- 视觉风格：${input.style ?? "电影感"}
- 情感基调：${input.mood ?? "中性"}
- 画面比例：${input.aspectRatio}
- 总时长：约 ${input.totalDuration} 秒，共 ${input.sceneCount} 个场景（平均每场景 ${avgDuration} 秒）

要求：
1. 全程用中文创作，采用专业剧本格式，包含场景标题（场景一、场景二……）、生动的动作描写和氛围描述。
2. 叙事连贯，覆盖全部 ${input.sceneCount} 个场景。
3. 至少 200 字。
4. 只输出剧本正文，不要 JSON、不要额外说明、不要 markdown 代码块。`;

      const fullScriptSystemPrompt = input.templatePromptOverride
        ? `${scriptSystemPrompt}\n\n## 模板专属写作要求\n${input.templatePromptOverride}`
        : scriptSystemPrompt;

      const scriptResponse = await invokeLLM({
        messages: [
          { role: "system" as const, content: fullScriptSystemPrompt },
          { role: "user" as const, content: `故事梗概：\n${input.synopsis}` },
        ],
        model: input.model ?? "claude-sonnet-4-6",
        maxTokens: 8000,
      });
      const scriptText = extractTextContent(scriptResponse).trim();

      // ── Call 2: scene breakdown derived from the generated script ──
      // promptText language follows the toggle; description stays Chinese.
      const scenesSystemPrompt = `You are a professional film director and storyboard artist.
Given a Chinese script, break it into exactly ${input.sceneCount} visual storyboard scenes.

Target Video Model Prompt Style Guide:
${modelGuide}

Output ONLY a valid JSON array with no markdown fences, no explanation.
Each element must have these fields:
- "description": string (Chinese 中文, 2-3 sentences, what the viewer sees)
- "promptText": string (${promptLangName}, detailed cinematic prompt for image generation — write it in ${promptLangName}, follow the style guide above strictly)
- "cameraMovement": string (one of: static, pan-left, pan-right, zoom-in, zoom-out, tilt-up, tilt-down, tracking)
- "duration": number (scene duration in seconds, integer, around ${avgDuration})`;

      // Feed the generated script (fallback to synopsis if the model returned
      // nothing) so scenes match the actual narrative. Cap input to keep the
      // request bounded.
      const sceneSource = (scriptText || input.synopsis).slice(0, 8000);
      const scenesResponse = await invokeLLM({
        messages: [
          { role: "system" as const, content: scenesSystemPrompt },
          { role: "user" as const, content: `Script:\n${sceneSource}` },
        ],
        model: input.model ?? "claude-sonnet-4-6",
        maxTokens: 4000,
      });

      const scenesText = extractTextContent(scenesResponse);
      const scenesMatch = scenesText.match(/\[[\s\S]*\]/);
      let scenes: Array<{ description?: string; promptText?: string; cameraMovement?: string; duration?: number }> = [];
      if (scenesMatch) {
        try {
          scenes = JSON.parse(scenesMatch[0]);
        } catch {
          // Tolerate scene-parse failure: the script (the user's main concern)
          // is already in hand; return it with no scenes rather than failing all.
          scenes = [];
        }
      }

      if (!scriptText && scenes.length === 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效内容，请重试" });
      }

      return {
        scriptText,
        scenes: scenes.slice(0, input.sceneCount),
      };
      });
    }),

  refineScene: protectedProcedure
    .input(z.object({
      sceneText: z.string().min(1).max(2000),
      intent: z.string().max(500).optional(),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.refineScene", ctx.user.id, input, async () => {
        const systemPrompt = `你是专业编剧，负责优化单个场景描述。根据用户意图，改写或精化场景文字，保持原有叙事方向。只输出改写后的场景文字，不加任何说明。`;
        const userContent = input.intent
          ? `意图：${input.intent}\n\n原场景：\n${input.sceneText}`
          : `请优化以下场景：\n${input.sceneText}`;
        const response = await invokeLLM({
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userContent },
          ],
          model: input.model ?? "gemini-2.5-flash",
        });
        return { result: extractTextContent(response).trim() };
      });
    }),

  reviewScript: protectedProcedure
    .input(z.object({
      scriptText: z.string().min(1).max(8000),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.reviewScript", ctx.user.id, input, async () => {
      const systemPrompt = `你是专业剧本审稿人。分析剧本的结构、节奏、人物塑造和对白质量。
仅输出合法 JSON，无 markdown 代码块，无额外文字：
{"score":85,"issues":[{"type":"节奏","line":"场景二","suggestion":"节奏过快，建议增加过渡描写"},{"type":"对白","line":"第15行","suggestion":"对白生硬，可改为自然口语"}]}
score 为 0-100 整数，issues 数组最多 8 条，每条包含 type/line/suggestion 字段。`;
      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: input.scriptText },
        ],
        model: input.model ?? "claude-sonnet-4-6",
        maxTokens: 2000,
      });
      const text = extractTextContent(response);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
      let parsed: { score: number; issues: Array<{ type: string; line: string; suggestion: string }> };
      try { parsed = JSON.parse(jsonMatch[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
      const score = Number.isFinite(Number(parsed.score)) ? Math.round(Number(parsed.score)) : 0;
      const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      return { score, issues };
      });
    }),

  /**
   * Character consistency check — given a CharacterNode's profile + a set
   * of generated storyboard images, ask a vision-capable LLM to score how
   * consistent the same character looks across them and surface specific
   * differences (hairstyle / outfit / facial features / age / other).
   *
   * Returns structured JSON the client renders as an inline review panel:
   * - overallScore: 0-100
   * - summary: one-paragraph human-readable verdict
   * - issues[]: per-scene problems with sceneIndex (0-based into imageUrls)
   *   so the client can highlight the offending storyboard node
   * - recommendations[]: actionable bullets the user can follow up on
   */
  checkCharacterConsistency: protectedProcedure
    .input(z.object({
      characterName: z.string().max(120).optional(),
      characterKind: z.enum(["person", "scene"]).default("person"),
      profileText: z.string().max(1500).optional(),  // pre-rendered profile, see lib/characterPrompt.ts
      imageUrls: z.array(z.string().min(1).max(2048)).min(2).max(10),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      return dedupe("scripts.checkCharacterConsistency", ctx.user.id, input, async () => {
        // LLM providers (Anthropic / OpenAI / Gemini) require absolute HTTPS
        // URLs in image_url fields; our internal /manus-storage/{key} proxy
        // paths are server-relative and would return 422. Resolve up front.
        const absoluteUrls: string[] = [];
        for (const u of input.imageUrls) {
          try {
            absoluteUrls.push(await resolveToAbsoluteUrl(u));
          } catch (err) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `图像 URL 无法解析为绝对路径：${u.slice(0, 80)}（${err instanceof Error ? err.message : "未知错误"}）`,
            });
          }
        }

        const subjectLabel = input.characterKind === "scene" ? "场景" : "角色";
        const profile = input.profileText?.trim()
          ? `\n\n${subjectLabel}档案：\n${input.profileText.trim()}`
          : "";

        const systemPrompt = `你是专业的电影连贯性审查员。给你 ${absoluteUrls.length} 张分镜画面，按顺序索引 0 到 ${absoluteUrls.length - 1}。`
          + `你需要审查同一${subjectLabel}"${input.characterName ?? "(未命名)"}"在这些画面中的视觉一致性。${profile}\n\n`
          + `检查维度（按重要性）：\n`
          + `1. 五官/面部特征（脸型、眼睛、鼻子、嘴）\n`
          + `2. 发型（长度、颜色、风格）\n`
          + `3. 服装（颜色、款式、配饰）\n`
          + `4. 年龄/体型\n`
          + `5. 标志性特征（疤痕、眼镜、纹身等）\n\n`
          + `仅输出合法 JSON，无 markdown 代码块，无解释文字：\n`
          + `{"overallScore":78,"summary":"主角整体形象保持一致，但分镜 3 中发型有明显变化","issues":[{"sceneIndices":[2],"aspect":"hairstyle","severity":"medium","description":"分镜 3 中头发从长发变成了短发"},{"sceneIndices":[1,4],"aspect":"outfit","severity":"low","description":"分镜 2 和 5 的领带颜色不同"}],"recommendations":["重新生成分镜 3，prompt 中明确指定『长发』","在 prompt 中固定服装『黑色西装+红色领带』"]}\n\n`
          + `约束：\n`
          + `- overallScore 0-100 整数（100=完全一致）\n`
          + `- summary 一段话，不超 100 字\n`
          + `- issues 至多 8 条；sceneIndices 是 0-based 数组（指向输入图片顺序）；aspect 取值 hairstyle/outfit/facial/age/signature/other；severity 取值 low/medium/high\n`
          + `- recommendations 至多 5 条，每条具体可操作`;

        const response = await invokeLLM({
          messages: [
            { role: "system" as const, content: systemPrompt },
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: `请审查以下 ${absoluteUrls.length} 张分镜，按索引 0..${absoluteUrls.length - 1} 顺序：` },
                ...absoluteUrls.map((url) => ({
                  type: "image_url" as const,
                  image_url: { url, detail: "high" as const },
                })),
              ],
            },
          ],
          model: input.model ?? "claude-sonnet-4-6",
          maxTokens: 3000,  // Chinese descriptions encode ~2 tok/char; 8 issues
          // + 5 recs + 100-char summary worst-case ≈ 1470 tokens — at the
          // previous 1500 ceiling responses got truncated and JSON.parse failed.
        });
        const text = extractTextContent(response);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        }
        let parsed: {
          overallScore?: unknown;
          summary?: unknown;
          issues?: unknown;
          recommendations?: unknown;
        };
        try { parsed = JSON.parse(jsonMatch[0]); } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" });
        }
        // Normalize — survive minor LLM schema drift (sceneIndex vs sceneIndices,
        // numeric strings, missing fields). overallScore distinguishes
        // "missing field" (-1, surfaced as "未评分") from a legitimate 0,
        // so the UI can warn instead of silently rendering "0 = terrible".
        const rawScore = parsed.overallScore;
        const overallScore = typeof rawScore === "number" && Number.isFinite(rawScore)
          ? Math.max(0, Math.min(100, Math.round(rawScore)))
          : typeof rawScore === "string" && /^-?\d+(?:\.\d+)?$/.test(rawScore.trim())
            ? Math.max(0, Math.min(100, Math.round(Number(rawScore))))
            : -1;  // sentinel: LLM omitted the field
        const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : "";
        const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
        const issues = rawIssues.slice(0, 8).map((it) => {
          const obj = it as Record<string, unknown>;
          // Accept both sceneIndices (array) and sceneIndex (single number) for resilience
          const idxs = Array.isArray(obj.sceneIndices)
            ? obj.sceneIndices
            : typeof obj.sceneIndex === "number" ? [obj.sceneIndex] : [];
          const sceneIndices = idxs
            .map((x) => Number(x))
            .filter((n) => Number.isInteger(n) && n >= 0 && n < absoluteUrls.length);
          const aspect = typeof obj.aspect === "string" ? obj.aspect : "other";
          const sev = typeof obj.severity === "string" ? obj.severity : "medium";
          return {
            sceneIndices,
            aspect: ["hairstyle", "outfit", "facial", "age", "signature", "other"].includes(aspect) ? aspect : "other",
            severity: ["low", "medium", "high"].includes(sev) ? sev : "medium",
            description: typeof obj.description === "string" ? obj.description.slice(0, 300) : "",
          };
        }).filter((it) => it.sceneIndices.length > 0 && it.description.length > 0);
        const rawRecs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
        const recommendations = rawRecs.slice(0, 5)
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.slice(0, 300));

        writeAuditLog({
          ctx,
          action: "image_gen",  // closest existing audit kind (vision LLM call)
          detail: { kind: "character_consistency", imageCount: absoluteUrls.length, score: overallScore },
        });

        return { overallScore, summary, issues, recommendations };
      });
    }),

  generateVariants: protectedProcedure
    .input(z.object({
      synopsis: z.string().min(1).max(2000),
      variantCount: z.number().int().min(2).max(4).default(3),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.generateVariants", ctx.user.id, input, async () => {
      const systemPrompt = `你是专业编剧。根据相同的故事梗概，生成风格各异的剧本开场段落（不超过200字/版本）。
仅输出合法 JSON 数组，无 markdown 代码块：[{"label":"版本A","text":"..."},{"label":"版本B","text":"..."}]`;
      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: `梗概：${input.synopsis}\n\n请生成 ${input.variantCount} 个风格不同的开场版本。` },
        ],
        model: input.model ?? "claude-sonnet-4-6",
        maxTokens: 4000,
      });
      const text = extractTextContent(response);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
      let variants: Array<{ label: string; text: string }>;
      try { variants = JSON.parse(jsonMatch[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
      return { variants: variants.slice(0, input.variantCount) };
      });
    }),

  refineConversation: protectedProcedure
    .input(z.object({
      dialogueText: z.string().min(1).max(4000),
      intent: z.string().max(500).optional(),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.refineConversation", ctx.user.id, input, async () => {
        const systemPrompt = `你是专业对话编剧，擅长优化剧本对白的节奏、语气和自然度。只输出改写后的对白文本，不加任何说明。`;
        const userContent = input.intent
          ? `优化要求：${input.intent}\n\n原对白：\n${input.dialogueText}`
          : `请优化以下对白，使其更自然流畅：\n${input.dialogueText}`;
        const response = await invokeLLM({
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userContent },
          ],
          model: input.model ?? "gemini-2.5-flash",
        });
        return { result: extractTextContent(response).trim() };
      });
    }),

  applyStyleTransfer: protectedProcedure
    .input(z.object({
      scriptText: z.string().min(1).max(8000),
      style: z.enum(["硬派", "文艺", "商业", "悬疑", "温情", "幽默"]),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.applyStyleTransfer", ctx.user.id, input, async () => {
      const STYLE_GUIDES: Record<string, string> = {
        硬派: "简练有力，动作描写精准，对白克制，整体风格硬朗紧张",
        文艺: "意象丰富，语言诗意，节奏舒缓，注重内心情感流动",
        商业: "节奏明快，视觉冲击强，情节清晰，带商业爆米花感",
        悬疑: "氛围紧绷，信息克制，设置悬念，多用留白与伏笔",
        温情: "细腻温暖，情感真实，强调人物关系，语言柔和",
        幽默: "轻松诙谐，妙语连珠，多用反转和对比制造喜感",
      };
      const systemPrompt = `你是专业编剧，负责将剧本改写为特定风格。风格要求：${STYLE_GUIDES[input.style]}。保留原故事框架和角色，只改变文风。只输出改写后的剧本，不加任何说明。`;
      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: input.scriptText },
        ],
        model: input.model ?? "claude-sonnet-4-6",
        maxTokens: 8000,
      });
      return { result: extractTextContent(response).trim() };
      });
    }),

  extractDialogue: protectedProcedure
    .input(z.object({
      scriptText: z.string().min(1).max(8000),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.extractDialogue", ctx.user.id, input, async () => {
        const systemPrompt = `你是剧本分析师。从剧本中提取所有对白，格式化为清单：每行一条，格式为"角色名：台词内容"。若无明确角色名则用"旁白"。只输出对白清单，不加任何说明。`;
        const response = await invokeLLM({
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: input.scriptText },
          ],
          model: input.model ?? "gemini-2.5-flash",
        });
        return { result: extractTextContent(response).trim() };
      });
    }),

  generateMoodBoard: protectedProcedure
    .input(z.object({
      scriptText: z.string().min(1).max(8000),
      model: z.string().optional(),
      promptLang: z.enum(["zh", "en"]).default("en"),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.generateMoodBoard", ctx.user.id, input, async () => {
      const langName = input.promptLang === "zh" ? "中文" : "英文";
      const promptExample = input.promptLang === "zh"
        ? "用于 AI 图像生成的中文电影级提示词"
        : "English cinematic prompt for AI image generation";
      const systemPrompt = `你是AI视频导演，负责将剧本场景转化为图像生成提示词。
为每个主要场景生成一条${langName}视觉提示词（cinematic prompt）和一条负面提示词。提示词必须使用${langName}书写。
仅输出合法 JSON 数组，无 markdown 代码块：
[{"sceneIndex":1,"sceneTitle":"场景名称（中文）","prompt":"${promptExample}","negPrompt":"blurry, low quality, text"}]`;
      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: input.scriptText },
        ],
        model: input.model ?? "claude-sonnet-4-6",
        maxTokens: 4000,
      });
      const text = extractTextContent(response);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
      let rawScenes: Array<{ sceneIndex?: number; sceneTitle?: string; prompt?: string; negPrompt?: string }>;
      try { rawScenes = JSON.parse(jsonMatch[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
      const scenes = rawScenes.map((s, idx) => ({
        sceneIndex: typeof s.sceneIndex === "number" ? s.sceneIndex : idx + 1,
        sceneTitle: s.sceneTitle ?? `场景 ${idx + 1}`,
        prompt: s.prompt ?? "",
        negPrompt: s.negPrompt,
      }));
      return { scenes };
      });
    }),
});

// ── Audio Generation ──────────────────────────────────────────────────────────

export const audioGenRouter = router({
  generateMusic: protectedProcedure
    .input(
      z.object({
        model: z.enum([
          // Live (Suno via generate-music)
          "suno-v4", "suno-v4.5", "suno-v4.5plus", "suno-v4.5all", "suno-v5", "suno-v5.5",
          // Live (MiniMax via status endpoint)
          "minimax-music-2.6",
          // Legacy aliases — normalized below
          "suno-v3.5", "minimax-music-02", "mureka",
        ]),
        prompt: z.string().min(1),
        style: z.string().optional(),
        instrumental: z.boolean().optional(),
        negativeTags: z.string().optional(),
        lyrics: z.string().max(3500).optional(),   // MiniMax only
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");

      // Normalize legacy ids to live ones. Mureka has no live equivalent.
      let model: string = input.model;
      if (model === "suno-v3.5") model = "suno-v4";
      else if (model === "minimax-music-02") model = "minimax-music-2.6";
      else if (model === "mureka") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Mureka 暂未接入，请改用 Suno 或 MiniMax Music 2.6。" });
      }

      // MiniMax requires a prompt of 10-2000 chars.
      if (model === "minimax-music-2.6" && input.prompt.trim().length < 10) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "MiniMax Music 2.6 的描述需至少 10 个字符。" });
      }

      return dedupe("audioGen.generateMusic", ctx.user.id, input, async () => {
        const result = await submitAndPollPoyoMusic({
          model: model as PoyoMusicModel,
          prompt: input.prompt,
          style: input.style,
          instrumental: input.instrumental,
          negativeTags: input.negativeTags,
          lyrics: input.lyrics,
        });
        writeAuditLog({
          ctx,
          action: "audio_music",
          detail: { model, prompt: truncate(input.prompt), resultUrl: result.url, duration: result.duration },
        });
        await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: "poyo", model, url: result.url, name: model });
        return { url: result.url, duration: result.duration, imageUrl: result.imageUrl };
      });
    }),

  generateDubbing: protectedProcedure
    .input(
      z.object({
        // Live TTS providers: 3 OpenAI-direct (via openaiTTS.ts) + Poyo
        // ElevenLabs V3. The old "elevenlabs_v3" underscore id is accepted for
        // backward compat with saved nodes and normalized to the live id below.
        model: z.enum([
          // Live (OpenAI direct)
          "openai_tts_real",
          "openai_tts_hd_real",
          "openai_gpt4o_mini_tts",
          // Live (Poyo)
          "elevenlabs-v3-tts",
          // Legacy aliases — accepted for backward compat with saved nodes and
          // normalized below (elevenlabs_v3→live Poyo; the rest→openai_tts_real)
          // so old payloads don't hit an opaque Zod validation error.
          "elevenlabs_v3",
          "openai_tts_hd",
          "openai_tts",
          "cosyvoice_2",
        ]),
        text: z.string().min(1).max(5000),
        voice: z.string().optional(),
        speed: z.number().min(0.5).max(2.0).optional(),          // OpenAI only
        // ElevenLabs V3 TTS params (per official OpenAPI)
        stability: z.number().min(0).max(1).optional(),
        timestamps: z.boolean().optional(),
        languageCode: z.string().optional(),
        applyTextNormalization: z.enum(["auto", "on", "off"]).optional(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");

      // Normalize legacy ids: elevenlabs_v3 → live Poyo TTS; the retired
      // openai_tts/openai_tts_hd/cosyvoice_2 ids → the live OpenAI default.
      const LEGACY_TO_LIVE: Record<string, string> = {
        elevenlabs_v3: "elevenlabs-v3-tts",
        openai_tts_hd: "openai_tts_hd_real",
        openai_tts: "openai_tts_real",
        cosyvoice_2: "openai_tts_real",
      };
      const model = LEGACY_TO_LIVE[input.model] ?? input.model;
      const isPoyoTTS = model === "elevenlabs-v3-tts";

      // Per-model text limits. ElevenLabs V3 allows 5000; OpenAI TTS 4096.
      const TEXT_LIMIT: Record<string, number> = {
        "elevenlabs-v3-tts":   5000,
        openai_tts_real:       4096,
        openai_tts_hd_real:    4096,
        openai_gpt4o_mini_tts: 4096,
      };
      const limit = TEXT_LIMIT[model] ?? 4096;
      if (input.text.length > limit) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${model} 单次配音上限 ${limit} 字（当前 ${input.text.length}）` });
      }

      return dedupe("audioGen.generateDubbing", ctx.user.id, input, async () => {
        const result = isPoyoTTS
          ? await submitAndPollPoyoTTS({
              model: "elevenlabs-v3-tts",
              text: input.text,
              voice: input.voice,
              stability: input.stability,
              timestamps: input.timestamps,
              languageCode: input.languageCode,
              applyTextNormalization: input.applyTextNormalization,
            })
          : await synthesizeOpenAITTS({
              model: model as OpenAITTSModel,
              text: input.text,
              voice: input.voice,
              speed: input.speed,
            });
        writeAuditLog({
          ctx,
          action: "audio_dubbing",
          detail: {
            model,
            text: truncate(input.text),
            voice: input.voice ?? null,
            resultUrl: result.url,
            duration: result.duration ?? null,
            ...(isPoyoTTS ? { stability: input.stability ?? null, timestamps: input.timestamps ?? false } : {}),
          },
        });
        await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: isPoyoTTS ? "poyo" : "openai", model, url: result.url, name: model });
        return {
          url: result.url,
          duration: result.duration,
          timestampsUrl: isPoyoTTS ? (result as { timestampsUrl?: string }).timestampsUrl : undefined,
        };
      });
    }),
});

// ── Video Clip Editor ─────────────────────────────────────────────────────────
export const clipRouter = router({
  trimVideo: protectedProcedure
    .input(
      z.object({
        inputUrl: z.string().url(),
        startTime: z.number().min(0),
        endTime: z.number().min(0),
        speed: z.number().min(0.25).max(4.0).optional(),
        audioUrl: z.string().url().optional(),
        audioVolume: z.number().min(0).max(2.0).optional(),
      }).refine(d => d.endTime > d.startTime, { message: "出点必须大于入点", path: ["endTime"] })
    )
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg, no third-party AI — not whitelist-gated
      guardUrl(input.inputUrl);
      if (input.audioUrl) guardUrl(input.audioUrl);
      const result = await trimVideo(input);
      return { url: result.url, duration: result.duration };
    }),

  getVideoDuration: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .query(async ({ ctx, input }) => {
      // local ffprobe, no third-party AI — not whitelist-gated
      guardUrl(input.url);
      const duration = await getVideoDuration(input.url);
      return { duration };
    }),

  smartCut: protectedProcedure
    .input(z.object({
      inputUrl: z.string().url(),
      aggressiveness: z.enum(["low", "medium", "high"]).default("medium"),
      targetDuration: z.number().min(5).max(3600).optional(),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      guardUrl(input.inputUrl);
      return dedupe("clip.smartCut", ctx.user.id, input, async () => {
        const transcription = await transcribeAudio({ audioUrl: input.inputUrl });
        if ("error" in transcription) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `转录失败：${transcription.error}` });
        }
        const segments = transcription.segments.map((s) => ({
          start: s.start, end: s.end, text: s.text.trim(),
          no_speech_prob: s.no_speech_prob ?? 0,
        }));

        const AGGRESSIVE_THRESHOLDS: Record<string, number> = { low: 0.20, medium: 0.40, high: 0.65 };
        const removeThreshold = AGGRESSIVE_THRESHOLDS[input.aggressiveness];
        const targetHint = input.targetDuration
          ? `\n目标剪辑后总时长：约 ${input.targetDuration} 秒，请优先选取最有价值的片段使保留片段总时长接近此目标。`
          : "";

        const systemPrompt = `你是专业视频剪辑师。给定视频转录片段，决定哪些片段应该保留。
移除标准（移除值越高越激进）：无意义停顿、重复内容、低信息密度片段、口误填充词（"嗯"、"呃"等）。
当前移除激进度：${input.aggressiveness}（${Math.round(removeThreshold * 100)}% 截止阈值）。${targetHint}
仅输出合法 JSON，无 markdown：{"keep":[{"start":0.5,"end":5.2},{"start":8.1,"end":15.0}]}`;

        const transcriptJson = JSON.stringify(segments.map((s) => ({ s: s.start, e: s.end, t: s.text, ns: s.no_speech_prob })));
        const response = await invokeLLM({
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: `片段列表（JSON）：\n${transcriptJson}` },
          ],
          model: input.model ?? "gemini-2.5-flash",
          maxTokens: 2000,
        });
        const text = extractTextContent(response);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        let parsed: { keep: Array<{ start: number; end: number }> };
        try { parsed = JSON.parse(jsonMatch[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
        const keepSegments = Array.isArray(parsed.keep) ? parsed.keep.filter((seg) => typeof seg.start === "number" && typeof seg.end === "number" && seg.end > seg.start) : [];
        if (keepSegments.length === 0) throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "AI 未找到可保留片段，请调低激进度后重试" });
        const originalDuration = segments.length > 0 ? Math.max(...segments.map((s) => s.end)) : 0;
        const result = await smartCutVideo({ inputUrl: input.inputUrl, keepSegments });
        // Clamp outputDuration: AI may return end times beyond actual video EOF;
        // FFmpeg silently trims to EOF so the true output is shorter than the summed segment durations.
        const outputDuration = originalDuration > 0
          ? Math.min(result.outputDuration, originalDuration)
          : result.outputDuration;
        return { url: result.url, outputDuration, originalDuration };
      });
    }),

  poseControl: protectedProcedure
    .input(z.object({
      referenceImageUrl: z.string().url(),
      prompt: z.string().min(1).max(1000),
      guidanceScale: z.number().min(1).max(10).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      guardUrl(input.referenceImageUrl);
      return dedupe("clip.poseControl", ctx.user.id, input, async () => {
        const result = await generateImage({
          prompt: input.prompt,
          model: "hf_flux_pro",
          originalImages: [{ url: input.referenceImageUrl }],
          fluxGuidanceScale: input.guidanceScale,
        });
        return { url: result.url };
      });
    }),
});

// ── Video Merge ───────────────────────────────────────────────────────────────
export const mergeRouter = router({
  mergeVideos: protectedProcedure
    .input(
      z.object({
        inputUrls: z.array(z.string().url()).min(2).max(10),
        transition: z.enum(["none", "fade", "dissolve"]).optional(),
        transitionDuration: z.number().min(0.1).max(2.0).optional(),
        bgMusicUrl: z.string().url().optional(),
        bgMusicVolume: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg, no third-party AI — not whitelist-gated
      for (const url of input.inputUrls) guardUrl(url);
      if (input.bgMusicUrl) guardUrl(input.bgMusicUrl);
      const result = await mergeVideos(input);
      return { url: result.url, duration: result.duration };
    }),
});

// ── Subtitles ─────────────────────────────────────────────────────────────────
export const subtitleRouter = router({
  transcribe: protectedProcedure
    .input(
      z.object({
        audioUrl: z.string().url(),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      // (audioUrl, language) deterministically map to a Whisper transcription, so
      // dedupe by that pair — repeated submits during the long Whisper call collapse.
      guardUrl(input.audioUrl);
      return dedupe("subtitle.transcribe", ctx.user.id, input, async () => {
        const result = await transcribeAudio({ audioUrl: input.audioUrl, language: input.language });
        if ("error" in result) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
        }
        const entries: SubtitleEntry[] = result.segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text.trim(),
        }));
        writeAuditLog({
          ctx,
          action: "subtitle_transcribe",
          detail: { audioUrl: truncate(input.audioUrl, 200), language: result.language, segmentCount: entries.length },
        });
        return { entries, fullText: result.text, language: result.language };
      });
    }),

  burnIn: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        entries: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().max(500) })).max(2000),
        fontSize: z.number().int().min(8).max(48).optional(),
        fontColor: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg, no third-party AI — not whitelist-gated
      guardUrl(input.videoUrl);
      const result = await burnSubtitles(input.videoUrl, input.entries as SubtitleEntry[], {
        fontSize: input.fontSize,
        fontColor: input.fontColor,
      });
      return { url: result.url };
    }),

  exportSRT: protectedProcedure
    .input(
      z.object({
        entries: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().max(500) })).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // pure local string generation, no AI — not whitelist-gated
      return { srt: generateSRT(input.entries as SubtitleEntry[]) };
    }),
});

// ── Motion Subtitles ──────────────────────────────────────────────────────────
export const subtitleMotionRouter = router({
  transcribe: protectedProcedure
    .input(z.object({ audioUrl: z.string().url(), language: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      guardUrl(input.audioUrl);
      return dedupe("subtitleMotion.transcribe", ctx.user.id, input, async () => {
        const result = await transcribeAudio({ audioUrl: input.audioUrl, language: input.language });
        if ("error" in result) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
        const entries: SubtitleEntry[] = result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
        return { entries, fullText: result.text, language: result.language };
      });
    }),

  burnMotion: protectedProcedure
    .input(z.object({
      videoUrl: z.string().url(),
      entries: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(500) })).min(1).max(2000).refine((arr) => arr.every((e) => e.end > e.start), { message: "每条字幕的 end 必须大于 start" }),
      motionStyle: z.enum(["fade", "roll", "karaoke", "bounce"]).optional(),
      fontSize: z.number().int().min(8).max(48).optional(),
      fontColor: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg (ASS burn), no third-party AI — not whitelist-gated
      guardUrl(input.videoUrl);
      return dedupe("subtitleMotion.burnMotion", ctx.user.id, input, async () => {
        const result = await burnAssSubtitles(
          input.videoUrl,
          input.entries as SubtitleEntry[],
          { motionStyle: input.motionStyle, fontSize: input.fontSize, fontColor: input.fontColor },
        );
        return { url: result.url };
      });
    }),
});

// ── Deferred node routers (require third-party API keys) ──────────────────────

export const voiceCloneRouter = router({
  clone: protectedProcedure
    .input(z.object({ referenceAudioUrl: z.string().url().optional(), text: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx }) => {
      await assertWhitelisted(ctx);
      throw new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: "声音克隆功能暂未启用，需要配置 ElevenLabs API Key" });
    }),
});

export const lipSyncRouter = router({
  sync: protectedProcedure
    .input(z.object({ videoUrl: z.string().url(), audioUrl: z.string().url() }))
    .mutation(async ({ ctx }) => {
      await assertWhitelisted(ctx);
      throw new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: "唇形同步功能暂未启用，需要配置 Sync.so API Key" });
    }),
});

export const avatarRouter = router({
  generate: protectedProcedure
    .input(z.object({ avatarDescription: z.string().min(1).max(500), script: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx }) => {
      await assertWhitelisted(ctx);
      throw new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: "数字人功能暂未启用，需要配置 D-ID API Key" });
    }),
});

// ── Video Overlay ─────────────────────────────────────────────────────────────
export const overlayRouter = router({
  process: protectedProcedure
    .input(
      z.object({
        inputUrl: z.string().url(),
        mode: z.enum(["watermark", "pip", "color_correction"]),
        // Watermark
        overlayImageUrl: z.string().url().optional(),
        overlayPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]).optional(),
        overlayScale: z.number().min(0.05).max(1.0).optional(),
        overlayOpacity: z.number().min(0).max(1).optional(),
        // PiP
        pipVideoUrl: z.string().url().optional(),
        pipPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
        pipScale: z.number().min(0.1).max(0.5).optional(),
        // Color correction
        brightness: z.number().min(-1).max(1).optional(),
        contrast: z.number().min(0).max(2).optional(),
        saturation: z.number().min(0).max(3).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg (overlay/水印/调色), no third-party AI — not whitelist-gated
      guardUrl(input.inputUrl);
      if (input.overlayImageUrl) guardUrl(input.overlayImageUrl);
      if (input.pipVideoUrl) guardUrl(input.pipVideoUrl);
      const result = await overlayVideo(input);
      return { url: result.url };
    }),
});

// ── ComfyUI (self-hosted) ─────────────────────────────────────────────────────
// Independent router — does NOT modify the existing imageGen/videoTasks routers.
// URL validation deliberately skips guardUrl()/SSRF check; the project owner has
// explicitly opted into allowing internal/private ComfyUI servers. The format is
// still validated to be http(s) via `new URL()` inside generateComfyImage/Video.
export const comfyuiRouter = router({
  generateImage: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        projectId: z.number(),
        customBaseUrl: z.string().max(2048).optional(),
        workflowTemplate: z.enum(["txt2img", "img2img", "inpaint"]),
        prompt: z.string().min(1).max(2000),
        negPrompt: z.string().max(2000).optional(),
        ckpt: z.string().min(1).max(255),
        filenamePrefix: z.string().max(128).optional(),
        lora: z.string().max(255).optional(),
        // Multi-LoRA stack (takes precedence over the single `lora`/`loraStrength`).
        loras: z.array(z.object({
          name: z.string().min(1).max(255),
          strengthModel: z.number().min(-10).max(10),
          strengthClip: z.number().min(-10).max(10).optional(),
        })).max(8).optional(),
        // Optional ControlNet guidance (txt2img / img2img).
        controlnet: z.object({
          model: z.string().min(1).max(255),
          imageUrl: z.string().min(1).max(2048),
          strength: z.number().min(0).max(2).optional(),
          startPercent: z.number().min(0).max(1).optional(),
          endPercent: z.number().min(0).max(1).optional(),
          preprocessor: z.string().max(128).optional(),
        }).optional(),
        // Optional IPAdapter style/face reference(s). Supports multiple images
        // (multi-image conditioning, chained server-side).
        ipadapter: z.object({
          model: z.string().min(1).max(255),
          imageUrl: z.string().min(1).max(2048),
          imageUrls: z.array(z.string().min(1).max(2048)).max(8).optional(),
          clipVision: z.string().max(255).optional(),
          weight: z.number().min(0).max(2).optional(),
        }).optional(),
        // Optional separate CLIP loader (Flux/SD3/UNet-only checkpoints).
        clip: z.object({
          clipType: z.string().min(1).max(64),
          name1: z.string().min(1).max(255),
          name2: z.string().max(255).optional(),
          name3: z.string().max(255).optional(),
        }).optional(),
        // DiT architecture support (default classic SD).
        arch: z.enum(["sd", "flux", "sd3", "qwen"]).optional(),
        modelSource: z.enum(["checkpoint", "unet"]).optional(),
        unetWeightDtype: z.string().max(64).optional(),
        guidance: z.number().min(0).max(100).optional(),
        shift: z.number().min(0).max(100).optional(),
        // Optional model-based upscale (UpscaleModelLoader name).
        upscaleModel: z.string().max(255).optional(),
        steps: z.number().int().min(1).max(150).default(20),
        cfg: z.number().min(1).max(30).default(7),
        seed: z.number().int().default(-1),
        width: z.number().int().min(64).max(2048).default(512),
        height: z.number().int().min(64).max(2048).default(512),
        sampler: z.string().max(64).optional(),
        scheduler: z.string().max(64).optional(),
        denoise: z.number().min(0).max(1).optional(),
        vae: z.string().max(255).optional(),
        loraStrength: z.number().min(0).max(2).optional(),
        batchSize: z.number().int().min(1).max(8).default(1),
        referenceImageUrl: z.string().max(2048).optional(),
        maskUrl: z.string().max(2048).optional(),
      }).refine(
        (v) => (v.workflowTemplate !== "img2img" && v.workflowTemplate !== "inpaint") || (v.referenceImageUrl && v.referenceImageUrl.trim().length > 0),
        { message: "img2img / inpaint 模板必须提供 referenceImageUrl", path: ["referenceImageUrl"] }
      ).refine(
        (v) => v.workflowTemplate !== "inpaint" || (v.maskUrl && v.maskUrl.trim().length > 0),
        { message: "inpaint 模板必须提供蒙版 maskUrl", path: ["maskUrl"] }
      )
    )
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl;
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置：请在节点设置中填写或服务端设置 COMFYUI_BASE_URL" });
      return dedupe("comfyui.generateImage", ctx.user.id, input, async () => {
        try {
          const result = await generateComfyImage(baseUrl, {
            workflowTemplate: input.workflowTemplate,
            prompt: input.prompt,
            negPrompt: input.negPrompt,
            ckpt: input.ckpt,
            filenamePrefix: input.filenamePrefix,
            lora: input.lora,
            loras: input.loras,
            controlnet: input.controlnet,
            ipadapter: input.ipadapter,
            clip: input.clip,
            arch: input.arch,
            modelSource: input.modelSource,
            unetWeightDtype: input.unetWeightDtype,
            guidance: input.guidance,
            shift: input.shift,
            upscaleModel: input.upscaleModel,
            steps: input.steps,
            cfg: input.cfg,
            seed: input.seed >= 0 ? input.seed : undefined,
            width: input.width,
            height: input.height,
            sampler: input.sampler,
            scheduler: input.scheduler,
            denoise: input.denoise,
            vae: input.vae,
            loraStrength: input.loraStrength,
            batchSize: input.batchSize,
            referenceImageUrl: input.referenceImageUrl,
            maskUrl: input.maskUrl,
            projectId: input.projectId,
            nodeId: input.nodeId,
          });
          writeAuditLog({
            ctx,
            action: "comfyui_image_gen",
            detail: { template: input.workflowTemplate, ckpt: input.ckpt, prompt: truncate(input.prompt), resultUrl: result.url, nodeId: input.nodeId },
          });
          for (const u of (result.urls?.length ? result.urls : [result.url])) {
            await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, type: "image", source: "generated", provider: "comfyui", model: input.ckpt, url: u, name: input.ckpt || "ComfyUI 图像" });
          }
          return { url: result.url, urls: result.urls };
        } catch (err) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
        }
      });
    }),

  generateVideo: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        projectId: z.number(),
        customBaseUrl: z.string().max(2048).optional(),
        workflowTemplate: z.enum(["animatediff", "svd", "wan_t2v", "wan_i2v", "ltxv"]),
        prompt: z.string().min(1).max(2000),
        negPrompt: z.string().max(2000).optional(),
        ckpt: z.string().min(1).max(255),
        motionModule: z.string().max(255).optional(),
        clip: z.string().max(255).optional(),
        clipVision: z.string().max(255).optional(),
        steps: z.number().int().min(1).max(150).default(20),
        cfg: z.number().min(1).max(30).default(7),
        seed: z.number().int().default(-1),
        frames: z.number().int().min(1).max(256).default(16),
        fps: z.number().int().min(1).max(60).default(8),
        width: z.number().int().min(64).max(2048).optional(),
        height: z.number().int().min(64).max(2048).optional(),
        sampler: z.string().max(64).optional(),
        scheduler: z.string().max(64).optional(),
        denoise: z.number().min(0).max(1).optional(),
        vae: z.string().max(255).optional(),
        batchSize: z.number().int().min(1).max(8).default(1),
        referenceImageUrl: z.string().max(2048).optional(),
      }).refine(
        (v) => v.workflowTemplate !== "animatediff" || (v.motionModule && v.motionModule.trim().length > 0),
        { message: "AnimateDiff 模板必须提供 motionModule", path: ["motionModule"] }
      ).refine(
        (v) => (v.workflowTemplate !== "svd" && v.workflowTemplate !== "wan_i2v") || (v.referenceImageUrl && v.referenceImageUrl.trim().length > 0),
        { message: "SVD / Wan I2V 模板必须提供起始图", path: ["referenceImageUrl"] }
      )
    )
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl;
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置：请在节点设置中填写或服务端设置 COMFYUI_BASE_URL" });
      return dedupe("comfyui.generateVideo", ctx.user.id, input, async () => {
        try {
          const result = await generateComfyVideo(baseUrl, {
            workflowTemplate: input.workflowTemplate,
            prompt: input.prompt,
            negPrompt: input.negPrompt,
            ckpt: input.ckpt,
            motionModule: input.motionModule,
            clip: input.clip,
            clipVision: input.clipVision,
            steps: input.steps,
            cfg: input.cfg,
            seed: input.seed >= 0 ? input.seed : undefined,
            frames: input.frames,
            fps: input.fps,
            width: input.width,
            height: input.height,
            sampler: input.sampler,
            scheduler: input.scheduler,
            denoise: input.denoise,
            vae: input.vae,
            batchSize: input.batchSize,
            referenceImageUrl: input.referenceImageUrl,
            projectId: input.projectId,
            nodeId: input.nodeId,
          });
          writeAuditLog({
            ctx,
            action: "comfyui_video_gen",
            detail: { template: input.workflowTemplate, ckpt: input.ckpt, prompt: truncate(input.prompt), resultUrl: result.url, nodeId: input.nodeId },
          });
          await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, type: "video", source: "generated", provider: "comfyui", model: input.ckpt, url: result.url, name: input.ckpt || "ComfyUI 视频" });
          return { url: result.url };
        } catch (err) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
        }
      });
    }),

  interrupt: protectedProcedure
    .input(z.object({ customBaseUrl: z.string().max(2048).optional() }))
    .mutation(async ({ ctx, input }) => {
      // Same SSRF gate as the generate endpoints (server POSTs to a client URL).
      // Use the ComfyUI-specific gate so cancel stays consistent with generate
      // when an admin has enabled the ComfyUI whitelist bypass.
      await assertComfyuiAllowed(ctx);
      const baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl;
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置" });
      try {
        await interruptComfy(baseUrl);
        return { ok: true as const };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  fetchModels: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      // Multi-server: refresh the union of models across all saved addresses.
      customBaseUrls: z.array(z.string().max(2048)).max(20).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Whitelist check: fetchModels can be used as an SSRF probe via customBaseUrl
      // (the server fetches whatever URL the client supplies). Treat with the same
      // gate as the paid generate endpoints.
      await assertComfyuiAllowed(ctx);
      // Candidate base URLs: explicit saved list ∪ single field, deduped.
      const candidates = Array.from(new Set(
        [...(input.customBaseUrls ?? []), input.customBaseUrl]
          .map((u) => u?.trim())
          .filter((u): u is string => !!u),
      ));
      const urls = candidates.length > 0 ? candidates : (ENV.comfyuiBaseUrl ? [ENV.comfyuiBaseUrl] : []);
      // Not configured is a benign empty state (UI degrades to free-text), not an error.
      if (urls.length === 0) return emptyModelList();
      // Single URL: preserve original behavior — surface the real reason
      // (unreachable / bad status / timeout) so the UI can distinguish
      // "server has no models" from "couldn't reach server".
      if (urls.length === 1) {
        try {
          return await fetchComfyModels(urls[0]);
        } catch (err) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
        }
      }
      // Multiple URLs: best-effort union so one unreachable server doesn't blank
      // out models from the others.
      const merged = emptyModelList();
      const results = await Promise.allSettled(urls.map((u) => fetchComfyModels(u)));
      let anyOk = false;
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        anyOk = true;
        for (const key of Object.keys(merged) as (keyof ComfyModelList)[]) {
          for (const v of r.value[key]) if (!merged[key].includes(v)) merged[key].push(v);
        }
      }
      if (!anyOk) {
        const firstErr = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: firstErr?.reason instanceof Error ? firstErr.reason.message : "无法连接任何 ComfyUI 服务器" });
      }
      for (const key of Object.keys(merged) as (keyof ComfyModelList)[]) merged[key].sort();
      return merged;
    }),

  analyzeWorkflow: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      workflowJson: z.string().max(500_000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl || undefined;
      try {
        return await analyzeWorkflow(input.workflowJson, baseUrl);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  uploadWorkflowImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      customBaseUrl: z.string().max(2048).optional(),
      sourceUrl: z.string().max(2048),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl;
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置" });
      try {
        const comfyFilename = await uploadImageForWorkflow(baseUrl, input.sourceUrl);
        return { comfyFilename };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  // Whether the caller may flip a custom-flow node to the official ComfyUI cloud,
  // and whether the server has the cloud endpoint/key configured. Drives the
  // node's 本地/云端 toggle (disabled + hint when not allowed / not configured).
  cloudInfo: protectedProcedure.query(async ({ ctx }) => ({
    allowed: await isComfyuiCloudAllowed(ctx),
    configured: !!(ENV.comfyuiCloudBaseUrl && ENV.comfyuiCloudApiKey),
  })),

  executeWorkflow: protectedProcedure
    .input(z.object({
      nodeId: z.string(),
      projectId: z.number(),
      customBaseUrl: z.string().max(2048).optional(),
      useCloudComfy: z.boolean().optional(),
      workflowJson: z.string().max(500_000),
      paramValues: z.record(z.string(), z.unknown()),
      imageParamKeys: z.array(z.string().max(512)).max(64).optional(),
      outputNodeIds: z.array(z.string()).optional(),
      outputType: z.enum(["image", "video", "auto"]).default("auto"),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      // Cloud path: gated to admins / whitelisted users, uses server-side
      // endpoint + key. Local path is untouched (customBaseUrl or COMFYUI_BASE_URL).
      let baseUrl: string;
      let apiKey: string | undefined;
      if (input.useCloudComfy) {
        await assertComfyuiCloudAllowed(ctx);
        baseUrl = ENV.comfyuiCloudBaseUrl;
        apiKey = ENV.comfyuiCloudApiKey || undefined;
        if (!baseUrl || !apiKey) throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI 云服务未配置：请在服务端设置 COMFYUI_CLOUD_BASE_URL 与 COMFYUI_CLOUD_API_KEY" });
      } else {
        baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl;
        if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置：请在节点设置中填写或服务端设置 COMFYUI_BASE_URL" });
      }
      return dedupe("comfyui.executeWorkflow", ctx.user.id, input, async () => {
        try {
          const result = await executeCustomWorkflow(baseUrl, {
            workflowJson: input.workflowJson,
            paramValues: input.paramValues,
            imageParamKeys: input.imageParamKeys,
            outputNodeIds: input.outputNodeIds,
            outputType: input.outputType === "auto" ? undefined : input.outputType,
            projectId: input.projectId,
            nodeId: input.nodeId,
            apiKey,
          });
          writeAuditLog({
            ctx,
            action: "comfyui_workflow_exec",
            detail: { nodeId: input.nodeId, outputType: result.outputType, count: result.urls.length },
          });
          for (const u of result.urls) {
            await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, type: result.outputType === "video" ? "video" : "image", source: "generated", provider: "comfyui", model: null, url: u, name: "自定义工作流" });
          }
          return result;
        } catch (err) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
        }
      });
    }),
});

// ── AI Prompt Enhancement ─────────────────────────────────────────────────────
export const aiEnhanceRouter = router({
  enhance: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(8000),
        mode: z.enum(["expand", "translate_en", "polish", "storyboard_prompt", "translate_zh", "condense", "summarize"]),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const systemPrompts: Record<string, string> = {
        expand: `You are a creative writing assistant specializing in AI video generation prompts.
Expand the given text into a rich, detailed description with sensory details, atmosphere, lighting, composition, and cinematic qualities.
Keep the expanded text concise (2-4 sentences). Respond in the same language as the input. Output ONLY the expanded text.`,
        translate_en: `You are a professional translator specializing in AI image/video generation prompts.
Translate the given text to English, optimizing it for AI generation models.
Use vivid, descriptive, cinematic language. Output ONLY the English translation, nothing else.`,
        translate_zh: `You are a professional translator.
Translate the given text to Simplified Chinese.
Output ONLY the Chinese translation, nothing else.`,
        polish: `You are a professional screenwriter and script editor.
Polish the given script text to improve clarity, pacing, narrative flow, and dramatic tension.
Maintain the original story intent while enhancing the writing quality.
Respond in the same language as the input. Output ONLY the polished text.`,
        storyboard_prompt: `You are a cinematographer and storyboard artist.
Convert the given scene description into a detailed visual prompt for AI video/image generation.
Include: camera angle, lens type, lighting setup, composition, color palette, atmosphere, action.
Output an optimized English prompt under 80 words. Output ONLY the prompt text.`,
        condense: `You are a professional script editor. Condense the given script to approximately 60% of its original length while preserving all key story beats, character names, plot points, and dramatic tension. Maintain the original writing style and language. Output ONLY the condensed text, nothing else.`,
        summarize: `You are a professional story analyst. Extract a compelling one-to-two sentence synopsis from the given script or story content. Capture the core conflict, main characters, setting, and emotional tone. If the input is in Chinese, respond in Chinese. Output ONLY the synopsis, no labels or extra text.`,
      };
      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompts[input.mode] },
          { role: "user" as const, content: input.text },
        ],
        model: input.model ?? "gemini-2.5-flash",
      });
      return { result: extractTextContent(response).trim() };
    }),
});

// ── Deployment config / capability flags ──────────────────────────────────────
export const configRouter = router({
  // Whether upstream AI providers (Poyo / Higgsfield) can fetch a reference
  // image URL we hand them. Equivalent to "is our storage reachable from the
  // public internet" — true for Forge backend or when S3_PUBLIC_ENDPOINT is
  // configured. When false, a fully-private deployment can't pass reference
  // images to URL-only providers, so the frontend warns before spending credits.
  mediaReachability: protectedProcedure.query(async () => ({
    upstreamCanFetchMedia: canBrowserReachStorageDirectly(),
    backend: storageBackend(),
    // Admin toggle (readable by all users): auto-prefer the upstream AI temporary
    // public URL as the reference source when it probes alive. Off by default.
    preferUpstreamRefSource: (await getCachedStorageSettings()).preferUpstreamRefSource,
  })),
});
