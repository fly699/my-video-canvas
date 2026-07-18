import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { protectedProcedure, adminProcedure, levelProcedure, router } from "../_core/trpc";
import {
  getComfyGlobalServers,
  setComfyGlobalServers,
  getComfyGlobalGpuIndex,
  setComfyGlobalGpuIndex,
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
  getAssetsByProject,
  getAssetSummary,
  createAsset,
  recordGeneratedAsset,
  deleteAsset,
  getAssetById,
  updateAssetMeta,
  updateAssetThumbnail,
  getVideoTasksByProject,
  createVideoTask,
  updateVideoTask,
  completeVideoTaskIfProcessing,
  claimVideoTaskForSubmit,
  getVideoTask,
  findInFlightVideoTask,
  getChatMessages,
  addChatMessage,
  addChatMessagePair,
  clearChatMessages,
  listAiClientSessions,
  upsertAiClientSession,
  deleteAiClientSession,
  getTranscribeEndpointConfigRaw,
} from "../db";
import { storagePut, resolveToAbsoluteUrl, canBrowserReachStorageDirectly, storageBackend, assertObjectStorageWritable, isOwnStorageUrl, toInternalStoragePath, storagePresignPut, isStorageConfigured, finalizeStorageKey } from "../storage";
import { signUploadToken } from "../_core/uploadToken";
import { safeUploadMime, SAFE_UPLOAD_MIME_MSG } from "../_core/uploadMime";
import { getCachedStorageSettings } from "../_core/storageConfig";
import { getCachedDisabledModels } from "../_core/modelToggles";
import { getCachedSystemDefaultModels, getSystemDefaultModel } from "../_core/systemDefaultModels";
import { listBridgeSkills } from "../_core/bridgeSkills";
import { allSelfHostedModels } from "../_core/selfHostedLlm";
import { parseDocumentToText, isParsableDocument } from "../_core/documentParse";
import { extractTextContent, extractReasoning } from "../_core/llm";
import { invokeLLMWithKie } from "../_core/llmWithKie";
import { isClaudeBridgeEnabled } from "../_core/claudeBridge";
import { mergeAiBindings, parseAiBindings, nodeClassMap } from "../_core/workflowAiAnalyze";
import { generateImage } from "../_core/imageGeneration";
import { buildImageEditInstruction, IMAGE_EDIT_MODELS, DEFAULT_IMAGE_EDIT_MODEL } from "../../shared/imageEdit";
import { sliceGridImage } from "../_core/imageGrid";
import { extractStoryboardFrames } from "../_core/videoStoryboard";
import { generateComfyImage, generateComfyVideo, fetchComfyModels, fetchComfyServerStatus, analyzeWorkflow, validateWorkflow, convertUiWorkflowToApi, extractControlMap, CONTROL_MAP_PREPROCESSORS, executeCustomWorkflow, executeHunyuan3D, executeCloudWorkflow, testCloudConnection, uploadImageForWorkflow, interruptComfy, freeComfyMemory, getComfyQueueDepth, shouldFreeVram, clearComfyQueue, emptyModelList, emitComfyWorkflowResult } from "../_core/comfyui";
import { getComfyJob, setComfyJobDone, setComfyJobError } from "../_core/comfyJobStore";
import type { ComfyModelList } from "../_core/comfyui";
import { getComfyKnowledge, peekComfyKnowledge, searchComfyKnowledge, invalidateComfyKnowledge, getComfyModelList } from "../_core/comfyKnowledge";
import { ENV } from "../_core/env";
import { isPoyoVideoProvider, submitPoyoVideo, checkPoyoVideoStatus } from "../_core/poyoVideo";
import { isHiggsfieldVideoProvider, submitHiggsfieldVideo, checkHiggsfieldVideoStatus } from "../_core/higgsfield";
import { persistVideoOrFallback, persistVideosOrFallback } from "../_core/persistVideo";
import { extractHiggsfieldUrls, rehostMcpAsset } from "./agent";
import { stripRehostedUrls } from "./chat";
import { submitAndPollPoyoMusic, type PoyoMusicModel, type PoyoTTSModel } from "../_core/poyoAudio";
import { submitAndPollPoyoTTS, submitAndPollPoyoMusicTool } from "../_core/poyoAudio";
import { synthesizeOpenAITTS, type OpenAITTSModel } from "../_core/openaiTTS";
import { synthesizeGradioTTS } from "../_core/gradioTTS";
import { resolveVoxcpmBaseUrl, voxcpmDefaultSource } from "../_core/voxcpmConfig";
import { trimVideo, getVideoDuration, mergeVideos, burnSubtitles, generateSRT, overlayVideo, assertSafeUrl, burnAssSubtitles, smartCutVideo, detectSceneChanges, detectSilences, extractFrame, extractAudio, concatAudioSegments, processAudioClip } from "../_core/videoEditor";
import { transcribeAudio } from "../_core/voiceTranscription";
import { VIDEO_PROVIDERS, IMAGE_GEN_MODELS } from "../../shared/types";
import type { SubtitleEntry } from "../../shared/types";
import { assertWhitelisted, assertLLMAllowed, assertComfyuiAllowed, assertComfyuiCloudAllowed, isComfyuiCloudAllowed } from "../_core/whitelist";
import { resolveKieKey } from "../_core/kie";
import { isKieImageModel, kieImageSupportsNegative } from "../_core/kieImage";
import { isKieVideoProvider, submitKieVideo, detectOmnihumanSubjects } from "../_core/kieVideo";
import { isKieMusicModel, submitAndPollKieMusic } from "../_core/kieMusic";
import { isKieLLMModel } from "../_core/kieLLM";
import { isCustomLLMModel } from "../_core/customLlm";
import { isKieTTS, submitAndPollKieTTS } from "../_core/kieTTS";
import { submitAndPollKieSFX, KIE_SFX_MODEL } from "../_core/kieSFX";
import { encryptKieKey, decryptKieKey } from "../_core/kieCrypto";
import { writeAuditLog, truncate, auditVideoTaskResult } from "../_core/auditLog";
import { withComfyUsageLog } from "../_core/comfyUsageLog";
import { dedupe } from "../_core/idempotency";
import { runImageQc } from "../_core/imageQcCore";
import { runImageTag } from "../_core/imageTagCore";
import { extractVideoFrameJpeg, extractVideoTailFrameJpeg, extractVideoHeadFrameJpeg } from "../_core/videoFrame";
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

/** ComfyUI 地址解析：节点自定义 > 环境变量 COMFYUI_BASE_URL > 管理员全局服务器列表第一台。
 *  此前各入口都不查全局列表——用户在顶栏/后台添加了全局服务器，深度提取等未传自定义地址的
 *  调用仍报「未配置」（真实翻车）。统一收敛到本函数。 */
async function resolveComfyBase(customBaseUrl?: string): Promise<string> {
  const explicit = customBaseUrl?.trim();
  if (explicit) return explicit;
  if (ENV.comfyuiBaseUrl) return ENV.comfyuiBaseUrl;
  try { return (await getComfyGlobalServers())[0] ?? ""; } catch { return ""; }
}

const COMFY_NOT_CONFIGURED = "未配置 ComfyUI 服务器：请在 管理后台 →「ComfyUI 服务器」页（或画布顶栏服务器图标）添加全局地址，或在节点设置中填写自定义地址。";

// 本地媒体端点（ffmpeg 剪辑/合并/字幕/叠加）的 URL 校验：除了绝对 http(s) URL，
// 还必须接受自有存储的 `/manus-storage/…` 相对路径——ComfyUI、本地生成等节点的产物
// 正是以该相对路径存储。`z.string().url()` 会把相对路径误判为「Invalid URL」，而底层
// `downloadToTemp()`/`guardUrl()` 早已能解析它。所以这些端点统一改用本 schema。
const mediaUrlSchema = z
  .string()
  .refine((v) => /^https?:\/\//i.test(v) || v.startsWith("/manus-storage/"), {
    message: "必须是 http(s) URL 或 /manus-storage/ 存储路径",
  });

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

  // #175 首页独立 AI 客户端：获取/创建当前用户专用的「AI 客户端」项目（会话空间独立于画布工作）。
  getOrCreateAiClient: protectedProcedure.mutation(async ({ ctx }) => {
    const NAME = "AI 客户端";
    const owned = await getProjectsByUser(ctx.user.id);
    const existing = owned.find((p) => p.name === NAME);
    if (existing) return existing;
    const project = await createProject({ userId: ctx.user.id, name: NAME, description: "AI 客户端专用会话空间" });
    if (!project) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建 AI 客户端项目失败" });
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
        // Per-node-type default model config (toolbar-editable, project-level).
        defaultModels: z
          .object({
            categories: z.record(z.string(), z.string()).optional(),
            perSlot: z.record(z.string(), z.string()).optional(),
          })
          .nullable()
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // Editor+ may rename / change thumbnail / save viewport / set default models
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
        type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note", "audio", "post_process", "group", "character", "clip", "merge", "subtitle", "overlay", "subtitle_motion", "smart_cut", "pose_control", "voice_clone", "lip_sync", "avatar", "comfyui_image", "comfyui_video", "comfyui_workflow", "image_edit", "director", "agent", "super_agent", "compare"]),
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
          type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note", "audio", "post_process", "group", "character", "clip", "merge", "subtitle", "overlay", "subtitle_motion", "smart_cut", "pose_control", "voice_clone", "lip_sync", "avatar", "comfyui_image", "comfyui_video", "comfyui_workflow", "image_edit", "director", "agent", "super_agent", "compare"]),
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
    .query(async ({ ctx, input }) => {
      const commonFilter = {
        type: input?.type,
        source: input?.source,
        model: input?.model,
        q: input?.q?.trim() || undefined,
      };
      const projectId = input?.allProjects ? undefined : input?.projectId;
      // Project-scoped view: editors of a shared project see ONE common library
      // (every asset tied to the project, regardless of which collaborator made
      // it). Requires project access; falls back to personal library otherwise.
      if (projectId != null) {
        await assertProjectAccess(projectId, ctx.user.id, "viewer");
        return getAssetsByProject(projectId, commonFilter);
      }
      // Personal library (no project / all-projects): the caller's own assets.
      return getAssetsByUser(ctx.user.id, commonFilter);
    }),

  // Lightweight summary for the Home 素材库 entry card (count + a few cover URLs).
  summary: protectedProcedure
    .query(({ ctx }) => getAssetSummary(ctx.user.id)),

  // ── Streamed / presigned upload (large files; no base64 ~15MB cap) ──────────
  // Mirror of chat.createUploadUrl: hand the browser a direct upload URL so big
  // files don't go base64 through tRPC. Then confirmUpload indexes the asset.
  createUploadUrl: protectedProcedure
    .input(z.object({
      name: z.string().max(255),
      mimeType: z.string().max(128).refine(safeUploadMime, SAFE_UPLOAD_MIME_MSG),
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

  // E2 语义搜索：给素材做 AI 打标（视觉模型产出中文标签 + 一句话描述，写进 meta，
  // 搜索时与文件名联合命中）。仅本人素材；图片直接用原图，视频用封面图（无封面则不支持）。
  // 门控/计费/日志经 invokeLLMWithKie 统一入口自动继承；dedupe 防连点双付。
  tagAsset: protectedProcedure
    .input(z.object({ id: z.number(), model: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx, input.model);
      const asset = await getAssetById(input.id, ctx.user.id);
      if (!asset || asset.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "素材不存在或已删除" });
      let imgUrl = asset.type === "image" ? asset.url : (asset.thumbnailUrl || null);
      // E2 批2：无封面的视频素材 → ffmpeg 抽首帧（0.5s 失败回退 0s）存库作缩略图，
      // 一次抽帧长期复用（列表预览 + 后续重打标都用它），再继续打标。
      if (!imgUrl && asset.type === "video") {
        try {
          const frame = await extractVideoFrameJpeg(asset.url);
          const { url } = await storagePut(`u/${ctx.user.id}/thumbs/${nanoid()}-vthumb.jpg`, frame, "image/jpeg");
          await updateAssetThumbnail(asset.id, ctx.user.id, url);
          imgUrl = url;
        } catch (e) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `视频抽帧失败，无法打标：${e instanceof Error ? e.message.slice(0, 200) : "未知错误"}` });
        }
      }
      if (!imgUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "仅图片与视频素材支持 AI 打标" });
      return dedupe("assets.tagAsset", ctx.user.id, input, async () => {
        const r = await runImageTag(ctx, { imageUrl: imgUrl, name: asset.name, model: input.model });
        const prior = (asset.meta && typeof asset.meta === "object") ? asset.meta as Record<string, unknown> : {};
        const meta = { ...prior, aiTags: r.tags, aiDesc: r.desc, aiModel: input.model ?? "gpt-5.2", taggedAt: Date.now() };
        await updateAssetMeta(asset.id, ctx.user.id, meta);
        return { id: asset.id, meta };
      });
    }),

  // 视频素材补缩略图（无 LLM、无门控）：服务端抽首帧存库。素材库网格用静态缩略图替代
  // <video> 解码器（大量视频素材同时建解码器会把浏览器主线程卡到「页面无响应」），
  // 旧视频没有缩略图时由前端懒补调用此端点。已有缩略图直接返回（幂等）。
  makeThumbnail: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await getAssetById(input.id, ctx.user.id);
      if (!asset || asset.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "素材不存在或已删除" });
      if (asset.type !== "video") throw new TRPCError({ code: "BAD_REQUEST", message: "仅视频素材需要补缩略图" });
      if (asset.thumbnailUrl) return { thumbnailUrl: asset.thumbnailUrl };
      const frame = await extractVideoFrameJpeg(asset.url);
      const { url } = await storagePut(`u/${ctx.user.id}/thumbs/${nanoid()}-vthumb.jpg`, frame, "image/jpeg");
      await updateAssetThumbnail(asset.id, ctx.user.id, url);
      return { thumbnailUrl: url };
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
      // SSRF: re-validate the POST-redirect URL. `redirect: "follow"` may have
      // landed on a private/loopback host that the initial guardUrl(input.url)
      // couldn't see (a public URL 302-ing to 169.254.169.254 / 内网). Block
      // before reading the body so an internal response can't be exfiltrated
      // into the asset library. Mirrors imageProxy/videoProxy's re-check.
      if (res.url) guardUrl(res.url);
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

/** 剥离仅供服务端后台轮询器使用的内部 params 字段（`_` 前缀，尤其加密的 kie 凭据 `_kieKeyEnc`），
 *  绝不能随 task 越过信任边界返回给客户端——否则同项目任一 viewer 都能读到他人/公用凭据的密文
 *  （虽是 AES-GCM 密文、无 KIE_KEY_SECRET 不可解，仍属凭据材料越权外发）。客户端不读任何 `_` 字段。 */
export function sanitizeTaskForClient<T>(task: T): T {
  if (!task || typeof task !== "object") return task;
  const p = (task as { params?: unknown }).params;
  if (!p || typeof p !== "object") return task;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) if (!k.startsWith("_")) cleaned[k] = v;
  return { ...(task as object), params: cleaned } as T;
}

