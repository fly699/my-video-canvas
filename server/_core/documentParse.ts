// ─────────────────────────────────────────────────────────────────────────────
// Document → plain-text extraction (pure JS, fully offline).
//
// WHY: the self-hosted Qwen vLLM endpoint is OpenAI-compatible but text-only — it
// cannot ingest a binary document (PDF/Word/PPT/Excel) the way the cloud gateways
// can via `file_url` parts. So before a message is dispatched to a self-hosted
// model we transparently parse any document attachment to text and inline it (see
// llm.ts → inlineDocumentsForSelfHosted). This module is the storage-agnostic core:
// it takes raw bytes + a filename/mime hint and returns extracted text.
//
// Stack (all pure-JS, zero native deps, no network at runtime):
//   - pdf            → unpdf (bundles a serverless pdfjs build)
//   - docx           → mammoth (raw text)
//   - pptx / xlsx    → fflate (unzip) + fast-xml-parser (OOXML)
//   - txt/md/csv     → utf-8 decode
//   - html           → utf-8 decode + tag strip
// ─────────────────────────────────────────────────────────────────────────────
import { extractText } from "unpdf";
import mammoth from "mammoth";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type DocKind = "pdf" | "docx" | "pptx" | "xlsx" | "text" | "csv" | "html";

// Cap extracted text so a giant document can't blow the model's context window (or
// our payload size). ~200k chars ≈ a large book chapter; plenty for context.
const MAX_TEXT_CHARS = 200_000;
// Refuse to parse absurdly large blobs (defensive — uploads are already size-capped
// upstream, but the parsers shouldn't be handed a 500MB buffer either).
const MAX_BYTES = 64 * 1024 * 1024;

const EXT_KIND: Record<string, DocKind> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  txt: "text", md: "text", markdown: "text", text: "text", log: "text", rtf: "text",
  csv: "csv", tsv: "csv",
  html: "html", htm: "html",
};

const MIME_KIND: Record<string, DocKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
  "text/html": "html",
};

/** Classify an attachment by mime first (authoritative), then filename extension. */
export function detectDocKind(filename?: string, mimeType?: string): DocKind | null {
  const mime = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (mime && MIME_KIND[mime]) return MIME_KIND[mime];
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  return null;
}

/** True when this attachment is a document we can parse to text (vs image/audio/video). */
export function isParsableDocument(filename?: string, mimeType?: string): boolean {
  return detectDocKind(filename, mimeType) !== null;
}

const clamp = (s: string): string =>
  s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + "\n…（文档内容过长，已截断）" : s;

const decodeEntities = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // last, so already-decoded text isn't double-processed

function parseHtml(text: string): string {
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|tr|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function parsePdf(data: Uint8Array): Promise<string> {
  const { text } = await extractText(data, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

async function parseDocx(data: Uint8Array): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return value;
}

// fast-xml-parser config for OOXML: keep attributes (xlsx needs the cell type `t`),
// keep namespace prefixes (slide text lives in `a:t`), inline text under `#text`.
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const textOf = (node: unknown): string =>
  typeof node === "string" || typeof node === "number" ? String(node)
    : node && typeof node === "object" && "#text" in node ? String((node as Record<string, unknown>)["#text"] ?? "") : "";

const slideOrder = (name: string): number => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

function parsePptx(data: Uint8Array): string {
  const files = unzipSync(data);
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideOrder(a) - slideOrder(b));
  const out: string[] = [];
  for (const name of slides) {
    // `<a:t>` runs hold all visible text; a flat regex is robust across the varied
    // shape/group nesting of slide XML (and decodes entities afterwards).
    const body = strFromU8(files[name]);
    const runs: string[] = [];
    const re = /<a:t>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) runs.push(decodeEntities(m[1]));
    const slideText = runs.join(" ").replace(/\s+/g, " ").trim();
    if (slideText) out.push(slideText);
  }
  return out.map((s, i) => `【幻灯片 ${i + 1}】${s}`).join("\n\n");
}

function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const raw = files["xl/sharedStrings.xml"];
  if (!raw) return [];
  const parsed = xml.parse(strFromU8(raw)) as { sst?: { si?: unknown } };
  return asArray(parsed.sst?.si).map((si) => {
    // <si> is either a single <t>…</t> or a sequence of <r><t>…</t></r> runs.
    const o = si as Record<string, unknown>;
    if ("t" in o) return textOf(o.t);
    return asArray(o.r as unknown).map((r) => textOf((r as Record<string, unknown>)?.t)).join("");
  });
}

function parseXlsx(data: Uint8Array): string {
  const files = unzipSync(data);
  const strings = sharedStrings(files);
  const sheets = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => slideOrder(a) - slideOrder(b));
  const out: string[] = [];
  for (const name of sheets) {
    const parsed = xml.parse(strFromU8(files[name])) as { worksheet?: { sheetData?: { row?: unknown } } };
    const rows = asArray(parsed.worksheet?.sheetData?.row);
    const lines: string[] = [];
    for (const row of rows) {
      const cells = asArray((row as Record<string, unknown>).c);
      const vals = cells.map((c) => {
        const cell = c as Record<string, unknown>;
        const t = cell["@_t"];
        if (t === "s") return strings[Number(textOf(cell.v))] ?? "";       // shared string index
        if (t === "inlineStr") return textOf((cell.is as Record<string, unknown>)?.t); // inline string
        return textOf(cell.v);                                              // number / literal
      });
      if (vals.some((v) => v !== "")) lines.push(vals.join("\t"));
    }
    if (lines.length) out.push(lines.join("\n"));
  }
  return out.join("\n\n");
}

/**
 * Extract plain text from a document buffer. Returns "" for an unrecognised type.
 * Never throws on a parse failure — returns a short marker so the caller can still
 * dispatch the message (the document just contributes no usable text).
 */
export async function parseDocumentToText(
  data: Uint8Array,
  opts: { filename?: string; mimeType?: string } = {},
): Promise<string> {
  const kind = detectDocKind(opts.filename, opts.mimeType);
  if (!kind) return "";
  if (data.byteLength > MAX_BYTES) return "（文档过大，已跳过解析）";
  try {
    switch (kind) {
      case "pdf": return clamp((await parsePdf(data)).trim());
      case "docx": return clamp((await parseDocx(data)).trim());
      case "pptx": return clamp(parsePptx(data).trim());
      case "xlsx": return clamp(parseXlsx(data).trim());
      case "html": return clamp(parseHtml(strFromU8(data)).trim());
      case "text":
      case "csv": return clamp(strFromU8(data).trim());
    }
  } catch (e) {
    return `（文档解析失败：${e instanceof Error ? e.message : String(e)}）`;
  }
}
