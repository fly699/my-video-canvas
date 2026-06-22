import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { zipSync, strToU8 } from "fflate";
import { parseDocumentToText, detectDocKind, isParsableDocument } from "./_core/documentParse";

// Document → text extraction for the text-only self-hosted Qwen vLLM endpoint.
// OOXML (pptx/xlsx) is synthesised here with fflate so the test is hermetic; docx
// uses mammoth's bundled fixture; pdf is a minimal hand-built file pdfjs recovers.

const mkPptx = () =>
  zipSync({
    "ppt/slides/slide1.xml": strToU8(
      `<?xml version="1.0"?><p:sld xmlns:a="x"><a:t>第一页标题</a:t><a:t>要点 A &amp; B</a:t></p:sld>`,
    ),
    "ppt/slides/slide2.xml": strToU8(`<?xml version="1.0"?><p:sld xmlns:a="x"><a:t>第二页</a:t></p:sld>`),
  });

const mkXlsx = () =>
  zipSync({
    "xl/sharedStrings.xml": strToU8(
      `<?xml version="1.0"?><sst><si><t>姓名</t></si><si><t>分数</t></si><si><t>张三</t></si></sst>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>` +
        `<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>` +
        `<row><c t="s"><v>2</v></c><c><v>95</v></c></row>` +
        `</sheetData></worksheet>`,
    ),
  });

const MINI_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 48>>stream
BT /F1 20 Tf 20 100 Td (Hello PDF World) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`;

describe("detectDocKind / isParsableDocument", () => {
  it("按 mime 优先、扩展名兜底分类", () => {
    expect(detectDocKind("a.pdf", "application/pdf")).toBe("pdf");
    expect(detectDocKind("a.docx", "")).toBe("docx");
    expect(detectDocKind("ignore", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
    expect(detectDocKind("notes.md", "")).toBe("text");
  });
  it("非文档类型返回 null / false", () => {
    expect(detectDocKind("a.png", "image/png")).toBeNull();
    expect(isParsableDocument("a.mp4", "video/mp4")).toBe(false);
    expect(isParsableDocument("a.pptx", "")).toBe(true);
  });
});

describe("parseDocumentToText", () => {
  it("纯文本 / csv 原样解码", async () => {
    expect(await parseDocumentToText(strToU8("第一行\n第二行"), { filename: "a.txt" })).toBe("第一行\n第二行");
    expect(await parseDocumentToText(strToU8("h1,h2\n1,2"), { filename: "a.csv", mimeType: "text/csv" })).toBe("h1,h2\n1,2");
  });

  it("html 去标签 + 解实体 + 丢弃 script", async () => {
    const out = await parseDocumentToText(
      strToU8("<h1>标题</h1><p>段落&amp;文本</p><script>x=1</script>"),
      { filename: "a.html", mimeType: "text/html" },
    );
    expect(out).toContain("标题");
    expect(out).toContain("段落&文本");
    expect(out).not.toContain("x=1");
  });

  it("pptx 按幻灯片抽取 a:t 文本", async () => {
    const out = await parseDocumentToText(mkPptx(), { filename: "a.pptx" });
    expect(out).toContain("【幻灯片 1】第一页标题 要点 A & B");
    expect(out).toContain("【幻灯片 2】第二页");
  });

  it("xlsx 解析共享字符串 + 数值字面量，制表分隔", async () => {
    const out = await parseDocumentToText(mkXlsx(), { filename: "a.xlsx" });
    expect(out).toBe("姓名\t分数\n张三\t95");
  });

  it("docx 抽取正文纯文本（mammoth fixture）", async () => {
    const docx = readFileSync(
      "node_modules/.pnpm/mammoth@1.12.0/node_modules/mammoth/test/test-data/single-paragraph.docx",
    );
    const out = await parseDocumentToText(new Uint8Array(docx), { filename: "a.docx" });
    expect(out).toBe("Walking on imported air");
  });

  it("pdf 抽取文本（pdfjs 容错恢复）", async () => {
    const out = await parseDocumentToText(strToU8(MINI_PDF), { filename: "a.pdf", mimeType: "application/pdf" });
    expect(out).toContain("Hello PDF World");
  });

  it("未识别类型返回空串", async () => {
    expect(await parseDocumentToText(strToU8("x"), { filename: "a.png", mimeType: "image/png" })).toBe("");
  });

  it("损坏的 office 文件不抛异常，返回失败标记", async () => {
    const out = await parseDocumentToText(strToU8("not a real zip"), { filename: "a.docx" });
    expect(out).toContain("文档解析失败");
  });
});