export const videoTasksRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
      return (await getVideoTasksByProject(input.projectId)).map(sanitizeTaskForClient);
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
        // Multi-modal references (Seedance-2 / Wan-2.7 reference mode).
        referenceVideoUrls: z.array(z.string()).max(3).optional(),
        referenceAudioUrls: z.array(z.string()).max(3).optional(),
        // OmniHuman 主体蒙版：指定肖像中哪个主体说话（来自 Subject Detection）。
        maskUrls: z.array(z.string()).max(5).optional(),
        // "reference" = the reference images are character SUBJECTS (identity), so
        // route them to reference_image_urls (multi-reference) rather than首尾帧.
        referenceMode: z.enum(["reference", "frame"]).optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        // kie.ai temp key (localStorage kie:tempKey) — only used for kie_* providers.
        kieTempKey: z.string().max(256).optional(),
        // 客户端按所选模型+参数实时计算的点数预估（如 "≈60 点"），仅供管理员日志参考。
        estimatedCost: z.string().max(32).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // kie.ai video models have their OWN auth (temp > assigned > house, see
      // resolveKieKey) and bypass the Poyo/Higgsfield whitelist. The resolved key
      // is stashed encrypted in params (_kieKeyEnc) so the detached poller can
      // poll recordInfo without a user context. Non-kie keeps the whitelist gate.
      let kieKeyEnc: string | undefined;
      if (isKieVideoProvider(input.provider)) {
        const resolved = await resolveKieKey(ctx, input.kieTempKey);
        kieKeyEnc = encryptKieKey(resolved.key);
      } else {
        await assertWhitelisted(ctx);
      }
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      // Validate every reference URL (single + multi) the same way.
      const validateRef = (u: string) => {
        if (u.match(/^https?:\/\//)) guardUrl(u);
        else if (!u.startsWith("/")) throw new TRPCError({ code: "BAD_REQUEST", message: "不支持的 URL 协议，仅允许 http/https 或相对路径" });
      };
      if (input.referenceImageUrl) validateRef(input.referenceImageUrl);
      for (const u of input.referenceImageUrls ?? []) if (u?.trim()) validateRef(u.trim());
      for (const u of input.referenceVideoUrls ?? []) if (u?.trim()) validateRef(u.trim());
      for (const u of input.referenceAudioUrls ?? []) if (u?.trim()) validateRef(u.trim());
      // Coalesced reference list: prefer the multi-image array, fall back to the
      // single field. Drives both the inline submit and the persisted params.
      const refList = (input.referenceImageUrls?.length ? input.referenceImageUrls : (input.referenceImageUrl ? [input.referenceImageUrl] : []))
        .map((u) => u?.trim()).filter((u): u is string => Boolean(u));
      const clean = (l?: string[]) => (l ?? []).map((u) => u?.trim()).filter((u): u is string => Boolean(u));
      const refVideos = clean(input.referenceVideoUrls);
      const refAudios = clean(input.referenceAudioUrls);
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
      const baseParams = (input.params as Record<string, unknown> | undefined) ?? undefined;
      // Only stash reference mode when it'd actually change mapping (reference + ≥1 ref).
      const stashRefMode = input.referenceMode === "reference" && refList.length > 0;
      const needsStash = refList.length > 1 || refVideos.length > 0 || refAudios.length > 0 || stashRefMode || !!kieKeyEnc || !!input.estimatedCost;
      const mergedParams: Record<string, unknown> | undefined = needsStash
        ? {
            ...(baseParams ?? {}),
            ...(refList.length > 1 ? { _referenceImageUrls: refList } : {}),
            ...(refVideos.length > 0 ? { _referenceVideoUrls: refVideos } : {}),
            ...(refAudios.length > 0 ? { _referenceAudioUrls: refAudios } : {}),
            ...(stashRefMode ? { _refMode: "reference" } : {}),
            // Encrypted kie key for the poller (filtered from any upstream payload
            // by kieVideo's allow-list — it only copies spec'd param keys).
            ...(kieKeyEnc ? { _kieKeyEnc: kieKeyEnc } : {}),
            // 预估点数随任务存档，供异步终态日志（auditVideoTaskResult）回读。
            ...(input.estimatedCost ? { _estimatedCost: input.estimatedCost } : {}),
          }
        : baseParams;

      // Idempotency + concurrent-create guard for a node's in-flight video task.
      // findInFlightVideoTask handles the SEQUENTIAL duplicate (a task already
      // pending/processing → reuse it). But two CONCURRENT requests for the same
      // node can both pass that check before either INSERTs — the table has no
      // unique (projectId,nodeId) in-flight constraint — yielding two rows that
      // each get claimed & submitted upstream → real double charge. dedupe (keyed
      // ONLY on projectId+nodeId, never on display fields like estimatedCost so
      // the merge can't be bypassed) collapses the get-or-create into ONE shared
      // row; the per-row claim-lock below then admits exactly one provider submit.
      const { task, preexisting } = await dedupe(
        "videoCreateRow", ctx.user.id,
        { projectId: input.projectId, nodeId: input.nodeId },
        async () => {
          const existing = await findInFlightVideoTask(input.projectId, input.nodeId);
          if (existing) return { task: existing, preexisting: true as const };
          // Create DB record first so the task is tracked even if submission fails.
          const created = await createVideoTask({
            userId: ctx.user.id,
            projectId: input.projectId,
            nodeId: input.nodeId,
            provider: input.provider,
            prompt: input.prompt,
            negativePrompt: input.negativePrompt,
            referenceImageUrl: refList[0] ?? input.referenceImageUrl,
            params: mergedParams,
            status: "pending" as const,
          });
          return { task: created, preexisting: false as const };
        },
      );
      if (preexisting) return sanitizeTaskForClient(task);
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
        return sanitizeTaskForClient({ ...task, status: "processing" as const });
      } else {
        try {
          if (isPoyoVideoProvider(input.provider)) {
            const result = await submitPoyoVideo({
              provider: input.provider,
              prompt: input.prompt,
              negativePrompt: input.negativePrompt,
              referenceImageUrl: refList[0] ?? input.referenceImageUrl,
              referenceImageUrls: refList.length > 1 ? refList : undefined,
              referenceVideoUrls: refVideos.length > 0 ? refVideos : undefined,
              referenceAudioUrls: refAudios.length > 0 ? refAudios : undefined,
              referenceMode: input.referenceMode,
              params: input.params as Record<string, unknown>,
            });
            externalTaskId = result.externalTaskId;
          } else if (isHiggsfieldVideoProvider(input.provider)) {
            const result = await submitHiggsfieldVideo({
              provider: input.provider,
              prompt: input.prompt,
              negativePrompt: input.negativePrompt,
              // 与 Poyo/kie 分支及 DB 落库(739)、后台轮询器一致取 refList[0]——否则客户端只传
              // referenceImageUrls 数组(DoP 契约支持)时 input.referenceImageUrl 为 undefined，
              // submitHiggsfieldVideo 直接抛「必须提供参考图」，任务被内联标 failed[CHARGED?] 无法重试。
              referenceImageUrl: refList[0] ?? input.referenceImageUrl,
              params: input.params as Record<string, unknown>,
            });
            externalTaskId = result.externalTaskId;
          } else if (isKieVideoProvider(input.provider)) {
            const result = await submitKieVideo({
              provider: input.provider,
              prompt: input.prompt,
              apiKey: decryptKieKey(kieKeyEnc!),
              referenceImageUrls: refList,
              referenceVideoUrls: refVideos.length ? refVideos : undefined,
              referenceAudioUrls: refAudios.length ? refAudios : undefined,
              maskUrls: input.maskUrls?.length ? input.maskUrls : undefined,
              negativePrompt: input.negativePrompt,
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
          ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
          // 提交即失败 → 直接记终态；提交成功的终态由轮询完成时补记（phase:"result"）。
          ...(submitFailed ? { success: false } : {}),
        },
      });

      if (externalTaskId) {
        return sanitizeTaskForClient({ ...task, status: "processing" as const, externalTaskId });
      }
      if (submitFailed) {
        return sanitizeTaskForClient({ ...task, status: "failed" as const });
      }
      // Claim succeeded but no provider matched (unknown provider — shouldn't
      // happen given the enum validator) and no submit attempt was made.
      // Task is now `processing` with no externalTaskId; poller will skip it.
      return sanitizeTaskForClient({ ...task, status: "processing" as const });
    }),

  // OmniHuman「指定说话主体」：对肖像图跑主体检测，返回各主体蒙版图 URL（≤5）。
  // 客户端据此让用户勾选哪个主体说话，写入 payload.mask_url 后随生成一并提交。
  detectOmnihumanSubjects: protectedProcedure
    .input(z.object({
      imageUrl: z.string().min(1).max(2048),
      kieTempKey: z.string().max(256).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { key } = await resolveKieKey(ctx, input.kieTempKey);
      const r = await detectOmnihumanSubjects(input.imageUrl, key);
      // #73 纳管审计：Omnihuman 主体检测（kie 视觉调用）此前无审计记录
      writeAuditLog({ ctx, action: "omnihuman_detect", detail: { success: true } });
      return r;
    }),

  poll: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const raw = await getVideoTask(input.id);
      if (!raw) return null;
      // Project-level access (editor+). Previously hard-checked task.userId,
      // which broke once any editor (not just owner) could create tasks —
      // the owner could see the task in the UI but couldn't poll it.
      await assertProjectAccess(raw.projectId, ctx.user.id, "editor");
      // 从这里起用剥离了内部 `_` 字段（含加密凭据 _kieKeyEnc）的副本——poll 的所有返回分支都把 task
      // 回给客户端，且轮询逻辑只读 status/externalTaskId/provider 等非内部字段，故整段用 sanitized 版安全。
      const task = sanitizeTaskForClient(raw);

      // 同步上游状态会用平台公用 key（Poyo/Higgsfield）。非白名单用户/协作者不得借 poll 触达公用 key——
      // 此时跳过上游同步、直接返回当前状态（后台 poller 用平台凭证仍会推进），既守门控又不打断 UI。
      // kie 任务不在此处同步（用任务内自带 key），故只对 Poyo/Higgsfield 门控。
      const usesHouseUpstream = task.status === "processing" && !!task.externalTaskId &&
        (isPoyoVideoProvider(task.provider) || isHiggsfieldVideoProvider(task.provider));
      if (usesHouseUpstream) {
        try { await assertWhitelisted(ctx); } catch { return task; }
      }

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
                if (await completeVideoTaskIfProcessing(task.id, update)) auditVideoTaskResult(task, false, update.errorMessage);
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
              // CAS：仅首个把 processing→succeeded 的调用方 record/audit，避免与后台 poller 双写重复素材。
              if (await completeVideoTaskIfProcessing(task.id, update)) {
                auditVideoTaskResult(task, true);
                for (const u of persistedList) {
                  await recordGeneratedAsset({ userId: task.userId, projectId: task.projectId, nodeId: task.nodeId, type: "video", source: "generated", provider: task.provider, model: (task.params as { model?: string } | null)?.model ?? task.provider, url: u, name: task.provider });
                }
              }
              return { ...task, ...update };
            }
            if (upstream.status === "failed") {
              pollLastCheck.delete(task.externalTaskId);
              const update = { status: "failed" as const, errorMessage: upstream.errorMessage ?? "生成失败" };
              if (await completeVideoTaskIfProcessing(task.id, update)) auditVideoTaskResult(task, false, update.errorMessage);
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
              if (await completeVideoTaskIfProcessing(task.id, update)) {
                auditVideoTaskResult(task, true);
                await recordGeneratedAsset({ userId: task.userId, projectId: task.projectId, nodeId: task.nodeId, type: "video", source: "generated", provider: task.provider, model: (task.params as { model?: string } | null)?.model ?? task.provider, url: persisted, name: task.provider });
              }
              return { ...task, ...update };
            }
            if (upstream.status === "succeeded" && !upstream.resultVideoUrl) {
              pollLastCheck.delete(task.externalTaskId);
              // Credits spent; [CHARGED] blocks UI from one-click resubmit.
              const update = { status: "failed" as const, errorMessage: "[CHARGED] 视频已在 Higgsfield 生成完成，但本系统未识别 URL（积分已扣，请勿重试）" };
              if (await completeVideoTaskIfProcessing(task.id, update)) auditVideoTaskResult(task, false, update.errorMessage);
              return { ...task, ...update };
            }
            if (upstream.status === "failed") {
              pollLastCheck.delete(task.externalTaskId);
              const update = { status: "failed" as const, errorMessage: upstream.errorMessage ?? "生成失败" };
              if (await completeVideoTaskIfProcessing(task.id, update)) auditVideoTaskResult(task, false, update.errorMessage);
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
        kieTempKey: z.string().max(256).optional(), // kie_* chat models only
      })
    )
    .mutation(async ({ ctx, input }) => {
      // kie chat models authenticate with their own key (temp > assigned > house)
      // and bypass the LLM whitelist; everything else keeps the LLM gate.
      // 实际的 key 解析与权限门控在下方 invokeLLMWithKie 内统一进行（与所有其它 LLM 入口一致）。
      if (!isKieLLMModel(input.model) && !isCustomLLMModel(input.model)) {
        // Gate on whitelist before access check so banned users get a uniform
        // "not whitelisted" error rather than a project FORBIDDEN; this also
        // closes the gap that let an editor invoke the LLM without any
        // platform-side limit (all other AI mutations call assertWhitelisted).
        // LLM-scoped gate: respects the admin "open LLM" bypass.
        // 自定义模型同 kie：自带 key 体系，门控收敛到 invokeLLMWithKie（自带 key 放行 / env 兜底门控）。
        await assertLLMAllowed(ctx, input.model);
      }
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
      let reasoning = "";
      try {
        // kie 模型与其它模型统一走 invokeLLMWithKie：内部按 临时(显式 kieTempKey 或请求头)>分配>公用
        // 解析并校验权限。显式 input.kieTempKey 优先（与历史行为一致）。
        const response = await invokeLLMWithKie(ctx, { messages, model: input.model }, input.kieTempKey);
        assistantContent = extractTextContent(response) || "（模型返回内容为空）";
        reasoning = extractReasoning(response); // 推理模型的「思考过程」，单独存/展示（不进正式答案）
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // AI 生成产物落地（与聊天室 sendToAssistant 同款，#37）：本机 Claude/GPT 桥接挂 Higgsfield
      // MCP 时，回复常带其外链（约 24h 过期、绕过下载门控）。① 转存自有 S3 并记入素材库
      // （rehostMcpAsset，与画布助手/聊天室走同一存储守卫，故不会像「AI 生成结果无写入权限」那样失败）；
      // ② 裸外链替换为占位；③ 产物作为助手附件下发，AI 客户端内联渲染 + 可落成节点。
      // 附件 = 「思考过程」（推理模型）+ 转存的 AI 图产物。存进 attachments JSON（不进 content），
      // 故画布 ai_chat 节点/历史/agent 等 content 消费方不受影响；AI 客户端读取并渲染折叠「思考过程」。
      const assistantAtts: Array<{ type: "image" | "file" | "reasoning"; url?: string; mimeType?: string; name?: string; text?: string }> = [];
      if (reasoning) assistantAtts.push({ type: "reasoning", text: reasoning, name: "思考过程" });
      try {
        const hfUrls = extractHiggsfieldUrls(assistantContent).slice(0, 6);
        if (hfUrls.length > 0) {
          const replaced: Array<{ url: string; type: string }> = [];
          for (const oldUrl of hfUrls) {
            const r = await rehostMcpAsset(ctx.user.id, input.projectId, oldUrl);
            if (!r) continue;
            assistantAtts.push({ type: r.type === "image" ? "image" : "file", url: r.url, mimeType: r.mimeType, name: r.name });
            replaced.push({ url: oldUrl, type: r.type });
          }
          assistantContent = stripRehostedUrls(assistantContent, replaced);
        }
      } catch { /* 落地失败不影响正常回复 */ }
      const assistantAttachments = assistantAtts.length > 0 ? assistantAtts : undefined;

      // Persist user message (with attachments) and assistant reply (with rehosted media) atomically.
      await addChatMessagePair(
        input.nodeId,
        input.projectId,
        input.message,
        assistantContent,
        input.attachments?.length ? input.attachments : undefined,
        assistantAttachments,
      );

      return { content: assistantContent, attachments: assistantAttachments };
    }),

  clearMessages: protectedProcedure
    .input(z.object({ nodeId: z.string(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await clearChatMessages(input.nodeId, input.projectId);
      return { success: true };
    }),

  // ── AI 客户端会话索引（#174，随账号持久化；无节点会话跨设备可见）──
  listSessions: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
      return listAiClientSessions(ctx.user.id, input.projectId);
    }),
  upsertSession: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      sessionId: z.string().max(64),
      title: z.string().max(200),
      model: z.string().max(64).optional(),
      contextNodeIds: z.array(z.string().max(64)).max(64).optional(),
      updatedAt: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await upsertAiClientSession(ctx.user.id, input.projectId, {
        sessionId: input.sessionId, title: input.title, model: input.model ?? null,
        contextNodeIds: input.contextNodeIds ?? null, updatedAt: input.updatedAt,
      });
      return { success: true };
    }),
  deleteSession: protectedProcedure
    .input(z.object({ projectId: z.number(), sessionId: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await deleteAiClientSession(ctx.user.id, input.projectId, input.sessionId);
      return { success: true };
    }),

  // Parse an office document (PDF / Word / PPT / Excel / …) to plain text on the
  // server. The browser can't read binary office formats, and the self-hosted
  // Qwen vLLM endpoint is text-only (it can't ingest a document the way the cloud
  // gateways can) — so the AI-chat node sends the raw bytes here and inlines the
  // returned text as the attachment's `textContent`. Pure-JS, fully offline.
  parseDocument: protectedProcedure
    .input(z.object({
      base64: z.string().max(24_000_000), // ~18MB once decoded (client caps file at 10MB)
      mimeType: z.string().max(128),
      filename: z.string().max(255),
    }))
    .mutation(async ({ input }) => {
      if (!isParsableDocument(input.filename, input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `不支持解析的文档类型：${input.filename}` });
      }
      const bytes = Buffer.from(input.base64, "base64");
      if (bytes.byteLength === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "文件内容为空" });
      if (bytes.byteLength > 16 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "文档超过 16MB，无法解析" });
      const text = await parseDocumentToText(new Uint8Array(bytes), { filename: input.filename, mimeType: input.mimeType });
      if (!text.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "未能从该文档提取到文本（可能是扫描件或纯图片文档）" });
      return { text, chars: text.length };
    }),
});

// ── Image Generation ──────────────────────────────────────────────────────────

