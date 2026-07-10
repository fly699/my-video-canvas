import { memo, useState, useRef, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { useReactFlow } from "@xyflow/react";
import { useNodeDefaultModels, resolveActiveNodeModel } from "../../../contexts/NodeDefaultModelsContext";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AgentNodeData, AgentMessage, AgentOperation, PipelineStep } from "../../../../../shared/types";
import { derivePipelineSteps } from "@/lib/pipelinePlan";
import { runAgentChatJob } from "@/lib/agentChatJob";
import { assembleFromStoryboards, assembledPlanToMergePatch } from "@/lib/storyboardGen";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, Send, Check, Plus, Link2, Pencil, Trash2, LayoutGrid, Boxes, Wrench, Zap, BookTemplate, Focus, ShieldCheck, SlidersHorizontal, RotateCw, ListChecks, ImageIcon, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { NodeTextArea } from "../NodeTextInput";
import { applyAgentOperations, buildGraphSummary, distributeServers, summarizePlanOps } from "@/lib/agentApply";
import { ownedNodeIds } from "@/lib/agentOwnership";
import { getNodeConfig } from "../../../lib/nodeConfig";
import { LAYOUTS, computeLayout } from "@/lib/layoutUtils";
import { estimateOpsBudget, budgetLabel, estimateOpsBudgetBreakdown } from "@/lib/agentBudget";
import { estimateCanvasBudget } from "@/lib/costEstimate";
import { readProjectBudgetCap } from "@/lib/budgetCap";
import { AGENT_RECIPES, buildRecipeOps, recipeDefaultConfig, type AgentRecipe, type RecipeConfig } from "@/lib/agentRecipes";
import { runPreflight, buildSelfHealInstruction } from "@/lib/preflight";
import { useWorkflowRunState } from "../../../contexts/WorkflowRunContext";
import { ServerCleanupDialog } from "../ServerCleanupDialog";

interface Props {
  id: string;
  selected?: boolean;
  data: { nodeType: "agent"; title: string; payload: AgentNodeData; projectId: number };
}

const accent = "oklch(0.70 0.20 310)";
const accentA = (a: number) => `oklch(0.70 0.20 310 / ${a})`;

