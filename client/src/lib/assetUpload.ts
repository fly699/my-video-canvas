import { trpc } from "./trpc";
import { toast } from "sonner";

type TrpcClient = ReturnType<typeof trpc.useUtils>["client"];

// 客户端上限：配置了对象存储时走预签名直传(浏览器→存储，不过应用服务器)，可支持数 GB，
// 放开到 5000MB(5GB)。未配存储的 base64 兜底受 express.json 50MB 限制，见下方 BASE64_MAX_BYTES。
export const MAX_BYTES = 5000 * 1024 * 1024; // 5000MB (5GB)
export const MAX_MB = 5000;
// base64 兜底(无对象存储)经 tRPC/express.json(50MB)——base64 膨胀约 1.37×，安全原始上限约 36MB。
const BASE64_MAX_BYTES = 36 * 1024 * 1024;

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
  if (file.size > MAX_BYTES) { toast.error(`文件不能超过 ${MAX_MB}MB`); return false; }
  const mimeType = file.type || "application/octet-stream";
  const type = assetKindOf(mimeType);
  try {
    const res = await client.assets.createUploadUrl.mutate({ name: file.name, mimeType, size: file.size, projectId });
    if (res.mode === "base64") {
      // 无对象存储：走 base64 过服务器，受 50MB body 限。大文件在此明确拦截并给出可操作提示，
      // 而不是让请求撞上服务端 413 报出费解的错误。
      if (file.size > BASE64_MAX_BYTES) {
        toast.error(`未配置对象存储时单文件上限约 36MB（当前 ${(file.size / 1024 / 1024).toFixed(0)}MB）。请让管理员配置对象存储（MinIO/S3）后即可直传大文件。`);
        return false;
      }
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
