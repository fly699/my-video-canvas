import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { X, Check, Film, ChevronRight, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  NARRATIVE_ARCS,
  NARRATIVE_ARC_CATEGORIES,
  resolveBeats,
  mapArcToScenes,
  sortStoryboardsBySceneNumber,
  type NarrativeArc,
} from "../../lib/narrativeArcs";
import {
  applyCinematographyToPrompt,
  applyCinematographyParams,
  clearCinematographyParamsPatch,
  getTemplateById,
} from "../../lib/cinematographyTemplates";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import type { StoryboardNodeData, VideoTaskNodeData } from "../../../../shared/types";

interface Props {
  onClose: () => void;
}

type ScopeMode = "all" | "selected";

interface SceneItem {
  id: string;
  sceneNumber?: number | string;
  description?: string;
  selected: boolean;
}

/**
 * 叙事弧线编排器 — 把多个分镜节点一键映射到一个完整的叙事弧线
 * （三幕剧 / 英雄之旅 / 短视频钩子等）。
 *
 * 工作原理：
 * 1. 从画布扫描所有 storyboard 节点，按 sceneNumber 稳定排序
 * 2. 用户选弧线 + 选作用域（全部 / 仅选中）
 * 3. mapArcToScenes() 把 beats 等比分配到 scenes
 * 4. 对每个 scene：applyCinematographyToPrompt 注入 prompt + 同步到下游 video_task 节点的 params
 *
 * 同步到 video_task：弧线本质是运镜，下游视频任务需要带上 camera_motion_* 参数。
 * 通过 outgoing edges 找到 video_task 后端，对每条 storyboard→video_task 链路应用同一模板。
 */
