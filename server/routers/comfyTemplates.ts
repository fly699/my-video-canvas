import { z } from "zod";
import { FACTORY_DEFAULT_MODELS } from "../../shared/nodeDefaultModels";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { assertLLMAllowed } from "../_core/whitelist";
import { runLibraryAnalysis } from "../_core/templateAnalysis";
import { fetchComfyServerStatus, fetchComfyModels } from "../_core/comfyui";
import { extractTemplateModelRefs, flattenModelList, qualifyingServers, requiredModelsFor, serverFailures, type FailReason } from "../_core/templateServerSync";
import {
  sanitizeComfyPayload, COMFY_TEMPLATE_LIMITS,
  type ComfyNodeType, type ComfyNodeTemplate,
} from "@shared/comfyNodeTemplate";
import type { ComfyNodeTemplateRow } from "../../drizzle/schema";

const nodeTypeSchema = z.enum(["comfyui_image", "comfyui_video", "comfyui_workflow"]);

function toClient(r: ComfyNodeTemplateRow): ComfyNodeTemplate {
  return {
    id: r.id,
    label: r.label,
    nodeType: r.nodeType as ComfyNodeType,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    note: r.note ?? undefined,
    thumbnail: r.thumbnail ?? undefined,
    useCloud: r.useCloud ?? undefined,
    userId: r.userId,
    creatorName: r.creatorName ?? undefined,
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
  };
}

