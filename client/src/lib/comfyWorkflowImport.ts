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
