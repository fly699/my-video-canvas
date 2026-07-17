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

describe("applyAgentOperations connect → clip 句柄（剪辑无 input 桩，缺省须落 video-in/audio-in）", () => {
  it("智能体连「视频任务→剪辑」缺省 targetHandle 时落到 video-in（而非不存在的 input）", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "video_task", tempId: "v" },
      { op: "create", nodeType: "clip", tempId: "c" },
      { op: "connect", sourceRef: "v", targetRef: "c" },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const edges = useCanvasStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].targetHandle).toBe("video-in");
  });
  it("智能体连「音频→剪辑」缺省 targetHandle 时落到 audio-in", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "audio", tempId: "a" },
      { op: "create", nodeType: "clip", tempId: "c" },
      { op: "connect", sourceRef: "a", targetRef: "c" },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const edges = useCanvasStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].targetHandle).toBe("audio-in");
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
    // createdIds 只含【新建】节点——绝不含被 update/connect 的既有节点（existing）。
    // 「撤销新建」按钮据此删除，若误含 existing 会物理删掉用户原有节点（数据丢失）。
    expect(r.createdIds).toEqual([created.id]);
    expect(r.createdIds).not.toContain(existing.id);
  });
});

describe("applyAgentOperations 边去重（种子/查重分隔符一致）", () => {
  it("对画布已存在的边再发 connect → 不重复计数、不误标下游重跑", () => {
    const store = useCanvasStore.getState();
    const a = store.addNode("prompt", { x: 0, y: 0 });
    const b = store.addNode("video_task", { x: 200, y: 0 });
    // 先建立一条真实存在的边
    const first = applyAgentOperations([{ op: "connect", sourceRef: a.id, targetRef: b.id }], { x: 0, y: 0 });
    expect(first.connected).toBe(1); // 确认边建成
    // 再对同一条边发 connect（增量编辑很常见）——应被识别为已存在而去重：
    // 曾因「种子用 NUL、查重用空格」分隔符不一致，这里 isNewEdge 误判为真，导致 connected 虚增
    // 且把下游 b 误标进 touchedIds（白白重跑、耗生成积分）。
    const again = applyAgentOperations([{ op: "connect", sourceRef: a.id, targetRef: b.id }], { x: 0, y: 0 });
    expect(again.connected).toBe(0);
    expect(again.touchedIds).not.toContain(b.id);
  });
});

describe("角色自动接线：名字匹配只看正向文本（排除 negPrompt）", () => {
  it("角色名只出现在 negPrompt 里 → 不误接（用两个角色规避单主角兜底）", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "character", tempId: "cA", payload: { name: "阿明", appearance: "男" } },
      { op: "create", nodeType: "character", tempId: "cB", payload: { name: "阿红", appearance: "女" } },
      { op: "create", nodeType: "video_task", tempId: "v1", payload: { prompt: "阿明在街头奔跑", negPrompt: "阿红, 模糊" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const nodes = useCanvasStore.getState().nodes;
    const cA = nodes.find((n) => (n.data.payload as { name?: string }).name === "阿明")!.id;
    const cB = nodes.find((n) => (n.data.payload as { name?: string }).name === "阿红")!.id;
    const v1 = nodes.find((n) => n.data.nodeType === "video_task")!.id;
    const edges = useCanvasStore.getState().edges;
    expect(edges.some((e) => e.source === cA && e.target === v1)).toBe(true);  // 正向提及 → 接
    expect(edges.some((e) => e.source === cB && e.target === v1)).toBe(false); // 仅负向提及 → 不接
  });
});