export const imageGenRouter = router({
  generate: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(8000), // bound to avoid unbounded payloads (char-injected prompts stay well under)
        negativePrompt: z.string().max(4000).optional(), // 与 video.create 一致；防超大 payload
        referenceImageUrl: z.string().max(2048).optional(),
        // Multi-angle reference images (first mirrors referenceImageUrl). Edit/
        // unified models read all of these via `image_urls`.
        referenceImageUrls: z.array(z.string().max(2048)).max(8).optional(),
        style: z.string().max(2000).optional(),
        model: z.enum(IMAGE_GEN_MODELS).optional(),
        poyoAspectRatio: z.string().max(32).optional(),
        // Generic aspect ratio (the 比例 selector) — used by kie image models,
        // clamped per-model server-side.
        aspectRatio: z.string().max(32).optional(),
        poyoQuality: z.enum(["low", "medium", "high"]).optional(),
        // Generic Poyo image params (schema-driven, extended model set)
        imageSize: z.string().max(64).optional(),
        imageResolution: z.enum(["0.5K", "1K", "2K", "3K", "4K"]).optional(),
        imageN: z.number().int().min(1).max(15).optional(),
        imageOutputFormat: z.enum(["png", "jpg", "jpeg", "webp"]).optional(),
        widthAndHeight: z.string().max(64).optional(),
        quality: z.enum(["720p", "1080p"]).optional(),
        batchSize: z.union([z.literal(1), z.literal(4)]).optional(),
        seed: z.number().int().optional(),
        enhancePrompt: z.boolean().optional(),
        // Reve specific params
        reveAspectRatio: z.string().max(32).optional(),
        // v2 image endpoints (reve / seedream / flux-pro) use coarse K-tier
        // labels rather than px-based 720p/1080p (those are Soul-only).
        reveResolution: z.enum(["1K", "2K", "4K"]).optional(),
        // Flux Pro Kontext extra params
        fluxGuidanceScale: z.number().min(1).max(20).optional(),
        fluxSeed: z.number().int().optional(),
        fluxNumImages: z.number().int().min(1).max(4).optional(),
        // kie.ai: optional user-entered temporary key (from the toolbar popup).
        kieTempKey: z.string().max(256).optional(),
        // 客户端实时计算的点数预估（如 "≈5 cr"），仅供管理员日志参考。
        estimatedCost: z.string().max(32).optional(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // kie.ai models have their OWN auth (temp > assigned > house, see resolveKieKey)
      // — they bypass the global whitelist so admin-assigned/temp-key users can use
      // them. Non-kie models keep the exact existing whitelist gate.
      let kieApiKey: string | undefined;
      if (isKieImageModel(input.model)) {
        const resolved = await resolveKieKey(ctx, input.kieTempKey);
        kieApiKey = resolved.key;
      } else {
        await assertWhitelisted(ctx);
      }
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
      // 失败也要计入管理员日志（带预估点数 + success:false），随后原样抛出。
      return dedupe("imageGen", ctx.user.id, input, async () => {
      const isHfModel = input.model?.startsWith("hf_");
      // 原生支持 negative_prompt 的图像模型：Higgsfield 全系 + kie 的 Imagen4 家族 /
      // Ideogram V3 / Qwen 系列（docs 对照，见 kieImage.ts negPrompt）。这些走「干净 prompt +
      // 单独传 negativePrompt」；其余模型（Poyo / Forge / 无 negative 的 kie）API 无该字段，
      // 退回把负向词塞进 prompt 当「Avoid: …」后缀（聊胜于无）。
      const negSeparate = !!isHfModel || kieImageSupportsNegative(input.model);

      const fullPrompt = negSeparate
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
        ...(negSeparate && input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
        ...(allRefUrls.length
          ? { originalImages: allRefUrls.map((url) => ({ url, mimeType: "image/jpeg" })) }
          : {}),
        // All Poyo image models share the generic param channel; the backend
        // spec table (POYO_IMAGE_SPECS) decides which fields each model actually
        // sends. `imageSize` (new ParamDef field) falls back to the legacy
        // `poyoAspectRatio` so old nodes keep working.
        // 「默认模型」（model 未传）同样路由到 Poyo（generateImage 兜底分支），比例/画质
        // 参数必须一并透传——此前只对 poyo_ 前缀生效，默认路径 size 丢失 → 工具箱推演/
        // 宫格产物落回上游默认方图（真实故障：1937×812 宽幅源图推演出 960×960）。
        ...(input.model?.startsWith("poyo_") || !input.model ? {
          size: input.imageSize ?? input.poyoAspectRatio ?? input.aspectRatio,
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
        // kie.ai models: pass the resolved key + a single aspect-ratio (createTask
        // input.aspect_ratio). originalImages (above) feeds image_urls for edit models.
        ...(isKieImageModel(input.model) ? {
          kieApiKey,
          size: input.aspectRatio ?? input.imageSize ?? input.poyoAspectRatio ?? input.reveAspectRatio,
          // 可选分辨率档（如 GPT Image 2 1K/2K/4K，逐档计价）；服务端按模型 resOptions 夹取。
          resolution: input.imageResolution,
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
          ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
          success: true,
        },
      });
      {
        const prov = input.model?.startsWith("hf_") ? "higgsfield" : input.model?.startsWith("poyo_") ? "poyo" : input.model?.startsWith("kie_") ? "kie" : "forge";
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
      }).catch((err: unknown) => {
        writeAuditLog({
          ctx,
          action: "image_gen",
          detail: {
            model: input.model ?? "default",
            prompt: truncate(input.prompt),
            ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
            success: false,
            error: truncate(err instanceof Error ? err.message : String(err)),
          },
        });
        throw err;
      });
    }),
});

// ── Scripts ───────────────────────────────────────────────────────────────────

// ── Script → storyboard scene generation: shared helpers ──────────────────────
// Prompt-style guidance per target generation model so each scene's promptText is
// written the way that model expects. Covers cloud video models AND mainstream
// ComfyUI models (Qwen / Flux / SDXL / Wan / Hunyuan / LTXV / CogVideoX).
const MODEL_PROMPT_GUIDES: Record<string, string> = {
  // ── Cloud video models ──
  kling: "Kling (Kuaishou): excellent precise camera control. Use detailed camera moves (push-in, dolly, orbital pan, crane). Rich motion with emotional narrative; describe subject actions precisely.",
  veo: "Veo 3.1 (Google): natural-language understanding. Use flowing natural English; emphasize realistic physics, human emotion, complex interaction. Write like a film scene description — no keyword lists.",
  runway: "Runway Gen-4.5: concise style-focused prompt under 60 words. Lead with aesthetic style, then subject and action: [cinematography style], [subject] [action], [environment], [lighting].",
  wan: "Wan 2.5 (Alibaba, cloud): structured keyword prompt — subject, action, environment/background, visual style, lighting, camera angle. Good for stylized artistic content.",
  seedance: "Seedance 2 (ByteDance): photorealistic. Include shot type (ECU/CU/MS/LS), lens focal length, lighting setup, color-grade style, specific camera movement. Professional cinematography terms.",
  dop: "DoP/Higgsfield: professional director's language. Specify focal length, aperture, lighting type & color temperature, film-stock look, composition rule, emotional subtext. Cinematic excellence.",
  // ── ComfyUI image models ──
  qwen: "Qwen-Image (ComfyUI, Alibaba): bilingual (中/英) natural-language description, excellent legible-text rendering. Write a flowing, detailed scene — subject, setting, composition, lighting, art style — in natural sentences. May specify on-screen text. Avoid keyword spam and weight syntax.",
  flux: "Flux.1 (ComfyUI, Black Forest Labs): dense, highly prompt-adherent natural language. One rich paragraph: subject + action, composition & framing, lens/optics, lighting direction & quality, color palette, mood. No tag lists, no weight syntax, no inline negatives.",
  sdxl: "SDXL / Pony (ComfyUI): Danbooru-style comma-separated tags plus quality boosters. Order: subject tags, details, action, setting, art style, lighting, (masterpiece, best quality, highly detailed). Relies heavily on a strong separate negative prompt.",
  // ── ComfyUI video models ──
  wan_local: "Wan 2.2 (ComfyUI local, Alibaba): structured motion prompt — subject, concrete physical action, environment, camera movement, visual style. Describe motion that unfolds over time. Works for T2V and I2V.",
  hunyuan: "HunyuanVideo (ComfyUI, Tencent): cinematic natural-language film prose. Emphasize subject motion, camera movement, atmosphere and lighting evolution across the shot.",
  ltxv: "LTX-Video (ComfyUI): concise, motion-first prompt under ~50 words. State the subject, the single key action/motion, the camera move, and the setting. Avoid static descriptive clutter.",
  cogvideox: "CogVideoX (ComfyUI): detailed temporal description — how subject and camera evolve through the shot, beat by beat. Specify motion arc, pacing and continuity.",
};

function buildModelGuide(target?: string): string {
  if (!target) return "General cinematic: descriptive prompts with subject, action, composition, lighting, color and camera information, plus a quality negative prompt.";
  return MODEL_PROMPT_GUIDES[target] ?? "General cinematic: descriptive prompts with visual detail, lighting, color and camera information.";
}

const VALID_CAMERA_MOVEMENTS = ["static", "pan-left", "pan-right", "zoom-in", "zoom-out", "tilt-up", "tilt-down", "tracking"];

export interface GeneratedScene {
  description: string;
  promptText: string;
  negativePrompt: string;
  cameraMovement: string;
  duration: number;
  shotType?: string;
  lens?: string;
  lighting?: string;
  colorGrade?: string;
  // ── 行业 Shot List 标准字段 ──
  dialogue?: string;   // 对白/旁白（可直接作配音文案）
  sfx?: string;        // 音效/BGM 意图
  transition?: string; // 到下一镜的转场
  beatRef?: string;    // 所属节拍表拍点
}

/** The JSON field contract handed to the LLM for each storyboard scene. Includes
 *  professional cinematography fields + a negative prompt (critical for ComfyUI). */
function sceneFieldsInstruction(promptLangName: string, avgDuration: number): string {
  return `Each element MUST be an object with EXACTLY these fields:
- "description": string — Chinese (中文), 2-3 sentences describing what the viewer sees.
- "promptText": string — ${promptLangName}. A detailed, production-ready generation prompt that STRICTLY FOLLOWS THE STYLE GUIDE above. Bake the professional cinematography (shot size, lens, lighting, color) into it the way the target model expects.
- "negativePrompt": string — ${promptLangName}. Quality defects / unwanted elements to avoid (e.g. blurry, low quality, deformed anatomy, extra limbs, text artifacts, watermark, oversaturation, harsh banding). Tailor to the medium.
- "shotType": string — one of: ECU, CU, MS, MLS, WS, establishing.
- "lens": string — a focal length such as 24mm, 35mm, 50mm, 85mm, 135mm.
- "lighting": string — short lighting setup (e.g. "soft key + rim, golden hour", "low-key chiaroscuro 3200K").
- "colorGrade": string — short grade/palette (e.g. "warm teal-orange", "desaturated cold blue", "Kodak Portra").
- "cameraMovement": string — one of: static, pan-left, pan-right, zoom-in, zoom-out, tilt-up, tilt-down, tracking.
- "duration": number — integer seconds, around ${avgDuration}.
- "dialogue": string — Chinese (中文). The spoken dialogue or voice-over line for this shot, ready for TTS dubbing ("角色名：台词" or narration text). Empty string if the shot is silent.
- "sfx": string — Chinese (中文). Sound effect / music intent for this shot (e.g. "雨声渐强 + 低音弦乐"). Empty string if none.
- "transition": string — transition INTO the next shot, one of: cut, dissolve, fade, wipe, match-cut. Use "cut" by default.`;
}

/** Validate + normalize one raw scene object from the LLM into a GeneratedScene. */
function normalizeScene(raw: Record<string, unknown>, avgDuration: number): GeneratedScene {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const cam = str(raw.cameraMovement);
  const durNum = typeof raw.duration === "number" && isFinite(raw.duration) ? Math.round(raw.duration) : avgDuration;
  return {
    description: str(raw.description),
    promptText: str(raw.promptText),
    negativePrompt: str(raw.negativePrompt),
    cameraMovement: VALID_CAMERA_MOVEMENTS.includes(cam) ? cam : "static",
    duration: Math.max(1, Math.min(120, durNum || avgDuration)),
    shotType: str(raw.shotType) || undefined,
    lens: str(raw.lens) || undefined,
    lighting: str(raw.lighting) || undefined,
    colorGrade: str(raw.colorGrade) || undefined,
    dialogue: str(raw.dialogue) || undefined,
    sfx: str(raw.sfx) || undefined,
    transition: str(raw.transition) || undefined,
    beatRef: str(raw.beatRef) || (typeof raw.beatRef === "number" ? String(raw.beatRef) : undefined),
  };
}

export const scriptsRouter = router({
  generateStoryboards: protectedProcedure
    .input(
      z.object({
        content: z.string().min(1),
        synopsis: z.string().optional(),
        count: z.number().int().min(2).max(8).default(4),
        targetVideoModel: z.string().optional(),
        model: z.string().optional(),
        promptLang: z.enum(["zh", "en"]).default("en"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.generateStoryboards", ctx.user.id, input, async () => {
      const promptLangName = input.promptLang === "zh" ? "Chinese (中文)" : "English";
      // Heuristic average so the LLM picks sane per-scene durations even though
      // this path has no explicit total-duration input.
      const avgDuration = 5;
      const systemPrompt = `You are a professional film director and storyboard artist. Break the given script into exactly ${input.count} visual storyboard scenes.

Target generation-model prompt style guide (write every promptText to match it):
${buildModelGuide(input.targetVideoModel)}

Output ONLY a valid JSON array — no markdown fences, no prose before or after.
${sceneFieldsInstruction(promptLangName, avgDuration)}`;

      const userContent = [
        input.synopsis ? `Synopsis: ${input.synopsis}\n\n` : "",
        `Script:\n${input.content}`,
      ].join("");

      const response = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userContent },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
        maxTokens: 4000,
      });

      const text = extractTextContent(response);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });

      let raw: Array<Record<string, unknown>>;
      try {
        raw = JSON.parse(jsonMatch[0]);
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" });
      }
      const scenes = raw.slice(0, input.count).map((s) => normalizeScene(s, avgDuration));
      return { scenes };
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
        /** 节拍表（开发阶段流产物，文本化）。给出时剧本必须逐拍展开，结构受其约束。 */
        beatSheetText: z.string().max(4000).optional(),
        /** 已连接角色节点的档案文本（Story Bible 前置约束）：人物名/外貌/服装/性格等。 */
        characterProfiles: z.string().max(3000).optional(),
        /** 仅生成剧本正文、跳过分镜拆解（创作向导「分两步」：先出剧本供审视/编辑，
         *  再由「拆分镜」单独成镜）。省去第二次 LLM 调用，更快更省。 */
        scriptOnly: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // P0 dedupe: single most expensive mutation (claude-sonnet-4-6 + 8k maxTokens).
      // Long latency (20-40s) makes user-driven retry probable; we collapse identical
      // concurrent submits into one external LLM call & charge.
      return dedupe("scripts.generateFullScript", ctx.user.id, input, async () => {
      const modelGuide = buildModelGuide(input.targetVideoModel);

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
      // Tuned for Claude: explicit role, hard constraints, and a clear output
      // contract up front (Claude follows structured directives reliably).
      const scriptSystemPrompt = `你是顶尖的专业编剧兼 AI 视频导演，擅长把一句梗概扩写成可直接拍摄的分镜剧本。

# 制作规格
- 类型：${input.genre ?? "通用"}
- 视觉风格：${input.style ?? "电影感"}
- 情感基调：${input.mood ?? "中性"}
- 画面比例：${input.aspectRatio}
- 总时长：约 ${input.totalDuration} 秒，共 ${input.sceneCount} 个场景（平均每场景 ${avgDuration} 秒）

# 写作要求
1. 全程中文，专业剧本格式：每个场景以「场景一/场景二……」开头，含地点·时间、镜头与动作描写、人物表演与情绪、环境氛围。
2. 叙事连贯，有起承转合，完整覆盖 ${input.sceneCount} 个场景，节奏与单场景时长匹配。
3. 善用电影化的视听语言（景别、运镜、光影、色调），但以可读的中文叙述呈现，便于后续逐场拆解为生成提示词。
4. 正文不少于 200 字。

# 输出
只输出剧本正文。禁止 JSON、禁止解释、禁止 markdown 代码块。`;

      // 节拍表与角色档案作为硬约束注入（行业 Story Bible / beat sheet 做法）：
      // 有节拍表时剧本必须逐拍展开；有角色档案时人物设定必须遵循档案。
      const constraintBlocks: string[] = [];
      if (input.beatSheetText?.trim()) {
        constraintBlocks.push(`## 节拍表（必须严格按以下拍点顺序展开剧情，每拍对应到场景）\n${input.beatSheetText.trim()}`);
      }
      if (input.characterProfiles?.trim()) {
        constraintBlocks.push(`## 角色档案（人物名称、外貌、服装、性格必须与档案一致，不得自创设定）\n${input.characterProfiles.trim()}`);
      }
      if (input.templatePromptOverride) {
        constraintBlocks.push(`## 模板专属写作要求\n${input.templatePromptOverride}`);
      }
      const fullScriptSystemPrompt = constraintBlocks.length
        ? `${scriptSystemPrompt}\n\n${constraintBlocks.join("\n\n")}`
        : scriptSystemPrompt;

      const scriptResponse = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: fullScriptSystemPrompt },
          { role: "user" as const, content: `故事梗概：\n${input.synopsis}` },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
        maxTokens: 8000,
      });
      const scriptText = extractTextContent(scriptResponse).trim();

      // 「仅剧本」两步流：跳过分镜拆解（Call 2），让用户先审视/编辑剧本再单独拆分镜。
      if (input.scriptOnly) {
        if (!scriptText) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效剧本，请重试" });
        }
        return { scriptText, scenes: [] as GeneratedScene[] };
      }

      // ── Call 2: scene breakdown derived from the generated script ──
      // promptText language follows the toggle; description stays Chinese.
      // 节拍表存在时：要求逐镜标注所属拍点（beatRef），并按拍点 duration 占比分配镜头时长。
      const beatBlock = input.beatSheetText?.trim()
        ? `\nBeat sheet (the script follows these beats; allocate scene durations proportionally to each beat's duration, and tag every scene):\n${input.beatSheetText.trim()}\nAdd to EVERY scene object: "beatRef": string — the beat index this scene belongs to (e.g. "3").\n`
        : "";
      const scenesSystemPrompt = `You are a professional film director and storyboard artist. Break the given Chinese script into exactly ${input.sceneCount} visual storyboard scenes that together tell the whole story in order.

Target generation-model prompt style guide (write every promptText to match it):
${modelGuide}
${beatBlock}
Output ONLY a valid JSON array — no markdown fences, no prose before or after the array.
${sceneFieldsInstruction(promptLangName, avgDuration)}`;

      // Feed the generated script (fallback to synopsis if the model returned
      // nothing) so scenes match the actual narrative. Cap input to keep the
      // request bounded.
      const sceneSource = (scriptText || input.synopsis).slice(0, 8000);
      const scenesResponse = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: scenesSystemPrompt },
          { role: "user" as const, content: `Script:\n${sceneSource}` },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
        maxTokens: 4000,
      });

      const scenesText = extractTextContent(scenesResponse);
      const scenesMatch = scenesText.match(/\[[\s\S]*\]/);
      let scenes: GeneratedScene[] = [];
      if (scenesMatch) {
        try {
          const rawScenes = JSON.parse(scenesMatch[0]) as Array<Record<string, unknown>>;
          scenes = rawScenes.slice(0, input.sceneCount).map((s) => normalizeScene(s, avgDuration));
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
        scenes,
      };
      });
    }),

  refineScene: protectedProcedure
    .input(z.object({
      sceneText: z.string().min(1).max(2000),
      intent: z.string().max(500).optional(),
      characterProfiles: z.string().max(3000).optional(),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.refineScene", ctx.user.id, input, async () => {
        const profileBlock = input.characterProfiles?.trim()
          ? `\n\n## 角色档案（人物姓名/外貌/性格须与档案一致，不得自创设定）\n${input.characterProfiles.trim()}` : "";
        const systemPrompt = `你是专业编剧，负责优化单个场景描述。根据用户意图，改写或精化场景文字，保持原有叙事方向。只输出改写后的场景文字，不加任何说明。`;
        const userContent = (input.intent
          ? `意图：${input.intent}\n\n原场景：\n${input.sceneText}`
          : `请优化以下场景：\n${input.sceneText}`) + profileBlock;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userContent },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
        });
        return { result: extractTextContent(response).trim() };
      });
    }),

  /** 镜头衔接优化：按行业剪辑规范（180° 轴线、景别递进避免同景别跳切、运镜动静衔接）
   *  结合上一镜的参数优化当前镜，返回可直接落字段的修订建议。 */
  refineShotContinuity: protectedProcedure
    .input(z.object({
      prevShot: z.object({
        description: z.string().max(1000),
        shotType: z.string().max(20).optional(),
        cameraMovement: z.string().max(20).optional(),
        transition: z.string().max(20).optional(),
      }),
      currentShot: z.object({
        description: z.string().max(1000),
        promptText: z.string().max(2000).optional(),
        shotType: z.string().max(20).optional(),
        cameraMovement: z.string().max(20).optional(),
      }),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.refineShotContinuity", ctx.user.id, input, async () => {
        const systemPrompt = `你是专业剪辑指导兼分镜师。根据「上一镜」的参数优化「当前镜」，使两镜衔接符合行业规范：
- 180° 轴线规则：人物视线/运动方向不跳轴；
- 景别递进：避免相同景别直接跳切（如 MS→MS），相邻镜景别至少差一级或换角度 30° 以上；
- 运镜衔接：动接动、静接静；上一镜有方向性运动时当前镜顺势承接；
- 视觉连续：光线、色调、人物位置合理延续。
仅输出合法 JSON，无 markdown 代码块：
{"description":"优化后的画面描述（中文）","promptText":"优化后的生成提示词（保持原语言）","shotType":"建议景别","cameraMovement":"建议运镜","note":"一句话说明改了什么、为什么（中文）"}`;
        const userContent = `【上一镜】景别：${input.prevShot.shotType ?? "未知"}；运镜：${input.prevShot.cameraMovement ?? "未知"}；转场：${input.prevShot.transition ?? "cut"}\n描述：${input.prevShot.description}\n\n【当前镜】景别：${input.currentShot.shotType ?? "未知"}；运镜：${input.currentShot.cameraMovement ?? "未知"}\n描述：${input.currentShot.description}${input.currentShot.promptText ? `\n提示词：${input.currentShot.promptText}` : ""}`;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userContent },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
          maxTokens: 2000,
        });
        const text = extractTextContent(response);
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(m[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
        return {
          description: String(parsed.description ?? ""),
          promptText: String(parsed.promptText ?? ""),
          shotType: String(parsed.shotType ?? "") || undefined,
          cameraMovement: String(parsed.cameraMovement ?? "") || undefined,
          note: String(parsed.note ?? ""),
        };
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
      const response = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: input.scriptText },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
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

  // ── 开发阶段流（对齐行业管线：logline → 梗概 → 节拍表 → 剧本）────────────────

  /** ① Logline：把想法/梗概压成 25-35 字的一句话故事（主角+冲突+赌注），出 3 个候选。 */
  generateLogline: protectedProcedure
    .input(z.object({
      idea: z.string().min(1).max(2000),
      genre: z.string().max(40).optional(),
      characterProfiles: z.string().max(3000).optional(),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.generateLogline", ctx.user.id, input, async () => {
        const systemPrompt = `你是好莱坞资深故事策划。把用户的想法提炼成 3 个风格各异的 logline（一句话故事）。
行业标准：每条 25-35 个汉字，必须包含【主角是谁】【面临什么冲突】【赌注/代价是什么】，有戏剧张力，不剧透结局。
${input.genre ? `类型：${input.genre}。` : ""}${input.characterProfiles?.trim() ? `\n## 角色档案（主角/人物须与档案一致，姓名设定不得自创）\n${input.characterProfiles.trim()}` : ""}
仅输出合法 JSON，无 markdown 代码块：{"loglines":["…","…","…"]}`;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: input.idea },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
          maxTokens: 1000,
        });
        const text = extractTextContent(response);
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        let parsed: { loglines: string[] };
        try { parsed = JSON.parse(m[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
        const loglines = (Array.isArray(parsed.loglines) ? parsed.loglines : []).filter((s) => typeof s === "string" && s.trim()).slice(0, 3);
        if (loglines.length === 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回 logline" });
        return { loglines };
      });
    }),

  /** ② 节拍表：按所选叙事结构把 logline/梗概拆成结构化拍点（行业 beat sheet）。 */
  generateBeatSheet: protectedProcedure
    .input(z.object({
      source: z.string().min(1).max(3000), // logline + 梗概合并文本
      structure: z.enum(["three_act", "save_the_cat", "heros_journey", "short_drama", "documentary"]).default("three_act"),
      totalDuration: z.number().int().min(10).max(7200).default(60),
      genre: z.string().max(40).optional(),
      mood: z.string().max(40).optional(),
      characterProfiles: z.string().max(3000).optional(),
      /** 时长分配策略（创作向导可调）：均等 / 重场优先 / 钩子前置。影响每拍 duration 分配。 */
      durationMode: z.enum(["even", "weighted", "hook_front"]).optional(),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.generateBeatSheet", ctx.user.id, input, async () => {
        // 行业标准结构模板（拍点名照行业惯例，数量按结构）。
        const STRUCTURES: Record<string, { name: string; guide: string }> = {
          three_act: { name: "经典三幕结构", guide: "8 拍：开场画面 / 建置（人物与世界）/ 激励事件 / 第一幕转折 / 中点（升级或反转）/ 低谷（一无所有）/ 高潮对决 / 结局画面。" },
          save_the_cat: { name: "Save the Cat 15 拍", guide: "15 拍：开场画面 / 主题陈述 / 铺垫 / 催化剂 / 争论 / 进入第二幕 / B故事 / 玩闹与游戏 / 中点 / 坏人逼近 / 一无所有 / 灵魂黑夜 / 进入第三幕 / 结局 / 终场画面。" },
          heros_journey: { name: "英雄之旅 12 步", guide: "12 拍：平凡世界 / 冒险召唤 / 拒绝召唤 / 遇见导师 / 跨越门槛 / 考验盟友敌人 / 接近最深洞穴 / 磨难 / 获得奖赏 / 归途 / 复活 / 携万能药归来。" },
          short_drama: { name: "竖屏短剧 钩子-反转-爽点", guide: "6-8 拍，工业标准节奏：前 3 秒钩子（强冲突/悬念开场）/ 6 秒进入冲突 / 10 秒点出悬念 / 快速共情（主角低谷）/ 情绪拉扯（压迫升级）/ 高能反转 / 爽点释放 / 结尾卡点钩子（勾住下一集）。每分钟保持 3-4 个情绪爆点。" },
          documentary: { name: "纪录片结构", guide: "6 拍：悬念开场（抛出问题）/ 背景铺陈 / 深入主体（核心事实与人物）/ 冲突或转折 / 升华（意义与影响）/ 收束呼应。" },
        };
        const st = STRUCTURES[input.structure];
        const DURATION_GUIDE: Record<string, string> = {
          even: "时长分配策略：各拍尽量均等分配 duration（每拍≈总时长/拍数）。",
          weighted: "时长分配策略：重场戏（中点、低谷、高潮对决等情绪爆点）多分配 duration，过场拍点少分配。",
          hook_front: "时长分配策略：前 1/3 拍点（开场钩子与建置）合计占总时长约一半，快速抓住观众；后续拍点紧凑推进。",
        };
        const durationGuide = DURATION_GUIDE[input.durationMode ?? "weighted"];
        const systemPrompt = `你是专业故事结构师。把给定的故事按「${st.name}」拆成节拍表（beat sheet）。
结构指南：${st.guide}
${input.genre ? `类型：${input.genre}。` : ""}${input.mood ? `基调：${input.mood}。` : ""}${input.characterProfiles?.trim() ? `\n## 角色档案（拍点涉及的人物须与档案一致，不得自创设定）\n${input.characterProfiles.trim()}\n` : ""}总时长约 ${input.totalDuration} 秒——给每拍分配 duration（秒），总和≈总时长。${durationGuide}
每拍 summary 用 1-3 句中文具体写出「发生什么」（人物动作与情绪，不要抽象套话）。
仅输出合法 JSON 数组，无 markdown 代码块：
[{"index":1,"title":"拍点名","summary":"这一拍发生什么","duration":8}]`;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: input.source },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
          maxTokens: 4000,
        });
        const text = extractTextContent(response);
        const m = text.match(/\[[\s\S]*\]/);
        if (!m) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        let raw: Array<Record<string, unknown>>;
        try { raw = JSON.parse(m[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
        const beats = raw.slice(0, 20).map((b, i) => ({
          index: typeof b.index === "number" ? b.index : i + 1,
          title: String(b.title ?? `第 ${i + 1} 拍`),
          summary: String(b.summary ?? ""),
          duration: Number.isFinite(Number(b.duration)) ? Math.round(Number(b.duration)) : undefined,
        }));
        if (beats.length === 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回拍点" });
        return { beats };
      });
    }),

  /** 短剧分集大纲：70-80 集工业模式（每集钩子 + 剧情 + 结尾卡点），含付费卡点策划。 */
  generateEpisodeOutline: protectedProcedure
    .input(z.object({
      source: z.string().min(1).max(3000),
      episodeCount: z.number().int().min(4).max(100).default(24),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.generateEpisodeOutline", ctx.user.id, input, async () => {
        const systemPrompt = `你是爆款竖屏短剧总编剧。把故事拆成 ${input.episodeCount} 集分集大纲（每集 1-2 分钟）。
工业标准：每集必须有【开场钩子】（前 3 秒抓人）与【结尾卡点】（悬念勾住下一集）；全剧遵循「钩子+反转+爽点」黄金结构，避免高开低走；在第 ${Math.min(10, input.episodeCount)}${input.episodeCount >= 30 ? "、30" : ""}${input.episodeCount >= 50 ? "、50" : ""} 集附近安排付费卡点级强钩子（剧情最揪心处断章）。
每集 summary 用 2-3 句中文写清剧情推进。
仅输出合法 JSON 数组，无 markdown 代码块：
[{"episode":1,"title":"集名","hook":"开场钩子","summary":"本集剧情","cliffhanger":"结尾悬念"}]`;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: input.source },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
          maxTokens: 8000,
        });
        const text = extractTextContent(response);
        const m = text.match(/\[[\s\S]*\]/);
        if (!m) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        let raw: Array<Record<string, unknown>>;
        try { raw = JSON.parse(m[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
        const episodes = raw.slice(0, input.episodeCount).map((e, i) => ({
          episode: typeof e.episode === "number" ? e.episode : i + 1,
          title: String(e.title ?? `第 ${i + 1} 集`),
          hook: String(e.hook ?? ""),
          summary: String(e.summary ?? ""),
          cliffhanger: String(e.cliffhanger ?? ""),
        }));
        if (episodes.length === 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回分集" });
        return { episodes };
      });
    }),

  // ── 专业审查（行业 Script Coverage 体系）──────────────────────────────────────

  /** 六维评分 + 裁决（推荐/修改后可用/不推荐）+ 结构化问题（带定位/严重度/可修复标志）。
   *  shortDrama 模式附加工业检查（钩子节奏 / 台词长度 / 反转密度）。 */
  scriptCoverage: protectedProcedure
    .input(z.object({
      scriptText: z.string().min(1).max(8000),
      genre: z.string().max(40).optional(),
      shortDrama: z.boolean().default(false),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.scriptCoverage", ctx.user.id, input, async () => {
        const shortDramaBlock = input.shortDrama ? `
另外按竖屏短剧工业标准做 3 项附加检查（shortDramaChecks）：
1.「钩子节奏」：开场是否做到 3 秒抓人、6 秒进冲突、10 秒点悬念；
2.「台词长度」：单句台词是否多数控制在 8-12 字（最长不超 15 字）；
3.「反转/爽点密度」：是否每分钟保持 3-4 个情绪爆点、有明确反转与爽点。` : "";
        const systemPrompt = `你是好莱坞制片厂专业剧本审稿人（script reader），按行业 Coverage 标准出具结构化审读报告。
六个维度逐一评分（0-100）并各写一句具体短评：
- premise 创意与前提：概念新鲜度、戏剧前提是否成立
- structure 结构：起承转合/幕结构是否完整、转折是否有力
- characters 人物：动机是否成立、弧光是否清晰、配角功能性
- dialogue 对白：是否自然、有潜台词、符合人物身份
- pacing 节奏：信息密度、场景长短分配、是否拖沓或过快
- visual 视觉可实现性：场景描写是否具象、是否适合 AI 图像/视频生成（画面感、可拆分镜程度）
裁决（verdict）按行业三档：recommend（强烈推荐，各维度均优）/ consider（有潜力，修复关键问题后可用）/ pass（核心缺陷过多，建议重写）。
issues 列出最关键的问题（最多 10 条，按严重度从高到低），每条：dimension（六维之一）、sceneRef（精确定位如「场景三」「第12行」，全局问题写「全局」）、severity（high/medium/low）、description（问题是什么）、suggestion（具体怎么改）、autoFixable（AI 能否仅凭该建议定向改写解决，布尔值；涉及全局重构的为 false）。
strengths 列 2-4 条亮点。summary 写 2-4 句总评。${shortDramaBlock}
仅输出合法 JSON，无 markdown 代码块：
{"verdict":"consider","overall":74,"summary":"…","dimensions":[{"key":"premise","score":80,"comment":"…"}],"strengths":["…"],"issues":[{"dimension":"dialogue","sceneRef":"场景二","severity":"high","description":"…","suggestion":"…","autoFixable":true}]${input.shortDrama ? `,"shortDramaChecks":[{"name":"钩子节奏","pass":false,"detail":"…"}]` : ""}}`;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: `${input.genre ? `【类型】${input.genre}\n\n` : ""}${input.scriptText}` },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
          maxTokens: 4000,
        });
        const text = extractTextContent(response);
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(m[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
        const DIMS = ["premise", "structure", "characters", "dialogue", "pacing", "visual"] as const;
        const dimsRaw = Array.isArray(parsed.dimensions) ? parsed.dimensions as Array<Record<string, unknown>> : [];
        const dimensions = DIMS.map((key) => {
          const d = dimsRaw.find((x) => x.key === key);
          return { key, score: Math.max(0, Math.min(100, Math.round(Number(d?.score ?? 0)))), comment: String(d?.comment ?? "") };
        });
        const verdict = (["recommend", "consider", "pass"] as const).includes(parsed.verdict as "recommend") ? parsed.verdict as "recommend" | "consider" | "pass" : "consider";
        const issuesRaw = Array.isArray(parsed.issues) ? parsed.issues as Array<Record<string, unknown>> : [];
        const issues = issuesRaw.slice(0, 10).map((x) => ({
          dimension: (DIMS as readonly string[]).includes(String(x.dimension)) ? String(x.dimension) as typeof DIMS[number] : "structure" as const,
          sceneRef: String(x.sceneRef ?? "全局"),
          severity: (["low", "medium", "high"] as const).includes(x.severity as "low") ? x.severity as "low" | "medium" | "high" : "medium",
          description: String(x.description ?? ""),
          suggestion: String(x.suggestion ?? ""),
          autoFixable: x.autoFixable === true,
        }));
        const checksRaw = Array.isArray(parsed.shortDramaChecks) ? parsed.shortDramaChecks as Array<Record<string, unknown>> : [];
        return {
          verdict,
          overall: Math.max(0, Math.min(100, Math.round(Number(parsed.overall ?? 0)))),
          summary: String(parsed.summary ?? ""),
          dimensions,
          strengths: (Array.isArray(parsed.strengths) ? parsed.strengths : []).map(String).slice(0, 4),
          issues,
          ...(input.shortDrama ? { shortDramaChecks: checksRaw.slice(0, 3).map((c) => ({ name: String(c.name ?? ""), pass: c.pass === true, detail: String(c.detail ?? "") })) } : {}),
          reviewedAt: Date.now(),
        };
      });
    }),

  /** 审查闭环：按单条 issue 定向改写剧本（只动相关位置，其余原样保留），返回完整修订稿。 */
  applyScriptFix: protectedProcedure
    .input(z.object({
      scriptText: z.string().min(1).max(8000),
      issue: z.object({
        dimension: z.string().max(20),
        sceneRef: z.string().max(60),
        description: z.string().max(500),
        suggestion: z.string().max(500),
      }),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return dedupe("scripts.applyScriptFix", ctx.user.id, input, async () => {
        const systemPrompt = `你是专业剧本医生（script doctor）。按给定的审稿意见对剧本做【定向修复】：
- 只修改与意见相关的位置（${input.issue.sceneRef}），其余内容必须逐字保留；
- 修复后保持剧本格式（场景标题、结构）不变；
- 只输出修复后的完整剧本正文，禁止解释、禁止 markdown 代码块。`;
        const userContent = `【审稿意见】维度：${input.issue.dimension}；位置：${input.issue.sceneRef}；问题：${input.issue.description}；建议：${input.issue.suggestion}\n\n【剧本】\n${input.scriptText}`;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userContent },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
          maxTokens: 8000,
        });
        const result = extractTextContent(response).trim();
        if (!result) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回修复结果" });
        return { result };
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
      await assertLLMAllowed(ctx, input.model);
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

        const response = await invokeLLMWithKie(ctx, {
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
          model: input.model ?? "gpt-5.2", // 视觉任务：默认用支持读图的模型（Claude 在本部署不支持）
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

  // AI 看图识人/识景：依据参考图（含备用视角）分析出结构化角色/场景字段，供前端弹窗
  // 预览后勾选填充。镜像 checkCharacterConsistency 的视觉-LLM 多图 + 结构化 JSON 链路。
  analyzeCharacterFromImages: protectedProcedure
    .input(z.object({
      imageUrls: z.array(z.string().min(1).max(2048)).min(1).max(9),
      characterKind: z.enum(["person", "scene"]).default("person"),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx, input.model);
      return dedupe("scripts.analyzeCharacterFromImages", ctx.user.id, input, async () => {
        const absoluteUrls: string[] = [];
        for (const u of input.imageUrls) {
          try { absoluteUrls.push(await resolveToAbsoluteUrl(u)); }
          catch (err) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `图像 URL 无法解析为绝对路径：${u.slice(0, 80)}（${err instanceof Error ? err.message : "未知错误"}）` });
          }
        }

        const isScene = input.characterKind === "scene";
        const systemPrompt = isScene
          ? `你是影视美术指导。给你 ${absoluteUrls.length} 张同一「场景/地点」的参考图，请提炼出可复用的场景设定。\n`
            + `仅输出合法 JSON（无 markdown、无解释）：\n`
            + `{"sceneName":"场景名(简短)","locationType":"室内/室外/城市/自然/历史/科幻/奇幻/水下 之一","sceneDescription":"环境细节(布景/材质/光线/关键道具)","atmosphere":"明亮/昏暗/神秘/浪漫/紧张/宁静/史诗 之一","timeOfDay":"清晨/上午/正午/下午/黄昏/夜晚/深夜 之一"}\n`
            + `约束：只描述图中可见信息，无法判断的字段填空字符串 ""；全部用中文；不要编造。`
          : `你是专业的角色设定师。给你 ${absoluteUrls.length} 张同一「人物」的参考图（可能含不同视角），请提炼出该角色的设定。\n`
            + `仅输出合法 JSON（无 markdown、无解释）：\n`
            + `{"name":"角色名(若无法判断留空)","role":"身份/职业","gender":"男 或 女 或 中性","age":"年龄段(如 青年/30岁左右)","appearance":"外貌(脸型/发型/发色/五官/体型)","personality":"性格气质(从神态衣着推断)","outfit":"服装(款式/颜色/配饰)","signature":"标志性特征(疤痕/眼镜/纹身/饰品等)"}\n`
            + `约束：gender 只能是 男/女/中性 三者之一或空；只描述图中可见信息，无法判断的字段填空字符串 ""；全部用中文；不要编造。`;

        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: `请分析以下 ${absoluteUrls.length} 张参考图：` },
                ...absoluteUrls.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
              ],
            },
          ],
          model: input.model ?? "gpt-5.2", // 视觉任务：默认用支持读图的模型（Claude 在本部署不支持）
          // Detailed person profiles (8 Chinese fields) can exceed a small budget and get
          // truncated → unterminated JSON → "未返回有效 JSON". Give ample room.
          maxTokens: 2600,
        });

        // Strip ```json fences some models add, then grab the JSON object.
        const text = extractTextContent(response).replace(/```(?:json)?/gi, "").trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI 未返回有效 JSON（模型「${input.model ?? "gpt-5.2"}」可能不支持读图，请换一个视觉模型，如 GPT-5.2）` });
        }
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>; }
        catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 返回的 JSON 解析失败（可能被截断，请重试或换模型）" }); }

        const FIELDS: { key: string; max: number }[] = isScene
          ? [{ key: "sceneName", max: 120 }, { key: "locationType", max: 60 }, { key: "sceneDescription", max: 500 }, { key: "atmosphere", max: 60 }, { key: "timeOfDay", max: 60 }]
          : [{ key: "name", max: 120 }, { key: "role", max: 120 }, { key: "gender", max: 10 }, { key: "age", max: 60 }, { key: "appearance", max: 500 }, { key: "personality", max: 500 }, { key: "outfit", max: 500 }, { key: "signature", max: 300 }];
        const fields: Record<string, string> = {};
        for (const { key, max } of FIELDS) {
          const v = parsed[key];
          if (typeof v !== "string") continue;
          let s = v.trim().slice(0, max);
          if (key === "gender" && !["男", "女", "中性"].includes(s)) s = ""; // whitelist
          if (s) fields[key] = s;
        }

        writeAuditLog({ ctx, action: "image_gen", detail: { kind: "character_recognition", imageCount: absoluteUrls.length, characterKind: input.characterKind } });
        return { characterKind: input.characterKind, fields };
      });
    }),

  // #225 外观锚点短语压缩：把角色的全量外貌/服装/标志描述压成 15-30 字的视觉锚点
  // 短语（发型发色/显著标记/服装主色款式/体貌），供角色卡「压缩注入」模式使用——
  // 跨镜头注入同一短语措辞恒定、省 token。纯文本 LLM 调用，无视觉输入。
  compressCharacterAnchor: protectedProcedure
    .input(z.object({
      profileText: z.string().min(1).max(2000),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx, input.model);
      return dedupe("scripts.compressCharacterAnchor", ctx.user.id, input, async () => {
        const systemPrompt =
          `你是角色一致性专家。把用户给出的角色外观描述压缩成一个 15-30 字的中文「外观锚点短语」。\n`
          + `要求：只保留 3-4 个最具辨识度的【视觉】特征（发型发色 / 显著标记(疤痕纹身眼镜等) / 服装主色与款式 / 体貌），`
          + `用顿号「、」分隔；不含名字、性格、场景、动作；不加引号或任何解释，只输出短语本身。`;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: `角色外观描述：\n${input.profileText}` },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
          maxTokens: 120,
        });
        // 剥掉模型可能加的引号/句号并硬截 60 字符（锚点定位是「短」，超长即失去意义）。
        const phrase = extractTextContent(response)
          .replace(/```[a-z]*/gi, "")
          .trim()
          .replace(/^["'「『]+|["'」』。.]+$/g, "")
          .trim()
          .slice(0, 60);
        if (!phrase) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效的锚点短语，请重试或换模型" });
        writeAuditLog({ ctx, action: "image_gen", detail: { kind: "character_anchor_compress", len: phrase.length } });
        return { phrase };
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
      const response = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: `梗概：${input.synopsis}\n\n请生成 ${input.variantCount} 个风格不同的开场版本。` },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
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
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userContent },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
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
      const response = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: input.scriptText },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
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
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: input.scriptText },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
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
      const response = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: input.scriptText },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
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
          // #151 Live (ElevenLabs Music via status endpoint, 128 cr/min)
          "elevenlabs-music",
          // kie.ai Suno (own key system, /api/v1/generate)
          "kie_suno_v4", "kie_suno_v4_5", "kie_suno_v4_5plus", "kie_suno_v5", "kie_suno_v5_5",
          // Legacy aliases — normalized below
          "suno-v3.5", "minimax-music-02", "mureka",
        ]),
        prompt: z.string().min(1).max(5000), // align with dubbing/sfx; was unbounded
        style: z.string().optional(),
        title: z.string().max(120).optional(),     // Suno custom-mode title
        instrumental: z.boolean().optional(),
        negativeTags: z.string().optional(),
        lyrics: z.string().max(3500).optional(),   // MiniMax only
        kieTempKey: z.string().max(256).optional(), // kie_suno_* only
        // 客户端实时计算的点数预估（如 "20 cr"），仅供管理员日志参考。
        estimatedCost: z.string().max(32).optional(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 失败也计入管理员日志（带预估点数 + success:false），随后原样抛出。
      const auditMusicFail = (err: unknown): never => {
        writeAuditLog({ ctx, action: "audio_music", detail: {
          model: input.model, prompt: truncate(input.prompt),
          ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
          success: false, error: truncate(err instanceof Error ? err.message : String(err)),
        } });
        throw err;
      };
      // kie Suno authenticates with its own key (temp > assigned > house) and
      // bypasses the Poyo whitelist; non-kie keeps the whitelist gate.
      if (isKieMusicModel(input.model)) {
        if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
        const resolved = await resolveKieKey(ctx, input.kieTempKey);
        return dedupe("audioGen.generateMusic", ctx.user.id, input, async () => {
          const result = await submitAndPollKieMusic({
            model: input.model,
            apiKey: resolved.key,
            prompt: input.prompt,
            style: input.style,
            title: input.title,
            instrumental: input.instrumental,
            negativeTags: input.negativeTags,
          });
          writeAuditLog({ ctx, action: "audio_music", detail: { model: input.model, prompt: truncate(input.prompt), resultUrl: result.url, duration: result.duration, ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}), success: true } });
          await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: "kie", model: input.model, url: result.url, name: input.model });
          // kie Suno 走自有 key 体系，不提供 Poyo 的 audio_id（原生续写不适用）——补 undefined 使
          // 两条返回分支形状一致（否则前端 onSuccess 取 result.audioId 报缺属性）。
          return { url: result.url, duration: result.duration, imageUrl: result.imageUrl, audioId: undefined as string | undefined, taskId: undefined as string | undefined };
        }).catch(auditMusicFail);
      }
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
          detail: { model, prompt: truncate(input.prompt), resultUrl: result.url, duration: result.duration, ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}), success: true },
        });
        await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: "poyo", model, url: result.url, name: model });
        // #153 回传 audio_id / task_id——节点持久化后作为第二批「原生续写」等工具的入参。
        return { url: result.url, duration: result.duration, imageUrl: result.imageUrl, audioId: result.audioId, taskId: result.taskId };
      }).catch(auditMusicFail);
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
          // #151 Live (Poyo round2 新 TTS)
          "elevenlabs-tts-turbo-2-5", "gemini-3-1-flash-tts", "xai-tts-1",
          // Local / self-hosted Gradio TTS (VoxCPM2 等), via customBaseUrl
          "voxcpm-local",
          // kie.ai ElevenLabs TTS（自有 key 体系，见 kieTTS.ts）
          "kie_elevenlabs_tts", "kie_elevenlabs_tts_ml", "kie_elevenlabs_v3",
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
        // Local Gradio TTS (VoxCPM2) params
        customBaseUrl: z.string().max(2048).optional(),          // Gradio 服务地址
        refWavUrl: z.string().max(4096).optional(),              // 参考音频 URL（克隆音色）
        controlInstruction: z.string().max(2000).optional(),
        cfgValue: z.number().min(0).max(10).optional(),
        ditSteps: z.number().int().min(1).max(100).optional(),
        denoise: z.boolean().optional(),
        doNormalize: z.boolean().optional(),
        // #215 对齐官方 VoxCPM2：极致克隆（参考音频文本引导，与控制指令互斥）+ 可复现 Seed
        usePromptText: z.boolean().optional(),
        promptTextValue: z.string().max(5000).optional(),
        seed: z.number().int().min(0).max(4294967295).optional(),
        kieTempKey: z.string().max(256).optional(), // kie_elevenlabs_* only
        // 客户端实时计算的点数预估（如 "≈6 点"），仅供管理员日志参考。
        estimatedCost: z.string().max(32).optional(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 本地 / 自托管 VoxCPM 走用户自己的 Gradio 服务、不消耗任何平台积分，
      // 故对该模型放开白名单——任何已登录用户都可使用。kie ElevenLabs 走 kie 自有 key
      // 体系（resolveKieKey）绕平台白名单。其余 TTS（OpenAI/Poyo）白名单照常拦截。
      const isLocalGradio = input.model === "voxcpm-local";
      const isKieTTSModel = isKieTTS(input.model);
      if (!isLocalGradio && !isKieTTSModel) await assertWhitelisted(ctx);
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
      const POYO_TTS_MODELS = new Set(["elevenlabs-v3-tts", "elevenlabs-tts-turbo-2-5", "gemini-3-1-flash-tts", "xai-tts-1"]);
      const isPoyoTTS = POYO_TTS_MODELS.has(model);
      const isGradioTTS = model === "voxcpm-local";

      // Per-model text limits. ElevenLabs V3 allows 5000; OpenAI TTS 4096;
      // local VoxCPM has no hard provider cap so it uses the 5000 schema max.
      const TEXT_LIMIT: Record<string, number> = {
        "elevenlabs-v3-tts":   5000,
        "elevenlabs-tts-turbo-2-5": 5000,
        "gemini-3-1-flash-tts": 5000,
        "xai-tts-1":            5000,
        "voxcpm-local":        5000,
        kie_elevenlabs_tts:    5000,
        kie_elevenlabs_tts_ml: 5000,
        kie_elevenlabs_v3:     5000,
        openai_tts_real:       4096,
        openai_tts_hd_real:    4096,
        openai_gpt4o_mini_tts: 4096,
      };
      const limit = TEXT_LIMIT[model] ?? 4096;
      // kie ElevenLabs 走自有 key（临时 > 分配 > 公用）。
      const kieTTSKey = isKieTTSModel ? (await resolveKieKey(ctx, input.kieTempKey)).key : undefined;
      if (input.text.length > limit) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${model} 单次配音上限 ${limit} 字（当前 ${input.text.length}）` });
      }

      // Local Gradio needs a server address. 优先用节点自填的地址；未填则回退全站默认
      // （管理后台 VoxCPM 端点 DB 优先 → VOXCPM_BASE_URL env）。参考音频(ref_wav)可选——
      // 不给则用模型自带/随机音色生成（与 VoxCPM 网页版一致）。
      const voxcpmBaseUrl = isGradioTTS ? (input.customBaseUrl?.trim() || resolveVoxcpmBaseUrl()) : "";
      if (isGradioTTS && !voxcpmBaseUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "本地 VoxCPM 需要 Gradio 服务地址：请在节点里填写，或在管理后台「模型管理 › 本地 VoxCPM 端点」配置全站默认（或设 VOXCPM_BASE_URL）" });
      }

      return dedupe("audioGen.generateDubbing", ctx.user.id, input, async () => {
        const result = isGradioTTS
          ? await synthesizeGradioTTS({
              baseUrl: voxcpmBaseUrl,
              text: input.text,
              refWavUrl: input.refWavUrl!,
              controlInstruction: input.controlInstruction,
              cfgValue: input.cfgValue,
              ditSteps: input.ditSteps,
              denoise: input.denoise,
              doNormalize: input.doNormalize,
              usePromptText: input.usePromptText,
              promptTextValue: input.promptTextValue,
              seed: input.seed,
            })
          : isKieTTSModel
          ? await submitAndPollKieTTS({
              model, apiKey: kieTTSKey!,
              text: input.text, voice: input.voice,
              stability: input.stability,
              languageCode: input.languageCode,
            })
          : isPoyoTTS
          ? await submitAndPollPoyoTTS({
              model: model as PoyoTTSModel,
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
            ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
            success: true,
            ...(isPoyoTTS ? { stability: input.stability ?? null, timestamps: input.timestamps ?? false } : {}),
            ...(isGradioTTS ? { gradioBaseUrl: voxcpmBaseUrl || null } : {}),
          },
        });
        const provider = isGradioTTS ? "gradio" : isKieTTSModel ? "kie" : isPoyoTTS ? "poyo" : "openai";
        await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider, model, url: result.url, name: model });
        return {
          url: result.url,
          duration: result.duration,
          timestampsUrl: isPoyoTTS ? (result as { timestampsUrl?: string }).timestampsUrl : undefined,
        };
      }).catch((err: unknown) => {
        // 失败也计入管理员日志（带预估点数 + success:false），随后原样抛出。
        writeAuditLog({ ctx, action: "audio_dubbing", detail: {
          model, text: truncate(input.text),
          ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
          success: false, error: truncate(err instanceof Error ? err.message : String(err)),
        } });
        throw err;
      });
    }),

  // 文本→音效（ElevenLabs Sound Effects via kie 统一 jobs API）。kie 走自有 key
  // 体系（临时 > 分配 > 公用），与 kie TTS 同口径绕平台白名单。
  generateSFX: protectedProcedure
    .input(
      z.object({
        model: z.enum(["kie_elevenlabs_sfx"]),
        // 官方 schema：text ≤5000 字符；duration_seconds 0.5–22（步进 0.1，缺省自动）；
        // loop 无缝循环；prompt_influence 0–1（默认 0.3）。
        prompt: z.string().min(1).max(5000),
        duration: z.number().min(0.5).max(22).optional(),
        loop: z.boolean().optional(),
        promptInfluence: z.number().min(0).max(1).optional(),
        kieTempKey: z.string().max(256).optional(),
        estimatedCost: z.string().max(32).optional(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const { key } = await resolveKieKey(ctx, input.kieTempKey);
      return dedupe("audioGen.generateSFX", ctx.user.id, input, async () => {
        const result = await submitAndPollKieSFX({
          apiKey: key, text: input.prompt,
          durationSeconds: input.duration, loop: input.loop, promptInfluence: input.promptInfluence,
        });
        writeAuditLog({
          ctx, action: "audio_sfx",
          detail: {
            model: KIE_SFX_MODEL, text: truncate(input.prompt),
            duration: input.duration ?? null, loop: input.loop ?? false,
            resultUrl: result.url,
            ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
            success: true,
          },
        });
        await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: "kie", model: KIE_SFX_MODEL, url: result.url, name: "音效" });
        return result;
      }).catch((err: unknown) => {
        writeAuditLog({ ctx, action: "audio_sfx", detail: {
          model: KIE_SFX_MODEL, text: truncate(input.prompt),
          ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
          success: false, error: truncate(err instanceof Error ? err.message : String(err)),
        } });
        throw err;
      });
    }),

  // 多角色配音 casting：客户端按「角色名：台词」逐段不同音色 TTS 后，把同一镜的
  // 多段音频拼接为一条镜级配音（本地 ffmpeg，不消耗 AI 积分，故不做白名单拦截）。
  concatSegments: protectedProcedure
    .input(
      z.object({
        urls: z.array(mediaUrlSchema).min(2).max(20),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      for (const u of input.urls) guardUrl(u);
      const result = await concatAudioSegments(input.urls);
      await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: "ffmpeg", model: null, url: result.url, name: "配音拼接（多角色）" });
      return result;
    }),

  // LibTV 化：音频节点「截取 / 变速」操作条（本地 ffmpeg，不消耗 AI 积分，故不做白名单拦截）。
  processAudio: protectedProcedure
    .input(
      z.object({
        url: mediaUrlSchema,
        trimStart: z.number().min(0).max(36000).optional(),
        trimEnd: z.number().min(0).max(36000).optional(),
        speed: z.number().min(0.25).max(4).optional(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.url);
      const hasTrim = input.trimStart != null || input.trimEnd != null;
      const hasSpeed = input.speed != null && Math.abs(input.speed - 1) > 0.001;
      if (!hasTrim && !hasSpeed) throw new TRPCError({ code: "BAD_REQUEST", message: "请指定截取区间或变速倍率" });
      if (input.trimStart != null && input.trimEnd != null && input.trimEnd <= input.trimStart) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "截取终点必须大于起点" });
      }
      const result = await processAudioClip({ url: input.url, trimStart: input.trimStart, trimEnd: input.trimEnd, speed: input.speed });
      const opLabel = [hasTrim ? "截取" : null, hasSpeed ? `变速×${input.speed}` : null].filter(Boolean).join("+");
      await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: "ffmpeg", model: null, url: result.url, name: `音频${opLabel}` });
      return result;
    }),

  // ── #152 音乐工具第一批：人声分离 / 翻唱 / 续写 / 写歌词（Poyo，走平台白名单）──
  // 参数按 Poyo 官方 api-manual/music-series schema；结果形态随工具而异（音频/多轨/歌词）。
  generateMusicTool: protectedProcedure
    .input(
      z.object({
        tool: z.enum(["sep_vocals", "cover", "extend", "lyrics", "extend_native"]),
        audioUrl: mediaUrlSchema.optional(),      // sep/cover/extend 的源音频（lyrics/extend_native 不需要）
        audioId: z.string().max(128).optional(),  // #153 extend_native：本站 Suno 曲目的 audio_id
        prompt: z.string().max(5000).optional(),  // cover/extend 风格描述；lyrics 主题
        // 人声分离
        sepModel: z.enum(["base", "enhanced", "instrumental"]).optional(),
        sepOutput: z.enum(["general", "bass", "drums", "other", "piano", "guitar", "vocals"]).optional(),
        // 翻唱 / 续写
        mv: z.enum(["V4", "V4_5", "V4_5ALL", "V4_5PLUS", "V5", "V5_5"]).optional(),
        instrumental: z.boolean().optional(),
        negativeTags: z.string().max(500).optional(),
        vocalGender: z.enum(["m", "f"]).optional(),
        styleWeight: z.number().min(0).max(1).optional(),
        continueAt: z.number().min(0).optional(),  // extend 起始秒
        estimatedCost: z.string().max(32).optional(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);  // Poyo 系，与 generateMusic 同门控
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      if (input.audioUrl) guardUrl(input.audioUrl);
      const wireLabel = { sep_vocals: "人声分离", cover: "翻唱/转曲风", extend: "音频续写", lyrics: "写歌词", extend_native: "原生续写" }[input.tool];
      return dedupe("audioGen.generateMusicTool", ctx.user.id, input, async () => {
        const result = await submitAndPollPoyoMusicTool({
          tool: input.tool,
          audioUrl: input.audioUrl,
          audioId: input.audioId,
          prompt: input.prompt,
          sepModel: input.sepModel,
          sepOutput: input.sepOutput,
          mv: input.mv,
          instrumental: input.instrumental,
          negativeTags: input.negativeTags,
          vocalGender: input.vocalGender,
          styleWeight: input.styleWeight,
          continueAt: input.continueAt,
        });
        writeAuditLog({ ctx, action: "audio_music_tool", detail: {
          tool: input.tool, label: wireLabel,
          resultUrl: result.url ?? null,
          stemCount: result.stems ? Object.keys(result.stems).length : 0,
          hasLyrics: !!result.lyrics,
          ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
          success: true,
        } });
        // 落素材库：音频类产物入库（分离多轨逐条入库；歌词非媒体不入库）。
        if (result.kind === "audio" && result.url) {
          await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: "poyo", model: input.tool, url: result.url, name: wireLabel });
        } else if (result.kind === "stems" && result.stems) {
          for (const [stem, u] of Object.entries(result.stems)) {
            await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "audio", source: "generated", provider: "poyo", model: input.tool, url: u, name: `人声分离·${stem}` });
          }
        }
        return result;
      }).catch((err: unknown) => {
        writeAuditLog({ ctx, action: "audio_music_tool", detail: {
          tool: input.tool, label: wireLabel,
          ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
          success: false, error: truncate(err instanceof Error ? err.message : String(err)),
        } });
        throw err;
      });
    }),
});

