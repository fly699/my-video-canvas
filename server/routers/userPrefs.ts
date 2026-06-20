import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

// 通用 per-user 偏好 KV。key 走白名单，value JSON 大小受限，防滥用。
// 用途：connectMenuOrder —— 拉线建节点菜单的节点类型自定义排序（NodeType[]）；
//       uiStyle —— 界面皮肤（pro / studio / simple），跨设备持久化。
const ALLOWED_KEYS = ["connectMenuOrder", "uiStyle"] as const;
const keySchema = z.enum(ALLOWED_KEYS);
const MAX_VALUE_JSON = 8_000;

export const userPrefsRouter = router({
  get: protectedProcedure
    .input(z.object({ key: keySchema }))
    .query(async ({ ctx, input }) => {
      const value = await db.getUserPref(ctx.user.id, input.key);
      return { value: value ?? null };
    }),

  set: protectedProcedure
    .input(z.object({ key: keySchema, value: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      if (JSON.stringify(input.value ?? null).length > MAX_VALUE_JSON) {
        throw new Error("偏好内容过大");
      }
      await db.setUserPref(ctx.user.id, input.key, input.value ?? null);
      return { success: true };
    }),
});
