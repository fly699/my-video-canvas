import { describe, expect, it } from "vitest";
import { collectNodeImageUrls } from "./routers/canvas";

describe("collectNodeImageUrls", () => {
  it("collects image URLs across node shapes and dedupes", () => {
    const nodes = [
      { data: { generatedImageUrl: "/manus-storage/generated/a_1234.png" } },
      { data: { payload: { referenceImageUrl: "https://cdn.example.com/x.jpg?token=1" } } },
      { data: { shots: [{ imageUrl: "/manus-storage/b_5678.webp" }, { imageUrl: "/manus-storage/b_5678.webp" }] } },
    ];
    const urls = collectNodeImageUrls(nodes);
    expect(urls).toContain("/manus-storage/generated/a_1234.png");
    expect(urls).toContain("https://cdn.example.com/x.jpg?token=1");
    expect(urls.filter((u) => u === "/manus-storage/b_5678.webp")).toHaveLength(1);
  });
  it("ignores videos and non-image strings", () => {
    const nodes = [
      { data: { resultVideoUrl: "/manus-storage/v_1.mp4", url: "/manus-storage/clip_2.mp4", prompt: "a cat" } },
    ];
    expect(collectNodeImageUrls(nodes)).toHaveLength(0);
  });
  it("accepts a poster/cover keyed URL without an image extension", () => {
    const nodes = [{ data: { posterUrl: "https://x.com/p/abc" } }];
    expect(collectNodeImageUrls(nodes)).toContain("https://x.com/p/abc");
  });
  it("skips oversized base64 but keeps small data:image", () => {
    const big = "data:image/png;base64," + "A".repeat(700_000);
    const small = "data:image/png;base64,AAAA";
    expect(collectNodeImageUrls([{ data: { a: big, b: small } }])).toEqual([small]);
  });
});
