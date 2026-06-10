import { useMemo, useState } from "react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { X, ClipboardList, ArrowUp, ArrowDown, Loader2, Wand2, ListOrdered, Scaling } from "lucide-react";
import type { StoryboardNodeData, ScriptNodeData } from "../../../../shared/types";

// 「镜头表（Shot List）」侧向展开面板 —— 同组分镜的序列总览。
// 行业前期制作的核心文档：镜号/景别/运镜/时长/转场/对白 一表统管；
// 总时长 vs 目标时长实时校验 + 一键按比例缩放；相邻镜「衔接优化」（180° 轴线/景别递进）。
// 同组判定：与当前分镜共享同一上游脚本节点的所有分镜；无上游脚本时为画布全部分镜。

const ACCENT = "oklch(0.65 0.20 160)"; // storyboard 绿

interface ShotRow {
  id: string;
  num: number;          // 排序用编号（sceneNumber 数字化，非数字按出现序）
  title: string;
  payload: StoryboardNodeData;
}

const SHOT_TYPES = ["", "ECU", "CU", "MS", "MLS", "WS", "establishing"];
const TRANSITIONS = ["", "cut", "dissolve", "fade", "wipe", "match-cut"];

export function ShotListPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { updateNodeData, batchUpdateNodeData } = useCanvasStore();
  const [fixingId, setFixingId] = useState<string | null>(null);

  // 订阅同组分镜（key 化避免每渲染重建）。
  const groupKey = useCanvasStore((s) => {
    const srcScript = s.edges.find((e) => e.target === id && s.nodes.find((n) => n.id === e.source)?.data.nodeType === "script")?.source;
    const members = s.nodes.filter((n) => {
      if (n.data.nodeType !== "storyboard") return false;
      if (!srcScript) return true; // 无上游脚本 → 全画布分镜
      return s.edges.some((e) => e.target === n.id && e.source === srcScript);
    });
    return JSON.stringify({
      src: srcScript ?? null,
      target: srcScript ? (s.nodes.find((n) => n.id === srcScript)?.data.payload as ScriptNodeData | undefined)?.totalDuration ?? null : null,
      rows: members.map((n) => [n.id, n.data.title, n.position.x, JSON.stringify(n.data.payload)]),
    });
  });
  const { rows, targetDuration, scriptId } = useMemo(() => {
    const g = JSON.parse(groupKey) as { src: string | null; target: number | null; rows: [string, string, number, string][] };
    const parsed: (ShotRow & { x: number })[] = g.rows.map(([rid, title, x, pj], i) => {
      const payload = JSON.parse(pj) as StoryboardNodeData;
      const n = Number(payload.sceneNumber);
      return { id: rid, num: Number.isFinite(n) && n > 0 ? n : 1000 + i, title, payload, x };
    });
    parsed.sort((a, b) => a.num - b.num || a.x - b.x);
    return { rows: parsed, targetDuration: g.target, scriptId: g.src };
  }, [groupKey]);

  const totalDuration = rows.reduce((s, r) => s + (Number(r.payload.duration) || 0), 0);
  const delta = targetDuration != null ? totalDuration - targetDuration : null;

  const continuityMut = trpc.scripts.refineShotContinuity.useMutation({
    onSuccess: (r, vars) => {
      const targetId = fixingId;
      if (targetId) {
        updateNodeData(targetId, {
          ...(r.description ? { description: r.description } : {}),
          ...(r.promptText ? { promptText: r.promptText } : {}),
          ...(r.shotType ? { shotType: r.shotType } : {}),
          ...(r.cameraMovement ? { cameraMovement: r.cameraMovement } : {}),
        });
      }
      void vars;
      toast.success(`衔接已优化：${r.note || "已按剪辑规范调整"}`, { duration: 5000 });
    },
    onError: (e) => toast.error("衔接优化失败：" + e.message),
    onSettled: () => setFixingId(null),
  });

  /** 交换两行的编号与标题（节点位置不动，只改镜号）。 */
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= rows.length) return;
    const a = rows[i], b = rows[j];
    batchUpdateNodeData([
      { id: a.id, payload: { sceneNumber: b.num < 1000 ? b.num : j + 1 } },
      { id: b.id, payload: { sceneNumber: a.num < 1000 ? a.num : i + 1 } },
    ]);
  };

  /** 按画布 x 坐标从左到右重编号（1..n）。 */
  const renumberByPosition = () => {
    const byX = [...rows].sort((a, b) => (a as ShotRow & { x: number }).x - (b as ShotRow & { x: number }).x);
    batchUpdateNodeData(byX.map((r, i) => ({ id: r.id, payload: { sceneNumber: i + 1 } })));
    toast.success("已按画布位置重编号");
  };

  /** 按比例缩放所有镜头时长到目标总时长。 */
  const scaleToTarget = () => {
    if (!targetDuration || totalDuration <= 0) return;
    const ratio = targetDuration / totalDuration;
    batchUpdateNodeData(rows.map((r) => ({
      id: r.id,
      payload: { duration: Math.max(1, Math.round((Number(r.payload.duration) || 0) * ratio)) },
    })));
    toast.success(`已按比例缩放（×${ratio.toFixed(2)}）`);
  };

  const fixContinuity = (i: number) => {
    if (i <= 0) return;
    const prev = rows[i - 1].payload, cur = rows[i].payload;
    setFixingId(rows[i].id);
    continuityMut.mutate({
      prevShot: { description: (prev.description ?? "").slice(0, 1000), shotType: prev.shotType, cameraMovement: prev.cameraMovement, transition: prev.transition },
      currentShot: { description: (cur.description ?? "").slice(0, 1000), promptText: cur.promptText?.slice(0, 2000), shotType: cur.shotType, cameraMovement: cur.cameraMovement },
    });
  };

  return (
    <div
      className="nodrag nowheel nopan"
      style={{
        position: "absolute", left: "calc(100% + 14px)", top: 0,
        width: 520, maxHeight: 620, display: "flex", flexDirection: "column",
        background: "var(--c-base)", border: `1px solid ${ACCENT}50`, borderRadius: 14,
        boxShadow: "0 18px 60px oklch(0 0 0 / 0.45)", zIndex: 30, overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", borderBottom: `1px solid ${ACCENT}30`, background: `${ACCENT}10`, flexShrink: 0 }}>
        <ClipboardList style={{ width: 14, height: 14, color: ACCENT }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--c-t1)", flex: 1 }}>
          镜头表 · Shot List
          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: "var(--c-t3)" }}>
            {rows.length} 镜{scriptId ? "（同一脚本）" : "（全画布）"}
          </span>
        </span>
        <button onClick={onClose} className="nodrag" style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", padding: 2 }}>
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>

      {/* 时长校验条 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 13px", borderBottom: "1px solid var(--c-bd1)", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--c-t2)" }}>
          总时长 <strong style={{ color: "var(--c-t1)" }}>{totalDuration}s</strong>
          {targetDuration != null && (
            <>
              {" / 目标 "}<strong style={{ color: "var(--c-t1)" }}>{targetDuration}s</strong>
              <span style={{ marginLeft: 6, fontWeight: 700, color: delta === 0 ? "oklch(0.70 0.18 150)" : Math.abs(delta!) <= targetDuration * 0.1 ? "oklch(0.75 0.16 75)" : "oklch(0.62 0.20 25)" }}>
                {delta === 0 ? "✓ 达标" : `${delta! > 0 ? "+" : ""}${delta}s`}
              </span>
            </>
          )}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {targetDuration != null && delta !== 0 && (
            <button onClick={scaleToTarget} className="nodrag flex items-center gap-1 px-2 py-1 rounded-md" style={{ fontSize: 9.5, fontWeight: 700, background: `${ACCENT}16`, border: `1px solid ${ACCENT}45`, color: ACCENT, cursor: "pointer" }}>
              <Scaling style={{ width: 10, height: 10 }} /> 按比例缩放到目标
            </button>
          )}
          <button onClick={renumberByPosition} className="nodrag flex items-center gap-1 px-2 py-1 rounded-md" style={{ fontSize: 9.5, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
            <ListOrdered style={{ width: 10, height: 10 }} /> 按位置重编号
          </button>
        </div>
      </div>

      {/* 表格 */}
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {rows.map((r, i) => {
          const isSelf = r.id === id;
          const p = r.payload;
          return (
            <div key={r.id} style={{
              display: "flex", flexDirection: "column", gap: 4, padding: "7px 9px", marginBottom: 5, borderRadius: 9,
              background: isSelf ? `${ACCENT}10` : "var(--c-input)",
              border: `1px solid ${isSelf ? `${ACCENT}45` : "var(--c-bd1)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: ACCENT, width: 22 }}>#{p.sceneNumber ?? i + 1}</span>
                <span title={p.description} style={{ flex: 1, fontSize: 10.5, fontWeight: 600, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.description?.slice(0, 40) || r.title}
                </span>
                {p.beatRef && <span style={{ fontSize: 8.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "oklch(0.66 0.18 250 / 0.15)", color: "oklch(0.66 0.18 250)" }}>拍{p.beatRef}</span>}
                {p.dialogue && <span title={p.dialogue} style={{ fontSize: 8.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "oklch(0.70 0.18 340 / 0.15)", color: "oklch(0.70 0.18 340)" }}>💬</span>}
                <button onClick={() => swap(i, i - 1)} disabled={i === 0} className="nodrag" title="上移" style={{ background: "none", border: "none", color: i === 0 ? "var(--c-bd2)" : "var(--c-t3)", cursor: i === 0 ? "default" : "pointer", padding: 1 }}><ArrowUp style={{ width: 12, height: 12 }} /></button>
                <button onClick={() => swap(i, i + 1)} disabled={i === rows.length - 1} className="nodrag" title="下移" style={{ background: "none", border: "none", color: i === rows.length - 1 ? "var(--c-bd2)" : "var(--c-t3)", cursor: i === rows.length - 1 ? "default" : "pointer", padding: 1 }}><ArrowDown style={{ width: 12, height: 12 }} /></button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {/* 景别 */}
                <select className="nodrag" value={p.shotType ?? ""} onChange={(e) => updateNodeData(r.id, { shotType: e.target.value || undefined })}
                  style={{ fontSize: 9.5, padding: "2px 4px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none" }}>
                  {SHOT_TYPES.map((t) => <option key={t} value={t}>{t || "景别"}</option>)}
                </select>
                <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>{p.cameraMovement || "static"}</span>
                {/* 时长 */}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  <input className="nodrag" type="number" min={1} max={120} value={Number(p.duration) || 0}
                    onChange={(e) => updateNodeData(r.id, { duration: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })}
                    style={{ width: 38, fontSize: 9.5, padding: "2px 4px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
                  <span style={{ fontSize: 9, color: "var(--c-t4)" }}>s</span>
                </span>
                {/* 转场 */}
                <select className="nodrag" value={p.transition ?? ""} onChange={(e) => updateNodeData(r.id, { transition: e.target.value || undefined })}
                  style={{ fontSize: 9.5, padding: "2px 4px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none" }}>
                  {TRANSITIONS.map((t) => <option key={t} value={t}>{t || "转场→"}</option>)}
                </select>
                {i > 0 && (
                  <button onClick={() => fixContinuity(i)} disabled={continuityMut.isPending} className="nodrag ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                    title="按上一镜优化衔接（180° 轴线 / 景别递进 / 运镜动静衔接）"
                    style={{ fontSize: 8.5, fontWeight: 700, background: `${ACCENT}14`, border: `1px solid ${ACCENT}40`, color: ACCENT, cursor: continuityMut.isPending ? "wait" : "pointer" }}>
                    {fixingId === r.id ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Wand2 style={{ width: 10, height: 10 }} />}
                    衔接优化
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p style={{ fontSize: 11, color: "var(--c-t4)", textAlign: "center", padding: 20 }}>画布上没有分镜节点</p>}
      </div>
    </div>
  );
}
