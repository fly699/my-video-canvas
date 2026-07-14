import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { Bot, Plus, Minus, X, Send, Loader2, MessageSquare, AtSign, Download, Copy, RefreshCw, Paperclip, Pin, Trash2, Code2, Eye, FileDown, Play, BookOpen, Pencil } from "lucide-react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useAiClient } from "../../hooks/useAiClient";
import { deriveAiSessions, resolveActiveSession } from "@/lib/aiClientSessions";
import { buildNodeContextContent, isReferableNode, nodeContextLabel, planMessageDrop, type ChatMsgAttachment } from "@/lib/aiClientContext";
import { loadNodeless, saveNodeless, addSession, removeSession, updateSession, sortSessions, makeNodelessId, isNodelessId, type NodelessSession } from "@/lib/aiClientNodeless";
import { parseMessageSegments, latestCodeArtifactFrom, CODE_MODE_SYSTEM_PROMPT, type CodeArtifact } from "@/lib/codeArtifacts";
import { CHAT_MODELS } from "@/lib/models";
import { AI_TEMPLATE_CATEGORIES, ALL_AI_TEMPLATES, BLANK_TEMPLATE_ID, NO_PERSONA_PROMPT } from "@/lib/aiAssistantTemplates";
import { useBridgeSkills } from "@/lib/useBridgeSkills";
import { useSelfHostedLlmModels } from "@/lib/useSelfHostedModels";
import { useDisabledModels } from "@/lib/useDisabledModels";
import { trpc } from "@/lib/trpc";
import type { NodeType } from "../../../../shared/types";

const MIN_W = 420, MIN_H = 360;

// ── 全局悬浮「AI 客户端」(综合 Claude/GPT/Grok 取长) ─────────────────────────────
// Cmd/Ctrl+J 呼出/最小化；左侧会话列表「同源」于画布 ai_chat 节点（会话即节点），中间对话流，
// 底部大输入框，顶部模型下拉。收发复用 aiChat.getMessages / sendMessage（与节点同一后端，数据互通）。
// 互通②③（@引用节点上下文 / 回答落成节点 / 素材库）在后续批次接入。

const ACCENT = "oklch(0.70 0.20 300)";

