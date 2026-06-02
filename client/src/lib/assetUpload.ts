import { trpc } from "./trpc";
import { toast } from "sonner";

type TrpcClient = ReturnType<typeof trpc.useUtils>["client"];

const MAX_BYTES = 500 * 1024 * 1024; // 500MB

export type AssetKind = "image" | "video" | "audio" | "other";

export function assetKindOf(mime: string): AssetKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "other";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file into the user's library. Prefers a streamed/presigned direct
 * upload (no base64 ~15MB cap — supports up to 500MB) when object storage is
 * configured; falls back to base64 through tRPC when no storage is set.
 * Surfaces its own error toast. Returns true on success.
 */
export async function uploadAssetFile(client: TrpcClient, file: File, projectId?: number): Promise<boolean> {
  if (file.size > MAX_BYTES) { toast.error("文件不能超过 500MB"); return false; }
  const mimeType = file.type || "application/octet-stream";
  const type = assetKindOf(mimeType);
  try {
    const res = await client.assets.createUploadUrl.mutate({ name: file.name, mimeType, size: file.size, projectId });
    if (res.mode === "base64") {
      const base64 = await fileToBase64(file);
      await client.assets.upload.mutate({ name: file.name, type, mimeType, size: file.size, base64, projectId });
    } else {
      const put = await fetch(res.uploadUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: file });
      if (!put.ok) throw new Error(`上传到存储失败 (${put.status})`);
      await client.assets.confirmUpload.mutate({ key: res.key, url: res.url, name: file.name, type, mimeType, size: file.size, projectId });
    }
    return true;
  } catch (e) {
    toast.error("上传失败：" + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}
