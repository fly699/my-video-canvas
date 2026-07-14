import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { transcribeAudioBuffer, resolveTranscribeEndpoint } from "../_core/voiceTranscription";
import { getSystemDefaultModel } from "../_core/systemDefaultModels";
import { assertLLMAllowed } from "../_core/whitelist";
import { writeAuditLog } from "../_core/auditLog";

// 语音输入的服务端兜底：浏览器 Web Speech（Google/Apple 云端）在国内/无法访问 Google 时会失败，
// 前端录音后走这里 → 复用项目已有的 whisper 转写（自建 / Forge / OpenAI，皆不经 Google）。
// 门控与「AI 对话图片附件」同级（assertLLMAllowed）——语音输入本质是喂给聊天 LLM 的内容。
// 不落对象存储：音频以 base64 直传、服务端仅用一次性临时文件转写后即删（隐私 + 无存储依赖）。
export const voiceRouter = router({
  transcribe: protectedProcedure
    .input(
      z.object({
        // 录音 base64（无 data: 前缀，前端 strip）。上限 ~10MB（约数分钟 opus 语音）。
        base64: z.string().refine((s) => !/^\s*data:/i.test(s), { message: "base64 不应带 data: 前缀" }).max(14_000_000),
        // 容器扩展名（webm/mp4/ogg/wav…），供服务端命名临时文件。
        ext: z.string().max(8).optional(),
        language: z.string().max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx);
      // 语音输入受「系统默认模型 › 语音输入转录」(voiceTranscribe 槽) 控制，与字幕类 transcribe 各自独立；
      // 按所选模型的 provider 路由（Groq/自建/Forge）——选谁就走谁的后端。
      const model = await getSystemDefaultModel("voiceTranscribe");
      if (!resolveTranscribeEndpoint(model)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "服务端语音识别未配置：请管理员设置 whisper 转写端点（自建 / Forge / OPENAI_API_KEY），或在「系统默认模型 › 语音输入转录」选一个已配置 provider 的模型" });
      }
      const buffer = Buffer.from(input.base64, "base64");
      if (buffer.byteLength === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "空音频" });
      if (buffer.byteLength > 10 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "录音过长（>10MB），请分段" });
      const result = await transcribeAudioBuffer(buffer, input.ext ?? "webm", { language: input.language, model });
      if ("error" in result) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error + (result.details ? `：${result.details}` : "") });
      }
      const text = (result.text ?? "").trim();
      writeAuditLog({ ctx, action: "voice_transcribe", detail: { bytes: buffer.byteLength, language: result.language, chars: text.length } });
      return { text };
    }),
});
