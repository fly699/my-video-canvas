import { useState, useRef } from "react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { snapshotContent } from "../../lib/scriptHistory";
import { mentionedCharacters } from "../../lib/characterConditioning";
import { NodeTextArea } from "./NodeTextInput";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  X, Loader2, Sparkles, Route, ClipboardCheck, Check, ChevronRight,
  Wand2, ListOrdered, Film, StickyNote, RefreshCw, Tv,
  Users, Eye, Clock, FileText, Lock,
} from "lucide-react";
import type { ScriptNodeData, ScriptBeat, ScriptCoverageReport, CoverageIssue } from "../../../../shared/types";

// 脚本节点的「侧向展开」面板（创作向导 / 专业审查）。
// 按用户交互要求：新功能不再向下堆叠拉长节点，而是横向弹出独立面板，
// 渲染在 BaseNode 的 leftDock 插槽（位于 overflow:hidden 之外，不被节点裁剪）。

const FLOW_ACCENT = "oklch(0.66 0.18 250)";   // 向导蓝
const COV_ACCENT = "oklch(0.68 0.20 295)";    // 审查紫

// ── 共用：侧向面板外壳 ─────────────────────────────────────────────────────────
export function SideShell({ title, icon, accent, onClose, children, width = 400 }: {
  title: string; icon: React.ReactNode; accent: string; onClose: () => void; children: React.ReactNode; width?: number;
}) {
  return (
    <div
      className="nodrag nowheel nopan"
      style={{
        position: "absolute", left: "calc(100% + 14px)", top: 0,
        width, maxHeight: 680, display: "flex", flexDirection: "column",
        background: "var(--c-base)", border: `1px solid ${accent}50`, borderRadius: 14,
        boxShadow: "0 18px 60px oklch(0 0 0 / 0.45)", zIndex: 30, overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", borderBottom: `1px solid ${accent}30`, background: `${accent}10`, flexShrink: 0 }}>
        <span style={{ color: accent, display: "inline-flex" }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--c-t1)", flex: 1 }}>{title}</span>
        <button onClick={onClose} className="nodrag" style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", padding: 2 }}>
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

/** 收集与脚本节点相连（任一方向）的角色/场景节点档案，拼成 Story Bible 约束文本。 */
function characterProfileLine(p: Record<string, string | undefined>): string | null {
  if ((p.characterKind ?? "person") === "scene") {
    const parts = [p.sceneName && `场景「${p.sceneName}」`, p.locationType, p.sceneDescription, p.atmosphere && `氛围：${p.atmosphere}`, p.timeOfDay && `时间：${p.timeOfDay}`].filter(Boolean);
    return parts.length ? `- ${parts.join("；")}` : null;
  }
  const parts = [p.name && `人物「${p.name}」`, p.role && `身份：${p.role}`, p.gender, p.age && `年龄：${p.age}`, p.appearance && `外貌：${p.appearance}`, p.outfit && `服装：${p.outfit}`, p.personality && `性格：${p.personality}`, p.signature && `标志特征：${p.signature}`].filter(Boolean);
  return parts.length ? `- ${parts.join("；")}` : null;
}

/**
 * 汇总角色档案约束文本，供向导每一步生成（logline/梗概/节拍表/剧本）注入，保证人物
 * 设定一致。来源合并：① 与脚本节点相连（任一方向）的角色/场景节点；② 文本里 @提及
 * 的角色（含未拖上画布的全局角色库影子节点）。`mentionText` 传 logline/梗概/节拍表
 * 等文本，让 @林晓 即使被 LLM 改写掉，其档案仍贯穿后续链路。去重按角色名。
 */
export function collectCharacterProfiles(scriptId: string, mentionText?: string): string {
  const { nodes, edges } = useCanvasStore.getState();
  const linked = new Set<string>();
  for (const e of edges) {
    if (e.source === scriptId) linked.add(e.target);
    if (e.target === scriptId) linked.add(e.source);
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  const add = (p: Record<string, string | undefined>) => {
    const key = (p.sceneName ?? p.name ?? "").trim();
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    const line = characterProfileLine(p);
    if (line) lines.push(line);
  };
  for (const n of nodes) {
    if (linked.has(n.id) && n.data.nodeType === "character") add(n.data.payload as Record<string, string | undefined>);
  }
  // @提及（含库影子）——mentionedCharacters 已合并全局角色库。
  for (const p of mentionedCharacters(mentionText ?? "", nodes as unknown as Parameters<typeof mentionedCharacters>[1])) {
    add(p as unknown as Record<string, string | undefined>);
  }
  return lines.join("\n").slice(0, 3000);
}

/** 与 collectCharacterProfiles 同源，但只返回去重后的角色/场景「名字」清单，
 *  用于「约束预览」明示本次生成会带入哪些人物档案（解决约束隐形）。 */
export function collectCharacterNames(scriptId: string, mentionText?: string): string[] {
  const { nodes, edges } = useCanvasStore.getState();
  const linked = new Set<string>();
  for (const e of edges) {
    if (e.source === scriptId) linked.add(e.target);
    if (e.target === scriptId) linked.add(e.source);
  }
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (p: Record<string, string | undefined>) => {
    const key = (p.sceneName ?? p.name ?? "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(key);
  };
  for (const n of nodes) {
    if (linked.has(n.id) && n.data.nodeType === "character") add(n.data.payload as Record<string, string | undefined>);
  }
  for (const p of mentionedCharacters(mentionText ?? "", nodes as unknown as Parameters<typeof mentionedCharacters>[1])) {
    add(p as unknown as Record<string, string | undefined>);
  }
  return names;
}

const beatSheetToText = (beats: ScriptBeat[]): string =>
  beats.map((b) => `${b.index}. ${b.title}${b.duration ? `（约${b.duration}s）` : ""}：${b.summary}`).join("\n").slice(0, 4000);

// ── 小组件 ───────────────────────────────────────────────────────────────────
/** 可折叠步骤区块（二级展开）：收起时只占一行（编号 + 标题 + 状态摘要），点标题
 *  展开详情——解决五个步骤全部平铺导致面板拥挤。flexShrink:0 防止滚动容器压缩区块。 */
function Stage({ idx, title, done, summary, open, onToggle, refCb, children }: {
  idx: number; title: string; done: boolean; summary: string;
  open: boolean; onToggle: () => void; refCb: (el: HTMLDivElement | null) => void; children: React.ReactNode;
}) {
  return (
    <div ref={refCb} style={{
      border: `1px solid ${open ? `${FLOW_ACCENT}40` : "var(--c-bd1)"}`, borderRadius: 10,
      background: open ? "transparent" : "var(--c-surface)", flexShrink: 0,
    }}>
      <button onClick={onToggle} aria-expanded={open} title={`${title} · ${open ? "点击收起" : "点击展开"}`}
        className="nodrag flex items-center gap-2 w-full text-left"
        style={{ padding: "9px 11px", background: "none", border: "none", cursor: "pointer", minWidth: 0 }}>
        <span style={{
          width: 20, height: 20, borderRadius: "50%", flexShrink: 0, fontSize: 10.5, fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: done ? FLOW_ACCENT : "var(--c-bd1)", color: done ? "#fff" : "var(--c-t3)",
        }}>{done ? <Check style={{ width: 12, height: 12 }} /> : idx + 1}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-t1)", flexShrink: 0 }}>{title}</span>
        <span style={{ fontSize: 10, color: "var(--c-t4)", flex: 1, minWidth: 0, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>
        <ChevronRight style={{ width: 12, height: 12, flexShrink: 0, color: "var(--c-t4)", transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms" }} />
      </button>
      {open && <div className="flex flex-col" style={{ gap: 8, padding: "0 11px 11px" }}>{children}</div>}
    </div>
  );
}

/** 顶部步骤进度导航：圆点显示每步完成态，点击跳转到对应区块（解决「流程不直观」）。
 *  current 高亮当前应做的步骤（首个未完成步）。 */
function StepNav({ steps, current, onJump }: {
  steps: { label: string; done: boolean }[]; current: number; onJump: (i: number) => void;
}) {
  return (
    <div className="flex items-stretch" style={{ gap: 2, padding: "2px 0 4px", flexShrink: 0 }}>
      {steps.map((s, i) => {
        const active = i === current;
        return (
          <button key={i} onClick={() => onJump(i)} title={s.label}
            className="nodrag flex flex-col items-center gap-1"
            style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}>
            <div className="flex items-center w-full">
              <div style={{ flex: 1, height: 2, background: i === 0 ? "transparent" : (steps[i - 1].done ? FLOW_ACCENT : "var(--c-bd1)") }} />
              <span style={{
                width: 20, height: 20, borderRadius: "50%", flexShrink: 0, fontSize: 10.5, fontWeight: 800,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: s.done ? FLOW_ACCENT : active ? `${FLOW_ACCENT}22` : "var(--c-bd1)",
                color: s.done ? "#fff" : active ? FLOW_ACCENT : "var(--c-t3)",
                border: active && !s.done ? `1.5px solid ${FLOW_ACCENT}` : "none",
              }}>{s.done ? <Check style={{ width: 11, height: 11 }} /> : i + 1}</span>
              <div style={{ flex: 1, height: 2, background: i === steps.length - 1 ? "transparent" : (s.done ? FLOW_ACCENT : "var(--c-bd1)") }} />
            </div>
            <span style={{ fontSize: 9.5, lineHeight: 1.2, color: active ? FLOW_ACCENT : "var(--c-t4)", fontWeight: active ? 700 : 500, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 通用「选项胶囊」（结构 / 风格 / 时长策略 等可调创作方向）。 */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="nodrag px-2 py-1 rounded-md transition-all"
      style={{ fontSize: 10.5, fontWeight: active ? 700 : 500, background: active ? `${FLOW_ACCENT}18` : "var(--c-surface)", border: `1px solid ${active ? `${FLOW_ACCENT}50` : "var(--c-bd2)"}`, color: active ? FLOW_ACCENT : "var(--c-t3)", cursor: "pointer", whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

function ActionBtn({ onClick, pending, disabled, disabledHint, pendingLabel, icon, children, accent = FLOW_ACCENT }: {
  onClick: () => void; pending?: boolean; disabled?: boolean; disabledHint?: string; pendingLabel?: string;
  icon?: React.ReactNode; children: React.ReactNode; accent?: string;
}) {
  const off = pending || disabled;
  // 关键：区分「生成中」（转圈 + 进行文案）与「禁用」（斜纹 + 缺前置条件提示），
  // 用户一眼分清是在跑还是缺东西（解决「灰按钮分不清原因」）。
  const blocked = disabled && !pending;
  return (
    <div className="flex flex-col gap-1">
      <button onClick={onClick} disabled={off} className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg transition-all"
        style={{
          fontSize: 11.5, fontWeight: 600,
          background: pending ? `${accent}0e` : blocked ? "var(--c-surface)" : `${accent}16`,
          border: `1px solid ${off ? (blocked ? "var(--c-bd2)" : `${accent}30`) : `${accent}45`}`,
          color: pending ? accent : blocked ? "var(--c-t4)" : accent,
          cursor: pending ? "wait" : blocked ? "not-allowed" : "pointer",
          backgroundImage: blocked ? "repeating-linear-gradient(45deg, transparent, transparent 5px, var(--c-bd1) 5px, var(--c-bd1) 6px)" : "none",
        }}>
        {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : (icon ?? <Sparkles className="w-3 h-3" />)}
        {pending ? (pendingLabel ?? "生成中…") : children}
      </button>
      {blocked && disabledHint && (
        <span className="flex items-center justify-center gap-1" style={{ fontSize: 10, color: "var(--c-t4)" }}>
          <Lock style={{ width: 10, height: 10 }} /> {disabledHint}
        </span>
      )}
    </div>
  );
}

const taStyle: React.CSSProperties = {
  width: "100%", fontSize: 11.5, lineHeight: 1.55, padding: "7px 9px", borderRadius: 8,
  background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)",
  outline: "none", resize: "vertical", fontFamily: "inherit",
};

// ── 创作向导（开发阶段流：想法 → Logline → 梗概 → 节拍表 → 剧本 → 分镜）────────
const BEAT_STRUCTURES = [
  { id: "three_act", label: "经典三幕" },
  { id: "save_the_cat", label: "Save the Cat 15拍" },
  { id: "heros_journey", label: "英雄之旅" },
  { id: "short_drama", label: "短剧 钩子-反转-爽点" },
  { id: "documentary", label: "纪录片" },
] as const;

const SYN_STYLES = [
  { id: "", label: "默认", hint: "" },
  { id: "epic", label: "史诗宏大", hint: "格局宏大、史诗感与命运感" },
  { id: "warm", label: "温暖治愈", hint: "温暖、细腻、治愈系情感" },
  { id: "noir", label: "悬疑黑色", hint: "悬疑、黑色电影、紧张压抑" },
  { id: "punchy", label: "爽快直给", hint: "强冲突、快节奏、爽点密集" },
] as const;
const DURATION_MODES = [
  { id: "weighted", label: "重场优先" },
  { id: "even", label: "均等" },
  { id: "hook_front", label: "钩子前置" },
] as const;

export function ScriptDevFlowPanel({ id, payload, llmModel, fullGenPending, storyboardsPending, onGenerateScript, onGenerateStoryboards, onOpenCoverage, onClose }: {
  id: string;
  payload: ScriptNodeData;
  llmModel: string;
  fullGenPending: boolean;
  storyboardsPending: boolean;
  onGenerateScript: (extra: { beatSheetText?: string; characterProfiles?: string; scriptOnly?: boolean }) => void;
  onGenerateStoryboards: () => void;
  /** 切换到「专业审查」面板（向导↔审查闭环：剧本生成后建议先审查再拆分镜）。 */
  onOpenCoverage?: () => void;
  onClose: () => void;
}) {
  const { updateNodeData } = useCanvasStore();
  const [loglineCands, setLoglineCands] = useState<string[]>([]);
  const [structure, setStructure] = useState<string>(payload.beatStructure ?? "three_act");
  const [durationMode, setDurationMode] = useState<"weighted" | "even" | "hook_front">("weighted");
  const [synStyle, setSynStyle] = useState<string>("");
  const [customIntent, setCustomIntent] = useState("");
  const [genMode, setGenMode] = useState<"scriptOnly" | "both">("scriptOnly");
  const [showConstraints, setShowConstraints] = useState(false);
  const [profileDraft, setProfileDraft] = useState<string | null>(null);
  const [epCount, setEpCount] = useState(12);
  // 分集大纲整块默认收起（可选功能，不挤占主流程空间）。
  const [epOpen, setEpOpen] = useState(false);
  // 手风琴展开：null = 跟随「当前应做步骤」自动展开；用户点过则记住其选择（-1 = 全收起）。
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // 步骤区块的 DOM 引用——顶部进度导航点击即展开并平滑滚动到对应步骤。
  const stageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const jump = (i: number) => {
    setOpenIdx(i);
    // 等展开后的布局生效再滚动，否则目标位置不准。
    setTimeout(() => stageRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };

  const loglineMut = trpc.scripts.generateLogline.useMutation({
    onSuccess: (r) => { setLoglineCands(r.loglines); toast.success("已生成 3 个 logline 候选，点击选用"); },
    onError: (e) => toast.error("Logline 生成失败：" + e.message),
  });
  const synopsisMut = trpc.scripts.refineScene.useMutation({
    onSuccess: (r) => { updateNodeData(id, { synopsis: r.result }); toast.success("梗概已扩写"); },
    onError: (e) => toast.error("梗概扩写失败：" + e.message),
  });
  const beatsMut = trpc.scripts.generateBeatSheet.useMutation({
    onSuccess: (r) => { updateNodeData(id, { beatSheet: r.beats, beatStructure: structure }); toast.success(`节拍表已生成（${r.beats.length} 拍）`); },
    onError: (e) => toast.error("节拍表生成失败：" + e.message),
  });
  const episodesMut = trpc.scripts.generateEpisodeOutline.useMutation({
    onSuccess: (r) => { updateNodeData(id, { episodeOutline: r.episodes }); setEpOpen(true); toast.success(`分集大纲已生成（${r.episodes.length} 集）`); },
    onError: (e) => toast.error("分集大纲生成失败：" + e.message),
  });

  const idea = (payload.synopsis ?? "").trim();
  const logline = (payload.logline ?? "").trim();
  const beats = payload.beatSheet ?? [];
  const episodes = payload.episodeOutline ?? [];
  const hasScript = !!payload.content?.trim();
  const source = [logline && `Logline：${logline}`, idea && `梗概：${idea}`].filter(Boolean).join("\n");
  // 角色档案 = 连线角色 ∪ 文本 @提及角色（含库影子）。把当前所有阶段文本喂进 @解析，
  // 这样即使 LLM 把 @林晓 改写掉，林晓的设定仍贯穿 logline/梗概/节拍表/剧本/分镜。
  const mentionText = [logline, idea, beats.map((b) => `${b.title} ${b.summary}`).join(" ")].filter(Boolean).join("\n");
  const autoProfiles = collectCharacterProfiles(id, mentionText);
  const charNames = collectCharacterNames(id, mentionText);
  // 用户在「约束预览」里临时改过则用草稿，否则用自动收集——贯穿所有步骤生成。
  const effProfiles = ((profileDraft?.trim() || autoProfiles) || undefined);

  // 已连接/已生成的分镜节点（用于「⑤ 分镜」完成态与步骤导航）。
  const hasStoryboards = (() => {
    const { nodes, edges } = useCanvasStore.getState();
    const outs = new Set(edges.filter((e) => e.source === id).map((e) => e.target));
    return nodes.some((n) => outs.has(n.id) && (n.data.nodeType === "storyboard" || n.data.nodeType === "comfyui_image"));
  })();

  const beatsTotal = beats.reduce((s, b) => s + (b.duration ?? 0), 0);
  const targetDur = payload.totalDuration ?? 60;
  const durOff = beatsTotal > 0 ? Math.abs(beatsTotal - targetDur) / targetDur : 0;

  const synHint = SYN_STYLES.find((s) => s.id === synStyle)?.hint;
  const synIntent = [
    "把这个故事扩写为 300-500 字的故事梗概：现在时态，按三幕走向（建置/对抗/结局）交代主角、冲突升级与结局方向，具体可拍，不要抽象套话",
    synHint && `风格基调：${synHint}`,
    customIntent.trim() && `额外要求：${customIntent.trim()}`,
  ].filter(Boolean).join("。");

  const steps = [
    { label: "Logline", done: !!logline },
    { label: "梗概", done: idea.length >= 60 },
    { label: "节拍表", done: beats.length > 0 },
    { label: "剧本", done: hasScript },
    { label: "分镜", done: hasStoryboards },
  ];
  const current = (() => { const i = steps.findIndex((s) => !s.done); return i === -1 ? steps.length - 1 : i; })();
  // 实际展开的步骤：用户没点过时跟随当前步（完成一步自动推进到下一步）。
  const effOpen = openIdx ?? current;
  const toggle = (i: number) => setOpenIdx(effOpen === i ? -1 : i);

  const updateBeat = (i: number, patch: Partial<ScriptBeat>) => {
    const next = beats.map((b, j) => (j === i ? { ...b, ...patch } : b));
    updateNodeData(id, { beatSheet: next });
  };
  const setRef = (i: number) => (el: HTMLDivElement | null) => { stageRefs.current[i] = el; };

  return (
    <SideShell title="创作向导 · 想法 → 成片剧本" icon={<Route style={{ width: 14, height: 14 }} />} accent={FLOW_ACCENT} onClose={onClose} width={444}>
      <StepNav steps={steps} current={current} onJump={jump} />
      <p style={{ fontSize: 10.5, color: "var(--c-t3)", lineHeight: 1.6, flexShrink: 0 }}>
        逐阶段推进，每步产物可编辑、可重生成、可跳过。默认只展开当前步骤；点步骤标题或上方圆点展开任意一步。
      </p>

      {/* ① Logline */}
      <Stage idx={0} title="一句话故事（Logline）" done={!!logline} summary={logline || "未填写"}
        open={effOpen === 0} onToggle={() => toggle(0)} refCb={setRef(0)}>
        {/* NodeTextArea：自带 @角色/场景 自动补全（与脚本/分镜输入一致） */}
        <NodeTextArea className="nodrag" rows={2} style={taStyle} placeholder="25-35 字：主角 + 冲突 + 赌注。可手写、可 @角色，或由下方按钮从梗概/想法提炼"
          value={payload.logline ?? ""} onValueChange={(v) => updateNodeData(id, { logline: v })} />
        <ActionBtn pending={loglineMut.isPending} disabled={!idea && !logline} disabledHint="先写梗概或 Logline" pendingLabel="提炼候选中…"
          onClick={() => loglineMut.mutate({ idea: idea || logline, genre: payload.aiGenre, characterProfiles: effProfiles, model: llmModel })}>
          从想法/梗概提炼 3 个候选
        </ActionBtn>
        {loglineCands.length > 0 && (
          <div className="flex flex-col gap-1">
            {loglineCands.map((l, i) => (
              <button key={i} onClick={() => { updateNodeData(id, { logline: l }); setLoglineCands([]); toast.success("已选用该 Logline"); }}
                className="nodrag text-left px-2 py-1.5 rounded-lg transition-all"
                style={{ fontSize: 11, lineHeight: 1.5, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
                {l}
              </button>
            ))}
          </div>
        )}
      </Stage>

      {/* ② 梗概 */}
      <Stage idx={1} title="故事梗概（300-500 字）" done={idea.length >= 60} summary={idea ? `${idea.length} 字` : "未填写"}
        open={effOpen === 1} onToggle={() => toggle(1)} refCb={setRef(1)}>
        {/* 与节点顶部「故事梗概」框共用同一字段（payload.synopsis）——生成/编辑双向同步，
            不用回首页找；支持 @角色 自动补全。「生成剧本」读取的就是这里的内容。 */}
        <NodeTextArea className="nodrag" rows={5} style={taStyle}
          placeholder="300-500 字故事梗概（与节点顶部「故事梗概」框同步；可 @角色）"
          value={payload.synopsis ?? ""} onValueChange={(v) => updateNodeData(id, { synopsis: v })} />
        <p style={{ fontSize: 10, color: "var(--c-t4)", lineHeight: 1.5 }}>与节点顶部「故事梗概」框实时同步（同一字段）；「生成剧本」直接取此内容。</p>
        {/* 可调创作方向：风格基调 + 自定义意图（解决「扩写方向黑盒」） */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span style={{ fontSize: 10, color: "var(--c-t4)", flexShrink: 0 }}>风格</span>
          {SYN_STYLES.map((s) => <Chip key={s.id} active={synStyle === s.id} onClick={() => setSynStyle(s.id)}>{s.label}</Chip>)}
        </div>
        <input className="nodrag" value={customIntent} onChange={(e) => setCustomIntent(e.target.value)}
          placeholder="自定义要求（可选）：如「结局留开放式」「突出母女关系」"
          style={{ width: "100%", fontSize: 11, padding: "6px 9px", borderRadius: 7, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
        <ActionBtn pending={synopsisMut.isPending} disabled={!logline && !idea} disabledHint="先写 Logline 或梗概" pendingLabel="扩写梗概中…"
          onClick={() => synopsisMut.mutate({ sceneText: (logline || idea).slice(0, 2000), intent: synIntent, characterProfiles: effProfiles, model: llmModel })}>
          {idea ? "按当前风格重写梗概" : "由 Logline 扩写梗概"}
        </ActionBtn>
      </Stage>

      {/* ③ 节拍表 */}
      <Stage idx={2} title="节拍表（Beat Sheet）" done={beats.length > 0} summary={beats.length ? `${beats.length} 拍 · 共 ${beatsTotal}s` : "未生成"}
        open={effOpen === 2} onToggle={() => toggle(2)} refCb={setRef(2)}>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span style={{ fontSize: 10, color: "var(--c-t4)", flexShrink: 0 }}>结构</span>
          {BEAT_STRUCTURES.map((s) => <Chip key={s.id} active={structure === s.id} onClick={() => setStructure(s.id)}>{s.label}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span style={{ fontSize: 10, color: "var(--c-t4)", flexShrink: 0 }}>时长分配</span>
          {DURATION_MODES.map((m) => <Chip key={m.id} active={durationMode === m.id} onClick={() => setDurationMode(m.id)}>{m.label}</Chip>)}
        </div>
        <ActionBtn pending={beatsMut.isPending} disabled={!source} disabledHint="先写 Logline 或梗概" pendingLabel="生成节拍表中…"
          onClick={() => beatsMut.mutate({ source, structure: structure as "three_act", totalDuration: targetDur, genre: payload.aiGenre, mood: payload.aiMood, characterProfiles: effProfiles, durationMode, model: llmModel })}>
          {beats.length ? "重新生成节拍表" : "生成节拍表"}
        </ActionBtn>
        {beats.length > 0 && (
          <>
            {/* 实际总时长 vs 目标对比（解决「时长分配看不见」） */}
            <div className="flex items-center gap-1.5" style={{ fontSize: 10.5 }}>
              <Clock style={{ width: 11, height: 11, color: "var(--c-t4)" }} />
              <span style={{ color: "var(--c-t3)" }}>实际 {beatsTotal}s / 目标 {targetDur}s</span>
              <span style={{ marginLeft: "auto", fontWeight: 700, color: durOff > 0.25 ? "oklch(0.75 0.16 75)" : "oklch(0.70 0.16 150)" }}>
                {durOff > 0.25 ? `偏差 ${Math.round(durOff * 100)}%，可重生成或手动调` : "时长匹配"}
              </span>
            </div>
            <div className="flex flex-col gap-1.5" style={{ maxHeight: 240, overflowY: "auto" }}>
              {beats.map((b, i) => (
                <div key={i} className="px-2 py-1.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)", flexShrink: 0 }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span style={{ fontSize: 10, fontWeight: 800, color: FLOW_ACCENT }}>{b.index}</span>
                    <input className="nodrag" value={b.title} onChange={(e) => updateBeat(i, { title: e.target.value })}
                      style={{ flex: 1, fontSize: 11, fontWeight: 700, background: "transparent", border: "none", outline: "none", color: "var(--c-t1)" }} />
                    {/* 每拍时长可直接微调（解决「只能看不能改时长」） */}
                    <input className="nodrag" type="number" min={1} value={b.duration ?? ""} onChange={(e) => updateBeat(i, { duration: Math.max(1, Number(e.target.value) || 1) })}
                      style={{ width: 42, fontSize: 10, textAlign: "right", background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 5, outline: "none", color: "var(--c-t3)", padding: "1px 3px" }} />
                    <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>s</span>
                  </div>
                  <NodeTextArea className="nodrag" rows={2} value={b.summary} onValueChange={(v) => updateBeat(i, { summary: v })}
                    style={{ ...taStyle, fontSize: 10.5, padding: "4px 6px" }} />
                </div>
              ))}
            </div>
          </>
        )}
      </Stage>

      {/* ④ 剧本（分两步：先「仅剧本」审视，或一步「剧本 + 分镜」） */}
      <Stage idx={3} title="生成完整剧本" done={hasScript}
        summary={hasScript ? (payload.coverage ? `已生成 · 上次审查 ${payload.coverage.overall} 分` : "已生成") : "未生成"}
        open={effOpen === 3} onToggle={() => toggle(3)} refCb={setRef(3)}>
        {/* 约束预览（生成剧本前明示将带入的节拍表 + 角色档案，可临时编辑）——解决「约束隐形」 */}
        <button onClick={() => setShowConstraints((v) => !v)} aria-expanded={showConstraints}
          title={`约束预览 · ${showConstraints ? "点击收起" : "点击展开"}`} className="nodrag flex items-center gap-1.5"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
          <Eye style={{ width: 12, height: 12, color: FLOW_ACCENT, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t1)" }}>约束预览</span>
          <span style={{ fontSize: 10, color: "var(--c-t4)" }}>
            {beats.length ? `${beats.length} 拍` : "无节拍表"} · 角色 {charNames.length}{profileDraft != null ? "（已改）" : ""}
          </span>
          <ChevronRight style={{ width: 11, height: 11, marginLeft: "auto", color: "var(--c-t4)", transform: showConstraints ? "rotate(90deg)" : "none", transition: "transform 150ms" }} />
        </button>
        {showConstraints && (
          <div className="flex flex-col gap-1.5 px-2 py-2 rounded-lg" style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}>
            <div className="flex items-start gap-1.5" style={{ fontSize: 10, color: "var(--c-t3)", lineHeight: 1.5 }}>
              <ListOrdered style={{ width: 11, height: 11, marginTop: 1, flexShrink: 0, color: FLOW_ACCENT }} />
              <span>节拍表：{beats.length ? `${beats.length} 拍，剧本将逐拍展开并按拍点时长占比分配镜头` : "无——剧本不受结构约束，可先去③生成"}</span>
            </div>
            <div className="flex items-start gap-1.5" style={{ fontSize: 10, color: "var(--c-t3)", lineHeight: 1.5 }}>
              <Users style={{ width: 11, height: 11, marginTop: 1, flexShrink: 0, color: FLOW_ACCENT }} />
              <span>角色档案（{charNames.length}）：{charNames.length ? charNames.join("、") : "无——连线角色节点或在文本里 @角色 即可带入"}</span>
            </div>
            {/* 可见可编辑：用户可临时覆盖角色档案约束文本，再生成剧本/节拍表/梗概 */}
            <NodeTextArea className="nodrag" rows={4} style={{ ...taStyle, fontSize: 10 }}
              placeholder="角色档案约束（留空=自动收集）。在此临时编辑会覆盖自动收集，贯穿后续所有生成。"
              value={profileDraft ?? autoProfiles} onValueChange={(v) => setProfileDraft(v)} />
            {profileDraft != null && (
              <button onClick={() => setProfileDraft(null)} className="nodrag flex items-center justify-center gap-1"
                style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "var(--c-base)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
                <RefreshCw style={{ width: 10, height: 10 }} /> 恢复自动收集
              </button>
            )}
          </div>
        )}
        <div className="flex gap-1.5">
          {([["scriptOnly", "仅剧本（先审视）"], ["both", "剧本 + 分镜"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setGenMode(v)} className="nodrag flex-1 py-1.5 rounded-md transition-all"
              style={{ fontSize: 10.5, fontWeight: genMode === v ? 700 : 500, background: genMode === v ? `${FLOW_ACCENT}18` : "var(--c-surface)", border: `1px solid ${genMode === v ? `${FLOW_ACCENT}50` : "var(--c-bd2)"}`, color: genMode === v ? FLOW_ACCENT : "var(--c-t3)", cursor: "pointer", whiteSpace: "nowrap" }}>
              {label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 10, color: "var(--c-t4)", lineHeight: 1.5 }}>
          将注入：{beats.length ? "✓ 节拍表" : "✗ 无节拍表"} · {charNames.length ? `✓ 角色档案(${charNames.length})` : "✗ 无角色"}
          {genMode === "scriptOnly" ? " — 先出剧本，审视/编辑后再到 ⑤ 拆分镜" : " — 一步生成剧本并自动拆分镜"}
        </p>
        <ActionBtn pending={fullGenPending} disabled={!idea && !logline} disabledHint="先写梗概或 Logline" icon={<FileText className="w-3 h-3" />}
          pendingLabel={genMode === "both" ? "生成剧本 + 拆分镜中…" : "生成剧本中…"}
          onClick={() => onGenerateScript({
            beatSheetText: beats.length ? beatSheetToText(beats) : undefined,
            characterProfiles: effProfiles, // 连线 ∪ @提及（含库影子），或约束预览里的临时覆盖
            scriptOnly: genMode === "scriptOnly",
          })}>
          生成剧本{beats.length ? "（按节拍表）" : ""}{genMode === "both" ? " + 分镜" : ""}
        </ActionBtn>
        {/* 向导↔审查闭环：剧本就绪且还没拆分镜时，建议先专业审查（六维评分+一键修复）再拆 */}
        {hasScript && !hasStoryboards && onOpenCoverage && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg" style={{ background: `${COV_ACCENT}0e`, border: `1px solid ${COV_ACCENT}35` }}>
            <ClipboardCheck style={{ width: 11, height: 11, flexShrink: 0, color: COV_ACCENT }} />
            <span style={{ fontSize: 10, color: "var(--c-t3)", flex: 1, lineHeight: 1.4 }}>
              剧本已生成{payload.coverage ? `（上次审查 ${payload.coverage.overall} 分）` : ""}——建议先专业审查再拆分镜
            </span>
            <button onClick={onOpenCoverage} className="nodrag flex-shrink-0 px-2 py-1 rounded-md"
              style={{ fontSize: 10, fontWeight: 700, background: `${COV_ACCENT}16`, border: `1px solid ${COV_ACCENT}45`, color: COV_ACCENT, cursor: "pointer" }}>
              去审查
            </button>
          </div>
        )}
      </Stage>

      {/* ⑤ 分镜 */}
      <Stage idx={4} title="从剧本拆分镜节点" done={hasStoryboards}
        summary={hasStoryboards ? "已生成分镜" : hasScript ? "待拆分" : "需先生成剧本"}
        open={effOpen === 4} onToggle={() => toggle(4)} refCb={setRef(4)}>
        <ActionBtn pending={storyboardsPending} disabled={!hasScript} disabledHint="先生成剧本（④）" icon={<Film className="w-3 h-3" />} pendingLabel="拆分镜中…"
          onClick={onGenerateStoryboards}>
          AI 生成分镜节点
        </ActionBtn>
      </Stage>

      {/* 可选：短剧分集大纲——独立可折叠区块，默认收起，不挤占主流程空间 */}
      <div style={{ border: "1px solid var(--c-bd1)", borderRadius: 10, background: epOpen ? "transparent" : "var(--c-surface)", flexShrink: 0 }}>
        <button onClick={() => setEpOpen((v) => !v)} aria-expanded={epOpen}
          title={`短剧分集大纲 · ${epOpen ? "点击收起" : "点击展开"}`} className="nodrag flex items-center gap-2 w-full text-left"
          style={{ padding: "9px 11px", background: "none", border: "none", cursor: "pointer" }}>
          <Tv style={{ width: 13, height: 13, color: FLOW_ACCENT, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-t1)" }}>短剧分集大纲（可选）</span>
          <span style={{ fontSize: 10, color: "var(--c-t4)", flex: 1, textAlign: "right" }}>{episodes.length ? `${episodes.length} 集` : "未生成"}</span>
          <ChevronRight style={{ width: 12, height: 12, flexShrink: 0, color: "var(--c-t4)", transform: epOpen ? "rotate(90deg)" : "none", transition: "transform 150ms" }} />
        </button>
        {epOpen && (
          <div className="flex flex-col" style={{ gap: 8, padding: "0 11px 11px" }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 10.5, color: "var(--c-t3)", flex: 1 }}>集数</span>
              <input className="nodrag" type="number" min={4} max={100} value={epCount}
                onChange={(e) => setEpCount(Math.max(4, Math.min(100, Number(e.target.value) || 12)))}
                style={{ width: 52, fontSize: 11, padding: "3px 6px", borderRadius: 6, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
              <span style={{ fontSize: 10, color: "var(--c-t4)" }}>集</span>
            </div>
            <ActionBtn pending={episodesMut.isPending} disabled={!source} disabledHint="先写 Logline 或梗概"
              onClick={() => episodesMut.mutate({ source, episodeCount: epCount, model: llmModel })}>
              生成分集大纲（每集钩子 + 卡点）
            </ActionBtn>
            {episodes.length > 0 && (
              <>
                <div className="flex flex-col gap-1" style={{ maxHeight: 220, overflowY: "auto" }}>
                  {episodes.map((ep) => (
                    <div key={ep.episode} className="px-2 py-1.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)", flexShrink: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t1)" }}>第{ep.episode}集 · {ep.title}</div>
                      <div style={{ fontSize: 10, color: "var(--c-t3)", lineHeight: 1.5 }}>钩子：{ep.hook}</div>
                      <div style={{ fontSize: 10, color: "var(--c-t2)", lineHeight: 1.5 }}>{ep.summary}</div>
                      <div style={{ fontSize: 10, color: FLOW_ACCENT, lineHeight: 1.5 }}>卡点：{ep.cliffhanger}</div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    const md = episodes.map((ep) => `第${ep.episode}集 ${ep.title}\n钩子：${ep.hook}\n剧情:${ep.summary}\n卡点：${ep.cliffhanger}`).join("\n\n");
                    void navigator.clipboard?.writeText(md).then(() => toast.success("分集大纲已复制"));
                  }}
                  className="nodrag" style={{ fontSize: 10.5, padding: "5px 8px", borderRadius: 7, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
                  复制全部大纲
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </SideShell>
  );
}

// ── 专业审查（Coverage：六维评分 + 裁决 + 闭环修复 + 存便签）────────────────────
const DIM_LABELS: Record<string, string> = {
  premise: "创意前提", structure: "结构", characters: "人物", dialogue: "对白", pacing: "节奏", visual: "视觉可实现",
};
const VERDICTS: Record<ScriptCoverageReport["verdict"], { label: string; color: string }> = {
  recommend: { label: "推荐 Recommend", color: "oklch(0.70 0.18 150)" },
  consider: { label: "修改后可用 Consider", color: "oklch(0.75 0.16 75)" },
  pass: { label: "不推荐 Pass", color: "oklch(0.62 0.20 25)" },
};
const SEV_COLORS: Record<string, string> = { high: "oklch(0.62 0.20 25)", medium: "oklch(0.75 0.16 75)", low: "oklch(0.65 0.05 250)" };

export function ScriptCoveragePanel({ id, payload, llmModel, onClose }: {
  id: string; payload: ScriptNodeData; llmModel: string; onClose: () => void;
}) {
  const { updateNodeData } = useCanvasStore();
  const [fixingIdx, setFixingIdx] = useState<number | null>(null);
  const report = payload.coverage;
  // 复审差值基线：每次发起审查前记录当前分数（同一面板会话内 首审→修复→复审 也能显示 ±）。
  const [prevOverall, setPrevOverall] = useState<number | null>(null);
  const shortDrama = /短剧|短视频/.test(payload.aiGenre ?? "") || payload.beatStructure === "short_drama";

  const covMut = trpc.scripts.scriptCoverage.useMutation({
    onSuccess: (r) => {
      updateNodeData(id, { coverage: r as ScriptCoverageReport });
      toast.success(`审查完成：${VERDICTS[r.verdict].label} · ${r.overall} 分`);
    },
    onError: (e) => toast.error("审查失败：" + e.message),
  });
  const fixMut = trpc.scripts.applyScriptFix.useMutation({
    onSuccess: (r) => {
      snapshotContent(id, "定向修复前");
      updateNodeData(id, { content: r.result });
      toast.success("已定向修复，建议点击「复审」查看分数变化");
    },
    onError: (e) => toast.error("修复失败：" + e.message),
    onSettled: () => setFixingIdx(null),
  });

  const runReview = () => {
    const text = payload.content?.trim();
    if (!text) { toast.error("请先填写脚本内容"); return; }
    setPrevOverall(report?.overall ?? null);
    covMut.mutate({ scriptText: text.slice(0, 8000), genre: payload.aiGenre, shortDrama, model: llmModel });
  };

  const fixIssue = (issue: CoverageIssue, idx: number) => {
    const text = payload.content?.trim();
    if (!text) return;
    setFixingIdx(idx);
    fixMut.mutate({
      scriptText: text.slice(0, 8000),
      issue: { dimension: issue.dimension, sceneRef: issue.sceneRef, description: issue.description, suggestion: issue.suggestion },
      model: llmModel,
    });
  };

  const saveAsNote = () => {
    if (!report) return;
    const store = useCanvasStore.getState();
    const own = store.nodes.find((n) => n.id === id);
    if (!own) return;
    const md = [
      `📋 剧本审查报告 · ${VERDICTS[report.verdict].label} · ${report.overall}/100`,
      ``,
      report.summary,
      ``,
      `维度评分：`,
      ...report.dimensions.map((d) => `· ${DIM_LABELS[d.key]} ${d.score}：${d.comment}`),
      ``,
      report.strengths.length ? `亮点：\n${report.strengths.map((s) => `· ${s}`).join("\n")}` : "",
      report.issues.length ? `\n问题（${report.issues.length}）：\n${report.issues.map((x, i) => `${i + 1}. [${DIM_LABELS[x.dimension]}·${x.sceneRef}·${x.severity}] ${x.description} → ${x.suggestion}`).join("\n")}` : "",
      report.shortDramaChecks?.length ? `\n短剧检查：\n${report.shortDramaChecks.map((c) => `· ${c.pass ? "✅" : "❌"} ${c.name}：${c.detail}`).join("\n")}` : "",
      ``,
      `—— ${new Date(report.reviewedAt ?? Date.now()).toLocaleString("zh-CN")}`,
    ].filter((s) => s !== "").join("\n");
    const note = store.addNode("note", { x: (own.position?.x ?? 0) + 560, y: own.position?.y ?? 0 });
    store.updateNodeData(note.id, { content: md });
    store.onConnect({ source: id, target: note.id, sourceHandle: null, targetHandle: null });
    toast.success("审查报告已存为便签节点");
  };

  return (
    <SideShell title="专业审查 · Script Coverage" icon={<ClipboardCheck style={{ width: 14, height: 14 }} />} accent={COV_ACCENT} onClose={onClose}>
      <p style={{ fontSize: 10, color: "var(--c-t3)", lineHeight: 1.6 }}>
        按行业审稿标准出具结构化报告：六维评分 + 裁决 + 逐条问题定位；可一键定向修复后复审对比。
        {shortDrama && " 当前为短剧模式，附加钩子节奏/台词长度/反转密度检查。"}
      </p>
      <ActionBtn accent={COV_ACCENT} pending={covMut.isPending} disabled={!payload.content?.trim()} onClick={runReview}>
        {report ? <><RefreshCw className="w-3 h-3" /> 复审（对比分数变化）</> : "开始专业审查"}
      </ActionBtn>

      {report && (
        <>
          {/* 裁决 + 总分 */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: `${VERDICTS[report.verdict].color}14`, border: `1px solid ${VERDICTS[report.verdict].color}45` }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: VERDICTS[report.verdict].color }}>{VERDICTS[report.verdict].label}</span>
            <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 800, color: VERDICTS[report.verdict].color }}>
              {report.overall}<span style={{ fontSize: 10 }}>/100</span>
            </span>
            {prevOverall != null && prevOverall !== report.overall && (
              <span style={{ fontSize: 10, fontWeight: 700, color: report.overall >= prevOverall ? "oklch(0.70 0.18 150)" : "oklch(0.62 0.20 25)" }}>
                {report.overall >= prevOverall ? "+" : ""}{report.overall - prevOverall}
              </span>
            )}
          </div>
          <p style={{ fontSize: 10.5, color: "var(--c-t2)", lineHeight: 1.6 }}>{report.summary}</p>

          {/* 六维条形 */}
          <div className="flex flex-col gap-1">
            {report.dimensions.map((d) => (
              <div key={d.key} title={d.comment} className="flex items-center gap-2">
                <span style={{ fontSize: 9.5, color: "var(--c-t3)", width: 58, flexShrink: 0 }}>{DIM_LABELS[d.key]}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--c-bd1)", overflow: "hidden" }}>
                  <div style={{ width: `${d.score}%`, height: "100%", background: d.score >= 75 ? "oklch(0.70 0.18 150)" : d.score >= 55 ? "oklch(0.75 0.16 75)" : "oklch(0.62 0.20 25)", borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--c-t2)", width: 22, textAlign: "right" }}>{d.score}</span>
              </div>
            ))}
          </div>

          {/* 短剧附加检查 */}
          {report.shortDramaChecks && report.shortDramaChecks.length > 0 && (
            <div className="flex flex-col gap-1">
              {report.shortDramaChecks.map((c, i) => (
                <div key={i} className="px-2 py-1.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)", fontSize: 9.5, color: "var(--c-t2)", lineHeight: 1.5 }}>
                  {c.pass ? "✅" : "❌"} <strong>{c.name}</strong>：{c.detail}
                </div>
              ))}
            </div>
          )}

          {/* 亮点 */}
          {report.strengths.length > 0 && (
            <div style={{ fontSize: 9.5, color: "oklch(0.70 0.16 150)", lineHeight: 1.6 }}>
              {report.strengths.map((s, i) => <div key={i}>★ {s}</div>)}
            </div>
          )}

          {/* 问题列表 + 闭环修复 */}
          {report.issues.map((issue, i) => (
            <div key={i} className="px-2.5 py-2 rounded-lg" style={{ background: "var(--c-input)", border: `1px solid ${SEV_COLORS[issue.severity]}35` }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold" style={{ background: `${SEV_COLORS[issue.severity]}18`, color: SEV_COLORS[issue.severity] }}>
                  {issue.severity === "high" ? "严重" : issue.severity === "medium" ? "中等" : "轻微"}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[8.5px] font-semibold" style={{ background: `${COV_ACCENT}15`, color: COV_ACCENT }}>{DIM_LABELS[issue.dimension]}</span>
                <span style={{ fontSize: 9, color: "var(--c-t4)" }}>{issue.sceneRef}</span>
                {issue.autoFixable && (
                  <button onClick={() => fixIssue(issue, i)} disabled={fixMut.isPending} className="nodrag ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                    style={{ fontSize: 8.5, fontWeight: 700, background: `${COV_ACCENT}16`, border: `1px solid ${COV_ACCENT}45`, color: COV_ACCENT, cursor: fixMut.isPending ? "wait" : "pointer" }}>
                    {fixingIdx === i ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Wand2 className="w-2.5 h-2.5" />}
                    一键修复
                  </button>
                )}
              </div>
              <p style={{ fontSize: 10, color: "var(--c-t2)", lineHeight: 1.5 }}>{issue.description}</p>
              <p style={{ fontSize: 9.5, color: "var(--c-t3)", lineHeight: 1.5, marginTop: 2 }}>建议：{issue.suggestion}</p>
            </div>
          ))}
          {report.issues.length === 0 && <p style={{ fontSize: 10, color: "var(--c-t3)", textAlign: "center" }}>无明显问题，剧本质量良好！</p>}

          {/* 存为便签 */}
          <button onClick={saveAsNote} className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg"
            style={{ fontSize: 10.5, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
            <StickyNote className="w-3 h-3" /> 报告存为便签节点（留档/对比）
          </button>
        </>
      )}
      {!report && <ListOrdered style={{ width: 28, height: 28, color: "var(--c-bd2)", margin: "12px auto" }} />}
    </SideShell>
  );
}
