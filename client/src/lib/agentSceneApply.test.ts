import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "../hooks/useCanvasStore";
import { applyAgentOperations, buildGraphSummary, summarizePlanOps, aspectFieldsFor } from "./agentApply";
import { setLibraryCharacters } from "./characterConditioning";
import type { AgentOperation } from "../../../shared/types";

// Phase A: when create ops carry sceneGroup, the apply layer lays each scene out
// as its own column and wraps it in an auto-created `group`「场景」container.
beforeEach(() => {
  useCanvasStore.getState().resetCanvas();
  useCanvasStore.getState().setProjectId(1);
});

describe("applyAgentOperations scene grouping", () => {
  it("creates a group box per scene and columns the shots", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "script", tempId: "sc" },
      { op: "create", nodeType: "storyboard", tempId: "s1a", sceneGroup: "s1" },
      { op: "create", nodeType: "storyboard", tempId: "s1b", sceneGroup: "s1" },
      { op: "create", nodeType: "storyboard", tempId: "s2a", sceneGroup: "s2" },
      { op: "create", nodeType: "merge", tempId: "mg" },
    ];
    const res = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(res.created).toBe(5);

    const nodes = useCanvasStore.getState().nodes;
    const groups = nodes.filter((n) => n.data.nodeType === "group");
    expect(groups.length).toBe(2); // 场景1 + 场景2
    expect(groups.map((g) => g.data.title).sort()).toEqual(["场景1", "场景2"]);
    // Group boxes are sized and render behind shots.
    for (const g of groups) {
      expect((g.style as { width?: number })?.width).toBeGreaterThan(0);
      expect((g.style as { height?: number })?.height).toBeGreaterThan(0);
      expect(g.zIndex).toBe(-1);
    }

    // Scene 1's two shots share one column (same x), distinct from scene 2's column.
    const sb = nodes.filter((n) => n.data.nodeType === "storyboard");
    const xs = new Set(sb.map((n) => n.position.x));
    expect(xs.size).toBe(2); // two scene columns
  });

  it("leaves layout unchanged (no group boxes) when ops have no sceneGroup", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "a" },
      { op: "create", nodeType: "video_task", tempId: "b" },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.filter((n) => n.data.nodeType === "group").length).toBe(0);
  });
});

describe("applyAgentOperations storyboard promptText backstop", () => {
  it("fills blank promptText from description on create (实测 bug：提示词框空置)", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "a", payload: { sceneNumber: 1, description: "雨夜街头，霓虹倒影" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const sb = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!;
    expect((sb.data.payload as { promptText?: string }).promptText).toBe("雨夜街头，霓虹倒影");
  });

  it("never overwrites an explicit promptText", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "a", payload: { description: "中文描述", promptText: "neon-lit rainy street, cinematic" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const sb = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!;
    expect((sb.data.payload as { promptText?: string }).promptText).toBe("neon-lit rainy street, cinematic");
  });
});

describe("buildGraphSummary failure context", () => {
  it("includes errorMessage (clipped) for failed nodes so self-heal can target the root cause", () => {
    const store = useCanvasStore.getState();
    const n = store.addNode("comfyui_image", { x: 0, y: 0 });
    store.updateNodeData(n.id, { status: "failed", errorMessage: "未配置 ComfyUI 服务器地址，请在节点中填写 customBaseUrl" });
    const long = store.addNode("video_task", { x: 0, y: 100 });
    store.updateNodeData(long.id, { status: "failed", errorMessage: "x".repeat(200) });
    const ok = store.addNode("image_gen", { x: 0, y: 200 });
    store.updateNodeData(ok.id, { status: "success", errorMessage: "陈旧的上次错误" });

    const parsed = JSON.parse(buildGraphSummary("none")) as { nodes: Array<{ id: string; status?: string; error?: string }> };
    const byId = new Map(parsed.nodes.map((x) => [x.id, x]));
    expect(byId.get(n.id)?.error).toContain("未配置 ComfyUI 服务器地址");
    expect(byId.get(long.id)?.error!.length).toBeLessThanOrEqual(161); // 160 + 省略号
    expect(byId.get(ok.id)?.error).toBeUndefined(); // 仅 failed 才带，避免陈旧错误误导
  });
});

