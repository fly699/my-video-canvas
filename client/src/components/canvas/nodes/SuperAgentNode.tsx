import { memo, useCallback, useRef, useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Boxes, Loader2, XCircle, ArrowRightCircle, Square, Server, Cpu, Send, RefreshCw, Settings2, ChevronDown, ChevronUp } from "lucide-react";
import { ComfyServerUrlField } from "./ComfyServerUrlField";
import { NodeTextArea } from "../NodeTextInput";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "../LLMModelPicker";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import type { SuperAgentNodeData, WorkflowParamBinding } from "../../../../../shared/types";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "super_agent";
    title: string;
    payload: SuperAgentNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.68 0.19 200)";
const accentA = (a: number) => `oklch(0.68 0.19 200 / ${a})`;
const BORDER = "var(--c-bd2)";
const GREEN = "oklch(0.62 0.2 155)";
const RED = "oklch(0.62 0.2 25)";

const labelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
  color: "var(--c-t4)", display: "block", marginBottom: 5,
};
const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 12, background: "var(--c-input)",
  borderWidth: 1, borderStyle: "solid", borderColor: BORDER, borderRadius: 8,
  color: "var(--c-t1)", outline: "none", lineHeight: 1.5,
};

function logColor(type: string): string {
  switch (type) {
    case "error": return "oklch(0.7 0.18 25)";
    case "done": return GREEN;
    case "action": return "oklch(0.72 0.16 285)";
    case "tool_result": return "var(--c-t2)";
    default: return "var(--c-t3)";
  }
}

type Turn = NonNullable<SuperAgentNodeData["conversation"]>[number];

/** 从对话记录提取给引擎的精简历史（末尾若干轮）。 */
function buildHistory(conv: Turn[]): { role: "user" | "assistant"; content: string }[] {
  return conv.slice(-6).map((t) => ({ role: t.role === "user" ? "user" as const : "assistant" as const, content: t.text.slice(0, 1000) }));
}

