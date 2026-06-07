import { describe, it, expect } from "vitest";
import { characterReferenceImages, characterHasConditioning, deriveCharacterConditioning, connectedCharacterRefImages } from "./characterConditioning";
import type { CharacterNodeData } from "../../../shared/types";

const char = (over: Partial<CharacterNodeData>): CharacterNodeData => ({ characterKind: "person", ...over });

describe("characterReferenceImages", () => {
  it("collects main + extra views, de-duped and trimmed", () => {
    expect(characterReferenceImages(char({ referenceImageUrl: "a.png", additionalImageUrls: ["b.png", "a.png", "  "] }))).toEqual(["a.png", "b.png"]);
    expect(characterReferenceImages(char({}))).toEqual([]);
  });
});

describe("characterHasConditioning", () => {
  it("true when there's a ref image or a LoRA", () => {
    expect(characterHasConditioning(char({ referenceImageUrl: "a.png" }))).toBe(true);
    expect(characterHasConditioning(char({ loraName: "hero.safetensors" }))).toBe(true);
    expect(characterHasConditioning(char({ name: "Bob" }))).toBe(false);
  });
});

describe("deriveCharacterConditioning", () => {
  it("fills IPAdapter images + weight when the node has none", () => {
    const p = deriveCharacterConditioning(char({ referenceImageUrl: "face.png", additionalImageUrls: ["side.png"], ipadapterWeight: 1.1 }), {});
    expect(p.ipadapter).toEqual({ model: "", imageUrl: "face.png", imageUrls: ["face.png", "side.png"], clipVision: undefined, weight: 1.1 });
  });

  it("preserves an existing IPAdapter model/clipVision/weight while filling images", () => {
    const p = deriveCharacterConditioning(char({ referenceImageUrl: "face.png" }), { ipadapter: { model: "ip-adapter.safetensors", imageUrl: "", clipVision: "clip_vision.safetensors", weight: 0.5 } });
    expect(p.ipadapter).toEqual({ model: "ip-adapter.safetensors", imageUrl: "face.png", imageUrls: ["face.png"], clipVision: "clip_vision.safetensors", weight: 0.5 });
  });

  it("does NOT touch IPAdapter when the node already has reference images (non-destructive)", () => {
    const p = deriveCharacterConditioning(char({ referenceImageUrl: "face.png" }), { ipadapter: { model: "m", imageUrl: "", imageUrls: ["user.png"] } });
    expect(p.ipadapter).toBeUndefined();
  });

  it("appends the character LoRA once, without duplicating", () => {
    const p1 = deriveCharacterConditioning(char({ loraName: "hero.safetensors", loraStrength: 0.7 }), { loras: [{ name: "style.safetensors", strengthModel: 1 }] });
    expect(p1.loras).toEqual([{ name: "style.safetensors", strengthModel: 1 }, { name: "hero.safetensors", strengthModel: 0.7 }]);

    const p2 = deriveCharacterConditioning(char({ loraName: "hero.safetensors" }), { loras: [{ name: "hero.safetensors", strengthModel: 1 }] });
    expect(p2.loras).toBeUndefined();
  });

  it("returns an empty patch for a text-only character", () => {
    expect(deriveCharacterConditioning(char({ name: "Bob", outfit: "suit" }), {})).toEqual({});
  });
});

describe("connectedCharacterRefImages", () => {
  const N = (id: string, nodeType: string, payload?: unknown) => ({ id, data: { nodeType, payload } });
  it("collects all views from connected character nodes (de-duped), ignoring non-characters", () => {
    const nodes = [
      N("c1", "character", { characterKind: "person", referenceImageUrl: "a.png", additionalImageUrls: ["b.png"] }),
      N("c2", "character", { characterKind: "person", referenceImageUrl: "b.png", additionalImageUrls: ["c.png"] }),
      N("p1", "prompt", { positivePrompt: "x" }),
      N("vt", "video_task", {}),
    ];
    const edges = [
      { source: "c1", target: "vt" },
      { source: "c2", target: "vt" },
      { source: "p1", target: "vt" },
    ];
    expect(connectedCharacterRefImages("vt", edges, nodes)).toEqual(["a.png", "b.png", "c.png"]);
  });
  it("returns [] when no character is connected", () => {
    const nodes = [N("a", "asset", { url: "x.png" })];
    expect(connectedCharacterRefImages("vt", [{ source: "a", target: "vt" }], nodes)).toEqual([]);
  });
  it("orders by position (topmost character is primary) regardless of edge order", () => {
    const P = (id: string, y: number, url: string) => ({ id, data: { nodeType: "character", payload: { characterKind: "person", referenceImageUrl: url } }, position: { x: 0, y } });
    const nodes = [P("low", 500, "low.png"), P("high", 100, "high.png"), N("vt", "video_task", {})];
    // edges list the low character first, but the higher (smaller y) wins priority
    const edges = [{ source: "low", target: "vt" }, { source: "high", target: "vt" }];
    expect(connectedCharacterRefImages("vt", edges, nodes)).toEqual(["high.png", "low.png"]);
  });
});