// ── Video Clip Editor ─────────────────────────────────────────────────────────

// Register an ffmpeg-editing output (clip / merge / overlay / subtitle / smart-cut /
// frame) into the assets table — just like every other generator — so it shows up in
// the 素材库, flows to downstream 素材 nodes, and is tracked/cleanable. Without this
// the file lands in MinIO but stays an orphan object (not in the DB).
async function recordEditedAsset(opts: {
  userId: number; projectId?: number; nodeId?: string;
  url: string; type: "video" | "image" | "audio"; name: string; mimeType?: string;
}): Promise<void> {
  await recordGeneratedAsset({
    userId: opts.userId, projectId: opts.projectId ?? null, nodeId: opts.nodeId ?? null,
    type: opts.type, source: "generated", provider: "ffmpeg", model: null,
    url: opts.url, name: opts.name, mimeType: opts.mimeType ?? (opts.type === "video" ? "video/mp4" : opts.type === "audio" ? "audio/mpeg" : "image/png"),
  });
}

export const clipRouter = router({
  trimVideo: protectedProcedure
    .input(
      z.object({
        inputUrl: mediaUrlSchema,
        projectId: z.number().optional(),
        nodeId: z.string().optional(),
        startTime: z.number().min(0),
        endTime: z.number().min(0),
        speed: z.number().min(0.1).max(10.0).optional(),
        audioUrl: mediaUrlSchema.optional(),
        audioVolume: z.number().min(0).max(2.0).optional(),
        audioTracks: z.array(z.object({
          url: mediaUrlSchema,
          volume: z.number().min(0).max(2).optional(),
          delay: z.number().min(0).max(600).optional(),
          fadeIn: z.number().min(0).max(30).optional(),
          fadeOut: z.number().min(0).max(30).optional(),
          isVoice: z.boolean().optional(),
        })).max(8).optional(),
        loudnorm: z.boolean().optional(),
        ducking: z.boolean().optional(),
        colorPreset: z.enum(["none", "cinematic", "warm", "cool", "bw", "vintage", "vivid"]).optional(),
        output: z.object({
          resolution: z.enum(["source", "720p", "1080p", "4k"]).optional(),
          fps: z.number().int().min(1).max(120).optional(),
          upscale: z.union([z.literal(2), z.literal(4), z.literal(6)]).optional(),
          fpsInterpolate: z.boolean().optional(),
          format: z.enum(["mp4", "webm"]).optional(),
        }).optional(),
        edit: z.object({
          reverse: z.boolean().optional(),
          rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
          flipH: z.boolean().optional(),
          flipV: z.boolean().optional(),
          brightness: z.number().min(-1).max(1).optional(),
          contrast: z.number().min(0).max(2).optional(),
          saturation: z.number().min(0).max(3).optional(),
          aspect: z.enum(["original", "9:16", "16:9", "1:1"]).optional(),
          fadeIn: z.number().min(0).max(10).optional(),
          fadeOut: z.number().min(0).max(10).optional(),
          muteOriginal: z.boolean().optional(),
          mixAudio: z.boolean().optional(),
          originalVolume: z.number().min(0).max(2).optional(),
          originalIsVoice: z.boolean().optional(),
          denoiseAudio: z.boolean().optional(),
          originalFadeIn: z.number().min(0).max(30).optional(),
          originalFadeOut: z.number().min(0).max(30).optional(),
        }).optional(),
      }).refine(d => d.endTime > d.startTime, { message: "出点必须大于入点", path: ["endTime"] })
    )
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg, no third-party AI — not whitelist-gated
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.inputUrl);
      if (input.audioUrl) guardUrl(input.audioUrl);
      for (const t of input.audioTracks ?? []) guardUrl(t.url);
      const result = await trimVideo(input);
      await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "video", name: "剪辑", mimeType: input.output?.format === "webm" ? "video/webm" : "video/mp4" });
      return { url: result.url, duration: result.duration };
    }),

  // 快剪多段分割合成：给定升序、互不重叠的保留区间 → 本机 ffmpeg 一次拼接
  //（复用 smartCutVideo 的确定性多段路径；无 LLM/转写 → 不做白名单门控，对齐 trimVideo）。
  cutSegments: protectedProcedure
    .input(z.object({
      inputUrl: mediaUrlSchema,
      projectId: z.number().optional(),
      nodeId: z.string().optional(),
      segments: z.array(z.object({ start: z.number().min(0), end: z.number().min(0) })).min(1).max(50),
    }).refine((d) => d.segments.every((s) => s.end > s.start), { message: "每段出点必须大于入点", path: ["segments"] }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.inputUrl);
      const segs = [...input.segments].sort((a, b) => a.start - b.start);
      for (let i = 1; i < segs.length; i++) {
        if (segs[i].start < segs[i - 1].end - 0.001) throw new TRPCError({ code: "BAD_REQUEST", message: "保留区间不能重叠" });
      }
      const result = await smartCutVideo({ inputUrl: input.inputUrl, keepSegments: segs });
      await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "video", name: "快剪分割" });
      return { url: result.url, duration: result.outputDuration };
    }),

  extractFrame: protectedProcedure
    .input(z.object({ inputUrl: mediaUrlSchema, time: z.number().min(0), projectId: z.number().optional(), nodeId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg, no third-party AI — not whitelist-gated
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.inputUrl);
      const result = await extractFrame(input);
      await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "image", name: "剪辑封面帧" });
      return { url: result.url };
    }),

  // 音频分离（LibTV 化 1.3）：整条音轨提取为 mp3。本地 ffmpeg，无第三方 AI，不走白名单。
  extractAudio: protectedProcedure
    .input(z.object({ inputUrl: mediaUrlSchema, projectId: z.number().optional(), nodeId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.inputUrl);
      let result;
      try {
        result = await extractAudio(input);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/does not contain|matches no streams|音轨/.test(msg)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该视频不含音轨，无法分离音频" });
        }
        throw e;
      }
      await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "audio", name: "音频分离", mimeType: "audio/mpeg" });
      return { url: result.url, duration: result.duration };
    }),

  // #245 链式衔接：抽视频尾帧存自有存储，返回可直接作下一镜首帧参考的图片 URL。
  // 本地 ffmpeg、无第三方 AI——仅项目门控 + SSRF 守卫（对齐 extractAudio/detectScenes 口径）。
  // 另收 data:video（dev 无对象存储时上传素材即此形态；纯本地解码，无 SSRF 面），
  // 此时产物也以 data:image 返回、不入素材库。
  extractTailFrame: protectedProcedure
    .input(z.object({
      inputUrl: z.union([mediaUrlSchema, z.string().max(48_000_000).regex(/^data:video\//i, "仅支持视频 data: URL")]),
      // #247 生成式转场需要「后段首帧」——同一端点按 position 抽首/尾帧（默认 tail 向后兼容）。
      position: z.enum(["tail", "head"]).optional(),
      projectId: z.number().optional(), nodeId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const isInline = /^data:video\//i.test(input.inputUrl);
      if (!isInline) guardUrl(input.inputUrl);
      const head = input.position === "head";
      const frame = head ? await extractVideoHeadFrameJpeg(input.inputUrl) : await extractVideoTailFrameJpeg(input.inputUrl);
      if (isInline || !isStorageConfigured()) {
        return { url: `data:image/jpeg;base64,${frame.toString("base64")}` };
      }
      const { url } = await storagePut(`u/${ctx.user.id}/frames/${nanoid()}-${head ? "head" : "tail"}.jpg`, frame, "image/jpeg");
      await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url, type: "image", name: head ? "首帧图" : "尾帧图", mimeType: "image/jpeg" });
      return { url };
    }),

  getVideoDuration: protectedProcedure
    .input(z.object({ url: mediaUrlSchema }))
    .query(async ({ ctx, input }) => {
      // local ffprobe, no third-party AI — not whitelist-gated
      guardUrl(input.url);
      const duration = await getVideoDuration(input.url);
      return { duration };
    }),

  // #100 场景切点检测：本地 ffmpeg（无第三方 AI）→ 仅项目门控 + SSRF 守卫（对齐 imageGrid.slice）。
  detectScenes: protectedProcedure
    .input(z.object({
      inputUrl: mediaUrlSchema,
      threshold: z.number().min(0.1).max(0.9).default(0.3),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.inputUrl);
      const boundaries = await detectSceneChanges(input.inputUrl, input.threshold);
      return { boundaries };
    }),

  // 快剪「本机 AI 自动剪辑」：ffmpeg silencedetect 找静音段（零 LLM/转写成本，
  // 不做白名单门控，对齐 detectScenes 策略）。前端据此掐头去尾设入/出点。
  detectSilences: protectedProcedure
    .input(z.object({
      inputUrl: mediaUrlSchema,
      noiseDb: z.number().min(-60).max(-10).default(-32),
      minSilenceSec: z.number().min(0.2).max(5).default(0.5),
      durationSec: z.number().min(0).max(24 * 3600).optional(),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.inputUrl);
      const silences = await detectSilences(input.inputUrl, {
        noiseDb: input.noiseDb, minSilenceSec: input.minSilenceSec, durationSec: input.durationSec,
      });
      return { silences };
    }),

  smartCut: protectedProcedure
    .input(z.object({
      inputUrl: mediaUrlSchema,
      aggressiveness: z.enum(["low", "medium", "high"]).default("medium"),
      targetDuration: z.number().min(5).max(3600).optional(),
      /** 镜头边界（秒，来自装配成片的 segStarts）：剪辑边界优先落在切点上（镜界保护）。 */
      shotBoundaries: z.array(z.number().min(0)).max(60).optional(),
      model: z.string().optional(),
      projectId: z.number().optional(),
      nodeId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await assertWhitelisted(ctx);
      guardUrl(input.inputUrl);
      return dedupe("clip.smartCut", ctx.user.id, input, async () => {
        // 智能剪辑转写受「系统默认模型 › 字幕转录」(transcribe 槽) 控制，按 provider 路由。
        const transcription = await transcribeAudio({ audioUrl: input.inputUrl, model: await getSystemDefaultModel("transcribe") });
        if ("error" in transcription) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `转录失败：${transcription.error}` });
        }
        const rawSegs = transcription.segments ?? [];
        if (rawSegs.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "转写未返回时间戳段落，无法智能剪辑；请改用支持段级时间戳的模型（如 whisper-1）" });
        const segments = rawSegs.map((s) => ({
          start: s.start, end: s.end, text: s.text.trim(),
          no_speech_prob: s.no_speech_prob ?? 0,
        }));

        const AGGRESSIVE_THRESHOLDS: Record<string, number> = { low: 0.20, medium: 0.40, high: 0.65 };
        const removeThreshold = AGGRESSIVE_THRESHOLDS[input.aggressiveness];
        const targetHint = input.targetDuration
          ? `\n目标剪辑后总时长：约 ${input.targetDuration} 秒，请优先选取最有价值的片段使保留片段总时长接近此目标。`
          : "";

        const bounds = (input.shotBoundaries ?? []).filter((b) => Number.isFinite(b) && b >= 0).sort((a, b) => a - b);
        const boundsHint = bounds.length
          ? `\n镜头边界（秒）：[${bounds.map((b) => b.toFixed(2)).join(", ")}]。这是成片的镜头切点：保留/移除片段的边界应尽量落在这些切点上，不要在镜头中间起切或收切（除非该镜头内部确有冗余需要剔除）。`
          : "";
        const systemPrompt = `你是专业视频剪辑师。给定视频转录片段，决定哪些片段应该保留。
移除标准（移除值越高越激进）：无意义停顿、重复内容、低信息密度片段、口误填充词（"嗯"、"呃"等）。
当前移除激进度：${input.aggressiveness}（${Math.round(removeThreshold * 100)}% 截止阈值）。${targetHint}${boundsHint}
仅输出合法 JSON，无 markdown：{"keep":[{"start":0.5,"end":5.2},{"start":8.1,"end":15.0}]}`;

        const transcriptJson = JSON.stringify(segments.map((s) => ({ s: s.start, e: s.end, t: s.text, ns: s.no_speech_prob })));
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: `片段列表（JSON）：\n${transcriptJson}` },
          ],
          model: input.model ?? await getSystemDefaultModel("llm"),
          maxTokens: 2000,
        });
        const text = extractTextContent(response);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        let parsed: { keep: Array<{ start: number; end: number }> };
        try { parsed = JSON.parse(jsonMatch[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
        let keepSegments = Array.isArray(parsed.keep) ? parsed.keep.filter((seg) => typeof seg.start === "number" && typeof seg.end === "number" && seg.end > seg.start) : [];
        // 镜界保护（确定性，不靠 LLM 自觉）：剪辑边界落在切点 ±0.5s 内时吸附到切点，
        // 避免在镜头边缘留下几帧残片或吃掉镜头开头。
        if (bounds.length) {
          const snap = (t: number) => {
            for (const b of bounds) if (Math.abs(t - b) <= 0.5) return b;
            return t;
          };
          keepSegments = keepSegments
            .map((s) => ({ start: snap(s.start), end: snap(s.end) }))
            .filter((s) => s.end > s.start);
        }
        if (keepSegments.length === 0) throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "AI 未找到可保留片段，请调低激进度后重试" });
        const originalDuration = segments.length > 0 ? Math.max(...segments.map((s) => s.end)) : 0;
        const result = await smartCutVideo({ inputUrl: input.inputUrl, keepSegments });
        // Clamp outputDuration: AI may return end times beyond actual video EOF;
        // FFmpeg silently trims to EOF so the true output is shorter than the summed segment durations.
        const outputDuration = originalDuration > 0
          ? Math.min(result.outputDuration, originalDuration)
          : result.outputDuration;
        await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "video", name: "智能剪辑" });
        // #73 纳管审计：智能剪辑此前无审计记录（LLM 用量另有统一 LLM 日志，这里记操作本身）
        writeAuditLog({ ctx, action: "smart_cut", detail: { model: input.model ?? "default", aggressiveness: input.aggressiveness, keptSegments: keepSegments.length, resultUrl: result.url, success: true } });
        return { url: result.url, outputDuration, originalDuration };
      });
    }),

  poseControl: protectedProcedure
    .input(z.object({
      // Was z.string().url() — that rejected our own /manus-storage/ relative paths,
      // which is exactly what a connected upstream image node feeds in. Use the shared
      // mediaUrlSchema (http(s) OR /manus-storage/); guardUrl + resolveToAbsoluteUrl
      // (in generateImage) still handle the relative case downstream.
      referenceImageUrl: mediaUrlSchema,
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
        // #73 纳管审计：姿态控制此前无审计记录
        writeAuditLog({ ctx, action: "pose_control", detail: { model: "hf_flux_pro", prompt: truncate(input.prompt), resultUrl: result.url ?? null, success: true } });
        return { url: result.url };
      });
    }),
});

