import { describe, it, expect } from "vitest";
import { parseComfyPreviewFrame } from "./_core/comfyui";

// Phase 3: WS binary preview frame → data: URL.
function frame(eventType: number, imageType: number, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(eventType, 0);
  head.writeUInt32BE(imageType, 4);
  return Buffer.concat([head, body]);
}

describe("parseComfyPreviewFrame", () => {
  it("decodes a JPEG preview frame (eventType=1, imageType=1)", () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);
    const url = parseComfyPreviewFrame(frame(1, 1, body));
    expect(url).toBe(`data:image/jpeg;base64,${body.toString("base64")}`);
  });

  it("decodes a PNG preview frame (imageType=2)", () => {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const url = parseComfyPreviewFrame(frame(1, 2, body));
    expect(url).toBe(`data:image/png;base64,${body.toString("base64")}`);
  });

  it("ignores non-preview event types and undersized frames", () => {
    expect(parseComfyPreviewFrame(frame(2, 1, Buffer.from([1, 2, 3])))).toBeNull();
    expect(parseComfyPreviewFrame(Buffer.from([0, 0, 0, 1]))).toBeNull(); // header only, no body
  });
});
