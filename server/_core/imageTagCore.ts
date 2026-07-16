// E2 语义素材搜索：素材 AI 打标核心——给定素材图 URL（图片素材或视频封面图），用视觉
// 模型产出中文标签 + 一句话描述，存进 assets.meta 供搜索命中。范式照 imageQcCore：
// resolveToAbsoluteUrl → invokeLLMWithKie 多模态 → shared 解析（parseTagResult 有单测）；
// 门控/计费/日志由 invokeLLMWithKie 统一入口自动继承。
import { TRPCError } from "@trpc/server";
import { resolveToAbsoluteUrl } from "../storage";
import { invokeLLMWithKie } from "./llmWithKie";
import { extractTextContent } from "./llm";
import { parseTagResult } from "@shared/assetMeta";
import type { TrpcContext } from "./context";

const TAG_SYSTEM_PROMPT = `你是素材库的图像打标员。给定一张素材图，产出便于搜索的中文标签与一句话描述。\n`
  + `仅输出合法 JSON，无 markdown 代码块，无解释文字：\n`
  + `{"tags":["赛博朋克","夜景城市","机车","霓虹灯","雨天"],"desc":"雨夜霓虹街道上的机车骑手回眸"}\n`
  + `约束：tags 4-8 个，每个 2-6 字中文（覆盖：题材/风格、主体、场景、显著元素、色调氛围）；`
  + `desc 一句不超 40 字的中文描述（讲清主体+场景+氛围）。人名/水印文字不要进标签。`;

/** 跑一次素材打标。URL 无法解析抛 BAD_REQUEST；LLM 未返回有效结果抛 INTERNAL_SERVER_ERROR。 */
export async function runImageTag(
  ctx: TrpcContext,
  input: { imageUrl: string; name?: string; model?: string },
): Promise<{ tags: string[]; desc: string }> {
  let absoluteUrl: string;
  try { absoluteUrl = await resolveToAbsoluteUrl(input.imageUrl); }
  catch (err) { throw new TRPCError({ code: "BAD_REQUEST", message: `图像 URL 无法解析为绝对路径（${err instanceof Error ? err.message : "未知错误"}）` }); }
  const response = await invokeLLMWithKie(ctx, {
    messages: [
      { role: "system" as const, content: TAG_SYSTEM_PROMPT },
      { role: "user" as const, content: [
        { type: "text" as const, text: `素材文件名：${input.name?.trim() || "（未提供）"}\n请为这张素材图打标：` },
        { type: "image_url" as const, image_url: { url: absoluteUrl, detail: "high" as const } },
      ] },
    ],
    model: input.model ?? "gpt-5.2", // 视觉任务：默认用支持读图的模型（与「标记」/质检同款）
    maxTokens: 400,
  });
  const r = parseTagResult(extractTextContent(response));
  if (!r) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效打标结果" });
  return r;
}
