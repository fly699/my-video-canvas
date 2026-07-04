import { memo, useCallback, useRef, useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Boxes, Loader2, Play, CheckCircle2, XCircle, ArrowRightCircle, Square, Server } from "lucide-react";
import { ComfyServerUrlField } from "./ComfyServerUrlField";
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

const labelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
  color: "var(--c-t4)", display: "block", marginBottom: 5,
};
const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 12, background: "var(--c-input)",
  borderWidth: 1, borderStyle: "solid", borderColor: BORDER, borderRadius: 8,
  color: "var(--c-t1)", outline: "none", lineHeight: 1.5,
};

/** 事件类型 → 活动日志前缀色。 */
function logColor(type: string): string {
  switch (type) {
    case "error": return "oklch(0.7 0.18 25)";
    case "done": return "oklch(0.65 0.2 155)";
    case "action": return "oklch(0.72 0.16 285)";
    case "tool_result": return "var(--c-t2)";
    default: return "var(--c-t3)";
  }
}

export const SuperAgentNode = memo(function SuperAgentNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const addNode = useCanvasStore((s) => s.addNode);
  const reactFlow = useReactFlow();
  const payload = data.payload;
  const update = useCallback((patch: Partial<SuperAgentNodeData>) => updateNodeData(id, patch), [id, updateNodeData]);

  const mode = payload.mode ?? "comfy";
  const buildMut = trpc.superAgent.buildComfyWorkflow.useMutation();
  const codeMut = trpc.superAgent.runCodeTask.useMutation();
  // code 模式可用性（L3+ 才有权查询；查询失败/无权 → 视为不可用）。
  const codeStatus = trpc.superAgent.codeStatus.useQuery(undefined, { enabled: mode === "code", retry: false });
  const codeEnabled = codeStatus.data?.enabled === true;
  const running = payload.status === "running" || buildMut.isPending || codeMut.isPending;

  // ComfyUI 服务器测试/拉取（与其它 ComfyUI 节点一致）：探 fetchModels 验证可达 + 报模型数。
  const utils = trpc.useUtils();
  const [testingServer, setTestingServer] = useState(false);
  const handleTestServer = useCallback(async () => {
    setTestingServer(true);
    try {
      const r = await utils.comfyui.fetchModels.fetch({ customBaseUrl: payload.baseUrl?.trim() || undefined });
      toast.success(`连接成功 — checkpoint ${r.ckpts.length} · LoRA ${r.loras.length} · 采样器 ${r.samplers.length}`);
    } catch (e) {
      toast.error("连接失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 120));
    } finally { setTestingServer(false); }
  }, [utils, payload.baseUrl]);

  const cancelMut = trpc.superAgent.cancel.useMutation();
  const handleCancel = useCallback(() => {
    cancelMut.mutate({ projectId: data.projectId, nodeId: id }, {
      onSuccess: (r) => { toast[r.cancelled ? "success" : "info"](r.cancelled ? "已请求停止…" : "没有正在运行的任务"); },
      onError: (e) => toast.error("停止失败：" + e.message),
    });
  }, [cancelMut, data.projectId, id]);

  // 活动日志自动滚到底。
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [payload.log?.length]);

  const handleRun = useCallback(() => {
    if (running) return;
    const task = (payload.task ?? "").trim();
    if (!task) { toast.error("请先描述工程任务"); return; }
    // 清空上一轮日志/结果，进入运行态（日志由 Canvas 的 socket 处理器回灌 payload.log）。
    update({ status: "running", log: [], resultWorkflowJson: undefined, resultAnalysis: undefined, errorMessage: undefined });
    buildMut.mutate(
      { projectId: data.projectId, nodeId: id, task, baseUrl: payload.baseUrl?.trim() || undefined },
      {
        onSuccess: (res) => {
          update({
            status: res.status,
            resultWorkflowJson: res.workflowJson,
            resultAnalysis: res.analysis,
            // socket 若漏事件，用返回的完整日志兜底。
            log: res.log,
          });
          if (res.status === "success") toast.success(`工作流已调通（${res.iterations} 轮）`);
          else if (res.status === "exhausted") toast.warning(`已达最大轮数未调通（${res.iterations} 轮），保留最后一版`);
          else toast.error("未能调通工作流");
        },
        onError: (e) => { update({ status: "failed", errorMessage: e.message }); toast.error("运行失败：" + e.message); },
      },
    );
  }, [running, payload.task, payload.baseUrl, data.projectId, id, buildMut, update]);

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

  // 把调通（或最后一版）的 workflowJson 写回一个新的 comfyui_workflow 画布节点。
  const handleApply = useCallback(() => {
    if (!payload.resultWorkflowJson) return;
    const pos = useCanvasStore.getState().nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
    const node = addNode("comfyui_workflow", { x: pos.x + 460, y: pos.y });
    const a = payload.resultAnalysis;
    updateNodeData(node.id, {
      workflowJson: payload.resultWorkflowJson,
      paramBindings: (a?.paramBindings ?? []) as WorkflowParamBinding[],
      outputNodeIds: a?.outputNodeIds ?? [],
      outputType: (a?.outputType === "video" ? "video" : "image"),
      templateLabel: "工程智能体生成",
      ...(payload.baseUrl?.trim() ? { customBaseUrl: payload.baseUrl.trim() } : {}),
    });
    toast.success("已写回为 ComfyUI 自定义节点，可直接运行");
    setTimeout(() => reactFlow.fitView({ padding: 0.25, duration: 400 }), 60);
  }, [payload.resultWorkflowJson, payload.resultAnalysis, payload.baseUrl, id, addNode, updateNodeData, reactFlow]);

  const log = payload.log ?? [];

  return (
    <BaseNode id={id} selected={selected} nodeType="super_agent" title={data.title} minHeight={320} resizable showHandles={false} capNodeHeight>
      <div className="flex flex-col gap-2.5" style={{ padding: "2px 2px 4px" }}>
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

        <div style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.5 }}>
          {mode === "comfy"
            ? "描述工程任务，服务端自动「写 ComfyUI 工作流 → 校验 → 真机运行 → 读错 → 修正」直到调通，全程无需你手写 JSON。"
            : "描述代码任务，服务端在一次性隔离工作区跑无头 Claude Code；危险命令由 commandPolicy 拦截。需超管 L4 + 服务端开启。"}
        </div>

        <div>
          <label style={labelStyle}>{mode === "comfy" ? "工程任务" : "代码任务"}</label>
          <textarea
            className="nodrag" rows={3} disabled={running}
            placeholder={mode === "comfy" ? "例：做一个 SDXL 文生图工作流，1024×1024，带一个细节 LoRA，并调通" : "例：读取工作区里的 err.log，定位报错根因并写一份修复说明"}
            value={payload.task ?? ""} onChange={(e) => update({ task: e.target.value })}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>

        {mode === "comfy" && (
          <div>
            <label style={labelStyle}>
              <Server size={9} style={{ display: "inline", marginRight: 3 }} />
              ComfyUI 服务器（留空用全局默认 · 可保存/切换/测试）
            </label>
            <ComfyServerUrlField
              id={id}
              value={payload.baseUrl ?? ""}
              onChange={(v) => update({ baseUrl: v })}
              serverUrls={payload.serverUrls ?? []}
              onChangeServerUrls={(next) => update({ serverUrls: next })}
              isFetching={testingServer}
              onRefresh={handleTestServer}
              accent={accent}
              borderAccent={accentA(0.5)}
              borderDefault={BORDER}
              fieldBase={fieldStyle}
            />
          </div>
        )}

        {mode === "code" && !codeEnabled && !codeStatus.isLoading && (
          <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.7 0.16 60 / 0.08)", border: "1px solid oklch(0.7 0.16 60 / 0.3)", fontSize: 11, color: "oklch(0.62 0.14 60)" }}>
            代码任务未启用。需服务端设置 <code>SUPER_AGENT_CODE_ENABLED=1</code>（放行 shell 再加 <code>SUPER_AGENT_CODE_ALLOW_BASH=1</code>），且当前用户为超级管理员 L4。
          </div>
        )}

        <button
          onClick={mode === "comfy" ? handleRun : handleRunCode}
          disabled={running || (mode === "code" && !codeEnabled)}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: running || (mode === "code" && !codeEnabled) ? "var(--c-surface)" : accentA(0.14),
            border: `1px solid ${running || (mode === "code" && !codeEnabled) ? BORDER : accentA(0.5)}`,
            color: running || (mode === "code" && !codeEnabled) ? "var(--c-t4)" : accent,
            cursor: running || (mode === "code" && !codeEnabled) ? "not-allowed" : "pointer",
          }}
        >
          {running ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Play style={{ width: 13, height: 13 }} />}
          {running ? "工程智能体运行中…" : mode === "comfy" ? "运行工程智能体" : "运行代码任务"}
        </button>

        {running && (
          <button
            onClick={handleCancel} disabled={cancelMut.isPending}
            className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: "oklch(0.62 0.2 25 / 0.10)", border: "1px solid oklch(0.62 0.2 25 / 0.4)", color: "oklch(0.62 0.2 25)", cursor: "pointer" }}
          >
            <Square style={{ width: 12, height: 12 }} /> 停止
          </button>
        )}

        {/* 活动日志（socket 流式回灌） */}
        {log.length > 0 && (
          <div
            ref={logRef}
            className="nowheel"
            style={{
              maxHeight: 200, overflowY: "auto", background: "var(--c-canvas)",
              border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 9px",
              fontSize: 11, lineHeight: 1.6, fontFamily: "ui-monospace, monospace",
            }}
          >
            {log.map((e, i) => (
              <div key={i} style={{ color: logColor(e.type), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {e.iteration > 0 ? `[${e.iteration}] ` : ""}{e.message}
              </div>
            ))}
          </div>
        )}

        {/* 结果 + 写回 */}
        {payload.status === "success" && payload.resultWorkflowJson && (
          <div className="flex flex-col gap-2 px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.65 0.2 155 / 0.08)", border: "1px solid oklch(0.65 0.2 155 / 0.35)" }}>
            <div className="flex items-center gap-1.5" style={{ fontSize: 12, color: "oklch(0.6 0.18 155)", fontWeight: 600 }}>
              <CheckCircle2 style={{ width: 14, height: 14 }} /> 工作流已调通
            </div>
            <button
              onClick={handleApply}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md text-xs font-medium"
              style={{ background: accentA(0.14), border: `1px solid ${accentA(0.5)}`, color: accent, cursor: "pointer" }}
            >
              <ArrowRightCircle style={{ width: 13, height: 13 }} /> 写回为 ComfyUI 自定义节点
            </button>
          </div>
        )}
        {payload.status === "exhausted" && payload.resultWorkflowJson && (
          <button
            onClick={handleApply}
            className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md text-xs font-medium"
            style={{ background: "var(--c-surface)", border: `1px solid ${BORDER}`, color: "var(--c-t2)", cursor: "pointer" }}
          >
            <ArrowRightCircle style={{ width: 13, height: 13 }} /> 未完全调通 · 仍写回最后一版
          </button>
        )}
        {payload.status === "failed" && payload.errorMessage && (
          <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.2 25 / 0.08)", border: "1px solid oklch(0.62 0.2 25 / 0.3)" }}>
            <XCircle style={{ width: 13, height: 13, color: "oklch(0.62 0.2 25)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11.5, color: "oklch(0.62 0.2 25)" }}>{payload.errorMessage}</span>
          </div>
        )}

        {/* code 模式：被拦截的危险命令 */}
        {payload.blockedCommand && (
          <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.2 25 / 0.08)", border: "1px solid oklch(0.62 0.2 25 / 0.3)", fontSize: 11.5, color: "oklch(0.62 0.2 25)" }}>
            已拦截危险命令并中止：<code style={{ wordBreak: "break-all" }}>{payload.blockedCommand}</code>
          </div>
        )}
        {/* code 模式：任务结果文本 */}
        {mode === "code" && payload.status === "success" && payload.codeResult && (
          <div className="nowheel px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.65 0.2 155 / 0.08)", border: "1px solid oklch(0.65 0.2 155 / 0.3)", fontSize: 11.5, color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 180, overflowY: "auto" }}>
            {payload.codeResult}
          </div>
        )}

        <div className="flex items-center gap-1" style={{ fontSize: 10, color: "var(--c-t4)" }}>
          <Boxes style={{ width: 11, height: 11 }} /> 需管理员 L3+ · 仅本地自建 ComfyUI（Phase 1）
        </div>
      </div>
    </BaseNode>
  );
});
