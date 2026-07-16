// A1/B1 共用的图像 AI 质检核心：给定生成提示词/任务描述与结果图 URL，用视觉模型做
// 结构化判定（pass/score/issues/suggestion）。两处调用方：
// ① canvas.ts aiEnhance.qcImage（图像节点手动/自动质检，A1）
// ② superAgent buildComfyWorkflow 的产物验收钩子（工程智能体，B1）
// 门控/计费/日志由 invokeLLMWithKie 统一入口自动继承；解析在 shared/imageQc 有单测。
import { TRPCError } from "@trpc/server";
import { resolveToAbsoluteUrl } from "../storage";
import { invokeLLMWithKie } from "./llmWithKie";
import { extractTextContent } from "./llm";
import { parseQcVerdict, type QcVerdict } from "@shared/imageQc";
import type { TrpcContext } from "./context";

const QC_SYSTEM_PROMPT = `你是 AI 生成图像的质检员。给定生成提示词与生成结果图，判定图像是否合格可直接采用。\n`
  + `检查项：①与提示词的符合度（主体/数量/动作/场景是否对得上）②人物肢体与面部是否畸形（多指/断肢/五官错乱）`
  + `③是否黑屏/空白/严重模糊④是否出现意外文字/水印/乱码⑤构图是否明显残缺。\n`
  + `仅输出合法 JSON，无 markdown 代码块，无解释文字：\n`
  + `{"pass":true,"score":88,"issues":[],"suggestion":""}\n`
  + `或 {"pass":false,"score":40,"issues":["右手六根手指","背景出现乱码文字"],"suggestion":"正确的双手各五根手指，画面中不出现任何文字或水印"}\n`
  + `约束：pass=是否可直接采用；score 0-100；issues 每条不超 20 字中文、最多 5 条、无问题为空数组；`
  + `suggestion 为一句不超 60 字、可直接附加进生成提示词的正向修正指令（pass=true 时为空字符串）。`
  + `轻微的风格/色调差异不算不合格，只抓硬伤。`;

/** 跑一次图像质检。URL 无法解析抛 BAD_REQUEST；LLM 未返回合法判定抛 INTERNAL_SERVER_ERROR。 */
export async function runImageQc(
  ctx: TrpcContext,
  input: { imageUrl: string; prompt?: string; model?: string },
): Promise<QcVerdict> {
  let absoluteUrl: string;
  try { absoluteUrl = await resolveToAbsoluteUrl(input.imageUrl); }
  catch (err) { throw new TRPCError({ code: "BAD_REQUEST", message: `图像 URL 无法解析为绝对路径（${err instanceof Error ? err.message : "未知错误"}）` }); }
  const response = await invokeLLMWithKie(ctx, {
    messages: [
      { role: "system" as const, content: QC_SYSTEM_PROMPT },
      { role: "user" as const, content: [
        { type: "text" as const, text: `生成提示词：${input.prompt?.trim() || "（未提供）"}\n请质检这张生成结果图：` },
        { type: "image_url" as const, image_url: { url: absoluteUrl, detail: "high" as const } },
      ] },
    ],
    model: input.model ?? "gpt-5.2", // 视觉任务：默认用支持读图的模型（与「标记」同款）
    maxTokens: 600,
  });
  const verdict = parseQcVerdict(extractTextContent(response));
  if (!verdict) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效质检判定" });
  return verdict;
}
