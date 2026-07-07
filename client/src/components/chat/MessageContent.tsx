import { C } from "./chatTheme";
import { openLightbox } from "./chatLightbox";

// 解析消息正文：把网址渲染为可点链接；图片/音频/视频/YouTube 以内嵌播放器展示。
// 图片来源支持三种（此前只认「带图片后缀的 http 链接」，导致模型/工具返回的 Markdown 图、
// data URI、无后缀直链都不显示）：① Markdown 图 ![](url)  ② data:image;base64 内联  ③ 带后缀直链。
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;
const VID_EXT = /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i;
const AUD_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i;
// 组合分词：① Markdown 图（组1=其 url，http 或 data:image）② data:image 内联（组2）③ 普通 http(s) 链接（组3）。
const TOKEN_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+)\)|(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)|(https?:\/\/[^\s<]+)/gi;

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export type Inline = { kind: "text" | "link"; value: string };
export type Embed = { kind: "image" | "video" | "audio" | "youtube"; value: string };

/** 把正文切成「行内片段（文字/链接）」+「内嵌媒体」。纯函数，便于单测。
 *  - Markdown 图 / data:image → 只作图片内嵌，不在正文里留原始语法/超长串；
 *  - 普通 http 链接 → 正文里保留可点链接，并按后缀/YouTube 追加对应内嵌媒体。 */
export function parseMessage(content: string): { inline: Inline[]; embeds: Embed[] } {
  const inline: Inline[] = [];
  const embeds: Embed[] = [];
  if (!content) return { inline, embeds };
  let last = 0; let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(content)) !== null) {
    if (m.index > last) inline.push({ kind: "text", value: content.slice(last, m.index) });
    last = m.index + m[0].length;
    const mdImg = m[1], dataImg = m[2], url = m[3];
    if (mdImg) { embeds.push({ kind: "image", value: mdImg }); continue; }        // ![](...) → 纯图片，不留正文
    if (dataImg) { embeds.push({ kind: "image", value: dataImg }); continue; }     // data:image → 纯图片
    if (url) {
      inline.push({ kind: "link", value: url });
      const yt = youtubeId(url);
      if (IMG_EXT.test(url)) embeds.push({ kind: "image", value: url });
      else if (VID_EXT.test(url)) embeds.push({ kind: "video", value: url });
      else if (AUD_EXT.test(url)) embeds.push({ kind: "audio", value: url });
      else if (yt) embeds.push({ kind: "youtube", value: yt });
    }
  }
  if (last < content.length) inline.push({ kind: "text", value: content.slice(last) });
  return { inline, embeds };
}

export function MessageContent({ content }: { content: string }) {
  if (!content) return null;
  const { inline, embeds } = parseMessage(content);
  return (
    <>
      <div style={{ whiteSpace: "pre-wrap" }}>
        {inline.map((t, i) => t.kind === "link"
          ? <a key={i} href={t.value} target="_blank" rel="noreferrer" style={{ color: C.accent2, textDecoration: "underline", wordBreak: "break-all" }}>{t.value}</a>
          : <span key={i}>{t.value}</span>)}
      </div>
      {embeds.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {embeds.map((e, i) => {
            if (e.kind === "image") return <img key={i} src={e.value} alt="" draggable={false} onClick={() => openLightbox(e.value)} onContextMenu={(ev) => ev.preventDefault()} style={{ ...embedImg, cursor: "zoom-in", WebkitTouchCallout: "none", userSelect: "none" }} />;
            if (e.kind === "video") return <video key={i} src={e.value} controls controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu={(ev) => ev.preventDefault()} style={embedMedia} />;
            if (e.kind === "audio") return <audio key={i} src={e.value} controls controlsList="nodownload" style={{ width: 260, marginTop: 6 }} />;
            return <iframe key={i} src={`https://www.youtube.com/embed/${e.value}`} title="YouTube"
              allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen style={{ ...embedMedia, aspectRatio: "16/9", border: "none" }} />;
          })}
        </div>
      )}
    </>
  );
}

const embedMedia: React.CSSProperties = { maxWidth: 280, width: "100%", borderRadius: 10, display: "block" };
const embedImg: React.CSSProperties = { maxWidth: 240, maxHeight: 240, borderRadius: 10, display: "block" };
