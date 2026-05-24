import path from "path";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { storagePut } from "../storage";
import { assertWhitelisted } from "../_core/whitelist";

const ALLOWED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime", "video/avi", "video/x-matroska",
  "audio/mpeg", "audio/wav", "audio/ogg", "audio/aac", "audio/flac", "audio/mp4", "audio/x-wav",
] as const;

// ── Upload Router ─────────────────────────────────────────────────────────────
// Accepts base64-encoded file data from the frontend and stores it in S3.
// Returns the storage URL for use in image generation as reference image.

export const uploadRouter = router({
  uploadImage: protectedProcedure
    .input(
      z.object({
        // base64-encoded file content (without data: prefix)
        base64: z.string(),
        mimeType: z.string().refine((t) => (ALLOWED_MIME_TYPES as readonly string[]).includes(t), { message: "Unsupported MIME type" }).default("image/jpeg"),
        filename: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      const buf = Buffer.from(input.base64, "base64");

      // Enforce 16 MB limit
      if (buf.byteLength > 16 * 1024 * 1024) {
        throw new Error("File too large (max 16 MB)");
      }

      const ext = input.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      const rawName = input.filename ? path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, "_") : `ref-${Date.now()}.${ext}`;
      const filename = rawName || `ref-${Date.now()}.${ext}`;
      // Namespace by userId so different users' same-named files don't collide
      const key = `reference-images/${ctx.user.id}/${filename}`;

      const { url } = await storagePut(key, buf, input.mimeType);
      return { url, storageKey: key };
    }),
});