describe("buildGraphSummary 硬帽保持合法 JSON（超大画布不从中间切断）", () => {
  it("超 18000 字上限时按整条丢弃末尾，仍是可解析 JSON", () => {
    const store = useCanvasStore.getState();
    // 建足够多节点撑爆 18000 字上限（每节点带一段接近截断长度的提示词）。
    for (let i = 0; i < 300; i++) {
      const n = store.addNode("prompt", { x: i * 10, y: 0 });
      store.updateNodeData(n.id, { positivePrompt: "镜头描述" + "x".repeat(60) });
    }
    const summary = buildGraphSummary("none");
    expect(summary.length).toBeLessThanOrEqual(18000);
    // 关键：必须是合法 JSON（旧版从中间 slice 会抛解析错误）
    const parsed = JSON.parse(summary) as { nodes: unknown[]; edges: unknown[] };
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(parsed.nodes.length).toBeGreaterThan(0); // 至少保住部分节点
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

  it("方案1 名字漂移兜底：LLM 加了前后缀/空格也能命中库角色代入参考图", () => {
    setLibraryCharacters(LIB);
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "character", tempId: "c1", payload: { name: "少年 林晓（主角）", appearance: "x" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 }, { characterImportMode: "conditioning" });
    const p = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "character")!.data.payload as Record<string, unknown>;
    expect(p.referenceImageUrl).toBe("lin.png"); // 包含匹配唯一命中 → 代入
    setLibraryCharacters([]);
  });
});

