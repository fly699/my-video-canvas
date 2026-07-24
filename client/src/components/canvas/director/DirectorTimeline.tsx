// #329 导演台动画层批2：底部时间线 UI（自包含展示 + 交互组件）。
// 消费批1 纯函数（directorTimeline.ts）。props 接口对上层解耦：上层持有 timeline/currentTime/
// playing 并负责 rAF 回放驱动与持久化；本组件只渲染轨道/子轨/关键帧◇/标尺/播放头，并回调
// onSeek / onTogglePlay / onToggleLoop / onSelectTrack / onChange（时长/缩放等编辑）。
import { useMemo, useRef, useState, useCallback } from "react";
import { Play, Pause, Repeat, Maximize2, Diamond, Plus } from "lucide-react";
import type { DirectorTimeline, DirectorTrack } from "../../../../../shared/types";
import { timelineTicks, trackKeyframeTimes, fmtTime, clamp, makeTrack } from "@/lib/directorTimeline";

const LABEL_W = 132;   // 左侧轨道标签列宽
const ROW_H = 26;      // 每条轨道行高
const RULER_H = 22;
const KIND_LABEL: Record<DirectorTrack["targetKind"], string> = { camera: "机位", actor: "角色", prop: "道具" };
const KIND_HUE: Record<DirectorTrack["targetKind"], number> = { camera: 265, actor: 150, prop: 40 };

export interface DirectorTimelineProps {
  timeline: DirectorTimeline;
  currentTime: number;
  playing: boolean;
  selectedId?: string;
  /** 当前选中对象（用于「+ 为选中对象加轨道」）；无则不显示该按钮。 */
  selectedTarget?: { id: string; kind: DirectorTrack["targetKind"] };
  /** 解析对象显示名（如「主角」「机位1」）；缺省用 kind+id。 */
  labelOf?: (track: DirectorTrack) => string;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onSelectTrack?: (targetId: string) => void;
  /** 时长/缩放等对时间线本体的编辑（关键帧打点在批3）。 */
  onChange?: (tl: DirectorTimeline) => void;
}

