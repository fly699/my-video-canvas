import { memo, useCallback, useRef, useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Boxes, Loader2, Play, XCircle, ArrowRightCircle, Square, Server, Cpu, Send, RefreshCw, Settings2, ChevronDown, ChevronUp } from "lucide-react";
import { ComfyServerUrlField } from "./ComfyServerUrlField";
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
  const running = payload.status === "running" || buildMut.isPending || codeMut.isPending;

  const utils = trpc.useUtils();
  const [testingServer, setTestingServer] = useState(false);
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

  // ── ComfyUI 模式：连续对话发送 ──
  const handleSend = useCallback(() => {
    if (running) return;
    const instruction = (payload.input ?? "").trim();
    if (!instruction) { toast.error("请输入指令"); return; }
    const priorConv = payload.conversation ?? [];
    const isFollowup = !!payload.resultWorkflowJson && priorConv.length > 0;
    const conv: Turn[] = [...priorConv, { role: "user", text: instruction }];
    update({ conversation: conv, input: "", status: "running", log: [], errorMessage: undefined });
    buildMut.mutate(
      {
        projectId: data.projectId, nodeId: id, task: instruction,
        customBaseUrl: payload.customBaseUrl?.trim() || undefined, model: llmModel,
        ...(isFollowup ? { seedWorkflowJson: payload.resultWorkflowJson, history: buildHistory(priorConv) } : {}),
      },
      {
        onSuccess: (res) => {
          const summary = res.status === "success" ? `✅ 已调通（${res.iterations} 轮）`
            : res.status === "exhausted" ? `⚠️ ${res.iterations} 轮未完全调通，保留最后一版`
            : res.status === "aborted" ? "⏹ 已取消" : "❌ 未能调通";
          const agentTurn: Turn = { role: "agent", text: summary, workflowJson: res.workflowJson, status: res.status };
          update({ conversation: [...conv, agentTurn], status: res.status, resultWorkflowJson: res.workflowJson, resultAnalysis: res.analysis, log: res.log });
          // 已链接节点：调通后自动把新工作流同步过去（不自动跑，重新生成一键触发）。
          if (res.status === "success" && res.workflowJson && payload.appliedNodeId) {
            const st = useCanvasStore.getState();
            if (st.nodes.some((n) => n.id === payload.appliedNodeId)) { syncToNode(res.workflowJson, res.analysis, false); toast.success("已同步到链接节点，可点「重新生成」"); }
          }
        },
        onError: (e) => { update({ status: "failed", errorMessage: e.message, conversation: [...conv, { role: "agent", text: "❌ " + e.message, status: "failed" }] }); toast.error("运行失败：" + e.message); },
      },
    );
  }, [running, payload.input, payload.conversation, payload.resultWorkflowJson, payload.customBaseUrl, payload.appliedNodeId, llmModel, data.projectId, id, buildMut, update, syncToNode]);

  // ── 代码任务模式 ──
  const handleRunCode = useCallback(() => {
    if (running) return;
    const task = (payload.task ?? "").trim();
    if (!task) { toast.error("请先描述代码任务"); return; }
    update({ status: "running", log: [], codeResult: undefined, blockedCommand: undefined, errorMessage: undefined });
    codeMut.mutate(
      { projectId: data.projectId, nodeId: id, task },
      {
        onSuccess: (res) => {
          update({ status: res.status === "success" ? "success" : "failed", codeResult: res.result, blockedCommand: res.blockedCommand, log: res.log.map((e) => ({ type: e.type, iteration: 0, message: e.message })) });
          if (res.status === "success") toast.success("代码任务完成");
          else if (res.status === "aborted") toast.error("已拦截危险命令并中止：" + (res.blockedCommand ?? ""));
          else toast.error("代码任务失败");
        },
        onError: (e) => { update({ status: "failed", errorMessage: e.message }); toast.error("运行失败：" + e.message); },
      },
    );
  }, [running, payload.task, data.projectId, id, codeMut, update]);

  const log = payload.log ?? [];
  const conversation = payload.conversation ?? [];
  const settingsOpen = payload.settingsOpen ?? conversation.length === 0;
  const hasResult = (payload.status === "success" || payload.status === "exhausted") && !!payload.resultWorkflowJson;
  const linked = !!payload.appliedNodeId;

  // 对话/日志自动滚到底。
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [conversation.length, log.length]);

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
              <textarea
                className="nodrag" rows={2} disabled={running}
                placeholder={conversation.length === 0 ? "描述要做的工作流，例：SDXL 文生图 1024×1024 带细节 LoRA" : "继续调整，例：改成 9:16 / 加个高清放大 / 换个 checkpoint"}
                value={payload.input ?? ""} onChange={(e) => update({ input: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                style={{ ...fieldStyle, resize: "vertical", flex: 1 }}
              />
              <button onClick={handleSend} disabled={running}
                className="nodrag flex items-center justify-center rounded-lg" style={{ width: 38, height: 38, flexShrink: 0, background: running ? "var(--c-surface)" : accentA(0.16), border: `1px solid ${running ? BORDER : accentA(0.5)}`, color: running ? "var(--c-t4)" : accent, cursor: running ? "not-allowed" : "pointer" }}
                title="发送（Enter 发送，Shift+Enter 换行）">
                {running ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> : <Send style={{ width: 15, height: 15 }} />}
              </button>
            </div>
          </>
        )}

        {/* ═══════════ 代码任务 ═══════════ */}
        {mode === "code" && (
          <>
            <div style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.5 }}>
              描述代码任务，服务端在一次性隔离工作区跑无头 Claude Code；危险命令由 commandPolicy 拦截。需超管 L4 + 服务端开启。
            </div>
            <div>
              <label style={labelStyle}>代码任务</label>
              <textarea className="nodrag" rows={3} disabled={running}
                placeholder="例：读取工作区里的 err.log，定位报错根因并写一份修复说明"
                value={payload.task ?? ""} onChange={(e) => update({ task: e.target.value })} style={{ ...fieldStyle, resize: "vertical" }} />
            </div>
            {!codeEnabled && !codeStatus.isLoading && (
              <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.7 0.16 60 / 0.08)", border: "1px solid oklch(0.7 0.16 60 / 0.3)", fontSize: 11, color: "oklch(0.62 0.14 60)" }}>
                代码任务未启用。需服务端设置 <code>SUPER_AGENT_CODE_ENABLED=1</code>（放行 shell 再加 <code>SUPER_AGENT_CODE_ALLOW_BASH=1</code>），且当前用户为超级管理员 L4。
              </div>
            )}
            <button onClick={handleRunCode} disabled={running || !codeEnabled}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold"
              style={{ background: running || !codeEnabled ? "var(--c-surface)" : accentA(0.14), border: `1px solid ${running || !codeEnabled ? BORDER : accentA(0.5)}`, color: running || !codeEnabled ? "var(--c-t4)" : accent, cursor: running || !codeEnabled ? "not-allowed" : "pointer" }}>
              {running ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Play style={{ width: 13, height: 13 }} />}
              {running ? "运行中…" : "运行代码任务"}
            </button>
            {running && (
              <button onClick={handleCancel} disabled={cancelMut.isPending}
                className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "oklch(0.62 0.2 25 / 0.10)", border: `1px solid ${RED}`, color: RED, cursor: "pointer" }}>
                <Square style={{ width: 12, height: 12 }} /> 停止
              </button>
            )}
            {log.length > 0 && (
              <div ref={feedRef} className="nowheel" style={{ maxHeight: 200, overflowY: "auto", background: "var(--c-canvas)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 9px", fontSize: 11, lineHeight: 1.6, fontFamily: "ui-monospace, monospace" }}>
                {log.map((e, i) => (<div key={i} style={{ color: logColor(e.type), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.message}</div>))}
              </div>
            )}
            {payload.blockedCommand && (
              <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.2 25 / 0.08)", border: `1px solid ${RED}`, fontSize: 11.5, color: RED }}>
                已拦截危险命令并中止：<code style={{ wordBreak: "break-all" }}>{payload.blockedCommand}</code>
              </div>
            )}
            {payload.status === "success" && payload.codeResult && (
              <div className="nowheel px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.65 0.2 155 / 0.08)", border: `1px solid ${GREEN}`, fontSize: 11.5, color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 180, overflowY: "auto" }}>
                {payload.codeResult}
              </div>
            )}
            {payload.status === "failed" && payload.errorMessage && (
              <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.2 25 / 0.08)", border: `1px solid ${RED}` }}>
                <XCircle style={{ width: 13, height: 13, color: RED, flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 11.5, color: RED }}>{payload.errorMessage}</span>
              </div>
            )}
          </>
        )}

        <div className="flex items-center gap-1" style={{ fontSize: 10, color: "var(--c-t4)" }}>
          <Boxes style={{ width: 11, height: 11 }} /> 需管理员 L3+ · 仅本地自建 ComfyUI
        </div>
      </div>
    </BaseNode>
  );
});
