import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { createPortal } from "react-dom";
import { Sparkles, Send, Loader2, X, Plus, Link2, Pencil, AlertTriangle, CornerUpLeft, BookOpen, Focus, Paperclip, Image as ImageIcon, FileText, SlidersHorizontal, Mic } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { buildGraphSummary, applyAgentOperations, ensureAliasNums, buildNodeDetailText } from "@/lib/agentApply";
// #260 附件即可引用：{{refN}} 占位符 → 附件真实地址的确定性替换 + library 入库操作抽取。
import { resolveAttachmentRefs } from "@/lib/attachmentRefs";
import { runAnimaticFromCanvas, type AnimaticEditorClient } from "@/lib/animaticRun";
import { runDubbingFromCanvas, type DubbingClient } from "@/lib/dubbingRun";
import { runAgentChatJob, pollAgentChatJob, type AgentChatResult } from "@/lib/agentChatJob";
import { friendlyClientLLMError } from "@/lib/friendlyClientError";
import { resolveActiveNodeModel } from "../../contexts/NodeDefaultModelsContext";
import { useCanvasMode } from "../../contexts/CanvasModeContext";
import { LLMModelPicker, type LLMModelId } from "./LLMModelPicker";
import { MiniSelect } from "@/components/ui/MiniSelect";
import { useBridgeSkills } from "@/lib/useBridgeSkills";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { AI_TEMPLATE_CATEGORIES, ALL_AI_TEMPLATES, BLANK_TEMPLATE_ID, BLANK_TEMPLATE_LABEL } from "@/lib/aiAssistantTemplates";
import { IMAGE_MODELS, VIDEO_MODELS, LLM_MODELS } from "@/lib/models";
import { maxRefImagesForProvider, videoRefCapBadge } from "../../../../shared/videoRefCaps";
import { videoDurationCap } from "../../../../shared/videoModelParams";
import { extractFrameMedia } from "../../lib/nodeMedia";
import { consumeAgentPrefill, AGENT_PREFILL_EVENT } from "@/lib/agentPrefill";
// #305 语音口令：统一语音输入 hook（Web Speech 主路径 + 服务端 whisper 兜底），与 AI 客户端/聊天室同源。
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type { AgentOperation, CharacterNodeData } from "../../../../shared/types";
import { buildCharacterImagePrompt, characterImageAspect } from "@/lib/characterPortrait";
import { buildLibrarySaveInput } from "@/lib/characterLibrarySave";
import { countDiffFromDefaults } from "@/lib/quickPrefsCount";
import { formatStreamPreview } from "@/lib/streamPreviewFormat";

/** 浮动「画布助手」：对话式让 AI（如本机 Claude）边聊边直接改画布。复用智能体节点同一套引擎
 *  （agent.chat 规划 + buildGraphSummary 看实时画布 + applyAgentOperations 落地）。
 *  已对齐聊天助手：模板人设、@角色 引用、/ 调技能（本机 Claude 桥接，MCP 亦自动可用）、撤销本次改动。
 *  结构性操作自动落地且不花钱；「运行/生成」仍需在节点上点运行（防误烧额度）。 */
type Turn = { role: "user" | "assistant"; content: string; applied?: string; failed?: string; error?: boolean; createdIds?: string[]; undone?: boolean };

const accent = "oklch(0.70 0.20 310)";
const accentSoft = "oklch(0.70 0.20 310 / 0.14)";

// 「快速设置」——把创作偏好注入助手规划（agent.chat 的 prefs 约束块 + 落地时的 aspect/模型/节点白名单）。
// genNodes：允许智能体使用的生成节点类型（空=不限）；imageModel/videoProvider：指定生成模型（空=助手自选/节点默认）。
type QuickPrefs = { aspect: string; style: string; durationSec: number; imageFirst: boolean; addMusic: boolean; addSubtitle: boolean; imageModel: string; videoProvider: string; genNodes: string[]; workflowTemplateIds: number[]; noStoryboard: boolean; dialogueLang: string; promptLang: string; useComfyMemory: boolean; coalesceShots: boolean; fastChat: boolean; autoQc: boolean; useModelSkills: boolean; interactive: boolean; autoPortrait: boolean; anchorCompress: boolean; transitionStyle: string; leanPrompt: boolean; selfCheck: boolean; summaryMode: string; streamEcho: boolean };
// 画布助手快速设置的出厂默认（用户改动后写入 localStorage 覆盖；此默认即「清缓存/新会话」的起点）。
const QP_DEFAULT: QuickPrefs = { aspect: "16:9", style: "电影感", durationSec: 0, imageFirst: false, addMusic: false, addSubtitle: false, imageModel: "kie_gpt_image_2", videoProvider: "kie_grok_i2v", genNodes: [], workflowTemplateIds: [], noStoryboard: true, dialogueLang: "中文", promptLang: "", useComfyMemory: false, coalesceShots: false, fastChat: false, autoQc: false, useModelSkills: false, interactive: false, // #259 selfCheck 默认开：#258 真模型 A/B 实证质量提升（自查后主动补齐角色一致性管线），
// 且注入方式是「# 输出要求 末尾纯追加一条规则」——与 #145 对白语种硬规则同风险级（已有
// 生产先例）。老用户存档里无 selfCheck 键 → 展开 QP_DEFAULT 时吃到新默认 true；随时可关。
// leanPrompt 保持默认关（省 token 属锦上添花，等「规划质量」面板数据佐证后再评估转默认）。
autoPortrait: false, anchorCompress: true, transitionStyle: "", leanPrompt: false, selfCheck: true, summaryMode: "compressed",
// #306 流式回显（默认关）：仅本机桥接模型（claude-local*）生效——生成中的文字实时回显在等待
// 行下方；云端模型/关闭时自动走原有非流式（服务端三重门控，零回归）。旧账号预设快照没有此
// 键 → 展开合并回落 false，行为与升级前一致。
streamEcho: false };