describe("applyAgentOperations touchedIds（自愈收窄重跑范围）", () => {
  it("收集 create 新节点、update 目标与 connect 下游，并去重", () => {
    const store = useCanvasStore.getState();
    const existing = store.addNode("video_task", { x: 0, y: 0 });
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "prompt", tempId: "p1", payload: { positivePrompt: "x" } },
      { op: "update", targetRef: existing.id, payload: { prompt: "fixed" } },
      { op: "connect", sourceRef: "p1", targetRef: existing.id }, // 与 update 同目标 → 去重
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(r.failures).toEqual([]);
    const created = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "prompt")!;
    expect(new Set(r.touchedIds)).toEqual(new Set([created.id, existing.id]));
    expect(r.touchedIds.length).toBe(2); // existing.id 不重复
  });
});

describe("精准增量编辑防护", () => {
  it("分级截断：小范围摘要放宽到 400 字（增量编辑可见原文全貌）", () => {
    const store = useCanvasStore.getState();
    const n = store.addNode("storyboard", { x: 0, y: 0 });
    store.updateNodeData(n.id, { promptText: "甲".repeat(200) });
    const parsed = JSON.parse(buildGraphSummary("none")) as { nodes: Array<{ id: string; promptText?: string }> };
    expect(parsed.nodes.find((x) => x.id === n.id)?.promptText).toBe("甲".repeat(200)); // 小画布不截断
  });

  it("截断回写守卫：LLM 抄回「前缀+…」时丢弃该字段保住原文", () => {
    const store = useCanvasStore.getState();
    const full = "雨夜街头" + "霓".repeat(120);
    const n = store.addNode("storyboard", { x: 0, y: 0 });
    store.updateNodeData(n.id, { promptText: full, description: "旧描述" });
    const ops: AgentOperation[] = [
      { op: "update", targetRef: n.id, payload: { promptText: full.slice(0, 60) + "…", description: "新描述" } },
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(r.failures).toEqual([]);
    const p = useCanvasStore.getState().nodes.find((x) => x.id === n.id)!.data.payload as { promptText?: string; description?: string };
    expect(p.promptText).toBe(full);      // 截断回写被拦截，原文完好
    expect(p.description).toBe("新描述"); // 真实修改正常生效
  });

  it("真正以…结尾的新文本（非原文前缀）不被误拦", () => {
    const store = useCanvasStore.getState();
    const n = store.addNode("storyboard", { x: 0, y: 0 });
    store.updateNodeData(n.id, { promptText: "完全不同的旧文本" });
    const ops: AgentOperation[] = [
      { op: "update", targetRef: n.id, payload: { promptText: "崭新的提示词，意境悠远…" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const p = useCanvasStore.getState().nodes.find((x) => x.id === n.id)!.data.payload as { promptText?: string };
    expect(p.promptText).toBe("崭新的提示词，意境悠远…");
  });
});

describe("summarizePlanOps 计划大纲", () => {
  it("汇总场景/节点统计/模板/连线/删除警示与时长拆解", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "script", tempId: "sc" },
      { op: "create", nodeType: "storyboard", tempId: "a", sceneGroup: "s1" },
      { op: "create", nodeType: "storyboard", tempId: "b", sceneGroup: "s2" },
      { op: "create", nodeType: "comfyui_workflow", tempId: "w", payload: { templateId: 7 } },
      { op: "connect", sourceRef: "a", targetRef: "w" },
      { op: "update", targetRef: "x1", payload: { prompt: "p" } },
      { op: "delete", targetRef: "x2" },
    ];
    const t = summarizePlanOps(ops, { targetSeconds: 60, perShotSeconds: 5, shots: 12, templateLabel: "WAN" });
    expect(t).toContain("60s ÷ 5s/镜 ≈ 12 镜（WAN）");
    expect(t).toContain("2 个场景");
    expect(t).toContain("分镜×2");
    expect(t).toContain("引用 1 个模板");
    expect(t).toContain("1 条连线");
    expect(t).toContain("更新 1 处");
    expect(t).toContain("⚠️ 删除 1 个节点");
  });

  it("空操作返回空串（不渲染大纲行）", () => {
    expect(summarizePlanOps([])).toBe("");
  });
});

describe("智能体连接合并节点", () => {
  it("audio → merge（整片配乐）连接成功，不再被矩阵拒绝", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "audio", tempId: "bgm", payload: { audioCategory: "music" } },
      { op: "create", nodeType: "merge", tempId: "mg" },
      { op: "create", nodeType: "video_task", tempId: "v1" },
      { op: "connect", sourceRef: "bgm", targetRef: "mg" },
      { op: "connect", sourceRef: "v1", targetRef: "mg" },
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(r.failures).toEqual([]);
    expect(r.connected).toBe(2);
  });
});

