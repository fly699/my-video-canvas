import { describe, it, expect } from "vitest";
import { sanitizeOperation, sanitizeOperationDetailed } from "./_core/agentCatalog";

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

  it("update 也拦幻觉 templateId：非法值被剥掉、合法值与其它字段保留（与 create 对称）", () => {
    const validTemplateIds = new Set<number>([7]);
    // 幻觉 templateId=999 被剥掉，但同批合法字段（prompt）保留
    const bad = sanitizeOperation(
      { op: "update", targetRef: "cw1", payload: { templateId: 999, prompt: "改了提示词" } },
      { validTemplateIds },
    );
    expect(bad).not.toBeNull();
    const bp = bad!.payload as Record<string, unknown>;
    expect(bp.templateId).toBeUndefined();     // 非法模板被拦
    expect(bp.prompt).toBe("改了提示词");        // 合法改动保留
    // 合法 templateId=7 → 保留（正常换模板）
    const good = sanitizeOperation(
      { op: "update", targetRef: "cw1", payload: { templateId: 7 } },
      { validTemplateIds },
    );
    expect((good!.payload as Record<string, unknown>).templateId).toBe(7);
    // 未提供 validTemplateIds 时不校验（保持原有宽松行为）
    const nogate = sanitizeOperation({ op: "update", targetRef: "cw1", payload: { templateId: 999 } });
    expect((nogate!.payload as Record<string, unknown>).templateId).toBe(999);
  });
});

describe("agentCatalog.sanitizeOperationDetailed", () => {
  it("kept op returns { op }", () => {
    const r = sanitizeOperationDetailed({ op: "create", nodeType: "prompt", payload: { positivePrompt: "x" } });
    expect("op" in r).toBe(true);
    if ("op" in r) expect(r.op.nodeType).toBe("prompt");
  });

  it("unknown node type → drop reason names the type", () => {
    const r = sanitizeOperationDetailed({ op: "create", nodeType: "definitely_not_a_node", payload: {} });
    expect("drop" in r).toBe(true);
    if ("drop" in r) expect(r.drop).toContain("definitely_not_a_node");
  });

  it("comfyOnly excluded node → drop reason mentions ComfyUI", () => {
    const r = sanitizeOperationDetailed({ op: "create", nodeType: "video_task", payload: {} }, { comfyOnly: true });
    expect("drop" in r && r.drop.includes("ComfyUI")).toBe(true);
  });

  it("fabricated template id → drop reason names the id", () => {
    const r = sanitizeOperationDetailed(
      { op: "create", nodeType: "comfyui_workflow", payload: { templateId: 999, prompt: "p" } },
      { validTemplateIds: new Set<number>([7]) },
    );
    expect("drop" in r && r.drop.includes("999")).toBe(true);
  });

  it("malformed connect / missing op → drop", () => {
    expect("drop" in sanitizeOperationDetailed({ op: "connect", sourceRef: "n1" })).toBe(true);
    expect("drop" in sanitizeOperationDetailed(null)).toBe(true);
    expect("drop" in sanitizeOperationDetailed({ op: "explode" })).toBe(true);
  });

  it("stays consistent with sanitizeOperation (kept ⇔ non-null)", () => {
    const inputs = [
      { op: "create", nodeType: "prompt", payload: { positivePrompt: "x" } },
      { op: "create", nodeType: "bogus", payload: {} },
      { op: "connect", sourceRef: "a", targetRef: "b" },
      { op: "delete" },
      null,
    ];
    for (const i of inputs) {
      const detailed = sanitizeOperationDetailed(i);
      const plain = sanitizeOperation(i);
      expect("op" in detailed).toBe(plain !== null);
    }
  });
});

// ── 审计修复：video_task 反向词 + update 字段并集过滤 ──────────────────────────
describe("agentCatalog 审计修复", () => {
  it("video_task create 现在允许 negativePrompt", () => {
    const op = sanitizeOperation({ op: "create", nodeType: "video_task", payload: { prompt: "海浪翻涌", negativePrompt: "模糊, 噪点" } });
    expect(op).not.toBeNull();
    expect(op!.payload).toMatchObject({ prompt: "海浪翻涌", negativePrompt: "模糊, 噪点" });
  });

  it("update 并集过滤：保留任一节点 spec 字段 + customBaseUrl，丢弃幻觉字段", () => {
    const op = sanitizeOperation({
      op: "update", targetRef: "node1",
      payload: { promptText: "改写", synopsis: "梗概", customBaseUrl: "http://gpu:8188", __hack: "x", bogusField: 1 },
    });
    expect(op).not.toBeNull();
    expect(op!.payload).toEqual({ promptText: "改写", synopsis: "梗概", customBaseUrl: "http://gpu:8188" });
    expect((op!.payload as Record<string, unknown>).__hack).toBeUndefined();
    expect((op!.payload as Record<string, unknown>).bogusField).toBeUndefined();
  });

  it("update 全是幻觉字段 → payload 清空（但 op 仍保留）", () => {
    const op = sanitizeOperation({ op: "update", targetRef: "n", payload: { foo: 1, bar: 2 } });
    expect(op).not.toBeNull();
    expect(op!.payload).toEqual({});
  });

  it("update 缺 targetRef → 丢", () => {
    expect(sanitizeOperation({ op: "update", payload: { prompt: "x" } })).toBeNull();
  });

  it("comfyui_workflow create 现在允许 aspectRatio / overrideRatioSize（LLM 可结构化设工作流比例）", () => {
    const op = sanitizeOperation({
      op: "create", nodeType: "comfyui_workflow",
      payload: { templateId: 7, prompt: "p", aspectRatio: "9:16", overrideRatioSize: true },
    }, { validTemplateIds: new Set([7]) });
    expect(op).not.toBeNull();
    expect(op!.payload).toMatchObject({ aspectRatio: "9:16", overrideRatioSize: true });
  });
});
