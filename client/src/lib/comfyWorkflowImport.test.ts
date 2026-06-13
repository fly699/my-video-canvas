import { describe, it, expect } from "vitest";
import { detectWorkflowFormat, parsePngTextChunks, extractComfyWorkflowsFromPng, nameSimilarity, suggestBestMatch } from "./comfyWorkflowImport";

describe("nameSimilarity / suggestBestMatch", () => {
  it("matches across path prefix / extension / case differences", () => {
    const opts = ["sd_xl_base_1.0.safetensors", "sd_xl_refiner_1.0.safetensors", "v1-5-pruned.ckpt"];
    expect(suggestBestMatch("SDXL/sd_xl_base_1.0.safetensors", opts)?.value).toBe("sd_xl_base_1.0.safetensors");
    expect(suggestBestMatch("sd_xl_base_1.0", opts)?.value).toBe("sd_xl_base_1.0.safetensors");
  });
  it("picks the closer of two similar options", () => {
    const opts = ["dreamshaper_8.safetensors", "dreamshaperXL_v21.safetensors"];
    expect(suggestBestMatch("dreamshaper_8", opts)?.value).toBe("dreamshaper_8.safetensors");
  });
  it("returns null when nothing is close enough", () => {
    expect(suggestBestMatch("totally_unrelated_xyz", ["abc.safetensors", "def.ckpt"])).toBeNull();
  });
  it("similarity is 1 for identical normalized names, 0 for empty", () => {
    expect(nameSimilarity("a/b/Model.SAFETENSORS", "model.safetensors")).toBe(1);
    expect(nameSimilarity("", "x")).toBe(0);
  });
});

describe("detectWorkflowFormat", () => {
  it("detects API (prompt) format", () => {
    expect(detectWorkflowFormat({ "3": { class_type: "KSampler", inputs: {} }, "4": { class_type: "CheckpointLoaderSimple", inputs: {} } })).toBe("api");
  });
  it("detects UI (graph) format", () => {
    expect(detectWorkflowFormat({ last_node_id: 9, nodes: [{ id: 1, type: "KSampler" }], links: [] })).toBe("ui");
  });
  it("returns unknown for arbitrary / empty objects", () => {
    expect(detectWorkflowFormat({ foo: 1 })).toBe("unknown");
    expect(detectWorkflowFormat([])).toBe("unknown");
    expect(detectWorkflowFormat(null)).toBe("unknown");
  });
});

/** Build a minimal PNG (signature + one tEXt chunk + IEND); CRCs are dummy. */
function makePngWithText(keyword: string, text: string): Uint8Array {
  const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const data = [...enc(keyword), 0, ...enc(text)];
  const lenBytes = [(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255];
  const chunk = [...lenBytes, ...enc("tEXt"), ...data, 0, 0, 0, 0];
  const iend = [0, 0, 0, 0, ...enc("IEND"), 0, 0, 0, 0];
  return new Uint8Array([...sig, ...chunk, ...iend]);
}

describe("parsePngTextChunks / extractComfyWorkflowsFromPng", () => {
  it("reads a tEXt chunk", () => {
    const png = makePngWithText("prompt", '{"3":{"class_type":"KSampler","inputs":{}}}');
    const chunks = parsePngTextChunks(png);
    expect(chunks["prompt"]).toContain("KSampler");
  });
  it("returns {} for non-PNG bytes", () => {
    expect(parsePngTextChunks(new Uint8Array([1, 2, 3]))).toEqual({});
  });
  it("extracts the embedded API prompt graph", () => {
    const png = makePngWithText("prompt", '{"3":{"class_type":"KSampler","inputs":{"seed":42}}}');
    const { promptApi } = extractComfyWorkflowsFromPng(png);
    expect(detectWorkflowFormat(promptApi)).toBe("api");
    expect((promptApi as Record<string, { inputs: { seed: number } }>)["3"].inputs.seed).toBe(42);
  });
});
