import { useState } from "react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  X, Loader2, Sparkles, Route, ClipboardCheck, Check, ChevronRight,
  Wand2, ListOrdered, Film, StickyNote, RefreshCw, Tv,
} from "lucide-react";
import type { ScriptNodeData, ScriptBeat, ScriptCoverageReport, CoverageIssue } from "../../../../shared/types";

// 脚本节点的「侧向展开」面板（创作向导 / 专业审查）。
// 按用户交互要求：新功能不再向下堆叠拉长节点，而是横向弹出独立面板，
// 渲染在 BaseNode 的 leftDock 插槽（位于 overflow:hidden 之外，不被节点裁剪）。

const FLOW_ACCENT = "oklch(0.66 0.18 250)";   // 向导蓝
const COV_ACCENT = "oklch(0.68 0.20 295)";    // 审查紫

// ── 共用：侧向面板外壳 ─────────────────────────────────────────────────────────
function SideShell({ title, icon, accent, onClose, children }: {
  title: string; icon: React.ReactNode; accent: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div
      className="nodrag nowheel nopan"
      style={{
        position: "absolute", left: "calc(100% + 14px)", top: 0,
        width: 400, maxHeight: 640, display: "flex", flexDirection: "column",
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
export function collectCharacterProfiles(scriptId: string): string {
  const { nodes, edges } = useCanvasStore.getState();
  const linked = new Set<string>();
  for (const e of edges) {
    if (e.source === scriptId) linked.add(e.target);
    if (e.target === scriptId) linked.add(e.source);
  }
  const lines: string[] = [];
  for (const n of nodes) {
    if (!linked.has(n.id) || n.data.nodeType !== "character") continue;
    const p = n.data.payload as Record<string, string | undefined>;
    if ((p.characterKind ?? "person") === "scene") {
      const parts = [p.sceneName && `场景「${p.sceneName}」`, p.locationType, p.sceneDescription, p.atmosphere && `氛围：${p.atmosphere}`, p.timeOfDay && `时间：${p.timeOfDay}`].filter(Boolean);
      if (parts.length) lines.push(`- ${parts.join("；")}`);
    } else {
      const parts = [p.name && `人物「${p.name}」`, p.role && `身份：${p.role}`, p.gender, p.age && `年龄：${p.age}`, p.appearance && `外貌：${p.appearance}`, p.outfit && `服装：${p.outfit}`, p.personality && `性格：${p.personality}`, p.signature && `标志特征：${p.signature}`].filter(Boolean);
      if (parts.length) lines.push(`- ${parts.join("；")}`);
    }
  }
  return lines.join("\n").slice(0, 3000);
}

const beatSheetToText = (beats: ScriptBeat[]): string =>
  beats.map((b) => `${b.index}. ${b.title}${b.duration ? `（约${b.duration}s）` : ""}：${b.summary}`).join("\n").slice(0, 4000);

// ── 小组件 ───────────────────────────────────────────────────────────────────
function StageHeader({ num, title, done }: { num: number; title: string; done: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{
        width: 18, height: 18, borderRadius: "50%", flexShrink: 0, fontSize: 10, fontWeight: 800,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: done ? FLOW_ACCENT : "var(--c-bd1)", color: done ? "#fff" : "var(--c-t3)",
      }}>{done ? <Check style={{ width: 11, height: 11 }} /> : num}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t1)" }}>{title}</span>
    </div>
  );
}

function ActionBtn({ onClick, pending, disabled, children, accent = FLOW_ACCENT }: {
  onClick: () => void; pending?: boolean; disabled?: boolean; children: React.ReactNode; accent?: string;
}) {
  const off = pending || disabled;
  return (
    <button onClick={onClick} disabled={off} className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg transition-all"
      style={{ fontSize: 11, fontWeight: 600, background: off ? "var(--c-surface)" : `${accent}16`, border: `1px solid ${off ? "var(--c-bd2)" : `${accent}45`}`, color: off ? "var(--c-t4)" : accent, cursor: off ? "not-allowed" : "pointer" }}>
      {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
      {children}
    </button>
  );
}

const taStyle: React.CSSProperties = {
  width: "100%", fontSize: 11, lineHeight: 1.55, padding: "7px 9px", borderRadius: 8,
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

export function ScriptDevFlowPanel({ id, payload, llmModel, fullGenPending, storyboardsPending, onGenerateScript, onGenerateStoryboards, onClose }: {
  id: string;
  payload: ScriptNodeData;
  llmModel: string;
  fullGenPending: boolean;
  storyboardsPending: boolean;
  onGenerateScript: (extra: { beatSheetText?: string; characterProfiles?: string }) => void;
  onGenerateStoryboards: () => void;
  onClose: () => void;
}) {
  const { updateNodeData } = useCanvasStore();
  const [loglineCands, setLoglineCands] = useState<string[]>([]);
  const [structure, setStructure] = useState<string>(payload.beatStructure ?? "three_act");
  const [epCount, setEpCount] = useState(12);
  const [showEpisodes, setShowEpisodes] = useState(false);

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
    onSuccess: (r) => { updateNodeData(id, { episodeOutline: r.episodes }); setShowEpisodes(true); toast.success(`分集大纲已生成（${r.episodes.length} 集）`); },
    onError: (e) => toast.error("分集大纲生成失败：" + e.message),
  });

  const idea = (payload.synopsis ?? "").trim();
  const logline = (payload.logline ?? "").trim();
  const beats = payload.beatSheet ?? [];
  const episodes = payload.episodeOutline ?? [];
  const source = [logline && `Logline：${logline}`, idea && `梗概：${idea}`].filter(Boolean).join("\n");

  const updateBeat = (i: number, patch: Partial<ScriptBeat>) => {
    const next = beats.map((b, j) => (j === i ? { ...b, ...patch } : b));
    updateNodeData(id, { beatSheet: next });
  };

  return (
    <SideShell title="创作向导 · 想法 → 成片剧本" icon={<Route style={{ width: 14, height: 14 }} />} accent={FLOW_ACCENT} onClose={onClose}>
      <p style={{ fontSize: 10, color: "var(--c-t3)", lineHeight: 1.6 }}>
        按行业开发管线逐阶段推进：每一步产物可编辑、可重生成、可跳过。赶时间也可直接用节点里的「一键生成」。
      </p>

      {/* ① Logline */}
      <div className="flex flex-col gap-1.5">
        <StageHeader num={1} title="一句话故事（Logline）" done={!!logline} />
        <textarea className="nodrag" rows={2} style={taStyle} placeholder="25-35 字：主角 + 冲突 + 赌注。可手写，或由下方按钮从梗概/想法提炼"
          value={payload.logline ?? ""} onChange={(e) => updateNodeData(id, { logline: e.target.value })} />
        <ActionBtn pending={loglineMut.isPending} disabled={!idea && !logline}
          onClick={() => loglineMut.mutate({ idea: idea || logline, genre: payload.aiGenre, model: llmModel })}>
          从想法/梗概提炼 3 个候选
        </ActionBtn>
        {loglineCands.length > 0 && (
          <div className="flex flex-col gap-1">
            {loglineCands.map((l, i) => (
              <button key={i} onClick={() => { updateNodeData(id, { logline: l }); setLoglineCands([]); }}
                className="nodrag text-left px-2 py-1.5 rounded-lg transition-all"
                style={{ fontSize: 10.5, lineHeight: 1.5, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ② 梗概 */}
      <div className="flex flex-col gap-1.5">
        <StageHeader num={2} title="故事梗概（300-500 字）" done={idea.length >= 60} />
        <p style={{ fontSize: 9.5, color: "var(--c-t4)" }}>梗概就是节点顶部的「故事梗概」框（共用），可在这里扩写。</p>
        <ActionBtn pending={synopsisMut.isPending} disabled={!logline && !idea}
          onClick={() => synopsisMut.mutate({ sceneText: (logline || idea).slice(0, 2000), intent: "把这个故事扩写为 300-500 字的故事梗概：现在时态，按三幕走向（建置/对抗/结局）交代主角、冲突升级与结局方向，具体可拍，不要抽象套话", model: llmModel })}>
          {idea ? "按 Logline 重写梗概" : "由 Logline 扩写梗概"}
        </ActionBtn>
      </div>

      {/* ③ 节拍表 */}
      <div className="flex flex-col gap-1.5">
        <StageHeader num={3} title="节拍表（Beat Sheet）" done={beats.length > 0} />
        <div className="flex flex-wrap gap-1">
          {BEAT_STRUCTURES.map((s) => (
            <button key={s.id} onClick={() => setStructure(s.id)} className="nodrag px-1.5 py-0.5 rounded-md transition-all"
              style={{ fontSize: 9.5, fontWeight: structure === s.id ? 700 : 500, background: structure === s.id ? `${FLOW_ACCENT}18` : "var(--c-surface)", border: `1px solid ${structure === s.id ? `${FLOW_ACCENT}50` : "var(--c-bd2)"}`, color: structure === s.id ? FLOW_ACCENT : "var(--c-t3)", cursor: "pointer" }}>
              {s.label}
            </button>
          ))}
        </div>
        <ActionBtn pending={beatsMut.isPending} disabled={!source}
          onClick={() => beatsMut.mutate({ source, structure: structure as "three_act", totalDuration: payload.totalDuration ?? 60, genre: payload.aiGenre, mood: payload.aiMood, model: llmModel })}>
          {beats.length ? "重新生成节拍表" : "生成节拍表"}
        </ActionBtn>
        {beats.length > 0 && (
          <div className="flex flex-col gap-1.5" style={{ maxHeight: 220, overflowY: "auto" }}>
            {beats.map((b, i) => (
              <div key={i} className="px-2 py-1.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span style={{ fontSize: 9, fontWeight: 800, color: FLOW_ACCENT }}>{b.index}</span>
                  <input className="nodrag" value={b.title} onChange={(e) => updateBeat(i, { title: e.target.value })}
                    style={{ flex: 1, fontSize: 10, fontWeight: 700, background: "transparent", border: "none", outline: "none", color: "var(--c-t1)" }} />
                  {b.duration != null && <span style={{ fontSize: 8.5, color: "var(--c-t4)" }}>≈{b.duration}s</span>}
                </div>
                <textarea className="nodrag" rows={2} value={b.summary} onChange={(e) => updateBeat(i, { summary: e.target.value })}
                  style={{ ...taStyle, fontSize: 10, padding: "4px 6px" }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ④ 剧本 */}
      <div className="flex flex-col gap-1.5">
        <StageHeader num={4} title="生成完整剧本" done={!!payload.content?.trim()} />
        <p style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
          自动注入约束：{beats.length ? "✓ 节拍表（逐拍展开）" : "✗ 无节拍表"} · {collectCharacterProfiles(id) ? "✓ 已连接角色档案" : "✗ 未连接角色节点"}
        </p>
        <ActionBtn pending={fullGenPending} disabled={!idea && !logline}
          onClick={() => onGenerateScript({
            beatSheetText: beats.length ? beatSheetToText(beats) : undefined,
            characterProfiles: collectCharacterProfiles(id) || undefined,
          })}>
          生成剧本{beats.length ? "（按节拍表）" : ""} + 分镜
        </ActionBtn>
      </div>

      {/* ⑤ 分镜 */}
      <div className="flex flex-col gap-1.5">
        <StageHeader num={5} title="从剧本拆分镜节点" done={false} />
        <ActionBtn pending={storyboardsPending} disabled={!payload.content?.trim()} onClick={onGenerateStoryboards}>
          <Film className="w-3 h-3" /> AI 生成分镜节点
        </ActionBtn>
      </div>

      {/* 可选：短剧分集大纲 */}
      <div className="flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--c-bd1)", paddingTop: 8 }}>
        <div className="flex items-center gap-2">
          <Tv style={{ width: 12, height: 12, color: FLOW_ACCENT }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t1)", flex: 1 }}>短剧分集大纲（可选）</span>
          <input className="nodrag" type="number" min={4} max={100} value={epCount}
            onChange={(e) => setEpCount(Math.max(4, Math.min(100, Number(e.target.value) || 12)))}
            style={{ width: 48, fontSize: 10, padding: "2px 5px", borderRadius: 6, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
          <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>集</span>
        </div>
        <ActionBtn pending={episodesMut.isPending} disabled={!source}
          onClick={() => episodesMut.mutate({ source, episodeCount: epCount, model: llmModel })}>
          生成分集大纲（每集钩子 + 卡点）
        </ActionBtn>
        {episodes.length > 0 && (
          <>
            <button onClick={() => setShowEpisodes((v) => !v)} className="nodrag flex items-center gap-1" style={{ background: "none", border: "none", fontSize: 10, color: FLOW_ACCENT, cursor: "pointer", padding: 0 }}>
              <ChevronRight style={{ width: 10, height: 10, transform: showEpisodes ? "rotate(90deg)" : "none", transition: "transform 150ms" }} />
              {episodes.length} 集大纲 {showEpisodes ? "收起" : "展开"}
            </button>
            {showEpisodes && (
              <div className="flex flex-col gap-1" style={{ maxHeight: 200, overflowY: "auto" }}>
                {episodes.map((ep) => (
                  <div key={ep.episode} className="px-2 py-1.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--c-t1)" }}>第{ep.episode}集 · {ep.title}</div>
                    <div style={{ fontSize: 9.5, color: "var(--c-t3)", lineHeight: 1.5 }}>钩子：{ep.hook}</div>
                    <div style={{ fontSize: 9.5, color: "var(--c-t2)", lineHeight: 1.5 }}>{ep.summary}</div>
                    <div style={{ fontSize: 9.5, color: FLOW_ACCENT, lineHeight: 1.5 }}>卡点：{ep.cliffhanger}</div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                const md = episodes.map((ep) => `第${ep.episode}集 ${ep.title}\n钩子：${ep.hook}\n剧情:${ep.summary}\n卡点：${ep.cliffhanger}`).join("\n\n");
                void navigator.clipboard?.writeText(md).then(() => toast.success("分集大纲已复制"));
              }}
              className="nodrag" style={{ fontSize: 10, padding: "4px 8px", borderRadius: 7, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
              复制全部大纲
            </button>
          </>
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
  const prevOverall = useState<number | null>(report?.overall ?? null);
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
      updateNodeData(id, { content: r.result });
      toast.success("已定向修复，建议点击「复审」查看分数变化");
    },
    onError: (e) => toast.error("修复失败：" + e.message),
    onSettled: () => setFixingIdx(null),
  });

  const runReview = () => {
    const text = payload.content?.trim();
    if (!text) { toast.error("请先填写脚本内容"); return; }
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
            {prevOverall[0] != null && prevOverall[0] !== report.overall && (
              <span style={{ fontSize: 10, fontWeight: 700, color: report.overall >= prevOverall[0] ? "oklch(0.70 0.18 150)" : "oklch(0.62 0.20 25)" }}>
                {report.overall >= prevOverall[0] ? "+" : ""}{report.overall - prevOverall[0]}
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