describe("applyAgentOperations 角色确定性自动连线（方案2）", () => {
  const LIB = [{
    id: "lib:1",
    data: { nodeType: "character" as const, payload: {
      characterKind: "person", name: "林晓", referenceImageUrl: "lin.png",
    } },
  }];

  it("单主角兜底：本批唯一角色自动接到所有新建生成节点（LLM 未 emit connect）", () => {
    setLibraryCharacters(LIB);
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "character", tempId: "c1", payload: { name: "林晓" } },
      { op: "create", nodeType: "image_gen", tempId: "g1", payload: { prompt: "公园漫步" } },
      { op: "create", nodeType: "storyboard", tempId: "s1", payload: { promptText: "咖啡馆" } },
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    const nodes = useCanvasStore.getState().nodes;
    const charId = nodes.find((n) => n.data.nodeType === "character")!.id;
    const genIds = nodes.filter((n) => ["image_gen", "storyboard"].includes(n.data.nodeType)).map((n) => n.id);
    const edges = useCanvasStore.getState().edges;
    for (const gid of genIds) expect(edges.some((e) => e.source === charId && e.target === gid)).toBe(true);
    expect(r.connected).toBeGreaterThanOrEqual(2);
    expect(r.autoLinkedChars).toBe(2); // image_gen + storyboard 各一条自动接线
    setLibraryCharacters([]);
  });

  it("多角色按名分派：只接提示词里点名的角色，不交叉污染", () => {
    setLibraryCharacters([]);
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "character", tempId: "a", payload: { name: "阿明" } },
      { op: "create", nodeType: "character", tempId: "b", payload: { name: "小红" } },
      { op: "create", nodeType: "image_gen", tempId: "g1", payload: { prompt: "阿明 在雨中" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const nodes = useCanvasStore.getState().nodes;
    const idOf = (name: string) => nodes.find((n) => n.data.nodeType === "character" && (n.data.payload as { name?: string }).name === name)!.id;
    const gid = nodes.find((n) => n.data.nodeType === "image_gen")!.id;
    const edges = useCanvasStore.getState().edges;
    expect(edges.some((e) => e.source === idOf("阿明") && e.target === gid)).toBe(true);   // 点名的接
    expect(edges.some((e) => e.source === idOf("小红") && e.target === gid)).toBe(false); // 未点名不接（多角色时无单主角兜底）
    setLibraryCharacters([]);
  });

  it("已有 LLM 显式连线：不重复补线", () => {
    setLibraryCharacters([]);
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "character", tempId: "c1", payload: { name: "林晓" } },
      { op: "create", nodeType: "image_gen", tempId: "g1", payload: { prompt: "公园" } },
      { op: "connect", sourceRef: "c1", targetRef: "g1" },
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    const nodes = useCanvasStore.getState().nodes;
    const charId = nodes.find((n) => n.data.nodeType === "character")!.id;
    const gid = nodes.find((n) => n.data.nodeType === "image_gen")!.id;
    const edges = useCanvasStore.getState().edges.filter((e) => e.source === charId && e.target === gid);
    expect(edges.length).toBe(1); // 只有 LLM 那一条，自动连线因 edgeKeys 去重不重复
    expect(r.connected).toBe(1);
    expect(r.autoLinkedChars).toBe(0); // LLM 已显式连线 → 不再自动补
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

  it("LLM 已设比例则不覆盖，且族内字段按【节点自身比例】展开（不混入全局比例）", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "sb", payload: { aspectRatio: "16:9" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 }, { aspect: "9:16" });
    const sb = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!.data.payload as Record<string, unknown>;
    expect(sb.aspectRatio).toBe("16:9");          // 不覆盖用户/LLM 显式值
    // 语义修正：LLM 给该节点设了 16:9，则 poyo/reve 族字段也展开为 16:9（节点内比例一致），
    // 而不是补全局的 9:16——否则同一节点换个模型族出片比例就漂移。
    expect(sb.poyoAspectRatio).toBe("16:9");
    expect(sb.reveAspectRatio).toBe("16:9");
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

describe("applyAgentOperations 校验一致性：update/delete 也要求 ref 落到真实节点（回归）", () => {
  it("update 指向幻觉/已删 id → 记为失败、不算 updated（自愈循环才会重试）", () => {
    const res = applyAgentOperations([{ op: "update", targetRef: "ghost-99", payload: { prompt: "x" } }], { x: 0, y: 0 });
    expect(res.updated).toBe(0);
    expect(res.failures.length).toBe(1);
    expect(res.failures[0].op).toBe("update");
  });
  it("delete 指向幻觉/已删 id → 记为失败、不算 deleted", () => {
    const res = applyAgentOperations([{ op: "delete", targetRef: "ghost-99" }], { x: 0, y: 0 });
    expect(res.deleted).toBe(0);
    expect(res.failures.length).toBe(1);
  });
  it("同批「先删 X、再 connect A→X」→ connect 失败、不建悬空边", () => {
    const store = useCanvasStore.getState();
    const x = store.addNode("video_task", { x: 0, y: 0 });   // 被删目标
    const a = store.addNode("image_gen", { x: 0, y: 100 });  // image→video 本是合法连接
    const res = applyAgentOperations([
      { op: "delete", targetRef: x.id },
      { op: "connect", sourceRef: a.id, targetRef: x.id },
    ], { x: 0, y: 0 });
    expect(res.deleted).toBe(1);
    expect(res.connected).toBe(0);
    expect(res.failures.some((f) => f.op === "connect")).toBe(true);
    // 没有指向已删节点的悬空边
    expect(useCanvasStore.getState().edges.some((e) => e.target === x.id)).toBe(false);
  });
});

// ── 防宫格兜底 + 快速设置（指定模型 / 生成节点白名单 / 全局比例进 video_task.params）──
describe("applyAgentOperations 防宫格反向词兜底", () => {
  const payloadOf = (type: string) =>
    useCanvasStore.getState().nodes.find((n) => n.data.nodeType === type)!.data.payload as Record<string, unknown>;

  it("智能体新建的分镜/图像节点自动追加反宫格 negativePrompt", () => {
    applyAgentOperations([
      { op: "create", nodeType: "storyboard", tempId: "sb", payload: { description: "d", promptText: "a cat by the window" } },
      { op: "create", nodeType: "image_gen", tempId: "ig", payload: { prompt: "a dog" } },
    ], { x: 0, y: 0 });
    expect(String(payloadOf("storyboard").negativePrompt)).toContain("multi-panel");
    expect(String(payloadOf("image_gen").negativePrompt)).toContain("grid");
  });

  it("已有 negativePrompt 时追加而不覆盖；已含防宫格词则不重复", () => {
    applyAgentOperations([
      { op: "create", nodeType: "image_gen", tempId: "ig", payload: { prompt: "p", negativePrompt: "blurry, low quality" } },
    ], { x: 0, y: 0 });
    const neg = String(payloadOf("image_gen").negativePrompt);
    expect(neg).toContain("blurry, low quality");
    expect(neg).toContain("multi-panel");
    expect(neg.match(/multi-panel/g)!.length).toBe(1);
  });

  it("正向提示词明确要拼贴/宫格时不注入（避免正反冲突）", () => {
    applyAgentOperations([
      { op: "create", nodeType: "image_gen", tempId: "ig", payload: { prompt: "四宫格漫画拼贴海报" } },
    ], { x: 0, y: 0 });
    expect(payloadOf("image_gen").negativePrompt).toBeUndefined();
  });
});

describe("applyAgentOperations 快速设置落地", () => {
  const payloadOf = (type: string) =>
    useCanvasStore.getState().nodes.find((n) => n.data.nodeType === type)!.data.payload as Record<string, unknown>;

  it("指定图像/视频模型 fill-only 写入新建生成节点", () => {
    applyAgentOperations([
      { op: "create", nodeType: "image_gen", tempId: "ig", payload: { prompt: "p" } },
      { op: "create", nodeType: "storyboard", tempId: "sb", payload: { description: "d", promptText: "p" } },
      { op: "create", nodeType: "video_task", tempId: "vt", payload: { prompt: "p" } },
    ], { x: 0, y: 0 }, { imageModel: "kie_seedream_45", videoProvider: "kie_grok_i2v" });
    expect(payloadOf("image_gen").model).toBe("kie_seedream_45");
    expect(payloadOf("storyboard").imageModel).toBe("kie_seedream_45");
    expect(payloadOf("video_task").provider).toBe("kie_grok_i2v");
  });

  it("#145 用户锁定强制覆盖 LLM 自选（曾把锁定的 grok 落成 LLM 自写的 GPT Image）", () => {
    applyAgentOperations([
      { op: "create", nodeType: "video_task", tempId: "vt", payload: { prompt: "p", provider: "kie_veo31_fast" } },
    ], { x: 0, y: 0 }, { videoProvider: "kie_grok_i2v" });
    expect(payloadOf("video_task").provider).toBe("kie_grok_i2v");
  });

  it("生成节点白名单：清单外的生成类 create 判失败，非生成节点不受限", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "image_gen", tempId: "ig", payload: { prompt: "p" } },
      { op: "create", nodeType: "video_task", tempId: "vt", payload: { prompt: "p" } },
      { op: "create", nodeType: "script", tempId: "sc", payload: { synopsis: "s" } },
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 }, { allowedGenNodes: ["video_task"] });
    expect(r.created).toBe(2);            // video_task + script
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].reason).toContain("image_gen");
    expect(useCanvasStore.getState().nodes.some((n) => n.data.nodeType === "image_gen")).toBe(false);
  });

  it("全局比例写入 video_task.params.aspect_ratio（fill-only，不覆盖 LLM 已设值）", () => {
    applyAgentOperations([
      { op: "create", nodeType: "video_task", tempId: "v1", payload: { prompt: "p", duration: 5 } },
    ], { x: 0, y: 0 }, { aspect: "9:16" });
    const p = payloadOf("video_task");
    expect(p.params).toMatchObject({ aspect_ratio: "9:16", duration: 5 });

    useCanvasStore.getState().resetCanvas(); useCanvasStore.getState().setProjectId(1);
    applyAgentOperations([
      { op: "create", nodeType: "video_task", tempId: "v2", payload: { prompt: "p", params: { aspect_ratio: "1:1" } } },
    ], { x: 0, y: 0 }, { aspect: "9:16" });
    expect((payloadOf("video_task").params as Record<string, unknown>).aspect_ratio).toBe("1:1");
  });
});