describe("applyAgentOperations 角色库代入（@角色 生成节点）", () => {
  const LIB = [{
    id: "lib:1",
    data: { nodeType: "character" as const, payload: {
      characterKind: "person", name: "林晓", role: "侦探", appearance: "短发女性",
      referenceImageUrl: "lin.png", additionalImageUrls: ["lin_side.png"], loraName: "lin.safetensors", loraStrength: 0.9,
    } },
  }];

  it("conditioning（默认）：智能体建的同名 character 节点拿到参考图/LoRA，文字字段保留智能体所写", () => {
    setLibraryCharacters(LIB);
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "character", tempId: "c1", payload: { name: "林晓", appearance: "本剧定制外观" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 }, { characterImportMode: "conditioning" });
    const node = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "character")!;
    const p = node.data.payload as Record<string, unknown>;
    expect(p.referenceImageUrl).toBe("lin.png");
    expect(p.additionalImageUrls).toEqual(["lin_side.png"]);
    expect(p.loraName).toBe("lin.safetensors");
    expect(p.appearance).toBe("本剧定制外观"); // 智能体文字不被覆盖
    setLibraryCharacters([]);
  });

  it("full：库数据覆盖智能体同名文字字段", () => {
    setLibraryCharacters(LIB);
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "character", tempId: "c1", payload: { name: "林晓", appearance: "本剧定制外观" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 }, { characterImportMode: "full" });
    const p = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "character")!.data.payload as Record<string, unknown>;
    expect(p.appearance).toBe("短发女性");
    expect(p.role).toBe("侦探");
    expect(p.referenceImageUrl).toBe("lin.png");
    setLibraryCharacters([]);
  });

  it("库无同名：节点保持智能体原样（不代入）", () => {
    setLibraryCharacters(LIB);
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "character", tempId: "c1", payload: { name: "无名氏", appearance: "路人" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 }, { characterImportMode: "conditioning" });
    const p = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "character")!.data.payload as Record<string, unknown>;
    expect(p.referenceImageUrl).toBeUndefined();
    expect(p.appearance).toBe("路人");
    setLibraryCharacters([]);
  });
});

describe("aspectFieldsFor 画面比例字段映射", () => {
  it("各节点类型返回对应模型族比例字段", () => {
    expect(aspectFieldsFor("storyboard", "9:16")).toEqual({ aspectRatio: "9:16", poyoAspectRatio: "9:16", reveAspectRatio: "9:16" });
    // image_gen 与 storyboard 走同一图像后端：poyo 读 poyoAspectRatio、kie 读 aspectRatio、
    // Reve/Seedream/Flux 读 reveAspectRatio——三者都写，否则 poyo 图像模型比例被静默丢弃。
    expect(aspectFieldsFor("image_gen", "16:9")).toEqual({ aspectRatio: "16:9", poyoAspectRatio: "16:9", reveAspectRatio: "16:9" });
    expect(aspectFieldsFor("prompt", "1:1")).toEqual({ aspectRatio: "1:1" });
    expect(aspectFieldsFor("comfyui_workflow", "9:16")).toEqual({ aspectRatio: "9:16", overrideRatioSize: true });
    expect(aspectFieldsFor("video_task", "9:16")).toEqual({}); // i2v 跟随分镜参考图，不写
    // ComfyUI 图像/视频读 payload.width/height（无 aspectRatio）——换算成 /64 对齐尺寸。
    expect(aspectFieldsFor("comfyui_image", "9:16")).toEqual({ width: 512, height: 896 });
    expect(aspectFieldsFor("comfyui_video", "16:9")).toEqual({ width: 896, height: 512 });
    expect(aspectFieldsFor("storyboard", "")).toEqual({}); // 空比例不写
  });
});

