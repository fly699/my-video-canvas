import { describe, it, expect } from "vitest";
import { parseMessage } from "@/components/chat/MessageContent";

const imgEmbeds = (c: string) => parseMessage(c).embeds.filter((e) => e.kind === "image").map((e) => e.value);
const inlineText = (c: string) => parseMessage(c).inline.filter((t) => t.kind === "text").map((t) => t.value).join("");

describe("parseMessage —— 聊天正文图片/媒体解析", () => {
  it("Markdown 图 ![](url) → 图片内嵌，且正文里不留原始语法", () => {
    const c = "给你生成好了：\n![结果](https://cdn.x/abc123?sig=xx)\n满意吗";
    expect(imgEmbeds(c)).toEqual(["https://cdn.x/abc123?sig=xx"]);
    expect(inlineText(c)).not.toContain("![");
    expect(inlineText(c)).toContain("满意吗");
  });
  it("data:image;base64 内联 → 图片内嵌（此前完全不显示）", () => {
    const c = "结果：data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    expect(imgEmbeds(c)).toEqual(["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="]);
  });
  it("Markdown 图 + data:image url → 也认", () => {
    expect(imgEmbeds("![](data:image/gif;base64,AAAA)")).toEqual(["data:image/gif;base64,AAAA"]);
  });
  it("带后缀的普通图片直链 → 链接 + 图片内嵌", () => {
    const r = parseMessage("看这张 https://s3.x/pic.png 图");
    expect(r.embeds.map((e) => e.value)).toEqual(["https://s3.x/pic.png"]);
    expect(r.inline.some((t) => t.kind === "link" && t.value === "https://s3.x/pic.png")).toBe(true);
  });
  it("无后缀普通链接 → 只当链接，不当图片（保持原行为）", () => {
    const r = parseMessage("参考 https://example.com/page");
    expect(r.embeds).toEqual([]);
    expect(r.inline.some((t) => t.kind === "link")).toBe(true);
  });
  it("视频/YouTube 分类", () => {
    expect(parseMessage("https://x/y.mp4").embeds[0]).toEqual({ kind: "video", value: "https://x/y.mp4" });
    expect(parseMessage("https://youtu.be/dQw4w9WgXcQ").embeds[0]).toEqual({ kind: "youtube", value: "dQw4w9WgXcQ" });
  });
  it("纯文本无媒体 → 无内嵌", () => {
    expect(parseMessage("就是一段普通文字").embeds).toEqual([]);
  });
});