// ── Image Edit (cloud one-click 图像编辑) ───────────────────────────────────────
// A real executor: operation + source image → edit instruction → generateImage with
// an edit-capable model (higgsfield / KIE / Poyo). Reuses the EXACT auth + dedupe +
// persistence machinery as imageGen/poseControl, so it works wherever those do.
export const imageEditRouter = router({
  run: protectedProcedure
    .input(z.object({
      sourceImageUrl: mediaUrlSchema,
      operation: z.enum(["remove_bg", "outpaint", "inpaint", "erase", "relight", "reframe", "upscale", "reangle"]),
      // Edit-capable model (validated against the shared allow-list). Empty → default.
      model: z.string().max(64).optional(),
      prompt: z.string().max(1000).optional(),
      maskUrl: mediaUrlSchema.optional(),
      // 打光智能模式的参考图：作为第二张图传给编辑模型，指令要求匹配其光照氛围（#72）。
      refImageUrl: mediaUrlSchema.optional(),
      aspectRatio: z.string().max(32).optional(),
      kieTempKey: z.string().max(256).optional(),
      estimatedCost: z.string().max(32).optional(),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Resolve model: reject anything not on the edit-capable allow-list (a non-edit
      // model would ignore the source image and re-generate from scratch).
      const model = input.model && IMAGE_EDIT_MODELS.includes(input.model) ? input.model : DEFAULT_IMAGE_EDIT_MODEL;
      // Auth mirrors imageGenRouter: kie models use their own key resolution and
      // bypass the global whitelist; everything else stays whitelist-gated.
      let kieApiKey: string | undefined;
      if (isKieImageModel(model)) {
        const resolved = await resolveKieKey(ctx, input.kieTempKey);
        kieApiKey = resolved.key;
      } else {
        await assertWhitelisted(ctx);
      }
      if (input.projectId != null) {
        await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      }
      guardUrl(input.sourceImageUrl);
      if (input.maskUrl) guardUrl(input.maskUrl);
      if (input.refImageUrl) guardUrl(input.refImageUrl);
      return dedupe("imageEdit", ctx.user.id, input, async () => {
        let instruction = buildImageEditInstruction(input.operation, input.prompt, input.aspectRatio);
        // When a painted mask is supplied (inpaint/erase), pass it as an extra
        // reference image and point the model at it. Best-effort: cloud edit models
        // primarily follow the text instruction (local ComfyUI inpaint uses a true mask).
        const images: Array<{ url: string }> = [{ url: input.sourceImageUrl }];
        if (input.maskUrl && (input.operation === "inpaint" || input.operation === "erase")) {
          images.push({ url: input.maskUrl });
          instruction += " The second provided image is a mask: its white area marks the exact region to edit; leave the rest untouched.";
        }
        // 打光智能模式：参考图作为光照氛围范本（仅 relight 生效，避免其它操作被误导）。
        if (input.refImageUrl && input.operation === "relight") {
          images.push({ url: input.refImageUrl });
          instruction += " The second provided image is a lighting reference: match its lighting direction, color palette and mood, but keep the first image's subject and composition unchanged.";
        }
        // 画幅结构化下发：size 覆盖 poyo(aspect_ratio)/kie(options.size)，reveAspectRatio
        // 覆盖 Higgsfield(Reve/Seedream/Flux Pro)。needsAspect 操作（扩图/改比例）传用户
        // 选的目标比例；其余操作客户端现传「源图比例」——不能只依赖模型自觉保画幅：
        // kie 编辑系未传比例时被 clampAspect 强制回落枚举首位（nano-banana-edit=1:1、
        // flux-kontext=21:9），原图画幅被静默改掉（2026-07 真实反馈：多功能丢失原图比例）。
        // 指令文本里的比例措辞仍只对 needsAspect 操作拼入（buildImageEditInstruction 内部按 op 判断）。
        const wantsAspect = !!input.aspectRatio;
        try {
          const result = await generateImage({
            prompt: instruction,
            model,
            originalImages: images,
            ...(wantsAspect ? { size: input.aspectRatio, reveAspectRatio: input.aspectRatio } : {}),
            ...(kieApiKey ? { kieApiKey } : {}),
          });
          const url = result.url ?? result.urls?.[0];
          writeAuditLog({
            ctx,
            action: "image_edit",
            detail: {
              operation: input.operation, model,
              prompt: truncate(instruction),
              resultUrl: url ?? null,
              ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
              success: true,
            },
          });
          if (url) {
            const prov = model.startsWith("hf_") ? "higgsfield" : model.startsWith("kie_") ? "kie" : model.startsWith("poyo_") ? "poyo" : "forge";
            await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId ?? null, type: "image", source: "generated", provider: prov, model, url, name: `图像编辑·${input.operation}` });
          }
          return { url, sourceUrl: result.sourceUrl, sourceAt: result.sourceAt };
        } catch (err: unknown) {
          writeAuditLog({
            ctx,
            action: "image_edit",
            detail: {
              operation: input.operation, model,
              ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
              success: false,
              error: truncate(err instanceof Error ? err.message : String(err)),
            },
          });
          throw err;
        }
      });
    }),
});