describe("applyAgentOperations 应用顺序加固（D）+ 重复边计数（E）", () => {
  it("connect 排在 create 之前仍正确建边（create 优先排序）", () => {
    const ops: AgentOperation[] = [
      { op: "connect", sourceRef: "a", targetRef: "b" },        // 引用尚未出现的 create
      { op: "create", nodeType: "script", tempId: "a" },
      { op: "create", nodeType: "storyboard", tempId: "b" },
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(r.created).toBe(2);
    expect(r.connected).toBe(1);                                 // 不再因顺序误判失败
    expect(r.failures).toHaveLength(0);
    expect(useCanvasStore.getState().edges).toHaveLength(1);
  });

  it("重复 connect 不虚增 connected（store 按 源+目标 去重）", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "script", tempId: "a" },
      { op: "create", nodeType: "storyboard", tempId: "b" },
      { op: "connect", sourceRef: "a", targetRef: "b" },
      { op: "connect", sourceRef: "a", targetRef: "b" },        // 重复
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(r.connected).toBe(1);                                 // 只计一条真正新增的边
    expect(useCanvasStore.getState().edges).toHaveLength(1);
  });
});

describe("applyAgentOperations 画面比例确定性透传", () => {
  it("opts.aspect 在生成节点上补齐比例字段（LLM 未填时）", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "sb", payload: { sceneNumber: 1, description: "x" } },
      { op: "create", nodeType: "prompt", tempId: "pr", payload: { positivePrompt: "y" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 }, { aspect: "9:16" });
    const sb = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!.data.payload as Record<string, unknown>;
    expect(sb).toMatchObject({ aspectRatio: "9:16", poyoAspectRatio: "9:16", reveAspectRatio: "9:16" });
    const pr = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "prompt")!.data.payload as Record<string, unknown>;
    expect(pr.aspectRatio).toBe("9:16");
  });

  it("LLM 已设比例则不覆盖（fill-only）", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "sb", payload: { aspectRatio: "16:9" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 }, { aspect: "9:16" });
    const sb = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!.data.payload as Record<string, unknown>;
    expect(sb.aspectRatio).toBe("16:9");          // 不覆盖用户/LLM 显式值
    expect(sb.poyoAspectRatio).toBe("9:16");       // 未设的仍补
  });

  it("无 opts.aspect 时不动比例字段", () => {
    applyAgentOperations([{ op: "create", nodeType: "storyboard", tempId: "sb", payload: { description: "x" } }], { x: 0, y: 0 });
    const sb = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!.data.payload as Record<string, unknown>;
    expect(sb.aspectRatio).toBeUndefined();
  });
});

describe("buildGraphSummary 关键字段补齐（增量编辑可见）", () => {
  it("storyboard 暴露镜号/转场/对白；video_task 暴露 negativePrompt；character 暴露文本属性", () => {
    const store = useCanvasStore.getState();
    const sb = store.addNode("storyboard", { x: 0, y: 0 });
    store.updateNodeData(sb.id, { sceneNumber: 2, transition: "dissolve", dialogue: "阿明：快跑", description: "巷战" });
    const vt = store.addNode("video_task", { x: 0, y: 100 });
    store.updateNodeData(vt.id, { prompt: "追逐", negativePrompt: "模糊" });
    const ch = store.addNode("character", { x: 0, y: 200 });
    store.updateNodeData(ch.id, { characterKind: "person", name: "阿明", role: "逃犯", appearance: "黑衣" });

    const parsed = JSON.parse(buildGraphSummary("none")) as { nodes: Array<Record<string, unknown>> };
    const byId = new Map(parsed.nodes.map((n) => [n.id, n]));
    expect(byId.get(sb.id)).toMatchObject({ sceneNumber: 2, transition: "dissolve", dialogue: "阿明：快跑" });
    expect(byId.get(vt.id)).toMatchObject({ negativePrompt: "模糊" });
    expect(byId.get(ch.id)).toMatchObject({ name: "阿明", role: "逃犯", appearance: "黑衣" });
  });
});
