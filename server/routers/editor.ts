import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { writeAuditLog } from "../_core/auditLog";
import { EDITOR_DOC_VERSION, emptyEditorDoc, sliceEditorDoc, editorDocDuration, type EditorDoc } from "@shared/editorTypes";
import { composeTimeline } from "../_core/videoComposer";
import { execFileAsync, downloadToTemp, detectSilences } from "../_core/videoEditor";
import { looksLikeAVContainer, readHead } from "../_core/voiceTranscription";
import { promises as fsp } from "node:fs";
import { createRenderJob, getRenderJob, updateRenderJob, countRunningRenderJobs, getActiveRenderJobForSession } from "../_core/editorRenderJobs";
import { assertProjectAccess } from "../_core/permissions";
import { assertWhitelisted } from "../_core/whitelist";
import { invokeLLMWithKie } from "../_core/llmWithKie";
import { extractTextContent } from "../_core/llm";
import { transcribeAudio } from "../_core/voiceTranscription";
import { getSystemDefaultModel } from "../_core/systemDefaultModels";
import { buildAiCutDoc, parseAiCutPlan, aiCutStats, invertSilencesToKeep } from "../_core/aiCut";
import { buildAutoComposeDoc, parseAutoComposePlan } from "../_core/autoCompose";

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
    font: z.string().max(64).optional(), size: z.number().min(1).max(2000).optional(),
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