// ── Image Grid slice (网格分镜：把一张网格大图切成 N 张分镜关键帧) ───────────────
// Local ffmpeg crop, no third-party AI → gated by project access only (mirrors
// mergeRouter/burnIn), with SSRF guard on the source URL.
export const imageGridRouter = router({
  slice: protectedProcedure
    .input(z.object({
      imageUrl: mediaUrlSchema,
      rows: z.number().int().min(1).max(8),
      cols: z.number().int().min(1).max(8),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.rows * input.cols > 64) throw new TRPCError({ code: "BAD_REQUEST", message: "网格单元过多（上限 64）" });
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.imageUrl);
      const result = await sliceGridImage(input.imageUrl, input.rows, input.cols);
      return { urls: result.urls, rows: result.rows, cols: result.cols };
    }),

  // 视频→分镜反解：抽 N 张等距关键帧（本地 ffmpeg，仅项目门控 + SSRF 守卫）。
  fromVideo: protectedProcedure
    .input(z.object({
      videoUrl: mediaUrlSchema,
      count: z.number().int().min(1).max(24),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.videoUrl);
      const result = await extractStoryboardFrames(input.videoUrl, input.count);
      return { frames: result.frames, duration: result.duration };
    }),
});

// ── Video Merge ───────────────────────────────────────────────────────────────
export const mergeRouter = router({
  mergeVideos: protectedProcedure
    .input(
      z.object({
        inputUrls: z.array(mediaUrlSchema).min(2).max(50),
        transition: z.enum(["none", "fade", "dissolve", "fadeblack", "fadewhite", "smoothleft"]).optional(),
        transitionDuration: z.number().min(0.1).max(2.0).optional(),
        // 逐切点转场（长度=段数-1；来源：镜头表装配 或 #244 合并节点逐接缝编辑）+ 逐段配音/音效轨（与段对位）
        transitions: z.array(z.enum(["none", "fade", "dissolve", "fadeblack", "fadewhite", "smoothleft", "wipe"])).max(49).optional(),
        voiceUrls: z.array(mediaUrlSchema.nullable()).max(50).optional(),
        sfxUrls: z.array(mediaUrlSchema.nullable()).max(50).optional(),
        bgMusicUrl: mediaUrlSchema.optional(),
        bgMusicVolume: z.number().min(0).max(1).optional(),
        originalVolume: z.number().min(0).max(2).optional(),
        projectId: z.number().optional(),
        nodeId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg, no third-party AI — not whitelist-gated
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      for (const url of input.inputUrls) guardUrl(url);
      if (input.bgMusicUrl) guardUrl(input.bgMusicUrl);
      for (const v of input.voiceUrls ?? []) if (v) guardUrl(v);
      for (const v of input.sfxUrls ?? []) if (v) guardUrl(v);
      const result = await mergeVideos(input);
      await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "video", name: "合并视频" });
      return { url: result.url, duration: result.duration, segStarts: result.segStarts };
    }),
});

