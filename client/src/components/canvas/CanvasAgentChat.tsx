import { useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { createPortal } from "react-dom";
import { Sparkles, Send, Loader2, X, Plus, Link2, Pencil, AlertTriangle, CornerUpLeft, BookOpen, Focus, Paperclip, Image as ImageIcon, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buildGraphSummary, applyAgentOperations } from "@/lib/agentApply";
import { resolveActiveNodeModel } from "../../contexts/NodeDefaultModelsContext";
import { LLMModelPicker, type LLMModelId } from "./LLMModelPicker";
import { MiniSelect } from "@/components/ui/MiniSelect";
import { useBridgeSkills } from "@/lib/useBridgeSkills";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { AI_TEMPLATE_CATEGORIES, ALL_AI_TEMPLATES, BLANK_TEMPLATE_ID, BLANK_TEMPLATE_LABEL } from "@/lib/aiAssistantTemplates";
import type { AgentOperation } from "../../../../shared/types";

/** 浮动「画布助手」：对话式让 AI（如本机 Claude）边聊边直接改画布。复用智能体节点同一套引擎
 *  （agent.chat 规划 + buildGraphSummary 看实时画布 + applyAgentOperations 落地）。
 *  已对齐聊天助手：模板人设、@角色 引用、/ 调技能（本机 Claude 桥接，MCP 亦自动可用）、撤销本次改动。
 *  结构性操作自动落地且不花钱；「运行/生成」仍需在节点上点运行（防误烧额度）。 */
type Turn = { role: "user" | "assistant"; content: string; applied?: string; failed?: string; error?: boolean; touchedIds?: string[]; undone?: boolean };

const accent = "oklch(0.70 0.20 310)";
const accentSoft = "oklch(0.70 0.20 310 / 0.14)";

const MAX_ATTACHMENTS = 4;
const MAX_ATTACH_MB = 10;
/** 读成完整 data: URI（含前缀），供 agent.chat 的 image_url/file_url 直接使用。 */
const fileToDataUri = (f: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = () => reject(r.error ?? new Error("读取文件失败"));
  r.readAsDataURL(f);
});

