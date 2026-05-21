import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { storagePut } from "../storage";

// ── Upload Router ─────────────────────────────────────────────────────────────
// Accepts base64-encoded file data from the frontend and stores it in S3.
// Returns the storage URL for use in image generation as reference image.

export const uploadRouter = router({
  uploadImage: protectedProcedure
    .input(
      z.object({
        // base64-encoded file content (without data: prefix)
        base64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        filename: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const buf = Buffer.from(input.base64, "base64");

      // Enforce 16 MB limit
      if (buf.byteLength > 16 * 1024 * 1024) {
        throw new Error("File too large (max 16 MB)");
      }

      const ext = input.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      const filename = input.filename ?? `ref-${Date.now()}.${ext}`;
      const key = `reference-images/${filename}`;

      const { url } = await storagePut(key, buf, input.mimeType);
      return { url };
    }),
});
