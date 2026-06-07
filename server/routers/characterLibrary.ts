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
  list: protectedProcedure.query(async () => {
    const rows = await db.listCharacterLibrary();
    return rows.map(toClient);
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(120),
      characterKind: z.enum(["person", "scene"]).default("person"),
      payload: z.record(z.string(), z.unknown()),
      thumbnail: z.string().max(2048).optional(),
      note: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (JSON.stringify(input.payload).length > MAX_JSON) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "角色内容过大" });
      }
      const row = await db.createCharacterLibrary({
        userId: ctx.user.id,
        creatorName: ctx.user.name ?? ctx.user.email ?? null,
        name: input.name.trim(),
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