export function CanvasAgentChat({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const reactFlow = useReactFlow();
  const chat = trpc.agent.chat.useMutation();
  const templatesQuery = trpc.comfyTemplates.list.useQuery(undefined, { staleTime: 30_000 });
  const charsQuery = trpc.characterLibrary.list.useQuery(undefined, { staleTime: 30_000 });
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);

  const [turns, setTurns] = useState<Turn[]>(() => {
    try { const s = localStorage.getItem(`avc:canvasAgent:${projectId}`); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  const [attachErr, setAttachErr] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    setAttachErr("");
    const tooBig = files.find((f) => f.size > MAX_ATTACH_MB * 1024 * 1024);
    if (tooBig) { setAttachErr(`「${tooBig.name}」超过 ${MAX_ATTACH_MB}MB，请压缩后再传`); return; }
    setStaged((prev) => {
      const room = MAX_ATTACHMENTS - prev.length;
      if (room <= 0) { setAttachErr(`最多附 ${MAX_ATTACHMENTS} 个文件`); return prev; }
      if (files.length > room) setAttachErr(`最多附 ${MAX_ATTACHMENTS} 个文件，已取前 ${room} 个`);
      return [...prev, ...files.slice(0, room)];
    });
  };
  const [model, setModel] = useState<LLMModelId>(() =>
    (localStorage.getItem("avc:canvasAgent:model") as LLMModelId) || (resolveActiveNodeModel("agent", "llm") as LLMModelId));
  const [template, setTemplate] = useState<string>(() => localStorage.getItem("avc:canvasAgent:template") || BLANK_TEMPLATE_ID);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isClaudeLocal = !!model && model.toLowerCase().startsWith("claude-local");
  const bridgeSkills = useBridgeSkills(isClaudeLocal);

  // ── 可拖拽 + 可缩放（位置/尺寸持久化）──
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

  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, [role='listbox']")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, il = left, it = top;
    const onMove = (mv: MouseEvent) => setPos({ left: Math.max(0, Math.min(window.innerWidth - 120, il + mv.clientX - sx)), top: Math.max(0, Math.min(window.innerHeight - 40, it + mv.clientY - sy)) });
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, iw = size.w, ih = size.h;
    const onMove = (mv: MouseEvent) => setSize({ w: Math.max(300, Math.min(window.innerWidth - 16, iw + mv.clientX - sx)), h: Math.max(360, Math.min(window.innerHeight - 16, ih + mv.clientY - sy)) });
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  useEffect(() => { try { localStorage.setItem(`avc:canvasAgent:${projectId}`, JSON.stringify(turns.slice(-40))); } catch { /* quota */ } }, [turns, projectId]);
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:model", model); } catch { /* quota */ } }, [model]);
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:template", template); } catch { /* quota */ } }, [template]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [turns, chat.isPending]);

  // ── @角色 / 技能 触发面板（输入末尾 @片段 或 /片段 时浮出可选列表）──
  const [pickHi, setPickHi] = useState(0);
  const [pickDismiss, setPickDismiss] = useState("");
  const trig = /(^|\s)([@/])([^\s@/]*)$/.exec(input);
  const pickMode: "@" | "/" | null = trig ? (trig[2] as "@" | "/") : null;
  const pickFrag = (trig?.[3] ?? "").toLowerCase();
  const pickItems = useMemo(() => {
    if (pickMode === "@") {
      return (charsQuery.data ?? [])
        .filter((c) => !pickFrag || (c.name ?? "").toLowerCase().includes(pickFrag))
        .slice(0, 8).map((c) => ({ name: c.name, sub: c.characterKind === "scene" ? "场景" : "人物" }));
    }
    if (pickMode === "/" && isClaudeLocal && bridgeSkills.enabled) {
      return bridgeSkills.skills
        .filter((s) => !pickFrag || s.name.toLowerCase().includes(pickFrag) || s.description.toLowerCase().includes(pickFrag))
        .slice(0, 8).map((s) => ({ name: s.name, sub: s.description }));
    }
    return [];
  }, [pickMode, pickFrag, charsQuery.data, isClaudeLocal, bridgeSkills.enabled, bridgeSkills.skills]);
  const showPicker = pickMode != null && input !== pickDismiss && pickItems.length > 0;
  useEffect(() => { setPickHi(0); }, [pickFrag, pickMode]);
  const applyPick = (name: string) => {
    if (!trig) return;
    const cut = input.length - (1 + (trig[3] ?? "").length);   // 砍掉末尾的「触发符+片段」
    const insertion = pickMode === "@" ? `@${name}` : `用 ${name} 技能：`;
    setInput(input.slice(0, cut) + insertion + " ");
    setPickDismiss("");
  };

  const opsSummary = (ops: AgentOperation[]): string => {
    const c = ops.filter((o) => o.op === "create").length, l = ops.filter((o) => o.op === "connect").length;
    const u = ops.filter((o) => o.op === "update").length, d = ops.filter((o) => o.op === "delete").length;
    return [c && `新建 ${c}`, l && `连线 ${l}`, u && `改 ${u}`, d && `删 ${d}`].filter(Boolean).join(" · ");
  };

  const undoTurn = (idx: number) => {
    const t = turns[idx];
    if (!t?.touchedIds?.length) return;
    const st = useCanvasStore.getState();
    t.touchedIds.forEach((id) => st.deleteNode(id));
    setTurns((p) => p.map((x, i) => (i === idx ? { ...x, undone: true } : x)));
  };

  async function send() {
    const files = staged;
    const msg = input.trim() || (files.length ? "请参考附件规划画布。" : "");
    if (!msg || chat.isPending) return;
    setInput(""); setStaged([]); setAttachErr("");
    const history = turns.slice(-10).map((t) => ({ role: t.role, content: t.content }));
    const attachLabel = files.length ? `　📎 ${files.map((f) => f.name).join("、")}` : "";
    setTurns((p) => [...p, { role: "user", content: msg + attachLabel }]);
    try {
      const attachments = files.length
        ? await Promise.all(files.map(async (f) => ({ url: await fileToDataUri(f), mimeType: f.type || "application/octet-stream", name: f.name })))
        : undefined;
      const focus = selectedNodeIds.filter(Boolean);
      const summary = buildGraphSummary("", focus.length ? { focusNodeIds: focus } : {});
      const persona = template === BLANK_TEMPLATE_ID ? undefined : ALL_AI_TEMPLATES.find((t) => t.id === template)?.prompt;
      const r = await chat.mutateAsync({ projectId, message: msg, history, graphSummary: summary || undefined, model, persona, includeCharacterLibrary: true, attachments });
      const ops = (r.operations ?? []) as AgentOperation[];
      let applied = "", failed = "", touchedIds: string[] = [];
      if (ops.length) {
        const anchor = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 120, y: window.innerHeight / 2 - 120 });
        const templates = (templatesQuery.data ?? []).map((t) => ({ id: t.id, label: t.label, payload: t.payload }));
        const res = applyAgentOperations(ops, anchor, { templates, ownerAgentId: "canvas-agent-chat" });
        applied = opsSummary(ops); touchedIds = res.touchedIds ?? [];
        if (res.failures.length) failed = `${res.failures.length} 项未应用：${res.failures.map((f) => f.reason).slice(0, 3).join("；")}`;
      }
      setTurns((p) => [...p, { role: "assistant", content: r.reply || (applied ? "已按你的要求改好画布。" : "（无改动）"), applied: applied || undefined, failed: failed || undefined, touchedIds: touchedIds.length ? touchedIds : undefined }]);
    } catch (e) {
      setTurns((p) => [...p, { role: "assistant", content: e instanceof Error ? e.message : "调用失败", error: true }]);
    }
  }

  const templateGroups = [
    { options: [{ value: BLANK_TEMPLATE_ID, label: BLANK_TEMPLATE_LABEL, title: "不设任何人设/风格" }] },
    ...AI_TEMPLATE_CATEGORIES.map((cat) => ({ label: cat.label, options: cat.templates.map((t) => ({ value: t.id, label: t.label, title: t.blurb })) })),
  ];
  const focusCount = selectedNodeIds.filter(Boolean).length;

  const panel = (
    <div ref={panelRef} className="nodrag nowheel" style={{
      position: "fixed", left, top, width: size.w, height: size.h,
      display: "flex", flexDirection: "column", background: "var(--c-base)", border: `1px solid ${accent}`, borderRadius: 14,
      boxShadow: "0 18px 50px rgba(0,0,0,0.45)", zIndex: 50, overflow: "hidden",
    }} onClick={(e) => e.stopPropagation()}>
      {/* header（拖动手柄） */}
      <div onMouseDown={startDrag} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--c-bd2)", flexShrink: 0, cursor: "move" }}>
        <Sparkles className="w-4 h-4" style={{ color: accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)" }}>画布助手</span>
        <div style={{ flex: 1 }} />
        <div style={{ maxWidth: 150 }}><LLMModelPicker value={model} onChange={setModel} disabled={chat.isPending} /></div>
        <button onClick={onClose} title="关闭" style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" }}><X size={14} /></button>
      </div>

      {/* 工具行：模板 + 聚焦/技能提示 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px 0", flexWrap: "wrap", fontSize: 11, color: "var(--c-t3)" }}>
        <BookOpen size={13} style={{ color: accent }} /><span>模板</span>
        <MiniSelect value={template} placeholder="空模板" maxWidth={180} accent={accent} accentSoft={accentSoft}
          title="给规划设定风格/人设；空模板=无人设" groups={templateGroups} onChange={setTemplate} />
        {focusCount > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: accent }}><Focus size={11} /> 已聚焦 {focusCount} 个选中节点</span>}
        {isClaudeLocal && bridgeSkills.enabled && bridgeSkills.skills.length > 0 && <span style={{ color: "var(--c-t4)" }}>· 输入 <strong style={{ color: accent }}>/</strong> 选技能</span>}
        {(charsQuery.data?.length ?? 0) > 0 && <span style={{ color: "var(--c-t4)" }}>· <strong style={{ color: accent }}>@</strong> 引用角色</span>}
      </div>

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {turns.length === 0 && (
          <div style={{ color: "var(--c-t3)", fontSize: 12, lineHeight: 1.7 }}>
            用自然语言直接指挥画布，例如：<br />
            · 「做一个橘猫晒太阳的竖屏短片，3 镜头」<br />
            · 「把 @小明 加进第 2 个分镜」<br />
            · 「把刚才那个视频节点画幅改成 9:16」<br />
            <span style={{ color: "var(--c-t4)" }}>先框选节点=只改选中项；建/连/改自动落地不花钱，运行生成仍需在节点上点运行。</span>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: t.role === "user" ? "flex-end" : "flex-start", gap: 3 }}>
            <div style={{ maxWidth: "88%", padding: "8px 11px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
              background: t.role === "user" ? accentSoft : "var(--c-surface)",
              border: `1px solid ${t.error ? "oklch(0.65 0.22 25 / 0.5)" : t.role === "user" ? "oklch(0.70 0.20 310 / 0.3)" : "var(--c-bd2)"}`,
              color: t.error ? "oklch(0.72 0.18 25)" : "var(--c-t1)" }}>
              {t.content}
            </div>
            {t.applied && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: accent, paddingLeft: 2 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Plus size={10} /><Link2 size={10} /><Pencil size={10} /> 已应用：{t.applied}</span>
                {t.touchedIds?.length && !t.undone && (
                  <button onClick={() => undoTurn(i)} title="撤销本次 AI 改动（可再 Ctrl+Z 恢复）"
                    style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "var(--c-t3)", background: "none", border: "1px solid var(--c-bd2)", borderRadius: 6, padding: "1px 6px", cursor: "pointer" }}>
                    <CornerUpLeft size={10} /> 撤销
                  </button>
                )}
                {t.undone && <span style={{ color: "var(--c-t4)" }}>· 已撤销</span>}
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

      {/* @角色 / 技能 选择面板 */}
      {showPicker && (
        <div style={{ position: "relative", padding: "0 10px", flexShrink: 0 }}>
          <div className="nowheel" style={{ position: "absolute", bottom: 4, left: 10, right: 10, maxHeight: 220, overflowY: "auto",
            background: "var(--c-elevated, #1b1b1f)", border: "1px solid var(--c-bd3)", borderRadius: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.45)", zIndex: 40, padding: 5 }}>
            <div style={{ fontSize: 10.5, color: "var(--c-t4)", padding: "3px 8px 5px" }}>{pickMode === "@" ? "角色" : "技能"} · ↑↓ 选择 · Enter 确认 · Esc 关闭</div>
            {pickItems.map((it, i) => (
              <button key={it.name} type="button" onMouseEnter={() => setPickHi(i)} onClick={() => applyPick(it.name)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                  background: i === pickHi ? accentSoft : "transparent", color: "var(--c-t1)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: i === pickHi ? accent : "var(--c-t1)" }}>{pickMode === "@" ? "@" : "/"}{it.name}</div>
                {it.sub && <div style={{ fontSize: 11, color: "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 暂存附件芯片 */}
      {(staged.length > 0 || attachErr) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 10px 4px", flexShrink: 0 }}>
          {staged.map((f, i) => {
            const isImg = f.type.startsWith("image/");
            const Icon = isImg ? ImageIcon : FileText;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px 3px 7px", borderRadius: 8, border: `1px solid ${accent}`, background: accentSoft, maxWidth: 170 }}>
                <Icon size={13} style={{ color: accent, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${f.name} · ${(f.size / 1024 / 1024).toFixed(1)}MB`}>{f.name}</span>
                <button onClick={() => setStaged((p) => p.filter((_, j) => j !== i))} title="移除" style={{ width: 16, height: 16, borderRadius: 4, border: "none", background: "transparent", color: "var(--c-t3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={11} /></button>
              </div>
            );
          })}
          {attachErr && <span style={{ fontSize: 10.5, color: "oklch(0.72 0.16 60)", alignSelf: "center" }}>{attachErr}</span>}
        </div>
      )}

      {/* input */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 10px 10px", borderTop: "1px solid var(--c-bd2)", flexShrink: 0 }}>
        <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.xls,.xlsx" style={{ display: "none" }}
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={chat.isPending} title="附参考图 / 文档（据图规划画面·风格·角色）"
          style={{ display: "inline-flex", width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: staged.length ? accent : "var(--c-t3)", cursor: chat.isPending ? "not-allowed" : "pointer", flexShrink: 0 }}>
          <Paperclip size={16} />
        </button>
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
          onDrop={(e) => { const fs = Array.from(e.dataTransfer.files); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
          onKeyDown={(e) => {
            if (showPicker) {
              if (e.key === "ArrowDown") { e.preventDefault(); setPickHi((i) => (i + 1) % pickItems.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setPickHi((i) => (i - 1 + pickItems.length) % pickItems.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applyPick(pickItems[pickHi].name); return; }
              if (e.key === "Escape") { e.preventDefault(); setPickDismiss(input); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder="指挥画布，Enter 发送；@ 角色、/ 技能、📎 附参考图" rows={1}
          style={{ flex: 1, resize: "none", maxHeight: 120, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t1)", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
        <button onClick={() => void send()} disabled={chat.isPending || (!input.trim() && staged.length === 0)} title="发送"
          style={{ display: "inline-flex", width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, border: `1px solid ${accent}`, background: accentSoft, color: accent, cursor: chat.isPending || (!input.trim() && !staged.length) ? "not-allowed" : "pointer", opacity: chat.isPending || (!input.trim() && !staged.length) ? 0.5 : 1, flexShrink: 0 }}>
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
