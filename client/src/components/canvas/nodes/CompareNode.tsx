import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Columns2, Play, Pause } from "lucide-react";
import { BaseNode } from "../BaseNode";
import { MediaImage } from "../MediaImage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { detectUpstreamImages, listUpstreamVideoSources } from "../../../lib/comfyWorkflowParams";
import { mediaFetchUrl } from "@/lib/download";
import type { CompareNodeData } from "../../../../../shared/types";

interface Props {
  id: string;
  selected?: boolean;
  data: { nodeType: "compare"; title: string; payload: CompareNodeData; projectId: number };
}

const tag: React.CSSProperties = { fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6, background: "rgba(0,0,0,0.6)", color: "#fff", pointerEvents: "none" };
const isVideoUrl = (u?: string) => !!u && /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);

/** 对比（滑块）节点：两路上游媒体 A/B 叠放，中间拖滑块左右揭示——左=A、右=B。
 *  图片、视频均可（视频同步播放：A 为主时钟，B 偏差 >0.3s 即校正；静音循环）。
 *  纯前端、无生成、无扣费。生成类节点操作条「对比」/版本历史「对比」会自动建本节点。 */
export const CompareNode = memo(function CompareNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = (data.payload ?? {}) as CompareNodeData;
  // 上游媒体源（视频优先于图像；返回 join 字符串保持引用稳定，避免每次 store 变动重渲）。
  const upstreamKey = useCanvasStore((s) => {
    const vids = listUpstreamVideoSources(id, s.edges, s.nodes).map((v) => v.url);
    const imgs = detectUpstreamImages(id, s.edges, s.nodes);
    return [...vids, ...imgs].join("\n");
  });
  const ups = upstreamKey ? upstreamKey.split("\n") : [];
  const a = payload.aUrl ?? ups[0];
  const b = payload.bUrl ?? ups[1];
  const pos = Math.min(1, Math.max(0, payload.slider ?? 0.5));
  const anyVideo = isVideoUrl(a) || isVideoUrl(b);

  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const setPos = useCallback((clientX: number) => {
    const el = boxRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    updateNodeData(id, { slider: v }, true); // 拖拽为瞬时，不写撤销历史
  }, [id, updateNodeData]);
  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    dragRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setPos(e.clientX);
  };
  const onMove = (e: React.PointerEvent) => { if (dragRef.current) setPos(e.clientX); };
  const onUp = (e: React.PointerEvent) => { dragRef.current = false; (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); };

  // ── 视频同步播放：A 为主时钟；B 与 A 偏差 >0.3s 即校正。静音循环（对比看画面）。
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const va = aRef.current, vb = bRef.current;
    const anyV = va ?? vb;
    if (!anyV) return;
    if (playing) { va?.pause(); vb?.pause(); setPlaying(false); }
    else { void va?.play(); void vb?.play(); setPlaying(true); }
  };
  const onATime = () => {
    const va = aRef.current, vb = bRef.current;
    if (va && vb && Math.abs(va.currentTime - vb.currentTime) > 0.3) vb.currentTime = va.currentTime;
  };
  // 源变更时复位播放态。
  useEffect(() => { setPlaying(false); }, [a, b]);

  const renderMedia = (url: string, label: "A" | "B", ref?: React.RefObject<HTMLVideoElement | null>, overlay?: boolean) => {
    const common: React.CSSProperties = overlay
      ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }
      : { display: "block", width: "100%", pointerEvents: "none" };
    if (isVideoUrl(url)) {
      return (
        <video
          ref={ref ?? undefined}
          src={mediaFetchUrl(url)}
          muted loop playsInline preload="metadata"
          onTimeUpdate={label === "A" ? onATime : undefined}
          onEnded={() => setPlaying(false)}
          style={common}
        />
      );
    }
    return <MediaImage src={url} alt={label} draggable={false} style={common} />;
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="compare" title={data.title} minHeight={200}>
      <div className="p-2">
        {a && b ? (
          <div
            ref={boxRef}
            className="nodrag relative rounded-lg overflow-hidden"
            style={{ width: "100%", background: "var(--c-canvas)", cursor: "ew-resize", userSelect: "none", touchAction: "none" }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
          >
            {/* A 铺满（分隔线左侧可见） */}
            {renderMedia(a, "A", aRef)}
            {/* B 覆盖，裁到分隔线右侧（右侧可见 B） */}
            <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${pos * 100}%)` }}>
              {renderMedia(b, "B", bRef, true)}
            </div>
            {/* 分隔线 + 圆形手柄 */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos * 100}%`, width: 2, background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.45)", transform: "translateX(-1px)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: "50%", left: `${pos * 100}%`, transform: "translate(-50%,-50%)", width: 26, height: 26, borderRadius: 99, background: "#fff", boxShadow: "0 1px 5px rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <Columns2 size={14} color="#333" />
            </div>
            <span style={{ position: "absolute", left: 6, top: 6, ...tag }}>A</span>
            <span style={{ position: "absolute", right: 6, top: 6, ...tag }}>B</span>
            {/* 视频对比：左下角同步播放/暂停（两路同起同停，A 为主时钟） */}
            {anyVideo && (
              <button
                onClick={togglePlay}
                onPointerDown={(e) => e.stopPropagation()}
                title={playing ? "暂停（两路同步）" : "同步播放两路视频"}
                style={{ position: "absolute", left: 8, bottom: 8, width: 30, height: 30, borderRadius: 99, background: "rgba(0,0,0,0.62)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" }}
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
            )}
          </div>
        ) : (
          <div style={{ padding: 22, textAlign: "center", fontSize: 12, color: "var(--c-t3)", lineHeight: 1.7 }}>
            连入两路图像或视频（生图 / 视频任务 / ComfyUI / 素材 / 分镜）<br />拖动中间滑块左右对比；两路视频可同步播放对比
            {a && !b && <div style={{ marginTop: 6, fontSize: 11, color: "var(--c-t4)" }}>已连 1 路，还差 1 路</div>}
          </div>
        )}
      </div>
    </BaseNode>
  );
});