export const SuperAgentNode = memo(function SuperAgentNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const addNode = useCanvasStore((s) => s.addNode);
  const reactFlow = useReactFlow();
  const payload = data.payload;
  const update = useCallback((patch: Partial<SuperAgentNodeData>) => updateNodeData(id, patch), [id, updateNodeData]);

  const mode = payload.mode ?? "comfy";
  const { resolve } = useNodeDefaultModels();
  const llmModel = (payload.model || resolve("super_agent", "llm")) as LLMModelId;
  const modelShort = LLM_MODELS.find((m) => m.id === llmModel)?.short ?? "默认";
  const buildMut = trpc.superAgent.buildComfyWorkflow.useMutation();
  const codeMut = trpc.superAgent.runCodeTask.useMutation();
  const cancelMut = trpc.superAgent.cancel.useMutation();
  const codeStatus = trpc.superAgent.codeStatus.useQuery(undefined, { enabled: mode === "code", retry: false });
  const codeEnabled = codeStatus.data?.enabled === true;
  const bashAllowed = codeStatus.data?.bashAllowed === true;
  const running = payload.status === "running" || buildMut.isPending || codeMut.isPending;

  // 刷新/切项目后，持久化的 "running" 没有对应的在飞 mutation（刷新即丢），否则节点会被永久
  // 锁死（输入/发送/模式/重置全禁用、无恢复路径）。挂载时若见遗留 running 复位为 aborted，
  // 让节点重新可用。与 ComfyUI 节点的挂载自愈同理。
  useEffect(() => {
    if (payload.status === "running") update({ status: "aborted" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const utils = trpc.useUtils();
  const [testingServer, setTestingServer] = useState(false);
  // 聊天输入用本地 state（IME 安全：不逐键写 store，避免中文拼音输入被打断/乱蹦）。
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [codeInputText, setCodeInputText] = useState("");
  const codeInputRef = useRef<HTMLTextAreaElement>(null);
  // 一次 build 是否仍在等待结果：HTTP onSuccess 与 socket 兜底结果谁先到谁应用，另一路幂等跳过。
  const awaitingBuildRef = useRef(false);
  const resetCodeMut = trpc.superAgent.resetCodeSession.useMutation();
  const handleTestServer = useCallback(async () => {
    setTestingServer(true);
    try {
      const r = await utils.comfyui.fetchModels.fetch({ customBaseUrl: payload.customBaseUrl?.trim() || undefined });
      toast.success(`连接成功 — checkpoint ${r.ckpts.length} · LoRA ${r.loras.length} · 采样器 ${r.samplers.length}`);
    } catch (e) {
      toast.error("连接失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 120));
    } finally { setTestingServer(false); }
  }, [utils, payload.customBaseUrl]);

  const handleCancel = useCallback(() => {
    cancelMut.mutate({ projectId: data.projectId, nodeId: id }, {
      onSuccess: (r) => { toast[r.cancelled ? "success" : "info"](r.cancelled ? "已请求停止…" : "没有正在运行的任务"); },
      onError: (e) => toast.error("停止失败：" + e.message),
    });
  }, [cancelMut, data.projectId, id]);

  // 同步当前工作流到「已链接的 comfyui_workflow 节点」；无则新建并链接。regenerate=true 则触发其重新生成。
  const syncToNode = useCallback((wf: string, analysis: SuperAgentNodeData["resultAnalysis"], regenerate: boolean) => {
    const st = useCanvasStore.getState();
    const patch: Record<string, unknown> = {
      workflowJson: wf,
      paramBindings: (analysis?.paramBindings ?? []) as WorkflowParamBinding[],
      outputNodeIds: analysis?.outputNodeIds ?? [],
      outputType: analysis?.outputType === "video" ? "video" : "image",
      templateLabel: "工程智能体生成",
      ...(payload.customBaseUrl?.trim() ? { customBaseUrl: payload.customBaseUrl.trim() } : {}),
    };
    let targetId = payload.appliedNodeId && st.nodes.some((n) => n.id === payload.appliedNodeId) ? payload.appliedNodeId : null;
    const isNew = !targetId;
    if (!targetId) {
      const pos = st.nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
      const node = addNode("comfyui_workflow", { x: pos.x + 460, y: pos.y });
      targetId = node.id;
      update({ appliedNodeId: targetId });
    }
    updateNodeData(targetId, patch);
    if (regenerate) { st.requestRun(null, [targetId]); }
    return { targetId, isNew };
  }, [payload.appliedNodeId, payload.customBaseUrl, id, addNode, updateNodeData, update]);

  // 手动点「同步(并重新生成)」按钮。
  const applyLatest = useCallback((regenerate: boolean) => {
    if (!payload.resultWorkflowJson) return;
    const { isNew } = syncToNode(payload.resultWorkflowJson, payload.resultAnalysis, regenerate);
    toast.success(isNew ? "已写回为 ComfyUI 节点" : "已同步到已链接节点");
    if (regenerate) toast.info("已触发该节点重新生成");
    else if (isNew) setTimeout(() => reactFlow.fitView({ padding: 0.25, duration: 400 }), 60);
  }, [payload.resultWorkflowJson, payload.resultAnalysis, syncToNode, reactFlow]);

  // 应用一次 build 的最终结果（HTTP 返回或 socket 兜底两路共用；幂等——只应用一次）。
  // 从 store 取当前 conversation 追加 agent 轮，避免闭包里的 conv 过期。
  type BuildResult = { status: string; workflowJson?: string; analysis?: SuperAgentNodeData["resultAnalysis"]; iterations?: number; log?: SuperAgentNodeData["log"] };
  const applyBuildResult = useCallback((res: BuildResult) => {
    if (!awaitingBuildRef.current) return; // 已被另一路径应用过 → 幂等跳过（防重复轮次）
    awaitingBuildRef.current = false;
    const st = useCanvasStore.getState();
    const cur = ((st.nodes.find((n) => n.id === id)?.data.payload as SuperAgentNodeData | undefined)?.conversation) ?? [];
    const summary = res.status === "success" ? `✅ 已调通（${res.iterations ?? "?"} 轮）`
      : res.status === "exhausted" ? `⚠️ ${res.iterations ?? "?"} 轮未完全调通，保留最后一版`
      : res.status === "aborted" ? "⏹ 已取消" : "❌ 未能调通";
    const status = res.status as SuperAgentNodeData["status"];
    const agentTurn: Turn = { role: "agent", text: summary, workflowJson: res.workflowJson, status: res.status };
    update({ conversation: [...cur, agentTurn], status, resultWorkflowJson: res.workflowJson, resultAnalysis: res.analysis, log: res.log, pendingBuildResult: undefined });
    if (res.status === "success" && res.workflowJson && payload.appliedNodeId) {
      if (st.nodes.some((n) => n.id === payload.appliedNodeId)) { syncToNode(res.workflowJson, res.analysis, false); toast.success("已同步到链接节点，可点「重新生成」"); }
    }
  }, [id, update, payload.appliedNodeId, syncToNode]);

  // socket 兜底：隧道下 HTTP 长请求被切断（network error）时，服务端把最终结果经 socket 回灌到
  // payload.pendingBuildResult（见 Canvas.tsx 的 superagent:event 处理），这里据此回填、结束「运行中」。
  useEffect(() => {
    if (payload.pendingBuildResult == null) return;
    if (!awaitingBuildRef.current) { update({ pendingBuildResult: undefined }); return; } // 无在飞任务 → 丢弃陈旧结果
    applyBuildResult(payload.pendingBuildResult as BuildResult);
  }, [payload.pendingBuildResult, applyBuildResult, update]);

  // ── ComfyUI 模式：连续对话发送 ──
  // taskOverride：画布助手「自动运行」等场景直接派任务（不依赖输入框内容）。
  const handleSend = useCallback((taskOverride?: string) => {
    if (running) return;
    const instruction = (typeof taskOverride === "string" ? taskOverride : (inputRef.current?.value ?? inputText)).trim();
    if (!instruction) { if (!taskOverride) toast.error("请输入指令"); return; }
    const priorConv = payload.conversation ?? [];
    const isFollowup = !!payload.resultWorkflowJson && priorConv.length > 0;
    const conv: Turn[] = [...priorConv, { role: "user", text: instruction }];
    setInputText("");
    const el = inputRef.current as (HTMLTextAreaElement & { commitValue?: (v: string) => void }) | null;
    el?.commitValue?.(""); // 聚焦时也即时清空（NodeTextArea 聚焦中不采纳外部 value）
    update({ conversation: conv, status: "running", log: [], errorMessage: undefined, pendingBuildResult: undefined });
    awaitingBuildRef.current = true; // 标记「等待结果」——HTTP 或 socket 谁先回都能应用一次
    buildMut.mutate(
      {
        projectId: data.projectId, nodeId: id, task: instruction,
        customBaseUrl: payload.customBaseUrl?.trim() || undefined, model: llmModel,
        ...(payload.maxIterations ? { maxIterations: payload.maxIterations } : {}),
        ...(payload.showAllResources ? { showAllResources: true } : {}),
        ...(payload.useMemory === false ? { useMemory: false } : {}),
        ...(isFollowup ? { seedWorkflowJson: payload.resultWorkflowJson, history: buildHistory(priorConv) } : {}),
      },
      {
        onSuccess: (res) => applyBuildResult(res),
        onError: (e) => {
          // 隧道下长请求可能被切断（cloudflared ~100s/请求），但服务端仍在跑、最终结果会经 socket 回填。
          // 这类网络错误不判失败——保持「运行中」并提示，等 socket 的 pendingBuildResult 到达再回填。
          const netErr = /network|fetch|timeout|timed out|Failed to fetch|Load failed|ERR_|502|503|504|reset|aborted|socket hang/i.test(e.message || "");
          if (netErr && awaitingBuildRef.current) {
            update({ status: "running" });
            toast.info("请求超时（可能是公网隧道对长任务的限制）——任务仍在后台运行，完成后会自动回填结果，请稍候。", { duration: 9000 });
            // 兜底：一段时间后主动拉一次服务端已缓存的最终结果（防 socket 漏收）。
            setTimeout(() => {
              if (!awaitingBuildRef.current) return;
              utils.superAgent.getBuildResult.fetch({ projectId: data.projectId, nodeId: id })
                .then((r) => { if (r?.result && awaitingBuildRef.current) applyBuildResult(r.result as BuildResult); })
                .catch(() => { /* 兜底失败无妨，socket 仍是主路径 */ });
            }, 8000);
            return;
          }
          awaitingBuildRef.current = false;
          update({ status: "failed", errorMessage: e.message, conversation: [...conv, { role: "agent", text: "❌ " + e.message, status: "failed" }] });
          toast.error("运行失败：" + e.message);
        },
      },
    );
  }, [running, inputText, payload.conversation, payload.resultWorkflowJson, payload.customBaseUrl, payload.maxIterations, payload.showAllResources, llmModel, data.projectId, id, buildMut, update, applyBuildResult, utils]);

  // 画布助手「自动运行」：节点带 autoRun+task 建好后自动开跑一次（不需用户点运行）。
  // 一次性：跑前清掉 autoRun 标记，避免刷新/重载/协作方重复触发。
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRanRef.current) return;
    if (mode !== "comfy") return;
    if (!payload.autoRun || !payload.task?.trim()) return;
    if (running || (payload.conversation?.length ?? 0) > 0 || (payload.status && payload.status !== "idle")) return;
    autoRanRef.current = true;
    update({ autoRun: false });
    handleSend(payload.task.trim());
  }, [payload.autoRun, payload.task, payload.status, payload.conversation, mode, running, handleSend, update]);

  // ── 代码任务模式（连续对话：claude --resume 续接同一会话，保留上下文与工作区文件）──
  const handleRunCode = useCallback(() => {
    if (running) return;
    const task = (codeInputRef.current?.value ?? codeInputText).trim();
    if (!task) { toast.error("请先描述代码任务"); return; }
    const priorConv = payload.codeConversation ?? [];
    const resume = priorConv.length > 0 && !!payload.codeSessionId;
    const conv: Turn[] = [...priorConv, { role: "user", text: task }];
    setCodeInputText("");
    const el = codeInputRef.current as (HTMLTextAreaElement & { commitValue?: (v: string) => void }) | null;
    el?.commitValue?.("");
    update({ codeConversation: conv, status: "running", log: [], codeResult: undefined, blockedCommand: undefined, errorMessage: undefined });
    codeMut.mutate(
      { projectId: data.projectId, nodeId: id, task, resume },
      {
        onSuccess: (res) => {
          const isOk = res.status === "success";
          const text = isOk ? (res.result ?? "完成")
            : res.status === "aborted" ? ("⛔ 已拦截危险命令并中止：" + (res.blockedCommand ?? ""))
            : ("❌ " + (res.diagnostic ?? res.result ?? "代码任务失败，无输出"));
          update({
            status: isOk ? "success" : "failed",
            codeConversation: [...conv, { role: "agent", text, status: res.status }],
            codeSessionId: res.sessionId ?? payload.codeSessionId,
            codeResult: isOk ? res.result : undefined,
            blockedCommand: res.blockedCommand,
            errorMessage: isOk ? undefined : (res.diagnostic ?? res.result ?? (res.status === "aborted" ? "已拦截危险命令并中止" : "代码任务失败，无输出")),
            log: res.log.map((e) => ({ type: e.type, iteration: 0, message: e.message })),
          });
          if (isOk) toast.success("代码任务完成");
          else if (res.status === "aborted") toast.error("已拦截危险命令并中止：" + (res.blockedCommand ?? ""));
          else toast.error("代码任务失败：" + (res.diagnostic?.slice(0, 100) ?? "见节点内详情"));
        },
        onError: (e) => { update({ status: "failed", errorMessage: e.message, codeConversation: [...conv, { role: "agent", text: "❌ " + e.message, status: "failed" }] }); toast.error("运行失败：" + e.message); },
      },
    );
  }, [running, codeInputText, payload.codeConversation, payload.codeSessionId, data.projectId, id, codeMut, update]);

  // 新对话：清掉服务端持久工作区 + 前端对话/会话。
  const handleResetCode = useCallback(() => {
    if (running) return;
    resetCodeMut.mutate({ projectId: data.projectId, nodeId: id });
    update({ codeConversation: [], codeSessionId: undefined, codeResult: undefined, blockedCommand: undefined, errorMessage: undefined, status: "idle", log: [] });
    toast.success("已开始新对话");
  }, [running, resetCodeMut, data.projectId, id, update]);

  const log = payload.log ?? [];
  const conversation = payload.conversation ?? [];
  const codeConversation = payload.codeConversation ?? [];
  const settingsOpen = payload.settingsOpen ?? conversation.length === 0;
  const hasResult = (payload.status === "success" || payload.status === "exhausted") && !!payload.resultWorkflowJson;
  const linked = !!payload.appliedNodeId;
  const codeContinuing = codeConversation.length > 0 && !!payload.codeSessionId;

  // 对话/日志自动滚到底。
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [conversation.length, codeConversation.length, log.length]);

  return (
    <BaseNode id={id} selected={selected} nodeType="super_agent" title={data.title} minHeight={340} resizable showHandles={false} capNodeHeight>
      <div className="flex flex-col gap-2" style={{ padding: "2px 2px 4px" }}>
        {/* 模式切换 */}
        <div className="nodrag flex" style={{ gap: 4, background: "var(--c-surface)", padding: 3, borderRadius: 9, border: `1px solid ${BORDER}` }}>
          {([["comfy", "ComfyUI 工作流"], ["code", "代码任务"]] as const).map(([m, label]) => (
            <button key={m} disabled={running} onClick={() => update({ mode: m })}
              className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{ background: mode === m ? accentA(0.18) : "transparent", color: mode === m ? accent : "var(--c-t3)", border: `1px solid ${mode === m ? accentA(0.45) : "transparent"}`, cursor: running ? "not-allowed" : "pointer" }}>
              {label}
            </button>
          ))}
        </div>

        {/* ═══════════ ComfyUI 工作流（连续对话） ═══════════ */}
        {mode === "comfy" && (
          <>
            {/* 折叠式设置：服务器 + 规划模型 */}
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 9, overflow: "hidden" }}>
              <button onClick={() => update({ settingsOpen: !settingsOpen })}
                title="展开设置服务器地址与规划模型"
                className="nodrag flex items-center gap-1.5 w-full" style={{ padding: "6px 9px", background: "var(--c-surface)", border: "none", cursor: "pointer", fontSize: 11, color: "var(--c-t2)", fontWeight: 600 }}>
                <Settings2 style={{ width: 12, height: 12 }} /> 服务器 / 规划模型
                {/* 折叠时也显示当前模型，一眼可见、方便找去哪切换 */}
                {!settingsOpen && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 6, fontSize: 10, fontWeight: 500, color: accent, background: accentA(0.12), border: `1px solid ${accentA(0.35)}`, borderRadius: 6, padding: "1px 6px" }}><Cpu style={{ width: 9, height: 9 }} />{modelShort}</span>}
                {settingsOpen ? <ChevronUp style={{ width: 12, height: 12, marginLeft: "auto" }} /> : <ChevronDown style={{ width: 12, height: 12, marginLeft: "auto" }} />}
              </button>
              {settingsOpen && (
                <div className="flex flex-col gap-2.5" style={{ padding: "9px" }}>
                  <div>
                    <label style={labelStyle}><Server size={9} style={{ display: "inline", marginRight: 3 }} />ComfyUI 服务器（留空用全局默认）</label>
                    <ComfyServerUrlField id={id} value={payload.customBaseUrl ?? ""} onChange={(v) => update({ customBaseUrl: v })}
                      serverUrls={payload.serverUrls ?? []} onChangeServerUrls={(next) => update({ serverUrls: next })}
                      isFetching={testingServer} onRefresh={handleTestServer}
                      accent={accent} borderAccent={accentA(0.5)} borderDefault={BORDER} fieldBase={fieldStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}><Cpu size={9} style={{ display: "inline", marginRight: 3 }} />规划模型（默认 kie Claude Opus 4.7）</label>
                    <LLMModelPicker value={llmModel} onChange={(v) => update({ model: v })} disabled={running} />
                  </div>
                  <div>
                    <label style={labelStyle}>
                      <Settings2 size={9} style={{ display: "inline", marginRight: 3 }} />最大自驱轮次：<b style={{ color: accent }}>{payload.maxIterations ?? 20}</b>
                      <span style={{ color: "var(--c-t4)", marginLeft: 4 }}>（越高越能自愈复杂工作流，但更慢/更耗；不建议无限——调不通会烧钱）</span>
                    </label>
                    <input type="range" min={4} max={60} step={1} value={payload.maxIterations ?? 20} disabled={running}
                      onChange={(e) => update({ maxIterations: Number(e.target.value) })}
                      className="nodrag" style={{ width: "100%", accentColor: accent, cursor: running ? "not-allowed" : "pointer" }} />
                  </div>
                  <label style={{ ...labelStyle, display: "flex", alignItems: "flex-start", gap: 6, cursor: running ? "not-allowed" : "pointer" }}>
                    <input type="checkbox" checked={payload.showAllResources ?? false} disabled={running}
                      onChange={(e) => update({ showAllResources: e.target.checked })}
                      className="nodrag" style={{ marginTop: 1, accentColor: accent }} />
                    <span>加载全部模型 / LoRA / 节点（不截断）<br />
                      <span style={{ color: "var(--c-t4)" }}>把服务器上全部已装资源都摆给智能体，避免名单被截断。资源极多时更耗 token，建议配大上下文模型；不勾也能用 search_resources 按需检索。</span>
                    </span>
                  </label>
                  <label style={{ ...labelStyle, display: "flex", alignItems: "flex-start", gap: 6, cursor: running ? "not-allowed" : "pointer" }}>
                    <input type="checkbox" checked={payload.useMemory ?? true} disabled={running}
                      onChange={(e) => update({ useMemory: e.target.checked })}
                      className="nodrag" style={{ marginTop: 1, accentColor: accent }} />
                    <span>使用记忆体（资源记忆 + 工作流经验）<br />
                      <span style={{ color: "var(--c-t4)" }}>默认开：复用已学的服务器资源、并参考历史成功工作流，越用越快。关掉则本次忽略记忆、直接读真机（成功经验仍会照常沉淀）。</span>
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* 链接状态 */}
            {linked && (
              <div className="flex items-center gap-1" style={{ fontSize: 10.5, color: accent }}>
                <ArrowRightCircle style={{ width: 11, height: 11 }} /> 已链接一个 ComfyUI 节点：调通后自动同步，可一键重新生成
              </div>
            )}

            {/* 对话 + 活动日志 */}
            {(conversation.length > 0 || log.length > 0) && (
              <div ref={feedRef} className="nowheel flex flex-col gap-1.5" style={{ maxHeight: 240, overflowY: "auto", background: "var(--c-canvas)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px" }}>
                {conversation.map((t, i) => (
                  t.role === "user" ? (
                    <div key={i} style={{ alignSelf: "flex-end", maxWidth: "88%", background: accentA(0.16), border: `1px solid ${accentA(0.4)}`, borderRadius: "9px 9px 2px 9px", padding: "5px 9px", fontSize: 11.5, color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.text}</div>
                  ) : (
                    <div key={i} style={{ alignSelf: "flex-start", maxWidth: "92%", fontSize: 11.5, color: t.status === "success" ? GREEN : t.status === "failed" ? RED : "var(--c-t2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.text}</div>
                  )
                ))}
                {/* 运行中的实时活动日志 */}
                {running && log.length > 0 && (
                  <div style={{ borderTop: conversation.length ? `1px dashed ${BORDER}` : "none", paddingTop: conversation.length ? 6 : 0, marginTop: 2, fontFamily: "ui-monospace, monospace", fontSize: 10.5, lineHeight: 1.55 }}>
                    {log.slice(-40).map((e, i) => (
                      <div key={i} style={{ color: logColor(e.type), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.iteration > 0 ? `[${e.iteration}] ` : ""}{e.message}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 结果 → 同步 / 重新生成 */}
            {hasResult && !running && (
              <div className="flex flex-col gap-1.5">
                <button onClick={() => applyLatest(true)}
                  className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold"
                  style={{ background: accentA(0.16), border: `1px solid ${accentA(0.5)}`, color: accent, cursor: "pointer" }}>
                  <RefreshCw style={{ width: 13, height: 13 }} /> {linked ? "同步到节点并重新生成" : "写回为 ComfyUI 节点并生成"}
                </button>
                <button onClick={() => applyLatest(false)}
                  className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md text-[11px]"
                  style={{ background: "var(--c-surface)", border: `1px solid ${BORDER}`, color: "var(--c-t3)", cursor: "pointer" }}>
                  <ArrowRightCircle style={{ width: 12, height: 12 }} /> {linked ? "仅同步（不生成）" : "仅写回（不生成）"}
                </button>
              </div>
            )}

            {/* 停止 */}
            {running && (
              <button onClick={handleCancel} disabled={cancelMut.isPending}
                className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "oklch(0.62 0.2 25 / 0.10)", border: `1px solid ${RED}`, color: RED, cursor: "pointer" }}>
                <Square style={{ width: 12, height: 12 }} /> 停止
              </button>
            )}

            {/* 聊天输入 */}
            <div className="nodrag flex items-end gap-1.5">
              <NodeTextArea
                ref={inputRef} noMention noSlash
                className="nodrag" rows={2} disabled={running}
                placeholder={conversation.length === 0 ? "描述要做的工作流，例：SDXL 文生图 1024×1024 带细节 LoRA" : "继续调整，例：改成 9:16 / 加个高清放大 / 换个 checkpoint"}
                value={inputText} onValueChange={setInputText}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); } }}
                style={{ ...fieldStyle, resize: "vertical", flex: 1 }}
              />
              <button onClick={() => handleSend()} disabled={running}
                className="nodrag flex items-center justify-center rounded-lg" style={{ width: 38, height: 38, flexShrink: 0, background: running ? "var(--c-surface)" : accentA(0.16), border: `1px solid ${running ? BORDER : accentA(0.5)}`, color: running ? "var(--c-t4)" : accent, cursor: running ? "not-allowed" : "pointer" }}
                title="发送（Enter 发送，Shift+Enter 换行）">
                {running ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> : <Send style={{ width: 15, height: 15 }} />}
              </button>
            </div>
          </>
        )}

        {/* ═══════════ 代码任务（连续对话） ═══════════ */}
        {mode === "code" && (
          <>
            <div style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.5 }}>
              服务端在隔离工作区跑无头 Claude Code，可连续对话（记得上下文与工作区文件）；危险命令由 commandPolicy 拦截。需超管 L4 + 服务端开启。
            </div>
            {!codeEnabled && !codeStatus.isLoading && (
              <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.7 0.16 60 / 0.08)", border: "1px solid oklch(0.7 0.16 60 / 0.3)", fontSize: 11, color: "oklch(0.62 0.14 60)" }}>
                代码任务未启用。需服务端设置 <code>SUPER_AGENT_CODE_ENABLED=1</code>（放行 shell 再加 <code>SUPER_AGENT_CODE_ALLOW_BASH=1</code>），且当前用户为超级管理员 L4。
              </div>
            )}
            {/* 安全边界：一眼可见有没有放行 Shell（决定它能不能碰这台机器上的真实文件） */}
            {codeEnabled && (
              bashAllowed ? (
                <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.2 25 / 0.08)", border: `1px solid ${RED}`, fontSize: 10.5, color: RED, lineHeight: 1.5 }}>
                  <XCircle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
                  <span>已放行 Shell：可在本机以服务账号权限跑命令，<b>能读写工作区以外的文件</b>（危险命令仍被 commandPolicy 拦截）。只想安全用请让运维去掉 <code>SUPER_AGENT_CODE_ALLOW_BASH</code>。</span>
                </div>
              ) : (
                <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.65 0.2 155 / 0.08)", border: `1px solid ${GREEN}`, fontSize: 10.5, color: "var(--c-t2)", lineHeight: 1.5 }}>
                  <Boxes style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1, color: GREEN }} />
                  <span><b style={{ color: GREEN }}>只读沙箱</b>：仅在一次性隔离工作区读写，<b>碰不到你的项目/服务器代码</b>（未放行 Shell）。</span>
                </div>
              )
            )}

            {/* 连续对话状态 + 新对话 */}
            {codeContinuing && (
              <div className="flex items-center gap-1.5" style={{ fontSize: 10.5, color: accent }}>
                <ArrowRightCircle style={{ width: 11, height: 11 }} /> 连续对话中，claude 记得上下文与工作区文件
                <button onClick={handleResetCode} disabled={running} title="清空会话与工作区，从头开始"
                  className="nodrag" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--c-t3)", background: "var(--c-surface)", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "1px 7px", cursor: running ? "not-allowed" : "pointer" }}>
                  <RefreshCw style={{ width: 9, height: 9 }} /> 新对话
                </button>
              </div>
            )}

            {/* 对话 + 活动日志 */}
            {(codeConversation.length > 0 || (running && log.length > 0)) && (
              <div ref={feedRef} className="nowheel flex flex-col gap-1.5" style={{ maxHeight: 260, overflowY: "auto", background: "var(--c-canvas)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px" }}>
                {codeConversation.map((t, i) => (
                  t.role === "user" ? (
                    <div key={i} style={{ alignSelf: "flex-end", maxWidth: "88%", background: accentA(0.16), border: `1px solid ${accentA(0.4)}`, borderRadius: "9px 9px 2px 9px", padding: "5px 9px", fontSize: 11.5, color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.text}</div>
                  ) : (
                    <div key={i} style={{ alignSelf: "flex-start", maxWidth: "94%", fontSize: 11.5, color: t.status === "success" ? "var(--c-t1)" : RED, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: t.status === "success" ? undefined : "ui-monospace, monospace", lineHeight: 1.5 }}>{t.text}</div>
                  )
                ))}
                {running && log.length > 0 && (
                  <div style={{ borderTop: codeConversation.length ? `1px dashed ${BORDER}` : "none", paddingTop: codeConversation.length ? 6 : 0, marginTop: 2, fontFamily: "ui-monospace, monospace", fontSize: 10.5, lineHeight: 1.55 }}>
                    {log.slice(-40).map((e, i) => (
                      <div key={i} style={{ color: logColor(e.type), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.message}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {payload.blockedCommand && (
              <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.2 25 / 0.08)", border: `1px solid ${RED}`, fontSize: 11.5, color: RED }}>
                已拦截危险命令并中止：<code style={{ wordBreak: "break-all" }}>{payload.blockedCommand}</code>
              </div>
            )}

            {/* 停止 */}
            {running && (
              <button onClick={handleCancel} disabled={cancelMut.isPending}
                className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "oklch(0.62 0.2 25 / 0.10)", border: `1px solid ${RED}`, color: RED, cursor: "pointer" }}>
                <Square style={{ width: 12, height: 12 }} /> 停止
              </button>
            )}

            {/* 聊天输入 */}
            <div className="nodrag flex items-end gap-1.5">
              <NodeTextArea
                ref={codeInputRef} noMention noSlash
                className="nodrag" rows={2} disabled={running || !codeEnabled}
                placeholder={codeConversation.length === 0 ? "描述代码任务，例：读取工作区里的 err.log，定位报错根因并写修复说明" : "继续追问或让它接着改，例：把修复也应用上并跑一遍测试"}
                value={codeInputText} onValueChange={setCodeInputText}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleRunCode(); } }}
                style={{ ...fieldStyle, resize: "vertical", flex: 1 }}
              />
              <button onClick={handleRunCode} disabled={running || !codeEnabled}
                className="nodrag flex items-center justify-center rounded-lg" style={{ width: 38, height: 38, flexShrink: 0, background: running || !codeEnabled ? "var(--c-surface)" : accentA(0.16), border: `1px solid ${running || !codeEnabled ? BORDER : accentA(0.5)}`, color: running || !codeEnabled ? "var(--c-t4)" : accent, cursor: running || !codeEnabled ? "not-allowed" : "pointer" }}
                title="运行（Enter 发送，Shift+Enter 换行）">
                {running ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> : <Send style={{ width: 15, height: 15 }} />}
              </button>
            </div>
          </>
        )}

        <div className="flex items-center gap-1" style={{ fontSize: 10, color: "var(--c-t4)" }}>
          <Boxes style={{ width: 11, height: 11 }} /> 需管理员 L3+ · 仅本地自建 ComfyUI
        </div>
      </div>
    </BaseNode>
  );
});