export function DirectorTimeline({
  timeline, currentTime, playing, selectedId, selectedTarget, labelOf,
  onSeek, onTogglePlay, onToggleLoop, onSelectTrack, onChange,
}: DirectorTimelineProps) {
  const [pxPerSec, setPxPerSec] = useState(80);
  const laneRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(0.001, timeline.duration);
  const contentW = dur * pxPerSec;
  const ticks = useMemo(() => timelineTicks(dur, pxPerSec), [dur, pxPerSec]);

  // 指针 x → 时间（考虑横向滚动）
  const xToTime = useCallback((clientX: number): number => {
    const el = laneRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    return clamp(x / pxPerSec, 0, dur);
  }, [pxPerSec, dur]);

  const draggingRef = useRef(false);
  const onScrubDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    onSeek(xToTime(e.clientX));
  };
  const onScrubMove = (e: React.PointerEvent) => { if (draggingRef.current) onSeek(xToTime(e.clientX)); };
  const onScrubUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const fitWindow = () => {
    const el = laneRef.current;
    if (!el) return;
    const avail = el.clientWidth - 12;
    if (avail > 40) setPxPerSec(clamp(avail / dur, 8, 400));
  };

  const btn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 22, borderRadius: 6, cursor: "pointer", background: "var(--c-input, #222)", border: "1px solid var(--c-bd2, #3a3a3a)", color: "var(--c-t1, #eee)" };
  const playheadX = currentTime * pxPerSec;

  return (
    <div data-testid="director-timeline" style={{ display: "flex", flexDirection: "column", background: "var(--c-panel, #17181b)", borderTop: "1px solid var(--c-bd2, #333)", color: "var(--c-t1, #eee)", fontSize: 11, userSelect: "none" }}>
      {/* 工具条 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: "1px solid var(--c-bd3, #2a2a2a)" }}>
        <button data-testid="tl-play" onClick={onTogglePlay} title={playing ? "暂停 (空格)" : "播放 (空格)"} style={btn}>
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button data-testid="tl-loop" onClick={onToggleLoop} title="循环" style={{ ...btn, color: timeline.loop ? "oklch(0.72 0.16 265)" : "var(--c-t3, #888)", borderColor: timeline.loop ? "oklch(0.6 0.16 265 / 0.6)" : "var(--c-bd2, #3a3a3a)" }}>
          <Repeat className="w-3.5 h-3.5" />
        </button>
        <span data-testid="tl-time" style={{ fontFamily: "monospace", fontSize: 11, color: "var(--c-t2, #bbb)", minWidth: 92 }}>
          {fmtTime(currentTime)} / {fmtTime(dur)}
        </span>
        <button onClick={fitWindow} title="适应窗口" style={{ ...btn, width: "auto", padding: "0 8px", gap: 4 }}>
          <Maximize2 className="w-3 h-3" /> 适应
        </button>
        {selectedTarget && !timeline.tracks.some((t) => t.targetId === selectedTarget.id) && (
          <button data-testid="tl-add-track" title="为当前选中对象新建动画轨道"
            onClick={() => { onChange?.({ ...timeline, tracks: [...timeline.tracks, makeTrack(selectedTarget.id, selectedTarget.kind)] }); onSelectTrack?.(selectedTarget.id); }}
            style={{ ...btn, width: "auto", padding: "0 8px", gap: 4, color: "oklch(0.75 0.16 150)", borderColor: "oklch(0.6 0.16 150 / 0.5)" }}>
            <Plus className="w-3 h-3" /> 轨道
          </button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span style={{ color: "var(--c-t3, #888)" }}>缩放</span>
          <input data-testid="tl-zoom" type="range" min={8} max={400} step={1} value={pxPerSec}
            onChange={(e) => setPxPerSec(Number(e.target.value))} style={{ width: 120 }} />
        </div>
      </div>

      {/* 轨道区：左标签列 + 右滚动泳道 */}
      <div style={{ display: "flex", maxHeight: 220, overflow: "hidden" }}>
        {/* 左标签列 */}
        <div style={{ width: LABEL_W, flexShrink: 0, borderRight: "1px solid var(--c-bd3, #2a2a2a)" }}>
          <div style={{ height: RULER_H, borderBottom: "1px solid var(--c-bd3, #2a2a2a)", display: "flex", alignItems: "center", padding: "0 8px", color: "var(--c-t3, #888)", fontSize: 10 }}>轨道</div>
          <div style={{ overflowY: "auto", maxHeight: 220 - RULER_H }}>
            {timeline.tracks.length === 0 && (
              <div style={{ padding: "10px 8px", color: "var(--c-t4, #666)", fontSize: 10, lineHeight: 1.6 }}>暂无动画轨道<br />选中对象后「绘制轨迹 / 打帧」建立</div>
            )}
            {timeline.tracks.map((tr) => {
              const on = tr.targetId === selectedId;
              const hue = KIND_HUE[tr.targetKind];
              return (
                <div key={tr.targetId} data-testid={`tl-track-label-${tr.targetId}`} onClick={() => onSelectTrack?.(tr.targetId)}
                  style={{ height: ROW_H, display: "flex", alignItems: "center", gap: 6, padding: "0 8px", cursor: "pointer",
                    background: on ? `oklch(0.6 0.14 ${hue} / 0.16)` : "transparent", borderBottom: "1px solid var(--c-bd3, #232323)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: `oklch(0.7 0.16 ${hue})`, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: on ? "var(--c-t1, #fff)" : "var(--c-t2, #bbb)" }}>
                    {labelOf ? labelOf(tr) : `${KIND_LABEL[tr.targetKind]} ${tr.targetId.slice(0, 4)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右泳道（可横向滚动） */}
        <div ref={laneRef} style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <div style={{ width: Math.max(contentW, 40), position: "relative" }}>
            {/* 标尺 */}
            <div data-testid="tl-ruler" onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubUp}
              style={{ height: RULER_H, borderBottom: "1px solid var(--c-bd3, #2a2a2a)", position: "sticky", top: 0, background: "var(--c-panel, #17181b)", cursor: "text", zIndex: 2 }}>
              {ticks.map((t) => (
                <div key={t} style={{ position: "absolute", left: t * pxPerSec, top: 0, height: RULER_H, borderLeft: "1px solid var(--c-bd3, #333)", paddingLeft: 3, fontSize: 9, color: "var(--c-t3, #888)", lineHeight: `${RULER_H}px` }}>{fmtTime(t)}</div>
              ))}
            </div>

            {/* 轨道泳道 */}
            <div style={{ position: "relative" }}>
              {timeline.tracks.map((tr) => {
                const on = tr.targetId === selectedId;
                const hue = KIND_HUE[tr.targetKind];
                const kfTimes = trackKeyframeTimes(tr);
                const clip = tr.clip;
                return (
                  <div key={tr.targetId} data-testid={`tl-track-lane-${tr.targetId}`}
                    style={{ height: ROW_H, borderBottom: "1px solid var(--c-bd3, #232323)", position: "relative", background: on ? `oklch(0.6 0.14 ${hue} / 0.08)` : "transparent" }}>
                    {/* clip 活动区间条 */}
                    {clip && (
                      <div style={{ position: "absolute", left: clip.start * pxPerSec, width: Math.max(2, (clip.end - clip.start) * pxPerSec), top: ROW_H / 2 - 2, height: 4, borderRadius: 2, background: `oklch(0.6 0.14 ${hue} / 0.4)` }} />
                    )}
                    {/* 有路径时画一条底线示意 */}
                    {tr.path && tr.path.points.length >= 2 && (
                      <div style={{ position: "absolute", left: 0, right: 0, top: ROW_H / 2, height: 1, background: `oklch(0.6 0.14 ${hue} / 0.3)` }} />
                    )}
                    {/* 关键帧◇ */}
                    {kfTimes.map((t) => (
                      <div key={t} data-testid={`tl-kf-${tr.targetId}`} title={`关键帧 @ ${fmtTime(t)}`}
                        onClick={(e) => { e.stopPropagation(); onSeek(t); }}
                        style={{ position: "absolute", left: t * pxPerSec - 5, top: ROW_H / 2 - 5, width: 10, height: 10, cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Diamond className="w-2.5 h-2.5" style={{ color: `oklch(0.78 0.16 ${hue})`, fill: `oklch(0.7 0.16 ${hue})` }} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* 播放头（跨标尺+泳道） */}
            <div data-testid="tl-playhead" style={{ position: "absolute", left: playheadX, top: 0, bottom: 0, width: 1, background: "oklch(0.75 0.2 25)", zIndex: 3, pointerEvents: "none" }}>
              <div style={{ position: "absolute", top: 0, left: -4, width: 9, height: 9, background: "oklch(0.75 0.2 25)", clipPath: "polygon(0 0,100% 0,50% 100%)" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