export const docSchema = z.object({ // exported for schema-guard tests (markers 剥离守卫)
  version: z.literal(EDITOR_DOC_VERSION),
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  fps: z.number().int().min(1).max(120),
  normalizeAudio: z.boolean().optional(),
  masterFadeIn: z.number().min(0).max(10).optional(),
  masterFadeOut: z.number().min(0).max(10).optional(),
  // 批3 时间轴标记点（K 键打点）——必须在此声明，否则 zod 静默剥离、保存即丢
  // （keyframes 曾踩过同坑，见 clipSchema 上方注释）。
  markers: z.array(z.object({
    t: z.number().min(0),
    label: z.string().max(80).optional(),
    color: z.string().max(24).optional(),
  })).max(300).optional(),
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

  // 探测素材原始信息（像素/编码/帧率/时长/码率/比例）。
  // SSRF 加固：**绝不**把用户 URL 直接喂 ffprobe —— ffprobe 会连内网/云元数据、还跟随
  // DASH/HLS 子清单（真机 strace 实测直连 169.254.169.254）。改为与抽音轨同款：先 downloadToTemp
  // （SSRF 守卫 + 302 复检）落成本地文件 → magic 门排除清单/非 A/V → ffprobe 本地文件并加
  // -protocol_whitelist file,crypto,data（彻底无出网）。任何失败都回落 empty（与原行为一致）。
  probeMedia: protectedProcedure
    .input(z.object({ url: z.string().max(2048) }))
    .query(async ({ input }) => {
      const empty = { width: null, height: null, codec: null, pixFmt: null, fps: null, duration: null, bitrate: null, container: null } as const;
      let srcTemp: string | null = null;
      try {
        srcTemp = await downloadToTemp(input.url, "probe");
        const header = await readHead(srcTemp, 512);
        if (!looksLikeAVContainer(header)) return empty; // 清单/未知：不喂 ffprobe，防子清单外连
        const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-protocol_whitelist", "file,crypto,data", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,r_frame_rate,pix_fmt", "-show_entries", "format=duration,bit_rate,format_name", "-of", "json", srcTemp], { timeoutMs: 20000 });
        const j = JSON.parse(stdout) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
        const s = j.streams?.[0] ?? {}; const f = j.format ?? {};
        const [n, d] = String(s.r_frame_rate ?? "0/1").split("/").map(Number);
        return {
          width: typeof s.width === "number" ? s.width : null,
          height: typeof s.height === "number" ? s.height : null,
          codec: typeof s.codec_name === "string" ? s.codec_name : null,
          pixFmt: typeof s.pix_fmt === "string" ? s.pix_fmt : null,
          fps: d ? Math.round((n / d) * 100) / 100 : null,
          duration: f.duration ? Math.round(Number(f.duration) * 100) / 100 : null,
          bitrate: f.bit_rate ? Number(f.bit_rate) : null,
          container: typeof f.format_name === "string" ? f.format_name : null,
        };
      } catch { return empty; }
      finally { if (srcTemp) fsp.unlink(srcTemp).catch(() => { /* best-effort */ }); }
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

  // AI 智能剪辑（移植 browser-use/video-use，MIT）：转写视频 → LLM 判定保留区间 + 调色档 →
  // 生成一份新 EditorDoc（按区间切片 + 30ms 淡入淡出 + 可选逐词字幕）。返回 doc 供前端载入。
  // 用「本机 claude」出方案：把 model 传成 "claude-local" 即自动走桥接（不按 token 计费）。
  aiCut: protectedProcedure
    .input(z.object({
      assetUrl: z.string().min(1).max(2048),
      assetId: z.number().optional(),
      durationSec: z.number().min(0.1).max(36000),
      width: z.number().int().min(16).max(7680),
      height: z.number().int().min(16).max(7680),
      fps: z.number().int().min(1).max(120),
      aggressiveness: z.enum(["low", "medium", "high"]).optional(),
      targetSec: z.number().min(1).max(36000).optional(),
      grade: z.enum(["subtle", "neutral_punch", "warm_cinematic", "none"]).optional(),
      subtitles: z.boolean().optional(),
      model: z.string().max(64).optional(),
      kieTempKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 白名单门控：与画布字幕/智能剪辑节点一致（aiCut 又转写又调 LLM，成本更高，必须门控）。
      await assertWhitelisted(ctx);
      // 转写受「系统默认模型 › 字幕转录」(transcribe 槽) 控制，按 provider 路由。
      const tr = await transcribeAudio({ audioUrl: input.assetUrl, wordTimestamps: !!input.subtitles, model: await getSystemDefaultModel("transcribe") });
      if ("error" in tr) {
        console.warn("[aiCut] 转写失败", tr.code, tr.error, tr.details);
        throw new TRPCError({ code: "BAD_REQUEST", message: `转写失败：${tr.error}${tr.details ? `（${String(tr.details).slice(0, 240)}）` : ""}` });
      }
      const segments = tr.segments ?? [];
      if (!segments.length) throw new TRPCError({ code: "BAD_REQUEST", message: "未识别到语音内容，无法智能剪辑" });
      const words = (tr.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end }));

      const aggr = input.aggressiveness ?? "medium";
      // 每个保留区间左右外扩的安全边距：轻=多留、狠=少留。防止把语音首尾（气口/辅音尾音）切掉。
      const padByAggr: Record<string, number> = { low: 0.22, medium: 0.12, high: 0.06 };
      const padSec = padByAggr[aggr] ?? 0.12;
      const lines = segments.map((s) => `[${s.start.toFixed(2)}-${s.end.toFixed(2)}]${s.no_speech_prob > 0.6 ? "(疑似静音)" : ""} ${s.text.trim()}`).join("\n");
      const sys = "你是专业视频剪辑师。下面是一段视频的逐段转写（含时间戳，单位秒）。判断哪些区间应【保留】，"
        + `删除口头禅/重复/长停顿/跑题/疑似静音，产出紧凑连贯的成片。剪辑激进度=${aggr}（low=保守，仅删明显冗余/长静音；medium=适中；high=多删）。`
        + "\n【务必】保留区间的起止要包含完整的句子/词首尾，宁可在每段语音前后各多留 0.2 秒，也绝不要切进正在说话的语音中间、或吃掉句子开头的第一个字/结尾的尾音。short 停顿（<0.6s）属正常语流，不要删。"
        + (aggr === "low" ? "\n当前为 low：只在明显有必要时才删，拿不准就保留。" : "")
        + (input.targetSec ? `\n目标成片时长约 ${input.targetSec} 秒。` : "")
        + '\n只输出一个 JSON：{"keep":[{"start":秒,"end":秒}],"grade":"none|subtle|neutral_punch|warm_cinematic"}。'
        + "keep 按时间升序、区间不重叠、落在视频时长内；grade 为可选整体调色档（不确定用 none）。禁止输出任何解释或 Markdown 代码围栏。";
      const res = await invokeLLMWithKie(ctx, {
        messages: [{ role: "system", content: sys }, { role: "user", content: lines.slice(0, 24000) }],
        model: input.model ?? await getSystemDefaultModel("llm"), maxTokens: 2000,
      }, input.kieTempKey ?? null);

      const plan = parseAiCutPlan(extractTextContent(res));
      if (!plan || !plan.keep.length) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未产出有效剪辑方案，请重试或调整激进度" });
      const doc = buildAiCutDoc(
        { assetId: input.assetId, assetUrl: input.assetUrl, width: input.width, height: input.height, fps: input.fps, durationSec: input.durationSec },
        plan, words, { grade: input.grade, subtitles: input.subtitles, padSec },
      );
      if (!doc.tracks.find((t) => t.type === "video")!.clips.length) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "剪辑结果为空（保留区间无效），请重试" });
      writeAuditLog({ ctx, action: "editor:aiCut", detail: { clips: doc.tracks[0].clips.length, subtitles: !!input.subtitles } });
      return { doc, stats: aiCutStats(doc, input.durationSec) };
    }),

  // 静音自动剪除：本地 ffmpeg silencedetect 找静音段 → 反转成保留区间 → 复用 aiCut 的
  // 确定性组装（30ms 淡入淡出 + 音量归一）产出新 EditorDoc，客户端 applyDoc 整档替换
  // （可一键撤销）。零 LLM/转写成本 → 不做白名单门控（对齐 canvas.detectScenes 策略）；
  // SSRF 由 downloadToTemp 内部守卫（自有存储直通、外链拦内网）。
  silenceCut: protectedProcedure
    .input(z.object({
      assetUrl: z.string().min(1).max(2048),
      assetId: z.number().optional(),
      durationSec: z.number().positive().max(4 * 3600),
      width: z.number().int().min(16).max(8192),
      height: z.number().int().min(16).max(8192),
      fps: z.number().min(1).max(240),
      /** 判静阈值 dB（越低越严格），默认 -32。 */
      noiseDb: z.number().min(-60).max(-10).optional(),
      /** 最短静音时长（秒），默认 0.6——短于此的正常语流停顿不剪。 */
      minSilenceSec: z.number().min(0.2).max(5).optional(),
      /** 保留段前后外扩（秒），默认 0.12——防切掉语音首尾。 */
      padSec: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const silences = await detectSilences(input.assetUrl, {
        noiseDb: input.noiseDb ?? -32,
        minSilenceSec: input.minSilenceSec ?? 0.6,
        durationSec: input.durationSec,
      });
      if (!silences.length) return { doc: null, stats: null, message: "未检测到可剪除的静音段（可调高阈值或缩短最短静音时长后重试）" };
      const keep = invertSilencesToKeep(silences, input.durationSec);
      if (!keep.length) return { doc: null, stats: null, message: "整段都被判为静音，未生成剪辑（试试把阈值调低，如 -45dB）" };
      const doc = buildAiCutDoc(
        { assetId: input.assetId, assetUrl: input.assetUrl, width: input.width, height: input.height, fps: input.fps, durationSec: input.durationSec },
        { keep }, [], { padSec: input.padSec ?? 0.12 },
      );
      if (!doc.tracks.find((t) => t.type === "video")!.clips.length) {
        return { doc: null, stats: null, message: "剪辑结果为空，已放弃应用" };
      }
      writeAuditLog({ ctx, action: "editor:silenceCut", detail: { silences: silences.length, clips: doc.tracks[0].clips.length } });
      return { doc, stats: aiCutStats(doc, input.durationSec), message: null };
    }),

  // D1 AI 一键成片：素材清单 + 创作要求 → LLM 出剪辑决策（排序/截取/转场/标题/配乐/调色）
  // → 服务端确定性组装 EditorDoc（所有越界值夹取，LLM 给什么都不至于产出非法时间轴），
  // 客户端 applyDoc 整档替换（可一键撤销，与 aiCut 同模式）。
  autoCompose: protectedProcedure
    .input(z.object({
      assets: z.array(z.object({
        url: z.string().min(1).max(2048),
        kind: z.enum(["video", "image", "audio"]),
        name: z.string().max(200),
        durationSec: z.number().min(0).max(36000).optional(),
        assetId: z.number().optional(),
      })).min(1).max(40),
      brief: z.string().max(2000).optional(),
      targetSec: z.number().min(3).max(1800).optional(),
      width: z.number().int().min(16).max(7680),
      height: z.number().int().min(16).max(7680),
      fps: z.number().int().min(1).max(120),
      model: z.string().max(64).optional(),
      kieTempKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx); // 与 aiCut 同门槛（一次 LLM 规划调用）
      const manifest = input.assets
        .map((a, i) => `#${i} [${a.kind === "video" ? "视频" : a.kind === "image" ? "图片" : "音频"}${a.durationSec ? ` ${a.durationSec.toFixed(1)}s` : ""}] ${a.name}`)
        .join("\n");
      const sys = "你是专业视频剪辑师兼导演。给定素材清单（含索引/类型/时长）与创作要求，产出一键成片方案。"
        + "\n规则：只能引用清单里的素材索引；按叙事逻辑排列镜头（开场吸睛→主体→收尾）；"
        + "视频素材可截取精华段（trimIn/trimOut，单位秒，须落在素材时长内）；图片素材给 durationSec（2-5 秒）；"
        + "从第 2 段起可给 transition（可选值：fade/dissolve/fadeblack/wipeleft/wiperight/slideleft/slideright/circleopen/zoomin/pixelize，克制使用，同类内容用硬切=不写）；"
        + "可选 texts：开头标题（role=title，at=0）与收尾一句（role=caption），content ≤ 20 字；"
        + "清单里有音频素材时可选一条作 bgm（填其索引）；grade 为整体调色档（none/subtle/neutral_punch/warm_cinematic/cinematic/teal_orange/vivid，拿不准用 none）。"
        + (input.targetSec ? `\n目标成片总时长约 ${input.targetSec} 秒（按此分配每段时长）。` : "")
        + '\n只输出一个 JSON：{"clips":[{"asset":0,"trimIn":2,"trimOut":8,"transition":"fade"},{"asset":1,"durationSec":3}],"texts":[{"content":"标题","at":0,"durationSec":3,"role":"title"}],"bgm":2,"grade":"none"}。'
        + "禁止输出任何解释或 Markdown 代码围栏。";
      const res = await invokeLLMWithKie(ctx, {
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `素材清单：\n${manifest}\n\n创作要求：${input.brief?.trim() || "把素材剪成一条节奏流畅、观感完整的成片"}` },
        ],
        model: input.model ?? await getSystemDefaultModel("llm"), maxTokens: 2400,
      }, input.kieTempKey ?? null);
      const plan = parseAutoComposePlan(extractTextContent(res));
      if (!plan || !plan.clips.length) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未产出有效成片方案，请重试或补充创作要求" });
      const { doc, stats } = buildAutoComposeDoc(input.assets, plan, { width: input.width, height: input.height, fps: input.fps });
      if (!stats.clips) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "成片方案为空（未引用任何画面素材），请重试" });
      writeAuditLog({ ctx, action: "editor:autoCompose", detail: { assets: input.assets.length, ...stats } });
      return { doc, stats };
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
      format: z.enum(["mp4", "hevc", "webm", "mov", "mp3"]).optional(),
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
      const mimeType = input.format === "webm" ? "video/webm" : input.format === "mov" ? "video/quicktime" : input.format === "mp3" ? "audio/mpeg" : "video/mp4";

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
            userId: ctx.user.id, projectId: session.projectId ?? null, type: input.format === "mp3" ? "audio" : "video",
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

  // 恢复该会话进行中/刚完成的导出（离开剪辑器再回来时重连进度/成片，#90）。无则 null。
  activeExport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(({ ctx, input }) => {
      const job = getActiveRenderJobForSession(ctx.user.id, input.id);
      if (!job) return null;
      return { jobId: job.id, status: job.status, progress: job.progress, stage: job.stage, url: job.url ?? null, duration: job.duration ?? null };
    }),
});
