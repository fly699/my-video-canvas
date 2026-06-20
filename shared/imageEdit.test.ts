import { describe, it, expect } from "vitest";
import {
  IMAGE_EDIT_OPS,
  IMAGE_EDIT_MODEL_GROUPS,
  IMAGE_EDIT_MODELS,
  DEFAULT_IMAGE_EDIT_MODEL,
  getImageEditOp,
  buildImageEditInstruction,
} from "./imageEdit";
import { IMAGE_GEN_MODELS, type ImageEditOp } from "./types";

describe("IMAGE_EDIT_OPS catalog", () => {
  it("covers the 6 documented operations with unique ids", () => {
    const ids = IMAGE_EDIT_OPS.map((o) => o.id).sort();
    expect(ids).toEqual(["erase", "inpaint", "outpaint", "reframe", "relight", "remove_bg"]);
    expect(new Set(ids).size).toBe(6);
  });
  it("flags which ops need prompt / aspect / mask", () => {
    expect(getImageEditOp("inpaint")?.needsPrompt).toBe(true);
    expect(getImageEditOp("inpaint")?.needsMask).toBe(true);
    expect(getImageEditOp("outpaint")?.needsAspect).toBe(true);
    expect(getImageEditOp("reframe")?.needsAspect).toBe(true);
    expect(getImageEditOp("remove_bg")?.needsPrompt).toBe(false);
    expect(getImageEditOp("remove_bg")?.needsMask).toBe(false);
  });
});

describe("IMAGE_EDIT model allow-list", () => {
  it("every edit model is a real IMAGE_GEN_MODELS member (no typos/hallucinations)", () => {
    const valid = new Set<string>(IMAGE_GEN_MODELS);
    for (const m of IMAGE_EDIT_MODELS) expect(valid.has(m)).toBe(true);
  });
  it("the default model is itself edit-capable & a real model", () => {
    expect(IMAGE_EDIT_MODELS).toContain(DEFAULT_IMAGE_EDIT_MODEL);
    expect(new Set<string>(IMAGE_GEN_MODELS).has(DEFAULT_IMAGE_EDIT_MODEL)).toBe(true);
  });
  it("exposes all three cloud backends, each with at least one model", () => {
    const providers = IMAGE_EDIT_MODEL_GROUPS.map((g) => g.provider).sort();
    expect(providers).toEqual(["higgsfield", "kie", "poyo"]);
    for (const g of IMAGE_EDIT_MODEL_GROUPS) expect(g.models.length).toBeGreaterThan(0);
  });
  it("model values are unique across groups", () => {
    expect(new Set(IMAGE_EDIT_MODELS).size).toBe(IMAGE_EDIT_MODELS.length);
  });
});

describe("buildImageEditInstruction", () => {
  it("remove_bg keeps the subject and ignores empty prompt", () => {
    const s = buildImageEditInstruction("remove_bg");
    expect(s).toMatch(/remove the background/i);
    expect(s).toMatch(/subject/i);
    expect(s.trim()).toBe(s); // no trailing space from empty extra
  });
  it("outpaint embeds the target aspect ratio when provided", () => {
    expect(buildImageEditInstruction("outpaint", undefined, "16:9")).toMatch(/16:9 aspect ratio/);
    expect(buildImageEditInstruction("outpaint")).not.toMatch(/aspect ratio/);
  });
  it("reframe embeds the aspect ratio", () => {
    expect(buildImageEditInstruction("reframe", undefined, "9:16")).toMatch(/9:16 aspect ratio/);
  });
  it("inpaint/erase fold the user prompt into the instruction", () => {
    expect(buildImageEditInstruction("inpaint", "replace with a wooden door")).toMatch(/wooden door/);
    expect(buildImageEditInstruction("erase", "the person on the left")).toMatch(/person on the left/);
  });
  it("inpaint keeps the rest unchanged", () => {
    expect(buildImageEditInstruction("inpaint", "x")).toMatch(/unchanged/i);
  });
  it("relight changes only lighting and keeps content identical", () => {
    const s = buildImageEditInstruction("relight", "warm side light");
    expect(s).toMatch(/warm side light/);
    expect(s).toMatch(/identical/i);
  });
  it("produces a non-empty string for every op", () => {
    for (const op of IMAGE_EDIT_OPS) {
      expect(buildImageEditInstruction(op.id as ImageEditOp, "test").length).toBeGreaterThan(10);
    }
  });
});