// 工具栏按钮共享样式：主操作=实色 accent / 维护操作=淡色 ghost（hover 提升到 accent）。
const TBTN = "nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium";
const primaryBtn = { background: accentA(0.1), border: `1px solid ${accentA(0.3)}`, color: accent, cursor: "pointer" } as const;
const ghostBtn = { background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" } as const;
const ghostHover = {
  onMouseEnter: (e: ReactMouseEvent<HTMLButtonElement>) => { e.currentTarget.style.borderColor = accentA(0.45); e.currentTarget.style.color = accent; },
  onMouseLeave: (e: ReactMouseEvent<HTMLButtonElement>) => { e.currentTarget.style.borderColor = "var(--c-bd2)"; e.currentTarget.style.color = "var(--c-t3)"; },
};

// 示例指令：对话为空时给新用户起点，展示智能体能干什么（点击填入输入框）。
const AGENT_EXAMPLES = [
  "做一个 30 秒产品广告，3 个镜头",
  "赛博朋克城市短片，6 镜拼成 1 分钟",
  "把这句话扩成分镜：猫在厨房打翻牛奶",
  "古风女主角，生成 4 个一致性镜头",
  "给现有分镜配音并合并成片",
];

const OP_META: Record<AgentOperation["op"], { Icon: typeof Plus; label: string }> = {
  create: { Icon: Plus, label: "新建" },
  connect: { Icon: Link2, label: "连接" },
  update: { Icon: Pencil, label: "更新" },
  delete: { Icon: Trash2, label: "删除" },
};

function opText(op: AgentOperation): string {
  if (op.op === "create") return `${getNodeConfig(op.nodeType!).label}${op.title ? ` · ${op.title}` : ""}`;
  if (op.op === "connect") return `${op.sourceRef} → ${op.targetRef}`;
  if (op.op === "update") return `${op.targetRef}`;
  return `${op.targetRef}`;
}

export const AgentNode = memo(function AgentNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { resolve } = useNodeDefaultModels();
  const reactFlow = useReactFlow();
  const payload = data.payload;
  const messages = payload.messages ?? [];
  const model = (payload.model as LLMModelId) ?? (resolve("agent", "llm") as LLMModelId);

  const [input, setInput] = useState("");
  const [appliedIdx, setAppliedIdx] = useState<Set<number>>(new Set());
  const [costOpenIdx, setCostOpenIdx] = useState<Set<number>>(new Set()); // 展开「预估消耗明细」的计划卡下标
  const [layoutIdx, setLayoutIdx] = useState(0);
  const [analyzeFull, setAnalyzeFull] = useState(false);
  const [showRecipes, setShowRecipes] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [pendingSend, setPendingSend] = useState<{ text: string; focusNodeIds?: string[] } | null>(null);
  // 配方配置对话框（点配方后弹出，应用前可调镜头数/比例/时长/配乐字幕/AI生成内容）。
  const [recipeCfg, setRecipeCfg] = useState<{ recipe: AgentRecipe; cfg: RecipeConfig; useAI: boolean } | null>(null);
  const [recipeBusy, setRecipeBusy] = useState(false);
  // Multi-server distribution dialog (≥2 comfy nodes across ≥2 known servers).
  const [serverDist, setServerDist] = useState<{
    msgIdx: number; ops: AgentOperation[]; comfyCount: number;
    servers: string[]; selected: Set<string>; strategy: "round" | "random";
  } | null>(null);
  // Duration-aware capacity dialog: shown when the agent's plan split a target
  // duration longer than the model's per-shot cap into multiple shots.
  const [capacityPlan, setCapacityPlan] = useState<{
    plan: { targetSeconds: number; perShotSeconds: number; templateLabel?: string; shots: number };
    msgIdx: number;
    ops: AgentOperation[];
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track agent-initiated workflow runs (执行感知 + 自动续作).
  const runInitiatedRef = useRef(false);
  const selfHealRoundsRef = useRef(0); // caps auto self-heal loops per user request
  // 同因熔断：上一轮运行的失败签名（节点id+错误文本）。连续两轮签名相同说明修复
  // 无效（LLM 没修对或属环境问题），立即停止自动重试，避免无效循环烧钱。
  const lastFailSigRef = useRef("");
  // 自愈轮重跑范围：触发自愈时记录失败节点 id，apply 后只重跑「失败+本次修复触及」
  // 的节点，而不是全量重跑本智能体名下所有节点（已成功的不该重复花钱）。
  const healTargetsRef = useRef<string[] | null>(null);
  const prevRunningRef = useRef(false);
  const sawRunningRef = useRef(false);
  // 规划走「submitChat 提交 → chatStatus 轮询」（runAgentChatJob）：长生成不押 HTTP 长连接。
  const trpcUtils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const templatesQuery = trpc.comfyTemplates.list.useQuery(undefined, { staleTime: 30_000 });
  const analysisQuery = trpc.comfyTemplates.analysisList.useQuery(undefined, { staleTime: 30_000, enabled: showTemplates });
  const templatePrefs = payload.templatePrefs ?? {};
  const setTemplatePref = (patch: Partial<NonNullable<AgentNodeData["templatePrefs"]>>) =>
    updateNodeData(id, { templatePrefs: { ...templatePrefs, ...patch } });
  const analyzeMut = trpc.comfyTemplates.analyzeLibrary.useMutation();
  const meRole = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 }).data?.role;
  const [showCleanup, setShowCleanup] = useState(false);
  const recipeShotsMut = trpc.agent.recipeShots.useMutation();
  const balanceQuery = trpc.poyo.balance.useQuery(undefined, { staleTime: 60_000 });
  const comfyOnly = payload.comfyOnlyMode ?? false;
  // Selected canvas nodes (excluding this agent) → drives 局部编辑微调.
  // NB: select the stable array ref and filter in render — filtering inside the
  // selector returns a fresh array each call and triggers an infinite re-render.
  const selectedNodeIdsRaw = useCanvasStore((s) => s.selectedNodeIds);
  const selectedNodeIds = selectedNodeIdsRaw.filter((nid) => nid !== id);
  // Workflow run state → drives 执行感知 + 自动续作.
  const runState = useWorkflowRunState();

  const handleAnalyzeLibrary = async () => {
    if (analyzeMut.isPending) return;
    try {
      const r = await analyzeMut.mutateAsync({ model, full: analyzeFull });
      toast.success(`模板库分析完成：已分析 ${r.analyzed} · 跳过 ${r.skipped}${r.failed ? ` · 失败 ${r.failed}` : ""}`);
    } catch (e) {
      toast.error("分析失败：" + (e instanceof Error ? e.message : ""));
    }
  };

  // Cycle through the smart-layout options, re-arranging all canvas nodes (except
  // this agent node) in one undoable step.
  const handleSmartLayout = () => {
    const layout = LAYOUTS[layoutIdx % LAYOUTS.length];
    const { nodes, edges, batchUpdateNodePositions } = useCanvasStore.getState();
    const targets = nodes.filter((n) => n.id !== id);
    if (targets.length === 0) { toast.info("画布暂无可排序的节点"); return; }
    const updates = computeLayout(layout.id, targets.map((n) => ({ id: n.id, position: n.position, data: { nodeType: n.data.nodeType } })), edges.map((e) => ({ source: e.source, target: e.target })));
    batchUpdateNodePositions(updates);
    toast.success(`已应用布局：${layout.name}`);
    setLayoutIdx((i) => i + 1);
  };

  const autoApply = payload.autoApply ?? false;
  const autoRun = payload.autoRun ?? false;

  // 规划控制偏好（「规划设置」对话框）。
  const planPrefs = payload.planPrefs ?? {};
  const setPref = (patch: Partial<typeof planPrefs>) => updateNodeData(id, { planPrefs: { ...planPrefs, ...patch } });
  // Render the prefs into a constraint block the agent must follow.
  const buildPrefsText = (): string | undefined => {
    const lines: string[] = [];
    // 仅 ComfyUI 模式禁用 image_gen（catalog 会过滤掉），此处必须改用 comfyui_workflow 出图，
    // 否则会与 comfyOnly 约束「只能用 comfyui_workflow、禁止 image_gen」自相矛盾、误导 LLM。
    if (planPrefs.imageFirst) lines.push(comfyOnly
      ? "- 【强制·先生图再生视频】每个视频镜头必须图生视频：先建一个出图的 comfyui_workflow 节点（用识别到的出图模板，把镜头画面描述作为 prompt），再建图生视频节点并把出图节点连到它，严禁文生视频直连。"
      : "- 【强制·先生图再生视频】每个视频镜头必须走图生视频管线：为该镜头先建一个 image_gen 图像节点（把镜头画面描述作为它的 prompt），再建 video_task 视频节点，并连接 image_gen → video_task，让生成的静帧作为视频首帧。严禁让 storyboard/prompt/script 直接连到 video_task 做文生视频。");
    if (planPrefs.addMusic) lines.push("- 自动添加 audio 配乐节点并连入 merge 合并节点。");
    if (planPrefs.addSubtitle) lines.push("- 自动添加 subtitle 字幕节点（接在视频/合并之后）。");
    if (planPrefs.aspect) lines.push(`- 画面比例统一为 ${planPrefs.aspect}。`);
    if (planPrefs.style?.trim()) lines.push(`- 整体视觉风格：${planPrefs.style.trim()}。`);
    return lines.length ? lines.join("\n") : undefined;
  };

  const setMessages = (msgs: AgentMessage[]) => updateNodeData(id, { messages: msgs });
  // Read the latest messages straight from the store (avoids stale closures when
  // auto-applying right after a send).
  const freshMessages = (): AgentMessage[] =>
    ((useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.payload as AgentNodeData | undefined)?.messages) ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, busy]);

  // 余额/成本守卫：估算本批生成的云端消耗，与 Poyo 余额比较；另对照「项目预算上限
  // （kie 点，工具栏预算面板可设）」——该守卫在 ops 已应用后调用，画布即最终状态，
  // 直接用精确的 estimateCanvasBudget 对账。返回 true=可继续自动执行。
  const budgetGuardPasses = (ops: AgentOperation[]): boolean => {
    const est = estimateOpsBudget(ops);
    const bal = balanceQuery.data;
    if (est.credits > 0 && bal?.configured && typeof bal.creditsAmount === "number" && est.credits > bal.creditsAmount) {
      toast.error(`预计消耗约 ${est.credits} credits，超过当前余额 ${bal.creditsAmount}，已暂停自动执行。请充值或减少生成节点。`);
      return false;
    }
    const cap = readProjectBudgetCap(data.projectId);
    if (cap != null) {
      const st = useCanvasStore.getState();
      const cb = estimateCanvasBudget(
        st.nodes.map((n) => ({ id: n.id, data: { nodeType: n.data.nodeType, payload: n.data.payload as Record<string, unknown> } })),
        resolveActiveNodeModel as (nt: string, slot: "llm" | "image" | "video") => string,
        st.edges.map((e) => ({ source: e.source, target: e.target })),
      );
      if (cb.pt > cap) {
        toast.error(`画布预估 ${cb.pt} 点已超项目预算上限 ${cap} 点，已暂停自动执行。可在工具栏「预算管控」调整上限或精简节点后手动运行。`);
        return false;
      }
    }
    return true;
  };

  // Gather candidate ComfyUI server addresses for a batch of comfy ops, from the
  // ops' own payload and (for templateId-referencing workflow nodes) the template.
  const COMFY_TYPES = new Set(["comfyui_image", "comfyui_video", "comfyui_workflow"]);
  const gatherServers = (ops: AgentOperation[]): { comfyCount: number; servers: string[] } => {
    const tplById = new Map((templatesQuery.data ?? []).map((t) => [t.id, t]));
    const servers = new Set<string>();
    let comfyCount = 0;
    const add = (v: unknown) => { if (typeof v === "string" && v.trim()) servers.add(v.trim()); };
    for (const o of ops) {
      if (o.op !== "create" || !o.nodeType || !COMFY_TYPES.has(o.nodeType)) continue;
      comfyCount++;
      const p = (o.payload ?? {}) as Record<string, unknown>;
      add(p.customBaseUrl);
      if (Array.isArray(p.serverUrls)) p.serverUrls.forEach(add);
      const tid = p.templateId != null ? Number(p.templateId) : NaN;
      const tp = (Number.isInteger(tid) ? tplById.get(tid)?.payload : undefined) as Record<string, unknown> | undefined;
      if (tp) { add(tp.customBaseUrl); if (Array.isArray(tp.serverUrls)) tp.serverUrls.forEach(add); }
    }
    return { comfyCount, servers: Array.from(servers) };
  };

  // Apply gate: when a plan creates ≥2 comfy nodes across ≥2 known servers, ask
  // the user which servers to use and how to distribute before applying.
  const handleApply = (msgIdx: number, ops: AgentOperation[]) => {
    if (ops.length === 0) return;
    const { comfyCount, servers } = gatherServers(ops);
    if (comfyCount >= 2 && servers.length >= 2) {
      setServerDist({ msgIdx, ops, comfyCount, servers, selected: new Set(servers), strategy: "round" });
      return;
    }
    doApply(msgIdx, ops);
  };

  // Assign chosen servers onto the comfy ops by the picked strategy, then apply.
  const applyServerDistribution = () => {
    if (!serverDist) return;
    const { msgIdx, ops, servers, selected, strategy } = serverDist;
    distributeServers(ops, servers.filter((s) => selected.has(s)), strategy);
    setServerDist(null);
    doApply(msgIdx, ops);
  };

  const doApply = (msgIdx: number, ops: AgentOperation[]) => {
    if (ops.length === 0) return;
    const pos = useCanvasStore.getState().nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
    const templates = (templatesQuery.data ?? []).map((t) => ({ id: t.id, label: t.label, payload: t.payload }));
    const r = applyAgentOperations(ops, pos, { templates, freeVramAfterRun: planPrefs.freeVramAfterRun, ownerAgentId: id, characterImportMode: planPrefs.characterImportMode ?? "conditioning", aspect: planPrefs.aspect || undefined }); // mutates op.status/op.error in place
    setAppliedIdx((prev) => new Set(prev).add(msgIdx));
    // Persist op statuses (read fresh so an auto-apply right after send is correct).
    // 管线协同：apply 后确定性推导「下一步路线」，追加一张引导卡（无分镜管线则不追加）。
    const steps = derivePipelineSteps(id, useCanvasStore.getState().nodes);
    const withOps = freshMessages().map((m, i) => (i === msgIdx ? { ...m, operations: [...ops] } : m));
    setMessages(steps.length ? [...withOps, { role: "assistant", content: "", pipeline: steps }] : withOps);
    const parts = [r.created && `新建 ${r.created}`, r.connected && `连接 ${r.connected}`, r.updated && `更新 ${r.updated}`, r.deleted && `删除 ${r.deleted}`].filter(Boolean);
    if (r.failures.length > 0) {
      toast.warning(`已应用 ${parts.join(" · ") || "0 步"}，${r.failures.length} 步失败：${r.failures[0].reason}`);
    } else {
      toast.success(parts.length ? `已应用：${parts.join(" · ")}` : "无可应用的操作");
    }
    // 自动执行（一句话成片）：应用了新建/更新后，发起一次工作流运行。多智能体下
    // 只运行本智能体名下的节点，互不干扰（经画布确认 + 余额守卫）。
    if (autoRun && (r.created > 0 || r.updated > 0) && budgetGuardPasses(ops)) {
      runInitiatedRef.current = true;
      const live = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
      if (healTargetsRef.current) {
        // 自愈轮：只重跑失败节点 + 本次修复触及的节点（含 connect 补线的下游），
        // 绝不全量重跑已成功节点。
        const targets = Array.from(new Set([...healTargetsRef.current, ...r.touchedIds])).filter((nid) => live.has(nid));
        healTargetsRef.current = null;
        useCanvasStore.getState().requestRun(null, targets.length > 0 ? targets : undefined);
      } else {
        const mine = ownedNodeIds(useCanvasStore.getState().nodes, id);
        useCanvasStore.getState().requestRun(null, mine.length > 0 ? mine : undefined);
      }
    }
  };

  // 管线引导卡：一键跳到/执行管线下一步。装配/字幕由智能体直接确定性写入（不花钱、
  // 复用纯函数），打开镜头表用跨节点 panelRequest 信号（目标分镜自动展开面板）。
  const focusNode = (nodeId: string) => {
    const { nodes: cur, setNodes } = useCanvasStore.getState();
    if (!cur.some((n) => n.id === nodeId)) { toast.error("目标节点已不存在"); return false; }
    setNodes(cur.map((n) => ({ ...n, selected: n.id === nodeId })));
    const rf = reactFlow.getNode(nodeId);
    if (rf) {
      const w = rf.measured?.width ?? rf.width ?? 240, h = rf.measured?.height ?? rf.height ?? 120;
      reactFlow.setCenter(rf.position.x + w / 2, rf.position.y + h / 2, { zoom: Math.min(Math.max(reactFlow.getZoom(), 0.8), 1.4), duration: 500 });
    }
    return true;
  };
  const handlePipelineStep = (step: PipelineStep) => {
    if (step.action === "open_shotlist") {
      if (focusNode(step.targetId)) useCanvasStore.getState().requestPanel(step.targetId, "shotlist");
      return;
    }
    if (step.action === "assemble") {
      const { nodes, edges } = useCanvasStore.getState();
      const plan = assembleFromStoryboards(step.targetId, nodes, edges);
      if ("error" in plan) { toast.error(plan.error); focusNode(step.targetId); return; }
      updateNodeData(step.targetId, assembledPlanToMergePatch(plan));
      focusNode(step.targetId);
      toast.success(`已按镜头表装配 ${plan.inputVideoUrls.length} 段（镜号排序 · 逐镜转场 · 音轨对位）`, { duration: 5000 });
      return;
    }
    // burn_subtitle
    const m = useCanvasStore.getState().nodes.find((n) => n.id === step.targetId);
    if (!m) { toast.error("合并节点已不存在"); return; }
    const segD = (m.data.payload as { segDialogues?: (string | null)[] }).segDialogues;
    if (!segD?.some(Boolean)) { toast.error("请先「按镜头表装配」得到逐镜对白，再开启内嵌字幕"); focusNode(step.targetId); return; }
    updateNodeData(step.targetId, { burnShotSubtitles: true });
    focusNode(step.targetId);
    toast.success("已开启成片内嵌字幕（下次合并将用镜头表对白烧字幕）");
  };

  const FAIL_PREFIX = "处理失败：";

  // Core planning call. `baseMessages` already ends with the user message being
  // answered (so history = everything before it). Shared by send and retry.
  const runChat = async (text: string, baseMessages: AgentMessage[], focusNodeIds?: string[]) => {
    if (!text || busy) return;
    // 过滤掉管线引导卡（content 为空、仅 UI）——不污染发给 LLM 的对话历史。
    const history = baseMessages.slice(0, -1).filter((m) => m.content.trim() !== "").map((m) => ({ role: m.role, content: m.content.slice(0, 8000) })).slice(-20); // 服务端 history 上限 20 条、每条 8000 字符，超限会 400
    // Multi-agent isolation: scope the planning context to THIS agent's own nodes
    // (so it never sees or rewrites another agent's subgraph). An explicit
    // focusNodeIds (e.g. 微调选中) still wins. First plan owns nothing → empty context.
    const scope = focusNodeIds ?? ownedNodeIds(useCanvasStore.getState().nodes, id);
    const summary = buildGraphSummary(id, { focusNodeIds: scope });
    const assistantIdx = baseMessages.length; // index the assistant reply will occupy
    setMessages(baseMessages);
    // Read the freshest template choice from the store (the picker may have just set it).
    const tp = ((useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.payload as AgentNodeData | undefined)?.templatePrefs) ?? {};
    setBusy(true);
    try {
      const r = await runAgentChatJob(trpcUtils.client, {
        projectId: data.projectId, message: text, history,
        graphSummary: summary || undefined, model, comfyOnly,
        prefs: buildPrefsText(),
        imageFirst: planPrefs.imageFirst ?? false,
        imageTemplateId: tp.imageTemplateId,
        videoTemplateId: tp.videoTemplateId,
        includeCharacterLibrary: planPrefs.tellAgentCharacters !== false,
      });
      setMessages([...baseMessages, { role: "assistant", content: r.reply, operations: r.operations, plan: r.plan, dropped: r.dropped }]);
      // Duration-aware capacity check: if the plan split a target longer than the
      // model's per-shot cap into many shots, let the user choose how to proceed
      // before applying (instead of silently auto-applying a 12-shot plan).
      if (r.plan && r.plan.targetSeconds > r.plan.perShotSeconds && r.operations.length > 0) {
        // When "自动应用 / 一句话成片" is on, keep it fully automatic: the plan has
        // already been split into enough shots, so apply it as-is instead of
        // blocking on the capacity dialog (which would defeat hands-off mode).
        if (autoApply) {
          handleApply(assistantIdx, r.operations);
        } else {
          setCapacityPlan({ plan: r.plan, msgIdx: assistantIdx, ops: r.operations });
        }
      } else if (autoApply && r.operations.length > 0) {
        handleApply(assistantIdx, r.operations);
      }
    } catch (e) {
      setMessages([...baseMessages, { role: "assistant", content: FAIL_PREFIX + (e instanceof Error ? e.message : ""), operations: [] }]);
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async (override?: string, focusNodeIds?: string[]) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    if (!override) { selfHealRoundsRef.current = 0; lastFailSigRef.current = ""; healTargetsRef.current = null; } // genuine user send resets the self-heal cap/熔断
    // 仅 ComfyUI：首次规划前先弹「模板选择」让用户指定/确认（或自动），选完再规划。
    if (comfyOnly && !templatePrefs.asked) {
      setPendingSend({ text, focusNodeIds });
      setShowTemplates(true);
      return;
    }
    if (!override) setInput("");
    await runChat(text, [...messages, { role: "user", content: text }], focusNodeIds);
  };

  // 模板选择对话框里点「开始规划」：记住已询问，关闭弹窗，发出挂起的指令。
  const startPendingPlan = () => {
    setTemplatePref({ asked: true });
    setShowTemplates(false);
    const p = pendingSend;
    setPendingSend(null);
    if (p) { setInput(""); void runChat(p.text, [...freshMessages(), { role: "user", content: p.text }], p.focusNodeIds); }
  };

  // 重试：重跑失败助手消息所对应的上一条用户指令（丢弃失败回复，不重复用户气泡）。
  const handleRetry = (failedIdx: number) => {
    if (busy) return;
    const msgs = freshMessages();
    const userMsg = msgs[failedIdx - 1];
    if (!userMsg || userMsg.role !== "user") { toast.error("找不到可重试的上一条指令"); return; }
    void runChat(userMsg.content, msgs.slice(0, failedIdx));
  };

  // 运行自愈：先确定性体检拿到具体问题清单（节点 id + 问题 + 失败原因），再让智能体
  // 针对清单逐项精准修复——不让 LLM 自己从摘要里猜哪里坏了。失败原因已随 graphSummary
  // 的 error 字段提供，这里额外点名失败节点，把修复目标锁死。
  const handleSelfHeal = () => {
    const { nodes, edges } = useCanvasStore.getState();
    const pfNodes = nodes
      .filter((n) => n.id !== id)
      .map((n) => ({ id: n.id, data: { nodeType: n.data.nodeType, title: n.data.title, payload: n.data.payload as Record<string, unknown> } }));
    const r = runPreflight(pfNodes, edges.map((e) => ({ source: e.source, target: e.target })));
    // 记录失败节点作为自愈轮重跑目标（手动/自动同源）：apply 后只重跑失败+修复触及
    // 的节点。无失败（纯体检修复）时为 null → touchedIds 兜底。
    const failedIds = pfNodes.filter((n) => (n.data.payload as { status?: string } | undefined)?.status === "failed").map((n) => n.id);
    healTargetsRef.current = failedIds.length > 0 ? failedIds : null;
    handleSend(buildSelfHealInstruction(pfNodes, r.issues));
  };

  // 运行前体检：扫描整张画布的结构问题与全画布成本预估，汇报为一条消息。
  const handlePreflight = () => {
    const { nodes, edges } = useCanvasStore.getState();
    const r = runPreflight(
      nodes.filter((n) => n.id !== id).map((n) => ({ id: n.id, data: { nodeType: n.data.nodeType, title: n.data.title, payload: n.data.payload as Record<string, unknown> } })),
      edges.map((e) => ({ source: e.source, target: e.target })),
    );
    const lines: string[] = [];
    const head = r.errorCount === 0 && r.warningCount === 0
      ? "✅ 运行前体检通过，未发现结构问题。"
      : `运行前体检：${r.errorCount} 个错误、${r.warningCount} 个提醒。`;
    lines.push(head);
    for (const iss of r.issues.slice(0, 12)) lines.push(`${iss.severity === "error" ? "⛔" : "⚠️"} ${iss.message}`);
    if (r.issues.length > 12) lines.push(`…还有 ${r.issues.length - 12} 条`);
    const lbl = budgetLabel(r.budget);
    lines.push(`\n📊 全画布预估（${r.runnableCount} 个可运行节点）：${lbl || "无云端消耗"}`);
    const bal = balanceQuery.data;
    if (r.budget.credits > 0 && bal?.configured && typeof bal.creditsAmount === "number") {
      lines.push(r.budget.credits > bal.creditsAmount ? `余额 ${bal.creditsAmount} 不足以覆盖预估 ${r.budget.credits} credits` : `当前余额 ${bal.creditsAmount} credits，足够`);
    }
    if (r.errorCount > 0) lines.push("\n可点击「诊断修复」让我尝试自动修正。");
    setMessages([...messages, { role: "assistant", content: lines.join("\n"), operations: [] }]);
    if (r.errorCount > 0) toast.warning(`体检发现 ${r.errorCount} 个错误`);
    else if (r.warningCount > 0) toast.info(`体检发现 ${r.warningCount} 个提醒`);
    else toast.success("体检通过");
  };

  // 成片配方：点配方先打开配置对话框（应用前可调），确认后展开为节点链并应用。
  const openRecipe = (recipe: AgentRecipe) => {
    setShowRecipes(false);
    setRecipeCfg({
      recipe,
      cfg: recipeDefaultConfig(recipe, { topic: input.trim() || undefined, comfyOnly, prefs: planPrefs }),
      useAI: false,
    });
  };
  const setRecipeField = (patch: Partial<RecipeConfig>) =>
    setRecipeCfg((prev) => (prev ? { ...prev, cfg: { ...prev.cfg, ...patch } } : prev));

  // ComfyUI workflow templates available for 仅ComfyUI 配方（视频模板优先排前）。
  const workflowTemplates = (templatesQuery.data ?? []).filter((t) => t.nodeType === "comfyui_workflow");

  const handleConfirmRecipe = async () => {
    if (!recipeCfg || recipeBusy) return;
    const { recipe, cfg, useAI } = recipeCfg;
    if (cfg.comfyOnly && cfg.videoTemplateId == null) { toast.error("仅 ComfyUI 模式：请先选择一个视频工作流模板"); return; }
    let shotDescriptions = cfg.shotDescriptions;
    if (useAI) {
      setRecipeBusy(true);
      try {
        const r = await recipeShotsMut.mutateAsync({
          projectId: data.projectId, recipeName: recipe.name, topic: cfg.topic,
          shots: cfg.shots, style: cfg.style, model,
        });
        if (r.shots.length > 0) shotDescriptions = r.shots;
        else toast.info("AI 未返回有效分镜，改用默认分镜文案");
      } catch (e) {
        toast.error("AI 生成分镜失败，改用默认文案：" + (e instanceof Error ? e.message : ""));
      } finally { setRecipeBusy(false); }
    }
    const ops = buildRecipeOps(recipe, { ...cfg, shotDescriptions });
    setRecipeCfg(null);
    // Route through the agent apply path: push a message carrying the ops, then
    // apply it (handleApply adds the multi-server dialog + budget guard for free).
    const msgs = freshMessages();
    const idx = msgs.length;
    const created = ops.filter((o) => o.op === "create").length;
    setMessages([...msgs, { role: "assistant", content: `已按配方「${recipe.name}」生成 ${created} 个节点（${cfg.shots} 镜${useAI ? "，AI 分镜内容" : ""}）。可继续让我调整内容，或直接运行。`, operations: ops }]);
    handleApply(idx, ops);
  };

  // 局部编辑微调：只针对当前选中的节点，带上它们的参数上下文让智能体改。
  const handleRefineSelected = () => {
    if (selectedNodeIds.length === 0) { toast.info("请先在画布上选中要微调的节点"); return; }
    const text = input.trim() || "请优化/完善这些选中节点的参数与内容。";
    handleSend(`【仅微调选中的 ${selectedNodeIds.length} 个节点，不要新建无关节点；只对它们用 update 操作】\n${text}`, selectedNodeIds);
    setInput("");
  };

  // ── 多智能体：分管本智能体名下的节点 ───────────────────────────────────────
  const handleSelectMine = () => {
    const st = useCanvasStore.getState();
    const mine = new Set(ownedNodeIds(st.nodes, id));
    if (mine.size === 0) { toast.info("本智能体还没有生成任何节点"); return; }
    st.setNodes(st.nodes.map((n) => ({ ...n, selected: mine.has(n.id) })));
    st.setSelectedNodeIds(Array.from(mine));
    toast.success(`已选中本智能体的 ${mine.size} 个节点`);
  };
  const handleRunMine = () => {
    const mine = ownedNodeIds(useCanvasStore.getState().nodes, id);
    if (mine.length === 0) { toast.info("本智能体还没有生成任何节点"); return; }
    runInitiatedRef.current = true;
    useCanvasStore.getState().requestRun(null, mine);
  };
  const handleClearMine = () => {
    const st = useCanvasStore.getState();
    const mine = ownedNodeIds(st.nodes, id);
    if (mine.length === 0) { toast.info("本智能体还没有生成任何节点"); return; }
    if (!window.confirm(`确定清空本智能体生成的 ${mine.length} 个节点？此操作可撤销 (Ctrl+Z)。`)) return;
    mine.forEach((nid) => st.deleteNode(nid));
    toast.success(`已清空 ${mine.length} 个节点`);
  };

  // ── 执行感知 + 自动续作 ───────────────────────────────────────────────────
  // 当本智能体发起的运行结束时，汇报结果；若有失败且开启自动执行，发起自愈闭环。
  useEffect(() => {
    if (runState.running && runInitiatedRef.current) sawRunningRef.current = true;
    const justFinished = prevRunningRef.current && !runState.running;
    prevRunningRef.current = runState.running;
    if (!justFinished || !runInitiatedRef.current || !sawRunningRef.current) return;
    runInitiatedRef.current = false;
    sawRunningRef.current = false;
    const nodesNow = useCanvasStore.getState().nodes;
    const titleOf = (nid: string) => nodesNow.find((n) => n.id === nid)?.data.title ?? nid;
    const failed = runState.failedIds;
    let content = `运行完成：✅ ${runState.completedIds.length} 个成功${failed.length ? `，❌ ${failed.length} 个失败` : ""}。`;
    if (failed.length) {
      content += "\n" + failed.slice(0, 5).map((nid) => `• ${titleOf(nid)}：${runState.nodeStates[nid]?.errorMessage ?? "失败"}`).join("\n");
    }
    setMessages([...freshMessages(), { role: "assistant", content, operations: [] }]);
    // Auto self-heal on failure — but cap rounds so a persistently-failing node
    // can't loop forever (and burn credits). Reset on a fresh user-initiated send.
    if (failed.length > 0 && autoRun) {
      const sig = failed.map((nid) => `${nid}:${runState.nodeStates[nid]?.errorMessage ?? ""}`).sort().join("|");
      if (sig === lastFailSigRef.current) {
        // 同因熔断：上一轮自愈后失败集合与错误一字未变 → 修复无效，停止自动重试。
        setMessages([...freshMessages(), { role: "assistant", content: `⚠️ 自动修复已停止：连续两轮出现完全相同的失败（同因熔断），继续重试只会空转、白扣点数。\n失败原因见上。请手动调整后点下方「诊断修复」再试，或直接修改对应节点参数。`, operations: [] }]);
        toast.warning("自动修复已停止（同因熔断）");
      } else if (selfHealRoundsRef.current < 2) {
        lastFailSigRef.current = sig;
        selfHealRoundsRef.current += 1;
        // 明示自愈进度：第 N/2 轮，针对哪些节点（解决「自愈停止信号隐晦」）。
        toast.info(`检测到 ${failed.length} 个失败，自动修复中（第 ${selfHealRoundsRef.current}/2 轮）`);
        handleSelfHeal(); // 内部记录失败节点为自愈重跑目标，并发起一条可见的修复指令
      } else {
        // 轮次用尽（已自愈 2 轮仍有失败）：明确停止并给出手动入口，不再静默。
        setMessages([...freshMessages(), { role: "assistant", content: `已自动修复 2 轮但仍有 ${failed.length} 个节点失败，为避免持续扣点已停止自动重试。\n失败原因见上。可手动调整后点下方「诊断修复」单独再试，或检查对应节点的模型/参数/参考图。`, operations: [] }]);
        toast.warning("已达自动修复上限（2 轮），停止重试");
      }
    }
  }, [runState.running]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BaseNode id={id} selected={selected} nodeType="agent" title={data.title} minHeight={420} resizable showHandles={false} capNodeHeight>
      <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
        {/* Messages */}
        <div ref={scrollRef} className="nodrag nowheel" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center", color: "var(--c-t4)", fontSize: 11, lineHeight: 1.7, padding: "20px 8px" }}>
              <Sparkles className="w-5 h-5" style={{ color: accent, margin: "0 auto 8px" }} />
              用一句话描述你想做的视频，<br />我会帮你在画布上搭好节点工作流。<br />
              <span style={{ color: "var(--c-t3)" }}>例：「做一条 15 秒三分镜赛博朋克竖屏宣传片」</span>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%" }}>
              {m.pipeline && m.pipeline.length > 0 ? (
                <div className="nodrag" style={{ border: `1px solid ${accentA(0.3)}`, borderRadius: 12, overflow: "hidden", background: accentA(0.06), minWidth: 230 }}>
                  <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 800, color: accent, borderBottom: `1px solid ${accentA(0.2)}`, display: "flex", alignItems: "center", gap: 5 }}>
                    🎬 管线下一步
                  </div>
                  <div style={{ padding: "7px 9px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {m.pipeline.map((step, j) => (
                      <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                        <span style={{ flexShrink: 0, width: 16, height: 16, borderRadius: "50%", background: step.done ? "oklch(0.70 0.18 150 / 0.18)" : accentA(0.16), color: step.done ? "oklch(0.70 0.18 150)" : accent, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                          {step.done ? "✓" : j + 1}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t1)" }}>{step.label}</div>
                          <div style={{ fontSize: 9.5, color: "var(--c-t4)", lineHeight: 1.45 }}>{step.hint}</div>
                        </div>
                        <button onClick={() => handlePipelineStep(step)} className="nodrag" style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, padding: "3px 9px", borderRadius: 7, background: step.done ? "var(--c-surface)" : accentA(0.14), border: `1px solid ${step.done ? "var(--c-bd2)" : accentA(0.4)}`, color: step.done ? "var(--c-t3)" : accent, cursor: "pointer" }}>
                          {step.action === "open_shotlist" ? "打开" : step.done ? "重做" : "执行"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
              <div style={{
                fontSize: 12, lineHeight: 1.6, padding: "7px 10px", borderRadius: 10,
                background: m.role === "user" ? accentA(0.14) : "var(--c-surface)",
                border: `1px solid ${m.role === "user" ? accentA(0.3) : "var(--c-bd1)"}`,
                color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {m.content}
              </div>
              )}
              {m.role === "assistant" && m.content.startsWith(FAIL_PREFIX) && (
                <button
                  onClick={() => handleRetry(i)}
                  disabled={busy}
                  className="nodrag flex items-center gap-1"
                  title="重试：重跑上一条指令"
                  style={{
                    marginTop: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 8,
                    background: accentA(0.12), border: `1px solid ${accentA(0.35)}`, color: accent,
                    cursor: busy ? "wait" : "pointer",
                  }}
                >
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}重试
                </button>
              )}
              {m.role === "assistant" && m.operations && m.operations.length > 0 && (
                <div style={{ marginTop: 6, border: `1px solid ${accentA(0.28)}`, borderRadius: 10, overflow: "hidden", background: accentA(0.06) }}>
                  {(() => {
                    const outline = summarizePlanOps(m.operations, m.plan);
                    return outline ? (
                      <div style={{ padding: "5px 9px", fontSize: 10.5, fontWeight: 700, color: accent, borderBottom: `1px solid ${accentA(0.18)}`, display: "flex", alignItems: "center", gap: 4 }}>
                        <ListChecks className="w-3 h-3" style={{ flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={outline}>{outline}</span>
                      </div>
                    ) : null;
                  })()}
                  {/* 透明化：明示「生图→生视频」自动插入了几个静帧/出图节点，并指向开关（解决强制改写不透明） */}
                  {(() => {
                    const autoIns = m.operations!.filter((op) => op.op === "create" && op.note?.startsWith("生图→生视频")).length;
                    return autoIns > 0 ? (
                      <div style={{ padding: "4px 9px", fontSize: 10, color: "var(--c-t3)", lineHeight: 1.5, display: "flex", alignItems: "flex-start", gap: 5, background: accentA(0.05), borderBottom: `1px solid ${accentA(0.14)}` }}>
                        <ImageIcon className="w-3 h-3" style={{ flexShrink: 0, marginTop: 1, color: accent }} />
                        <span>已按「生图 → 生视频」自动插入 <b style={{ color: accent }}>{autoIns}</b> 个静帧节点作视频首帧（避免直接文生视频）。不需要可在 ⚙ 规划设置里关闭后重新规划。</span>
                      </div>
                    ) : null;
                  })()}
                  <div style={{ padding: "6px 9px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {m.operations.map((op, j) => {
                      const { Icon, label } = OP_META[op.op];
                      const failed = op.status === "failed";
                      const autoIns = op.op === "create" && op.note?.startsWith("生图→生视频");
                      const c = failed ? "oklch(0.62 0.20 25)" : accent;
                      return (
                        <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--c-t2)", paddingLeft: autoIns ? 5 : 0, borderLeft: autoIns ? `2px solid ${accentA(0.4)}` : "2px solid transparent" }}>
                          <Icon className="w-3 h-3" style={{ color: c, flexShrink: 0 }} />
                          <span style={{ color: c, fontWeight: 600, flexShrink: 0 }}>{label}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={failed ? op.error : (op.note ? `${opText(op)}\n理由：${op.note}` : opText(op))}>
                            {opText(op)}
                            {op.note && <span style={{ color: "var(--c-t4)", fontWeight: 400 }}> — {op.note}</span>}
                          </span>
                          {autoIns && <span style={{ color: accent, flexShrink: 0, fontSize: 8.5, fontWeight: 700, padding: "0 4px", borderRadius: 4, background: accentA(0.14) }}>自动</span>}
                          {failed && <span style={{ color: "oklch(0.62 0.20 25)", flexShrink: 0, fontSize: 10 }}>失败</span>}
                        </div>
                      );
                    })}
                  </div>
                  {(() => {
                    const b = estimateOpsBudget(m.operations);
                    const lbl = budgetLabel(b);
                    if (!lbl) return null;
                    const breakdown = estimateOpsBudgetBreakdown(m.operations);
                    const open = costOpenIdx.has(i);
                    return (
                      <div style={{ padding: "2px 9px 4px", fontSize: 10, color: "var(--c-t3)", fontWeight: 600, display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <Zap className="w-3 h-3" style={{ flexShrink: 0 }} />预估消耗：{lbl}
                          {b.credits > 0 && balanceQuery.data?.configured && typeof balanceQuery.data.creditsAmount === "number" && (
                            <span style={{ color: b.credits > balanceQuery.data.creditsAmount ? "oklch(0.62 0.20 25)" : "var(--c-t3)" }}>
                              （余额 {balanceQuery.data.creditsAmount}）
                            </span>
                          )}
                          {breakdown.length > 0 && (
                            <button
                              onClick={() => setCostOpenIdx((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                              className="nodrag"
                              style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 2, fontSize: 9.5, fontWeight: 600 }}
                            >
                              明细 {open ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                            </button>
                          )}
                        </div>
                        {open && breakdown.map((it) => (
                          <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 16, fontWeight: 400 }}>
                            <span style={{ color: "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{it.label} ×{it.count}</span>
                            <span style={{ flexShrink: 0, color: it.kind === "credits" ? "var(--c-t2)" : "var(--c-t4)" }}>
                              {it.kind === "credits" ? `${it.totalCredits} credits` : it.kind === "local" ? "免费" : "按用量"}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {(() => {
                    // "Applied" must survive node re-render / reopen: apply stamps each
                    // op with a status and persists it, so derive from that too — not
                    // just the in-memory appliedIdx (which resets), else a reopened plan
                    // shows "应用" again and a second click duplicates every node.
                    const applied = appliedIdx.has(i) || m.operations!.some((op) => !!op.status);
                    return (
                  <button
                    onClick={() => handleApply(i, m.operations!)}
                    disabled={applied}
                    className="nodrag"
                    style={{
                      width: "100%", padding: "6px", fontSize: 11, fontWeight: 600, cursor: applied ? "default" : "pointer",
                      background: applied ? "var(--c-surface)" : accentA(0.18),
                      color: applied ? "var(--c-t4)" : accent,
                      border: "none", borderTop: `1px solid ${accentA(0.25)}`,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    }}
                  >
                    {applied ? <><Check className="w-3.5 h-3.5" />已应用到画布</> : <><Sparkles className="w-3.5 h-3.5" />应用到画布（{m.operations.length} 步）</>}
                  </button>
                    );
                  })()}
                </div>
              )}
              {/* 透明化：LLM 提议但被服务端校验丢弃的操作——明示原因，避免「凭空消失」 */}
              {m.role === "assistant" && m.dropped && m.dropped.length > 0 && (
                <div style={{ marginTop: 6, padding: "5px 9px", fontSize: 10, lineHeight: 1.55, borderRadius: 8, background: "oklch(0.72 0.16 70 / 0.1)", border: "1px solid oklch(0.72 0.16 70 / 0.35)", color: "var(--c-t2)", display: "flex", alignItems: "flex-start", gap: 5 }}>
                  <AlertTriangle className="w-3 h-3" style={{ flexShrink: 0, marginTop: 1, color: "oklch(0.72 0.16 70)" }} />
                  <span>部分操作因不合规被忽略：{m.dropped.join("；")}</span>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--c-t3)", padding: "7px 10px" }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />规划中…
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--c-bd1)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
          {/* 工具栏第 1 行 · 主操作（实色）+ 多智能体（竖线分隔） */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {/* 组 A · 主操作 */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowRecipes((v) => !v)}
                className={TBTN}
                title="成片配方：一键展开常见成片的完整节点链"
                style={{ ...primaryBtn }}
              >
                <BookTemplate className="w-3 h-3" />配方
              </button>
              {showRecipes && (
                <div className="nodrag nowheel" style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 20, width: 230, maxHeight: 240, overflowY: "auto", background: "var(--c-surface)", border: `1px solid ${accentA(0.3)}`, borderRadius: 10, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                  {AGENT_RECIPES.map((rec) => (
                    <button
                      key={rec.id}
                      onClick={() => openRecipe(rec)}
                      className="nodrag"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 7, background: "transparent", border: "none", cursor: "pointer", color: "var(--c-t1)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = accentA(0.1); }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                        {rec.name}
                        <span style={{ fontSize: 9, color: accent, background: accentA(0.12), padding: "0 5px", borderRadius: 5 }}>{rec.category}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--c-t4)" }}>{rec.desc}</div>
                    </button>
                  ))}
                  <div style={{ fontSize: 9.5, color: "var(--c-t4)", padding: "4px 8px 2px", lineHeight: 1.4 }}>提示：先在输入框写主题，再选配方；点击后可调镜头数 / 比例 / 配乐字幕，并可让 AI 生成各镜内容。</div>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowPrefs(true)}
              className={TBTN}
              title="规划设置：生图→再生视频 / 配乐 / 字幕 / 画面比例等特殊要求"
              style={{ ...primaryBtn }}
            >
              <SlidersHorizontal className="w-3 h-3" />规划设置
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              className={TBTN}
              title="模板选择：分类列出可用的 ComfyUI 工作流模板，指定生图/图生视频用哪个（或自动）"
              style={{ ...primaryBtn }}
            >
              <BookTemplate className="w-3 h-3" />模板选择
              {(templatePrefs.imageTemplateId || templatePrefs.videoTemplateId) ? <span style={{ width: 6, height: 6, borderRadius: 999, background: accent }} /> : null}
            </button>
            <button
              onClick={handleSmartLayout}
              className={TBTN}
              title="智能排序：点击在多种布局间循环"
              style={{ ...primaryBtn }}
            >
              <LayoutGrid className="w-3 h-3" />智能排序
            </button>
            {/* 竖分隔 */}
            <div style={{ width: 1, alignSelf: "stretch", background: "var(--c-bd2)", margin: "0 2px" }} />
            {/* 组 B · 多智能体 */}
            <button
              onClick={handleSelectMine}
              className={TBTN}
              title="选中本智能体生成的全部节点"
              style={{ ...primaryBtn }}
            >
              <Focus className="w-3 h-3" />选中我的
            </button>
            <button
              onClick={handleRunMine}
              className={TBTN}
              title="只运行本智能体名下的节点（不影响其它智能体）"
              style={{ ...primaryBtn }}
            >
              <Zap className="w-3 h-3" />运行我的
            </button>
            <button
              onClick={handleRefineSelected}
              disabled={busy || selectedNodeIds.length === 0}
              className={TBTN}
              title="局部编辑：只针对画布上选中的节点微调（不新建无关节点）"
              style={{ background: selectedNodeIds.length ? accentA(0.1) : "var(--c-surface)", border: `1px solid ${selectedNodeIds.length ? accentA(0.3) : "var(--c-bd2)"}`, color: selectedNodeIds.length ? accent : "var(--c-t4)", cursor: selectedNodeIds.length && !busy ? "pointer" : "not-allowed" }}
            >
              <Focus className="w-3 h-3" />微调选中{selectedNodeIds.length ? `(${selectedNodeIds.length})` : ""}
            </button>
            <button
              onClick={handleClearMine}
              className={TBTN}
              title="清空本智能体生成的全部节点（可撤销）"
              style={{ background: "oklch(0.70 0.18 25 / 0.1)", border: "1px solid oklch(0.70 0.18 25 / 0.3)", color: "oklch(0.70 0.18 25)", cursor: "pointer" }}
            >
              <Trash2 className="w-3 h-3" />清空我的
            </button>
          </div>

          {/* 横向分隔线 */}
          <div style={{ height: 1, background: "var(--c-bd1)" }} />

          {/* 工具栏第 2 行 · 诊断 / 维护（淡色 ghost） */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={handlePreflight}
              className={TBTN}
              title="运行前体检：扫描结构问题（缺参/孤立/断链/循环）并预估全画布成本"
              style={{ ...ghostBtn }}
              {...ghostHover}
            >
              <ShieldCheck className="w-3 h-3" />运行前体检
            </button>
            <button
              onClick={handleSelfHeal}
              disabled={busy}
              className={TBTN}
              title="运行自愈：检查画布上运行失败/缺参的节点并给出修复方案"
              style={{ ...ghostBtn, cursor: busy ? "wait" : "pointer" }}
              {...ghostHover}
            >
              <Wrench className="w-3 h-3" />诊断修复
            </button>
            <button
              onClick={handleAnalyzeLibrary}
              disabled={analyzeMut.isPending}
              className={TBTN}
              title="分析 ComfyUI 模板库功能并入库（增量；勾选全量则重新分析全部）"
              style={{ ...ghostBtn, cursor: analyzeMut.isPending ? "wait" : "pointer" }}
              {...ghostHover}
            >
              {analyzeMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Boxes className="w-3 h-3" />}库分析
            </button>
            {meRole === "admin" && (
              <button
                onClick={() => setShowCleanup(true)}
                className={TBTN}
                title="扫描各服务器在线与模型状况，确认清理失效服务器、补入新可用服务器"
                style={{ ...ghostBtn }}
                {...ghostHover}
              >
                <RotateCw className="w-3 h-3" />清理服务器列表
              </button>
            )}
          </div>

          {/* 工具栏第 3 行 · 模式开关 */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label className="nodrag flex items-center gap-1 text-[10px]" style={{ color: comfyOnly ? accent : "var(--c-t3)", cursor: "pointer" }} title="开启后：音视频生成只用 ComfyUI 自定义工作流节点（从模板库选模板）">
              <input type="checkbox" checked={comfyOnly} onChange={(e) => updateNodeData(id, { comfyOnlyMode: e.target.checked })} style={{ accentColor: accent }} />仅 ComfyUI 生成
            </label>
            <label className="nodrag flex items-center gap-1 text-[10px]" style={{ color: autoApply ? accent : "var(--c-t3)", cursor: "pointer" }} title="规划后直接应用到画布，无需手动点应用">
              <input type="checkbox" checked={autoApply} onChange={(e) => updateNodeData(id, { autoApply: e.target.checked })} style={{ accentColor: accent }} />自动应用
            </label>
            <label className="nodrag flex items-center gap-1 text-[10px]" style={{ color: autoRun ? accent : "var(--c-t3)", cursor: "pointer" }} title="一句话成片：应用后自动发起运行（仍需画布确认）">
              <input type="checkbox" checked={autoRun} onChange={(e) => updateNodeData(id, { autoRun: e.target.checked })} style={{ accentColor: accent }} /><Zap className="w-3 h-3" />自动执行
            </label>
            <label className="nodrag flex items-center gap-1 text-[10px]" style={{ color: "var(--c-t3)", cursor: "pointer" }} title="勾选后『库分析』改为全量重新分析（默认仅新增/变更）">
              <input type="checkbox" checked={analyzeFull} onChange={(e) => setAnalyzeFull(e.target.checked)} style={{ accentColor: accent }} />全量
            </label>
          </div>
          <LLMModelPicker value={model} onChange={(m) => updateNodeData(id, { model: m })} disabled={busy} />
          {/* 示例指令：对话为空时引导新用户，点击填入输入框（不知道能让它做什么时的起点）*/}
          {messages.length === 0 && !input.trim() && (
            <div className="flex flex-wrap gap-1.5">
              {AGENT_EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setInput(ex)} className="nodrag" title="点击填入"
                  style={{ fontSize: 10.5, padding: "3px 9px", borderRadius: 999, cursor: "pointer", background: accentA(0.08), border: `1px solid ${accentA(0.25)}`, color: accent }}>
                  {ex}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <NodeTextArea
              className="nodrag nowheel"
              placeholder="描述你想做的视频，Ctrl/⌘+Enter 发送"
              value={input}
              onValueChange={setInput}
              rows={2}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void handleSend(); } }}
              style={{
                flex: 1, fontSize: 12, padding: "7px 10px", background: "var(--c-input)", borderRadius: 8,
                borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)",
                outline: "none", resize: "none", lineHeight: 1.5,
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--c-bd2)"; }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={busy || !input.trim()}
              className="nodrag flex items-center justify-center flex-shrink-0"
              title="发送（Ctrl/⌘+Enter）"
              style={{
                width: 34, height: 34, borderRadius: 8, border: "none",
                background: busy || !input.trim() ? "var(--c-surface)" : accent,
                color: busy || !input.trim() ? "var(--c-t4)" : "oklch(0.99 0 0)",
                cursor: busy || !input.trim() ? "not-allowed" : "pointer",
              }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
      {showCleanup && <ServerCleanupDialog onClose={() => setShowCleanup(false)} />}
      {showPrefs && (
        <div className="nodrag nowheel" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowPrefs(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 380, maxWidth: "90vw", background: "var(--c-surface)", border: `1px solid ${accentA(0.3)}`, borderRadius: 14, padding: 18, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)", marginBottom: 4 }}>规划设置</div>
            <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 14 }}>这些要求会作为约束注入智能体的规划。</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {([
                ["imageFirst", "生图 → 再生视频", "先出静帧再图生视频，不直接文生视频"],
                ["addMusic", "自动配乐", "添加 audio 节点并入合并"],
                ["addSubtitle", "自动字幕", "添加 subtitle 字幕节点"],
                ["freeVramAfterRun", "各节点清显存", "规划生成的 ComfyUI 节点运行后清显存（仅本地服务器）"],
              ] as const).map(([key, label, hint]) => (
                <label key={key} className="nodrag" style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!planPrefs[key]} onChange={(e) => setPref({ [key]: e.target.checked })} style={{ accentColor: accent, marginTop: 2 }} />
                  <span><span style={{ fontSize: 12.5, color: "var(--c-t1)", fontWeight: 600 }}>{label}</span><br /><span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>{hint}</span></span>
                </label>
              ))}
              <div>
                <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 4 }}>画面比例</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["", "9:16", "16:9", "1:1"].map((a) => (
                    <button key={a || "auto"} className="nodrag" onClick={() => setPref({ aspect: a })}
                      style={{ flex: 1, padding: "5px", fontSize: 11, borderRadius: 7, cursor: "pointer",
                        background: (planPrefs.aspect ?? "") === a ? accentA(0.18) : "var(--c-surface)",
                        border: `1px solid ${(planPrefs.aspect ?? "") === a ? accentA(0.4) : "var(--c-bd2)"}`,
                        color: (planPrefs.aspect ?? "") === a ? accent : "var(--c-t3)" }}>
                      {a || "默认"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 4 }}>整体风格（可选）</div>
                <input className="nodrag" value={planPrefs.style ?? ""} onChange={(e) => setPref({ style: e.target.value })}
                  placeholder="如：电影感 / 赛博朋克 / 水彩插画"
                  style={{ width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 8, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
              </div>
              {/* @角色 从角色库代入的力度 */}
              <div>
                <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 4 }}>@角色 代入角色库</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {([
                    ["full", "完整代入"],
                    ["conditioning", "参考图·LoRA·语音"],
                    ["fillEmpty", "只填空"],
                  ] as const).map(([val, lbl]) => {
                    const cur = planPrefs.characterImportMode ?? "conditioning";
                    return (
                      <button key={val} className="nodrag" onClick={() => setPref({ characterImportMode: val })}
                        style={{ flex: 1, padding: "5px 4px", fontSize: 10.5, borderRadius: 7, cursor: "pointer",
                          background: cur === val ? accentA(0.18) : "var(--c-surface)",
                          border: `1px solid ${cur === val ? accentA(0.4) : "var(--c-bd2)"}`,
                          color: cur === val ? accent : "var(--c-t3)" }}>
                        {lbl}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--c-t4)", marginTop: 4 }}>@角色名时，从角色库把对应角色的参考图/LoRA/语音等代入生成的角色节点。</div>
              </div>
              <label className="nodrag" style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={planPrefs.tellAgentCharacters !== false} onChange={(e) => setPref({ tellAgentCharacters: e.target.checked })} style={{ accentColor: accent, marginTop: 2 }} />
                <span><span style={{ fontSize: 12.5, color: "var(--c-t1)", fontWeight: 600 }}>让智能体知道角色库</span><br /><span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>系统提示里列出已有角色/场景名，要求按原名复用、不重编外观（名称匹配更可靠）</span></span>
              </label>
            </div>
            <button className="nodrag" onClick={() => setShowPrefs(false)}
              style={{ width: "100%", marginTop: 16, padding: "8px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: "pointer", background: accentA(0.18), border: `1px solid ${accentA(0.4)}`, color: accent }}>
              完成
            </button>
          </div>
        </div>
      )}
      {showTemplates && (() => {
        // 仅 comfyui_workflow 模板可被智能体作为 templateId 引用；按输出类型分类。
        const wf = (analysisQuery.data ?? []).filter((t) => t.nodeType === "comfyui_workflow");
        const imgTpls = wf.filter((t) => t.outputType === "image" || t.outputType === "mixed");
        const vidTpls = wf.filter((t) => t.hasVideoOutput || t.outputType === "video" || t.outputType === "mixed");
        const row = (
          t: { id: number; label: string; outputType?: string; functionSummary?: string },
          checked: boolean,
          onPick: () => void,
        ) => (
          <label key={t.id} className="nodrag" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 8px", borderRadius: 7, cursor: "pointer", background: checked ? accentA(0.12) : "transparent" }}>
            <input type="radio" checked={checked} onChange={onPick} style={{ accentColor: accent, marginTop: 2 }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 12.5, color: "var(--c-t1)", fontWeight: 600 }}>{t.label}</span>
              <span style={{ fontSize: 10, color: "var(--c-t4)" }}> · id {t.id}{t.outputType ? ` · ${t.outputType}` : ""}</span>
              {t.functionSummary ? <span style={{ display: "block", fontSize: 10.5, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.functionSummary}</span> : null}
            </span>
          </label>
        );
        const autoRow = (checked: boolean, onPick: () => void) => (
          <label className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, cursor: "pointer", background: checked ? accentA(0.12) : "transparent" }}>
            <input type="radio" checked={checked} onChange={onPick} style={{ accentColor: accent }} />
            <span style={{ fontSize: 12.5, color: "var(--c-t2)", fontWeight: 600 }}>自动选择（智能体按需求挑）</span>
          </label>
        );
        return (
          <div className="nodrag nowheel" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => { setShowTemplates(false); setPendingSend(null); }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "92vw", maxHeight: "86vh", overflowY: "auto", background: "var(--c-surface)", border: `1px solid ${accentA(0.3)}`, borderRadius: 14, padding: 18, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)", marginBottom: 4 }}>模板选择</div>
              <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 12 }}>智能体仅能引用「ComfyUI 自定义工作流」模板。为生图/图生视频指定要用的模板，或留「自动」。{analysisQuery.isFetching ? " 加载中…" : ""}</div>
              {wf.length === 0 && !analysisQuery.isFetching && (
                <div style={{ fontSize: 12, color: "oklch(0.7 0.18 25)", padding: "10px 0" }}>没有已分析的「自定义工作流(comfyui_workflow)」模板。请用「ComfyUI 自定义工作流」节点导入工作流并另存为模板，再点工具栏「新增节点模板库分析」。</div>
              )}
              <div style={{ fontSize: 12, fontWeight: 600, color: accent, margin: "8px 0 4px" }}>出图模板（生图）· {imgTpls.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, border: "1px solid var(--c-bd1)", borderRadius: 8, padding: 4 }}>
                {autoRow(!templatePrefs.imageTemplateId, () => setTemplatePref({ imageTemplateId: undefined }))}
                {imgTpls.map((t) => row(t, templatePrefs.imageTemplateId === t.id, () => setTemplatePref({ imageTemplateId: t.id })))}
                {imgTpls.length === 0 && <div style={{ fontSize: 11, color: "var(--c-t4)", padding: "4px 8px" }}>无</div>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: accent, margin: "12px 0 4px" }}>视频模板（图生视频 / 出视频）· {vidTpls.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, border: "1px solid var(--c-bd1)", borderRadius: 8, padding: 4 }}>
                {autoRow(!templatePrefs.videoTemplateId, () => setTemplatePref({ videoTemplateId: undefined }))}
                {vidTpls.map((t) => row(t, templatePrefs.videoTemplateId === t.id, () => setTemplatePref({ videoTemplateId: t.id })))}
                {vidTpls.length === 0 && <div style={{ fontSize: 11, color: "var(--c-t4)", padding: "4px 8px" }}>无</div>}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="nodrag" onClick={() => { setTemplatePref({ imageTemplateId: undefined, videoTemplateId: undefined }); }}
                  style={{ flex: 1, padding: "8px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: "pointer", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}>
                  全部自动
                </button>
                {pendingSend ? (
                  <button className="nodrag" onClick={startPendingPlan}
                    style={{ flex: 2, padding: "8px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: "pointer", background: accentA(0.18), border: `1px solid ${accentA(0.4)}`, color: accent, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <Sparkles className="w-3.5 h-3.5" />用所选模板开始规划
                  </button>
                ) : (
                  <button className="nodrag" onClick={() => setShowTemplates(false)}
                    style={{ flex: 2, padding: "8px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: "pointer", background: accentA(0.18), border: `1px solid ${accentA(0.4)}`, color: accent }}>
                    完成
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {recipeCfg && (() => {
        const { recipe, cfg, useAI } = recipeCfg;
        const [minShots, maxShots] = recipe.shotRange;
        const setShots = (v: number) => setRecipeField({ shots: Math.max(minShots, Math.min(maxShots, Math.round(v) || minShots)) });
        return (
          <div className="nodrag nowheel" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => !recipeBusy && setRecipeCfg(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto", background: "var(--c-surface)", border: `1px solid ${accentA(0.3)}`, borderRadius: 14, padding: 18, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                <BookTemplate className="w-4 h-4" style={{ color: accent }} />{recipe.name}
                <span style={{ fontSize: 10, color: accent, background: accentA(0.12), padding: "1px 6px", borderRadius: 6 }}>{recipe.category}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 14 }}>{recipe.desc}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 4 }}>主题（可选，作为脚本梗概）</div>
                  <input className="nodrag" value={cfg.topic ?? ""} onChange={(e) => setRecipeField({ topic: e.target.value })}
                    placeholder={recipe.synopsis()}
                    style={{ width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 4 }}>镜头数（{minShots}–{maxShots}）</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button className="nodrag" onClick={() => setShots(cfg.shots - 1)} style={{ width: 28, height: 28, borderRadius: 7, cursor: "pointer", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontSize: 16 }}>−</button>
                      <input className="nodrag" type="number" value={cfg.shots} min={minShots} max={maxShots} onChange={(e) => setShots(Number(e.target.value))}
                        style={{ width: 48, textAlign: "center", padding: "5px", fontSize: 13, borderRadius: 7, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                      <button className="nodrag" onClick={() => setShots(cfg.shots + 1)} style={{ width: 28, height: 28, borderRadius: 7, cursor: "pointer", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", fontSize: 16 }}>+</button>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 4 }}>每镜时长（秒）</div>
                    <input className="nodrag" type="number" value={cfg.durationEach} min={1} max={60} onChange={(e) => setRecipeField({ durationEach: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                      style={{ width: "100%", padding: "5px 8px", fontSize: 13, borderRadius: 7, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 4 }}>画面比例</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["9:16", "16:9", "1:1"].map((a) => (
                      <button key={a} className="nodrag" onClick={() => setRecipeField({ aspect: a })}
                        style={{ flex: 1, padding: "5px", fontSize: 11, borderRadius: 7, cursor: "pointer",
                          background: cfg.aspect === a ? accentA(0.18) : "var(--c-surface)",
                          border: `1px solid ${cfg.aspect === a ? accentA(0.4) : "var(--c-bd2)"}`,
                          color: cfg.aspect === a ? accent : "var(--c-t3)" }}>{a}</button>
                    ))}
                  </div>
                </div>
                {cfg.comfyOnly ? (
                  <div>
                    <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 4 }}>视频工作流模板（仅 ComfyUI，必选）</div>
                    {workflowTemplates.length === 0 ? (
                      <div style={{ fontSize: 11, color: "oklch(0.62 0.20 25)" }}>模板库暂无 comfyui_workflow 模板，请先保存一个，或关闭「仅 ComfyUI 生成」。</div>
                    ) : (
                      <select className="nodrag" value={cfg.videoTemplateId ?? ""} onChange={(e) => setRecipeField({ videoTemplateId: e.target.value ? Number(e.target.value) : undefined })}
                        style={{ width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}>
                        <option value="">— 选择模板 —</option>
                        {workflowTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {([
                      ["imageFirst", "生图 → 再生视频", cfg.imageFirst],
                      ["addMusic", "自动配乐", cfg.addMusic],
                      ["addSubtitle", "自动字幕", cfg.addSubtitle],
                    ] as const).map(([key, label, val]) => (
                      <label key={key} className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: "var(--c-t1)" }}>
                        <input type="checkbox" checked={!!val} onChange={(e) => setRecipeField({ [key]: e.target.checked } as Partial<RecipeConfig>)} style={{ accentColor: accent }} />{label}
                      </label>
                    ))}
                  </div>
                )}
                <label className="nodrag" style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", paddingTop: 4, borderTop: "1px solid var(--c-bd1)" }}>
                  <input type="checkbox" checked={useAI} onChange={(e) => setRecipeCfg((prev) => prev && { ...prev, useAI: e.target.checked })} style={{ accentColor: accent, marginTop: 2 }} />
                  <span><span style={{ fontSize: 12.5, color: "var(--c-t1)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><Sparkles className="w-3 h-3" style={{ color: accent }} />AI 生成分镜内容</span><span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>按主题让 AI 写出每个镜头的具体画面描述（否则用默认分镜文案）</span></span>
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="nodrag" disabled={recipeBusy} onClick={() => setRecipeCfg(null)}
                  style={{ flex: 1, padding: "9px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: recipeBusy ? "not-allowed" : "pointer", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}>
                  取消
                </button>
                <button className="nodrag" disabled={recipeBusy || (cfg.comfyOnly && cfg.videoTemplateId == null)} onClick={() => void handleConfirmRecipe()}
                  style={{ flex: 2, padding: "9px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: recipeBusy ? "wait" : "pointer", background: accentA(0.18), border: `1px solid ${accentA(0.4)}`, color: accent, opacity: (cfg.comfyOnly && cfg.videoTemplateId == null) ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  {recipeBusy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />AI 生成分镜中…</> : <><Sparkles className="w-3.5 h-3.5" />生成并应用（{cfg.shots} 镜）</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {serverDist && (
        <div className="nodrag nowheel" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setServerDist(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "92vw", background: "var(--c-surface)", border: `1px solid ${accentA(0.3)}`, borderRadius: 14, padding: 18, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)", marginBottom: 4 }}>多服务器分配</div>
            <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 12 }}>本次将创建 {serverDist.comfyCount} 个 ComfyUI 节点。选择要使用的服务器，并把它们分配到各节点以分散负载。</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto", marginBottom: 12 }}>
              {serverDist.servers.map((s) => (
                <label key={s} className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "var(--c-t1)" }}>
                  <input type="checkbox" checked={serverDist.selected.has(s)} style={{ accentColor: accent }}
                    onChange={(e) => setServerDist((prev) => { if (!prev) return prev; const sel = new Set(prev.selected); if (e.target.checked) sel.add(s); else sel.delete(s); return { ...prev, selected: sel }; })} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 6 }}>分配策略</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {([["round", "顺序（轮询）"], ["random", "随机"]] as const).map(([v, label]) => (
                <button key={v} className="nodrag" onClick={() => setServerDist((prev) => prev && { ...prev, strategy: v })}
                  style={{ flex: 1, padding: "6px", fontSize: 11.5, borderRadius: 8, cursor: "pointer",
                    background: serverDist.strategy === v ? accentA(0.18) : "var(--c-surface)",
                    border: `1px solid ${serverDist.strategy === v ? accentA(0.4) : "var(--c-bd2)"}`,
                    color: serverDist.strategy === v ? accent : "var(--c-t3)" }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="nodrag" disabled={serverDist.selected.size === 0} onClick={applyServerDistribution}
                style={{ flex: 1, padding: "9px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: serverDist.selected.size === 0 ? "not-allowed" : "pointer", background: accentA(0.18), border: `1px solid ${accentA(0.4)}`, color: accent, opacity: serverDist.selected.size === 0 ? 0.5 : 1 }}>
                确认分配并应用
              </button>
              <button className="nodrag" onClick={() => { const sd = serverDist; setServerDist(null); doApply(sd.msgIdx, sd.ops); }}
                style={{ flex: 1, padding: "9px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: "pointer", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}>
                跳过（用默认）
              </button>
            </div>
          </div>
        </div>
      )}
      {capacityPlan && (
        <div className="nodrag nowheel" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setCapacityPlan(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "90vw", background: "var(--c-surface)", border: `1px solid ${accentA(0.3)}`, borderRadius: 14, padding: 18, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)", marginBottom: 8 }}>时长规划确认</div>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--c-t2)", marginBottom: 14 }}>
              目标总时长 <b>{capacityPlan.plan.targetSeconds}s</b>，
              {capacityPlan.plan.templateLabel ? `模板「${capacityPlan.plan.templateLabel}」` : "所选模型"}每镜最长约 <b>{capacityPlan.plan.perShotSeconds}s</b>。
              <br />为达成时长，已规划 <b>{capacityPlan.plan.shots}</b> 个镜头（分多个场景）。如何处理？
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="nodrag" onClick={() => { const c = capacityPlan; setCapacityPlan(null); handleApply(c.msgIdx, c.ops); }}
                style={{ padding: "9px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: "pointer", background: accentA(0.18), border: `1px solid ${accentA(0.4)}`, color: accent }}>
                ① 采用此规划（自动补足时长，{capacityPlan.plan.shots} 镜）
              </button>
              <button className="nodrag" onClick={() => { setCapacityPlan(null); handleSend("每个场景只保留 1 个镜头，接受较短的总时长，不要为补足时长而增加镜头数。"); }}
                style={{ padding: "9px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: "pointer", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}>
                ② 接受较短时长（每场景 1 镜）
              </button>
              <button className="nodrag" onClick={() => { setCapacityPlan(null); handleSend("改用每镜时长更长的视频模板/模型重新规划，尽量减少镜头数量以接近目标总时长。"); }}
                style={{ padding: "9px", fontSize: 12, fontWeight: 600, borderRadius: 9, cursor: "pointer", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}>
                ③ 换更长时长的模板重新规划
              </button>
              <button className="nodrag" onClick={() => setCapacityPlan(null)}
                style={{ padding: "6px", fontSize: 11, cursor: "pointer", background: "transparent", border: "none", color: "var(--c-t4)" }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </BaseNode>
  );
});
