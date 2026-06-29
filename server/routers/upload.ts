import path from "path";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { storagePut, isStorageConfigured, assertObjectStorageWritable } from "../storage";
import { assertWhitelisted, assertLLMAllowed } from "../_core/whitelist";

const ALLOWED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime", "video/avi", "video/x-matroska",
  "audio/mpeg", "audio/wav", "audio/ogg", "audio/aac", "audio/flac", "audio/mp4", "audio/x-wav",
  // 3D 模型（导演台本地模型导入）：GLB/GLTF。浏览器对 .glb 常给 application/octet-stream。
  "model/gltf-binary", "model/gltf+json", "application/octet-stream",
] as const;

const uploadInput = z.object({
  // base64-encoded file content (no data: prefix — the schema rejects any
  // case-insensitive match including leading whitespace so the dev fallback
  // doesn't end up producing a malformed nested `data:...,data:...` URL).
  base64: z.string().refine((s) => !/^\s*data:/i.test(s), {
    message: "base64 must not include a data: prefix; strip it client-side",
  }),
  mimeType: z.string().refine((t) => (ALLOWED_MIME_TYPES as readonly string[]).includes(t), { message: "Unsupported MIME type" }).default("image/jpeg"),
  filename: z.string().optional(),
});
type UploadInput = z.infer<typeof uploadInput>;

// ── Upload Router ─────────────────────────────────────────────────────────────
// Accepts base64-encoded file data from the frontend and stores it in S3.
// Returns the storage URL for use in image generation as reference image.

/** Shared storage logic (no access gate — callers gate first). */
async function storeUpload(userId: number, input: UploadInput): Promise<{ url: string; storageKey: string }> {
  const buf = Buffer.from(input.base64, "base64");
  // Enforce 16 MB limit
  if (buf.byteLength > 16 * 1024 * 1024) {
    throw new Error("File too large (max 16 MB)");
  }
  const ext = input.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const rawName = input.filename ? path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, "_") : `ref-${Date.now()}.${ext}`;
  const filename = rawName || `ref-${Date.now()}.${ext}`;
  // Namespace by userId so different users' same-named files don't collide
  const key = `reference-images/${userId}/${filename}`;

  // Dev fallback: when Forge/S3 isn't configured (local dev bypass), return the
  // upload as an inline data: URL so downstream flows (LLM image input, previews)
  // keep working without storage configured. The check is on env presence, NOT on
  // storagePut's error string — that string match used to mask production storage
  // outages (expired creds, rate-limit errors, etc.) as if they were a dev signal.
  if (!isStorageConfigured()) {
    const dataUrl = `data:${input.mimeType};base64,${input.base64}`;
    return { url: dataUrl, storageKey: key };
  }
  // 「仅允许 MinIO/S3」开关：未配 MinIO/S3 时拒绝写入，不回退 Forge 存储。
  await assertObjectStorageWritable();
  const { url } = await storagePut(key, buf, input.mimeType);
  return { url, storageKey: key };
}

export const uploadRouter = router({
  // Generic reference-image upload (Storyboard / Prompt / Image Gen …). Gated by the
  // full storage whitelist — these feed paid image/video generation.
  uploadImage: protectedProcedure
    .input(uploadInput)
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      return storeUpload(ctx.user.id, input);
    }),

  // AI 对话节点的附件图片：属于「视觉 LLM」输入（发给模型看的参考图），按文档设计与文字对话
  // 同级门控——走 assertLLMAllowed（认「LLM 不受白名单」豁免开关），而非完整存储白名单，
  // 避免开了 LLM 豁免却仍在传图时弹白名单对话框。
  uploadAiChatImage: protectedProcedure
    .input(uploadInput)
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx);
      return storeUpload(ctx.user.id, input);
    }),
});