export function NarrativeArcPicker({ onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<NarrativeArc["category"]>("classic");
  const [selectedArcId, setSelectedArcId] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeMode>("all");
  const [syncToVideoTasks, setSyncToVideoTasks] = useState(true);

  // Subscribe via a flat-tuple selector — Zustand uses Object.is element-wise
  // under useShallow, so flattening to primitives keeps the subscription stable
  // when storyboard fields haven't actually changed. Rebuild the object form
  // (and apply the 4-bucket sort) inside useMemo gated on those tuples.
  const storyboardTuples = useCanvasStore(
    useShallow((s) => {
      const sbs = s.nodes.filter((n) => n.data.nodeType === "storyboard");
      const flat: Array<string | number | boolean | undefined> = [];
      for (const n of sbs) {
        const p = n.data.payload as StoryboardNodeData;
        flat.push(n.id, p.sceneNumber, p.description, !!n.selected);
      }
      return flat;
    }),
  );

  const allScenes = useMemo(() => {
    const list: Array<{ id: string; sceneNumber?: number | string; description?: string; selected: boolean }> = [];
    for (let i = 0; i < storyboardTuples.length; i += 4) {
      list.push({
        id: storyboardTuples[i] as string,
        sceneNumber: storyboardTuples[i + 1] as number | string | undefined,
        description: storyboardTuples[i + 2] as string | undefined,
        selected: storyboardTuples[i + 3] as boolean,
      });
    }
    return sortStoryboardsBySceneNumber(list);
  }, [storyboardTuples]);

  const selectedScenes = useMemo(
    () => allScenes.filter((s) => s.selected),
    [allScenes],
  );

  // If the user picked "scope=selected" but selected nothing, target NOTHING
  // (not silently fall back to all scenes — that produces a misleading preview
  // showing rows the disabled Apply button would not execute).
  const targetScenes: SceneItem[] = scope === "selected" ? selectedScenes : allScenes;

  const filteredArcs = NARRATIVE_ARCS.filter((a) => a.category === activeCategory);
  const selectedArc = selectedArcId ? NARRATIVE_ARCS.find((a) => a.id === selectedArcId) : null;
  const resolvedBeats = selectedArc ? resolveBeats(selectedArc) : [];
  const hasStaleBeat = resolvedBeats.some((rb) => rb.template === null);
  const preview = selectedArc ? mapArcToScenes(selectedArc, targetScenes.map((s) => s.id)) : [];

  const sceneCounts: Record<string, number> = {};
  for (const a of NARRATIVE_ARCS) sceneCounts[a.category] = (sceneCounts[a.category] ?? 0) + 1;

  const handleApply = () => {
    if (!selectedArc || targetScenes.length === 0) return;
    if (hasStaleBeat) {
      toast.error("弧线包含失效模板，无法应用");
      return;
    }
    const store = useCanvasStore.getState();
    const allNodes = store.nodes;
    const allEdges = store.edges;

    // Dedupe per node id BEFORE submitting to batchUpdateNodeData (which uses
    // `new Map(updates.map(u => [u.id, u.payload]))` — duplicate ids silently
    // collapse to the last entry). Storyboards never duplicate (one beat per
    // scene), but downstream video_tasks CAN if multiple selected storyboards
    // converge onto a single video_task (fan-in pattern). For those conflicts
    // we collect them and warn the user rather than silently picking a winner.
    const updateMap = new Map<string, Record<string, unknown>>();
    const vtFanInConflicts = new Map<string, string[]>();  // vtId → [sceneIds...]

    for (const m of preview) {
      const tpl = getTemplateById(m.beat.templateId);
      if (!tpl) continue;
      const sceneNode = allNodes.find((n) => n.id === m.sceneId);
      if (!sceneNode) continue;
      const sbPayload = sceneNode.data.payload as StoryboardNodeData;
      const newPrompt = applyCinematographyToPrompt(sbPayload.promptText ?? "", tpl);
      updateMap.set(m.sceneId, { promptText: newPrompt });

      if (syncToVideoTasks) {
        const outgoing = allEdges.filter((e) => e.source === m.sceneId);
        for (const edge of outgoing) {
          const vt = allNodes.find((n) => n.id === edge.target && n.data.nodeType === "video_task");
          if (!vt) continue;
          if (updateMap.has(vt.id)) {
            // Already wrote a patch for this video_task from an earlier scene
            const list = vtFanInConflicts.get(vt.id) ?? [];
            list.push(m.sceneId);
            vtFanInConflicts.set(vt.id, list);
            continue;  // First writer wins — deterministic by sceneNumber order
          }
          const vtPayload = vt.data.payload as VideoTaskNodeData;
          const provider = vtPayload.provider;
          const cameraPatch = applyCinematographyParams(provider, tpl);
          const vtPrompt = applyCinematographyToPrompt(vtPayload.prompt ?? "", tpl);
          updateMap.set(vt.id, {
            prompt: vtPrompt,
            params: {
              ...(vtPayload.params ?? {}),
              ...clearCinematographyParamsPatch(),
              ...cameraPatch,
            },
          });
        }
      }
    }

    const updates = Array.from(updateMap.entries()).map(([id, payload]) => ({ id, payload }));
    store.batchUpdateNodeData(updates);
    toast.success(`已应用「${selectedArc.label}」到 ${preview.length} 个分镜`);
    if (vtFanInConflicts.size > 0) {
      toast.warning(
        `${vtFanInConflicts.size} 个 video_task 节点存在多入度（多个分镜汇入同一节点），已采用首个分镜的运镜参数。请手动调整。`,
        { duration: 8000 },
      );
    }
    onClose();
  };

  const targetScenesEmpty = targetScenes.length === 0;
  const noSelected = scope === "selected" && selectedScenes.length === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col"
        style={{
          width: "min(1000px, 94vw)",
          height: "min(680px, 88vh)",
          background: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          borderRadius: 14,
          boxShadow: "0 24px 60px oklch(0 0 0 / 0.55)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--c-bd1)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--c-t1)" }}>
              🎞️ 叙事弧线编排器
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--c-t3)" }}>
              一键将完整叙事节拍应用到画布上的分镜序列（三幕剧 / 英雄之旅 / 短视频钩子等）
            </p>
          </div>
          <button
            onClick={onClose}
            title="关闭"
            style={{
              width: 26, height: 26, padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--c-bd2)",
              borderRadius: 6,
              color: "var(--c-t3)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex" style={{ flex: 1, minHeight: 0 }}>
          {/* Sidebar: categories */}
          <div
            style={{
              width: 130,
              flexShrink: 0,
              borderRight: "1px solid var(--c-bd1)",
              padding: "8px 4px",
              overflowY: "auto",
            }}
          >
            {NARRATIVE_ARC_CATEGORIES.map((cat) => {
              const isActive = cat.id === activeCategory;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: 12,
                    background: isActive ? "oklch(0.68 0.22 45 / 0.12)" : "transparent",
                    border: "none",
                    borderLeft: `2px solid ${isActive ? "oklch(0.68 0.22 45)" : "transparent"}`,
                    color: isActive ? "oklch(0.78 0.18 45)" : "var(--c-t2)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontWeight: isActive ? 600 : 400,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{cat.label}</span>
                  <span style={{ fontSize: 10, color: "var(--c-t4)" }}>{sceneCounts[cat.id] ?? 0}</span>
                </button>
              );
            })}
          </div>

          {/* Mid: arc cards */}
          <div
            className="nowheel"
            style={{
              width: 320,
              flexShrink: 0,
              borderRight: "1px solid var(--c-bd1)",
              overflowY: "auto",
              padding: "12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {filteredArcs.map((arc) => {
              const isActive = selectedArcId === arc.id;
              return (
                <button
                  key={arc.id}
                  onClick={() => setSelectedArcId(arc.id)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    background: isActive ? "oklch(0.68 0.22 45 / 0.08)" : "var(--c-surface)",
                    border: `1px solid ${isActive ? "oklch(0.68 0.22 45 / 0.5)" : "var(--c-bd2)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{arc.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-1.5">
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-t1)" }}>
                          {arc.label}
                        </span>
                        {isActive && <Check style={{ width: 12, height: 12, color: "oklch(0.78 0.18 45)" }} />}
                      </div>
                      <span style={{ fontSize: 10, color: "var(--c-t4)" }}>{arc.englishLabel}</span>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--c-t3)", lineHeight: 1.45 }}>
                    {arc.description}
                  </p>
                  <div className="flex items-center justify-between" style={{ marginTop: 2 }}>
                    <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
                      {arc.beats.length} 个节拍
                    </span>
                    <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
                      建议 {arc.recommendedSceneCount[0]}-{arc.recommendedSceneCount[1]} 分镜
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: preview + apply */}
          <div
            className="nowheel"
            style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}
          >
            {!selectedArc ? (
              <EmptyHint />
            ) : (
              <>
                {/* Arc header */}
                <div>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--c-t1)" }}>
                    {selectedArc.emoji} {selectedArc.label}
                  </h4>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--c-t3)" }}>
                    {selectedArc.description}
                  </p>
                </div>

                {/* Scope */}
                <div>
                  <label style={subLabelStyle}>作用域</label>
                  <div className="flex gap-1.5">
                    <ScopeBtn
                      active={scope === "all"}
                      onClick={() => setScope("all")}
                      label={`全部分镜（${allScenes.length}）`}
                    />
                    <ScopeBtn
                      active={scope === "selected"}
                      onClick={() => setScope("selected")}
                      disabled={selectedScenes.length === 0}
                      label={`仅选中（${selectedScenes.length}）`}
                    />
                  </div>
                </div>

                {/* Sync to video_task */}
                <div>
                  <label
                    className="flex items-center gap-2"
                    style={{ fontSize: 11.5, color: "var(--c-t2)", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={syncToVideoTasks}
                      onChange={(e) => setSyncToVideoTasks(e.target.checked)}
                    />
                    同步运镜参数到下游视频任务节点（推荐）
                  </label>
                  <p style={{ margin: "3px 0 0 22px", fontSize: 10, color: "var(--c-t4)" }}>
                    自动注入 camera_motion_type / camera_motion_speed 到 video_task.params
                  </p>
                </div>

                {/* Beats timeline */}
                <div>
                  <label style={subLabelStyle}>节拍序列</label>
                  <div className="flex flex-wrap items-center gap-1">
                    {resolvedBeats.map((rb, i) => (
                      <div key={i} className="flex items-center gap-1">
                        {i > 0 && <ChevronRight style={{ width: 10, height: 10, color: "var(--c-t4)" }} />}
                        <span
                          title={rb.beat.rationale ?? ""}
                          style={{
                            padding: "2px 7px",
                            fontSize: 10.5,
                            background: rb.template ? "var(--c-input)" : "oklch(0.62 0.20 25 / 0.12)",
                            border: `1px solid ${rb.template ? "var(--c-bd2)" : "oklch(0.62 0.20 25 / 0.4)"}`,
                            color: rb.template ? "var(--c-t2)" : "oklch(0.62 0.20 25)",
                            borderRadius: 4,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {rb.beat.label}
                          {rb.template && <span style={{ color: "var(--c-t4)", marginLeft: 4 }}>{rb.template.emoji}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                  {hasStaleBeat && (
                    <div className="flex items-center gap-1.5" style={{ marginTop: 6, fontSize: 10.5, color: "oklch(0.62 0.20 25)" }}>
                      <AlertTriangle style={{ width: 11, height: 11 }} />
                      弧线引用了缺失的运镜模板（红色项），请联系开发者
                    </div>
                  )}
                </div>

                {/* Preview: scene → beat mapping */}
                <div style={{ flex: 1, minHeight: 0 }}>
                  <label style={subLabelStyle}>映射预览（{preview.length} 个分镜将被修改）</label>
                  {targetScenesEmpty && (
                    <div style={emptyTip}>
                      画布上没有分镜节点。请先添加 storyboard 节点。
                    </div>
                  )}
                  {noSelected && (
                    <div style={emptyTip}>
                      未选中任何分镜节点。请先在画布上选择分镜，或切换到"全部分镜"。
                    </div>
                  )}
                  {!targetScenesEmpty && !noSelected && (
                    <div
                      style={{
                        border: "1px solid var(--c-bd1)",
                        borderRadius: 6,
                        maxHeight: 220,
                        overflowY: "auto",
                      }}
                    >
                      {preview.map((p, i) => {
                        const sceneItem = targetScenes.find((s) => s.id === p.sceneId);
                        const tpl = getTemplateById(p.beat.templateId);
                        return (
                          <div
                            key={p.sceneId}
                            className="flex items-center gap-2"
                            style={{
                              padding: "6px 10px",
                              fontSize: 11,
                              borderBottom: i < preview.length - 1 ? "1px solid var(--c-bd1)" : "none",
                              background: i % 2 === 0 ? "transparent" : "var(--c-surface)",
                            }}
                          >
                            <span style={{ width: 50, color: "var(--c-t4)", flexShrink: 0 }}>
                              #{sceneItem?.sceneNumber ?? i + 1}
                            </span>
                            <span style={{ flex: 1, color: "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {sceneItem?.description?.slice(0, 30) || "(无描述)"}
                            </span>
                            <ChevronRight style={{ width: 11, height: 11, color: "var(--c-t4)", flexShrink: 0 }} />
                            <span style={{ width: 140, color: "var(--c-t1)", flexShrink: 0, fontWeight: 500 }}>
                              {tpl?.emoji} {p.beat.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--c-bd1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: 10.5, color: "var(--c-t4)" }}>
            提示：弧线会替换分镜 prompt 中的运镜标记块，不会破坏你的其他描述
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                background: "transparent",
                border: "1px solid var(--c-bd2)",
                borderRadius: 6,
                color: "var(--c-t3)",
                cursor: "pointer",
              }}
            >
              取消
            </button>
            <button
              onClick={handleApply}
              disabled={!selectedArc || targetScenesEmpty || noSelected || hasStaleBeat}
              style={{
                padding: "6px 16px",
                fontSize: 12,
                fontWeight: 600,
                background: !selectedArc || targetScenesEmpty || noSelected || hasStaleBeat
                  ? "oklch(0.68 0.22 45 / 0.2)"
                  : "oklch(0.68 0.22 45)",
                border: "none",
                borderRadius: 6,
                color: "white",
                cursor: !selectedArc || targetScenesEmpty || noSelected || hasStaleBeat ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Film style={{ width: 12, height: 12 }} />
              {selectedArc && !targetScenesEmpty && !noSelected
                ? `应用到 ${preview.length} 个分镜`
                : "选择弧线"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const subLabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 6,
};

const emptyTip: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 11,
  background: "oklch(0.62 0.20 25 / 0.08)",
  border: "1px dashed oklch(0.62 0.20 25 / 0.4)",
  borderRadius: 6,
  color: "oklch(0.62 0.20 25)",
};

function ScopeBtn({
  active, onClick, label, disabled,
}: { active: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 11px",
        fontSize: 11,
        background: active ? "oklch(0.68 0.22 45 / 0.18)" : "var(--c-input)",
        border: `1px solid ${active ? "oklch(0.68 0.22 45 / 0.5)" : "var(--c-bd2)"}`,
        borderRadius: 6,
        color: active ? "oklch(0.78 0.18 45)" : disabled ? "var(--c-t4)" : "var(--c-t2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

function EmptyHint() {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ flex: 1, padding: 30, gap: 12, color: "var(--c-t4)" }}
    >
      <Film style={{ width: 36, height: 36, opacity: 0.4 }} />
      <p style={{ margin: 0, fontSize: 12, textAlign: "center", lineHeight: 1.6 }}>
        从左侧选择一个叙事弧线<br />
        预览节拍序列与分镜映射，确认后一键应用
      </p>
    </div>
  );
}