export const comfyTemplatesRouter = router({
  // Shared library — every logged-in user sees all templates.
  list: protectedProcedure.query(async () => {
    const rows = await db.listComfyNodeTemplates();
    return rows.map(toClient);
  }),

  // Any logged-in user may contribute a template.
  create: protectedProcedure
    .input(z.object({
      label: z.string().trim().min(1).max(COMFY_TEMPLATE_LIMITS.MAX_LABEL_LEN),
      nodeType: nodeTypeSchema,
      payload: z.record(z.string(), z.unknown()),
      note: z.string().max(COMFY_TEMPLATE_LIMITS.MAX_NOTE_LEN).optional(),
      thumbnail: z.string().max(2048).optional(),
      useCloud: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Re-sanitize server-side (never trust the client to have stripped output/runtime).
      const payload = sanitizeComfyPayload(input.payload as Record<string, unknown>);
      if (JSON.stringify(payload).length > COMFY_TEMPLATE_LIMITS.MAX_JSON) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "模板内容过大" });
      }
      const row = await db.createComfyNodeTemplate({
        userId: ctx.user.id,
        creatorName: ctx.user.name ?? ctx.user.email ?? null,
        label: input.label.trim(),
        nodeType: input.nodeType,
        payload,
        note: input.note?.trim() || null,
        thumbnail: input.thumbnail || null,
        useCloud: input.nodeType === "comfyui_workflow" ? !!input.useCloud : null,
      });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "保存失败" });
      return toClient(row);
    }),

  // Rename / edit note, or OVERWRITE the saved params (payload/thumbnail/useCloud)
  // from a node — creator or admin only.
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      label: z.string().trim().min(1).max(COMFY_TEMPLATE_LIMITS.MAX_LABEL_LEN).optional(),
      note: z.string().max(COMFY_TEMPLATE_LIMITS.MAX_NOTE_LEN).optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
      thumbnail: z.string().max(2048).optional(),
      useCloud: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getComfyNodeTemplate(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只能修改自己创建的模板" });
      }
      let payload: Record<string, unknown> | undefined;
      if (input.payload !== undefined) {
        payload = sanitizeComfyPayload(input.payload as Record<string, unknown>);
        if (JSON.stringify(payload).length > COMFY_TEMPLATE_LIMITS.MAX_JSON) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "模板内容过大" });
        }
      }
      await db.updateComfyNodeTemplate(input.id, {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.note !== undefined ? { note: input.note.trim() || null } : {}),
        ...(payload !== undefined ? { payload } : {}),
        ...(input.thumbnail !== undefined ? { thumbnail: input.thumbnail || null } : {}),
        ...(input.useCloud !== undefined ? { useCloud: existing.nodeType === "comfyui_workflow" ? !!input.useCloud : null } : {}),
      });
      // Overwriting the params invalidates the stored functional analysis — drop
      // it so the agent re-analyzes this template on next library analysis.
      if (payload !== undefined) await db.deleteComfyTemplateAnalysis(input.id);
      return { success: true };
    }),

  // Delete — creator or admin only.
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getComfyNodeTemplate(input.id);
      if (!existing) return { success: true };
      if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己创建的模板" });
      }
      await db.deleteComfyNodeTemplate(input.id);
      await db.deleteComfyTemplateAnalysis(input.id); // drop its analysis too (no orphan)
      return { success: true };
    }),

  // 扫描所有模板的「服务器存储列表」(payload.serverUrls)：只读不改库，按模板列出
  // 「失效服务器」(离线 / 在线却缺所需模型) 与「可补入的新服务器」，交由前端对话框由
  // 用户确认清理。补入池来自全局服务器（在线且装齐模型）。仅管理员。
  scanServerLists: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可执行" });
    const globalUrls = await db.getComfyGlobalServers();
    const templates = await db.listComfyNodeTemplates();
    // 候选 URL = 全局服务器 ∪ 所有模板已存的 serverUrls（去重），逐个只抓一次。
    const templateUrls = new Set<string>();
    for (const t of templates) {
      const payload = (t.payload ?? {}) as Record<string, unknown>;
      if (Array.isArray(payload.serverUrls)) {
        for (const u of payload.serverUrls) if (typeof u === "string") templateUrls.add(u);
      }
    }
    const candidates = Array.from(new Set([...globalUrls, ...Array.from(templateUrls)]));
    const scanByUrl = new Map<string, { online: boolean; models: Set<string> }>();
    await Promise.all(candidates.map(async (url) => {
      try {
        const status = await fetchComfyServerStatus(url);
        if (!status.online) { scanByUrl.set(url, { online: false, models: new Set() }); return; }
        const models = await fetchComfyModels(url);
        scanByUrl.set(url, { online: true, models: new Set(flattenModelList(models as unknown as Record<string, unknown>)) });
      } catch { scanByUrl.set(url, { online: false, models: new Set() }); }
    }));
    const onlineServers = candidates.filter((u) => scanByUrl.get(u)?.online);
    const offlineServers = candidates.filter((u) => !scanByUrl.get(u)?.online);
    // 补入池：仅在线的全局服务器（带模型集），用 qualifyingServers 判定能否跑该模板。
    const onlineGlobalServers = globalUrls
      .filter((u) => scanByUrl.get(u)?.online)
      .map((u) => ({ url: u, models: scanByUrl.get(u)!.models }));
    const onlineAll = onlineServers.map((u) => ({ models: scanByUrl.get(u)!.models }));
    const result: { id: number; label: string; serverCount: number; failed: { url: string; reason: FailReason }[]; additions: string[] }[] = [];
    for (const t of templates) {
      const payload = (t.payload ?? {}) as Record<string, unknown>;
      const serverUrls = Array.isArray(payload.serverUrls) ? (payload.serverUrls as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const refs = extractTemplateModelRefs({ payload });
      const required = requiredModelsFor(refs, onlineAll);
      const failed = serverFailures(serverUrls, required, scanByUrl);
      const additions = qualifyingServers(refs, onlineGlobalServers).filter((u) => !serverUrls.includes(u));
      if (failed.length || additions.length) {
        result.push({ id: t.id, label: t.label, serverCount: serverUrls.length, failed, additions });
      }
    }
    return { onlineServers, offlineServers, templates: result };
  }),

  // 应用对话框中用户确认的「清理失效 + 补入」：对每个模板 next = 去掉 remove、并入 add（去重）。仅管理员。
  applyServerChanges: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        templateId: z.number(),
        remove: z.array(z.string()).default([]),
        add: z.array(z.string()).default([]),
      })).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可执行" });
      let updated = 0, removed = 0, added = 0;
      for (const item of input.items) {
        if (!item.remove.length && !item.add.length) continue;
        const existing = await db.getComfyNodeTemplate(item.templateId);
        if (!existing) continue;
        const payload = (existing.payload ?? {}) as Record<string, unknown>;
        const current = Array.isArray(payload.serverUrls) ? (payload.serverUrls as unknown[]).filter((x): x is string => typeof x === "string") : [];
        const removeSet = new Set(item.remove);
        const next = Array.from(new Set([...current.filter((u) => !removeSet.has(u)), ...item.add]));
        if (next.length === current.length && next.every((u, i) => u === current[i])) continue;
        await db.updateComfyNodeTemplate(item.templateId, { payload: sanitizeComfyPayload({ ...payload, serverUrls: next }) });
        updated++;
        removed += current.filter((u) => removeSet.has(u)).length;
        added += item.add.filter((u) => !current.includes(u)).length;
      }
      return { updated, removed, added };
    }),

  // ── Template-library functional analysis (for the agent) ───────────────────
  // List stored analyses joined with template label (compact, for the agent's
  // system prompt and any UI).
  analysisList: protectedProcedure.query(async () => {
    const [templates, analyses] = await Promise.all([
      db.listComfyNodeTemplates(),
      db.listComfyTemplateAnalysis(),
    ]);
    const byId = new Map(templates.map((t) => [t.id, t]));
    return analyses
      .filter((a) => byId.has(a.templateId))
      .map((a) => ({
        id: a.templateId,
        label: byId.get(a.templateId)!.label,
        nodeType: byId.get(a.templateId)!.nodeType,
        functionSummary: a.functionSummary ?? "",
        capabilities: (a.capabilities as string[] | null) ?? [],
        outputType: a.outputType ?? undefined,
        hasVideoOutput: a.hasVideoOutput ?? undefined,
        analyzedAt: (a.analyzedAt instanceof Date ? a.analyzedAt : new Date(a.analyzedAt)).toISOString(),
      }));
  }),

  // Analyze the template library and persist results. Default = incremental
  // (only never-analyzed / updated / out-of-version templates); `full` re-does
  // all. LLM-gated (respects admin "open LLM" bypass); any editor may trigger.
  analyzeLibrary: protectedProcedure
    .input(z.object({ model: z.string().max(64).optional(), full: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx);
      const model = input.model ?? FACTORY_DEFAULT_MODELS.llm;
      return runLibraryAnalysis(ctx, model, { full: input.full });
    }),
});
