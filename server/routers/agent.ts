import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { assertProjectAccess } from "../_core/permissions";
import { assertLLMAllowed } from "../_core/whitelist";
import { invokeLLM, extractTextContent } from "../_core/llm";
import { catalogText, sanitizeOperation } from "../_core/agentCatalog";
import type { AgentOperation } from "../../shared/types";

// ── Agent (Copilot) router ────────────────────────────────────────────────────
// `chat` is the agent's "planning brain": it turns a natural-language request +
// the current graph into a set of canvas operations (create/connect/update/
// delete). It NEVER mutates the canvas server-side — the client applies the
// returned operations through the canvas store, so every change is undoable,
// persisted and broadcast exactly like a manual edit. LLM-gated (respects the
// admin "open LLM" toggle); editor access required.
export const agentRouter = router({
  chat: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        message: z.string().min(1).max(4000),
        history: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
          .max(20)
          .optional(),
        graphSummary: z.string().max(20000).optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await assertLLMAllowed(ctx);

      const system = `你是「AI 视频画布」的智能体副驾（Copilot）。用户用自然语言描述想做的视频，你负责把它拆解为画布上的节点工作流。

# 可用节点目录（只能使用下面列出的节点类型与字段，禁止编造任何不存在的节点或字段）
${catalogText()}

# 当前画布
${input.graphSummary?.trim() || "（空画布）"}

# 输出要求
严格只输出一个 JSON 对象（不要 markdown 代码块、不要任何多余文字），结构如下：
{
  "reply": "给用户的简短中文说明（你打算怎么做 / 或直接回答）",
  "operations": [
    { "op": "create", "tempId": "n1", "nodeType": "prompt", "title": "可选标题", "payload": { "positivePrompt": "..." }, "note": "为什么这么做" },
    { "op": "connect", "sourceRef": "n1", "targetRef": "n2", "note": "..." },
    { "op": "update", "targetRef": "已存在节点的id", "payload": { } },
    { "op": "delete", "targetRef": "节点id" }
  ]
}

规则：
- 新建节点用 "create" 并赋唯一 tempId；之后的 "connect" 用 tempId 或画布中已存在的节点 id 互相连接（sourceRef→targetRef）。
- 每个节点的 payload 只能使用目录中该节点类型列出的字段名。
- 按创作链路合理编排：脚本/分镜 → 提示词/图像/视频 → 合并/字幕/配乐。
- 若用户只是提问、或当前无需改动画布，operations 给空数组 []，把回答写进 reply。
- 你只负责把工作流搭好并填好参数，默认不触发生成（用户会在画布上点运行）。`;

      const messages = [
        { role: "system" as const, content: system },
        ...(input.history ?? []).map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: input.message },
      ];

      const response = await invokeLLM({ messages, model: input.model ?? "claude-sonnet-4-5-20250929", maxTokens: 4000 });
      const text = extractTextContent(response);

      let reply = text.trim();
      let operations: AgentOperation[] = [];
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { reply?: unknown; operations?: unknown };
          if (typeof parsed.reply === "string" && parsed.reply.trim()) reply = parsed.reply.trim();
          if (Array.isArray(parsed.operations)) {
            operations = parsed.operations
              .map(sanitizeOperation)
              .filter((o): o is AgentOperation => o !== null);
          }
        } catch {
          /* not valid JSON — return the raw text as the reply with no operations */
        }
      }
      return { reply, operations };
    }),
});
