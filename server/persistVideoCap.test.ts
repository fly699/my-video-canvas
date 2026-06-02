import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { capStream } from "./_core/persistVideo";

// Collect a stream into a Buffer, or reject if the stream errors.
function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function srcFrom(parts: Buffer[]): Readable {
  return Readable.from((function* () { yield* parts; })());
}

describe("capStream", () => {
  it("passes data through unchanged when under the cap", async () => {
    const parts = [Buffer.alloc(100, 1), Buffer.alloc(100, 2)];
    const out = await collect(capStream(srcFrom(parts), 1000));
    expect(out.length).toBe(200);
  });

  it("errors once the cumulative size exceeds the cap", async () => {
    const parts = [Buffer.alloc(600), Buffer.alloc(600)]; // 1200 > 1000
    await expect(collect(capStream(srcFrom(parts), 1000))).rejects.toThrow(/exceeded/);
  });

  it("allows exactly the cap", async () => {
    const out = await collect(capStream(srcFrom([Buffer.alloc(1000)]), 1000));
    expect(out.length).toBe(1000);
  });
});
