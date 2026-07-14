import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { Bot, Plus, Minus, X, Send, Loader2, MessageSquare, AtSign, Download, Copy, RefreshCw, Paperclip, Pin, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useAiClient } from "../../hooks/useAiClient";
import { deriveAiSessions, resolveActiveSession } from "@/lib/aiClientSessions";
import { buildNodeContextContent, isReferableNode, nodeContextLabel, planMessageDrop, type ChatMsgAttachment } from "@/lib/aiClientContext";
import { loadNodeless, saveNodeless, addSession, removeSession, updateSession, sortSessions, makeNodelessId, isNodelessId, type NodelessSession } from "@/lib/aiClientNodeless";
import { LLM_MODELS } from "@/lib/models";
import { trpc } from "@/lib/trpc";
import type { NodeType } from "../../../../shared/types";

const MIN_W = 420, MIN_H = 360;

// ── 全局悬浮「AI 客户端」(综合 Claude/GPT/Grok 取长) ─────────────────────────────
// Cmd/Ctrl+J 呼出/最小化；左侧会话列表「同源」于画布 ai_chat 节点（会话即节点），中间对话流，
// 底部大输入框，顶部模型下拉。收发复用 aiChat.getMessages / sendMessage（与节点同一后端，数据互通）。
// 互通②③（@引用节点上下文 / 回答落成节点 / 素材库）在后续批次接入。

const ACCENT = "oklch(0.70 0.20 300)";