// ── Subtitles ─────────────────────────────────────────────────────────────────
export const subtitleRouter = router({
  transcribe: protectedProcedure
    .input(
      z.object({
        audioUrl: mediaUrlSchema,
        language: z.string().optional(),
        model: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      // (audioUrl, language, model) deterministically map to a transcription, so
      // dedupe by that triple — repeated submits during the long call collapse.
      guardUrl(input.audioUrl);
      return dedupe("subtitle.transcribe", ctx.user.id, input, async () => {
        const result = await transcribeAudio({ audioUrl: input.audioUrl, language: input.language, model: input.model });
        if ("error" in result) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
        }
        // 有的模型（如 gpt-4o-transcribe）只回文本、不返回段级时间戳（segments 缺失），此前 .map 直接
        // 崩 500。改为可读业务错误，引导换用支持时间戳的模型。
        const segs = result.segments ?? [];
        if (segs.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "该转写模型未返回时间戳段落，无法生成字幕；请改用支持段级时间戳的模型（如 whisper-1）" });
        const entries: SubtitleEntry[] = segs.map((s) => ({
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
        videoUrl: mediaUrlSchema,
        entries: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().max(500) })).max(2000),
        fontSize: z.number().int().min(8).max(48).optional(),
        fontColor: z.string().optional(),
        projectId: z.number().optional(),
        nodeId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg, no third-party AI — not whitelist-gated
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.videoUrl);
      const result = await burnSubtitles(input.videoUrl, input.entries as SubtitleEntry[], {
        fontSize: input.fontSize,
        fontColor: input.fontColor,
      });
      await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "video", name: "字幕" });
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
    .input(z.object({ audioUrl: mediaUrlSchema, language: z.string().optional(), model: z.string().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      guardUrl(input.audioUrl);
      return dedupe("subtitleMotion.transcribe", ctx.user.id, input, async () => {
        const result = await transcribeAudio({ audioUrl: input.audioUrl, language: input.language, model: input.model });
        if ("error" in result) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
        const segs = result.segments ?? [];
        if (segs.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "该转写模型未返回时间戳段落，无法生成字幕；请改用支持段级时间戳的模型（如 whisper-1）" });
        const entries: SubtitleEntry[] = segs.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
        // #73 纳管审计：动态字幕转写此前无审计记录（subtitle.transcribe 的孪生入口，口径对齐）
        writeAuditLog({ ctx, action: "subtitle_transcribe", detail: { model: input.model ?? "default", entries: entries.length, kind: "motion", success: true } });
        return { entries, fullText: result.text, language: result.language };
      });
    }),

  burnMotion: protectedProcedure
    .input(z.object({
      videoUrl: mediaUrlSchema,
      entries: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(500) })).min(1).max(2000).refine((arr) => arr.every((e) => e.end > e.start), { message: "每条字幕的 end 必须大于 start" }),
      motionStyle: z.enum(["fade", "roll", "karaoke", "bounce"]).optional(),
      fontSize: z.number().int().min(8).max(48).optional(),
      fontColor: z.string().optional(),
      projectId: z.number().optional(),
      nodeId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg (ASS burn), no third-party AI — not whitelist-gated
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.videoUrl);
      return dedupe("subtitleMotion.burnMotion", ctx.user.id, input, async () => {
        const result = await burnAssSubtitles(
          input.videoUrl,
          input.entries as SubtitleEntry[],
          { motionStyle: input.motionStyle, fontSize: input.fontSize, fontColor: input.fontColor },
        );
        await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "video", name: "字幕动效" });
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
        inputUrl: mediaUrlSchema,
        mode: z.enum(["watermark", "pip", "color_correction"]),
        // Watermark
        overlayImageUrl: mediaUrlSchema.optional(),
        overlayPosition: z.enum(["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"]).optional(),
        overlayScale: z.number().min(0.05).max(1.0).optional(),
        overlayOpacity: z.number().min(0).max(1).optional(),
        // PiP
        pipVideoUrl: mediaUrlSchema.optional(),
        pipPosition: z.enum(["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"]).optional(),
        pipScale: z.number().min(0.1).max(0.5).optional(),
        // Color correction
        brightness: z.number().min(-1).max(1).optional(),
        contrast: z.number().min(0).max(2).optional(),
        saturation: z.number().min(0).max(3).optional(),
        projectId: z.number().optional(),
        nodeId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // local ffmpeg (overlay/水印/调色), no third-party AI — not whitelist-gated
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      guardUrl(input.inputUrl);
      if (input.overlayImageUrl) guardUrl(input.overlayImageUrl);
      if (input.pipVideoUrl) guardUrl(input.pipVideoUrl);
      const result = await overlayVideo(input);
      await recordEditedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, url: result.url, type: "video", name: "叠加" });
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
        // Opt-in: after a successful run, free VRAM on the (local) server when idle.
        freeVramAfterRun: z.boolean().optional(),
        // #163 隧道兜底：一次性 jobId，隧道切断超长 HTTP 后前端凭它走 socket 回灌 / workflowResult 轮询取结果。
        jobId: z.string().max(64).optional(),
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
      const baseUrl = await resolveComfyBase(input.customBaseUrl);
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: COMFY_NOT_CONFIGURED });
      return dedupe("comfyui.generateImage", ctx.user.id, input, () => withComfyUsageLog(
        ctx,
        { action: "generateImage", baseUrl, model: input.ckpt, projectId: input.projectId, nodeId: input.nodeId,
          detail: { template: input.workflowTemplate, prompt: truncate(input.prompt), seed: input.seed, width: input.width, height: input.height, steps: input.steps, cfg: input.cfg, batchSize: input.batchSize, arch: input.arch } },
        async () => {
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
          const outUrls = result.urls?.length ? result.urls : (result.url ? [result.url] : []);
          for (const u of outUrls) {
            await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, type: "image", source: "generated", provider: "comfyui", model: input.ckpt, url: u, name: input.ckpt || "ComfyUI 图像" });
          }
          // #163 终局回灌：存 jobId + 广播 socket 结果。即便隧道已切断超长 HTTP，前端凭 jobId
          // 走 socket 回灌 / workflowResult 轮询兜底仍能拿到结果（对齐自定义工作流节点）。
          if (input.jobId) setComfyJobDone(input.jobId, outUrls, "image");
          emitComfyWorkflowResult(input.projectId, { nodeId: input.nodeId, jobId: input.jobId ?? "", ok: true, urls: outUrls, outputType: "image" });
          // Optional post-run VRAM cleanup (local only, queue must be idle); awaited
          // so the runner advances only after the cache is freed. Best-effort.
          if (input.freeVramAfterRun) {
            try {
              const queue = await getComfyQueueDepth(baseUrl);
              if (shouldFreeVram({ enabled: true, isCloud: false, queue })) await freeComfyMemory(baseUrl);
            } catch { /* cleanup is best-effort */ }
          }
          return { url: result.url, urls: result.urls };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // #163 失败也回灌：隧道切断 HTTP 后前端能凭 jobId 收到「失败」而非永久卡在运行中。
          if (input.jobId) setComfyJobError(input.jobId, msg);
          emitComfyWorkflowResult(input.projectId, { nodeId: input.nodeId, jobId: input.jobId ?? "", ok: false, error: msg });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }
        },
        (r) => ({ resultUrl: r.url, resultCount: r.urls?.length ?? 1 }),
      ));
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
        loras: z.array(z.object({
          name: z.string().min(1).max(255),
          strengthModel: z.number().min(-10).max(10),
          strengthClip: z.number().min(-10).max(10).optional(),
        })).max(8).optional(),
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
        // Opt-in: after a successful run, free VRAM on the (local) server when idle.
        freeVramAfterRun: z.boolean().optional(),
        // #163 隧道兜底：一次性 jobId，隧道切断超长 HTTP 后前端凭它走 socket 回灌 / workflowResult 轮询取结果。
        jobId: z.string().max(64).optional(),
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
      const baseUrl = await resolveComfyBase(input.customBaseUrl);
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: COMFY_NOT_CONFIGURED });
      return dedupe("comfyui.generateVideo", ctx.user.id, input, () => withComfyUsageLog(
        ctx,
        { action: "generateVideo", baseUrl, model: input.ckpt, projectId: input.projectId, nodeId: input.nodeId,
          detail: { template: input.workflowTemplate, prompt: truncate(input.prompt), seed: input.seed, frames: input.frames, fps: input.fps, steps: input.steps, cfg: input.cfg } },
        async () => {
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
            loras: input.loras,
            projectId: input.projectId,
            nodeId: input.nodeId,
          });
          writeAuditLog({
            ctx,
            action: "comfyui_video_gen",
            detail: { template: input.workflowTemplate, ckpt: input.ckpt, prompt: truncate(input.prompt), resultUrl: result.url, nodeId: input.nodeId },
          });
          await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, type: "video", source: "generated", provider: "comfyui", model: input.ckpt, url: result.url, name: input.ckpt || "ComfyUI 视频" });
          // #163 终局回灌：存 jobId + 广播 socket 结果。隧道切断超长 HTTP 后前端凭 jobId
          // 走 socket 回灌 / workflowResult 轮询兜底仍能拿到结果（对齐自定义工作流节点）。
          if (input.jobId) setComfyJobDone(input.jobId, result.url ? [result.url] : [], "video");
          emitComfyWorkflowResult(input.projectId, { nodeId: input.nodeId, jobId: input.jobId ?? "", ok: true, urls: result.url ? [result.url] : [], outputType: "video" });
          // Optional post-run VRAM cleanup (local only, queue must be idle). Best-effort.
          if (input.freeVramAfterRun) {
            try {
              const queue = await getComfyQueueDepth(baseUrl);
              if (shouldFreeVram({ enabled: true, isCloud: false, queue })) await freeComfyMemory(baseUrl);
            } catch { /* cleanup is best-effort */ }
          }
          return { url: result.url };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // #163 失败也回灌：隧道切断 HTTP 后前端能凭 jobId 收到「失败」而非永久卡在运行中。
          if (input.jobId) setComfyJobError(input.jobId, msg);
          emitComfyWorkflowResult(input.projectId, { nodeId: input.nodeId, jobId: input.jobId ?? "", ok: false, error: msg });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }
        },
        (r) => ({ resultUrl: r.url, resultCount: 1 }),
      ));
    }),

  // Live health/capacity of one or more ComfyUI servers (online · VRAM · queue).
  // Same SSRF gate as fetchModels (server probes client-supplied URLs). Returns
  // one status per input URL, in order, echoing the exact input string for 1:1
  // client mapping; an unreachable server yields { online: false, error }.
  serverStatus: protectedProcedure
    .input(z.object({
      baseUrls: z.array(z.string().max(2048)).max(20),
      // Optional per-server physical GPU index (the server's --cuda-device). On a
      // shared multi-GPU host this is the ONLY deterministic way to know which GPU
      // an instance uses (Crystools reports all GPUs unindexed; see comfyMonitor).
      gpuIndexByUrl: z.record(z.string(), z.number().int().min(0).max(63)).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const urls = Array.from(new Set(input.baseUrls.map((u) => u.trim()).filter(Boolean)));
      // 与 fetchModels/生成一致：留空回退到全局默认解析（env → 后台全局服务器列表），不只看 env。
      let list = urls;
      if (list.length === 0) { const dflt = (await resolveComfyBase("")).trim(); if (dflt) list = [dflt]; }
      const idx = input.gpuIndexByUrl ?? {};
      return Promise.all(list.map((u) => fetchComfyServerStatus(u, idx[u])));
    }),

  interrupt: protectedProcedure
    .input(z.object({ customBaseUrl: z.string().max(2048).optional() }))
    .mutation(async ({ ctx, input }) => {
      // Same SSRF gate as the generate endpoints (server POSTs to a client URL).
      // Use the ComfyUI-specific gate so cancel stays consistent with generate
      // when an admin has enabled the ComfyUI whitelist bypass.
      await assertComfyuiAllowed(ctx);
      const baseUrl = await resolveComfyBase(input.customBaseUrl);
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: COMFY_NOT_CONFIGURED });
      try {
        await interruptComfy(baseUrl);
        return { ok: true as const };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  // Admin-managed global server registry — every user reads it; writing global
  // infrastructure is a manager action (L3+), not for viewer/operator admins.
  globalServers: protectedProcedure.query(() => getComfyGlobalServers()),
  setGlobalServers: levelProcedure(3)
    .input(z.object({ servers: z.array(z.string().max(2048)).max(50) }))
    .mutation(async ({ input }) => {
      await setComfyGlobalServers(input.servers);
      return { ok: true as const };
    }),

  // Admin-managed per-server physical GPU pin (the server's --cuda-device), shared
  // by all users so the admin's choice syncs everywhere. Every user reads it.
  // Writing is a manager action (L3+).
  globalGpuIndex: protectedProcedure.query(() => getComfyGlobalGpuIndex()),
  setGlobalGpuIndex: levelProcedure(3)
    .input(z.object({ gpuIndex: z.record(z.string().max(2048), z.number().int().min(0).max(63)) }))
    .mutation(async ({ input }) => {
      await setComfyGlobalGpuIndex(input.gpuIndex);
      return { ok: true as const };
    }),

  // Per-server control actions for the topbar status panel.
  serverAction: protectedProcedure
    .input(z.object({
      baseUrl: z.string().max(2048),
      action: z.enum(["free", "interrupt", "clearQueue"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = await resolveComfyBase(input.baseUrl);
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: COMFY_NOT_CONFIGURED });
      return withComfyUsageLog(ctx, { action: `serverAction:${input.action}`, baseUrl }, async () => {
        try {
          if (input.action === "free") await freeComfyMemory(baseUrl);
          else if (input.action === "interrupt") await interruptComfy(baseUrl);
          else await clearComfyQueue(baseUrl);
          return { ok: true as const };
        } catch (err) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
        }
      });
    }),

  fetchModels: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      // Multi-server: refresh the union of models across all saved addresses.
      customBaseUrls: z.array(z.string().max(2048)).max(20).optional(),
      /** 是否使用「资源记忆体」缓存模型清单（默认 true；false=强制读真机刷新，如刚装/删模型）。 */
      useMemory: z.boolean().optional(),
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
      // 无显式地址时，回退到与「生成」完全一致的全局默认解析（resolveComfyBase：
      // 环境变量 COMFYUI_BASE_URL → 管理后台全局服务器列表第一台）。此前这里只看
      // ENV.comfyuiBaseUrl，漏了 DB 全局服务器列表——导致「地址留空刷不到 checkpoint、
      // 手动填入同一个全局地址却能刷到」（列表回退与生成回退不一致）的 bug。
      let urls = candidates;
      if (urls.length === 0) {
        const dflt = (await resolveComfyBase("")).trim();
        if (dflt) urls = [dflt];
      }
      // Not configured is a benign empty state (UI degrades to free-text), not an error.
      if (urls.length === 0) return emptyModelList();
      // Single URL: preserve original behavior — surface the real reason
      // (unreachable / bad status / timeout) so the UI can distinguish
      // "server has no models" from "couldn't reach server".
      if (urls.length === 1) {
        try {
          // 默认走「资源记忆体」：学过一次后直接命中缓存（永不过期，装/删模型点刷新或复位重学）；
          // useMemory=false 强制读真机刷新。多服务器合并路径仍走实时（记忆按单服务器缓存）。
          return input.useMemory === false
            ? await getComfyModelList(urls[0], { force: true })
            : await getComfyModelList(urls[0]);
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

  // ── ComfyUI 知识记忆体（跨会话/跨节点共享）：把某台服务器的资源清单 + 节点 schema 记住，
  //    工程智能体 / ComfyUI 节点 / 画布助手都能复用，不必每次重拉。三端共用，见 comfyKnowledge.ts。──
  // getKnowledge：有新鲜记忆则命中，否则拉真机并写入记忆。返回资源摘要（不含庞大的 objectInfo 原文）。
  getKnowledge: protectedProcedure
    .input(z.object({ customBaseUrl: z.string().max(2048).optional(), force: z.boolean().optional(), useMemory: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = (await resolveComfyBase(input.customBaseUrl)).trim();
      if (!baseUrl) return { configured: false as const };
      // useMemory=false（节点「不使用记忆体」）等价于 force：直接读真机（仍写穿缓存供他方复用）。
      const k = await getComfyKnowledge(baseUrl, { force: input.force || input.useMemory === false });
      const r = k.resources;
      return {
        configured: true as const, baseUrl: k.baseUrl, fetchedAt: k.fetchedAt,
        counts: { checkpoints: r.checkpoints.length, loras: r.loras.length, vaes: r.vaes.length, samplers: r.samplers.length, schedulers: r.schedulers.length, nodeClasses: r.nodeClasses.length },
        resources: r,
      };
    }),
  // refreshKnowledge：强制重新学习（装/删模型后调）。同时清 objectInfo 记忆。
  refreshKnowledge: protectedProcedure
    .input(z.object({ customBaseUrl: z.string().max(2048).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = (await resolveComfyBase(input.customBaseUrl)).trim();
      if (!baseUrl) return { configured: false as const };
      invalidateComfyKnowledge(baseUrl);
      const k = await getComfyKnowledge(baseUrl, { force: true });
      const r = k.resources;
      return { configured: true as const, fetchedAt: k.fetchedAt, counts: { checkpoints: r.checkpoints.length, loras: r.loras.length, vaes: r.vaes.length, nodeClasses: r.nodeClasses.length } };
    }),
  // resetAllKnowledge：复位「全部服务器」的知识记忆体——清空进程内缓存 + DB 持久化全表。
  // 不立即重学（各服务器下次被调用时按需自动重建），避免同时触发多台真机抓取。
  resetAllKnowledge: levelProcedure(3).mutation(async ({ ctx }) => {
    await assertComfyuiAllowed(ctx);
    invalidateComfyKnowledge(); // 内存全清 + DB 全表删（见 comfyKnowledge.ts）
    return { ok: true as const };
  }),
  // searchKnowledge：在记忆里按关键词检索资源（不发起真机检索，除非尚无记忆才先学习一次）。
  searchKnowledge: protectedProcedure
    .input(z.object({ customBaseUrl: z.string().max(2048).optional(), query: z.string().max(200), useMemory: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = (await resolveComfyBase(input.customBaseUrl)).trim();
      if (!baseUrl) return { configured: false as const, matches: null };
      // useMemory=false：不吃缓存，强制读真机后再检索。
      const k = input.useMemory === false
        ? await getComfyKnowledge(baseUrl, { force: true })
        : (peekComfyKnowledge(baseUrl) ?? (await getComfyKnowledge(baseUrl)));
      return { configured: true as const, matches: searchComfyKnowledge(k, input.query) };
    }),

  analyzeWorkflow: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      workflowJson: z.string().max(500_000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = (await resolveComfyBase(input.customBaseUrl)) || undefined;
      try {
        return await analyzeWorkflow(input.workflowJson, baseUrl);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  // 「AI 辅助分析导入」：先跑启发式分析拿基线，再让本机 Claude（claude-local + 已放行的 ComfyUI
  // MCP）纠正参数类型/角色、判主次，合并回基线。桥接未配 / AI 失败 → 回退启发式（含主次排序），
  // 绝不比不开 AI 更差。策略 C：AI 只纠 type/role/priority，绑定本身沿用启发式，稳。
  analyzeWorkflowAI: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      workflowJson: z.string().max(500_000),
      model: z.string().max(64).optional(),
      kieTempKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = (await resolveComfyBase(input.customBaseUrl)) || undefined;
      let base: Awaited<ReturnType<typeof analyzeWorkflow>>;
      try { base = await analyzeWorkflow(input.workflowJson, baseUrl); }
      catch (err) { throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) }); }

      const model = input.model?.trim() || "claude-local";
      const isLocal = model.startsWith("claude-local") || model.startsWith("gpt-local") || model.startsWith("grok-local");
      if (!isClaudeBridgeEnabled() || !isLocal) {
        return { ...base, aiUsed: false, aiNote: "未启用本机 Claude 桥接，已用启发式分析（含主次排序）" };
      }
      try {
        const classMap = nodeClassMap(input.workflowJson);
        const sys = "你是 ComfyUI 工作流参数分析助手。给你「节点id→class_type」映射与一份初步参数绑定。"
          + "若有 comfyui MCP 工具，请用它查各 class_type 的真实输入 schema(object_info) 来纠正类型/角色。"
          + '输出严格 JSON：{"bindings":[{"nodeId","fieldPath","type":"text|number|select|image|audio|boolean","role":"positive|negative|reference|control|mask"(可选),"priority":1或2,"label":"中文短名"(可选)}]}。'
          + "规则：sampler_name/scheduler/ckpt_name/*_name 等是 select 不是 text；正负 CLIP 顺采样器 negative 输入回溯判断、别只看字段名；priority=1 是主参数(正/负提示词、宽高、主模型、steps、cfg、seed)，其余=2。"
          + "只返回你有把握纠正/排序的绑定，其余省略(沿用初步值)。禁止输出任何解释或 Markdown 代码围栏。";
        const user = `节点类型映射:\n${JSON.stringify(classMap).slice(0, 12000)}\n\n初步绑定:\n${JSON.stringify(base.detectedParams).slice(0, 20000)}`;
        const res = await invokeLLMWithKie(ctx, { messages: [{ role: "system", content: sys }, { role: "user", content: user }], model, maxTokens: 4000 }, input.kieTempKey ?? null);
        const aiBindings = parseAiBindings(extractTextContent(res));
        if (!aiBindings.length) return { ...base, aiUsed: false, aiNote: "AI 未返回可用结果，已用启发式分析" };
        return { ...base, detectedParams: mergeAiBindings(base.detectedParams, aiBindings), aiUsed: true, aiNote: `AI 已纠正/排序 ${aiBindings.length} 项参数` };
      } catch (err) {
        return { ...base, aiUsed: false, aiNote: "AI 分析失败，已回退启发式：" + (err instanceof Error ? err.message.slice(0, 80) : "") };
      }
    }),

  // 导入向导预检：拿目标服务器 /object_info 把工作流逐项核对（缺节点 / 枚举·模型值非法 /
  // 必填缺失），让用户导入前就改对，而非运行后反复试错。
  validateWorkflow: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      workflowJson: z.string().max(500_000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = (await resolveComfyBase(input.customBaseUrl)) || undefined;
      try {
        return await validateWorkflow(input.workflowJson, baseUrl);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  // Shot continuity: extract a ControlNet control map (depth/pose/canny…) from a
  // shot's output image, so the next shot can reuse the structure. Returns the
  // stored URL of the extracted map.
  // 混元 3D：图生 .glb（本机 ComfyUI + Hunyuan3DWrapper 插件），免 credits。
  // 默认内置工作流；插件版本不匹配时用 HUNYUAN3D_WORKFLOW_JSON 环境变量替换（见 comfyui.ts）。
  imageTo3d: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      sourceImageUrl: mediaUrlSchema,
      workflowJson: z.string().max(2_000_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      guardUrl(input.sourceImageUrl);
      const baseUrl = await resolveComfyBase(input.customBaseUrl);
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: COMFY_NOT_CONFIGURED });
      return withComfyUsageLog(ctx, { action: "imageTo3d", baseUrl, model: "hunyuan3d" }, async () => {
        try {
          const r = await executeHunyuan3D(baseUrl, input.sourceImageUrl, { workflowJson: input.workflowJson });
          // 转存成功的 glb 记入素材库（volatile 直链不记，防素材库里躺失效链接）。
          if (!r.volatile) {
            try { await recordGeneratedAsset({ userId: ctx.user.id, projectId: null, type: "other", source: "generated", provider: "hunyuan3d", model: "comfyui", url: r.glbUrl, name: "混元3D模型.glb", mimeType: "model/gltf-binary" }); } catch { /* 尽力而为 */ }
          }
          return r;
        } catch (err) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
        }
      }, (r) => ({ resultUrl: r.glbUrl, resultCount: 1 }));
    }),

  extractControlMap: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      sourceImageUrl: z.string().min(1).max(2048),
      preprocessor: z.enum(CONTROL_MAP_PREPROCESSORS),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = await resolveComfyBase(input.customBaseUrl);
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: COMFY_NOT_CONFIGURED });
      return withComfyUsageLog(ctx, { action: "extractControlMap", baseUrl, model: input.preprocessor }, async () => {
        try {
          return { url: await extractControlMap(baseUrl, input.sourceImageUrl, input.preprocessor) };
        } catch (err) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : String(err) });
        }
      }, (r) => ({ resultUrl: r.url, resultCount: 1 }));
    }),

  // Convert a ComfyUI UI-graph ("workflow") JSON to runnable API ("prompt") JSON,
  // using the server's /object_info. Best-effort; throws a clear message on
  // failure so the client falls back to asking for the API format.
  convertWorkflow: protectedProcedure
    .input(z.object({
      customBaseUrl: z.string().max(2048).optional(),
      uiWorkflow: z.string().max(5_000_000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertComfyuiAllowed(ctx);
      const baseUrl = await resolveComfyBase(input.customBaseUrl);
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "无法读取节点定义以转换——" + COMFY_NOT_CONFIGURED });
      try {
        return { workflowJson: await convertUiWorkflowToApi(input.uiWorkflow, baseUrl) };
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
      const baseUrl = await resolveComfyBase(input.customBaseUrl);
      if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: COMFY_NOT_CONFIGURED });
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

  // Test cloud connectivity + API key for the node's 测试 button (gated like exec).
  cloudTest: protectedProcedure.mutation(async ({ ctx }) => {
    await assertComfyuiCloudAllowed(ctx);
    return testCloudConnection(ENV.comfyuiCloudBaseUrl, ENV.comfyuiCloudApiKey);
  }),

  executeWorkflow: protectedProcedure
    .input(z.object({
      nodeId: z.string(),
      projectId: z.number(),
      customBaseUrl: z.string().max(2048).optional(),
      useCloudComfy: z.boolean().optional(),
      workflowJson: z.string().max(500_000),
      paramValues: z.record(z.string(), z.unknown()),
      imageParamKeys: z.array(z.string().max(512)).max(64).optional(),
      audioParamKeys: z.array(z.string().max(512)).max(64).optional(),
      outputNodeIds: z.array(z.string()).optional(),
      outputType: z.enum(["image", "video", "auto"]).default("auto"),
      // Opt-in: after a successful run, unload models + free VRAM on the server —
      // but only when its queue is idle (no other task using that GPU). Local only.
      freeVramAfterRun: z.boolean().optional(),
      // #163 前端生成的一次性任务 id：服务端在运行终局把结果按此 id 存入 comfyJobStore
      // 并经 socket 回灌（comfyui:result）。隧道把这条超长 HTTP 切断时，前端凭 jobId 走
      // socket 回灌 / workflowResult 轮询兜底仍能拿到结果。
      jobId: z.string().max(64).optional(),
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
        baseUrl = await resolveComfyBase(input.customBaseUrl);
        if (!baseUrl) throw new TRPCError({ code: "BAD_REQUEST", message: COMFY_NOT_CONFIGURED });
      }
      return dedupe("comfyui.executeWorkflow", ctx.user.id, input, () => withComfyUsageLog(
        ctx,
        { action: input.useCloudComfy ? "executeWorkflow:cloud" : "executeWorkflow", baseUrl, projectId: input.projectId, nodeId: input.nodeId,
          detail: { outputType: input.outputType } },
        async () => {
        try {
          // Cloud uses the cloud.comfy.org REST API (/api/prompt + /api/job/.../status
          // + /api/view); local uses the standard self-hosted ComfyUI API — untouched.
          const run = input.useCloudComfy ? executeCloudWorkflow : executeCustomWorkflow;
          const result = await run(baseUrl, {
            workflowJson: input.workflowJson,
            paramValues: input.paramValues,
            imageParamKeys: input.imageParamKeys,
            audioParamKeys: input.audioParamKeys,
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
            await recordGeneratedAsset({ userId: ctx.user.id, projectId: input.projectId, nodeId: input.nodeId, type: result.outputType === "video" ? "video" : "image", source: "generated", provider: "comfyui", model: null, url: u, name: "自定义工作流", mimeType: result.outputType === "video" ? "video/mp4" : "image/png" });
          }
          // #163 终局回灌：存 jobId + 广播 socket 结果。服务端跑到这里说明任务已完成——即便
          // 客户端的超长 HTTP 已被隧道切断，socket 回灌 / workflowResult 轮询仍能把结果送达前端。
          if (input.jobId) setComfyJobDone(input.jobId, result.urls, result.outputType === "video" ? "video" : "image");
          emitComfyWorkflowResult(input.projectId, { nodeId: input.nodeId, jobId: input.jobId ?? "", ok: true, urls: result.urls, outputType: result.outputType === "video" ? "video" : "image" });
          // Optional post-run VRAM cleanup (local only, queue must be idle). Awaited
          // so the runner only advances to the next layer AFTER the cache is freed;
          // best-effort — never let a cleanup hiccup fail the (already-successful) run.
          if (input.freeVramAfterRun && !input.useCloudComfy) {
            try {
              const queue = await getComfyQueueDepth(baseUrl);
              if (shouldFreeVram({ enabled: true, isCloud: false, queue })) await freeComfyMemory(baseUrl);
            } catch { /* cleanup is best-effort */ }
          }
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // #163 失败也回灌：让隧道切断 HTTP 后前端能凭 jobId 收到「失败」而非永久卡在运行中。
          if (input.jobId) setComfyJobError(input.jobId, msg);
          emitComfyWorkflowResult(input.projectId, { nodeId: input.nodeId, jobId: input.jobId ?? "", ok: false, error: msg });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }
        },
        (r) => ({ resultUrl: r.urls[0], resultCount: r.urls.length }),
      ));
    }),

  // #163 轮询兜底：前端在超长 HTTP 被隧道切断后，用运行时生成的 jobId 轮询本查询取终局结果。
  // pending = 仍在运行（或结果已过期/未知）；done/error = 终局。结果 URL 均为已落库的自有资产，
  // jobId 为不可猜的一次性随机串，故仅需登录态即可查询。
  workflowResult: protectedProcedure
    .input(z.object({ jobId: z.string().max(64) }))
    .query(({ input }) => getComfyJob(input.jobId) ?? { status: "pending" as const }),
});

