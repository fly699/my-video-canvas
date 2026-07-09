// 浏览器可能「内联执行」的存储对象类型——HTML / SVG / XML 等。storageProxy 的流式中转路径对这些
// 类型强制 nosniff + Content-Disposition: attachment，绝不内联；但当部署配了 S3_PUBLIC_ENDPOINT/Forge
// 走 307 直链分支时，这两个头被跳过、存储直链会把 text/html、image/svg+xml 内联返回 → stored XSS。
// 故在签发上传 URL 时就拒绝这些类型（合法媒体/文档上传不受影响；确需存 HTML/SVG 者应以
// application/octet-stream 上传，那样两条服务路径都只会当附件下载）。
const INLINE_EXECUTABLE_MIME = /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|application\/xml|text\/xml|application\/xhtml)\b/i;

/** True when a declared MIME type could be executed/scripted if a browser renders it inline. */
export function isInlineExecutableMime(mime: string | undefined | null): boolean {
  return !!mime && INLINE_EXECUTABLE_MIME.test(mime.trim());
}

/** Zod refine predicate: reject inline-executable types at upload-URL issuance. */
export const safeUploadMime = (mime: string): boolean => !isInlineExecutableMime(mime);
export const SAFE_UPLOAD_MIME_MSG = "不支持上传该类型（HTML/SVG/XML 等可内联执行的文件）；如确需存储请用通用二进制类型";
