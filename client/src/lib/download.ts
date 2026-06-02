import { toast } from "sonner";

/**
 * Build the URL used to fetch a media file. External (http/https) URLs go through
 * the server proxy (CORS + auth); internal `/manus-storage/...` paths are served
 * directly by the storage proxy. `download` appends the flag that makes the
 * server send `Content-Disposition: attachment`.
 */
export type MediaProxyKind = "video" | "image";

export function mediaFetchUrl(rawUrl: string, download = false, proxy: MediaProxyKind = "video"): string {
  if (/^https?:\/\//i.test(rawUrl)) {
    const ep = proxy === "image" ? "/api/image-proxy" : "/api/video-proxy";
    return `${ep}?url=${encodeURIComponent(rawUrl)}${download ? "&download=1" : ""}`;
  }
  if (download && rawUrl.startsWith("/")) {
    return rawUrl + (rawUrl.includes("?") ? "&" : "?") + "download=1";
  }
  return rawUrl;
}

/**
 * Download a media file safely. Historically a bare `<a download href="/api/video-proxy?…">`
 * would, when the proxy returned an error page (expired upstream URL, non-https
 * source, auth loss), save that HTML error as `video-proxy.htm` — the user got a
 * junk file instead of a clear message. This previews the response first and only
 * triggers the real (streamed) download when the body is actually a media file;
 * otherwise it surfaces a toast.
 */
export async function downloadMedia(rawUrl: string, filename: string, proxy: MediaProxyKind = "video"): Promise<void> {
  if (!rawUrl) { toast.error("没有可下载的文件"); return; }
  const url = mediaFetchUrl(rawUrl, true, proxy);

  // Internal storage URLs are stable and don't expire — download directly without
  // a preflight (the storage proxy doesn't support Range, so a probe would pull
  // the whole file). External/proxied URLs get a cheap header-only preflight.
  const isExternal = /^https?:\/\//i.test(rawUrl);
  if (isExternal) {
    try {
      const ctrl = new AbortController();
      const probe = await fetch(url, { headers: { Range: "bytes=0-1" }, credentials: "same-origin", signal: ctrl.signal });
      const ct = (probe.headers.get("content-type") || "").toLowerCase();
      const ok = probe.ok || probe.status === 206;
      ctrl.abort(); // headers are all we need — cancel the body stream
      if (!ok || ct.includes("text/html")) {
        toast.error(
          probe.status === 401
            ? "登录状态已失效，请刷新页面后重试下载"
            : "源文件已失效或无法访问，无法下载（可尝试重新生成）",
        );
        return;
      }
    } catch {
      toast.error("网络错误，下载失败，请重试");
      return;
    }
  }

  // Stream the real download via a transient anchor (no in-memory buffering).
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Convenience onClick handler for an existing `<a>`/button download control. */
export function onDownloadMedia(rawUrl: string, filename: string, proxy: MediaProxyKind = "video") {
  return (e: { preventDefault: () => void }) => {
    e.preventDefault();
    void downloadMedia(rawUrl, filename, proxy);
  };
}
