import { describe, it, expect } from "vitest";
import { sanitizeOperation, sanitizeOperationDetailed, catalogText } from "./_core/agentCatalog";

describe("agentCatalog super_agent 门控（画布助手驱动工程智能体·A阶段）", () => {
  it("catalogText 默认不含 super_agent；allowSuperAgent 时才列出", () => {
    expect(catalogText()).not.toContain("super_agent");
    const withSA = catalogText({ allowSuperAgent: true });
    expect(withSA).toContain("super_agent");
    expect(withSA).toContain("工程智能体");
  });

  it("无权限：super_agent create 被丢弃", () => {
    expect(sanitizeOperation({ op: "create", nodeType: "super_agent", payload: { task: "搭一个 flux 出图工作流", autoRun: true } })).toBeNull();
    const d = sanitizeOperationDetailed({ op: "create", nodeType: "super_agent", payload: { task: "x" } });
    expect("drop" in d).toBe(true);
  });

  it("有权限：super_agent create 通过，白名单保留 task/autoRun/useMemory，丢弃幻觉字段", () => {
    const op = sanitizeOperation(
      { op: "create", tempId: "sa1", nodeType: "super_agent", payload: { task: "搭一个 flux+lora 高清出图工作流", autoRun: true, useMemory: false, maxIterations: 30, bogus: 1 } },
      { allowSuperAgent: true },
    );
    expect(op).not.toBeNull();
    expect(op!.nodeType).toBe("super_agent");
    expect(op!.payload).toMatchObject({ task: "搭一个 flux+lora 高清出图工作流", autoRun: true, useMemory: false, maxIterations: 30 });
    expect((op!.payload as Record<string, unknown>).bogus).toBeUndefined();
  });
});

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

  // video_task.params 数值夹取：越界 duration 夹到模型 [min,max]（合并短镜可能设超上限）
  it("video_task.params：越界 duration 夹到模型范围，越界键内、幻觉键丢弃", () => {
    const r = sanitizeOperationDetailed({
      op: "create", nodeType: "video_task",
      payload: { provider: "kie_grok_i2v", params: { duration: 35, bogus_key: "x" } },
    });
    expect("op" in r).toBe(true);
    if ("op" in r) {
      const params = (r.op.payload as { params?: Record<string, unknown> }).params ?? {};
      expect(params.duration).toBe(30);       // grok i2v 上限 30
      expect("bogus_key" in params).toBe(false); // 幻觉键丢弃
    }
  });

  it("video_task.params：偏低 duration 夹到下限，范围内值原样保留", () => {
    const low = sanitizeOperationDetailed({
      op: "create", nodeType: "video_task", payload: { provider: "kie_grok_i2v", params: { duration: 2 } },
    });
    if ("op" in low) expect((low.op.payload as { params?: { duration?: number } }).params?.duration).toBe(6); // 下限 6
    const ok = sanitizeOperationDetailed({
      op: "create", nodeType: "video_task", payload: { provider: "kie_grok_i2v", params: { duration: 18 } },
    });
    if ("op" in ok) expect((ok.op.payload as { params?: { duration?: number } }).params?.duration).toBe(18); // 范围内不动
  });

  it("video_task.params：非法枚举丢弃（回退默认），合法枚举保留", () => {
    const r = sanitizeOperationDetailed({
      op: "create", nodeType: "video_task",
      payload: { provider: "kie_grok_i2v", params: { resolution: "8K", mode: "normal" } },
    });
    if ("op" in r) {
      const params = (r.op.payload as { params?: Record<string, unknown> }).params ?? {};
      expect("resolution" in params).toBe(false); // 8K 非 grok 合法档（480p/720p）→ 丢弃回退默认
      expect(params.mode).toBe("normal");         // 合法枚举保留
    }
  });

  // #112 画布级动作：合法 action 保留（多余字段剥除），非法 action / 缺 action 丢弃并说明
  it("canvas op with whitelisted action is kept, extra fields stripped", () => {
    for (const action of ["minimal_on", "minimal_off", "arrange_layout", "fit_view", "download_all"]) {
      const r = sanitizeOperationDetailed({ op: "canvas", action, note: "n", payload: { evil: 1 }, targetRef: "x" });
      expect("op" in r).toBe(true);
      if ("op" in r) {
        expect(r.op.op).toBe("canvas");
        expect(r.op.action).toBe(action);
        expect(r.op.payload).toBeUndefined();
        expect(r.op.targetRef).toBeUndefined();
      }
    }
  });

  it("canvas op with unknown/missing action → drop names the action", () => {
    const bad = sanitizeOperationDetailed({ op: "canvas", action: "self_destruct" });
    expect("drop" in bad && bad.drop.includes("self_destruct")).toBe(true);
    expect("drop" in sanitizeOperationDetailed({ op: "canvas" })).toBe(true);
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

describe("video_task params 字段（助手可设比例/分辨率）", () => {
  it("params 纯对象放行（aspect_ratio 等模型参数可写入）", () => {
    const r = sanitizeOperationDetailed({ op: "create", nodeType: "video_task", tempId: "v1", payload: { prompt: "p", params: { aspect_ratio: "16:9", resolution: "720p" } } }, {});
    expect("op" in r && (r.op as { payload: Record<string, unknown> }).payload.params).toEqual({ aspect_ratio: "16:9", resolution: "720p" });
  });
  it("params 非对象（字符串/数组）被丢弃，其余字段保留", () => {
    const r = sanitizeOperationDetailed({ op: "create", nodeType: "video_task", tempId: "v2", payload: { prompt: "p", params: "16:9" } }, {});
    const payload = (r as { op: { payload: Record<string, unknown> } }).op.payload;
    expect(payload.params).toBeUndefined();
    expect(payload.prompt).toBe("p");
  });
});

// ── 模型清单接入：provider/model 取值校验 + params 按模型参数表过滤 + 清单文本 ──
import { videoModelDigestText, imageModelDigestText, modelKnowledgeText } from "./_core/agentCatalog";

describe("模型取值校验（与节点选择器同源清单）", () => {
  it("video_task.provider 合法值保留", () => {
    const op = sanitizeOperation({ op: "create", nodeType: "video_task", payload: { prompt: "p", provider: "kie_grok_i2v" } });
    expect(op!.payload).toMatchObject({ provider: "kie_grok_i2v" });
  });
  it("video_task.provider 编造值被剥除，其余字段保留", () => {
    const op = sanitizeOperation({ op: "create", nodeType: "video_task", payload: { prompt: "p", provider: "kie_sora_9000" } });
    expect((op!.payload as Record<string, unknown>).provider).toBeUndefined();
    expect(op!.payload).toMatchObject({ prompt: "p" });
  });
  it("image_gen.model 合法/编造", () => {
    const ok = sanitizeOperation({ op: "create", nodeType: "image_gen", payload: { prompt: "p", model: "kie_seedream_45" } });
    expect(ok!.payload).toMatchObject({ model: "kie_seedream_45" });
    const bad = sanitizeOperation({ op: "create", nodeType: "image_gen", payload: { prompt: "p", model: "dalle_99" } });
    expect((bad!.payload as Record<string, unknown>).model).toBeUndefined();
  });
  it("storyboard.imageModel 编造值被剥除", () => {
    const op = sanitizeOperation({ op: "create", nodeType: "storyboard", payload: { description: "d", promptText: "p", imageModel: "not_a_model" } });
    expect((op!.payload as Record<string, unknown>).imageModel).toBeUndefined();
  });
  it("update 路径同样校验 provider/model 取值", () => {
    const op = sanitizeOperation({ op: "update", targetRef: "n1", payload: { provider: "kie_fake", model: "kie_seedream_45" } });
    expect((op!.payload as Record<string, unknown>).provider).toBeUndefined();
    expect(op!.payload).toMatchObject({ model: "kie_seedream_45" });
  });
});

describe("video_task.params 按所选模型参数表过滤", () => {
  it("provider 已知：清单外的幻觉键被丢弃，合法键保留", () => {
    // kie_grok_t2v 参数表：resolution / aspect_ratio / mode / duration
    const op = sanitizeOperation({ op: "create", nodeType: "video_task", payload: {
      prompt: "p", provider: "kie_grok_t2v",
      params: { aspect_ratio: "9:16", resolution: "720p", cfg_scale: 0.7, sound: true },
    } });
    expect(op!.payload.params).toEqual({ aspect_ratio: "9:16", resolution: "720p" });
  });
  it("provider 未设：params 原样保留（提交层各 provider allow-list 兜底）", () => {
    const op = sanitizeOperation({ op: "create", nodeType: "video_task", payload: { prompt: "p", params: { aspect_ratio: "1:1", anything: 1 } } });
    expect(op!.payload.params).toEqual({ aspect_ratio: "1:1", anything: 1 });
  });
});

describe("模型清单文本（喂给 LLM 的知识块）", () => {
  it("视频清单含每模型参数表（含枚举与默认标记）", () => {
    const t = videoModelDigestText();
    expect(t).toContain("kie_grok_t2v");
    expect(t).toMatch(/kie_grok_t2v.*aspect_ratio=/);
    expect(t).toContain("16:9*");          // 默认值标记
    expect(t).not.toContain("mock");       // 测试模型不进清单
  });
  it("图像清单含模型 id 与需参考图标注", () => {
    const t = imageModelDigestText();
    expect(t).toContain("kie_seedream_45");
    expect(t).toMatch(/kie_nano_banana_edit.*需参考图/);
  });
  it("汇总文本体量可控（<25k 字符，防系统提示爆量）", () => {
    expect(modelKnowledgeText().length).toBeLessThan(25000);
  });
});
