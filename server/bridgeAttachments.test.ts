import { describe, it, expect } from "vitest";
import {
  collectImageUrls, collectFileUrls, parseDataUrl, normalizeImageMediaType, imageExt,
  resolveImage, resolveImages, docTextFromFileUrls, buildClaudeStreamJsonInput, parseClaudeStreamJsonResult,
  type BridgeMessage,
} from "./_core/bridgeAttachments";

const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("collectImageUrls / collectFileUrls", () => {
  const msgs: BridgeMessage[] = [
    { role: "system", content: "你是助手" },
    { role: "user", content: [
      { type: "text", text: "看图" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "file_url", file_url: { url: "data:application/pdf;base64,BBBB", mime_type: "application/pdf" } },
    ]},
    { role: "user", content: "纯文本，无附件" },
  ];
  it("抽出所有 image_url 与 file_url，纯文本消息不误伤", () => {
    expect(collectImageUrls(msgs)).toEqual(["data:image/png;base64,AAAA"]);
    expect(collectFileUrls(msgs)).toEqual([{ url: "data:application/pdf;base64,BBBB", mimeType: "application/pdf" }]);
  });
  it("字符串 content / 空消息 → 空数组", () => {
    expect(collectImageUrls([{ role: "user", content: "hi" }])).toEqual([]);
    expect(collectFileUrls([])).toEqual([]);
  });
});

describe("parseDataUrl", () => {
  it("base64 data URL → mediaType + 字节", () => {
    const r = parseDataUrl("data:image/png;base64," + png1x1)!;
    expect(r.mediaType).toBe("image/png");
    expect(r.bytes.byteLength).toBeGreaterThan(0);
  });
  it("非 base64（纯文本 data URL）也能解", () => {
    const r = parseDataUrl("data:text/plain,hello%20world")!;
    expect(r.mediaType).toBe("text/plain");
    expect(Buffer.from(r.bytes).toString("utf8")).toBe("hello world");
  });
  it("非 data: → null", () => {
    expect(parseDataUrl("https://x/y.png")).toBeNull();
  });
});

describe("normalizeImageMediaType / imageExt", () => {
  it("已是支持类型 → 原样；带参数截掉", () => {
    expect(normalizeImageMediaType("image/jpeg", "x")).toBe("image/jpeg");
    expect(normalizeImageMediaType("image/webp; charset=binary", "x")).toBe("image/webp");
  });
  it("未知类型 → 按扩展名推断", () => {
    expect(normalizeImageMediaType("application/octet-stream", "http://a/b.JPG?v=1")).toBe("image/jpeg");
    expect(normalizeImageMediaType(undefined, "b.gif")).toBe("image/gif");
  });
  it("都推断不出 → 兜底 png", () => {
    expect(normalizeImageMediaType(undefined, "no-ext")).toBe("image/png");
  });
  it("imageExt 映射", () => {
    expect(imageExt("image/jpeg")).toBe("jpg");
    expect(imageExt("image/png")).toBe("png");
    expect(imageExt("image/unknown")).toBe("png");
  });
});

describe("resolveImage（data: 路径，纯本地无网络）", () => {
  it("data:image base64 → { mediaType, base64 }", async () => {
    const r = await resolveImage("data:image/png;base64," + png1x1);
    expect(r).not.toBeNull();
    expect(r!.mediaType).toBe("image/png");
    expect(r!.base64).toBe(png1x1);
  });
  it("blob: / 空 → null", async () => {
    expect(await resolveImage("blob:xyz")).toBeNull();
    expect(await resolveImage("")).toBeNull();
  });
  it("resolveImages 保序 + 丢掉解析失败项", async () => {
    const rs = await resolveImages(["data:image/png;base64," + png1x1, "blob:bad", "data:image/gif;base64," + png1x1]);
    expect(rs.length).toBe(2);
    expect(rs[0].mediaType).toBe("image/png");
    expect(rs[1].mediaType).toBe("image/gif");
  });
});

describe("docTextFromFileUrls（file_url 文档兜底解析）", () => {
  it("data: 纯文本文档 → 解析成【文档内容】文本", async () => {
    const url = "data:text/plain;base64," + Buffer.from("发票金额 1234 元", "utf8").toString("base64");
    const t = await docTextFromFileUrls([{ url, mimeType: "text/plain" }]);
    expect(t).toContain("【文档内容】");
    expect(t).toContain("发票金额 1234 元");
  });
  it("不可解析类型 → 空串", async () => {
    const url = "data:application/zip;base64,AAAA";
    expect(await docTextFromFileUrls([{ url, mimeType: "application/zip" }])).toBe("");
  });
  it("无文档 → 空串", async () => {
    expect(await docTextFromFileUrls([])).toBe("");
  });
});

describe("buildClaudeStreamJsonInput", () => {
  it("生成单行 user 消息，含文本块 + 内联 base64 图片块", () => {
    const line = buildClaudeStreamJsonInput("描述这张图", [{ mediaType: "image/png", base64: "QUJD" }]);
    expect(line.endsWith("\n")).toBe(true);
    const obj = JSON.parse(line.trim());
    expect(obj.type).toBe("user");
    expect(obj.message.role).toBe("user");
    expect(obj.message.content[0]).toEqual({ type: "text", text: "描述这张图" });
    expect(obj.message.content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
  });
  it("空提示词 → 用默认文案兜底（避免只发图无指令）", () => {
    const obj = JSON.parse(buildClaudeStreamJsonInput("", [{ mediaType: "image/png", base64: "x" }]).trim());
    expect(obj.message.content[0].text).toContain("请分析");
  });
});

describe("parseClaudeStreamJsonResult", () => {
  it("多行 stream-json → 取末尾 result 行文本", () => {
    const out = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"部分"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"这是红色"}',
    ].join("\n");
    expect(parseClaudeStreamJsonResult(out)).toEqual({ text: "这是红色", isError: false });
  });
  it("result 标记错误 → isError true", () => {
    const out = '{"type":"result","subtype":"error","is_error":true,"result":"配额超限"}';
    expect(parseClaudeStreamJsonResult(out)).toEqual({ text: "配额超限", isError: true });
  });
  it("无 result 行 → 兜底用最后一条 assistant 文本", () => {
    const out = '{"type":"assistant","message":{"content":[{"type":"text","text":"兜底答案"}]}}';
    expect(parseClaudeStreamJsonResult(out)).toEqual({ text: "兜底答案", isError: false });
  });
  it("全空/无法解析 → isError true", () => {
    expect(parseClaudeStreamJsonResult("").isError).toBe(true);
    expect(parseClaudeStreamJsonResult("garbage\nlines").isError).toBe(true);
  });
});
