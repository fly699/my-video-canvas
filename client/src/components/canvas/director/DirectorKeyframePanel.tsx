// #329 导演台动画层批3：右面板「关键帧」子面板——逐轴 ◇ 打帧 + < ◇ > 跳帧 +
// 设置曲线（贝塞尔编辑器 + 缓动预设库）。消费批1/批3 纯函数（directorTimeline.ts），
// props 与上层解耦：上层给「选中对象 + 其当前静态变换 + 时间线 + 当前时间」，本面板回调
// onChange(timeline) / onSeek(time)。（3D 对象随播放位移属批4；此处只编辑关键帧数据。）
import { useCallback, useRef } from "react";
import { Diamond, ChevronLeft, ChevronRight } from "lucide-react";
import type { Bezier, DirectorTimeline, DirectorTrack, Vec3 } from "../../../../../shared/types";
import {
  LINEAR, EASING_PRESETS, channelsForKind, hasKeyframeAt, adjacentKeyframeTime,
  toggleKeyframe, setEasingAt, easingAt, updateTrackIn, trackKeyframeTimes, clamp, fmtTime,
} from "@/lib/directorTimeline";

export interface KeyframeBase {
  position: Vec3;
  rotation: Vec3;
  scale: number;
  fov?: number;
  focus?: Vec3;
}

export interface DirectorKeyframePanelProps {
  timeline: DirectorTimeline;
  targetId: string;
  targetKind: DirectorTrack["targetKind"];
  currentTime: number;
  base: KeyframeBase;
  onChange: (tl: DirectorTimeline) => void;
  onSeek: (t: number) => void;
}

const AXIS_IDX = { x: 0, y: 1, z: 2 } as const;
const KF_EPS = 1e-3;

// ── 贝塞尔缓动编辑器（unit square + 两个可拖手柄）───────────────────────────
function BezierEditor({ value, onChange }: { value: Bezier; onChange: (b: Bezier) => void }) {
  const size = 128;
  const pad = 12;
  const inner = size - pad * 2;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<0 | 1 | null>(null);
  const [p1x, p1y, p2x, p2y] = value;
  // 数据坐标(0..1, y 上正) → SVG 坐标(y 下正)
  const toSvg = (x: number, y: number): [number, number] => [pad + x * inner, pad + (1 - y) * inner];
  const [h1x, h1y] = toSvg(p1x, p1y);
  const [h2x, h2y] = toSvg(p2x, p2y);
  const [ax, ay] = toSvg(0, 0);
  const [bx, by] = toSvg(1, 1);
  const path = `M ${ax} ${ay} C ${h1x} ${h1y}, ${h2x} ${h2y}, ${bx} ${by}`;

  const onMove = useCallback((e: PointerEvent) => {
    const idx = dragRef.current;
    if (idx == null || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - r.left - pad) / inner, 0, 1);          // x 夹 [0,1]
    const y = clamp((e.clientY - r.top - pad) / inner, -0.5, 1.5);      // y 允许超调
    const yData = 1 - y;
    const b: Bezier = idx === 0 ? [x, yData, p2x, p2y] : [p1x, p1y, x, yData];
    onChange(b);
  }, [inner, p1x, p1y, p2x, p2y, onChange]);
  const onUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove]);
  const startDrag = (idx: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = idx;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <svg ref={svgRef} width={size} height={size} data-testid="tl-bezier"
      style={{ background: "var(--c-input, #1c1d21)", border: "1px solid var(--c-bd2, #333)", borderRadius: 8, touchAction: "none" }}>
      {/* 网格对角线（线性参考） */}
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--c-bd3, #333)" strokeDasharray="3 3" />
      {/* 缓动曲线 */}
      <path d={path} fill="none" stroke="oklch(0.72 0.16 265)" strokeWidth={2} />
      {/* 手柄连线 */}
      <line x1={ax} y1={ay} x2={h1x} y2={h1y} stroke="oklch(0.6 0.14 265 / 0.5)" />
      <line x1={bx} y1={by} x2={h2x} y2={h2y} stroke="oklch(0.6 0.14 265 / 0.5)" />
      {/* 手柄 */}
      <circle cx={h1x} cy={h1y} r={5} fill="oklch(0.78 0.16 265)" style={{ cursor: "grab" }} onPointerDown={startDrag(0)} data-testid="tl-bezier-h1" />
      <circle cx={h2x} cy={h2y} r={5} fill="oklch(0.78 0.16 265)" style={{ cursor: "grab" }} onPointerDown={startDrag(1)} data-testid="tl-bezier-h2" />
    </svg>
  );
}

