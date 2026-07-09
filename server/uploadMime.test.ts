import { describe, expect, it } from "vitest";
import { isInlineExecutableMime, safeUploadMime } from "./_core/uploadMime";

describe("uploadMime guard", () => {
  it("flags inline-executable types (HTML/SVG/XML)", () => {
    for (const m of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "application/xml", "text/xml"]) {
      expect(isInlineExecutableMime(m)).toBe(true);
      expect(safeUploadMime(m)).toBe(false);
    }
  });

  it("allows normal media / document / binary types", () => {
    for (const m of ["image/png", "image/jpeg", "image/webp", "video/mp4", "audio/mpeg", "application/pdf", "application/octet-stream", "application/zip", "text/plain"]) {
      expect(isInlineExecutableMime(m)).toBe(false);
      expect(safeUploadMime(m)).toBe(true);
    }
  });

  it("handles empty / whitespace safely", () => {
    expect(isInlineExecutableMime("")).toBe(false);
    expect(isInlineExecutableMime(undefined)).toBe(false);
    expect(isInlineExecutableMime("  image/svg+xml  ")).toBe(true);
  });
});