// ── AI Prompt Enhancement ─────────────────────────────────────────────────────
export const aiEnhanceRouter = router({
  // LibTV「标记」：视觉 LLM 分析一张生成图中可单独引用的元素（人物/物件/背景等），
  // 前端点选元素后把「图片N 的<元素>」插入提示词。纯分析、不生成。
  analyzeImageElements: protectedProcedure
    .input(z.object({
      imageUrl: z.string().min(1).max(2048),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx, input.model);
      return dedupe("aiEnhance.analyzeImageElements", ctx.user.id, input, async () => {
        let absoluteUrl: string;
        try { absoluteUrl = await resolveToAbsoluteUrl(input.imageUrl); }
        catch (err) { throw new TRPCError({ code: "BAD_REQUEST", message: `图像 URL 无法解析为绝对路径（${err instanceof Error ? err.message : "未知错误"}）` }); }
        const systemPrompt = `你是图像元素标注助手。分析给定图片，列出其中可被单独指代/引用的主要元素（人物、动物、显著物件、显著背景元素等）。\n`
          + `仅输出合法 JSON，无 markdown 代码块，无解释文字：\n`
          + `{"elements":[{"name":"人物","desc":"黑袍剑客，背对镜头"},{"name":"长枪","desc":"背在身后的红缨长枪"}]}\n`
          + `约束：\n- elements 3-8 条，按显著程度排序，主体人物/动物在前\n- name 2-6 个字的中文短名（用于点选与提示词引用）\n- desc 不超 20 字的中文描述`;
        const response = await invokeLLMWithKie(ctx, {
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: [
              { type: "text" as const, text: "请分析这张图片的可引用元素：" },
              { type: "image_url" as const, image_url: { url: absoluteUrl, detail: "high" as const } },
            ] },
          ],
          model: input.model ?? "gpt-5.2", // 视觉任务：默认用支持读图的模型
          maxTokens: 800,
        });
        const text = extractTextContent(response);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });
        let parsed: { elements?: unknown };
        try { parsed = JSON.parse(jsonMatch[0]); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" }); }
        const raw = Array.isArray(parsed.elements) ? parsed.elements : [];
        const elements = raw
          .map((e) => ({ name: String((e as { name?: unknown }).name ?? "").trim().slice(0, 12), desc: String((e as { desc?: unknown }).desc ?? "").trim().slice(0, 40) }))
          .filter((e) => e.name)
          .slice(0, 8);
        if (elements.length === 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "未识别出可引用元素" });
        return { elements };
      });
    }),

  // A1 质检回环：对生成结果图做 AI 质检——与提示词的符合度、畸形/黑屏/乱码水印等硬伤。
  // 返回结构化判定（pass/score/issues/suggestion，解析在 shared/imageQc 有单测）。
  // 全套范式照 analyzeImageElements：门控 assertLLMAllowed → dedupe 防重 →
  // resolveToAbsoluteUrl → invokeLLMWithKie 多模态（计费/日志/门控由统一入口自动继承）。
  qcImage: protectedProcedure
    .input(z.object({
      imageUrl: z.string().min(1).max(2048),
      prompt: z.string().max(4000).optional(), // 生成该图的提示词（用于符合度判定；可缺省）
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx, input.model);
      // 核心逻辑抽到 imageQcCore.runImageQc（B1 工程智能体产物验收共用同一质检）。
      return dedupe("aiEnhance.qcImage", ctx.user.id, input, () => runImageQc(ctx, input));
    }),

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
      const response = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: systemPrompts[input.mode] },
          { role: "user" as const, content: input.text },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
      });
      return { result: extractTextContent(response).trim() };
    }),

  // Translate / localize text into an arbitrary target language OR a Chinese
  // dialect (粤语/四川话/东北话…). Used by the audio dubbing node so the user can
  // translate the spoken text before synthesis. Dialect targets rewrite into the
  // dialect's colloquial written form (suitable to be read aloud), not Mandarin.
  translate: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(8000),
        target: z.string().min(1).max(40),   // 目标语言/方言，自由文本（如 "英语"/"粤语"/"四川话"）
        model: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const system = `You are a professional translator and Chinese-dialect (topolect) localizer.
Rewrite the user's text into the target form: "${input.target}".
- If the target is a language, translate faithfully and naturally for spoken delivery.
- If the target is a Chinese dialect/topolect (粤语/四川话/东北话/闽南语/上海话/陕西话/河南话/天津话/客家话/台湾腔 等), rewrite into that dialect's natural COLLOQUIAL written form — its characteristic vocabulary, particles and phrasing — suitable to be read aloud, NOT standard Mandarin.
Preserve the original meaning, tone, proper nouns and numbers. Output ONLY the resulting text — no quotes, no labels, no notes.`;
      const response = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: system },
          { role: "user" as const, content: input.text },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
        maxTokens: 2400,
      });
      return { result: extractTextContent(response).trim() };
    }),

  // Vision: reverse-engineer a generation prompt from an input image. Used by the
  // 提示词 node's「分析提取」action — the prompt node consumes images only to
  // extract text, it never outputs an image.
  analyzeImage: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().min(1).max(2048),
        instruction: z.string().max(2000).optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let absoluteUrl = input.imageUrl;
      try { absoluteUrl = await resolveToAbsoluteUrl(input.imageUrl); }
      catch (err) { console.warn("[analyzeImage] resolveToAbsoluteUrl failed:", err instanceof Error ? err.message : err); }
      const system = `You are an expert at reverse-engineering image-generation prompts.
Study the image and produce a single detailed prompt that could regenerate it.
Cover: subject, composition, style/medium, lighting, color palette, mood, and notable details.
Output ONLY the prompt as vivid, comma-separated English descriptive phrases — no preamble, no labels.`;
      const response = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system" as const, content: system },
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: input.instruction?.trim() || "Describe this image as a generation prompt." },
              { type: "image_url" as const, image_url: { url: absoluteUrl, detail: "high" as const } },
            ],
          },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"),
        maxTokens: 600,
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
  mediaReachability: protectedProcedure.query(async () => {
    const settings = await getCachedStorageSettings();
    // #234 通用暂存通道：生效通道（显式选择/旧开关兼容 + API Key 守卫）与
    // storage.resolveToAbsoluteUrl 同一决策源——即便本地存储不对公网开放，参考图也会
    // 被暂存到该通道的公网链接给上游读取，此时视为「可达」，并据此在前端亮绿灯。
    const { getActiveStagingProvider } = await import("../_core/storageConfig");
    const stagingProvider = await getActiveStagingProvider();
    return {
      upstreamCanFetchMedia: canBrowserReachStorageDirectly(),
      // 兼容旧客户端字段：poyo 通道生效时为 true（老前端绿灯语义不变）。
      poyoStagingActive: stagingProvider === "poyo",
      // 新字段：当前生效的暂存通道（off/poyo/kie），前端顶栏 chip / 后台状态行用。
      stagingProvider,
      backend: storageBackend(),
      // Admin toggle (readable by all users): auto-prefer the upstream AI temporary
      // public URL as the reference source when it probes alive. Off by default.
      preferUpstreamRefSource: settings.preferUpstreamRefSource,
    };
  }),

  // 管理员在后台禁用的模型 id 集合 —— 所有登录用户可读，前端据此从节点模型下拉里隐藏。
  // 仅作显示门控；空数组（默认）= 全部模型可见，行为与未配置时一致。
  modelToggles: protectedProcedure.query(async () => {
    return { disabledModels: await getCachedDisabledModels() };
  }),

  // 管理员配置的「系统默认模型」（按槽位）—— 所有登录用户可读，前端解析新节点/聊天默认模型时
  // 排在项目级配置之下、出厂默认之上。空 = 各槽位用出厂默认。
  systemDefaultModels: protectedProcedure.query(async () => {
    return { systemDefaultModels: await getCachedSystemDefaultModels() };
  }),

  // 本机 Claude 桥接可用的技能清单（供聊天框「/ 唤起技能」）。enabled=是否放行了 Skill。
  // 只回 name/description，不回技能正文。
  bridgeSkills: protectedProcedure.query(async () => {
    const { enabled, skills } = listBridgeSkills();
    return { enabled, skills };
  }),

  // 管理员配置的自建 LLM 模型清单（仅 id/label，绝不含 apiKey）——所有登录用户可读，
  // 前端据此把自建模型动态并入各模型选择器。url 仅返回是否已配置（布尔），不回传具体地址。
  selfHostedLlmModels: protectedProcedure.query(async () => {
    const models = allSelfHostedModels(); // 拉平所有自建服务器的模型（含 env 兜底，DB 优先）
    return { configured: models.length > 0, models };
  }),
  // 各转写 provider 是否已配置 + 自建端点的 model —— 供转写模型选择器只列「真能用」的模型
  // （方案B：Groq/自建/Forge 各自独立端点，选哪个就路由到哪个）。避免「选了走不通」的歧义。
  transcribeProviders: protectedProcedure.query(async () => {
    const dbCfg = await getTranscribeEndpointConfigRaw();
    const selfUrl = (dbCfg?.url || ENV.transcribeApiUrl).trim();
    const selfModel = (dbCfg?.model || ENV.transcribeModel).trim();
    return {
      self: { configured: !!selfUrl, model: selfModel },     // 自建/自定义端点
      groq: !!ENV.groqApiKey.trim(),                          // GROQ_API_KEY
      forge: !!((ENV.forgeApiUrl.trim() && ENV.forgeApiKey.trim()) || ENV.openaiApiKey.trim()), // 内置 Forge/OpenAI
    };
  }),
  // 本地 VoxCPM（Gradio TTS）全站默认地址是否已配置 + 来源 —— 供音频节点把「Gradio 服务地址」
  // 改为可选（未填则用全站默认），并在占位符提示已有默认。不回传具体地址（内网地址，仅回布尔+来源）。
  voxcpmDefault: protectedProcedure.query(async () => {
    const source = voxcpmDefaultSource(); // db / env / none
    return { configured: source !== "none", source };
  }),
});
