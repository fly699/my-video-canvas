// Pure helpers for importing ComfyUI workflows from files (drag/drop or picker):
//  - detect whether a parsed JSON is API format (runnable: {id:{class_type,inputs}})
//    or UI format (the editor graph: {nodes,links,...});
//  - extract the workflow(s) embedded in a ComfyUI-saved PNG (tEXt/iTXt chunks
//    "prompt" = API format, "workflow" = UI format).
// No DOM/network; fully unit-testable. The node uses these, then feeds the runnable
// API JSON into the EXISTING analyze flow (auto-expose params) — nothing else changes.

export type WorkflowFormat = "api" | "ui" | "unknown";

/** Classify a parsed workflow object. */
export function detectWorkflowFormat(obj: unknown): WorkflowFormat {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "unknown";
  const o = obj as Record<string, unknown>;
  // UI graph format: a nodes array, plus links / last_node_id markers.
  if (Array.isArray(o.nodes) && ("links" in o || "last_node_id" in o || "version" in o)) return "ui";
  // API (prompt) format: a map of node-id → { class_type, inputs }.
  const vals = Object.values(o);
  if (vals.length > 0 && vals.every((v) => !!v && typeof v === "object" && !Array.isArray(v) && "class_type" in (v as Record<string, unknown>))) {
    return "api";
  }
  return "unknown";
}

// ── 智能匹配：把工作流里「服务器上不存在的取值」自动映射到最相近的真实选项 ─────────
// 典型场景：模型文件名因目录前缀/大小写/版本后缀/扩展名不同而对不上（如
// "SDXL/sd_xl_base_1.0.safetensors" vs 服务器上的 "sd_xl_base_1.0.safetensors"）。
// 纯函数、可单测；返回最佳候选与一个 0-1 的置信度分。

/** 归一化：取 basename（去路径）、去扩展名、转小写、非字母数字折叠为空。 */
function normName(s: string): string {
  const base = s.split(/[\\/]/).pop() ?? s;
  const noExt = base.replace(/\.[a-z0-9]+$/i, "");
  return noExt.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** 两字符串的相似度 0-1：归一化后用 (最长公共子串 / 较长串长度)，并对完全相等/
 *  互为子串给高分。轻量、无依赖，足够给模型/枚举名排序。 */
export function nameSimilarity(a: string, b: string): number {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (long.includes(short)) return 0.9 * (short.length / long.length) + 0.1;
  // 最长公共子串长度
  let best = 0;
  const prev = new Array(short.length + 1).fill(0);
  for (let i = 1; i <= long.length; i++) {
    let diagPrev = 0;
    for (let j = 1; j <= short.length; j++) {
      const tmp = prev[j];
      if (long[i - 1] === short[j - 1]) { prev[j] = diagPrev + 1; if (prev[j] > best) best = prev[j]; }
      else prev[j] = 0;
      diagPrev = tmp;
    }
  }
  return best / long.length;
}

/** 从候选选项里挑与 current 最相近的一个；低于阈值返回 null（不瞎猜）。 */
export function suggestBestMatch(current: string, options: string[], threshold = 0.45): { value: string; score: number } | null {
  let best: { value: string; score: number } | null = null;
  for (const o of options) {
    const score = nameSimilarity(current, o);
    if (!best || score > best.score) best = { value: o, score };
  }
  return best && best.score >= threshold ? best : null;
}


function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function utf8(bytes: Uint8Array, start: number, end: number): string {
  try { return new TextDecoder("utf-8").decode(bytes.subarray(start, end)); }
  catch { return latin1(bytes, start, end); }
}

/**
 * Parse a PNG's textual metadata chunks (tEXt + uncompressed iTXt) into a
 * keyword→text map. Returns {} for non-PNG input. CRCs are not validated (we only
 * read metadata). Compressed zTXt / compressed iTXt are skipped.
 */
export function parsePngTextChunks(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8) return out;
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return out;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p); p += 4;
    const type = latin1(bytes, p, p + 4); p += 4;
    const dataStart = p;
    const dataEnd = dataStart + len;
    if (dataEnd > bytes.length) break; // malformed
    if (type === "tEXt") {
      let z = dataStart;
      while (z < dataEnd && bytes[z] !== 0) z++;
      out[latin1(bytes, dataStart, z)] = latin1(bytes, z + 1, dataEnd);
    } else if (type === "iTXt") {
      let z = dataStart;
      while (z < dataEnd && bytes[z] !== 0) z++;
      const keyword = latin1(bytes, dataStart, z);
      const compressionFlag = bytes[z + 1];
      // z+2 = compression method; then language-tag\0, translated-keyword\0, text
      let q = z + 3;
      while (q < dataEnd && bytes[q] !== 0) q++; q++; // language tag
      while (q < dataEnd && bytes[q] !== 0) q++; q++; // translated keyword
      if (compressionFlag === 0 && q <= dataEnd) out[keyword] = utf8(bytes, q, dataEnd);
    }
    p = dataEnd + 4; // skip data + 4-byte CRC
    if (type === "IEND") break;
  }
  return out;
}

/** Pull the API-format ("prompt") and/or UI-format ("workflow") graphs embedded in
 *  a ComfyUI PNG. Either may be undefined. */
export function extractComfyWorkflowsFromPng(bytes: Uint8Array): { promptApi?: unknown; workflowUi?: unknown } {
  const chunks = parsePngTextChunks(bytes);
  const tryParse = (s?: string): unknown => { if (!s) return undefined; try { return JSON.parse(s); } catch { return undefined; } };
  return { promptApi: tryParse(chunks["prompt"]), workflowUi: tryParse(chunks["workflow"]) };
}