export function AiClientPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const reactFlow = useReactFlow();
  const { open, minimized, activeNodeId, close, setMinimized, setActive, pinned, setPinned, geometry, setGeometry } = useAiClient();
  const nodes = useCanvasStore((s) => s.nodes);
  const projectId = useCanvasStore((s) => s.projectId);
  const utils = trpc.useUtils();

  // 对话模型池（对齐聊天室助手）：内置聊天模型 + 后台「自建/桥接 LLM」，去重，
  // 过滤隐藏/代码专用（Codex）/后台停用（键 "chat:"）——补齐本地桥接/自建、剔除无法对话的代码模型。
  const selfHosted = useSelfHostedLlmModels();
  const disabledModels = useDisabledModels();
  const chatModels = useMemo(() => {
    const pool = selfHosted.length ? [...selfHosted.filter((s) => !CHAT_MODELS.some((m) => m.id === s.id)), ...CHAT_MODELS] : [...CHAT_MODELS];
    return pool.filter((m) => !m.hidden && !m.code && !disabledModels.has("chat:" + m.id));
  }, [selfHosted, disabledModels]);
  // 代码模式（对齐 GPT Canvas / Claude Artifacts）：模型池含代码专用模型（Codex 系置顶），
  // 默认用 Codex。持久化开关。
  const [codeMode, setCodeMode] = useState<boolean>(() => { try { return localStorage.getItem("avc:ai-client-code") === "1"; } catch { return false; } });
  const codeModels = useMemo(() => {
    const pool = selfHosted.length ? [...selfHosted.filter((s) => !CHAT_MODELS.some((m) => m.id === s.id)), ...CHAT_MODELS] : [...CHAT_MODELS];
    return pool.filter((m) => !m.hidden && !disabledModels.has("chat:" + m.id))
      .slice().sort((a, b) => (b.code ? 1 : 0) - (a.code ? 1 : 0)); // 代码模型置顶
  }, [selfHosted, disabledModels]);
  const modelOptions = codeMode ? codeModels : chatModels;
  const firstCodexId = useMemo(() => codeModels.find((m) => m.code)?.id, [codeModels]);
  const [showPreview, setShowPreview] = useState(false);

  // 无节点会话（不建 ai_chat 节点，也能记住）。#174：随账号服务端持久化（跨设备），
  // localStorage 仅作离线缓存/兜底。加载时先用缓存秒显，再用服务端结果合并覆盖。
  const [nodeless, setNodeless] = useState<NodelessSession[]>([]);
  useEffect(() => { setNodeless(projectId ? loadNodeless(projectId) : []); }, [projectId]);
  const sessionsQuery = trpc.aiChat.listSessions.useQuery({ projectId: projectId ?? 0 }, { enabled: !!projectId, staleTime: 30_000 });
  const upsertSessionMut = trpc.aiChat.upsertSession.useMutation();
  const deleteSessionMut = trpc.aiChat.deleteSession.useMutation();
  // 服务端结果到达 → 合并进本地（服务端权威、按 updatedAt 取新），并写回 localStorage 缓存。
  useEffect(() => {
    if (!projectId || !sessionsQuery.data) return;
    const server = sessionsQuery.data.map((r) => ({ id: r.sessionId, title: r.title, model: r.model ?? undefined, contextNodeIds: r.contextNodeIds ?? undefined, updatedAt: r.updatedAt }));
    setNodeless((local) => {
      const byId = new Map<string, NodelessSession>();
      for (const s of local) byId.set(s.id, s);
      for (const s of server) { const cur = byId.get(s.id); if (!cur || s.updatedAt >= cur.updatedAt) byId.set(s.id, s); }
      const merged = sortSessions(Array.from(byId.values()));
      saveNodeless(projectId, merged);
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsQuery.data, projectId]);
  const persistNodeless = (list: NodelessSession[]) => { setNodeless(list); if (projectId) saveNodeless(projectId, list); };
  // 单条会话服务端 upsert（随账号持久化）。projectId 缺失时静默跳过（仍有 localStorage 兜底）。
  const syncSessionUp = (s: NodelessSession) => { if (projectId) upsertSessionMut.mutate({ projectId, sessionId: s.id, title: s.title, ...(s.model ? { model: s.model } : {}), ...(s.contextNodeIds ? { contextNodeIds: s.contextNodeIds } : {}), updatedAt: s.updatedAt }); };
  const syncSessionDel = (id: string) => { if (projectId) deleteSessionMut.mutate({ projectId, sessionId: id }); };

  // 统一会话列表：画布 ai_chat 节点（同源）+ 无节点会话，按更新时间/出现顺序合并。
  const nodeSessions = useMemo(() => deriveAiSessions(nodes).map((s) => ({ id: s.nodeId, title: s.title, preview: s.preview, nodeless: false })), [nodes]);
  const sessions = useMemo(() => [
    ...sortSessions(nodeless).map((s) => ({ id: s.id, title: s.title, preview: "", nodeless: true })),
    ...nodeSessions,
  ], [nodeless, nodeSessions]);
  const active = useMemo(() => resolveActiveSession(sessions.map((s) => ({ nodeId: s.id, title: s.title, preview: s.preview, count: 0 })), activeNodeId), [sessions, activeNodeId]);
  useEffect(() => { if (active !== activeNodeId) setActive(active); }, [active, activeNodeId, setActive]);

  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(CHAT_MODELS.find((m) => m.tag === "默认")?.id ?? CHAT_MODELS[0].id);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 模板（人设）——复用聊天助手/ai_chat 节点同一套模板；存 id，发送时解析为 systemPrompt。
  const [aiTemplate, setAiTemplate] = useState<string>(() => { try { return localStorage.getItem("avc:ai-client-template") ?? BLANK_TEMPLATE_ID; } catch { return BLANK_TEMPLATE_ID; } });
  const personaPrompt = aiTemplate === BLANK_TEMPLATE_ID ? NO_PERSONA_PROMPT : ALL_AI_TEMPLATES.find((t) => t.id === aiTemplate)?.prompt;
  const changeTemplate = (id: string) => { setAiTemplate(id); try { localStorage.setItem("avc:ai-client-template", id); } catch { /* restricted */ } };
  // 「/ 唤起技能」——仅本机 Claude 桥接模型（技能是 Claude 能力）且服务端放行 Skill 时启用。
  const isClaudeLocalModel = model.toLowerCase().startsWith("claude-local");
  const bridgeSkills = useBridgeSkills(isClaudeLocalModel);
  const [skillHi, setSkillHi] = useState(0);
  const skillHiRef = useRef<HTMLButtonElement | null>(null);
  const [skillDismiss, setSkillDismiss] = useState("");
  const slashFrag = /^\/([^\s/]*)$/.exec(input)?.[1];
  const skillMatches = useMemo(() => {
    if (slashFrag === undefined) return [];
    const q = slashFrag.toLowerCase();
    return bridgeSkills.skills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [slashFrag, bridgeSkills.skills]);
  const showSkillPicker = isClaudeLocalModel && bridgeSkills.enabled && slashFrag !== undefined && input !== skillDismiss && skillMatches.length > 0;
  useEffect(() => { setSkillHi(0); }, [slashFrag]);
  useEffect(() => { skillHiRef.current?.scrollIntoView({ block: "nearest" }); }, [skillHi]);
  const pickSkill = (name: string) => { setInput(`用 ${name} 技能：`); setSkillDismiss(""); };
  const [pendingAtts, setPendingAtts] = useState<ChatMsgAttachment[]>([]);
  // #176 各栏可拖动调宽（会话侧栏 / 工件面板），持久化。
  const [sidebarW, setSidebarW] = useState<number>(() => { try { return Number(localStorage.getItem("avc:ai-sidebar-w")) || 196; } catch { return 196; } });
  const [artifactW, setArtifactW] = useState<number>(() => { try { return Number(localStorage.getItem("avc:ai-artifact-w")) || 340; } catch { return 340; } });
  useEffect(() => { try { localStorage.setItem("avc:ai-sidebar-w", String(sidebarW)); } catch { /* restricted */ } }, [sidebarW]);
  useEffect(() => { try { localStorage.setItem("avc:ai-artifact-w", String(artifactW)); } catch { /* restricted */ } }, [artifactW]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadMut = trpc.upload.uploadAiChatImage.useMutation();
  const clearMut = trpc.aiChat.clearMessages.useMutation();
  // #172-批2 代码真实执行：工件「运行」桥接工程智能体沙箱（runCodeTask，需 L4 + 服务端开启）。
  const codeStatusQuery = trpc.superAgent.codeStatus.useQuery(undefined, { enabled: codeMode, retry: false });
  const runCodeMut = trpc.superAgent.runCodeTask.useMutation();
  const [runResult, setRunResult] = useState<{ status: string; text: string } | null>(null);

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
    if (isNodeless) {
      const list = updateSession(nodeless, active, { contextNodeIds: ids, updatedAt: Date.now() });
      persistNodeless(list);
      const s = list.find((x) => x.id === active); if (s) syncSessionUp(s);
    } else useCanvasStore.getState().updateNodeData(active, { contextNodeIds: ids }, true);
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
    if (isNodeless) {
      const list = updateSession(nodeless, active, { model: m, updatedAt: Date.now() });
      persistNodeless(list);
      const s = list.find((x) => x.id === active); if (s) syncSessionUp(s);
    } else useCanvasStore.getState().updateNodeData(active, { model: m }, true);
  };
  // 切换代码模式：持久化开关；开启时若当前不是代码模型，切到首个 Codex。
  const toggleCodeMode = () => {
    const next = !codeMode;
    setCodeMode(next);
    try { localStorage.setItem("avc:ai-client-code", next ? "1" : "0"); } catch { /* restricted */ }
    if (next) {
      setShowPreview(false);
      const curIsCode = codeModels.find((m) => m.id === model)?.code;
      if (!curIsCode && firstCodexId) changeModel(firstCodexId);
    }
  };

  const msgQuery = trpc.aiChat.getMessages.useQuery(
    { nodeId: active ?? "", projectId: projectId ?? 0 },
    { enabled: open && !minimized && !!active && !!projectId },
  );
  const messages = msgQuery.data ?? [];
  // 代码模式工件：从对话里取最新代码块，供右侧工件面板展示/预览/下载/落成节点。
  const artifact = useMemo<CodeArtifact | null>(
    () => (codeMode ? latestCodeArtifactFrom(messages.map((m) => ({ role: m.role, content: m.content }))) : null),
    [codeMode, messages],
  );

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
    syncSessionUp(s); // #174 随账号持久化
    setActive(s.id);
    setInput(""); setPendingAtts([]);
    toast.success("已新建会话");
  };
  // 删除无节点会话（清索引 + 清服务端消息）。节点会话由画布管理，这里不删。
  const deleteNodelessSession = (id: string) => {
    persistNodeless(removeSession(nodeless, id));
    syncSessionDel(id); // #174 清服务端会话索引
    if (projectId) clearMut.mutate({ nodeId: id, projectId });
    if (active === id) setActive(null);
    toast.success("已删除会话");
  };
  // 会话更名：无节点会话改本地索引（+服务端持久化）；画布节点会话改节点标题（updateNodeTitle）。
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const startRename = (id: string, title: string) => { setRenamingId(id); setRenameText(title); };
  const commitRename = () => {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const title = renameText.trim();
    if (!title) return;
    if (isNodelessId(id)) {
      const list = updateSession(nodeless, id, { title, updatedAt: Date.now() });
      persistNodeless(list);
      const up = list.find((x) => x.id === id); if (up) syncSessionUp(up);
    } else {
      useCanvasStore.getState().updateNodeTitle(id, title);
    }
  };

  const doSend = (text: string, attachments: ChatMsgAttachment[]) => {
    if (!active || !projectId) return;
    const contextContent = buildNodeContextContent(nodes, contextIds);
    // systemPrompt = 模板人设（空模板=NO_PERSONA_PROMPT）；代码模式再叠加 Canvas/Artifacts 指令。
    const sysPrompt = codeMode ? [CODE_MODE_SYSTEM_PROMPT, personaPrompt].filter(Boolean).join("\n\n") : personaPrompt;
    sendMut.mutate({
      nodeId: active, projectId, message: text, model,
      ...(sysPrompt ? { systemPrompt: sysPrompt } : {}),
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
      const list = updateSession(nodeless, active, { title, updatedAt: Date.now() });
      persistNodeless(list);
      const s = list.find((x) => x.id === active); if (s) syncSessionUp(s); // #174 随账号持久化
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

  // 代码工件：下载为文件 / 落成便签节点（带围栏保留语言）。
  const downloadArtifact = (a: CodeArtifact) => {
    try {
      const blob = new Blob([a.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a"); el.href = url; el.download = a.filename; el.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast.error("下载失败"); }
  };
  const dropArtifactToCanvas = (a: CodeArtifact) => {
    const base = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 120, y: window.innerHeight / 2 - 80 });
    const node = useCanvasStore.getState().addNode("note", base);
    useCanvasStore.getState().updateNodeData(node.id, { content: "```" + (a.lang || "") + "\n" + a.content + "\n```" });
    toast.success("代码已落成便签节点");
  };
  // 运行工件：把代码作为任务派给工程智能体沙箱真实执行（runCodeTask），回填运行结果。
  const runArtifact = (a: CodeArtifact) => {
    if (!projectId) { toast.error("画布未就绪"); return; }
    if (runCodeMut.isPending) return;
    // 代码任务 task 上限 40000；极端超长的工件先下载/落成节点再手动运行，避免静默触顶。
    if (a.content.length > 39000) { toast.error("代码过长（超运行上限），请先下载或落成节点后手动运行"); return; }
    setRunResult(null);
    const task = `请把下面的代码保存为 ${a.filename} 并在沙箱中运行，返回运行输出/结果（若报错请贴出完整报错）：\n\n\`\`\`${a.lang || ""}\n${a.content}\n\`\`\``;
    // 执行走本机桥接沙箱：仅本机桥接模型（claude-local*/gpt-local*）可传给 runCodeTask；
    // kie/云端模型无法本机执行 → 省略 model 用桥接默认（本机订阅模型）。
    const runModel = (model.startsWith("claude-local") || model.startsWith("gpt-local")) ? model : undefined;
    runCodeMut.mutate(
      { projectId, nodeId: `code-${active ?? "run"}`, task, ...(runModel ? { model: runModel } : {}) },
      {
        onSuccess: (r) => setRunResult({ status: r.status, text: r.result ?? r.diagnostic ?? "（无输出）" }),
        onError: (e) => { setRunResult({ status: "failed", text: e.message }); toast.error("运行失败：" + e.message); },
      },
    );
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
  // #176 栏宽拖拽：侧栏向右拖变宽；工件面板向左拖变宽（各自钳制）。
  const startColResize = (which: "sidebar" | "artifact") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const start0 = which === "sidebar" ? sidebarW : artifactW;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (which === "sidebar") setSidebarW(clamp(start0 + dx, 140, 380));
      else setArtifactW(clamp(start0 - dx, 240, 620));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  // 嵌入模式（独立页 /ai）：始终渲染、无浮动壳、不最小化。
  if (!embedded && !open) return null;

  // 最小化：右下角悬浮小球。
  if (!embedded && minimized) {
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

  const modelLabel = chatModels.find((m) => m.id === model)?.label ?? CHAT_MODELS.find((m) => m.id === model)?.label ?? model;

  const panelTree = (
    <div
      className="nodrag"
      style={embedded ? {
        position: "absolute", inset: 0, zIndex: 1,
        display: "flex", flexDirection: "column", background: "var(--c-surface)", overflow: "hidden",
      } : {
        position: "fixed", left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: 210,
        display: "flex", flexDirection: "column", background: "var(--c-surface)", border: "1px solid var(--c-bd2)",
        borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.45)", overflow: "hidden",
      }}
    >
      {/* 顶栏（浮动模式可拖拽移动窗口；嵌入模式不可拖、不显窗口控制） */}
      <div onPointerDown={embedded ? undefined : startDrag} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--c-bd1)", cursor: embedded ? "default" : "move", touchAction: "none" }}>
        {!embedded && <>
          <span style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 8, background: `color-mix(in oklch, ${ACCENT} 16%, transparent)`, color: ACCENT }}><Bot size={16} /></span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--c-t1)" }}>AI 客户端</span>
        </>}
        <select value={model} onChange={(e) => changeModel(e.target.value)} className="nodrag"
          style={{ marginLeft: 6, fontSize: 11.5, padding: "4px 8px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none", maxWidth: 200 }}
          title={`当前模型：${modelLabel}`}>
          {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={toggleCodeMode} title={codeMode ? "退出代码模式" : "代码模式（Codex 写码 + 工件面板/预览，对齐 Canvas/Artifacts）"}
          style={{ ...iconBtn, color: codeMode ? ACCENT : "var(--c-t3)", background: codeMode ? `color-mix(in oklch, ${ACCENT} 16%, transparent)` : "transparent" }}><Code2 size={15} /></button>
        {!embedded && <>
          <button onClick={() => setPinned(!pinned)} title={pinned ? "取消钉住" : "钉住（记住展开态，进画布自动打开）"} style={{ ...iconBtn, color: pinned ? ACCENT : "var(--c-t3)" }}><Pin size={15} fill={pinned ? ACCENT : "none"} /></button>
          <button onClick={() => setMinimized(true)} title="最小化（Cmd/Ctrl+J）" style={iconBtn}><Minus size={16} /></button>
          <button onClick={close} title="关闭" style={iconBtn}><X size={16} /></button>
        </>}
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 会话侧栏（同源于 ai_chat 节点） */}
        <div style={{ position: "relative", width: sidebarW, flexShrink: 0, borderRight: "1px solid var(--c-bd1)", display: "flex", flexDirection: "column", background: "var(--c-bg, var(--c-surface))" }}>
          {/* #176 右边框拖拽调宽 */}
          <div onPointerDown={startColResize("sidebar")} className="nodrag" title="拖动调整侧栏宽度"
            style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 3, touchAction: "none" }} />
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
                  {renamingId === s.id ? (
                    <input autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} className="nodrag"
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } else if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); } }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 9px", background: "var(--c-input)", border: `1px solid ${ACCENT}`, borderRadius: 9, color: "var(--c-t1)", fontSize: 12, fontWeight: 600, outline: "none" }} />
                  ) : (
                  <button onClick={() => setActive(s.id)} onDoubleClick={() => startRename(s.id, s.title)} className="nodrag"
                    style={{ width: "100%", textAlign: "left", padding: "8px 9px", background: "transparent", border: "none", cursor: "pointer", color: "var(--c-t1)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: s.nodeless ? 34 : 18 }}>
                      <MessageSquare size={12} style={{ flexShrink: 0, color: on ? ACCENT : "var(--c-t4)" }} />
                      <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                      {!s.nodeless && <span title="画布节点会话" style={{ flexShrink: 0, fontSize: 9, color: "var(--c-t4)" }}>◈</span>}
                    </span>
                    {s.preview && <span style={{ display: "block", fontSize: 10.5, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{s.preview}</span>}
                  </button>
                  )}
                  {/* 更名（双击标题亦可）+ 删除（仅无节点会话；画布节点会话请在画布上删）。 */}
                  {renamingId !== s.id && (
                    <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 2 }}>
                      <button onClick={() => startRename(s.id, s.title)} className="nodrag" title="重命名会话（或双击标题）"
                        style={{ width: 18, height: 18, borderRadius: 5, border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = ACCENT; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}>
                        <Pencil size={10} />
                      </button>
                      {s.nodeless && (
                        <button onClick={() => deleteNodelessSession(s.id)} className="nodrag" title="删除会话"
                          style={{ width: 18, height: 18, borderRadius: 5, border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.62 0.2 20)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}>
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
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
                  maxWidth: "82%", borderRadius: 13, fontSize: 13, lineHeight: 1.6, wordBreak: "break-word", overflow: "hidden",
                  background: m.role === "user" ? `color-mix(in oklch, ${ACCENT} 18%, var(--c-input))` : "var(--c-input)",
                  color: "var(--c-t1)", border: "1px solid var(--c-bd2)",
                }}>
                  {parseMessageSegments(m.content).map((seg, si) => seg.type === "text" ? (
                    <div key={si} style={{ padding: "9px 13px", whiteSpace: "pre-wrap" }}>{seg.content}</div>
                  ) : (
                    <div key={si} style={{ background: "var(--c-base)", borderTop: "1px solid var(--c-bd1)", borderBottom: "1px solid var(--c-bd1)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", fontSize: 10.5, color: "var(--c-t4)", borderBottom: "1px solid var(--c-bd1)" }}>
                        <Code2 size={11} /><span>{seg.lang || "code"}</span>
                        <div style={{ flex: 1 }} />
                        <button onClick={() => copyText(seg.content)} className="nodrag" title="复制代码"
                          style={{ ...msgActBtn, fontSize: 10 }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = ACCENT; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}>
                          <Copy size={10} /> 复制
                        </button>
                      </div>
                      <pre className="nowheel" style={{ margin: 0, padding: "10px 12px", overflowX: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.5, color: "var(--c-t1)" }}><code>{seg.content}</code></pre>
                    </div>
                  ))}
                </div>
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
            {/* 模板（人设）+ /技能 提示——移植自聊天室 AI 助手 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7, fontSize: 11.5, color: "var(--c-t3)", flexWrap: "wrap" }}>
              <BookOpen size={13} style={{ color: ACCENT, flexShrink: 0 }} />
              <span style={{ flexShrink: 0 }}>模板</span>
              <select value={aiTemplate} onChange={(e) => changeTemplate(e.target.value)} className="nodrag"
                title={aiTemplate === BLANK_TEMPLATE_ID ? "无任何人设，通用助手直接回答" : ALL_AI_TEMPLATES.find((t) => t.id === aiTemplate)?.blurb}
                style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 7, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none", maxWidth: 200 }}>
                <option value={BLANK_TEMPLATE_ID}>空模板（无人设）</option>
                {AI_TEMPLATE_CATEGORIES.map((cat) => (
                  <optgroup key={cat.label} label={cat.label}>
                    {cat.templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>
              {isClaudeLocalModel && bridgeSkills.enabled && bridgeSkills.skills.length > 0 && (
                <span style={{ color: ACCENT }}>· 输入 <strong>/</strong> 选技能</span>
              )}
            </div>
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
            {/* 「/ 唤起技能」面板：输入以 / 开头时浮在输入框上方（本机 Claude 桥接专属） */}
            {showSkillPicker && (
              <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", left: 12, right: 12, bottom: "calc(100% - 4px)", maxHeight: 240, overflowY: "auto", zIndex: 6,
                  background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.4)", padding: 6 }}>
                <div style={{ fontSize: 10.5, color: "var(--c-t4)", padding: "3px 8px 5px" }}>技能 · ↑↓ 选择 · Enter 确认 · Esc 关闭</div>
                {skillMatches.map((s, i) => (
                  <button key={s.name} type="button" ref={i === skillHi ? skillHiRef : undefined}
                    onMouseMove={() => setSkillHi(i)} onClick={() => pickSkill(s.name)} className="nodrag"
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                      background: i === skillHi ? `color-mix(in oklch, ${ACCENT} 12%, transparent)` : "transparent", color: "var(--c-t1)" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: i === skillHi ? ACCENT : "var(--c-t1)" }}>/{s.name}</div>
                    {s.description && <div style={{ fontSize: 11, color: "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description}</div>}
                  </button>
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
                onKeyDown={(e) => {
                  // 技能面板打开时，↑↓ 选择 / Enter 确认 / Esc 关闭，优先于发送。
                  if (showSkillPicker) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setSkillHi((h) => Math.min(h + 1, skillMatches.length - 1)); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setSkillHi((h) => Math.max(h - 1, 0)); return; }
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); pickSkill(skillMatches[skillHi]?.name ?? skillMatches[0].name); return; }
                    if (e.key === "Escape") { e.preventDefault(); setSkillDismiss(input); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
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

        {/* 代码模式「工件面板」（对齐 GPT Canvas / Claude Artifacts）：展示最新代码，可预览/复制/下载/落成节点 */}
        {codeMode && (
          <div style={{ position: "relative", width: artifactW, flexShrink: 0, borderLeft: "1px solid var(--c-bd1)", display: "flex", flexDirection: "column", minWidth: 0, background: "var(--c-bg, var(--c-surface))" }}>
            {/* #176 左边框拖拽调宽 */}
            <div onPointerDown={startColResize("artifact")} className="nodrag" title="拖动调整工件面板宽度"
              style={{ position: "absolute", top: 0, left: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 3, touchAction: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--c-bd1)" }}>
              <FileDown size={13} style={{ color: ACCENT, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artifact ? artifact.filename : "代码工件"}</span>
              <div style={{ flex: 1 }} />
              {artifact?.previewable && (
                <button onClick={() => setShowPreview((v) => !v)} className="nodrag" title={showPreview ? "看源码" : "实时预览"}
                  style={{ ...iconBtn, width: 24, height: 24, color: showPreview ? ACCENT : "var(--c-t3)" }}><Eye size={14} /></button>
              )}
              {artifact && <>
                {codeStatusQuery.data?.enabled && (
                  <button onClick={() => runArtifact(artifact)} disabled={runCodeMut.isPending} className="nodrag" title="在工程智能体沙箱运行（本机桥接）"
                    style={{ ...iconBtn, width: 24, height: 24, color: runCodeMut.isPending ? "var(--c-t4)" : "oklch(0.62 0.2 155)" }}>
                    {runCodeMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  </button>
                )}
                <button onClick={() => copyText(artifact.content)} className="nodrag" title="复制代码" style={{ ...iconBtn, width: 24, height: 24 }}><Copy size={13} /></button>
                <button onClick={() => downloadArtifact(artifact)} className="nodrag" title="下载文件" style={{ ...iconBtn, width: 24, height: 24 }}><Download size={13} /></button>
                <button onClick={() => dropArtifactToCanvas(artifact)} className="nodrag" title="落成便签节点" style={{ ...iconBtn, width: 24, height: 24 }}><Plus size={14} /></button>
              </>}
            </div>
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }} className="nowheel">
              {!artifact ? (
                <div style={{ margin: "auto", padding: "24px 16px", textAlign: "center", color: "var(--c-t4)", fontSize: 12, lineHeight: 1.7 }}>
                  <Code2 size={26} style={{ opacity: 0.5 }} /><div style={{ marginTop: 8 }}>让 AI 写代码，产物会出现在这里<br />（可预览 HTML、复制、下载、落成节点）</div>
                </div>
              ) : (artifact.previewable && showPreview) ? (
                <iframe title="preview" sandbox="allow-scripts" srcDoc={artifact.content} style={{ width: "100%", height: "100%", border: "none", background: "#fff" }} />
              ) : (
                <pre style={{ margin: 0, padding: "10px 12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.5, color: "var(--c-t1)", whiteSpace: "pre", minWidth: "min-content" }}><code>{artifact.content}</code></pre>
              )}
            </div>
            {/* 运行结果 / 代码任务未启用提示 */}
            {(runResult || runCodeMut.isPending) && (
              <div style={{ flexShrink: 0, maxHeight: "40%", overflow: "auto", borderTop: "1px solid var(--c-bd1)", background: "var(--c-canvas, var(--c-base))" }} className="nowheel">
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", fontSize: 10.5, color: "var(--c-t4)", borderBottom: "1px solid var(--c-bd1)" }}>
                  <Play size={11} /><span>运行结果{runResult ? `（${runResult.status === "success" ? "成功" : runResult.status === "aborted" ? "已拦截" : "失败"}）` : "…"}</span>
                  {runResult && <button onClick={() => setRunResult(null)} className="nodrag" style={{ ...iconBtn, width: 18, height: 18, marginLeft: "auto" }}><X size={11} /></button>}
                </div>
                {runCodeMut.isPending ? (
                  <div style={{ padding: "10px 12px", color: "var(--c-t4)", fontSize: 12 }}><Loader2 size={14} className="animate-spin" /> 沙箱运行中…</div>
                ) : (
                  <pre style={{ margin: 0, padding: "10px 12px", fontFamily: "ui-monospace, monospace", fontSize: 11.5, lineHeight: 1.5, color: runResult?.status === "success" ? "var(--c-t1)" : "oklch(0.7 0.18 25)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{runResult?.text}</pre>
                )}
              </div>
            )}
            {artifact && codeStatusQuery.data && !codeStatusQuery.data.enabled && (
              <div style={{ flexShrink: 0, padding: "6px 10px", borderTop: "1px solid var(--c-bd1)", fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5 }}>
                代码任务未启用——「运行」需超管 L4 + 服务端开启（可复制/下载/落成节点/预览照常可用）。
              </div>
            )}
          </div>
        )}
      </div>

      {/* 右下角缩放手柄（仅浮动模式：拖拽改变窗口尺寸；持久化） */}
      {!embedded && <div onPointerDown={startResize} className="nodrag" title="拖拽缩放"
        style={{ position: "absolute", right: 0, bottom: 0, width: 18, height: 18, cursor: "nwse-resize", touchAction: "none",
          background: "linear-gradient(135deg, transparent 50%, var(--c-bd2) 50%, var(--c-bd2) 62%, transparent 62%, transparent 74%, var(--c-bd2) 74%, var(--c-bd2) 86%, transparent 86%)" }} />}
    </div>
  );
  // 嵌入模式：就地渲染（铺满父容器）；浮动模式：portal 到 body。
  return embedded ? panelTree : createPortal(panelTree, document.body);
}

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: "var(--c-t3)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const msgActBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--c-t4)",
  background: "transparent", border: "none", cursor: "pointer", padding: 0,
};
