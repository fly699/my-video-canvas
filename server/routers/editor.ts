import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { writeAuditLog } from "../_core/auditLog";
import { EDITOR_DOC_VERSION, emptyEditorDoc, sliceEditorDoc, editorDocDuration, type EditorDoc } from "@shared/editorTypes";
import { composeTimeline } from "../_core/videoComposer";
import { createRenderJob, getRenderJob, updateRenderJob, countRunningRenderJobs } from "../_core/editorRenderJobs";
import { assertProjectAccess } from "../_core/permissions";
import { invokeLLMWithKie } from "../_core/llmWithKie";
import { extractTextContent } from "../_core/llm";

// ── EDL validation ────────────────────────────────────────────────────────────
// Kept tolerant: unknown effect/transition keys are allowed through so the
// front-end can evolve the doc without a server lockstep, but the structural
// shape (tracks → clips with timing) is enforced.
const transformSchema = z.object({
  x: z.number().optional(), y: z.number().optional(), scale: z.number().optional(),
  opacity: z.number().optional(), rotation: z.number().optional(),
});

const clipSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["video", "image", "audio", "text", "shape"]),
  assetId: z.number().optional(),
  assetUrl: z.string().max(2048).optional(),
  start: z.number().min(0),
  trimIn: z.number().min(0),
  trimOut: z.number().min(0),
  speed: z.number().min(0.1).max(8).optional(),
  reverse: z.boolean().optional(),
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
  volume: z.number().min(0).max(4).optional(),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
  fadeCurve: z.enum(["tri", "qsin", "hsin", "log", "exp"]).optional(),
  ducking: z.boolean().optional(),
  denoise: z.boolean().optional(),
  // 关键帧动画（含缓动曲线）——此前漏在 schema 外被剥离、不持久化，现补上。
  keyframes: z.array(z.object({
    t: z.number(), x: z.number().optional(), y: z.number().optional(), scale: z.number().optional(),
    opacity: z.number().optional(), rotation: z.number().optional(),
    ease: z.enum(["linear", "in", "out", "inout"]).optional(),
  })).max(120).optional(),
  // 矢量形状/SVG 叠加（导出 resvg 光栅化）
  shape: z.object({
    type: z.enum(["rect", "roundRect", "circle", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star", "heart", "arrow", "line"]),
    color: z.string().max(32).optional(), color2: z.string().max(32).optional(), fill: z.boolean().optional(),
    fillType: z.enum(["solid", "linear", "radial", "pattern"]).optional(),
    pattern: z.enum(["dots", "stripes", "grid", "checker"]).optional(),
    lineWidth: z.number().min(0).max(200).optional(), opacity: z.number().min(0).max(1).optional(),
    radius: z.number().min(0).max(1).optional(),
    svg: z.string().max(20000).optional(),
    w: z.number().min(0).max(2).optional(), h: z.number().min(0).max(2).optional(),
  }).optional(),
  chromaKey: z.object({ color: z.string().max(16).optional(), similarity: z.number().min(0).max(1).optional(), blend: z.number().min(0).max(1).optional() }).optional(),
  // 形状蒙版（叠加层/画中画）
  mask: z.object({
    type: z.enum(["rect", "ellipse"]),
    x: z.number().min(-1).max(2), y: z.number().min(-1).max(2),
    w: z.number().min(0).max(2), h: z.number().min(0).max(2),
    feather: z.number().min(0).max(1).optional(), invert: z.boolean().optional(),
  }).optional(),
  transitionIn: z.object({ type: z.string().max(32), duration: z.number().min(0).max(10) }).optional(),
  effects: z.object({
    brightness: z.number().optional(), contrast: z.number().optional(),
    saturation: z.number().optional(), filter: z.string().max(64).optional(),
    vignette: z.number().min(0).max(1).optional(), sharpen: z.number().min(0).max(1).optional(),
  }).optional(),
  transform: transformSchema.optional(),
  fit: z.enum(["contain", "cover", "stretch", "blur", "none"]).optional(),
  text: z.object({
    content: z.string().max(2000),
    font: z.string().max(64).optional(), size: z.number().optional(),
    color: z.string().max(32).optional(), bgColor: z.string().max(32).optional(),
    motionStyle: z.string().max(32).optional(),
    bold: z.boolean().optional(), italic: z.boolean().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    strokeColor: z.string().max(32).optional(), strokeWidth: z.number().min(0).max(40).optional(),
    shadow: z.boolean().optional(), shadowColor: z.string().max(32).optional(),
    typewriterCps: z.number().min(1).max(60).optional(),
    vertical: z.boolean().optional(),
  }).optional(),
});

