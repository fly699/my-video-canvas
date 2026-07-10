// 节点产物媒体解析（胶片条 / 资产左栏大纲共用，LibTV 化 2.4 从 FilmstripPanel 抽出）。
// 桥接各节点类型的字段命名差异：imageUrl/imageUrls（image_gen、comfyui_image、storyboard）、
// resultVideoUrl（video_task、comfyui_video）、outputUrl(s)+outputType（comfyui_workflow）。
export function extractFrameMedia(p: Record<string, unknown>): { imageUrl?: string; videoUrl?: string } {
  const imageUrl = (p.imageUrl as string | undefined)
    || (Array.isArray(p.imageUrls) ? (p.imageUrls as string[])[0] : undefined);
  let videoUrl = p.resultVideoUrl as string | undefined;
  // comfyui_workflow output → bridge by outputType (fall back to extension sniff).
  const out = (p.outputUrl as string | undefined)
    || (Array.isArray(p.outputUrls) ? (p.outputUrls as string[])[0] : undefined);
  if (out) {
    const t = p.outputType as string | undefined;
    const isVideo = t === "video" || (t !== "image" && /\.(mp4|webm|mov|m4v|mkv|avi|ogv|gif)(\?|#|$)/i.test(out));
    if (isVideo) videoUrl = videoUrl || out;
    else if (!imageUrl) return { imageUrl: out, videoUrl };
  }
  return { imageUrl, videoUrl };
}
