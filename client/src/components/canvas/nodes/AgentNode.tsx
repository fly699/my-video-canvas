import { memo, useState, useRef, useEffect } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AgentNodeData, AgentMessage, AgentOperation } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, Send, Check, Plus, Link2, Pencil, Trash2, LayoutGrid, Boxes, Wrench, Zap, BookTemplate, Focus } from "lucide-react";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { NodeTextArea } from "../NodeTextInput";
import { applyAgentOperations, buildGraphSummary } from "@/lib/agentApply";
import { getNodeConfig } from "../../../lib/nodeConfig";
import { LAYOUTS, computeLayout } from "@/lib/layoutUtils";
import { estimateOpsBudget, budgetLabel } from "@/lib/agentBudget";
import { AGENT_RECIPES } from "@/lib/agentRecipes";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track agent-initiated workflow runs (执行感知 + 自动续作).
  const runInitiatedRef = useRef(false);
  const prevRunningRef = useRef(false);
  const sawRunningRef = useRef(false);
  const chat = trpc.agent.chat.useMutation();
  const templatesQuery = trpc.comfyTemplates.list.useQuery(undefined, { staleTime: 30_000 });
  const analyzeMut = trpc.comfyTemplates.analyzeLibrary.useMutation();
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

  const handleApply = (msgIdx: number, ops: AgentOperation[]) => {
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

  const handleSend = async (override?: string, focusNodeIds?: string[]) => {
    const text = (override ?? input).trim();
    if (!text || chat.isPending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const summary = buildGraphSummary(id, focusNodeIds ? { focusNodeIds } : {});
    const afterUser: AgentMessage[] = [...messages, { role: "user", content: text }];
    const assistantIdx = afterUser.length; // index the assistant reply will occupy
    setMessages(afterUser);
    if (!override) setInput("");
    try {
      const r = await chat.mutateAsync({
        projectId: data.projectId, message: text, history,
        graphSummary: summary || undefined, model, comfyOnly,
      });
      setMessages([...afterUser, { role: "assistant", content: r.reply, operations: r.operations }]);
      if (autoApply && r.operations.length > 0) handleApply(assistantIdx, r.operations);
    } catch (e) {
      setMessages([...afterUser, { role: "assistant", content: "处理失败：" + (e instanceof Error ? e.message : ""), operations: [] }]);
    }
  };

  // 运行自愈：让智能体检查画布上运行失败/缺参的节点并给出修复方案（节点状态已随 graphSummary 提供）。
  const handleSelfHeal = () => handleSend("请检查当前画布上运行失败或缺少必要参数的节点，并用 update / connect 操作给出修复方案（修正参数、补全缺失连接或参考图）。若无问题请说明。");

  // 成片配方：一键把配方展开为完整节点链并应用（走与智能体输出相同的应用路径）。
  const handleApplyRecipe = (recipeId: string) => {
    const recipe = AGENT_RECIPES.find((x) => x.id === recipeId);
    if (!recipe) return;
    setShowRecipes(false);
    const ops = recipe.build(input.trim() || undefined);
    const pos = useCanvasStore.getState().nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
    const templates = (templatesQuery.data ?? []).map((t) => ({ id: t.id, label: t.label, payload: t.payload }));
    const r = applyAgentOperations(ops, pos, { templates });
    const parts = [r.created && `新建 ${r.created}`, r.connected && `连接 ${r.connected}`].filter(Boolean);
    setMessages([...messages, { role: "assistant", content: `已套用配方「${recipe.name}」：${parts.join(" · ") || "0 步"}。可继续让我填充/调整各节点内容，或直接运行。`, operations: [] }]);
    toast.success(`已套用配方：${recipe.name}`);
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
    if (failed.length > 0 && autoRun) handleSelfHeal();
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
                  <button
                    onClick={() => handleApply(i, m.operations!)}
                    disabled={appliedIdx.has(i)}
                    className="nodrag"
                    style={{
                      width: "100%", padding: "6px", fontSize: 11, fontWeight: 600, cursor: appliedIdx.has(i) ? "default" : "pointer",
                      background: appliedIdx.has(i) ? "var(--c-surface)" : accentA(0.18),
                      color: appliedIdx.has(i) ? "var(--c-t4)" : accent,
                      border: "none", borderTop: `1px solid ${accentA(0.25)}`,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    }}
                  >
                    {appliedIdx.has(i) ? <><Check className="w-3.5 h-3.5" />已应用到画布</> : <><Sparkles className="w-3.5 h-3.5" />应用到画布（{m.operations.length} 步）</>}
                  </button>
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
                      onClick={() => handleApplyRecipe(rec.id)}
                      className="nodrag"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 7, background: "transparent", border: "none", cursor: "pointer", color: "var(--c-t1)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = accentA(0.1); }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ fontSize: 11.5, fontWeight: 600 }}>{rec.name}</div>
                      <div style={{ fontSize: 10, color: "var(--c-t4)" }}>{rec.desc}</div>
                    </button>
                  ))}
                  <div style={{ fontSize: 9.5, color: "var(--c-t4)", padding: "4px 8px 2px", lineHeight: 1.4 }}>提示：先在输入框写主题，再选配方即可作为脚本梗概。</div>
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
    </BaseNode>
  );
});
