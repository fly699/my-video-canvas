import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { createPortal } from "react-dom";
import { Sparkles, Send, Loader2, X, Plus, Link2, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { buildGraphSummary, applyAgentOperations } from "@/lib/agentApply";
import { resolveActiveNodeModel } from "../../contexts/NodeDefaultModelsContext";
import { LLMModelPicker, type LLMModelId } from "./LLMModelPicker";
import type { AgentOperation } from "../../../../shared/types";

/** 浮动「画布助手」：在角落对话，让 AI（如本机 Claude）边聊边直接改画布。
 *  复用与「智能体节点」同一套引擎——agent.chat 规划 + buildGraphSummary 看实时画布 +
 *  applyAgentOperations 落地（create/connect/update/delete），只是脱离节点、常驻浮层、自动应用。
 *  结构性操作（建/连/改/删）会自动落地且不产生费用；「运行/生成」仍需你在节点上点运行（防误烧额度）。 */
type Turn = { role: "user" | "assistant"; content: string; applied?: string; failed?: string; error?: boolean };

const accent = "oklch(0.70 0.20 310)";

export function CanvasAgentChat({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const reactFlow = useReactFlow();
  const chat = trpc.agent.chat.useMutation();
  const templatesQuery = trpc.comfyTemplates.list.useQuery(undefined, { staleTime: 30_000 });

  const [turns, setTurns] = useState<Turn[]>(() => {
    try { const s = localStorage.getItem(`avc:canvasAgent:${projectId}`); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [model, setModel] = useState<LLMModelId>(() =>
    (localStorage.getItem("avc:canvasAgent:model") as LLMModelId) || (resolveActiveNodeModel("agent", "llm") as LLMModelId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 可拖拽 + 可缩放（位置/尺寸持久化）。pos 为 null 时首帧落在右下角。
  const DEFAULT_SIZE = { w: 380, h: 520 };
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    try { const s = localStorage.getItem("avc:canvasAgent:size"); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return DEFAULT_SIZE;
  });
  const [pos, setPos] = useState<{ left: number; top: number } | null>(() => {
    try { const s = localStorage.getItem("avc:canvasAgent:pos"); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return null;
  });
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:size", JSON.stringify(size)); } catch { /* quota */ } }, [size]);
  useEffect(() => { if (pos) { try { localStorage.setItem("avc:canvasAgent:pos", JSON.stringify(pos)); } catch { /* quota */ } } }, [pos]);

  const left = pos ? pos.left : Math.max(8, window.innerWidth - size.w - 16);
  const top = pos ? pos.top : Math.max(8, window.innerHeight - size.h - 16);

  // 拖标题栏移动窗口（避开标题栏里的按钮/下拉）。
  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, [role='listbox'], .nodrag-handle-skip")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, il = left, it = top;
    const onMove = (mv: MouseEvent) => {
      setPos({
        left: Math.max(0, Math.min(window.innerWidth - 120, il + mv.clientX - sx)),
        top: Math.max(0, Math.min(window.innerHeight - 40, it + mv.clientY - sy)),
      });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  // 右下角把手缩放。
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, iw = size.w, ih = size.h;
    const onMove = (mv: MouseEvent) => {
      setSize({
        w: Math.max(300, Math.min(window.innerWidth - 16, iw + mv.clientX - sx)),
        h: Math.max(360, Math.min(window.innerHeight - 16, ih + mv.clientY - sy)),
      });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  useEffect(() => { try { localStorage.setItem(`avc:canvasAgent:${projectId}`, JSON.stringify(turns.slice(-40))); } catch { /* quota */ } }, [turns, projectId]);
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:model", model); } catch { /* quota */ } }, [model]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [turns, chat.isPending]);

  const opsSummary = (ops: AgentOperation[]): string => {
    const c = ops.filter((o) => o.op === "create").length, l = ops.filter((o) => o.op === "connect").length;
    const u = ops.filter((o) => o.op === "update").length, d = ops.filter((o) => o.op === "delete").length;
    return [c && `新建 ${c}`, l && `连线 ${l}`, u && `改 ${u}`, d && `删 ${d}`].filter(Boolean).join(" · ");
  };

  async function send() {
    const msg = input.trim();
    if (!msg || chat.isPending) return;
    setInput("");
    const history = turns.slice(-10).map((t) => ({ role: t.role, content: t.content }));
    setTurns((p) => [...p, { role: "user", content: msg }]);
    try {
      const summary = buildGraphSummary("");   // excludeNodeId 空 = 全画布摘要
      const r = await chat.mutateAsync({ projectId, message: msg, history, graphSummary: summary || undefined, model });
      const ops = (r.operations ?? []) as AgentOperation[];
      let applied = "", failed = "";
      if (ops.length) {
        // 新节点落在当前视口中心附近
        const anchor = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 120, y: window.innerHeight / 2 - 120 });
        const templates = (templatesQuery.data ?? []).map((t) => ({ id: t.id, label: t.label, payload: t.payload }));
        const res = applyAgentOperations(ops, anchor, { templates, ownerAgentId: "canvas-agent-chat" });
        applied = opsSummary(ops);
        if (res.failures.length) failed = `${res.failures.length} 项未应用：${res.failures.map((f) => f.reason).slice(0, 3).join("；")}`;
      }
      setTurns((p) => [...p, { role: "assistant", content: r.reply || (applied ? "已按你的要求改好画布。" : "（无改动）"), applied: applied || undefined, failed: failed || undefined }]);
    } catch (e) {
      setTurns((p) => [...p, { role: "assistant", content: e instanceof Error ? e.message : "调用失败", error: true }]);
    }
  }

  const panel = (
    <div ref={panelRef} className="nodrag nowheel" style={{
      position: "fixed", left, top, width: size.w, height: size.h,
      display: "flex", flexDirection: "column", background: "var(--c-base)", border: `1px solid ${accent}`, borderRadius: 14,
      boxShadow: "0 18px 50px rgba(0,0,0,0.45)", zIndex: 50, overflow: "hidden",
    }}
      onClick={(e) => e.stopPropagation()}>
      {/* header（拖动手柄） */}
      <div onMouseDown={startDrag} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--c-bd2)", flexShrink: 0, cursor: "move" }}>
        <Sparkles className="w-4 h-4" style={{ color: accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)" }}>画布助手</span>
        <span style={{ fontSize: 10, color: "var(--c-t4)" }}>边聊边改画布</span>
        <div style={{ flex: 1 }} />
        <div style={{ maxWidth: 150 }}><LLMModelPicker value={model} onChange={setModel} disabled={chat.isPending} /></div>
        <button onClick={onClose} title="关闭" style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" }}><X size={14} /></button>
      </div>

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {turns.length === 0 && (
          <div style={{ color: "var(--c-t3)", fontSize: 12, lineHeight: 1.7 }}>
            用自然语言直接指挥画布，例如：<br />
            · 「做一个橘猫晒太阳的竖屏短片，3 镜头」<br />
            · 「在画布加个图像节点，提示词写实橘猫」<br />
            · 「把刚才那个视频节点画幅改成 9:16」<br />
            · 「删掉最后一个节点」<br />
            <span style={{ color: "var(--c-t4)" }}>它会直接建/连/改节点。运行生成仍需你在节点上点运行（防误烧额度）。</span>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: t.role === "user" ? "flex-end" : "flex-start", gap: 3 }}>
            <div style={{ maxWidth: "88%", padding: "8px 11px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
              background: t.role === "user" ? "oklch(0.70 0.20 310 / 0.14)" : "var(--c-surface)",
              border: `1px solid ${t.error ? "oklch(0.65 0.22 25 / 0.5)" : t.role === "user" ? "oklch(0.70 0.20 310 / 0.3)" : "var(--c-bd2)"}`,
              color: t.error ? "oklch(0.72 0.18 25)" : "var(--c-t1)" }}>
              {t.content}
            </div>
            {t.applied && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: accent, paddingLeft: 2 }}>
                <Plus size={10} /><Link2 size={10} /><Pencil size={10} /> 已应用：{t.applied}
              </div>
            )}
            {t.failed && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "oklch(0.72 0.16 60)", paddingLeft: 2 }}>
                <AlertTriangle size={10} /> {t.failed}
              </div>
            )}
          </div>
        ))}
        {chat.isPending && <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: accent }}><Loader2 size={13} className="animate-spin" /> 正在规划并修改画布…</div>}
      </div>

      {/* input */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 10px 10px", borderTop: "1px solid var(--c-bd2)", flexShrink: 0 }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="指挥画布，Enter 发送、Shift+Enter 换行" rows={1}
          style={{ flex: 1, resize: "none", maxHeight: 120, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t1)", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
        <button onClick={() => void send()} disabled={chat.isPending || !input.trim()} title="发送"
          style={{ display: "inline-flex", width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, border: `1px solid ${accent}`, background: "oklch(0.70 0.20 310 / 0.15)", color: accent, cursor: chat.isPending || !input.trim() ? "not-allowed" : "pointer", opacity: chat.isPending || !input.trim() ? 0.5 : 1, flexShrink: 0 }}>
          {chat.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>

      {/* 右下角缩放把手 */}
      <div onMouseDown={startResize} title="拖动缩放" style={{
        position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 2,
        background: "linear-gradient(135deg, transparent 50%, var(--c-bd3) 50%, var(--c-bd3) 60%, transparent 60%, transparent 72%, var(--c-bd3) 72%, var(--c-bd3) 82%, transparent 82%)",
      }} />
    </div>
  );
  return createPortal(panel, document.body);
}