export function DirectorKeyframePanel({ timeline, targetId, targetKind, currentTime, base, onChange, onSeek }: DirectorKeyframePanelProps) {
  const track = timeline.tracks.find((t) => t.targetId === targetId);
  const defs = channelsForKind(targetKind);

  const valueOf = (prop: string, axis?: "x" | "y" | "z"): number => {
    if (prop === "position") return base.position[AXIS_IDX[axis!]];
    if (prop === "rotation") return base.rotation[AXIS_IDX[axis!]];
    if (prop === "uniformScale") return base.scale;
    if (prop === "focus") return (base.focus ?? [0, 0, 0])[AXIS_IDX[axis!]];
    if (prop === "fov") return base.fov ?? 50;
    return 0;
  };
  const channelOf = (prop: string, axis?: "x" | "y" | "z") =>
    track?.channels.find((c) => c.prop === prop && c.axis === axis);

  const punch = (prop: DirectorTrack["channels"][number]["prop"], axis: "x" | "y" | "z" | undefined) => {
    onChange(updateTrackIn(timeline, targetId, targetKind, (t) => toggleKeyframe(t, prop, axis, currentTime, valueOf(prop, axis))));
  };
  const jump = (prop: string, axis: "x" | "y" | "z" | undefined, dir: 1 | -1) => {
    const ch = channelOf(prop, axis);
    const t = adjacentKeyframeTime(ch ? ch.keyframes.map((k) => k.time) : [], currentTime, dir);
    if (t != null) onSeek(t);
  };

  const onKfHere = track ? trackKeyframeTimes(track).some((t) => Math.abs(t - currentTime) <= KF_EPS) : false;
  const curEasing: Bezier = (track && easingAt(track, currentTime)) || LINEAR;
  const applyEasing = (bez: Bezier) => onChange(updateTrackIn(timeline, targetId, targetKind, (t) => setEasingAt(t, currentTime, bez)));

  const kbtn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 4, cursor: "pointer", background: "transparent", border: "1px solid var(--c-bd2, #3a3a3a)", color: "var(--c-t3, #888)" };

  return (
    <div data-testid="director-keyframe-panel" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, color: "var(--c-t2, #ccc)" }}>关键帧 @ {fmtTime(currentTime)}</span>
        <span style={{ fontSize: 9.5, color: "var(--c-t4, #666)" }}>◇ 打帧 · ‹ › 跳帧</span>
      </div>

      {defs.map((d) => {
        const ch = channelOf(d.prop, d.axis);
        const here = ch ? hasKeyframeAt(ch.keyframes, currentTime) : false;
        const count = ch?.keyframes.length ?? 0;
        return (
          <div key={`${d.prop}:${d.axis ?? ""}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 62, color: "var(--c-t3, #999)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
            <span style={{ flex: 1, fontFamily: "monospace", color: "var(--c-t2, #bbb)" }}>{valueOf(d.prop, d.axis).toFixed(2)}</span>
            <button title="上一关键帧" onClick={() => jump(d.prop, d.axis, -1)} disabled={count === 0} style={{ ...kbtn, opacity: count === 0 ? 0.4 : 1 }}><ChevronLeft className="w-3 h-3" /></button>
            <button data-testid={`kf-punch-${d.prop}-${d.axis ?? "s"}`} title={here ? "删除此帧" : "在当前时间打帧"} onClick={() => punch(d.prop, d.axis)}
              style={{ ...kbtn, borderColor: here ? "oklch(0.6 0.16 265 / 0.7)" : "var(--c-bd2, #3a3a3a)", color: here ? "oklch(0.78 0.16 265)" : (count > 0 ? "var(--c-t2, #bbb)" : "var(--c-t4, #666)") }}>
              <Diamond className="w-2.5 h-2.5" style={here ? { fill: "oklch(0.7 0.16 265)" } : undefined} />
            </button>
            <button title="下一关键帧" onClick={() => jump(d.prop, d.axis, 1)} disabled={count === 0} style={{ ...kbtn, opacity: count === 0 ? 0.4 : 1 }}><ChevronRight className="w-3 h-3" /></button>
          </div>
        );
      })}

      {/* 设置曲线（当前帧缓动）——仅当当前时间落在关键帧上时可用 */}
      <div style={{ marginTop: 4, paddingTop: 6, borderTop: "1px solid var(--c-bd3, #2a2a2a)", opacity: onKfHere ? 1 : 0.45, pointerEvents: onKfHere ? "auto" : "none" }}>
        <div style={{ fontWeight: 700, color: "var(--c-t2, #ccc)", marginBottom: 4 }}>设置曲线（当前帧缓动）{!onKfHere && <span style={{ fontWeight: 400, color: "var(--c-t4, #666)" }}> · 跳到关键帧后可编辑</span>}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <BezierEditor value={curEasing} onChange={applyEasing} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <select data-testid="tl-easing-preset" value={presetName(curEasing)} onChange={(e) => { const b = EASING_PRESETS[e.target.value]; if (b) applyEasing(b); }}
              className="nodrag" style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--c-input, #1c1d21)", border: "1px solid var(--c-bd2, #333)", color: "var(--c-t1, #eee)" }}>
              {Object.keys(EASING_PRESETS).map((k) => <option key={k} value={k}>{EASING_LABEL[k] ?? k}</option>)}
              {presetName(curEasing) === "custom" && <option value="custom">自定义</option>}
            </select>
            <div style={{ fontSize: 9.5, fontFamily: "monospace", color: "var(--c-t4, #777)", lineHeight: 1.5 }}>
              cubic-bezier(<br />{curEasing.map((n) => n.toFixed(2)).join(", ")})
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const EASING_LABEL: Record<string, string> = {
  linear: "线性", ease: "ease", easeIn: "缓入", easeOut: "缓出", easeInOut: "缓入缓出",
  easeInBack: "回弹入", easeOutBack: "回弹出",
};
function presetName(bez: Bezier): string {
  for (const [k, v] of Object.entries(EASING_PRESETS)) {
    if (v.every((n, i) => Math.abs(n - bez[i]) < 1e-3)) return k;
  }
  return "custom";
}
