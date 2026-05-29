import { C } from "./chatTheme";
import { openLightbox } from "./chatLightbox";

// 解析消息正文中的网址：渲染为可点链接；图片/音频/视频/YouTube 以内嵌播放器展示。
const URL_RE = /(https?:\/\/[^\s<]+)/gi;
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;
const VID_EXT = /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i;
const AUD_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i;

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function MessageContent({ content }: { content: string }) {
  if (!content) return null;
  const parts: React.ReactNode[] = [];
  const embeds: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(content)) !== null) {
    const url = m[0];
    if (m.index > last) parts.push(content.slice(last, m.index));
    parts.push(
      <a key={`l${i}`} href={url} target="_blank" rel="noreferrer"
         style={{ color: C.accent2, textDecoration: "underline", wordBreak: "break-all" }}>{url}</a>,
    );
    last = m.index + url.length;
    const yt = youtubeId(url);
    if (IMG_EXT.test(url)) {
      embeds.push(<img key={`e${i}`} src={url} alt="" onClick={() => openLightbox(url)} style={{ ...embedImg, cursor: "zoom-in" }} />);
    } else if (VID_EXT.test(url)) {
      embeds.push(<video key={`e${i}`} src={url} controls style={embedMedia} />);
    } else if (AUD_EXT.test(url)) {
      embeds.push(<audio key={`e${i}`} src={url} controls style={{ width: 260, marginTop: 6 }} />);
    } else if (yt) {
      embeds.push(
        <iframe key={`e${i}`} src={`https://www.youtube.com/embed/${yt}`} title="YouTube"
                allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen style={{ ...embedMedia, aspectRatio: "16/9", border: "none" }} />,
      );
    }
    i++;
  }
  if (last < content.length) parts.push(content.slice(last));

  return (
    <>
      <div style={{ whiteSpace: "pre-wrap" }}>{parts}</div>
      {embeds.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>{embeds}</div>}
    </>
  );
}

const embedMedia: React.CSSProperties = { maxWidth: 280, width: "100%", borderRadius: 10, display: "block" };
const embedImg: React.CSSProperties = { maxWidth: 240, maxHeight: 240, borderRadius: 10, display: "block" };