describe("applyAgentOperations 工作流模板白名单（快速设置二级选择）", () => {
  const TPLS = [
    { id: 7, label: "Wan 图生视频", payload: { workflowJson: "{\"1\":{}}" } },
    { id: 8, label: "Flux 出图", payload: { workflowJson: "{\"1\":{}}" } },
  ];
  it("允许清单内的模板正常物化", () => {
    const r = applyAgentOperations([
      { op: "create", nodeType: "comfyui_workflow", tempId: "w1", payload: { templateId: 7, prompt: "p" } },
    ], { x: 0, y: 0 }, { templates: TPLS, allowedTemplateIds: [7] });
    expect(r.created).toBe(1);
    expect(r.failures).toEqual([]);
  });
  it("清单外/缺失 templateId 的 comfyui_workflow 判失败并给原因", () => {
    const r = applyAgentOperations([
      { op: "create", nodeType: "comfyui_workflow", tempId: "w1", payload: { templateId: 8, prompt: "p" } },
      { op: "create", nodeType: "comfyui_workflow", tempId: "w2", payload: { prompt: "无模板空壳" } },
    ], { x: 0, y: 0 }, { templates: TPLS, allowedTemplateIds: [7] });
    expect(r.created).toBe(0);
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0].reason).toContain("只允许使用模板");
  });
  it("未设白名单时不限制（templateId 只需真实存在）", () => {
    const r = applyAgentOperations([
      { op: "create", nodeType: "comfyui_workflow", tempId: "w1", payload: { templateId: 8, prompt: "p" } },
    ], { x: 0, y: 0 }, { templates: TPLS });
    expect(r.created).toBe(1);
  });
});