/** 对白语种（#138）：对白/旁白/台词统一书写语言；空 = 跟随内容默认。 */
const QP_DIALOGUE_LANGS = [
  { value: "中文", label: "中文" },
  { value: "英语", label: "英语 English" },
  { value: "日语", label: "日语 日本語" },
  { value: "韩语", label: "韩语 한국어" },
  { value: "粤语", label: "粤语" },
  { value: "西班牙语", label: "西班牙语 Español" },
  { value: "法语", label: "法语 Français" },
  { value: "德语", label: "德语 Deutsch" },
  { value: "俄语", label: "俄语 Русский" },
];
const QP_GEN_NODES: { v: string; label: string }[] = [
  { v: "image_gen", label: "云端图像" }, { v: "video_task", label: "云端视频" },
  { v: "comfyui_image", label: "ComfyUI图像" }, { v: "comfyui_video", label: "ComfyUI视频" }, { v: "comfyui_workflow", label: "ComfyUI模板" },
];
const QP_ASPECTS = ["", "16:9", "9:16", "1:1", "4:3"];
// 指定模型下拉的分组选项（与节点选择器同源清单；MiniSelect 自绘下拉，缩放窗口内可点）。
// note=计价（下拉项内常显，让用户选前就看到花费）；title=悬停 tooltip（补充描述/计价全文）。
const groupModelOptions = <T extends { group: string; value: string; label: string }>(
  ms: readonly T[], title: (m: T) => string | undefined, note: (m: T) => string | undefined,
) => {
  const order: string[] = []; const by = new Map<string, T[]>();
  for (const m of ms) { if (!by.has(m.group)) { by.set(m.group, []); order.push(m.group); } by.get(m.group)!.push(m); }
  return order.map((g) => ({ label: g, options: by.get(g)!.map((m) => ({ value: m.value, label: m.label, title: title(m), note: note(m) })) }));
};
// 图像模型计价：优先 costNote（如「18-35 cr/张」），否则用数字 cost（Poyo 积分/张）。
const imgCostText = (m: (typeof IMAGE_MODELS)[number]) => m.costNote ?? (typeof m.cost === "number" ? `${m.cost} cr/张` : undefined);
const QP_IMAGE_MODEL_GROUPS = [
  { options: [{ value: "", label: "默认（助手自选）", note: "按各节点默认模型计价" }] },
  ...groupModelOptions(IMAGE_MODELS, (m) => [m.desc, imgCostText(m)].filter(Boolean).join(" · "), imgCostText),
];
// #246 视频模型下拉透明标注吃图能力（videoRefCaps 单一事实源）：纯文生模型的首帧/
// 角色参考/链式尾帧全不生效，行内直接标出，让用户选择时就能权衡。
const QP_VIDEO_MODEL_GROUPS = [
  { options: [{ value: "", label: "默认（助手自选）", note: "按各节点默认模型计价" }] },
  ...groupModelOptions(
    VIDEO_MODELS.filter((m) => m.value !== "mock"),
    (m) => [m.costLabel, `参考图：${videoRefCapBadge(m.value)}`].filter(Boolean).join(" · "),
    (m) => [m.costLabel, maxRefImagesForProvider(m.value) === 0 ? "🚫图" : undefined].filter(Boolean).join(" · "),
  ),
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
  // #136 规划进度可见：服务端阶段（分析模板库/模型规划中…）+ 本地每秒计时，替代干等。
  const [planStage, setPlanStage] = useState("");
  // #306 流式回显：轮询捎回的「生成中文本」（仅本机桥接/Poyo 模型 + 开关开时非空）。预览框自动滚到底。
  const [planPartial, setPlanPartial] = useState("");
  const partialRef = useRef<HTMLDivElement>(null);
  // #312 实时排版：规划轮的未闭合 JSON 抽成「💬 回复草稿 + 编号操作清单」；普通文本原样。
  // useMemo + 轮询节奏（1~2.5s 一次）→ 正则开销可忽略，纯展示层不碰数据流。
  const prettyPartial = useMemo(() => formatStreamPreview(planPartial), [planPartial]);
  useEffect(() => { const el = partialRef.current; if (el) el.scrollTop = el.scrollHeight; }, [prettyPartial]);
  const [planSec, setPlanSec] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    setPlanSec(0);
    const t = setInterval(() => setPlanSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);
  // 服务端持久化：跨设备/清缓存后对话仍在（替代原来仅 localStorage）。
  const historyQuery = trpc.agent.getHistory.useQuery({ projectId }, { staleTime: Infinity, refetchOnWindowFocus: false });
  const saveHistoryMut = trpc.agent.saveHistory.useMutation();
  const utils = trpc.useUtils();
  const hydratedRef = useRef(false);
  const templatesQuery = trpc.comfyTemplates.list.useQuery(undefined, { staleTime: 30_000 });
  const charsQuery = trpc.characterLibrary.list.useQuery(undefined, { staleTime: 30_000 });
  // #260 附件即可引用：发送时登记「占位符 → 附件真实地址」映射（仅图片、按序 ref1..，
  // 与服务端 attachRefList 同规则）；applyChatResult 用它做确定性替换。ref 而非 state：
  // 只在 apply 时读、不驱动渲染，且恢复路径（映射为空）有内置容错。
  const attachRefsRef = useRef<Record<string, string>>({});
  // #260 图片附件上传换稳定地址（走既有 upload 通道：生产入自有存储、dev 回退 data URL）。
  const attachUploadMut = trpc.upload.uploadImage.useMutation();
  // #260 语音式入库：「将此图加入角色库，名称为李宁」→ LLM 输出 library 操作 →
  // 此 mutation 落库（与右键「存为角色主体」同一后端接口，同名冲突不覆盖）。
  const libraryCreateMut = trpc.characterLibrary.create.useMutation();
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
  // #305 语音口令：麦克风按钮 → 识别文本【追加】进输入框，由用户确认后 Enter/点发送（安全默认，
  // 不自动直发——画布指令会真实改画布，误识别直发风险高于收益）。Web Speech 实时回填，
  // 无法访问 Google 时自动回退「录音 → voice.transcribe 服务端转写」（与 AI 客户端/聊天室同一 hook）。
  const voice = useVoiceInput({ getText: () => input, setText: setInput });
  const [staged, setStaged] = useState<File[]>([]);
  const [attachErr, setAttachErr] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // 输入框高度（可拖拽调整「对话区/输入框」比例）。0 = 默认自适应（单行起、随内容长到 120）。
  const [composerH, setComposerH] = useState<number>(() => { try { return Number(localStorage.getItem("avc:canvasAgent:composerH")) || 0; } catch { return 0; } });
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:composerH", String(composerH)); } catch { /* restricted */ } }, [composerH]);
  // #92 输入条高度自适应：未手动定高（composerH===0）时随内容自动长高到 120（超出内部滚动）。
  // 此前样式注释写「随内容长到 120」但没有任何增高逻辑，多行草稿只能挤在单行高度里滚动。
  // 用户拖过高度手柄（composerH>0）后完全尊重手动高度，本效果不再介入——用户设置永远第一位。
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el || composerH > 0) return;
    el.style.height = "auto"; // 先归零再量 scrollHeight，否则删行后不回缩
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input, composerH]);
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
    try {
      const s = localStorage.getItem("avc:canvasAgent:prefs");
      if (s) {
        const saved = JSON.parse(s) as Partial<QuickPrefs>;
        // 2026-07 出厂默认调整（不合并短镜 + 生图默认 GPT Image 2）：老缓存里跟着
        // 旧默认存下的值一次性迁移（用标记区分；用户此后的主动选择不再被动）。
        if (!localStorage.getItem("avc:canvasAgent:qpMigV2")) {
          saved.coalesceShots = false;
          if (saved.imageModel === "kie_grok_image") saved.imageModel = "kie_gpt_image_2";
          localStorage.setItem("avc:canvasAgent:qpMigV2", "1");
        }
        // V3（用户实报默认仍不是 GPT Image 2）：V2 只迁了旧值 kie_grok_image，老缓存里存的
        // ""（历史出厂「默认=不锁定」）或中间版默认 kie_gpt_image_15 都原样保留，导致这批
        // 用户的生图模型仍不是 GPT Image 2。一次性把这三类「旧默认痕迹」统一迁到新默认；
        // 用户主动锁定的其它模型不动，迁移后再改回任何值也不再被动。
        if (!localStorage.getItem("avc:canvasAgent:qpMigV3")) {
          if (saved.imageModel === undefined || saved.imageModel === "" || saved.imageModel === "kie_grok_image" || saved.imageModel === "kie_gpt_image_15") {
            saved.imageModel = "kie_gpt_image_2";
          }
          localStorage.setItem("avc:canvasAgent:qpMigV3", "1");
        }
        return { ...QP_DEFAULT, ...saved };
      }
    } catch { /* ignore */ }
    return QP_DEFAULT;
  });
  const [showQuick, setShowQuick] = useState(false);
  // 快捷设置「点外部自动收起」：pointerdown 捕获相位监听整页，命中以下任一则不收——
  // ①面板自身(data-qs-panel)、②「快速设置」切换按钮(data-qs-toggle，否则监听先关、按钮
  // onClick 再取反=永远打不开)、③MiniSelect 的 portal 下拉菜单(data-miniselect-menu，
  // 菜单挂在 body 上、DOM 不在面板内，朴素判定会「点下拉选项=点外部」把面板连着菜单一起
  // 误关——这正是当初没做外部点击关闭的坑)。发送即收(#254)的既有行为保持不变。
  useEffect(() => {
    if (!showQuick) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-qs-panel], [data-qs-toggle], [data-miniselect-menu]")) return;
      setShowQuick(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [showQuick]);
  const setQP = (patch: Partial<QuickPrefs>) => setQuickPrefs((p) => ({ ...p, ...patch }));
  // #242 快捷设置预设：把当前整套快捷设置存成多套命名预设（localStorage），一键调取/重命名/覆盖/删除。
  type QpPreset = { id: string; name: string; prefs: QuickPrefs };
  const [qpPresets, setQpPresets] = useState<QpPreset[]>(() => {
    try { const s = localStorage.getItem("avc:canvasAgent:qpPresets"); if (s) return JSON.parse(s) as QpPreset[]; } catch { /* ignore */ }
    return [];
  });
  // #249 预设/快捷设置/规划模型随账号持久化：服务端（userPrefs KV）为权威、跨设备一致；
  // localStorage 只作本地缓存与「老用户首次迁移」来源。serverSnap 记服务端已知值的 JSON，
  // 防「载入 setState → 保存 effect 又回写服务端」的空转循环。
  const prefsSetMut = trpc.userPrefs.set.useMutation();
  const serverSnap = useRef<{ presets?: string; quick?: string; model?: string }>({});
  const presetsPref = trpc.userPrefs.get.useQuery({ key: "canvasAgentPresets" }, { staleTime: Infinity, refetchOnWindowFocus: false });
  const quickPref = trpc.userPrefs.get.useQuery({ key: "canvasAgentQuick" }, { staleTime: Infinity, refetchOnWindowFocus: false });
  const modelPref = trpc.userPrefs.get.useQuery({ key: "canvasAgentModel" }, { staleTime: Infinity, refetchOnWindowFocus: false });
  useEffect(() => {
    if (!presetsPref.isSuccess) return;
    const v = presetsPref.data.value;
    if (Array.isArray(v)) { serverSnap.current.presets = JSON.stringify(v); setQpPresets(v as QpPreset[]); }
    else if (qpPresets.length) { serverSnap.current.presets = JSON.stringify(qpPresets); prefsSetMut.mutate({ key: "canvasAgentPresets", value: qpPresets }); } // 首次迁移本地→账号
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetsPref.isSuccess]);
  useEffect(() => {
    if (!quickPref.isSuccess) return;
    const v = quickPref.data.value;
    if (v && typeof v === "object" && !Array.isArray(v)) { serverSnap.current.quick = JSON.stringify(v); setQuickPrefs({ ...QP_DEFAULT, ...(v as Partial<QuickPrefs>) }); }
    else { serverSnap.current.quick = JSON.stringify(quickPrefs); prefsSetMut.mutate({ key: "canvasAgentQuick", value: quickPrefs }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickPref.isSuccess]);
  useEffect(() => {
    if (!modelPref.isSuccess) return;
    const v = modelPref.data.value;
    if (typeof v === "string" && v) { serverSnap.current.model = v; setModel(v as LLMModelId); }
    else { serverSnap.current.model = model; prefsSetMut.mutate({ key: "canvasAgentModel", value: model }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPref.isSuccess]);
  useEffect(() => {
    try { localStorage.setItem("avc:canvasAgent:qpPresets", JSON.stringify(qpPresets)); } catch { /* quota */ }
    const j = JSON.stringify(qpPresets);
    if (!presetsPref.isSuccess || j === serverSnap.current.presets) return;
    const t = setTimeout(() => { serverSnap.current.presets = j; prefsSetMut.mutate({ key: "canvasAgentPresets", value: qpPresets }); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qpPresets]);
  const [renamingPreset, setRenamingPreset] = useState<string | null>(null);
  const savePreset = () => {
    if (qpPresets.length >= 12) { toast.error("预设最多 12 套（可删除不用的再存）"); return; }
    const id = `qp_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    setQpPresets((p) => [...p, { id, name: `预设${p.length + 1}`, prefs: { ...quickPrefs } }]);
    setRenamingPreset(id); // 存完立刻进入重命名，鼓励起个可辨识的名字
  };
  const applyPreset = (p: QpPreset) => {
    // 与 QP_DEFAULT 合并：老预设缺新增字段时回落出厂默认，不会出现 undefined。
    setQuickPrefs({ ...QP_DEFAULT, ...p.prefs });
    toast.success(`已调取预设「${p.name}」`);
  };
  // 徽标 = 与出厂默认不同的改动数（0 = 全默认不显示）。泛型按键集合统计，新增设置字段
  // 自动纳入——旧手写枚举「默认真值也算 + 漏数新字段」的双重失真见 quickPrefsCount.ts 注释。
  const qpActiveCount = countDiffFromDefaults(QP_DEFAULT as unknown as Record<string, unknown>, quickPrefs as unknown as Record<string, unknown>);
  // 「ComfyUI模板」的二级选择：模板库中已存在的工作流模板（只有 comfyui_workflow 型模板
  // 带 workflowJson，可被 comfyui_workflow 节点引用）。选中 = 只允许助手用这些模板。
  const workflowTemplates = (templatesQuery.data ?? []).filter((t) => t.nodeType === "comfyui_workflow");
  const chosenWorkflowTpls = workflowTemplates.filter((t) => quickPrefs.workflowTemplateIds.includes(t.id));
  // #257 提示词优化批①：prefs 分「硬约束（系统逐条校验，违反即拒）/创作偏好」两区提升遵从；
  // 锁定视频模型时把时长上限算成准数注入（LLM 查表算术是历史拒因）；风格贯穿逐条提示词；
  // 转场风格同步给 storyboard.transition 倾向；对白语种弱版删除（#145 已是 system 硬规则，
  // 双份注入措辞不一致且白占 token——dialogueLang 仍作为独立字段传服务端，语义不变）。
  const buildQuickPrefsText = (): string | undefined => {
    const hard: string[] = [];  // 会被 agentApply/sanitize 真实校验或确定性强制的条目
    const soft: string[] = [];  // 创作偏好与写作要求（无程序校验，但必须遵守）
    // #257 锁定视频模型的单次时长上限（准数）：合并短镜/目标时长两条直接引用，免 LLM 查表。
    const vidCap = quickPrefs.videoProvider ? videoDurationCap(quickPrefs.videoProvider) : undefined;
    if (quickPrefs.imageFirst) hard.push("- 【强制·先生图再生视频】每个视频镜头先建 image_gen 图像节点（把镜头画面描述作为它的 prompt），再建 video_task 视频节点并连接 image_gen → video_task 作首帧，严禁 storyboard/prompt/script 直连 video_task 做文生视频。");
    if (quickPrefs.genNodes.length) hard.push(`- 【强制】生成节点只允许使用：${quickPrefs.genNodes.join(" / ")}；其余生成节点类型（image_gen/video_task/comfyui_image/comfyui_video/comfyui_workflow 中未列出的）一律禁止创建。`);
    if (quickPrefs.imageModel) hard.push(`- 【强制】图像生成一律使用模型 ${quickPrefs.imageModel}（写入 image_gen.model / storyboard.imageModel）。`);
    if (quickPrefs.videoProvider) hard.push(`- 【强制】视频生成一律使用模型 ${quickPrefs.videoProvider}（写入 video_task.provider；params 键与取值严格按该模型的参数表${vidCap ? `；该模型单镜最长 ${vidCap}s，duration 不得超过` : ""}）。`);
    if (quickPrefs.noStoryboard) hard.push("- 【强制·排除分镜节点】禁止创建 storyboard 分镜节点；镜头拆分与每镜画面描述改用 prompt 提示词节点承载（每镜一个 prompt 节点连到该镜的生成节点），链路：script → prompt → 生成节点 → merge。已存在的 storyboard 节点也不要新增连线到新链路。");
    if (chosenWorkflowTpls.length) hard.push(`- 【强制】comfyui_workflow 节点只允许引用以下模板：${chosenWorkflowTpls.map((t) => `id=${t.id}「${t.label}」`).join("、")}；其它模板一律禁止。`);
    if (quickPrefs.addMusic) soft.push("- 自动添加 audio 配乐节点并连入 merge 合并节点。");
    if (quickPrefs.addSubtitle) soft.push("- 自动添加 subtitle 字幕节点（接在视频/合并之后）。");
    if (quickPrefs.aspect) soft.push(`- 画面比例统一为 ${quickPrefs.aspect}（系统会把比例确定性写入各生成节点的比例字段，你无需在 payload 里逐个补写各族比例字段）。`);
    // #257 风格贯穿：不再只给一行偏好，明确要求写进每条提示词的风格质感要素（视频五要素之⑤）。
    if (quickPrefs.style.trim()) soft.push(`- 整体视觉风格：${quickPrefs.style.trim()}。【贯穿要求】每一条图像/视频提示词的「风格质感」要素都必须落这一风格（视频提示词五要素之⑤统一写它），不得只在部分镜头出现或漂移成其它风格。`);
    if (quickPrefs.durationSec > 0) soft.push(`- 目标总时长约 ${quickPrefs.durationSec} 秒，据此规划镜头数与每镜时长${vidCap ? `。所锁视频模型每镜上限 ${vidCap}s → 至少需要 ${Math.ceil(quickPrefs.durationSec / vidCap)} 个镜头（镜头数 × 每镜时长 ≈ ${quickPrefs.durationSec}s）` : ""}。`);
    // #244 转场风格：dissolve/cinematic 有 agentApply fill-only 确定性兜底（LLM 忘写也生效）；
    // smart 纯靠提示词引导 LLM 按镜头关系差异化写分镜 transition（装配成片逐接缝生效）。
    // #257 补齐：dissolve/cinematic 同步给 storyboard.transition 倾向——「按镜头表装配」走的是
    // 逐镜 transition，只约束 merge 全局字段时装配路径会漂回 LLM 自由发挥。
    if (quickPrefs.transitionStyle === "dissolve") soft.push("- 【转场风格·柔和叠化】若创建 merge 合并节点，设置 transition=\"dissolve\"、transitionDuration=0.35，让镜头间柔和衔接。有 storyboard 分镜时，各镜 transition 字段也统一写 \"dissolve\"（开场收尾可用 fade）——「按镜头表装配」按逐镜 transition 生效，需与整体风格一致。");
    if (quickPrefs.transitionStyle === "cinematic") soft.push("- 【转场风格·电影黑场】若创建 merge 合并节点，设置 transition=\"fadeblack\"、transitionDuration=0.6（经黑场过渡，电影感）。有 storyboard 分镜时，开场收尾镜 transition 写 \"fade\"、主要场景切换写 \"fadeblack\"、同场景连续动作可 cut——装配路径按逐镜 transition 生效。");
    if (quickPrefs.transitionStyle === "smart") soft.push("- 【转场风格·智能匹配】按相邻镜头的叙事关系为每个切点选择转场：同场景连续动作→cut 直切；时间/地点跳转→fadeblack；情绪缓冲/回忆→dissolve；平行叙事切换→smoothleft。有 storyboard 分镜时写在每镜的 transition 字段（装配成片按它逐接缝生效）；直接创建 merge 节点时写 segTransitions 数组（长度=段数-1，值取 none/fade/dissolve/fadeblack/fadewhite/smoothleft/wipe）。");
    if (quickPrefs.promptLang) soft.push(`- 【强制·提示词语种】所有喂给生成模型的【画面提示词】一律用${quickPrefs.promptLang}书写（image_gen.prompt、storyboard.promptText、video_task.prompt、comfyui 节点的 prompt 等画面描述提示词）。`);
    if (quickPrefs.coalesceShots) soft.push(`- 【合并短镜·省次数】在不破坏叙事的前提下，把【连续、同场景/同一连续动作】且时长之和 ≤ ${vidCap ? `${vidCap} 秒（所锁视频模型 ${quickPrefs.videoProvider} 的单次生成上限）` : "所选视频模型单次最长时长（见「云端生成模型清单」里该视频模型 params 的 duration 上限）"}的多个镜头，合并为【一个】 video_task 视频节点一次生成：把这些镜头的画面合成一段按时间推进的连贯提示词（用时间 beat 标注，如「0-6s …；6-12s …；12-18s …」），该节点的 duration 设为合并后的总秒数（不得超过上限）。遇明显转场/换场景/换主体就断开、另起一个新节点；无法合并的镜头正常逐个建节点。合并后仍在该节点 description 里逐 beat 分行说明。此举减少生成次数、更省更快，但会牺牲逐镜单独重生成的粒度——务必只合并画面连贯的镜头。`);
    if (!hard.length && !soft.length) return undefined;
    const parts: string[] = [];
    if (hard.length) parts.push(`【硬约束——系统会对操作逐条校验，违反的 create/update 会被直接拒绝并触发重规划，务必首轮就做对】\n${hard.join("\n")}`);
    if (soft.length) parts.push(`【创作偏好与写作要求——同样必须遵守】\n${soft.join("\n")}`);
    return parts.join("\n");
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
  // #92 内容驱动的面板自适应加宽：草稿较长（>60 字或含换行）时把面板平滑加宽到至少
  // 520px，草稿清空（发送/清除）自动回落原宽。特意用「内容」而非「聚焦」驱动——若 blur
  // 就收窄，点发送按钮时 mousedown 触发 blur → 面板收窄 → 按钮在 mouseup 前位移，click
  // 会点空。用户手动把面板调到 ≥520 时此机制零作用（取 max），用户设置永远第一位；
  // 临时加宽不写入持久化 size，回落后仍是用户原宽。
  // boostMuted：用户在长草稿期间亲手拖了缩放把手 → 本条草稿内不再自动加宽（手动尺寸
  // 优先，哪怕比 520 窄）；草稿清空后解除静音，下条长草稿恢复自适应。
  const [boostMuted, setBoostMuted] = useState(false);
  useEffect(() => { if (input.length === 0) setBoostMuted(false); }, [input]);
  const composeBoost = !boostMuted && (input.length > 60 || input.includes("\n"));
  const boostW = composeBoost ? Math.min(520, vw - 16) : 0;
  const effW = Math.max(Math.min(size.w, vw - 16), boostW);
  // 手动拖动/缩放期间关掉宽度过渡——否则 pointermove 逐帧 setState 会被 0.18s 过渡拖出橡皮筋感。
  const [interacting, setInteracting] = useState(false);
  const left = pos ? Math.max(8, Math.min(pos.left, vw - effW - 8)) : Math.max(8, vw - effW - 16);
  const top = pos ? pos.top : Math.max(8, window.innerHeight - size.h - 16);

  // ── 收起为悬浮小球（点关闭=收起，非真关闭；小球右键才可关闭）──
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem("avc:canvasAgent:collapsed") === "1");
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:collapsed", collapsed ? "1" : "0"); } catch { /* quota */ } }, [collapsed]);

  // #304 生成失败主动诊断：订阅画布上 status=failed 的节点。选择器返回【字符串签名】
  // （zustand 用 Object.is 比较，字符串天然稳定）——返回对象数组会每次新引用、渲染风暴。
  // 指纹 = id+error：同一失败只提醒一次（防骚扰）；修复后以【不同原因】再失败会重新亮。
  const failSig = useCanvasStore((s) => s.nodes
    .filter((n) => (n.data.payload as { status?: string } | undefined)?.status === "failed")
    .map((n) => `${n.id}${(n.data.title || n.data.nodeType).slice(0, 40)}${String((n.data.payload as { error?: unknown }).error ?? "").slice(0, 160)}`)
    .join(""));
  const failedNodes = useMemo(() =>
    failSig ? failSig.split("").map((row) => { const [id, title, error] = row.split(""); return { id, title, error }; }) : [],
  [failSig]);
  const [failDismissed, setFailDismissed] = useState<Set<string>>(new Set());
  const failKey = (f: { id: string; error: string }) => `${f.id} ${f.error}`;
  const activeFails = failedNodes.filter((f) => !failDismissed.has(failKey(f)));
  // #293 空画布引导「画布助手 · 一句话快速成片」入口：收到事件展开助手窗并聚焦输入框
  //（EmptyCanvasGuide 与助手窗无组件层级关系，走自定义事件，与 canvas:fit-view 同机制）。
  useEffect(() => {
    const onOpen = () => { setCollapsed(false); setTimeout(() => composerRef.current?.focus(), 150); };
    window.addEventListener("canvas:open-agent", onOpen);
    return () => window.removeEventListener("canvas:open-agent", onOpen);
  }, []);
  // 创意模式（LibTV 风）悬浮球更小巧（34），减少对媒体优先画布的遮挡；其它模式沿用 44。
  const { mode: canvasMode } = useCanvasMode();
  const BALL = canvasMode === "creative" ? 34 : 44;
  const [ballPos, setBallPos] = useState<{ left: number; top: number } | null>(() => {
    try { const s = localStorage.getItem("avc:canvasAgent:ballpos"); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return null;
  });
  useEffect(() => { if (ballPos) { try { localStorage.setItem("avc:canvasAgent:ballpos", JSON.stringify(ballPos)); } catch { /* quota */ } } }, [ballPos]);
  // 创意（创作者）模式默认停在右下角，其它模式默认左下角；用户拖过则用其保存位置。
  const ballLeft = ballPos ? ballPos.left : (canvasMode === "creative" ? Math.max(8, (typeof window !== "undefined" ? window.innerWidth : 1280) - BALL - 16) : 16);
  const ballTop = ballPos ? ballPos.top : Math.max(8, (window.visualViewport?.height ?? window.innerHeight) - BALL - 16);
  // 自愈：加载 / 窗口尺寸变化时把小球与面板位置夹回视口内——防「拖到屏外、换分辨率后找不到」。
  useEffect(() => {
    const clampIntoView = () => {
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setBallPos((p) => (p ? { left: Math.max(0, Math.min(vw - BALL, p.left)), top: Math.max(0, Math.min(vh - BALL, p.top)) } : p));
      setPos((p) => (p ? { left: Math.max(8, Math.min(vw - 120, p.left)), top: Math.max(8, Math.min(vh - 40, p.top)) } : p));
    };
    clampIntoView();
    window.addEventListener("resize", clampIntoView);
    return () => window.removeEventListener("resize", clampIntoView);
  }, [BALL]);
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
    setInteracting(true);
    const sx = e.clientX, sy = e.clientY, il = left, it = top;
    const onMove = (mv: PointerEvent) => setPos({ left: Math.max(0, Math.min(window.innerWidth - 120, il + mv.clientX - sx)), top: Math.max(0, Math.min(window.innerHeight - 40, it + mv.clientY - sy)) });
    const onUp = () => { setInteracting(false); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    setInteracting(true);
    setBoostMuted(true); // 手动缩放 = 用户对尺寸表态，本条草稿内停用自动加宽

    const sx = e.clientX, sy = e.clientY, iw = size.w, ih = size.h;
    const onMove = (mv: PointerEvent) => setSize({ w: Math.max(300, Math.min(window.innerWidth - 16, iw + mv.clientX - sx)), h: Math.max(360, Math.min(window.innerHeight - 16, ih + mv.clientY - sy)) });
    const onUp = () => { setInteracting(false); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  };
  // 拖拽调整「对话区 / 输入框」高度比例：上拖 = 输入框变高、对话区变矮（对话区 flex:1 自动收缩）。
  const startComposerResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sy = e.clientY, base = composerH || 46;
    const onMove = (mv: PointerEvent) => {
      const max = Math.max(60, size.h - 220); // 给对话区 + 头部留足空间，输入框不至于吃满
      setComposerH(Math.max(44, Math.min(max, base + (sy - mv.clientY))));
    };
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
  useEffect(() => {
    try { localStorage.setItem("avc:canvasAgent:model", model); } catch { /* quota */ }
    // #249 随账号：模型选择防抖回写服务端（载入回灌的相同值被 serverSnap 挡掉）。
    if (!modelPref.isSuccess || model === serverSnap.current.model) return;
    const t = setTimeout(() => { serverSnap.current.model = model; prefsSetMut.mutate({ key: "canvasAgentModel", value: model }); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  useEffect(() => { try { localStorage.setItem("avc:canvasAgent:template", template); } catch { /* quota */ } }, [template]);
  useEffect(() => {
    try { localStorage.setItem("avc:canvasAgent:prefs", JSON.stringify(quickPrefs)); } catch { /* quota */ }
    const j = JSON.stringify(quickPrefs);
    if (!quickPref.isSuccess || j === serverSnap.current.quick) return;
    const t = setTimeout(() => { serverSnap.current.quick = j; prefsSetMut.mutate({ key: "canvasAgentQuick", value: quickPrefs }); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickPrefs]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [turns, busy]);
  // AI 客户端「进入画布并发送至画布助手」：进入本画布（挂载）或收到实时事件时，把待填文本灌进输入框、
  // 展开面板、聚焦（只填不自动发送，用户可再改）。仅消费属于本 projectId 的待填内容。
  useEffect(() => {
    const pull = () => {
      const t = consumeAgentPrefill(projectId);
      if (!t) return;
      setCollapsed(false); // 从悬浮球展开
      setSize((s) => ({ w: Math.max(s.w, DEFAULT_SIZE.w), h: Math.max(s.h, DEFAULT_SIZE.h) })); // 放大到至少默认尺寸
      setInput((cur) => (cur.trim() ? cur + "\n" + t : t));
      setTimeout(() => { const el = composerRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }, 0); // 聚焦输入框
    };
    pull();
    window.addEventListener(AGENT_PREFILL_EVENT, pull);
    return () => window.removeEventListener(AGENT_PREFILL_EVENT, pull);
  }, [projectId]);

  // ── @角色/素材/上传 / 技能 触发面板（输入末尾 @片段 或 /片段 时浮出可选列表）──
  type PickItem = { name: string; sub?: string; kind: "char" | "skill" | "asset" | "upload" | "node"; url?: string };
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
      // A2 画布视觉输入：@ 可引用【画布节点的产物图】作参考附件——助手规划时真正「看见」
      // 该节点的画面（如「照第 3 镜的画风再来两镜」）。extractFrameMedia 统一各节点产物字段；
      // 惰性读 store（picker 随输入逐键重算，无需订阅 nodes 引发画布拖拽级重渲染）。
      const nodeItems: PickItem[] = useCanvasStore.getState().nodes
        .map((n) => ({ title: (n.data.title ?? "").trim() || n.data.nodeType, url: extractFrameMedia(n.data.payload as Record<string, unknown>).imageUrl }))
        .filter((x): x is { title: string; url: string } => !!x.url)
        .filter((x) => !pickFrag || x.title.toLowerCase().includes(pickFrag))
        .slice(0, 4)
        .map((x) => ({ name: x.title, sub: "画布节点产物 · 作为参考图附件", kind: "node" as const, url: x.url }));
      // 「上传」常驻最后：直接选本地图/文档作参考附件（免先进素材库）。
      return [...chars, ...nodeItems, ...assets, { name: "上传图片 / 文档…", sub: "本地文件作为参考附件", kind: "upload" as const }];
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
    if ((it.kind === "asset" || it.kind === "node") && it.url) {
      // 素材/节点产物 → 拉成 File 进现有附件管线（chip 展示、大小护栏、发送时转 data URI 喂 LLM）。
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
    const cv = ok.filter((o) => o.op === "canvas").length; // #112 画布级动作
    const g = ok.filter((o) => o.op === "group").length, dp = ok.filter((o) => o.op === "duplicate").length; // #267
    const al = ok.filter((o) => o.op === "align").length; // #269 排列指定节点
    return [c && `新建 ${c}`, dp && `复制 ${dp}`, l && `连线 ${l}`, u && `改 ${u}`, d && `删 ${d}`, g && `编组 ${g}`, al && `排列 ${al}`, cv && `画布动作 ${cv}`].filter(Boolean).join(" · ");
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

  // #227 角色自动定妆照 / #271 场景自动场景图：规划落地后，为本轮【新建】且【还没有
  // 参考图】的角色/场景节点，逐个按描述生成主参考图（fill-only，绝不覆盖已有图——角色
  // 库代入的定妆照优先）。串行执行防生图并发风暴；单个失败不阻断其余。fire-and-forget：
  // 不占用聊天 busy 状态。提示词/比例与角色卡按钮同源（characterPortrait.ts 统一入口：
  // 人物→定妆照 3:4、场景→空镜概念图 16:9——#271 用户实报勾了自动定妆但场景没被覆盖，
  // 根因就是此前只筛 person 且只有人物提示词组装）。
  // #271 进度指示：生成期间给节点写 payload.status="processing"——BaseNode 常驻进度条
  // 据此显示（节点收缩/未选中也可见），成功清除、失败留 failed 红条；此前只有 toast，
  // 一闪即逝，用户盯着节点完全不知道正在生成。
  const autoPortraits = async (createdIds: string[]) => {
    const st = useCanvasStore.getState();
    const targets = st.nodes
      .filter((n) => createdIds.includes(n.id) && n.data.nodeType === "character")
      .map((n) => ({ id: n.id, p: n.data.payload as CharacterNodeData }))
      .filter(({ p }) => !p.referenceImageUrl?.trim() && !!buildCharacterImagePrompt(p));
    if (!targets.length) return;
    const nScene = targets.filter(({ p }) => (p.characterKind ?? "person") === "scene").length;
    const label = (n: number, s: number) => [n - s > 0 ? `${n - s} 个角色定妆照` : "", s > 0 ? `${s} 个场景图` : ""].filter(Boolean).join("与");
    toast.info(`正在生成 ${label(targets.length, nScene)}…`, { duration: 3500 });
    let ok = 0;
    for (const t of targets) {
      const aspect = characterImageAspect(t.p);
      // #316 防双扣费互斥：开工前复核节点【此刻】状态——已有图（并行路径先完成）或
      // status==="processing"（「运行全部」/手动按钮正在生成）都跳过，不再提交第二次
      // 付费生成。检查与置锁在同一同步块内（中间无 await），单页签内原子性足够。
      const cur = useCanvasStore.getState().nodes.find((n) => n.id === t.id)?.data.payload as CharacterNodeData | undefined;
      if (!cur || cur.referenceImageUrl?.trim() || cur.status === "processing") { if (cur?.referenceImageUrl?.trim()) ok++; continue; }
      useCanvasStore.getState().updateNodeData(t.id, { status: "processing", errorMessage: undefined } as Partial<CharacterNodeData>, true);
      try {
        const gen = await utils.client.imageGen.generate.mutate({
          prompt: buildCharacterImagePrompt(t.p),
          aspectRatio: aspect,
          poyoAspectRatio: aspect,
          reveAspectRatio: aspect,
          projectId,
          ...(quickPrefs.imageModel ? { model: quickPrefs.imageModel } : {}),
        } as Parameters<typeof utils.client.imageGen.generate.mutate>[0]);
        const url = gen.urls?.[0] || gen.url || "";
        // 节点可能在生成期间被删除/撤销——落图前复核仍在画布且仍无参考图。
        const live = useCanvasStore.getState().nodes.find((n) => n.id === t.id);
        if (url && live && !(live.data.payload as CharacterNodeData).referenceImageUrl?.trim()) {
          useCanvasStore.getState().updateNodeData(t.id, { referenceImageUrl: url, referenceStorageKey: undefined, status: undefined, errorMessage: undefined } as Partial<CharacterNodeData>, true);
          ok++;
        } else if (live) {
          // 图没落地（生成空返回 / 期间被填了图）——清运行态，不留永转进度条。
          useCanvasStore.getState().updateNodeData(t.id, { status: undefined } as Partial<CharacterNodeData>, true);
        }
      } catch (err) {
        console.warn("[autoPortrait] 定妆照/场景图生成失败", t.id, err);
        const live = useCanvasStore.getState().nodes.find((n) => n.id === t.id);
        // #313 迟到失败竞态守卫：fill-only 语义下若节点【此刻已有图】（并行的「运行全部」
        // 或手动生成先落地），本条失败已无意义——只清运行态，绝不把失败横幅糊到成果上
        // （真实翻车：Poyo 5 分钟超时的迟到 failed 盖在已生成的定妆照上）。
        if (live) {
          const hasImg = !!((live.data.payload as CharacterNodeData).referenceImageUrl ?? "").trim();
          if (hasImg) { ok++; useCanvasStore.getState().updateNodeData(t.id, { status: undefined, errorMessage: undefined } as Partial<CharacterNodeData>, true); }
          else useCanvasStore.getState().updateNodeData(t.id, { status: "failed", errorMessage: `自动生成失败：${err instanceof Error ? err.message : String(err)}` } as Partial<CharacterNodeData>, true);
        }
      }
    }
    if (ok > 0) toast.success(`已生成 ${ok} 张主参考图（角色定妆照/场景图已写入节点）`);
    else toast.error("定妆照/场景图自动生成未成功（可在节点上点「一键定妆照/场景图」重试）");
  };

  // #225 外观锚点自动压缩（快捷设置「外观锚点压缩」，默认开）：规划落地后，为本轮
  // 【新建】且【还没有锚点】的人物角色节点，把外貌/服装/标志描述压成 15-30 字锚点短语
  // 写入角色卡——后续所有下游注入自动走压缩形态（角色卡小按钮可随时切回全量）。
  // 串行 + fill-only + fire-and-forget，与 autoPortraits 同哲学；纯文本调用成本极低，
  // 失败静默（角色卡上可手动点「AI 压缩」重试），不打扰规划主流程。
  const autoAnchors = async (createdIds: string[]) => {
    const st = useCanvasStore.getState();
    const targets = st.nodes
      .filter((n) => createdIds.includes(n.id) && n.data.nodeType === "character")
      .map((n) => ({ id: n.id, p: n.data.payload as CharacterNodeData }))
      .filter(({ p }) => (p.characterKind ?? "person") === "person" && !p.appearanceAnchor?.trim());
    let ok = 0;
    for (const t of targets) {
      const profileText = [t.p.appearance, t.p.outfit, t.p.signature, t.p.gender, t.p.age]
        .map((s) => (s ?? "").trim()).filter(Boolean).join("；");
      if (!profileText) continue;
      try {
        const r = await utils.client.scripts.compressCharacterAnchor.mutate({ profileText: profileText.slice(0, 2000) });
        // 节点可能已被删除/撤销，或用户已手填锚点——落笔前复核。
        const live = useCanvasStore.getState().nodes.find((n) => n.id === t.id);
        if (r.phrase && live && !(live.data.payload as CharacterNodeData).appearanceAnchor?.trim()) {
          useCanvasStore.getState().updateNodeData(t.id, { appearanceAnchor: r.phrase }, true);
          ok++;
        }
      } catch (err) {
        console.warn("[anchorCompress] 角色外观锚点压缩失败", t.id, err);
      }
    }
    if (ok > 0) toast.success(`已为 ${ok} 个角色生成外观锚点（提示词压缩注入，角色卡可切回全量）`, { duration: 4000 });
  };

  // #272 批量入库执行器（助手「将画布内所有角色/场景入库」口令）：与角色卡「存库」按钮
  // 共用 buildLibrarySaveInput 单一事实源（同一套剥离规则 + 来源项目标记）。同名条目跳过
  // 不覆盖——批量场景绝不能弹几十个覆盖确认，也绝不能静默覆盖用户库里的既有内容
  //（「用户的设置永远第一位」）；跳过数在汇总 toast 里明示。串行执行，逐个失败不阻断。
  const batchSaveLibrary = async (targetId?: string) => {
    const st = useCanvasStore.getState();
    const chars = st.nodes.filter((n) => n.data.nodeType === "character" && (!targetId || n.id === targetId));
    if (targetId && chars.length === 0) { toast.error("要入库的角色/场景节点未找到"); return; }
    const inputs = chars
      .map((n) => buildLibrarySaveInput(n.data.payload as CharacterNodeData, projectId))
      .filter((x): x is NonNullable<typeof x> => !!x);
    const unnamed = chars.length - inputs.length;
    if (!inputs.length) {
      toast.error(targetId ? "目标节点还没有名字，无法入库" : "画布上没有已命名的角色/场景节点");
      return;
    }
    let ok = 0, dup = 0, fail = 0;
    for (const input of inputs) {
      try {
        await utils.client.characterLibrary.create.mutate(input);
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/已存在同名/.test(msg)) dup++;
        else { fail++; console.warn("[saveLibrary] 入库失败", input.name, e); }
      }
    }
    void utils.characterLibrary.list.invalidate(); // 角色库面板/@ 菜单/「已入库」徽章立即刷新
    const bits = [`已入库 ${ok} 个`, dup ? `${dup} 个同名跳过（不覆盖库内既有条目）` : "", fail ? `${fail} 个失败` : "", unnamed ? `${unnamed} 个未命名跳过` : ""].filter(Boolean).join(" · ");
    (ok > 0 ? toast.success : toast.warning)(`角色/场景批量入库：${bits}`, { duration: 6000 });
  };

  // 规划结果统一落地（send 与 #251 跨会话恢复共用）：应用操作 → 追加助手回合 → 自动增强。
  // 恢复路径用的是「当前」quickPrefs（附件等一次性上下文只影响规划本身，结果应用不依赖）。
  const applyChatResult = (r: AgentChatResult): { apply: ReturnType<typeof applyAgentOperations> | null; fetchIds: string[] } => {
    let applyRes: ReturnType<typeof applyAgentOperations> | null = null;
    // #260 附件即可引用：先把 {{refN}} 占位符替换成发送时登记的附件真实地址、并抽走
    // library 入库操作（applyAgentOperations 只认画布语义）。attachRefsRef 在 send() 时
    // 按「图片附件顺序 ref1..」构建（与服务端 attachRefList 同规则）；会话恢复路径映射
    // 为空 → resolveAttachmentRefs 内置容错（剥引用/跳过入库并告警），绝不让规划整体失败。
    const resolved = resolveAttachmentRefs((r.operations ?? []) as AgentOperation[], attachRefsRef.current);
    for (const w of resolved.warnings) toast.warning(w, { duration: 6000 });
    // 入库操作异步执行（不阻塞画布应用）：复用「存为角色主体」同一后端接口与 payload 形状。
    // 同名冲突不覆盖（尊重 characterLibrary.create 的默认语义），提示用户改名重试。
    for (const lib of resolved.libraryOps) {
      // #272 附件入库同样带来源项目标记（librarySourceProjectId，面板分项目检索用）。
      const payload = lib.kind === "scene"
        ? { characterKind: "scene", sceneName: lib.name, referenceImageUrl: lib.url, librarySourceProjectId: projectId }
        : { characterKind: "person", name: lib.name, referenceImageUrl: lib.url, librarySourceProjectId: projectId };
      libraryCreateMut.mutate(
        { name: lib.name, characterKind: lib.kind, payload, thumbnail: lib.url },
        {
          onSuccess: () => {
            toast.success(`已加入${lib.kind === "scene" ? "场景" : "角色"}库「${lib.name}」——之后可直接 @${lib.name} 引用`);
            void utils.characterLibrary.list.invalidate(); // @ 菜单/角色库立即可见
          },
          onError: (e) => toast.error(`加入${lib.kind === "scene" ? "场景" : "角色"}库失败：${e.message}`),
        },
      );
    }
    // #268 动态样片动作在应用层抽走（apply 层纯 store 不发网络，与 library 同边界）：
    // 多条只执行一次（渲染是全镜头表级别的重活，重复毫无意义）；异步启动不阻塞
    // 其余画布操作落地，进度/结果全程 toast 反馈（runAnimaticFromCanvas 内部负责）。
    const wantAnimatic = (resolved.nodeOps as AgentOperation[]).some((o) => o.op === "canvas" && o.action === "animatic");
    // #298 批量配音口令同样抽走（需要 audioGen tRPC）。执行放在画布操作落地【之后】——
    // 「把陈默锁成温柔女声并给每个镜头配音」这类同批指令要先让 set_voice 落进角色档案，
    // 配音收集器才能读到刚锁的音色。
    const wantDub = (resolved.nodeOps as AgentOperation[]).some((o) => o.op === "canvas" && o.action === "dub_shots");
    // #272 批量入库动作同样抽走（需要 characterLibrary.create tRPC）；记下 targetRef
    //（省略=全部），执行放在画布操作落地【之后】——「建 3 个角色并全部入库」这类
    // 同批指令要能把刚落地的新角色也收进去。
    const saveLibOps = (resolved.nodeOps as AgentOperation[]).filter((o) => o.op === "canvas" && o.action === "save_library");
    // #291 fetch_details：模型请求存根节点全文（信息收集轮）。收到即【不应用其余操作】
    //（模型意图是先看内容再规划），把 ids 交回 send() 自动带全文重发一次。
    const fetchOps = (resolved.nodeOps as AgentOperation[]).filter((o) => o.op === "canvas" && o.action === "fetch_details");
    if (fetchOps.length) {
      const fetchIds = Array.from(new Set(fetchOps.flatMap((o) => [...(o.targetRefs ?? []), ...(o.targetRef ? [o.targetRef] : [])])));
      setTurns((p) => [...p, { role: "assistant", content: r.reply || "需要先查看部分节点的完整内容，正在自动补充后重新规划…" }]);
      return { apply: null, fetchIds };
    }
    const ops = (resolved.nodeOps as AgentOperation[]).filter(
      (o) => !(o.op === "canvas" && (o.action === "animatic" || o.action === "save_library" || o.action === "dub_shots")),
    );
    if (wantAnimatic) {
      // utils.client 的 tRPC 精确类型与最小接口结构兼容（仅取 editor 四端点的所需形状）。
      void runAnimaticFromCanvas(utils.client as unknown as AnimaticEditorClient, { aspect: quickPrefs.aspect || undefined });
    }
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
        excludeStoryboard: quickPrefs.noStoryboard || undefined,
        transitionStyle: quickPrefs.transitionStyle || undefined,
      });
      applyRes = res;
      applied = opsSummary(ops); createdIds = res.createdIds ?? [];
      // 角色确定性自动接线（不对应任何 op，opsSummary 统计不到）——透明反馈，让用户知道
      // 角色参考图已接入生成节点（是「@角色→首帧看不到参考图」修复的可见闭环）。
      if (res.autoLinkedChars > 0) applied = [applied, `角色接入 ${res.autoLinkedChars}`].filter(Boolean).join(" · ");
      // #285 已有角色确定性复用（LLM 重复 create 的同名角色被合并到画布已有节点，不重建
      // 不重新定妆）——透明反馈；复用节点不在 createdIds 里，下方自动定妆天然不会重跑它们。
      if (res.reusedCharacters > 0) applied = [applied, `复用已有角色 ${res.reusedCharacters}`].filter(Boolean).join(" · ");
      // #295 锁音色明细：直接把「谁 → 什么音色」写进反馈行（比计数更有确认感）。
      if (res.voiceLocks.length > 0) applied = [applied, `锁定音色：${res.voiceLocks.join("；")}`].filter(Boolean).join(" · ");
      // 服务端自愈生效（首轮 JSON 截断/非法或操作全被拒 → 自动修复一次后成功）——透明反馈。
      if (r.repaired) applied = [applied, "已自动修正规划"].filter(Boolean).join(" · ");
      if (res.failures.length) applyFailMsg = `${res.failures.length} 项未应用：${res.failures.map((f) => f.reason).slice(0, 3).join("；")}`;
      // #227 角色自动定妆照（开关开启时）：后台跑，不阻塞对话。
      if (quickPrefs.autoPortrait && createdIds.length) void autoPortraits(createdIds);
      // #225 外观锚点自动压缩（默认开）：后台跑，不阻塞对话。
      if (quickPrefs.anchorCompress && createdIds.length) void autoAnchors(createdIds);
    }
    // #298 批量配音在画布操作落地【之后】启动：set_voice/新分镜已进 store，收集器
    // 拿到的是最新音色与对白。异步不阻塞，confirm 计价确认 + 进度/结果 toast 由
    // runDubbingFromCanvas 内部负责（与镜头表面板「批量配音」同源同口径）。
    if (wantDub) void runDubbingFromCanvas(utils.client as unknown as DubbingClient);
    // #272 批量入库在画布操作落地【之后】执行——「建 N 个角色并全部入库」这类同批
    // 指令要能收进刚落地的新角色。任一条省略 targetRef → 全量；否则按指定节点逐个。
    if (saveLibOps.length) {
      const refs = Array.from(new Set(saveLibOps.map((o) => (o as AgentOperation).targetRef).filter((v): v is string => !!v)));
      if (saveLibOps.some((o) => !(o as AgentOperation).targetRef) || refs.length === 0) void batchSaveLibrary();
      else refs.forEach((ref) => void batchSaveLibrary(ref));
    }
    const failed = [droppedMsg, applyFailMsg].filter(Boolean).join(" · ") || undefined;
    setTurns((p) => [...p, { role: "assistant", content: r.reply || (applied ? "已按你的要求改好画布。" : "（无改动）"), applied: applied || undefined, failed, createdIds: createdIds.length ? createdIds : undefined }]);
    return { apply: applyRes, fetchIds: [] };
  };

  // #251 跨进出画布续跑：挂载后查本项目是否有「进行中/已完成未取走」的规划任务
  // （上次提交后退出画布，服务端任务仍在跑/已跑完）——有则自动恢复轮询并落地结果，
  // 无需用户重发。仅恢复一次；弹窗版（isPopout）不参与。
  const resumedRef = useRef(false);
  const pendingChatQuery = trpc.agent.pendingChat.useQuery({ projectId }, {
    enabled: !!projectId, staleTime: Infinity, refetchOnWindowFocus: false, retry: false,
  });
  useEffect(() => {
    const job = pendingChatQuery.data?.job;
    if (!job || busy || resumedRef.current) return;
    resumedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setPlanStage("");
    setPlanPartial("");
    toast.info(job.running ? "检测到上次未完成的规划任务，已自动恢复等待…" : "上次的规划已在后台完成，正在取回并应用…", { duration: 4000 });
    void (async () => {
      try {
        const r = await pollAgentChatJob(utils.client, job.jobId, controller.signal, (p) => { if (p.stage) setPlanStage(p.stage); setPlanPartial(p.partial ?? ""); });
        const out = applyChatResult(r);
        // #291 恢复路径没有原消息可自动弹跳——提示用户重发即可（fetch_details 极少出现在恢复轮）。
        if (out.fetchIds.length) toast.info("助手请求了部分节点的全文——请把刚才的消息重发一次以继续", { duration: 7000 });
        toast.success("已恢复并完成上次的规划任务", { duration: 3500 });
      } catch (e) {
        if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setTurns((p) => [...p, { role: "assistant", content: `恢复上次规划失败：${friendlyClientLLMError(e)}`, error: true }]);
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChatQuery.data]);

  async function send(overrideMsg?: string) {
    // overrideMsg：交互式规划的「选项快捷回复」直接发送，不经输入框。
    const files = overrideMsg ? [] : staged;
    const rawInput = overrideMsg ?? input; // 出错时用于恢复输入原文（避免规划失败后要重打字）
    const msg = (overrideMsg ?? input).trim() || (files.length ? "请参考附件规划画布。" : "");
    if (!msg || busy) return;
    if (voice.recording) voice.stop(); // #305 发送即停录，防止后续识别文本回填进已清空的输入框
    if (!overrideMsg) { setInput(""); setStaged([]); setAttachErr(""); }
    setShowQuick(false); // #254 发送指令即自动收回快捷设置面板（设置已随本轮生效，无需占屏）
    // 每条截到 8000（服务端 history zod 上限）——否则发过超长消息后，下一条会整包被 400 拒掉。
    // 交互式规划的多轮决策（4 决策点 ≈ 8-10 条）会顶满 10 条窗口，放宽到 16 条防共识被挤出；
    // 服务端 ctxBudget 仍按总字符预算兜底裁剪，不会撑爆输入。
    const history = turns.slice(quickPrefs.interactive ? -16 : -10).map((t) => ({ role: t.role, content: t.content.slice(0, 8000) }));
    const attachLabel = files.length ? `　📎 ${files.map((f) => f.name).join("、")}` : "";
    setTurns((p) => [...p, { role: "user", content: msg + attachLabel }]);
    // 软取消：本机 Claude/GPT 大计划可能等 1~10 分钟——「取消」按钮立刻拿回控制
    // （后台任务仍会跑完，结果被丢弃）。
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      // #260 附件即可引用：图片附件先走既有上传通道换成【稳定地址】（生产=自有存储 URL、
      // dev 无对象存储时服务端回退返回 data URL）——同一个地址既作视觉输入喂模型，也供
      // 规划节点 referenceImageUrl / 入库操作确定性替换引用。上传失败回退 data URI：
      // 视觉理解不受影响，仅「被外部生成平台拉取」在生产可能不可达（与节点手动传参考图同语义）。
      // 文档附件不上传（不参与节点引用），保持 data URI 直传。
      const attachments = files.length
        ? await Promise.all(files.map(async (f) => {
            const dataUri = await fileToDataUri(f);
            let url = dataUri;
            if ((f.type || "").startsWith("image/")) {
              try {
                const up = await attachUploadMut.mutateAsync({
                  base64: dataUri.replace(/^data:[^,]*,/, ""), // uploadInput 拒绝带 data: 前缀
                  mimeType: f.type || "image/jpeg",
                  filename: f.name,
                });
                if (up?.url) url = up.url;
              } catch { /* 回退 data URI，见上方注释 */ }
            }
            return { url, mimeType: f.type || "application/octet-stream", name: f.name };
          }))
        : undefined;
      // 登记占位符映射：仅图片、按消息内顺序 ref1 起——判定与编号规则必须与服务端
      // attachRefList（isImageAtt + 过滤后序号）逐字一致，否则图张错位。每轮发送重建，
      // 旧轮映射即失效（resolveAttachmentRefs 对失效引用有剥除告警兜底）。
      attachRefsRef.current = {};
      if (attachments) {
        let n = 0;
        for (const a of attachments) {
          if ((a.mimeType || "").toLowerCase().startsWith("image/") || /^data:image\//i.test(a.url)) attachRefsRef.current[`ref${++n}`] = a.url;
        }
      }
      const focus = selectedNodeIds.filter(Boolean);
      const persona = template === BLANK_TEMPLATE_ID ? undefined : ALL_AI_TEMPLATES.find((t) => t.id === template)?.prompt;
      // 提交后台任务 → 轮询取结果（runAgentChatJob：短请求轮询，断连/掐线/重启不丢等待）。
      setPlanStage("");
      setPlanPartial("");
      // #140 快速设置「节点」未勾任何 ComfyUI 系 → 本轮用不到模板：让服务端完全跳过
      // 模板分析与模板知识注入（省 DB 读与提示词体积，规划更快）。
      const skipComfyTemplates = !quickPrefs.genNodes.some((n) => n.startsWith("comfyui"));
      // #290 摘要档位：压缩=短别名 nN（发送前 ensureAliasNums 持久化补号；框选白名单同时
      // 携带 短号+真实 id 双形态，模型引用哪种都过 sanitize/apply）；标准=全量真实 id 回退档。
      // #292 三档语义：compressed=短号+相关性调度；standard=真实 id（旧行为）；
      // full=全量完整（真实 id、1000 字截断、58000 帽、服务端预算联动放宽）。
      const fullMode = quickPrefs.summaryMode === "full";
      const aliasMode = quickPrefs.summaryMode !== "standard" && !fullMode;
      const doPlan = async (aliasOn: boolean, extraDetail?: string) => {
        if (aliasOn) ensureAliasNums();
        const summary = buildGraphSummary("", { ...(focus.length ? { focusNodeIds: focus } : {}), aliasIds: aliasOn, relevanceQuery: fullMode ? undefined : msg, fullMode });
        let selIds: string[] | undefined;
        if (focus.length) {
          const numById = new Map(useCanvasStore.getState().nodes.map((n) => [n.id, (n.data.payload as { aliasNum?: unknown } | undefined)?.aliasNum]));
          const aliases = aliasOn
            ? focus.map((id) => { const num = numById.get(id); return typeof num === "number" ? `n${num}` : null; }).filter((v): v is string => !!v)
            : [];
          selIds = Array.from(new Set([...aliases, ...focus])).slice(0, 200);
        }
        const r = await runAgentChatJob(
          utils.client,
          // #141 模型清单按需注入：锁定的模型随每轮请求实时传入（服务端无状态）——
          // 改模型下一轮即按新模型注入、选回「默认」下一轮即恢复该类别全量清单。
          // A3 增量规划：框选节点透传服务端 → prompt 硬约束 + sanitize 拦框选外的 update/delete。
          { projectId, message: extraDetail ? `${msg}\n\n【系统注入·你上一轮 fetch_details 请求的节点全文】\n${extraDetail}` : msg, history, graphSummary: summary || undefined, summaryFull: fullMode || undefined, summaryMode: quickPrefs.summaryMode || undefined, selectedNodeIds: selIds, model, persona, includeCharacterLibrary: true, attachments, prefs: buildQuickPrefsText(), imageFirst: quickPrefs.imageFirst || undefined, skipComfyTemplates: skipComfyTemplates || undefined, useComfyMemory: quickPrefs.useComfyMemory === false ? false : undefined, pinnedImageModel: quickPrefs.imageModel || undefined, pinnedVideoModel: quickPrefs.videoProvider || undefined, dialogueLang: quickPrefs.dialogueLang || undefined, fastChatRoute: quickPrefs.fastChat || undefined, useModelSkills: quickPrefs.useModelSkills || undefined, interactive: quickPrefs.interactive || undefined, leanPrompt: quickPrefs.leanPrompt || undefined, selfCheck: quickPrefs.selfCheck || undefined, streamEcho: quickPrefs.streamEcho || undefined },
          controller.signal,
          (p) => { if (p.stage) setPlanStage(p.stage); setPlanPartial(p.partial ?? ""); },
        );
        return applyChatResult(r);
      };
      let outcome = await doPlan(aliasMode);
      // #291 fetch_details 单跳弹跳：模型请求存根全文 → 自动带全文重发一次；第二轮再要
      // 则忽略并提示（防循环）。取详为空（引用全部无效）不弹跳，直接提示。
      if (outcome.fetchIds.length) {
        const detail = buildNodeDetailText(outcome.fetchIds, { aliasIds: aliasMode });
        if (detail) {
          setPlanStage("已取回节点全文，重新规划中…");
          outcome = await doPlan(aliasMode, detail);
          if (outcome.fetchIds.length) toast.warning("助手再次请求节点全文，已忽略（防循环）——可框选相关节点后重问", { duration: 6000 });
        } else {
          toast.warning("助手请求的节点全文未找到（引用无效），本轮未做画布改动", { duration: 6000 });
        }
      }
      // #290 自动回退（单次，防循环）：压缩档下失败项 ≥2 且过半是「未找到 nN」型
      // （幻觉短号/摘要-画布错位）→ 自动切全量 id 重发一次。零星幻觉引用不触发。
      const appliedRes = outcome.apply;
      if (aliasMode && appliedRes && appliedRes.failures.length >= 2) {
        const misses = appliedRes.failures.filter((f) => /[（「(]n\d+[）」)]/.test(f.reason)).length;
        if (misses >= 2 && misses * 2 >= appliedRes.failures.length) {
          toast.info("检测到短号引用异常，已自动切换全量 id 重试一次…", { duration: 5000 });
          await doPlan(false);
        }
      }
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        setTurns((p) => [...p, { role: "assistant", content: "已取消本次规划（后台任务可能仍会完成，结果已忽略）。", error: true }]);
        return;
      }
      setTurns((p) => [...p, { role: "assistant", content: friendlyClientLLMError(e), error: true }]);
      // 规划失败：把原文与暂存附件一并恢复（仅当用户还没另起输入/附件），改一改就能重发，不用重打、
      // 也不会丢参考图（此前只恢复文本，用户以为直接重发即可，实际参考图已被清空 → 重发变成无参考图）。
      if (rawInput.trim()) setInput((cur) => (cur ? cur : rawInput));
      if (files.length) setStaged((cur) => (cur.length ? cur : files));
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
      // #92 自动加宽/回落走平滑过渡；手动拖动/缩放期间必须关掉，否则逐帧 setState 出橡皮筋感。
      transition: interacting ? undefined : "width 0.18s ease, left 0.18s ease",
    }} onClick={(e) => e.stopPropagation()}>
      {/* header（拖动手柄） */}
      <div onPointerDown={startDrag} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--c-bd2)", flexShrink: 0, cursor: "move", touchAction: "none" }}>
        <Sparkles className="w-4 h-4" style={{ color: accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)" }}>画布助手</span>
        <div style={{ flex: 1 }} />
        {/* #254 选择框加宽 + 显示完整模型名（此前 150px 只放得下缩写，长模型名认不出） */}
        <div style={{ maxWidth: 240 }}><LLMModelPicker value={model} onChange={setModel} disabled={busy} fullLabel /></div>
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
        <button data-qs-toggle onClick={() => setShowQuick((v) => !v)} title="快速设置：画面比例 / 风格 / 时长 / 生图先行 / 配乐字幕——注入助手规划"
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
        // #242 分组小节标题：把十几行控件归类，扫一眼就能定位要改的设置。
        const secHead = (label: string): React.ReactNode => (
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--c-t4)", marginTop: 3, borderTop: "1px dashed var(--c-bd1)", paddingTop: 7 }}>{label}</div>
        );
        const iconBtn: React.CSSProperties = { padding: "0 3px", fontSize: 10, lineHeight: 1, background: "transparent", border: "none", color: "var(--c-t4)", cursor: "pointer" };
        return (
          <div data-qs-panel className="nowheel" style={{ padding: "8px 12px 10px", borderBottom: "1px solid var(--c-bd2)", display: "flex", flexDirection: "column", gap: 8, maxHeight: "46vh", overflowY: "auto" }}>
            {/* ── 预设条：整套设置的保存 / 一键调取 / 重命名 / 覆盖 / 删除 ── */}
            <div data-testid="qp-preset-bar" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }} title="把当前整套快捷设置存成命名预设，随时一键调取（存在本浏览器）">预设</span>
              {qpPresets.map((p) => renamingPreset === p.id ? (
                <input key={p.id} autoFocus defaultValue={p.name} data-testid="qp-preset-rename"
                  onBlur={(e) => { const n = e.target.value.trim().slice(0, 20); setQpPresets((arr) => arr.map((x) => x.id === p.id ? { ...x, name: n || x.name } : x)); setRenamingPreset(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenamingPreset(null); }}
                  style={{ width: 92, padding: "2px 7px", fontSize: 11, borderRadius: 7, border: `1px solid ${accent}`, background: "var(--c-input, var(--c-surface))", color: "var(--c-t1)", outline: "none" }} />
              ) : (
                <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 1, padding: "2px 4px 2px 9px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)" }}>
                  <button onClick={() => applyPreset(p)} title={`一键调取「${p.name}」（整套覆盖当前快捷设置）`} data-testid="qp-preset-apply"
                    style={{ padding: 0, fontSize: 11, background: "transparent", border: "none", color: "var(--c-t1)", cursor: "pointer", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</button>
                  <button onClick={() => setRenamingPreset(p.id)} title="重命名" style={iconBtn}>✎</button>
                  <button onClick={() => { setQpPresets((arr) => arr.map((x) => x.id === p.id ? { ...x, prefs: { ...quickPrefs } } : x)); toast.success(`已用当前设置覆盖「${p.name}」`); }} title="用当前设置覆盖此预设" style={iconBtn}>⟳</button>
                  <button onClick={() => setQpPresets((arr) => arr.filter((x) => x.id !== p.id))} title="删除此预设" style={{ ...iconBtn, color: "oklch(0.6 0.15 25)" }}>×</button>
                </span>
              ))}
              <button onClick={savePreset} data-testid="qp-preset-save" title="把当前整套快捷设置保存为新预设（保存后可重命名）"
                style={{ ...chip(false), borderStyle: "dashed" }}>+ 存为预设</button>
            </div>

            {secHead("画面与时长")}
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
            {/* #244 成片转场风格：默认=直切（现状，concat 快路径零改动）；其余风格作用于合并成片 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }} title="合并成片时镜头间的转场风格；默认=直切（不设转场，与以前完全一致）">转场</span>
              <MiniSelect value={quickPrefs.transitionStyle} placeholder="默认" maxWidth={168} accent={accent} accentSoft={accentSoft}
                title="成片转场风格：默认直切=现状不变；柔和叠化=全片 dissolve 0.35s；电影黑场=全片经黑场 0.6s；智能匹配=助手按镜头叙事关系逐接缝选转场（直切/叠化/黑场/推移）"
                groups={[{ options: [
                  { value: "", label: "默认（直切）" },
                  { value: "dissolve", label: "柔和叠化" },
                  { value: "cinematic", label: "电影黑场" },
                  { value: "smart", label: "智能匹配（逐镜）" },
                ] }]} onChange={(v) => setQP({ transitionStyle: v })} />
            </div>
            {/* #290 画布摘要档位：压缩=短别名 nN（更省更快，落地前确定性译回真实 id，失败自动
                回退全量 id 重试）；标准=真实 id（回退档，行为与短别名引入前一致）。 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }} title="发给助手的画布摘要编码方式">摘要</span>
              <MiniSelect value={quickPrefs.summaryMode} placeholder="压缩" maxWidth={168} accent={accent} accentSoft={accentSoft}
                title="压缩（推荐）：节点用短号 nN 表示，摘要更小、规划更快更省，系统落地前自动译回真实节点，异常时自动切全量 id 重试一次；标准：全程真实节点 id（与旧版行为一致的回退档）"
                groups={[{ options: [
                  { value: "compressed", label: "压缩（短号，推荐）" },
                  { value: "standard", label: "标准（全量 id）" },
                  { value: "full", label: "全量完整（最大最全，较慢较贵）", title: "不做任何存根/省略：字段截断放宽到 1000 字、摘要上限提高到 58000 字符——适合要求助手看到画布每一个字的场景；每轮更贵更慢" },
                ] }]} onChange={(v) => setQP({ summaryMode: v || "compressed" })} />
            </div>
            {secHead("模型与语种")}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }}>模型</span>
              <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>图</span>
              <MiniSelect value={quickPrefs.imageModel} placeholder="默认" maxWidth={128} accent={accent} accentSoft={accentSoft}
                title="指定图像生成模型（写入 image_gen/分镜关键帧；默认=助手自选）" groups={QP_IMAGE_MODEL_GROUPS} onChange={(v) => setQP({ imageModel: v })} />
              <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>视</span>
              <MiniSelect value={quickPrefs.videoProvider} placeholder="默认" maxWidth={128} accent={accent} accentSoft={accentSoft}
                title="指定视频生成模型（写入 video_task.provider；默认=助手自选）。每项 hover 可见参考图能力：纯文生模型（标🚫图）不吃任何参考图" groups={QP_VIDEO_MODEL_GROUPS} onChange={(v) => setQP({ videoProvider: v })} />
            </div>
            {/* #246 透明警告：锁定了纯文生模型时，依赖首帧图的能力全不生效——让用户当场权衡 */}
            {!!quickPrefs.videoProvider && maxRefImagesForProvider(quickPrefs.videoProvider) === 0 && (
              <div data-testid="qp-noimg-warn" style={{ fontSize: 10.5, lineHeight: 1.5, color: "oklch(0.68 0.14 65)", background: "oklch(0.68 0.14 65 / 0.08)", border: "1px solid oklch(0.68 0.14 65 / 0.25)", borderRadius: 8, padding: "5px 8px" }}>
                ⚠ 所选视频模型<b>不吃参考图（纯文生）</b>：「生图 → 再生视频」的首帧、角色定妆照参考、「链式下一镜」的尾帧衔接都不会生效。需要这些能力请换支持首帧图的模型（下拉各项已标注）。
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }} title="对白与最终提示词的书写语言；默认=跟随内容">语种</span>
              <span style={{ fontSize: 10.5, color: "var(--c-t4)", flexShrink: 0 }}>对白</span>
              <MiniSelect value={quickPrefs.dialogueLang} placeholder="默认" maxWidth={128} accent={accent} accentSoft={accentSoft}
                title="对白语种：对白/旁白/台词/字幕文本统一书写语言（画面提示词不受影响）；默认=跟随内容" groups={[{ options: [{ value: "", label: "默认（跟随内容）" }, ...QP_DIALOGUE_LANGS] }]} onChange={(v) => setQP({ dialogueLang: v })} />
              <span style={{ fontSize: 10.5, color: "var(--c-t4)", flexShrink: 0 }}>提示词</span>
              <MiniSelect value={quickPrefs.promptLang} placeholder="默认" maxWidth={128} accent={accent} accentSoft={accentSoft}
                title="最终提示词语种：喂给生成模型的画面提示词（image_gen.prompt / 分镜 promptText / 视频 prompt 等）统一书写语言；默认=助手按模型最佳实践（多数图/视模型英文提示更稳）" groups={[{ options: [{ value: "", label: "默认（按模型最佳实践）" }, ...QP_DIALOGUE_LANGS] }]} onChange={(v) => setQP({ promptLang: v })} />
            </div>
            {secHead("节点与模板")}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 32, fontSize: 11, color: "var(--c-t3)" }} title="勾选=只允许助手用这些生成节点；全不勾=不限。提示：未勾任何 ComfyUI 系时，规划会跳过模板库查询与注入（更快）——需要助手引用工作流模板时请勾选 ComfyUI模板">节点</span>
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
            {secHead("规划流程")}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5 }}>
              {([["imageFirst", "生图 → 再生视频", "每个镜头先生成一张首帧图，再图生视频——画面更可控、跨镜更一致。依赖视频模型支持首帧参考图：上方「视」下拉标注「🚫图」的纯文生模型不生效（会有警告提示）。"], ["noStoryboard", "排除分镜节点", "规划时不建 storyboard 分镜节点：镜头信息用 prompt 提示词节点承载（script → prompt → 生成节点）；违规创建会被直接拦截"], ["coalesceShots", "合并短镜（省次数）", "把连续、同场景且时长之和不超过所选视频模型单次上限（如 Grok 30s）的多个短镜头，合并为一个视频节点一次生成——减少生成次数、更省更快。仅合并画面连贯的镜头，遇转场/换场自动断开。会牺牲逐镜单独重生成的粒度。"], ["interactive", "交互式规划（逐步确认）", "复杂编排时开启：助手不再一次性出完整方案，而是分步提出决策点并给出编号选项（结构风格 → 镜头规格与模型 → 角色场景 → 确认落地），你点选项按钮或直接输入想法，一步步敲定后说「开始落地」才真正建节点。任意时刻说「不用问了直接做」立即按已确认信息落地。简单请求不受影响，仍然直接执行。"], ["fastChat", "简单问答免规划（更快）", "开启后：助手先用一次极短判断本轮是【闲聊/问答】还是【要动画布】——纯问答/闲聊直接短回答、跳过完整规划，简单问答快数倍、省一次大规划。判断偏保守：涉及做视频/加改节点一律走完整规划；带参考图时也走完整规划（行为与关掉时一致，不会更差）。"], ["streamEcho", "流式回显（本机 / Poyo）", "开启后：用本机 Claude/GPT 订阅桥接模型、或 Poyo 路由的云端模型（GPT-5.2、Claude Sonnet 4.5 等，官方 SSE 契约）规划时，生成中的文字实时回显在等待行下方——大计划等 1~5 分钟不再干等黑盒。Poyo 流式若网关异常会自动回退非流式重试，结果不受影响；kie 模型无官方流式契约，自动走原有非流式。关闭时全链路与现状一致。"]] as const).map(([k, label, tip]) => (
                <label key={k} title={tip || undefined} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", color: "var(--c-t2)" }}>
                  <input type="checkbox" checked={!!quickPrefs[k]} onChange={(e) => setQP({ [k]: e.target.checked })} style={{ accentColor: accent }} /> {label}
                </label>
              ))}
            </div>
            {secHead("自动增强")}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5 }}>
              {([["addMusic", "自动配乐", ""], ["addSubtitle", "自动字幕", ""], ["autoPortrait", "自动定妆照/场景图", "规划落地后，自动为本轮新建、还没有参考图的角色/场景节点按其描述生成主参考图：人物→「全身正面素背景」定妆照（3:4）、场景→空镜概念图（16:9）——运行工作流前即已锁脸/锁场景，无需逐个手动生成。生成期间节点顶部显示进度条。使用上方锁定的图像模型（未锁定则用系统默认），每个节点计一次生图费用。已有参考图的（如从库代入）自动跳过。"], ["anchorCompress", "外观锚点压缩（默认开）", "规划落地后，自动把本轮新建人物角色的外貌/服装/标志描述压缩成 15-30 字「外观锚点短语」写入角色卡——之后所有下游节点的提示词注入用「名字，身份，锚点」替代全量字段：省 token、跨镜头措辞恒定更利一致性。全量字段原样保留；在角色卡上可随时点小按钮切回未压缩的全量注入。每个角色一次极小的文本 LLM 调用；已有锚点的角色自动跳过。"], ["autoQc", "生成后自动质检（图像）", "助手创建的图像节点生成完成后，自动用视觉模型质检结果图（与提示词的符合度 / 肢体畸形 / 黑屏 / 乱码水印等硬伤）。质检未过时带修正意见自动重新生成一次（仅一次，防循环）。会额外产生一次视觉分析调用与可能的一次重生成费用。质检模型与图像节点「标记」功能共用（在节点标记面板可换）。"], ["useModelSkills", "模型技能（提示词技法）", "开启后：把「模型技能库」（管理后台 → 模型 → 技能库）中为最终使用模型维护的提示词技法注入规划参考，助手按该模型的官方技法撰写提示词与参数。当前对上方锁定的图像/视频模型生效（锁定=最终使用模型确定）；未锁定的类别、该模型无技能条目、或技能被停用时不注入。关闭时与现状完全一致，不注入任何内容。"], ["useComfyMemory", "使用 ComfyUI 记忆体", "规划时注入你 ComfyUI 服务器已学的资源（模型/LoRA/节点）与工程智能体成功过的工作流经验，让助手按真实可用资源规划。关掉则本次不注入。"], ["leanPrompt", "按对话类型精简提示词（实验）", "开启后：本轮消息是明确的生产指令（不含「怎么/在哪/什么」等疑问特征）时，规划提示词省略约 600 字的「应用操作答疑」段——更短更快更省；带任何疑问特征或拿不准时自动保留全量，答疑能力不受影响。关闭时提示词与现状逐字一致。kie 网关用户建议先开着跑一轮确认效果。"], ["selfCheck", "输出前自查清单（默认开）", "要求助手在输出规划 JSON 前逐项自查——payload 字段都在节点目录内、每条视频提示词含五要素且动作量匹配时长、硬约束逐条核对、连线引用真实存在。长计划的一次成功率更高（真机 A/B 实证：自查后主动补齐角色一致性管线），代价是每轮响应略慢。关闭后提示词恢复与旧版逐字一致。"]] as const).map(([k, label, tip]) => (
                <label key={k} title={tip || undefined} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", color: "var(--c-t2)" }}>
                  <input type="checkbox" checked={!!quickPrefs[k]} onChange={(e) => setQP({ [k]: e.target.checked })} style={{ accentColor: accent }} /> {label}
                </label>
              ))}
            </div>
          </div>
        );
      })()}

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 60, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {turns.length === 0 && (
          <div style={{ color: "var(--c-t3)", fontSize: 12, lineHeight: 1.7 }}>
            用自然语言直接指挥画布，例如：<br />
            · 「做一个橘猫晒太阳的竖屏短片，3 镜头」<br />
            · 「把 @小明 加进第 2 个分镜」<br />
            · 「把刚才那个视频节点画幅改成 9:16」<br />
            <span style={{ color: "var(--c-t4)" }}>先框选节点=只改选中项；建/连/改自动落地不花钱，运行生成仍需在节点上点运行。</span>
          </div>
        )}
        {/* #304 失败主动诊断建议卡：画布出现生成失败节点时自动亮起——一键让助手按
            error 根因修复（走正常规划-落地-可撤销流程），或忽略本批。 */}
        {activeFails.length > 0 && (
          <div className="nodrag" style={{ margin: "2px 0 4px", padding: "9px 11px", borderRadius: 11, fontSize: 11.5, lineHeight: 1.55,
            background: "oklch(0.55 0.18 25 / 0.10)", border: "1px solid oklch(0.62 0.18 25 / 0.45)", color: "oklch(0.80 0.10 25)" }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>⚠ 检测到 {activeFails.length} 个节点生成失败</div>
            <div
              title={activeFails.map((f) => `${f.title}：${f.error || "未知原因"}`).join("\n")}
              style={{ opacity: 0.9, cursor: "help", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {activeFails.slice(0, 3).map((f) => f.title).join("、")}{activeFails.length > 3 ? ` 等 ${activeFails.length} 个` : ""}（悬停看失败原因）
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
              <button
                disabled={busy}
                onClick={() => {
                  setFailDismissed((p) => new Set([...Array.from(p), ...activeFails.map(failKey)]));
                  void send("修复画布上所有失败的节点（按各节点 error 字段的根因做最小化修复；环境类问题修不了就说明原因，禁止删除重建节点）");
                }}
                style={{ padding: "4px 12px", fontSize: 11.5, fontWeight: 700, borderRadius: 8, cursor: busy ? "wait" : "pointer",
                  background: "oklch(0.55 0.18 25 / 0.25)", border: "1px solid oklch(0.65 0.18 25 / 0.6)", color: "oklch(0.85 0.10 25)" }}>
                {busy ? "处理中…" : "一键诊断修复"}
              </button>
              <button
                onClick={() => setFailDismissed((p) => new Set([...Array.from(p), ...activeFails.map(failKey)]))}
                style={{ padding: "4px 10px", fontSize: 11.5, borderRadius: 8, cursor: "pointer",
                  background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}>
                忽略
              </button>
            </div>
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
            {/* 交互式规划：最后一条助手消息里的编号选项渲染成快捷回复按钮，点击即发送。
                已落地（applied 非空）的回复不再渲染——落地说明里若含编号清单（如「已创建：1. …」）
                会被误解析成选项，误点「开始落地」还会再触发一轮规划。 */}
            {quickPrefs.interactive && t.role === "assistant" && !t.error && !t.applied && i === turns.length - 1 && !busy && (() => {
              const opts = t.content.split("\n")
                .map((l) => /^\s*([1-9])[.、．)]\s*(.{1,80})/.exec(l))
                .filter((m): m is RegExpExecArray => !!m)
                .slice(0, 6);
              if (opts.length < 2) return null;
              return (
                <div className="nodrag" style={{ display: "flex", flexWrap: "wrap", gap: 5, maxWidth: "88%" }}>
                  {opts.map((m) => (
                    <button key={m[1]} onClick={() => void send(`选 ${m[1]}：${m[2].trim()}`)}
                      style={{ fontSize: 11, padding: "3px 9px", borderRadius: 8, background: accentSoft, border: "1px solid oklch(0.70 0.20 310 / 0.35)", color: "var(--c-t1)", cursor: "pointer", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={`发送：选 ${m[1]}`}>
                      {m[1]}. {m[2].trim()}
                    </button>
                  ))}
                  <button onClick={() => void send("开始落地")}
                    style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 8, background: "oklch(0.72 0.18 155 / 0.14)", border: "1px solid oklch(0.72 0.18 155 / 0.4)", color: "oklch(0.72 0.18 155)", cursor: "pointer" }}
                    title="按当前共识直接生成节点">
                    ✓ 开始落地
                  </button>
                </div>
              );
            })()}
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
            <Loader2 size={13} className="animate-spin" /> {planStage || "正在规划并修改画布"}…
            <span style={{ color: "var(--c-t4)", fontSize: 11 }}>{planSec > 0 ? `已 ${planSec}s` : ""}{planSec > 60 ? "（本机模型大计划可能较久）" : ""}</span>
            <button onClick={cancelSend} title="取消本次规划"
              style={{ marginLeft: "auto", fontSize: 11, color: "var(--c-t3)", background: "none", border: "1px solid var(--c-bd2)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
              取消
            </button>
          </div>
        )}
        {/* #306 流式回显预览（仅本机桥接模型 + 快捷设置开关开时有内容）：生成中的原始文本
            实时滚动——大计划不再干等黑盒。规划轮是 JSON 草稿观感（属预期，标注「原始输出」），
            快问快答轮就是答案本身。最终仍以完成后的正式回复为准（与预览逐字同源）。 */}
        {busy && planPartial && (
          <div ref={partialRef} data-testid="stream-echo-preview" style={{ fontSize: 12, lineHeight: 1.65, color: "var(--c-t2)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 240, overflowY: "auto", background: "var(--c-surface)", border: "1px dashed var(--c-bd2)", borderRadius: 8, padding: "7px 10px" }}>
            <span style={{ color: "var(--c-t4)", fontSize: 10.5 }}>生成中 · 实时草稿（最终以完成后的回复为准）{"\n"}</span>
            {prettyPartial}
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
          {/* A2 视觉能力提示：本部署部分模型（Claude 系走 Poyo/Forge）不接受 image_url，
              带图时给出明确预期，避免「附了图却像没附」的困惑（服务端不做静默丢图，保持现状）。 */}
          {staged.some((f) => f.type.startsWith("image/")) && LLM_MODELS.find((m) => m.id === model)?.vision !== true && (
            <span style={{ fontSize: 10.5, color: "oklch(0.72 0.16 60)", alignSelf: "center" }}>当前模型不支持读图，图片附件可能被忽略（可换 GPT / Gemini 系视觉模型）</span>
          )}
        </div>
      )}

      {/* 拖拽调整「对话区 / 输入框」高度比例 */}
      <div onPointerDown={startComposerResize} title="拖动调整输入框与对话区高度比例"
        style={{ height: 9, flexShrink: 0, cursor: "ns-resize", touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center", borderTop: "1px solid var(--c-bd2)" }}>
        <div style={{ width: 34, height: 3, borderRadius: 2, background: "var(--c-bd3)" }} />
      </div>

      {/* input */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 10px 10px", flexShrink: 0 }}>
        <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.xls,.xlsx" style={{ display: "none" }}
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
        {/* #92 参考上传入口显性化：纯图标 📎 几乎没人注意到能传参考图——改带文字药丸，
            已附文件时描边点亮 + 显示数量。 */}
        <button onClick={() => fileInputRef.current?.click()} disabled={busy} title="附参考图 / 文档（据图规划画面·风格·角色；也可直接粘贴或拖拽图片到输入框）"
          style={{ display: "inline-flex", height: 38, padding: "0 10px", gap: 5, alignItems: "center", justifyContent: "center", borderRadius: 10, border: `1px solid ${staged.length ? accent : "var(--c-bd2)"}`, background: staged.length ? accentSoft : "var(--c-surface)", color: staged.length ? accent : "var(--c-t3)", cursor: busy ? "not-allowed" : "pointer", flexShrink: 0, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>
          <Paperclip size={15} />参考{staged.length > 0 ? ` ×${staged.length}` : ""}
        </button>
        {/* #305 语音口令：点击开始/停止，识别文本填入输入框（追加），用户确认后再发送。
            不支持的环境（无 Web Speech 且无 MediaRecorder）不渲染，布局零影响。 */}
        {voice.supported && (
          <button onClick={voice.toggle} disabled={voice.busy}
            title={voice.recording ? "停止语音输入" : voice.busy ? "识别中…" : "语音输入（说出画布指令，识别结果填入输入框，确认后发送）"}
            style={{ display: "inline-flex", width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, border: `1px solid ${voice.recording ? "#e5484d" : "var(--c-bd2)"}`, background: voice.recording ? "color-mix(in oklch, #e5484d 18%, transparent)" : "var(--c-surface)", color: voice.recording ? "#e5484d" : "var(--c-t3)", cursor: voice.busy ? "default" : "pointer", flexShrink: 0 }}>
            {voice.busy ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} className={voice.recording ? "animate-pulse" : undefined} />}
          </button>
        )}
        <textarea ref={composerRef} value={input} onChange={(e) => setInput(e.target.value)}
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
          style={{ flex: 1, resize: "none", padding: "9px 11px", borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t1)", fontSize: 13, outline: "none", fontFamily: "inherit",
            // 拖拽过手柄（composerH>0）→ 固定高度、内部滚动；否则默认单行起、随内容自动长
            // 高到 120（#92 上方 useLayoutEffect 实测 scrollHeight 驱动），超出内部滚动。
            ...(composerH > 0 ? { height: composerH, maxHeight: composerH, overflowY: "auto" as const } : { maxHeight: 120, overflowY: "auto" as const }) }} />
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
          ? <Loader2 size={canvasMode === "creative" ? 14 : 17} className="animate-spin" style={{ color: "white", position: "relative", zIndex: 1 }} />
          : <Sparkles size={canvasMode === "creative" ? 14 : 18} style={{ color: "white", position: "relative", zIndex: 1, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }} />}
        {/* #304 失败徽标：收起态也能看到「有节点失败待诊断」——展开即见建议卡 */}
        {activeFails.length > 0 && (
          <span
            title={`${activeFails.length} 个节点生成失败——点击展开助手查看诊断建议`}
            style={{ position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 8, zIndex: 2,
              background: "oklch(0.60 0.22 25)", color: "#fff", fontSize: 9.5, fontWeight: 700, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
              boxShadow: "0 0 0 2px oklch(0.20 0 0 / 0.55)" }}>
            {activeFails.length}
          </span>
        )}
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
