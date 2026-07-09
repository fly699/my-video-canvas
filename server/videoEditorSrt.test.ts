import { describe, expect, it } from "vitest";
import { generateSRT } from "./_core/videoEditor";

// Guards the SRT millisecond-carry fix: values whose fractional part rounds to 1000ms must
// carry into seconds/minutes/hours instead of emitting an illegal 4-digit ",1000" time code.
describe("generateSRT time codes", () => {
  it("carries 59.9997s to 00:01:00,000 (not 00:00:59,1000)", () => {
    const srt = generateSRT([{ start: 59.9997, end: 61, text: "hi" }]);
    expect(srt).toContain("00:01:00,000 --> 00:01:01,000");
    expect(srt).not.toMatch(/,\d{4}/); // never a 4-digit millisecond field
  });

  it("carries across minute and hour boundaries", () => {
    expect(generateSRT([{ start: 3599.9999, end: 3600, text: "x" }])).toContain("01:00:00,000 --> 01:00:00,000");
  });

  it("formats a normal mid-range time correctly", () => {
    expect(generateSRT([{ start: 5.25, end: 7.5, text: "y" }])).toContain("00:00:05,250 --> 00:00:07,500");
  });

  it("clamps negatives to zero", () => {
    expect(generateSRT([{ start: -0.001, end: 1, text: "z" }])).toContain("00:00:00,000 --> 00:00:01,000");
  });
});