const docSchema = z.object({
  version: z.literal(EDITOR_DOC_VERSION),
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  fps: z.number().int().min(1).max(120),
  normalizeAudio: z.boolean().optional(),
  masterFadeIn: z.number().min(0).max(10).optional(),
  masterFadeOut: z.number().min(0).max(10).optional(),
  tracks: z.array(z.object({
    id: z.string().min(1).max(64),
    type: z.enum(["video", "audio", "text", "overlay", "attachment"]),
    muted: z.boolean().optional(),
    volume: z.number().min(0).max(4).optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    name: z.string().max(64).optional(),
    clips: z.array(clipSchema).max(500),
  })).max(40),
});

/** 取一帧代表性缩略图地址：优先图片片段，其次视频片段（列表里视频按首帧海报显示）。 */
function deriveThumbnailUrl(doc: { tracks: { type: string; clips: { kind: string; assetUrl?: string; start: number }[] }[] }): string | null {
  const visual: { url: string; isImg: boolean; start: number }[] = [];
  for (const t of doc.tracks) {
    if (t.type !== "video" && t.type !== "overlay") continue;
    for (const c of t.clips) {
      if ((c.kind === "image" || c.kind === "video") && c.assetUrl) visual.push({ url: c.assetUrl, isImg: c.kind === "image", start: c.start });
    }
  }
  if (visual.length === 0) return null;
  visual.sort((a, b) => (Number(b.isImg) - Number(a.isImg)) || (a.start - b.start)); // 图片优先，再按时间靠前
  return visual[0].url;
}