export function AiClientPanel() {
  const reactFlow = useReactFlow();
  const { open, minimized, activeNodeId, close, setMinimized, setActive, pinned, setPinned, geometry, setGeometry } = useAiClient();
  const nodes = useCanvasStore((s) => s.nodes);
  const projectId = useCanvasStore((s) => s.projectId);
  const utils = trpc.useUtils();

  // 无节点会话（不建 ai_chat 节点，也能记住；索引按项目存 localStorage，消息仍在服务端）。
  const [nodeless, setNodeless] = useState<NodelessSession[]>([]);
  useEffect(() => { setNodeless(projectId ? loadNodeless(projectId) : []); }, [projectId]);
  const persistNodeless = (list: NodelessSession[]) => { setNodeless(list); if (projectId) saveNodeless(projectId, list); };

  // 统一会话列表：画布 ai_chat 节点（同源）+ 无节点会话，按更新时间/出现顺序合并。
  const nodeSessions = useMemo(() => deriveAiSessions(nodes).map((s) => ({ id: s.nodeId, title: s.title, preview: s.preview, nodeless: false })), [nodes]);
  const sessions = useMemo(() => [
    ...sortSessions(nodeless).map((s) => ({ id: s.id, title: s.title, preview: "", nodeless: true })),
    ...nodeSessions,
  ], [nodeless, nodeSessions]);
  const active = useMemo(() => resolveActiveSession(sessions.map((s) => ({ nodeId: s.id, title: s.title, preview: s.preview, count: 0 })), activeNodeId), [sessions, activeNodeId]);
  useEffect(() => { if (active !== activeNodeId) setActive(active); }, [active, activeNodeId, setActive]);

  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(LLM_MODELS.find((m) => m.tag === "默认")?.id ?? LLM_MODELS[0].id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingAtts, setPendingAtts] = useState<ChatMsgAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadMut = trpc.upload.uploadAiChatImage.useMutation();
  const clearMut = trpc.aiChat.clearMessages.useMutation();

  const activeNode = useMemo(() => nodes.find((n) => n.id === active), [nodes, active]);
  const activeNodeless = useMemo(() => nodeless.find((s) => s.id === active), [nodeless, active]);
  const isNodeless = isNodelessId(active);
  // 当前会话引用的上下文节点：无节点会话存 nodeless 记录，节点会话存 ai_chat 节点 payload（同源）。
  const contextIds = useMemo(
    () => (isNodeless ? (activeNodeless?.contextNodeIds ?? []) : ((activeNode?.data.payload as { contextNodeIds?: string[] } | undefined)?.contextNodeIds ?? [])),
    [isNodeless, activeNodeless, activeNode],
  );
  const referable = useMemo(() => nodes.filter((n) => n.id !== active && isReferableNode(n)), [nodes, active]);
  const setContextIds = (ids: string[]) => {
    if (!active) return;
    if (isNodeless) persistNodeless(updateSession(nodeless, active, { contextNodeIds: ids }));
    else useCanvasStore.getState().updateNodeData(active, { contextNodeIds: ids }, true);
  };
  const toggleContext = (nodeId: string) => setContextIds(contextIds.includes(nodeId) ? contextIds.filter((x) => x !== nodeId) : [...contextIds, nodeId]);

  // 逐会话模型：切会话载入该会话保存的模型；切模型持久化到该会话（节点 payload 或 nodeless 记录）。
  useEffect(() => {
    const m = isNodeless ? activeNodeless?.model : (activeNode?.data.payload as { model?: string } | undefined)?.model;
    if (m && m !== model) setModel(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const changeModel = (m: string) => {
    setModel(m);
    if (!active) return;
    if (isNodeless) persistNodeless(updateSession(nodeless, active, { model: m }));
    else useCanvasStore.getState().updateNodeData(active, { model: m }, true);
  };

  const msgQuery = trpc.aiChat.getMessages.useQuery(
    { nodeId: active ?? "", projectId: projectId ?? 0 },
    { enabled: open && !minimized && !!active && !!projectId },
  );
  const messages = msgQuery.data ?? [];

  const sendMut = trpc.aiChat.sendMessage.useMutation({
    onSuccess: () => {
      if (active && projectId) void utils.aiChat.getMessages.invalidate({ nodeId: active, projectId });
    },
    onError: (err) => toast.error("发送失败：" + err.message),
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, sendMut.isPending]);

  // 回写节点 payload.messages，让画布上的 ai_chat 节点即时反映服务端权威消息（仅节点会话）。
  useEffect(() => {
    if (!active || isNodeless || !msgQuery.data) return;
    const stripped = msgQuery.data
      .filter((m): m is typeof m & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    useCanvasStore.getState().updateNodeData(active, { messages: stripped }, true);
  }, [active, isNodeless, msgQuery.data]);

  // 新会话默认「无节点」（不在画布建 ai_chat 节点，免得画布被聊天节点堆乱），仍持久记住。
  const newSession = () => {
    const s: NodelessSession = { id: makeNodelessId(nanoid(8)), title: "新会话", model, updatedAt: Date.now() };
    persistNodeless(addSession(nodeless, s));
    setActive(s.id);
    setInput(""); setPendingAtts([]);
    toast.success("已新建会话");
  };
  // 删除无节点会话（清索引 + 清服务端消息）。节点会话由画布管理，这里不删。
  const deleteNodelessSession = (id: string) => {
    persistNodeless(removeSession(nodeless, id));
    if (projectId) clearMut.mutate({ nodeId: id, projectId });
    if (active === id) setActive(null);
    toast.success("已删除会话");
  };

  const doSend = (text: string, attachments: ChatMsgAttachment[]) => {
    if (!active || !projectId) return;
    const contextContent = buildNodeContextContent(nodes, contextIds);
    sendMut.mutate({
      nodeId: active, projectId, message: text, model,
      ...(contextContent ? { contextContent } : {}),
      ...(attachments.length > 0 ? { attachments: attachments.map((a) => ({ type: a.type, url: a.url, mimeType: a.mimeType || "image/jpeg", name: a.name || "图片" })) } : {}),
      ...(model.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
    });
  };

  const send = () => {
    const text = input.trim();
    if ((!text && pendingAtts.length === 0) || sendMut.isPending) return;
    if (!active) { newSession(); toast.info("已建会话，请再次发送"); return; }
    if (!projectId) { toast.error("画布未就绪"); return; }
    const atts = pendingAtts;
    setInput(""); setPendingAtts([]);
    // 无节点会话：用首句更新标题 + 刷新更新时间（首次发送前标题还是「新会话」）。
    if (isNodeless && active) {
      const cur = nodeless.find((s) => s.id === active);
      const title = cur && cur.title !== "新会话" ? cur.title : (text.slice(0, 30) || cur?.title || "新会话");
      persistNodeless(updateSession(nodeless, active, { title, updatedAt: Date.now() }));
    }
    doSend(text, atts);
  };

  // 重新生成：以最后一条用户消息再问一次（无删除末条端点，故为新一轮）。
  const regenerate = () => {
    if (sendMut.isPending || !active) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser?.content) { toast.error("没有可重新生成的消息"); return; }
    doSend(lastUser.content, []);
  };

  const copyText = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast.success("已复制"), () => toast.error("复制失败")); };

  // 图片附件：上传到自有存储（复用 uploadAiChatImage），随消息发送（素材库/产物互通）。
  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) { toast.error(`仅支持图片：${file.name}`); continue; }
      try {
        const base64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ""));
          r.onerror = () => rej(r.error);
          r.readAsDataURL(file);
        });
        const { url } = await uploadMut.mutateAsync({ base64, mimeType: file.type, filename: file.name });
        setPendingAtts((prev) => [...prev, { type: "image", url, mimeType: file.type, name: file.name }]);
      } catch (e) { toast.error("上传失败：" + (e instanceof Error ? e.message : "")); }
    }
  };

  // 回答一键落成画布节点（文本→便签、图片附件→图像节点）。
  const dropToCanvas = (content: string, attachments?: ChatMsgAttachment[]) => {
    const plans = planMessageDrop(content, attachments);
    if (plans.length === 0) { toast.error("这条回答没有可落成的内容"); return; }
    const base = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 120, y: window.innerHeight / 2 - 80 });
    let created = 0;
    plans.forEach((plan, i) => {
      const node = useCanvasStore.getState().addNode(plan.nodeType as NodeType, { x: base.x + i * 40, y: base.y + i * 40 });
      useCanvasStore.getState().updateNodeData(node.id, plan.payload);
      created++;
    });
    toast.success(`已落成 ${created} 个画布节点`);
  };

  // ── 窗口几何：拖拽移动 + 缩放（默认右下角停靠；拖过/缩过后持久化）──────────────
  const [liveGeo, setLiveGeo] = useState<import("../../hooks/useAiClient").AiClientGeometry | null>(null);
  const defaultGeo = useMemo(() => {
    const w = Math.min(760, Math.round((typeof window !== "undefined" ? window.innerWidth : 1200) * 0.94));
    const h = Math.min(600, Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.86));
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    return { x: vw - w - 22, y: vh - h - 22, w, h };
  }, []);
  const geo = liveGeo ?? geometry ?? defaultGeo;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button,select,input,textarea")) return; // 顶栏控件不触发拖拽
    e.preventDefault();
    const s = { mx: e.clientX, my: e.clientY, x: geo.x, y: geo.y };
    const move = (ev: PointerEvent) => setLiveGeo({ ...geo, x: clamp(s.x + ev.clientX - s.mx, 0, window.innerWidth - 120), y: clamp(s.y + ev.clientY - s.my, 0, window.innerHeight - 44) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setLiveGeo((g) => { if (g) setGeometry(g); return null; }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const s = { mx: e.clientX, my: e.clientY, w: geo.w, h: geo.h };
    const move = (ev: PointerEvent) => setLiveGeo({ ...geo, w: clamp(s.w + ev.clientX - s.mx, MIN_W, window.innerWidth - geo.x - 8), h: clamp(s.h + ev.clientY - s.my, MIN_H, window.innerHeight - geo.y - 8) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setLiveGeo((g) => { if (g) setGeometry(g); return null; }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  if (!open) return null;

  // 最小化：右下角悬浮小球。
  if (minimized) {
    return createPortal(
      <button
        onClick={() => setMinimized(false)}
        title="展开 AI 客户端（Cmd/Ctrl+J）"
        style={{
          position: "fixed", right: 22, bottom: 22, zIndex: 210, width: 52, height: 52, borderRadius: "50%",
          border: "none", cursor: "pointer", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: `linear-gradient(135deg, ${ACCENT}, oklch(0.66 0.2 320))`, boxShadow: "0 8px 24px oklch(0.66 0.2 300 / 0.45)",
        }}
      >
        <Bot size={24} />
      </button>,
      document.body,
    );
  }

  const modelLabel = LLM_MODELS.find((m) => m.id === model)?.label ?? model;

  return createPortal(
    <div
      className="nodrag"
      style={{
        position: "fixed", left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: 210,
        display: "flex", flexDirection: "column", background: "var(--c-surface)", border: "1px solid var(--c-bd2)",
        borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.45)", overflow: "hidden",
      }}
    >
      {/* 顶栏（可拖拽移动窗口） */}
      <div onPointerDown={startDrag} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--c-bd1)", cursor: "move", touchAction: "none" }}>
        <span style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 8, background: `color-mix(in oklch, ${ACCENT} 16%, transparent)`, color: ACCENT }}><Bot size={16} /></span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--c-t1)" }}>AI 客户端</span>
        <select value={model} onChange={(e) => changeModel(e.target.value)} className="nodrag"
          style={{ marginLeft: 6, fontSize: 11.5, padding: "4px 8px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none", maxWidth: 200 }}
          title={`当前模型：${modelLabel}`}>
          {LLM_MODELS.filter((m) => !m.hidden).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setPinned(!pinned)} title={pinned ? "取消钉住" : "钉住（记住展开态，进画布自动打开）"} style={{ ...iconBtn, color: pinned ? ACCENT : "var(--c-t3)" }}><Pin size={15} fill={pinned ? ACCENT : "none"} /></button>
        <button onClick={() => setMinimized(true)} title="最小化（Cmd/Ctrl+J）" style={iconBtn}><Minus size={16} /></button>
        <button onClick={close} title="关闭" style={iconBtn}><X size={16} /></button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 会话侧栏（同源于 ai_chat 节点） */}
        <div style={{ width: 196, flexShrink: 0, borderRight: "1px solid var(--c-bd1)", display: "flex", flexDirection: "column", background: "var(--c-bg, var(--c-surface))" }}>
          <button onClick={newSession} className="nodrag"
            style={{ margin: 10, padding: "8px 10px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "none", color: "#fff", background: ACCENT }}>
            <Plus size={14} /> 新会话
          </button>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
            {sessions.length === 0 && <div style={{ fontSize: 11.5, color: "var(--c-t4)", padding: "12px 6px", lineHeight: 1.6 }}>还没有会话。点「新会话」开始——默认不建画布节点（保持画布清爽），对话仍会记住。</div>}
            {sessions.map((s) => {
              const on = s.id === active;
              return (
                <div key={s.id} className="nodrag" title={s.title}
                  style={{ position: "relative", marginBottom: 4, borderRadius: 9, border: `1px solid ${on ? ACCENT : "transparent"}`, background: on ? `color-mix(in oklch, ${ACCENT} 10%, transparent)` : "transparent" }}>
                  <button onClick={() => setActive(s.id)} className="nodrag"
                    style={{ width: "100%", textAlign: "left", padding: "8px 9px", background: "transparent", border: "none", cursor: "pointer", color: "var(--c-t1)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 16 }}>
                      <MessageSquare size={12} style={{ flexShrink: 0, color: on ? ACCENT : "var(--c-t4)" }} />
                      <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                      {!s.nodeless && <span title="画布节点会话" style={{ flexShrink: 0, fontSize: 9, color: "var(--c-t4)" }}>◈</span>}
                    </span>
                    {s.preview && <span style={{ display: "block", fontSize: 10.5, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{s.preview}</span>}
                  </button>
                  {/* 删除（仅无节点会话；画布节点会话请在画布上删）。 */}
                  {s.nodeless && (
                    <button onClick={() => deleteNodelessSession(s.id)} className="nodrag" title="删除会话"
                      style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 5, border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.62 0.2 20)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}>
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 对话流 + 输入 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            {!active && <div style={{ margin: "auto", textAlign: "center", color: "var(--c-t4)", fontSize: 13 }}><Bot size={30} style={{ opacity: 0.5 }} /><div style={{ marginTop: 8 }}>选择或新建一个会话开始对话</div></div>}
            {active && messages.length === 0 && !msgQuery.isLoading && <div style={{ margin: "auto", textAlign: "center", color: "var(--c-t4)", fontSize: 13 }}>开始你的第一句对话吧</div>}
            {active && msgQuery.isLoading && <div style={{ margin: "auto", color: "var(--c-t4)" }}><Loader2 size={20} className="animate-spin" /></div>}
            {messages.map((m, i) => {
              const atts = (m as { attachments?: ChatMsgAttachment[] }).attachments;
              return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 3 }}>
                <div style={{
                  maxWidth: "82%", padding: "9px 13px", borderRadius: 13, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  background: m.role === "user" ? `color-mix(in oklch, ${ACCENT} 18%, var(--c-input))` : "var(--c-input)",
                  color: "var(--c-t1)", border: "1px solid var(--c-bd2)",
                }}>{m.content}</div>
                {/* 消息操作：复制（全部）+ 落成节点/重新生成（仅 AI 回复）。 */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 2px" }}>
                  {m.content?.trim() && (
                    <button onClick={() => copyText(m.content)} className="nodrag" title="复制"
                      style={msgActBtn} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = ACCENT; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}>
                      <Copy size={11} /> 复制
                    </button>
                  )}
                  {m.role === "assistant" && (m.content?.trim() || (atts?.length ?? 0) > 0) && (
                    <button onClick={() => dropToCanvas(m.content, atts)} className="nodrag"
                      title="把这条回答落成画布节点（文本→便签，图片→图像节点）"
                      style={msgActBtn} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = ACCENT; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}>
                      <Download size={11} /> 落成节点
                    </button>
                  )}
                  {m.role === "assistant" && i === messages.length - 1 && !sendMut.isPending && (
                    <button onClick={regenerate} className="nodrag" title="以最后一条提问重新生成"
                      style={msgActBtn} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = ACCENT; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}>
                      <RefreshCw size={11} /> 重新生成
                    </button>
                  )}
                </div>
              </div>
              );
            })}
            {sendMut.isPending && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ padding: "9px 13px", borderRadius: 13, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)" }}><Loader2 size={15} className="animate-spin" /></div>
              </div>
            )}
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--c-bd1)", position: "relative" }}>
            {/* 已引用的画布节点 chips + @ 添加引用（打通 contextNodeIds，作为对话上下文） */}
            {active && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", marginBottom: 7 }}>
                <button onClick={() => setPickerOpen((v) => !v)} className="nodrag"
                  title="引用画布节点作为上下文"
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 22, padding: "0 8px", borderRadius: 7, fontSize: 11, cursor: "pointer",
                    background: pickerOpen ? `color-mix(in oklch, ${ACCENT} 14%, transparent)` : "var(--c-input)", border: `1px solid ${pickerOpen ? ACCENT : "var(--c-bd2)"}`, color: pickerOpen ? ACCENT : "var(--c-t3)" }}>
                  <AtSign size={11} /> 引用节点
                </button>
                {contextIds.map((cid) => {
                  const n = nodes.find((x) => x.id === cid);
                  if (!n) return null;
                  return (
                    <span key={cid} style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 22, padding: "0 6px 0 8px", borderRadius: 7, fontSize: 11, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", maxWidth: 160 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodeContextLabel(n)}</span>
                      <button onClick={() => toggleContext(cid)} className="nodrag" style={{ border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer", padding: 0, lineHeight: 1 }}><X size={11} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            {/* @ 引用选择器（列出可引用画布节点） */}
            {pickerOpen && active && (
              <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", left: 12, right: 12, bottom: "calc(100% - 4px)", maxHeight: 240, overflowY: "auto", zIndex: 5,
                  background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.4)", padding: 6 }}>
                {referable.length === 0 && <div style={{ fontSize: 11.5, color: "var(--c-t4)", padding: "10px 8px" }}>画布上暂无可引用的节点（脚本/分镜/提示词/图像/角色/便签等）。</div>}
                {referable.map((n) => {
                  const on = contextIds.includes(n.id);
                  return (
                    <button key={n.id} onClick={() => toggleContext(n.id)} className="nodrag"
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                        border: "none", background: on ? `color-mix(in oklch, ${ACCENT} 10%, transparent)` : "transparent", color: "var(--c-t1)" }}
                      onMouseEnter={(e) => { if (!on) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                      onMouseLeave={(e) => { if (!on) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                      <span style={{ width: 14, flexShrink: 0, color: on ? ACCENT : "var(--c-t4)" }}>{on ? "✓" : ""}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodeContextLabel(n)}</span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-t4)", flexShrink: 0 }}>{n.data.nodeType}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* 待发送图片附件 chips */}
            {pendingAtts.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 7 }}>
                {pendingAtts.map((a, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 6px 0 8px", borderRadius: 7, fontSize: 11, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", maxWidth: 160 }}>
                    <Paperclip size={10} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name || "图片"}</span>
                    <button onClick={() => setPendingAtts((p) => p.filter((_, j) => j !== i))} className="nodrag" style={{ border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer", padding: 0, lineHeight: 1 }}><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 12, padding: "8px 10px" }}>
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { void onPickFiles(e.target.files); e.target.value = ""; }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending} className="nodrag" title="添加图片附件"
                style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent", color: "var(--c-t3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {uploadMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              </button>
              <textarea
                className="nodrag nowheel"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={active ? "输入消息，Enter 发送 · Shift+Enter 换行" : "输入消息开始新会话…"}
                rows={1}
                style={{ flex: 1, resize: "none", maxHeight: 140, minHeight: 22, background: "transparent", border: "none", outline: "none", color: "var(--c-t1)", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit" }}
              />
              <button onClick={send} disabled={(!input.trim() && pendingAtts.length === 0) || sendMut.isPending} className="nodrag"
                style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, border: "none", cursor: (input.trim() || pendingAtts.length) && !sendMut.isPending ? "pointer" : "default", color: "#fff", background: (input.trim() || pendingAtts.length) && !sendMut.isPending ? ACCENT : "var(--c-bd2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {sendMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 右下角缩放手柄（拖拽改变窗口尺寸；持久化） */}
      <div onPointerDown={startResize} className="nodrag" title="拖拽缩放"
        style={{ position: "absolute", right: 0, bottom: 0, width: 18, height: 18, cursor: "nwse-resize", touchAction: "none",
          background: "linear-gradient(135deg, transparent 50%, var(--c-bd2) 50%, var(--c-bd2) 62%, transparent 62%, transparent 74%, var(--c-bd2) 74%, var(--c-bd2) 86%, transparent 86%)" }} />
    </div>,
    document.body,
  );
}

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: "var(--c-t3)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const msgActBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--c-t4)",
  background: "transparent", border: "none", cursor: "pointer", padding: 0,
};
