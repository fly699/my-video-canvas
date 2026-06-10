import { describe, it, expect } from "vitest";
import { sanitizeOperation } from "./_core/agentCatalog";

describe("agentCatalog.sanitizeOperation", () => {
  it("accepts a valid create op and filters unknown payload fields", () => {
    const op = sanitizeOperation({
      op: "create", tempId: "n1", nodeType: "prompt", title: "P",
      payload: { positivePrompt: "hi", bogusField: "x", style: "anime" },
      note: "why",
    });
    expect(op).not.toBeNull();
    expect(op!.op).toBe("create");
    expect(op!.nodeType).toBe("prompt");
    expect(op!.payload).toEqual({ positivePrompt: "hi", style: "anime" });
    expect((op!.payload as Record<string, unknown>).bogusField).toBeUndefined();
  });

  it("whitelists the storyboard shot-list fields (sceneNumber/dialogue/transition…)", () => {
    const op = sanitizeOperation({
      op: "create", tempId: "sb1", nodeType: "storyboard",
      payload: { sceneNumber: 3, description: "雨夜街头", dialogue: "阿明：站住！", transition: "match-cut", shotType: "CU", lighting: "霓虹侧光", sfx: "雨声", duration: 5, bogus: "x" },
    });
    expect(op).not.toBeNull();
    expect(op!.payload).toMatchObject({ sceneNumber: 3, dialogue: "阿明：站住！", transition: "match-cut", shotType: "CU", lighting: "霓虹侧光", sfx: "雨声" });
    expect((op!.payload as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("whitelists audio ttsText/musicPrompt", () => {
    const op = sanitizeOperation({ op: "create", nodeType: "audio", payload: { audioCategory: "music", musicPrompt: "轻快钢琴", ttsText: "旁白", junk: 1 } });
    expect(op).not.toBeNull();
    expect(op!.payload).toMatchObject({ audioCategory: "music", musicPrompt: "轻快钢琴", ttsText: "旁白" });
    expect((op!.payload as Record<string, unknown>).junk).toBeUndefined();
  });

  it("rejects a create op with an unknown/forbidden node type", () => {
    expect(sanitizeOperation({ op: "create", nodeType: "definitely_not_a_node", payload: {} })).toBeNull();
    // admin/niche types are not in the agent catalog → rejected
    expect(sanitizeOperation({ op: "create", nodeType: "voice_clone", payload: {} })).toBeNull();
  });

  it("accepts connect only with both refs", () => {
    expect(sanitizeOperation({ op: "connect", sourceRef: "n1", targetRef: "n2" })).not.toBeNull();
    expect(sanitizeOperation({ op: "connect", sourceRef: "n1" })).toBeNull();
  });

  it("accepts update/delete with a targetRef, rejects without", () => {
    expect(sanitizeOperation({ op: "update", targetRef: "abc", payload: { foo: 1 } })).not.toBeNull();
    expect(sanitizeOperation({ op: "delete", targetRef: "abc" })).not.toBeNull();
    expect(sanitizeOperation({ op: "delete" })).toBeNull();
  });

  it("rejects structurally invalid input", () => {
    expect(sanitizeOperation(null)).toBeNull();
    expect(sanitizeOperation({ op: "explode" })).toBeNull();
    expect(sanitizeOperation("nope")).toBeNull();
  });

  it("comfyOnly excludes generation + storyboard nodes", () => {
    for (const t of ["image_gen", "video_task", "audio", "comfyui_image", "comfyui_video", "storyboard"]) {
      expect(sanitizeOperation({ op: "create", nodeType: t, payload: {} }, { comfyOnly: true })).toBeNull();
    }
    // prompt + comfyui_workflow stay available in comfyOnly
    expect(sanitizeOperation({ op: "create", nodeType: "prompt", payload: { positivePrompt: "x" } }, { comfyOnly: true })).not.toBeNull();
  });

  it("hard-validates comfyui_workflow templateId against the analyzed set", () => {
    const validTemplateIds = new Set<number>([7]);
    // valid id → kept, prompts preserved
    const ok = sanitizeOperation(
      { op: "create", nodeType: "comfyui_workflow", payload: { templateId: 7, prompt: "p", negPrompt: "n" } },
      { comfyOnly: true, validTemplateIds },
    );
    expect(ok).not.toBeNull();
    expect((ok!.payload as Record<string, unknown>).templateId).toBe(7);
    // hallucinated id (not in set) → dropped in any mode
    expect(sanitizeOperation(
      { op: "create", nodeType: "comfyui_workflow", payload: { templateId: 999, prompt: "p" } },
      { validTemplateIds },
    )).toBeNull();
    // comfyOnly + missing templateId → dropped (empty shell otherwise)
    expect(sanitizeOperation(
      { op: "create", nodeType: "comfyui_workflow", payload: { prompt: "p" } },
      { comfyOnly: true, validTemplateIds },
    )).toBeNull();
  });
});
