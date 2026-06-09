import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import type { PromptLibraryRow } from "../../drizzle/schema";

// 快捷提示词库：每用户私有。每行是一个自定义提示词，按 category 分组；slot(0..9) 非空时
// 该行占用一个「/」快捷槽位（slotKind="prompt" 直插 text；slotKind="category" 为类别入口）。
// 内置预设提示词在客户端静态维护（promptLibraryPresets.ts），用户可一键收藏进本库。

const MAX_TEXT = 8000;
const MAX_TOTAL = 500; // 单用户提示词条数上限，防滥用

function toClient(r: PromptLibraryRow) {
  return {
    id: r.id,
    label: r.label,
    text: r.text,
    category: r.category,
    slot: r.slot ?? null,
    slotKind: (r.slotKind === "category" ? "category" : r.slotKind === "prompt" ? "prompt" : null) as "prompt" | "category" | null,
    sortOrder: r.sortOrder,
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
  };
}

const slotSchema = z.number().int().min(0).max(9).nullable().optional();
const slotKindSchema = z.enum(["prompt", "category"]).nullable().optional();

// 设置某 slot 前，清空同用户其它项对该 slot 的占用——保证每个槽位唯一（防 JSON 导入/异常路径
// 产生「两条都指向同一 slot」的脏数据；客户端 favoriteSlots 只取首个会丢另一条）。
async function clearSlotOccupant(userId: number, slot: number | null | undefined, exceptId?: number): Promise<void> {
  if (slot == null) return;
  for (const r of await db.listPromptLibrary(userId)) {
    if (r.slot === slot && r.id !== exceptId) await db.updatePromptLibrary(r.id, { slot: null, slotKind: null });
  }
}

export const promptLibraryRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.listPromptLibrary(ctx.user.id);
    return rows.map(toClient);
  }),

  create: protectedProcedure
    .input(z.object({
      label: z.string().trim().min(1).max(120),
      text: z.string().max(MAX_TEXT).default(""),
      category: z.string().trim().max(120).default("通用"),
      slot: slotSchema,
      slotKind: slotKindSchema,
      sortOrder: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const total = (await db.listPromptLibrary(ctx.user.id)).length;
      if (total >= MAX_TOTAL) throw new TRPCError({ code: "BAD_REQUEST", message: "提示词数量已达上限" });
      await clearSlotOccupant(ctx.user.id, input.slot); // 槽位唯一
      const row = await db.createPromptLibrary({
        userId: ctx.user.id,
        label: input.label.trim(),
        text: input.text,
        category: input.category.trim() || "通用",
        slot: input.slot ?? null,
        slotKind: input.slot != null ? (input.slotKind ?? "prompt") : null,
        sortOrder: input.sortOrder ?? total,
      });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "保存失败" });
      return toClient(row);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      label: z.string().trim().min(1).max(120).optional(),
      text: z.string().max(MAX_TEXT).optional(),
      category: z.string().trim().max(120).optional(),
      slot: slotSchema,
      slotKind: slotKindSchema,
      sortOrder: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getPromptLibrary(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "只能修改自己的提示词" });
      const patch: Record<string, unknown> = {};
      if (input.label !== undefined) patch.label = input.label.trim();
      if (input.text !== undefined) patch.text = input.text;
      if (input.category !== undefined) patch.category = input.category.trim() || "通用";
      if (input.slot !== undefined) {
        patch.slot = input.slot;
        // slot 同时显式给出 slotKind 则用之；清空 slot 时一并清 slotKind。
        patch.slotKind = input.slot == null ? null : (input.slotKind ?? existing.slotKind ?? "prompt");
      } else if (input.slotKind !== undefined) {
        patch.slotKind = input.slotKind;
      }
      if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
      if (input.slot !== undefined) await clearSlotOccupant(ctx.user.id, input.slot, input.id); // 槽位唯一
      await db.updatePromptLibrary(input.id, patch);
      const updated = await db.getPromptLibrary(input.id);
      return updated ? toClient(updated) : { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getPromptLibrary(input.id);
      if (!existing) return { success: true };
      if (existing.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己的提示词" });
      await db.deletePromptLibrary(input.id);
      return { success: true };
    }),

  // 批量重排：传 [{id, sortOrder, slot?, slotKind?}]，逐条更新（仅本人条目）。
  reorder: protectedProcedure
    .input(z.object({ items: z.array(z.object({ id: z.number(), sortOrder: z.number().int(), slot: slotSchema, slotKind: slotKindSchema })).max(MAX_TOTAL) }))
    .mutation(async ({ ctx, input }) => {
      const mine = new Set((await db.listPromptLibrary(ctx.user.id)).map((r) => r.id));
      for (const it of input.items) {
        if (!mine.has(it.id)) continue;
        const patch: Record<string, unknown> = { sortOrder: it.sortOrder };
        if (it.slot !== undefined) { patch.slot = it.slot; patch.slotKind = it.slot == null ? null : (it.slotKind ?? "prompt"); }
        await db.updatePromptLibrary(it.id, patch);
      }
      return { success: true };
    }),
});
