// 时间轴素材自动优先加载：播放头之后最近的 ≤2 个视频/音频源提前 preload="auto"，
// 播放跨片段时无需现场起加载、衔接不卡顿。数量硬上限 2，不会形成解码器风暴
// （素材库网格已全面去 <video>，本组件是编辑器内唯一的预加载点）。
import { useMemo } from "react";
import { useEditorStore } from "./editorStore";
import { mediaFetchUrl } from "@/lib/download";

export function TimelinePreload() {
  const doc = useEditorStore((s) => s.doc);
  // 播放头按整秒量化订阅：预加载目标以秒级粒度变化即可，避免播放中 60fps 重渲染。
  const playheadSec = useEditorStore((s) => Math.floor(s.playhead));

  const targets = useMemo(() => {
    if (!doc) return [] as { url: string; kind: "video" | "audio" }[];
    const upcoming: { start: number; url: string; kind: "video" | "audio" }[] = [];
    for (const tr of doc.tracks) {
      for (const c of tr.clips) {
        if ((c.kind === "video" || c.kind === "audio") && c.assetUrl && c.start >= playheadSec) {
          upcoming.push({ start: c.start, url: c.assetUrl, kind: c.kind });
        }
      }
    }
    upcoming.sort((a, b) => a.start - b.start);
    const seen = new Set<string>();
    const out: { url: string; kind: "video" | "audio" }[] = [];
    for (const u of upcoming) {
      if (seen.has(u.url)) continue;
      seen.add(u.url);
      out.push({ url: u.url, kind: u.kind });
      if (out.length >= 2) break;
    }
    return out;
  }, [doc, playheadSec]);

  return (
    <div style={{ display: "none" }} aria-hidden="true">
      {targets.map((t) =>
        t.kind === "video"
          ? <video key={t.url} src={t.url.startsWith("blob:") ? t.url : mediaFetchUrl(t.url)} preload="auto" muted playsInline />
          : <audio key={t.url} src={t.url.startsWith("blob:") ? t.url : mediaFetchUrl(t.url)} preload="auto" />,
      )}
    </div>
  );
}
