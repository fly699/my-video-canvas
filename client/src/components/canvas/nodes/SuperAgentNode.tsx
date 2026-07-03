import { memo, useCallback, useRef, useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Boxes, Loader2, Play, CheckCircle2, XCircle, ArrowRightCircle } from "lucide-react";
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

  const buildMut = trpc.superAgent.buildComfyWorkflow.useMutation();
  const running = payload.status === "running" || buildMut.isPending;

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
        <div style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.5 }}>
          描述工程任务，服务端自动「写 ComfyUI 工作流 → 校验 → 真机运行 → 读错 → 修正」直到调通，全程无需你手写 JSON。
        </div>

        <div>
          <label style={labelStyle}>工程任务</label>
          <textarea
            className="nodrag" rows={3} disabled={running}
            placeholder="例：做一个 SDXL 文生图工作流，1024×1024，带一个细节 LoRA，并调通"
            value={payload.task ?? ""} onChange={(e) => update({ task: e.target.value })}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>

        <div>
          <label style={labelStyle}>目标 ComfyUI 服务器（留空用服务端默认）</label>
          <input
            className="nodrag" disabled={running} placeholder="http://127.0.0.1:8188"
            value={payload.baseUrl ?? ""} onChange={(e) => update({ baseUrl: e.target.value })}
            style={fieldStyle}
          />
        </div>

        <button
          onClick={handleRun} disabled={running}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: running ? "var(--c-surface)" : accentA(0.14),
            border: `1px solid ${running ? BORDER : accentA(0.5)}`,
            color: running ? "var(--c-t4)" : accent,
            cursor: running ? "not-allowed" : "pointer",
          }}
        >
          {running ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Play style={{ width: 13, height: 13 }} />}
          {running ? "工程智能体运行中…" : "运行工程智能体"}
        </button>

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

        <div className="flex items-center gap-1" style={{ fontSize: 10, color: "var(--c-t4)" }}>
          <Boxes style={{ width: 11, height: 11 }} /> 需管理员 L3+ · 仅本地自建 ComfyUI（Phase 1）
        </div>
      </div>
    </BaseNode>
  );
});
