import { useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { createPortal } from "react-dom";
import { Sparkles, Send, Loader2, X, Plus, Link2, Pencil, AlertTriangle, CornerUpLeft, BookOpen, Focus, Paperclip, Image as ImageIcon, FileText, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { buildGraphSummary, applyAgentOperations } from "@/lib/agentApply";
import { runAgentChatJob } from "@/lib/agentChatJob";
import { friendlyClientLLMError } from "@/lib/friendlyClientError";
import { resolveActiveNodeModel } from "../../contexts/NodeDefaultModelsContext";
import { LLMModelPicker, type LLMModelId } from "./LLMModelPicker";
import { MiniSelect } from "@/components/ui/MiniSelect";
import { useBridgeSkills } from "@/lib/useBridgeSkills";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { AI_TEMPLATE_CATEGORIES, ALL_AI_TEMPLATES, BLANK_TEMPLATE_ID, BLANK_TEMPLATE_LABEL } from "@/lib/aiAssistantTemplates";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/models";
import type { AgentOperation } from "../../../../shared/types";

/** 浮动「画布助手」：对话式让 AI（如本机 Claude）边聊边直接改画布。复用智能体节点同一套引擎
 *  （agent.chat 规划 + buildGraphSummary 看实时画布 + applyAgentOperations 落地）。
 *  已对齐聊天助手：模板人设、@角色 引用、/ 调技能（本机 Claude 桥接，MCP 亦自动可用）、撤销本次改动。
 *  结构性操作自动落地且不花钱；「运行/生成」仍需在节点上点运行（防误烧额度）。 */
type Turn = { role: "user" | "assistant"; content: string; applied?: string; failed?: string; error?: boolean; createdIds?: string[]; undone?: boolean };

const accent = "oklch(0.70 0.20 310)";
const accentSoft = "oklch(0.70 0.20 310 / 0.14)";

// 「快速设置」——把创作偏好注入助手规划（agent.chat 的 prefs 约束块 + 落地时的 aspect/模型/节点白名单）。
// genNodes：允许智能体使用的生成节点类型（空=不限）；imageModel/videoProvider：指定生成模型（空=助手自选/节点默认）。
type QuickPrefs = { aspect: string; style: string; durationSec: number; imageFirst: boolean; addMusic: boolean; addSubtitle: boolean; imageModel: string; videoProvider: string; genNodes: string[]; workflowTemplateIds: number[] };
const QP_DEFAULT: QuickPrefs = { aspect: "", style: "", durationSec: 0, imageFirst: false, addMusic: false, addSubtitle: false, imageModel: "", videoProvider: "", genNodes: [], workflowTemplateIds: [] };
const QP_GEN_NODES: { v: string; label: string }[] = [
  { v: "image_gen", label: "云端图像" }, { v: "video_task", label: "云端视频" },
  { v: "comfyui_image", label: "ComfyUI图像" }, { v: "comfyui_video", label: "ComfyUI视频" }, { v: "comfyui_workflow", label: "ComfyUI模板" },
];
const QP_ASPECTS = ["", "16:9", "9:16", "1:1", "4:3"];
// 指定模型下拉的分组选项（与节点选择器同源清单；MiniSelect 自绘下拉，缩放窗口内可点）。
const groupModelOptions = <T extends { group: string; value: string; label: string }>(ms: readonly T[], title: (m: T) => string | undefined) => {
  const order: string[] = []; const by = new Map<string, T[]>();
  for (const m of ms) { if (!by.has(m.group)) { by.set(m.group, []); order.push(m.group); } by.get(m.group)!.push(m); }
  return order.map((g) => ({ label: g, options: by.get(g)!.map((m) => ({ value: m.value, label: m.label, title: title(m) })) }));
};
const QP_IMAGE_MODEL_GROUPS = [
  { options: [{ value: "", label: "默认（助手自选）" }] },
  ...groupModelOptions(IMAGE_MODELS, (m) => m.desc),
];
const QP_VIDEO_MODEL_GROUPS = [
  { options: [{ value: "", label: "默认（助手自选）" }] },
  ...groupModelOptions(VIDEO_MODELS.filter((m) => m.value !== "mock"), (m) => m.costLabel),
];
const QP_STYLES = ["电影感", "赛博朋克", "写实", "动漫", "水彩插画", "3D 渲染", "复古胶片", "极简", "梦幻唯美"];
const QP_DURATIONS: { v: number; label: string }[] = [{ v: 0, label: "不限" }, { v: 15, label: "15s" }, { v: 30, label: "30s" }, { v: 60, label: "60s" }];

const MAX_ATTACHMENTS = 4;
const MAX_ATTACH_MB = 10;
const MAX_TOTAL_ATTACH_MB = 24; // 合计上限：base64 膨胀 1.37×，24MB→约 33MB，稳在 50MB body 限内
/** 读成完整 data: URI（含前缀），供 agent.chat 的 image_url/file_url 直接使用。 */
const fileToDataUri = (f: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = () => reject(r.error ?? new Error("读取文件失败"));
  r.readAsDataURL(f);
});

/** 存库前裁剪到 saveHistory 的 zod 约束内（content≤20000、applied/failed≤4000、createdIds≤200×64），
 *  只保留最近 80 轮，避免超长回复被后端校验拒绝。 */
const sanitizeTurnsForSave = (ts: Turn[]) => ts.slice(-80).map((t) => ({
  role: t.role,
  content: t.content.slice(0, 20000),
  ...(t.applied ? { applied: t.applied.slice(0, 4000) } : {}),
  ...(t.failed ? { failed: t.failed.slice(0, 4000) } : {}),
  ...(t.error ? { error: true } : {}),
  ...(t.createdIds ? { createdIds: t.createdIds.slice(0, 200).map((x) => x.slice(0, 64)) } : {}),
  ...(t.undone ? { undone: true } : {}),
}));

export function CanvasAgentChat({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const reactFlow = useReactFlow();
  // 规划改「submitChat 提交 → chatStatus 轮询」：长生成不再押一条 HTTP 长连接（断连/掐线/
  // 服务端慢都曾让已生成完的回复报「网络请求失败」白丢）。busy 为本地进行中状态。
  const [busy, setBusy] = useState(false);
  // 服务端持久化：跨设备/清缓存后对话仍在（替代原来仅 localStorage）。
  const historyQuery = trpc.agent.getHistory.useQuery({ projectId }, { staleTime: Infinity, refetchOnWindowFocus: false });
  const saveHistoryMut = trpc.agent.saveHistory.useMutation();
  const utils = trpc.useUtils();
  const hydratedRef = useRef(false);
  const templatesQuery = trpc.comfyTemplates.list.useQuery(undefined, { staleTime: 30_000 });
  const charsQuery = trpc.characterLibrary.list.useQuery(undefined, { staleTime: 30_000 });
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);

  const [turns, setTurns] = useState<Turn[]>(() => {
    try { const s = localStorage.getItem(`avc:canvasAgent:${projectId}`); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  // 挂载时的 turns 快照——用于判断 DB hydrate 到达前用户是否已操作（避免用陈旧 DB 覆盖进行中的对话）。
  const mountTurnsRef = useRef<string | null>(null);
  if (mountTurnsRef.current === null) mountTurnsRef.current = JSON.stringify(turns);
  // 存库 = 写 DB + 同步 react-query 缓存（否则 staleTime:Infinity 下重开面板会命中旧快照、把新消息覆盖回退）。
  const persistTurns = (t: Turn[]) => {
    const clean = sanitizeTurnsForSave(t);
    utils.agent.getHistory.setData({ projectId }, { turns: clean as Turn[] });
    saveHistoryMut.mutate({ projectId, turns: clean }, { onError: (err) => toast.error("画布助手对话保存失败：" + (err.message || "网络错误")) });
  };
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
      const next = [...prev, ...files.slice(0, room)];
      // 合计上限：4×10MB 转 base64 后 ≈56MB，会撞服务端 50MB body 限返回 HTML 错误页。
      const total = next.reduce((a, f) => a + f.size, 0);
      if (total > MAX_TOTAL_ATTACH_MB * 1024 * 1024) { setAttachErr(`附件合计不能超过 ${MAX_TOTAL_ATTACH_MB}MB（当前 ${(total / 1024 / 1024).toFixed(0)}MB），请压缩或减少文件`); return prev; }
      if (files.length > room) setAttachErr(`最多附 ${MAX_ATTACHMENTS} 个文件，已取前 ${room} 个`);
      return next;
    });
  };
  const [model, setModel] = useState<LLMModelId>(() =>
    (localStorage.getItem("avc:canvasAgent:model") as LLMModelId) || (resolveActiveNodeModel("agent", "llm") as LLMModelId));
  const [template, setTemplate] = useState<string>(() => localStorage.getItem("avc:canvasAgent:template") || BLANK_TEMPLATE_ID);
  // 快速设置（比例/风格/时长/生图先行/配乐/字幕）——注入助手规划。
  const [quickPrefs, setQuickPrefs] = useState<QuickPrefs>(() => {
    try { const s = localStorage.getItem("avc:canvasAgent:prefs"); if (s) return { ...QP_DEFAULT, ...JSON.parse(s) }; } catch { /* ignore */ }
    return QP_DEFAULT;
  });
  const [showQuick, setShowQuick] = useState(false);
  const setQP = (patch: Partial<QuickPrefs>) => setQuickPrefs((p) => ({ ...p, ...patch }));
  const qpActiveCount = (quickPrefs.aspect ? 1 : 0) + (quickPrefs.style ? 1 : 0) + (quickPrefs.durationSec ? 1 : 0) + (quickPrefs.imageFirst ? 1 : 0) + (quickPrefs.addMusic ? 1 : 0) + (quickPrefs.addSubtitle ? 1 : 0)
    + (quickPrefs.imageModel ? 1 : 0) + (quickPrefs.videoProvider ? 1 : 0) + (quickPrefs.genNodes.length ? 1 : 0) + (quickPrefs.workflowTemplateIds.length ? 1 : 0);
  // 「ComfyUI模板」的二级选择：模板库中已存在的工作流模板（只有 comfyui_workflow 型模板
  // 带 workflowJson，可被 comfyui_workflow 节点引用）。选中 = 只允许助手用这些模板。
  const workflowTemplates = (templatesQuery.data ?? []).filter((t) => t.nodeType === "comfyui_workflow");
  const chosenWorkflowTpls = workflowTemplates.filter((t) => quickPrefs.workflowTemplateIds.includes(t.id));
  const buildQuickPrefsText = (): string | undefined => {
    const lines: string[] = [];
    if (quickPrefs.imageFirst) lines.push("- 【强制·先生图再生视频】每个视频镜头先建 image_gen 图像节点（把镜头画面描述作为它的 prompt），再建 video_task 视频节点并连接 image_gen → video_task 作首帧，严禁 storyboard/prompt/script 直连 video_task 做文生视频。");
    if (quickPrefs.addMusic) lines.push("- 自动添加 audio 配乐节点并连入 merge 合并节点。");
    if (quickPrefs.addSubtitle) lines.push("- 自动添加 subtitle 字幕节点（接在视频/合并之后）。");
    if (quickPrefs.aspect) lines.push(`- 画面比例统一为 ${quickPrefs.aspect}。`);
    if (quickPrefs.style.trim()) lines.push(`- 整体视觉风格：${quickPrefs.style.trim()}。`);
    if (quickPrefs.durationSec > 0) lines.push(`- 目标总时长约 ${quickPrefs.durationSec} 秒，据此规划镜头数与每镜时长。`);
    if (quickPrefs.genNodes.length) lines.push(`- 【强制】生成节点只允许使用：${quickPrefs.genNodes.join(" / ")}；其余生成节点类型（image_gen/video_task/comfyui_image/comfyui_video/comfyui_workflow 中未列出的）一律禁止创建。`);
    if (quickPrefs.imageModel) lines.push(`- 【强制】图像生成一律使用模型 ${quickPrefs.imageModel}（写入 image_gen.model / storyboard.imageModel）。`);
    if (quickPrefs.videoProvider) lines.push(`- 【强制】视频生成一律使用模型 ${quickPrefs.videoProvider}（写入 video_task.provider；params 键与取值严格按该模型的参数表）。`);
    if (chosenWorkflowTpls.length) lines.push(`- 【强制】comfyui_workflow 节点只允许引用以下模板：${chosenWorkflowTpls.map((t) => `id=${t.id}「${t.label}」`).join("、")}；其它模板一律禁止。`);
    return lines.length ? lines.join("\n") : undefined;
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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
  // 初始位置也钳制在视口内（窄屏下 380px 面板若不钳制会右侧溢出被裁）。
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const effW = Math.min(size.w, vw - 16);
  const left = pos ? Math.max(8, Math.min(pos.left, vw - effW - 8)) : Math.max(8, vw - effW - 16);
  const top = pos ? pos.top : Math.max(8, window.innerHeight - size.h - 16);

  // ── 收起为悬浮小球（点关闭=收起，非真关闭；小球右键才可关闭）──
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem("avc:canvasAgent:collapsed") === "1");
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:collapsed", collapsed ? "1" : "0"); } catch { /* quota */ } }, [collapsed]);
  const BALL = 44; // 小球直径（比原 58 小巧，减少遮挡；≥44 满足移动端触摸目标）
  const [ballPos, setBallPos] = useState<{ left: number; top: number } | null>(() => {
    try { const s = localStorage.getItem("avc:canvasAgent:ballpos"); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return null;
  });
  useEffect(() => { if (ballPos) { try { localStorage.setItem("avc:canvasAgent:ballpos", JSON.stringify(ballPos)); } catch { /* quota */ } } }, [ballPos]);
  const ballLeft = ballPos ? ballPos.left : 16; // 默认左下角
  const ballTop = ballPos ? ballPos.top : Math.max(8, (window.visualViewport?.height ?? window.innerHeight) - BALL - 16);
  const [ballMenu, setBallMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!ballMenu) return;
    const close = () => setBallMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", close); };
  }, [ballMenu]);
  // 拖拽小球；位移过小视为点击 → 展开面板。用 Pointer 事件统一鼠标 + 触屏（移动端也能拖），
  // setPointerCapture 让 move/up 始终落到小球本身。鼠标仅左键触发（右键留给菜单）。
  const startBallDrag = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    const sx = e.clientX, sy = e.clientY, il = ballLeft, it = ballTop;
    // 触屏轻点常有 5-10px 抖动，slop 放宽到 10 避免「想点却挪了球、面板没展开」；鼠标仍用 4。
    const slop = e.pointerType === "touch" ? 10 : 4;
    let moved = false;
    const onMove = (mv: PointerEvent) => {
      if (!moved && Math.hypot(mv.clientX - sx, mv.clientY - sy) < slop) return;
      moved = true;
      setBallPos({
        left: Math.max(0, Math.min(window.innerWidth - BALL, il + mv.clientX - sx)),
        top: Math.max(0, Math.min(window.innerHeight - BALL, it + mv.clientY - sy)),
      });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (!moved) setCollapsed(false); // 点击/轻触（未拖动）→ 展开
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, [role='listbox']")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, il = left, it = top;
    const onMove = (mv: PointerEvent) => setPos({ left: Math.max(0, Math.min(window.innerWidth - 120, il + mv.clientX - sx)), top: Math.max(0, Math.min(window.innerHeight - 40, it + mv.clientY - sy)) });
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, iw = size.w, ih = size.h;
    const onMove = (mv: PointerEvent) => setSize({ w: Math.max(300, Math.min(window.innerWidth - 16, iw + mv.clientX - sx)), h: Math.max(360, Math.min(window.innerHeight - 16, ih + mv.clientY - sy)) });
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  };

  useEffect(() => { try { localStorage.setItem(`avc:canvasAgent:${projectId}`, JSON.stringify(turns.slice(-40))); } catch { /* quota */ } }, [turns, projectId]);
  // 挂载时以 DB 为跨设备真相 hydrate（只做一次）。关键：**若用户在 DB 返回前已操作**（turns 变了），
  // 绝不覆盖进行中的对话——否则慢加载抢发、或 5 分钟内关-开面板命中陈旧缓存，都会把新消息覆盖丢失。
  useEffect(() => {
    if (hydratedRef.current || !historyQuery.data) return;
    hydratedRef.current = true;
    const dbTurns = (historyQuery.data.turns as Turn[]) ?? [];
    const localChanged = JSON.stringify(turns) !== mountTurnsRef.current;
    if (localChanged) { if (turns.length) persistTurns(turns); return; } // 保护进行中的对话，改存本地
    if (dbTurns.length) setTurns(dbTurns);        // 本地自挂载未动 → DB 为跨设备真相
    else if (turns.length) persistTurns(turns);   // DB 空但本地有 → 迁移进库
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuery.data]);
  // hydrate 之后：对话变更防抖 800ms 回写（写库 + 同步缓存，含撤销所需的 createdIds/undone）。
  useEffect(() => {
    if (!hydratedRef.current) return;
    const id = setTimeout(() => persistTurns(turns), 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, projectId]);
  // 卸载兜底：① 中止进行中的轮询（否则关面板后循环还会跑最多 20 分钟）；② flush 一次持久化——
  // 防抖 800ms 内关面板会把刚收到的最后一轮吞掉（重开时旧库快照覆盖本地，回复凭空消失）。
  const turnsRef = useRef(turns); turnsRef.current = turns;
  const persistRef = useRef(persistTurns); persistRef.current = persistTurns;
  useEffect(() => () => {
    abortRef.current?.abort();
    if (hydratedRef.current && turnsRef.current.length) persistRef.current(turnsRef.current);
  }, []);
  // 协作者更新了共享对话（Canvas.tsx 把 socket 事件转发为 window 事件）：从服务器权威重载，
  // 不单押 socket 载荷。本端正在生成/保存时跳过（结束后本端保存会再广播、届时对方重载）；
  // 内容相同（多半是自己保存的回声）时原样返回 cur，避免 setTurns→回写→再广播 的循环。
  useEffect(() => {
    const onRemote = () => {
      if (busy || saveHistoryMut.isPending || !hydratedRef.current) return;
      void historyQuery.refetch().then((r) => {
        const dbTurns = (r.data?.turns as Turn[]) ?? [];
        setTurns((cur) => (JSON.stringify(cur) === JSON.stringify(dbTurns) ? cur : dbTurns));
      });
    };
    window.addEventListener("avc:agent-history-updated", onRemote);
    return () => window.removeEventListener("avc:agent-history-updated", onRemote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, saveHistoryMut.isPending, projectId]);
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:model", model); } catch { /* quota */ } }, [model]);
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:template", template); } catch { /* quota */ } }, [template]);
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:prefs", JSON.stringify(quickPrefs)); } catch { /* quota */ } }, [quickPrefs]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [turns, busy]);

  // ── @角色/素材/上传 / 技能 触发面板（输入末尾 @片段 或 /片段 时浮出可选列表）──
  type PickItem = { name: string; sub?: string; kind: "char" | "skill" | "asset" | "upload"; url?: string };
  const [pickHi, setPickHi] = useState(0);
  const [pickDismiss, setPickDismiss] = useState("");
  const trig = /(^|\s)([@/])([^\s@/]*)$/.exec(input);
  const pickMode: "@" | "/" | null = trig ? (trig[2] as "@" | "/") : null;
  const pickFrag = (trig?.[3] ?? "").toLowerCase();
  // 素材库图片（项目 + 个人两路合并去重）：@ 可直接挑一张作参考附件——LLM 看图规划。
  const projAssetsQuery = trpc.assets.list.useQuery({ projectId }, { staleTime: 30_000 });
  const myAssetsQuery = trpc.assets.list.useQuery({}, { staleTime: 30_000 });
  const imageAssets = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; url: string; mimeType?: string }[] = [];
    for (const r of [...(projAssetsQuery.data ?? []), ...(myAssetsQuery.data ?? [])]) {
      if (r.type !== "image" || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ name: r.name, url: r.url, mimeType: r.mimeType ?? undefined });
    }
    return out;
  }, [projAssetsQuery.data, myAssetsQuery.data]);
  const pickItems = useMemo<PickItem[]>(() => {
    if (pickMode === "@") {
      const chars: PickItem[] = (charsQuery.data ?? [])
        .filter((c) => !pickFrag || (c.name ?? "").toLowerCase().includes(pickFrag))
        .slice(0, 5).map((c) => ({ name: c.name, sub: c.characterKind === "scene" ? "场景" : "人物", kind: "char" as const }));
      const assets: PickItem[] = imageAssets
        .filter((a) => !pickFrag || a.name.toLowerCase().includes(pickFrag))
        .slice(0, 4).map((a) => ({ name: a.name, sub: "素材库 · 作为参考图附件", kind: "asset" as const, url: a.url }));
      // 「上传」常驻最后：直接选本地图/文档作参考附件（免先进素材库）。
      return [...chars, ...assets, { name: "上传图片 / 文档…", sub: "本地文件作为参考附件", kind: "upload" as const }];
    }
    if (pickMode === "/" && isClaudeLocal && bridgeSkills.enabled) {
      return bridgeSkills.skills
        .filter((s) => !pickFrag || s.name.toLowerCase().includes(pickFrag) || s.description.toLowerCase().includes(pickFrag))
        .slice(0, 8).map((s) => ({ name: s.name, sub: s.description, kind: "skill" as const }));
    }
    return [];
  }, [pickMode, pickFrag, charsQuery.data, isClaudeLocal, bridgeSkills.enabled, bridgeSkills.skills, imageAssets]);
  const showPicker = pickMode != null && input !== pickDismiss && pickItems.length > 0;
  useEffect(() => { setPickHi(0); }, [pickFrag, pickMode]);
  /** 砍掉输入末尾的「触发符+片段」（@xx / /xx）。 */
  const cutTrig = () => { if (trig) setInput(input.slice(0, input.length - (1 + (trig[3] ?? "").length))); setPickDismiss(""); };
  const applyPick = (it: PickItem) => {
    if (!trig) return;
    if (it.kind === "upload") { cutTrig(); fileInputRef.current?.click(); return; }
    if (it.kind === "asset" && it.url) {
      // 素材 → 拉成 File 进现有附件管线（chip 展示、大小护栏、发送时转 data URI 喂 LLM）。
      cutTrig();
      void (async () => {
        try {
          const resp = await fetch(it.url!);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          addFiles([new File([blob], it.name, { type: blob.type || "image/png" })]);
        } catch (e) {
          toast.error("拉取素材失败：" + (e instanceof Error ? e.message : String(e)));
        }
      })();
      return;
    }
    const cut = input.length - (1 + (trig[3] ?? "").length);
    const insertion = pickMode === "@" ? `@${it.name}` : `用 ${it.name} 技能：`;
    setInput(input.slice(0, cut) + insertion + " ");
    setPickDismiss("");
  };

  // 只统计真正应用成功的操作（status==="applied"）——被节点白名单/连线规则拦下的不能算
  // 「已应用」，否则「已应用：新建 3」与「1 项未应用」并排出现自相矛盾。
  const opsSummary = (ops: AgentOperation[]): string => {
    const ok = ops.filter((o) => o.status === "applied");
    const c = ok.filter((o) => o.op === "create").length, l = ok.filter((o) => o.op === "connect").length;
    const u = ok.filter((o) => o.op === "update").length, d = ok.filter((o) => o.op === "delete").length;
    return [c && `新建 ${c}`, l && `连线 ${l}`, u && `改 ${u}`, d && `删 ${d}`].filter(Boolean).join(" · ");
  };

  // 撤销 = 只删除本轮 AI【新建】的节点（createdIds），绝不删被 update/connect 的用户既有
  // 节点（否则会误删用户原有内容）。删新建节点会连带清掉本轮新建的边。被 update 的既有
  // 节点内容如需回退，用全局 Ctrl+Z（整批 applyAgentOperations 是单步撤销）。
  const undoTurn = (idx: number) => {
    const t = turns[idx];
    if (!t?.createdIds?.length) return;
    const st = useCanvasStore.getState();
    const live = new Set(st.nodes.map((n) => n.id));
    t.createdIds.filter((id) => live.has(id)).forEach((id) => st.deleteNode(id));
    setTurns((p) => p.map((x, i) => (i === idx ? { ...x, undone: true } : x)));
  };

  async function send() {
    const files = staged;
    const msg = input.trim() || (files.length ? "请参考附件规划画布。" : "");
    if (!msg || busy) return;
    setInput(""); setStaged([]); setAttachErr("");
    // 每条截到 8000（服务端 history zod 上限）——否则发过超长消息后，下一条会整包被 400 拒掉。
    const history = turns.slice(-10).map((t) => ({ role: t.role, content: t.content.slice(0, 8000) }));
    const attachLabel = files.length ? `　📎 ${files.map((f) => f.name).join("、")}` : "";
    setTurns((p) => [...p, { role: "user", content: msg + attachLabel }]);
    // 软取消：本机 Claude/GPT 大计划可能等 1~10 分钟——「取消」按钮立刻拿回控制
    // （后台任务仍会跑完，结果被丢弃）。
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const attachments = files.length
        ? await Promise.all(files.map(async (f) => ({ url: await fileToDataUri(f), mimeType: f.type || "application/octet-stream", name: f.name })))
        : undefined;
      const focus = selectedNodeIds.filter(Boolean);
      const summary = buildGraphSummary("", focus.length ? { focusNodeIds: focus } : {});
      const persona = template === BLANK_TEMPLATE_ID ? undefined : ALL_AI_TEMPLATES.find((t) => t.id === template)?.prompt;
      // 提交后台任务 → 轮询取结果（runAgentChatJob：短请求轮询，断连/掐线/重启不丢等待）。
      const r = await runAgentChatJob(utils.client, { projectId, message: msg, history, graphSummary: summary || undefined, model, persona, includeCharacterLibrary: true, attachments, prefs: buildQuickPrefsText(), imageFirst: quickPrefs.imageFirst || undefined }, controller.signal);
      const ops = (r.operations ?? []) as AgentOperation[];
      // 服务端 sanitize 丢弃的操作（幻觉节点/非法字段/重复等）——此前画布助手完全不展示，
      // 用户只见「operations 静默变少」。合并进「未应用」提示，与客户端 apply 失败一并可见。
      const droppedMsg = (r.droppedCount ?? 0) > 0 ? `服务端忽略 ${r.droppedCount} 项：${(r.dropped ?? []).slice(0, 3).join("；")}` : "";
      let applied = "", applyFailMsg = "", createdIds: string[] = [];
      if (ops.length) {
        const anchor = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 120, y: window.innerHeight / 2 - 120 });
        const templates = (templatesQuery.data ?? []).map((t) => ({ id: t.id, label: t.label, payload: t.payload }));
        const res = applyAgentOperations(ops, anchor, {
          templates, ownerAgentId: "canvas-agent-chat", aspect: quickPrefs.aspect || undefined,
          imageModel: quickPrefs.imageModel || undefined, videoProvider: quickPrefs.videoProvider || undefined,
          allowedGenNodes: quickPrefs.genNodes.length ? quickPrefs.genNodes : undefined,
          allowedTemplateIds: quickPrefs.workflowTemplateIds.length ? quickPrefs.workflowTemplateIds : undefined,
        });
        applied = opsSummary(ops); createdIds = res.createdIds ?? [];
        if (res.failures.length) applyFailMsg = `${res.failures.length} 项未应用：${res.failures.map((f) => f.reason).slice(0, 3).join("；")}`;
      }
      const failed = [droppedMsg, applyFailMsg].filter(Boolean).join(" · ") || undefined;
      setTurns((p) => [...p, { role: "assistant", content: r.reply || (applied ? "已按你的要求改好画布。" : "（无改动）"), applied: applied || undefined, failed, createdIds: createdIds.length ? createdIds : undefined }]);
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        setTurns((p) => [...p, { role: "assistant", content: "已取消本次规划（后台任务可能仍会完成，结果已忽略）。", error: true }]);
        return;
      }
      setTurns((p) => [...p, { role: "assistant", content: friendlyClientLLMError(e), error: true }]);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  // 取消进行中的规划：中止轮询等待（后台任务仍会跑完，结果被丢弃）。
  const cancelSend = () => { abortRef.current?.abort(); };

  const templateGroups = [
    { options: [{ value: BLANK_TEMPLATE_ID, label: BLANK_TEMPLATE_LABEL, title: "不设任何人设/风格" }] },
    ...AI_TEMPLATE_CATEGORIES.map((cat) => ({ label: cat.label, options: cat.templates.map((t) => ({ value: t.id, label: t.label, title: t.blurb })) })),
  ];
  const focusCount = selectedNodeIds.filter(Boolean).length;

  const panel = (
    <div ref={panelRef} className="nodrag nowheel" style={{
      position: "fixed", left, top, width: effW, height: size.h,
      display: "flex", flexDirection: "column", background: "var(--c-base)", border: `1px solid ${accent}`, borderRadius: 14,
      boxShadow: "0 18px 50px rgba(0,0,0,0.45)", zIndex: 50, overflow: "hidden",
    }} onClick={(e) => e.stopPropagation()}>
      {/* header（拖动手柄） */}
      <div onPointerDown={startDrag} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--c-bd2)", flexShrink: 0, cursor: "move", touchAction: "none" }}>
        <Sparkles className="w-4 h-4" style={{ color: accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)" }}>画布助手</span>
        <div style={{ flex: 1 }} />
        <div style={{ maxWidth: 150 }}><LLMModelPicker value={model} onChange={setModel} disabled={busy} /></div>
        <button
          onClick={() => {
            if (!turns.length) { toast.info("当前已是新对话（暂无历史可清空）"); return; }
            if (!window.confirm("清空当前画布助手对话，开始新对话？")) return;
            setTurns([]); persistTurns([]);
            toast.success("已开始新对话");
          }}
          title="新对话（清空当前画布助手对话，开启一段全新对话）" disabled={busy}
          style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: busy ? "default" : "pointer" }}
        ><Plus size={14} /></button>
        <button onClick={() => setCollapsed(true)} title="收起为悬浮球（右键小球可关闭）" style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" }}><X size={14} /></button>
      </div>

      {/* 工具行：模板 + 聚焦/技能提示 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px 0", flexWrap: "wrap", fontSize: 11, color: "var(--c-t3)" }}>
        <BookOpen size={13} style={{ color: accent }} /><span>模板</span>
        <MiniSelect value={template} placeholder="空模板" maxWidth={180} accent={accent} accentSoft={accentSoft}
          title="给规划设定风格/人设；空模板=无人设" groups={templateGroups} onChange={setTemplate} />
        <button onClick={() => setShowQuick((v) => !v)} title="快速设置：画面比例 / 风格 / 时长 / 生图先行 / 配乐字幕——注入助手规划"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, fontSize: 11, cursor: "pointer",
            border: `1px solid ${showQuick || qpActiveCount ? accent : "var(--c-bd2)"}`, background: showQuick || qpActiveCount ? accentSoft : "var(--c-surface)", color: showQuick || qpActiveCount ? accent : "var(--c-t3)" }}>
          <SlidersHorizontal size={11} /> 快速设置{qpActiveCount > 0 ? ` · ${qpActiveCount}` : ""}
        </button>
        {focusCount > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: accent }}><Focus size={11} /> 已聚焦 {focusCount} 个选中节点</span>}
        {isClaudeLocal && bridgeSkills.enabled && bridgeSkills.skills.length > 0 && <span style={{ color: "var(--c-t4)" }}>· 输入 <strong style={{ color: accent }}>/</strong> 选技能</span>}
        {(charsQuery.data?.length ?? 0) > 0 && <span style={{ color: "var(--c-t4)" }}>· <strong style={{ color: accent }}>@</strong> 引用角色</span>}
      </div>

      {/* 快速设置面板：偏好注入助手规划（agent.chat 的 prefs 约束 + 落地 aspect），持久化 */}
      {showQuick && (() => {
        const chip = (on: boolean): React.CSSProperties => ({ padding: "3px 9px", fontSize: 11, borderRadius: 7, cursor: "pointer",
          border: `1px solid ${on ? accent : "var(--c-bd2)"}`, background: on ? accentSoft : "var(--c-surface)", color: on ? accent : "var(--c-t3)" });
        return (
          <div className="nowheel" style={{ padding: "8px 12px 10px", borderBottom: "1px solid var(--c-bd2)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)" }}>比例</span>
              {QP_ASPECTS.map((a) => <button key={a || "auto"} onClick={() => setQP({ aspect: a })} style={chip(quickPrefs.aspect === a)}>{a || "默认"}</button>)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }}>风格</span>
              <input list="qp-styles" value={quickPrefs.style} onChange={(e) => setQP({ style: e.target.value })} placeholder="如：电影感 / 赛博朋克（可选）"
                style={{ flex: 1, minWidth: 0, padding: "5px 9px", fontSize: 11.5, borderRadius: 8, background: "var(--c-input, var(--c-surface))", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
              <datalist id="qp-styles">{QP_STYLES.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)" }}>时长</span>
              {QP_DURATIONS.map((d) => <button key={d.v} onClick={() => setQP({ durationSec: d.v })} style={chip(quickPrefs.durationSec === d.v)}>{d.label}</button>)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }}>模型</span>
              <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>图</span>
              <MiniSelect value={quickPrefs.imageModel} placeholder="默认" maxWidth={128} accent={accent} accentSoft={accentSoft}
                title="指定图像生成模型（写入 image_gen/分镜关键帧；默认=助手自选）" groups={QP_IMAGE_MODEL_GROUPS} onChange={(v) => setQP({ imageModel: v })} />
              <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>视</span>
              <MiniSelect value={quickPrefs.videoProvider} placeholder="默认" maxWidth={128} accent={accent} accentSoft={accentSoft}
                title="指定视频生成模型（写入 video_task.provider；默认=助手自选）" groups={QP_VIDEO_MODEL_GROUPS} onChange={(v) => setQP({ videoProvider: v })} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)" }} title="勾选=只允许助手用这些生成节点；全不勾=不限">节点</span>
              {QP_GEN_NODES.map((n) => {
                const on = quickPrefs.genNodes.includes(n.v);
                return (
                  <button key={n.v} onClick={() => setQP({ genNodes: on ? quickPrefs.genNodes.filter((x) => x !== n.v) : [...quickPrefs.genNodes, n.v] })}
                    title={`${n.v}（勾选=只允许所选类型；全不勾=不限）`} style={chip(on)}>{n.label}</button>
                );
              })}
            </div>
            {/* ComfyUI模板 的二级选择：勾选具体允许的工作流模板（全不勾=不限；已选则强制只用所选） */}
            {(quickPrefs.genNodes.includes("comfyui_workflow") || quickPrefs.workflowTemplateIds.length > 0) && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flexWrap: "wrap" }}>
                <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)", flexShrink: 0, paddingTop: 4 }} title="勾选=只允许引用这些工作流模板；全不勾=不限">模板</span>
                {workflowTemplates.length === 0 ? (
                  <span style={{ fontSize: 11, color: "var(--c-t4)", paddingTop: 4 }}>模板库暂无工作流模板（先在模板库添加/分析）</span>
                ) : (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: 1, maxHeight: 88, overflowY: "auto" }} className="nowheel">
                    {workflowTemplates.map((t) => {
                      const on = quickPrefs.workflowTemplateIds.includes(t.id);
                      return (
                        <button key={t.id} title={`id=${t.id}${t.note ? ` · ${t.note}` : ""}`}
                          onClick={() => setQP({ workflowTemplateIds: on ? quickPrefs.workflowTemplateIds.filter((x) => x !== t.id) : [...quickPrefs.workflowTemplateIds, t.id] })}
                          style={{ ...chip(on), maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5 }}>
              {([["imageFirst", "生图 → 再生视频"], ["addMusic", "自动配乐"], ["addSubtitle", "自动字幕"]] as const).map(([k, label]) => (
                <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", color: "var(--c-t2)" }}>
                  <input type="checkbox" checked={!!quickPrefs[k]} onChange={(e) => setQP({ [k]: e.target.checked })} style={{ accentColor: accent }} /> {label}
                </label>
              ))}
            </div>
          </div>
        );
      })()}

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
                {t.createdIds?.length && !t.undone && (
                  <button onClick={() => undoTurn(i)} title={`移除本次 AI 新建的 ${t.createdIds.length} 个节点（被修改的既有节点不受影响，可再 Ctrl+Z 整体回退）`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "var(--c-t3)", background: "none", border: "1px solid var(--c-bd2)", borderRadius: 6, padding: "1px 6px", cursor: "pointer" }}>
                    <CornerUpLeft size={10} /> 撤销新建
                  </button>
                )}
                {t.undone && <span style={{ color: "var(--c-t4)" }}>· 已撤销新建</span>}
              </div>
            )}
            {t.failed && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "oklch(0.72 0.16 60)", paddingLeft: 2 }}>
                <AlertTriangle size={10} /> {t.failed}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: accent }}>
            <Loader2 size={13} className="animate-spin" /> 正在规划并修改画布…
            <span style={{ color: "var(--c-t4)", fontSize: 11 }}>（本机模型大计划可能较久）</span>
            <button onClick={cancelSend} title="取消本次规划"
              style={{ marginLeft: "auto", fontSize: 11, color: "var(--c-t3)", background: "none", border: "1px solid var(--c-bd2)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
              取消
            </button>
          </div>
        )}
      </div>

      {/* @角色 / 技能 选择面板 */}
      {showPicker && (
        <div style={{ position: "relative", padding: "0 10px", flexShrink: 0 }}>
          <div className="nowheel" style={{ position: "absolute", bottom: 4, left: 10, right: 10, maxHeight: 260,
            display: "flex", flexDirection: "column", overflow: "hidden",
            background: "var(--c-elevated, #1b1b1f)", border: "1px solid var(--c-bd3)", borderRadius: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.45)", zIndex: 40, padding: 5 }}>
            <div style={{ fontSize: 10.5, color: "var(--c-t4)", padding: "3px 8px 5px", flexShrink: 0 }}>{pickMode === "@" ? "角色 / 素材（输入即搜索）/ 上传" : "技能"} · ↑↓ 选择 · Enter 确认 · Esc 关闭</div>
            <div className="nowheel" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {pickItems.filter((it) => it.kind !== "upload").map((it, i) => (
              <button key={it.kind + it.name + (it.url ?? "")} type="button" onMouseEnter={() => setPickHi(i)} onClick={() => applyPick(it)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                  background: i === pickHi ? accentSoft : "transparent", color: "var(--c-t1)",
                  ...(it.kind === "upload" ? { borderTop: "1px solid var(--c-bd2)", borderRadius: 0, marginTop: 2 } : {}) }}>
                {it.kind === "asset" && it.url && (
                  <img src={it.url} alt="" loading="lazy" style={{ width: 26, height: 26, objectFit: "cover", borderRadius: 5, border: "1px solid var(--c-bd2)", flexShrink: 0 }} />
                )}
                {it.kind === "upload" && <Paperclip size={14} style={{ color: accent, flexShrink: 0 }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: i === pickHi ? accent : "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.kind === "char" ? "@" + it.name : it.kind === "skill" ? "/" + it.name : it.name}
                  </div>
                  {it.sub && <div style={{ fontSize: 11, color: "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub}</div>}
                </div>
              </button>
            ))}
            </div>
            {/* 「上传」入口固定底部（不随候选滚动，始终可见） */}
            {(() => {
              const upIdx = pickItems.findIndex((x) => x.kind === "upload");
              if (upIdx < 0) return null;
              const it = pickItems[upIdx];
              return (
                <button type="button" onMouseEnter={() => setPickHi(upIdx)} onClick={() => applyPick(it)}
                  style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 9px", border: "none", borderTop: "1px solid var(--c-bd2)", marginTop: 2, cursor: "pointer",
                    background: upIdx === pickHi ? accentSoft : "transparent" }}>
                  <Paperclip size={14} style={{ color: accent, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: upIdx === pickHi ? accent : "var(--c-t1)" }}>{it.name}</div>
                    {it.sub && <div style={{ fontSize: 11, color: "var(--c-t3)" }}>{it.sub}</div>}
                  </div>
                </button>
              );
            })()}
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
        <button onClick={() => fileInputRef.current?.click()} disabled={busy} title="附参考图 / 文档（据图规划画面·风格·角色）"
          style={{ display: "inline-flex", width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: staged.length ? accent : "var(--c-t3)", cursor: busy ? "not-allowed" : "pointer", flexShrink: 0 }}>
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
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applyPick(pickItems[pickHi]); return; }
              if (e.key === "Escape") { e.preventDefault(); setPickDismiss(input); return; }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }}
          placeholder="指挥画布，Enter 发送；@ 角色、/ 技能、📎 附参考图" rows={1}
          style={{ flex: 1, resize: "none", maxHeight: 120, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t1)", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
        <button onClick={() => void send()} disabled={busy || (!input.trim() && staged.length === 0)} title="发送"
          style={{ display: "inline-flex", width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, border: `1px solid ${accent}`, background: accentSoft, color: accent, cursor: busy || (!input.trim() && !staged.length) ? "not-allowed" : "pointer", opacity: busy || (!input.trim() && !staged.length) ? 0.5 : 1, flexShrink: 0 }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>

      {/* 右下角缩放把手 */}
      <div onPointerDown={startResize} title="拖动缩放" style={{ touchAction: "none",
        position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 2,
        background: "linear-gradient(135deg, transparent 50%, var(--c-bd3) 50%, var(--c-bd3) 60%, transparent 60%, transparent 72%, var(--c-bd3) 72%, var(--c-bd3) 82%, transparent 82%)",
      }} />
    </div>
  );

  // ── 收起态：炫酷动态悬浮小球（可拖拽；点击展开；右键弹菜单可关闭）──
  const ball = (
    <>
      <style>{`
        @keyframes avc-ball-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        @keyframes avc-ball-glow { 0%,100% { box-shadow: 0 6px 22px oklch(0.70 0.20 310 / 0.5), 0 0 0 1px oklch(0.70 0.20 310 / 0.4); } 50% { box-shadow: 0 10px 32px oklch(0.70 0.20 310 / 0.75), 0 0 0 1px oklch(0.70 0.20 310 / 0.55); } }
        @keyframes avc-ball-ring { 0% { opacity: 0.7; transform: scale(1); } 70% { opacity: 0; transform: scale(1.5); } 100% { opacity: 0; transform: scale(1.5); } }
        @keyframes avc-ball-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div
        role="button"
        title="画布助手（点击展开 · 拖动移位 · 右键关闭）"
        onPointerDown={startBallDrag}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setBallMenu({ x: e.clientX, y: e.clientY }); }}
        style={{
          position: "fixed", left: ballLeft, top: ballTop, width: BALL, height: BALL, zIndex: 50,
          borderRadius: "50%", cursor: "grab", userSelect: "none", touchAction: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 32% 28%, oklch(0.80 0.16 310), oklch(0.62 0.22 300) 55%, oklch(0.52 0.20 285))",
          animation: "avc-ball-float 3.2s ease-in-out infinite, avc-ball-glow 2.6s ease-in-out infinite",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.08)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
      >
        {/* 旋转光泽环 */}
        <div style={{
          position: "absolute", inset: 3, borderRadius: "50%", pointerEvents: "none",
          background: "conic-gradient(from 0deg, transparent, oklch(0.95 0.05 310 / 0.55), transparent 40%)",
          animation: "avc-ball-spin 4s linear infinite", opacity: 0.7,
        }} />
        {/* 忙碌/常态脉冲环 */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none",
          border: "2px solid oklch(0.80 0.16 310)",
          animation: `avc-ball-ring ${busy ? "1.1s" : "2.2s"} ease-out infinite`,
        }} />
        {busy
          ? <Loader2 size={17} className="animate-spin" style={{ color: "white", position: "relative", zIndex: 1 }} />
          : <Sparkles size={18} style={{ color: "white", position: "relative", zIndex: 1, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }} />}
      </div>
      {ballMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            left: Math.min(ballMenu.x, window.innerWidth - 160),
            top: Math.min(ballMenu.y, window.innerHeight - 88),
            zIndex: 51, minWidth: 148, padding: 5,
            background: "var(--c-elevated, #1b1b1f)", border: "1px solid var(--c-bd3)", borderRadius: 10,
            boxShadow: "0 12px 34px rgba(0,0,0,0.45)",
          }}
        >
          <button
            onClick={() => { setBallMenu(null); setCollapsed(false); }}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 9px", borderRadius: 7, border: "none", background: "transparent", color: "var(--c-t1)", cursor: "pointer", fontSize: 12.5 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = accentSoft; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Sparkles size={14} style={{ color: accent }} /> 展开助手
          </button>
          <button
            onClick={() => { setBallMenu(null); setCollapsed(false); onClose(); }}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 9px", borderRadius: 7, border: "none", background: "transparent", color: "oklch(0.72 0.18 25)", cursor: "pointer", fontSize: 12.5 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.65 0.22 25 / 0.14)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <X size={14} /> 关闭助手
          </button>
        </div>
      )}
    </>
  );

  return createPortal(collapsed ? ball : panel, document.body);
}