describe("applyAgentOperations 追加批次避让（新批不叠在已有节点上）", () => {
  it("扇出布局与已有节点重叠时整批下移到其下方", () => {
    // 第一批：在 anchor 右侧扇出两个节点（占据 x∈[560,1640)、y∈[0,~480) 区域）
    applyAgentOperations([
      { op: "create", nodeType: "storyboard", tempId: "a" },
      { op: "create", nodeType: "video_task", tempId: "b" },
    ] as AgentOperation[], { x: 0, y: 0 });
    const firstYs = useCanvasStore.getState().nodes.map((n) => n.position.y);
    const firstMaxY = Math.max(...firstYs);
    // 第二批：同一 anchor 再建两个——修复前会与第一批完全同坐标叠加
    applyAgentOperations([
      { op: "create", nodeType: "storyboard", tempId: "c" },
      { op: "create", nodeType: "video_task", tempId: "d" },
    ] as AgentOperation[], { x: 0, y: 0 });
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.length).toBe(4);
    const batch2 = nodes.slice(2);
    // 第二批全部位于第一批的下方（避让下移），且相互坐标不与第一批任何节点重合
    for (const n of batch2) {
      expect(n.position.y).toBeGreaterThan(firstMaxY);
    }
    const keys = new Set(nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(keys.size).toBe(4); // 无任何两节点完全同位
  });

  it("场景布局同样避让（场景框也随批下移）", () => {
    applyAgentOperations([
      { op: "create", nodeType: "storyboard", tempId: "a" },
    ] as AgentOperation[], { x: 0, y: 0 });
    applyAgentOperations([
      { op: "create", nodeType: "storyboard", tempId: "s1", sceneGroup: "s1" },
    ] as AgentOperation[], { x: 0, y: 0 });
    const nodes = useCanvasStore.getState().nodes;
    const first = nodes[0];
    const group = nodes.find((n) => n.data.nodeType === "group")!;
    const shot = nodes.find((n) => n.id !== first.id && n.data.nodeType === "storyboard")!;
    expect(shot.position.y).toBeGreaterThan(first.position.y);
    expect(group.position.y).toBeGreaterThan(first.position.y - 1);
  });
});
