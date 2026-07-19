import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

// 通用 per-user 偏好 KV。key 走白名单，value JSON 大小受限，防滥用。
// 用途：connectMenuOrder —— 拉线建节点菜单的节点类型自定义排序（NodeType[]）；
//       uiStyle —— 界面皮肤（pro / studio / simple），跨设备持久化；
//       canvasAgentPresets / canvasAgentQuick / canvasAgentModel —— #249 画布助手
//       快捷设置预设（≤12 套）/ 当前快捷设置 / 规划模型选择，随账号跨设备持久化
//       （localStorage 仅作本地缓存与首次迁移源，服务端值优先）。
const ALLOWED_KEYS = ["connectMenuOrder", "uiStyle", "canvasAgentPresets", "canvasAgentQuick", "canvasAgentModel"] as const;
const keySchema = z.enum(ALLOWED_KEYS);
const MAX_VALUE_JSON = 8_000;
// 预设最多 12 套 × 每套 ~1KB 快捷设置，8KB 默认上限不够——按 key 放宽。
const MAX_BY_KEY: Partial<Record<(typeof ALLOWED_KEYS)[number], number>> = {
  canvasAgentPresets: 48_000,
  canvasAgentQuick: 16_000,
};

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
      if (JSON.stringify(input.value ?? null).length > (MAX_BY_KEY[input.key] ?? MAX_VALUE_JSON)) {
        throw new Error("偏好内容过大");
      }
      await db.setUserPref(ctx.user.id, input.key, input.value ?? null);
      return { success: true };
    }),
});