export const editorRouter = router({
  // List the current user's editor sessions (most-recent first; soft-deleted hidden).
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.listEditSessions(ctx.user.id);
    return rows.map((s) => ({
      id: s.id, name: s.name, projectId: s.projectId,
      // 已存的优先；旧项目未存缩略图时按其文档现取一帧（图片优先/视频首帧）。
      thumbnailUrl: s.thumbnailUrl ?? (s.doc ? deriveThumbnailUrl(s.doc as { tracks: { type: string; clips: { kind: string; assetUrl?: string; start: number }[] }[] }) : null),
      updatedAt: s.updatedAt, createdAt: s.createdAt,
    }));
  }),

  // Load one session (owner-scoped). Returns the full EDL doc to edit.
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const s = await db.getEditSession(input.id, ctx.user.id);
      if (!s) throw new TRPCError({ code: "NOT_FOUND" });
      return { id: s.id, name: s.name, projectId: s.projectId, thumbnailUrl: s.thumbnailUrl, doc: s.doc as EditorDoc, updatedAt: s.updatedAt };
    }),

  // Create a new (empty) session, optionally linked to a canvas project.
  create: protectedProcedure
    .input(z.object({
      name: z.string().max(255).optional(),
      projectId: z.number().optional(),
      width: z.number().int().min(16).max(7680).optional(),
      height: z.number().int().min(16).max(7680).optional(),
      fps: z.number().int().min(1).max(120).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      // Linking a session to a project records its exports into that project's
      // shared asset library — so the caller must have editor access to it,
      // otherwise any user could inject assets into arbitrary projects (IDOR).
      if (input?.projectId != null) {
        await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      }
      const doc = emptyEditorDoc(input?.width, input?.height, input?.fps);
      const s = await db.createEditSession({
        userId: ctx.user.id,
        projectId: input?.projectId ?? null,
        name: input?.name ?? "未命名剪辑",
        doc,
      });
      if (!s) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建剪辑失败" });
      writeAuditLog({ ctx, action: "editor:create", detail: { sessionId: s.id, projectId: input?.projectId } });
      return { id: s.id };
    }),

  // Save the doc/name (autosave). Owner-scoped.
  save: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().max(255).optional(),
      doc: docSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getEditSession(input.id, ctx.user.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await db.updateEditSession(input.id, ctx.user.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.doc !== undefined ? { doc: input.doc, thumbnailUrl: deriveThumbnailUrl(input.doc) } : {}),
      });
      return { success: true };
    }),

  // AI 生成 SVG：自然语言描述 → LLM 产出一段 <svg>，用于「添加形状/SVG」叠加。
  generateShapeSvg: protectedProcedure
    .input(z.object({ prompt: z.string().min(1).max(1000), model: z.string().max(64).optional(), kieTempKey: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const sys = "你是一个 SVG 生成器，用于视频画面叠加。要求：只输出一个完整的 <svg>…</svg> 代码，"
        + "使用 viewBox=\"0 0 100 100\"，背景透明（不要画整块背景矩形），图形简洁清晰、适合作为贴纸/装饰。"
        + "禁止输出任何解释文字、Markdown 代码围栏或 <script>/<foreignObject>/外链引用。";
      const res = await invokeLLMWithKie(ctx, { messages: [{ role: "system", content: sys }, { role: "user", content: input.prompt }], model: input.model, maxTokens: 1500 }, input.kieTempKey ?? null);
      const text = extractTextContent(res);
      const m = /<svg[\s\S]*?<\/svg>/i.exec(text);
      let svg = (m ? m[0] : text).trim();
      // 安全清理：移除脚本/事件/外链等危险内容（叠加只需纯矢量图形）。
      svg = svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "").replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, "");
      if (!/<svg[\s\S]*<\/svg>/i.test(svg)) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 SVG，请换个描述再试" });
      return { svg: svg.slice(0, 20000) };
    }),

  // Soft-delete (hidden from the user; row kept).
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteEditSession(input.id, ctx.user.id);
      writeAuditLog({ ctx, action: "editor:delete", detail: { sessionId: input.id } });
      return { success: true };
    }),

  // Kick off a single-pass render of the session's timeline. Runs in the
  // background (ffmpeg child); poll exportStatus for progress. The finished MP4
  // lands in the user's MinIO prefix and is indexed in the media library, so the
  // existing strict-download gate governs who may download it.
  export: protectedProcedure
    .input(z.object({
      id: z.number(),
      format: z.enum(["mp4", "hevc", "webm", "mov"]).optional(),
      quality: z.enum(["high", "medium", "low"]).optional(),
      qualityPct: z.number().int().min(1).max(100).optional(),
      encoder: z.enum(["software", "hardware"]).optional(),
      width: z.number().int().min(16).max(7680).optional(),
      height: z.number().int().min(16).max(7680).optional(),
      fps: z.number().int().min(1).max(120).optional(),
      // optional export range (seconds) — render only [rangeStart, rangeEnd].
      rangeStart: z.number().min(0).optional(),
      rangeEnd: z.number().min(0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await db.getEditSession(input.id, ctx.user.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      // Each export spawns a full-reencode ffmpeg child; cap concurrent renders
      // per user so connect-spamming export can't exhaust CPU/memory/disk.
      if (countRunningRenderJobs(ctx.user.id) >= 3) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "已有多个导出任务进行中，请稍后再试" });
      }
      let doc = session.doc as EditorDoc;
      // Export range: slice the timeline to [rangeStart, rangeEnd] before rendering.
      if (input.rangeStart != null || input.rangeEnd != null) {
        const start = input.rangeStart ?? 0;
        const end = input.rangeEnd ?? editorDocDuration(doc);
        if (end - start > 0.05) doc = sliceEditorDoc(doc, start, end);
      }
      const job = createRenderJob(ctx.user.id, input.id);
      const mimeType = input.format === "webm" ? "video/webm" : input.format === "mov" ? "video/quicktime" : "video/mp4";

      // Fire-and-forget; progress/result are reported through the job registry.
      void (async () => {
        try {
          const res = await composeTimeline(doc, {
            userId: ctx.user.id,
            projectName: session.name,
            onProgress: (pct, stage) => updateRenderJob(job.id, { progress: pct, stage }),
            format: input.format,
            quality: input.quality,
            qualityPct: input.qualityPct,
            encoder: input.encoder,
            width: input.width,
            height: input.height,
            fps: input.fps,
          });
          await db.recordGeneratedAsset({
            userId: ctx.user.id, projectId: session.projectId ?? null, type: "video",
            source: "generated", provider: "editor", model: "timeline",
            url: res.url, storageKey: res.storageKey, name: session.name, mimeType,
          }).catch(() => undefined);
          updateRenderJob(job.id, { status: "done", progress: 100, stage: "完成", url: res.url, storageKey: res.storageKey, duration: res.duration });
          writeAuditLog({ ctx, action: "editor:export", detail: { sessionId: input.id, storageKey: res.storageKey } });
        } catch (e) {
          updateRenderJob(job.id, { status: "error", stage: "失败", error: e instanceof Error ? e.message : String(e) });
        }
      })();

      return { jobId: job.id };
    }),

  // Poll a render job's progress/result (owner-scoped).
  exportStatus: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(({ ctx, input }) => {
      const job = getRenderJob(input.jobId, ctx.user.id);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      return { status: job.status, progress: job.progress, stage: job.stage, url: job.url ?? null, error: job.error ?? null, duration: job.duration ?? null };
    }),
});
