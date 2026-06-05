import { memo, useState, useRef, useEffect } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AgentNodeData, AgentMessage, AgentOperation } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, Send, Check, Plus, Link2, Pencil, Trash2, LayoutGrid, Boxes, Wrench, Zap, BookTemplate, Focus, ShieldCheck, SlidersHorizontal, RotateCw } from "lucide-react";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { NodeTextArea } from "../NodeTextInput";
import { applyAgentOperations, buildGraphSummary, distributeServers } from "@/lib/agentApply";
import { getNodeConfig } from "../../../lib/nodeConfig";
import { LAYOUTS, computeLayout } from "@/lib/layoutUtils";
import { estimateOpsBudget, budgetLabel } from "@/lib/agentBudget";
import { AGENT_RECIPES, buildRecipeOps, recipeDefaultConfig, type AgentRecipe, type RecipeConfig } from "@/lib/agentRecipes";
import { runPreflight } from "@/lib/preflight";
import { useWorkflowRunState } from "../../../contexts/WorkflowRunContext";

interface Props {
  id: string;
  selected?: boolean;
  data: { nodeType: "agent"; title: string; payload: AgentNodeData; projectId: number };
}

const accent = "oklch(0.70 0.20 310)";
const accentA = (a: number) => `oklch(0.70 0.20 310 / ${a})`;
const DEFAULT_LLM: LLMModelId = "claude-sonnet-4-5-20250929";

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
  const payload = data.payload;
  const messages = payload.messages ?? [];
  const model = (payload.model as LLMModelId) ?? DEFAULT_LLM;

  const [input, setInput] = useState("");
  const [appliedIdx, setAppliedIdx] = useState<Set<number>>(new Set());
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
  const prevRunningRef = useRef(false);
  const sawRunningRef = useRef(false);
  const chat = trpc.agent.chat.useMutation();
  const templatesQuery = trpc.comfyTemplates.list.useQuery(undefined, { staleTime: 30_000 });
  const analysisQuery = trpc.comfyTemplates.analysisList.useQuery(undefined, { staleTime: 30_000, enabled: showTemplates });
  const templatePrefs = payload.templatePrefs ?? {};
  const setTemplatePref = (patch: Partial<NonNullable<AgentNodeData["templatePrefs"]>>) =>
    updateNodeData(id, { templatePrefs: { ...templatePrefs, ...patch } });
  const analyzeMut = trpc.comfyTemplates.analyzeLibrary.useMutation();
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
    if (planPrefs.imageFirst) lines.push("- 【强制·先生图再生视频】每个视频镜头必须走图生视频管线：为该镜头先建一个 image_gen 图像节点（把镜头画面描述作为它的 prompt），再建 video_task 视频节点，并连接 image_gen → video_task，让生成的静帧作为视频首帧。严禁让 storyboard/prompt/script 直接连到 video_task 做文生视频。");
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
  }, [messages.length, chat.isPending]);

  // 余额/成本守卫：估算本批生成的云端消耗，与 Poyo 余额比较。返回 true=可继续。
  const budgetGuardPasses = (ops: AgentOperation[]): boolean => {
    const est = estimateOpsBudget(ops);
    const bal = balanceQuery.data;
    if (est.credits > 0 && bal?.configured && typeof bal.creditsAmount === "number" && est.credits > bal.creditsAmount) {
      toast.error(`预计消耗约 ${est.credits} credits，超过当前余额 ${bal.creditsAmount}，已暂停自动执行。请充值或减少生成节点。`);
      return false;
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
    const r = applyAgentOperations(ops, pos, { templates }); // mutates op.status/op.error in place
    setAppliedIdx((prev) => new Set(prev).add(msgIdx));
    // Persist op statuses (read fresh so an auto-apply right after send is correct).
    setMessages(freshMessages().map((m, i) => (i === msgIdx ? { ...m, operations: [...ops] } : m)));
    const parts = [r.created && `新建 ${r.created}`, r.connected && `连接 ${r.connected}`, r.updated && `更新 ${r.updated}`, r.deleted && `删除 ${r.deleted}`].filter(Boolean);
    if (r.failures.length > 0) {
      toast.warning(`已应用 ${parts.join(" · ") || "0 步"}，${r.failures.length} 步失败：${r.failures[0].reason}`);
    } else {
      toast.success(parts.length ? `已应用：${parts.join(" · ")}` : "无可应用的操作");
    }
    // 自动执行（一句话成片）：应用了新建/更新后，发起一次工作流运行（经画布确认 + 余额守卫）。
    if (autoRun && (r.created > 0 || r.updated > 0) && budgetGuardPasses(ops)) {
      runInitiatedRef.current = true;
      useCanvasStore.getState().requestRun(null);
    }
  };

  const FAIL_PREFIX = "处理失败：";

  // Core planning call. `baseMessages` already ends with the user message being
  // answered (so history = everything before it). Shared by send and retry.
  const runChat = async (text: string, baseMessages: AgentMessage[], focusNodeIds?: string[]) => {
    if (!text || chat.isPending) return;
    const history = baseMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    const summary = buildGraphSummary(id, focusNodeIds ? { focusNodeIds } : {});
    const assistantIdx = baseMessages.length; // index the assistant reply will occupy
    setMessages(baseMessages);
    // Read the freshest template choice from the store (the picker may have just set it).
    const tp = ((useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.payload as AgentNodeData | undefined)?.templatePrefs) ?? {};
    try {
      const r = await chat.mutateAsync({
        projectId: data.projectId, message: text, history,
        graphSummary: summary || undefined, model, comfyOnly,
        prefs: buildPrefsText(),
        imageFirst: planPrefs.imageFirst ?? false,
        imageTemplateId: tp.imageTemplateId,
        videoTemplateId: tp.videoTemplateId,
      });
      setMessages([...baseMessages, { role: "assistant", content: r.reply, operations: r.operations }]);
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
    }
  };

  const handleSend = async (override?: string, focusNodeIds?: string[]) => {
    const text = (override ?? input).trim();
    if (!text || chat.isPending) return;
    if (!override) selfHealRoundsRef.current = 0; // genuine user send resets the self-heal cap
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
    if (chat.isPending) return;
    const msgs = freshMessages();
    const userMsg = msgs[failedIdx - 1];
    if (!userMsg || userMsg.role !== "user") { toast.error("找不到可重试的上一条指令"); return; }
    void runChat(userMsg.content, msgs.slice(0, failedIdx));
  };

  // 运行自愈：让智能体检查画布上运行失败/缺参的节点并给出修复方案（节点状态已随 graphSummary 提供）。
  const handleSelfHeal = () => handleSend("请检查当前画布上运行失败或缺少必要参数的节点，并用 update / connect 操作给出修复方案（修正参数、补全缺失连接或参考图）。若无问题请说明。");

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
    if (failed.length > 0 && autoRun && selfHealRoundsRef.current < 2) {
      selfHealRoundsRef.current += 1;
      handleSelfHeal();
    }
  }, [runState.running]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BaseNode id={id} selected={selected} nodeType="agent" title={data.title} minHeight={420} resizable showHandles={false}>
      <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
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
              <div style={{
                fontSize: 12, lineHeight: 1.6, padding: "7px 10px", borderRadius: 10,
                background: m.role === "user" ? accentA(0.14) : "var(--c-surface)",
                border: `1px solid ${m.role === "user" ? accentA(0.3) : "var(--c-bd1)"}`,
                color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {m.content}
              </div>
              {m.role === "assistant" && m.content.startsWith(FAIL_PREFIX) && (
                <button
                  onClick={() => handleRetry(i)}
                  disabled={chat.isPending}
                  className="nodrag flex items-center gap-1"
                  title="重试：重跑上一条指令"
                  style={{
                    marginTop: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 8,
                    background: accentA(0.12), border: `1px solid ${accentA(0.35)}`, color: accent,
                    cursor: chat.isPending ? "wait" : "pointer",
                  }}
                >
                  {chat.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}重试
                </button>
              )}
              {m.role === "assistant" && m.operations && m.operations.length > 0 && (
                <div style={{ marginTop: 6, border: `1px solid ${accentA(0.28)}`, borderRadius: 10, overflow: "hidden", background: accentA(0.06) }}>
                  <div style={{ padding: "6px 9px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {m.operations.map((op, j) => {
                      const { Icon, label } = OP_META[op.op];
                      const failed = op.status === "failed";
                      const c = failed ? "oklch(0.62 0.20 25)" : accent;
                      return (
                        <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--c-t2)" }}>
                          <Icon className="w-3 h-3" style={{ color: c, flexShrink: 0 }} />
                          <span style={{ color: c, fontWeight: 600, flexShrink: 0 }}>{label}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={failed ? op.error : (op.note || opText(op))}>{opText(op)}</span>
                          {failed && <span style={{ color: "oklch(0.62 0.20 25)", flexShrink: 0, fontSize: 10 }}>失败</span>}
                        </div>
                      );
                    })}
                  </div>
                  {(() => {
                    const b = estimateOpsBudget(m.operations);
                    const lbl = budgetLabel(b);
                    return lbl ? (
                      <div style={{ padding: "2px 9px 4px", fontSize: 10, color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4 }}>
                        <Zap className="w-3 h-3" style={{ flexShrink: 0 }} />预估消耗：{lbl}
                        {b.credits > 0 && balanceQuery.data?.configured && typeof balanceQuery.data.creditsAmount === "number" && (
                          <span style={{ color: b.credits > balanceQuery.data.creditsAmount ? "oklch(0.62 0.20 25)" : "var(--c-t4)" }}>
                            （余额 {balanceQuery.data.creditsAmount}）
                          </span>
                        )}
                      </div>
                    ) : null;
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
            </div>
          ))}
          {chat.isPending && (
            <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--c-t3)", padding: "7px 10px" }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />规划中…
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--c-bd1)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
          {/* Tools row */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowRecipes((v) => !v)}
                className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
                title="成片配方：一键展开常见成片的完整节点链"
                style={{ background: accentA(0.1), border: `1px solid ${accentA(0.3)}`, color: accent, cursor: "pointer" }}
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
              onClick={handleRefineSelected}
              disabled={chat.isPending || selectedNodeIds.length === 0}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              title="局部编辑：只针对画布上选中的节点微调（不新建无关节点）"
              style={{ background: selectedNodeIds.length ? accentA(0.1) : "var(--c-surface)", border: `1px solid ${selectedNodeIds.length ? accentA(0.3) : "var(--c-bd2)"}`, color: selectedNodeIds.length ? accent : "var(--c-t4)", cursor: selectedNodeIds.length && !chat.isPending ? "pointer" : "not-allowed" }}
            >
              <Focus className="w-3 h-3" />微调选中{selectedNodeIds.length ? `(${selectedNodeIds.length})` : ""}
            </button>
            <button
              onClick={handleSmartLayout}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              title="智能排序：点击在多种布局间循环"
              style={{ background: accentA(0.1), border: `1px solid ${accentA(0.3)}`, color: accent, cursor: "pointer" }}
            >
              <LayoutGrid className="w-3 h-3" />智能排序
            </button>
            <button
              onClick={handleAnalyzeLibrary}
              disabled={analyzeMut.isPending}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              title="分析 ComfyUI 模板库功能并入库（增量；勾选全量则重新分析全部）"
              style={{ background: accentA(0.1), border: `1px solid ${accentA(0.3)}`, color: accent, cursor: analyzeMut.isPending ? "wait" : "pointer" }}
            >
              {analyzeMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Boxes className="w-3 h-3" />}新增节点模板库分析
            </button>
            <button
              onClick={() => setShowPrefs(true)}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              title="规划设置：生图→再生视频 / 配乐 / 字幕 / 画面比例等特殊要求"
              style={{ background: accentA(0.1), border: `1px solid ${accentA(0.3)}`, color: accent, cursor: "pointer" }}
            >
              <SlidersHorizontal className="w-3 h-3" />规划设置
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              title="模板选择：分类列出可用的 ComfyUI 工作流模板，指定生图/图生视频用哪个（或自动）"
              style={{ background: accentA(0.1), border: `1px solid ${accentA(0.3)}`, color: accent, cursor: "pointer" }}
            >
              <BookTemplate className="w-3 h-3" />模板选择
              {(templatePrefs.imageTemplateId || templatePrefs.videoTemplateId) ? <span style={{ width: 6, height: 6, borderRadius: 999, background: accent }} /> : null}
            </button>
            <button
              onClick={handlePreflight}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              title="运行前体检：扫描结构问题（缺参/孤立/断链/循环）并预估全画布成本"
              style={{ background: accentA(0.1), border: `1px solid ${accentA(0.3)}`, color: accent, cursor: "pointer" }}
            >
              <ShieldCheck className="w-3 h-3" />运行前体检
            </button>
            <button
              onClick={handleSelfHeal}
              disabled={chat.isPending}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              title="运行自愈：检查画布上运行失败/缺参的节点并给出修复方案"
              style={{ background: accentA(0.1), border: `1px solid ${accentA(0.3)}`, color: accent, cursor: chat.isPending ? "wait" : "pointer" }}
            >
              <Wrench className="w-3 h-3" />诊断修复
            </button>
            <label className="nodrag flex items-center gap-1 text-[10px]" style={{ color: "var(--c-t3)", cursor: "pointer" }} title="重新分析全部模板（而非仅新增/变更）">
              <input type="checkbox" checked={analyzeFull} onChange={(e) => setAnalyzeFull(e.target.checked)} style={{ accentColor: accent }} />全量
            </label>
            <label className="nodrag flex items-center gap-1 text-[10px]" style={{ color: comfyOnly ? accent : "var(--c-t3)", cursor: "pointer" }} title="开启后：音视频生成只用 ComfyUI 自定义工作流节点（从模板库选模板）">
              <input type="checkbox" checked={comfyOnly} onChange={(e) => updateNodeData(id, { comfyOnlyMode: e.target.checked })} style={{ accentColor: accent }} />仅 ComfyUI 生成
            </label>
            <label className="nodrag flex items-center gap-1 text-[10px]" style={{ color: autoApply ? accent : "var(--c-t3)", cursor: "pointer" }} title="规划后直接应用到画布，无需手动点应用">
              <input type="checkbox" checked={autoApply} onChange={(e) => updateNodeData(id, { autoApply: e.target.checked })} style={{ accentColor: accent }} />自动应用
            </label>
            <label className="nodrag flex items-center gap-1 text-[10px]" style={{ color: autoRun ? accent : "var(--c-t3)", cursor: "pointer" }} title="一句话成片：应用后自动发起运行（仍需画布确认）">
              <input type="checkbox" checked={autoRun} onChange={(e) => updateNodeData(id, { autoRun: e.target.checked })} style={{ accentColor: accent }} /><Zap className="w-3 h-3" />自动执行
            </label>
          </div>
          <LLMModelPicker value={model} onChange={(m) => updateNodeData(id, { model: m })} disabled={chat.isPending} />
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
              disabled={chat.isPending || !input.trim()}
              className="nodrag flex items-center justify-center flex-shrink-0"
              title="发送（Ctrl/⌘+Enter）"
              style={{
                width: 34, height: 34, borderRadius: 8, border: "none",
                background: chat.isPending || !input.trim() ? "var(--c-surface)" : accent,
                color: chat.isPending || !input.trim() ? "var(--c-t4)" : "oklch(0.99 0 0)",
                cursor: chat.isPending || !input.trim() ? "not-allowed" : "pointer",
              }}
            >
              {chat.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
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
