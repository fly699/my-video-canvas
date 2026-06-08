import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import type { CharacterLibraryRow } from "../../drizzle/schema";

// Global character library: reusable identities (person / scene) saved as the full
// CharacterNodeData payload so they can be re-instantiated as a node in any project.
// Shared library — every logged-in user sees all entries; creator/admin may delete.

const MAX_JSON = 200_000;

function toClient(r: CharacterLibraryRow) {
  return {
    id: r.id,
    name: r.name,
    characterKind: (r.characterKind === "scene" ? "scene" : "person") as "person" | "scene",
    payload: (r.payload ?? {}) as Record<string, unknown>,
    thumbnail: r.thumbnail ?? undefined,
    note: r.note ?? undefined,
    userId: r.userId,
    creatorName: r.creatorName ?? undefined,
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
  };
}

export const characterLibraryRouter = router({
  // Private library — each user sees only their own saved characters.
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.listCharacterLibrary(ctx.user.id);
    return rows.map(toClient);
  }),

  rename: protectedProcedure
    .input(z.object({ id: z.number(), name: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getCharacterLibrary(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只能修改自己保存的角色" });
      }
      const nm = input.name.trim();
      const kind = existing.characterKind === "scene" ? "scene" : "person";
      // 同名查重（同类型、排除自身）——避免重命名撞到已有角色。
      const dup = (await db.listCharacterLibrary(ctx.user.id)).find(
        (r) => r.id !== input.id && r.name.trim() === nm && (r.characterKind === "scene" ? "scene" : "person") === kind,
      );
      if (dup) throw new TRPCError({ code: "CONFLICT", message: `已存在同名${kind === "scene" ? "场景" : "角色"}「${nm}」` });
      await db.updateCharacterLibrary(input.id, { name: nm });
      return { success: true };
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(120),
      characterKind: z.enum(["person", "scene"]).default("person"),
      payload: z.record(z.string(), z.unknown()),
      thumbnail: z.string().max(2048).optional(),
      note: z.string().max(2000).optional(),
      // 同名时是否覆盖（默认否：返回 CONFLICT 让前端提示）。覆盖即「编辑保存」。
      overwrite: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (JSON.stringify(input.payload).length > MAX_JSON) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "角色内容过大" });
      }
      const nm = input.name.trim();
      // 同名查重（同类型）：默认拒绝并提示；overwrite 时更新既有条目（用于编辑/覆盖）。
      const existing = (await db.listCharacterLibrary(ctx.user.id)).find(
        (r) => r.name.trim() === nm && (r.characterKind === "scene" ? "scene" : "person") === input.characterKind,
      );
      if (existing) {
        if (!input.overwrite) {
          throw new TRPCError({ code: "CONFLICT", message: `已存在同名${input.characterKind === "scene" ? "场景" : "角色"}「${nm}」` });
        }
        await db.updateCharacterLibrary(existing.id, {
          name: nm,
          payload: input.payload,
          thumbnail: input.thumbnail || null,
          note: input.note?.trim() || null,
        });
        const updated = await db.getCharacterLibrary(existing.id);
        if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "保存失败" });
        return toClient(updated);
      }
      const row = await db.createCharacterLibrary({
        userId: ctx.user.id,
        creatorName: ctx.user.name ?? ctx.user.email ?? null,
        name: nm,
        characterKind: input.characterKind,
        payload: input.payload,
        thumbnail: input.thumbnail || null,
        note: input.note?.trim() || null,
      });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "保存失败" });
      return toClient(row);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getCharacterLibrary(input.id);
      if (!existing) return { success: true };
      if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己保存的角色" });
      }
      await db.deleteCharacterLibrary(input.id);
      return { success: true };
    }),
});
