import { describe, it, expect } from "vitest";
import { GRID_PRESETS, getGridPreset, gridCellCount, buildGridPrompt } from "./grid";

describe("GRID_PRESETS", () => {
  it("exposes the 4 documented presets with unique ids", () => {
    const ids = GRID_PRESETS.map((p) => p.id).sort();
    expect(ids).toEqual(["grid25", "grid9", "plot4", "turnaround"]);
    expect(new Set(ids).size).toBe(4);
  });
  it("cell count = rows*cols and stays within the 64 slice cap", () => {
    expect(gridCellCount(getGridPreset("grid9")!)).toBe(9);
    expect(gridCellCount(getGridPreset("grid25")!)).toBe(25);
    expect(gridCellCount(getGridPreset("turnaround")!)).toBe(3);
    expect(gridCellCount(getGridPreset("plot4")!)).toBe(4);
    for (const p of GRID_PRESETS) expect(p.rows * p.cols).toBeLessThanOrEqual(64);
  });
  it("rows/cols are positive integers and sheetAspect is set", () => {
    for (const p of GRID_PRESETS) {
      expect(Number.isInteger(p.rows) && p.rows >= 1).toBe(true);
      expect(Number.isInteger(p.cols) && p.cols >= 1).toBe(true);
      expect(p.sheetAspect).toMatch(/^\d+:\d+$/);
    }
  });
});

describe("buildGridPrompt", () => {
  it("prepends the subject to the preset suffix", () => {
    const p = getGridPreset("grid9")!;
    const out = buildGridPrompt("a lone astronaut on Mars", p);
    expect(out).toMatch(/^a lone astronaut on Mars, /);
    expect(out).toContain("3x3 storyboard grid");
  });
  it("falls back to the suffix alone when subject is empty/blank", () => {
    const p = getGridPreset("plot4")!;
    expect(buildGridPrompt("", p)).toBe(p.promptSuffix);
    expect(buildGridPrompt("   ", p)).toBe(p.promptSuffix);
  });
});

describe("getGridPreset", () => {
  it("returns undefined for unknown ids", () => {
    expect(getGridPreset("nope")).toBeUndefined();
    expect(getGridPreset(undefined)).toBeUndefined();
  });
});
