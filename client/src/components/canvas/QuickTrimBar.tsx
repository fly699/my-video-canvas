import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Keyboard, Loader2, Play, Pause, Repeat, Magnet } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { mediaFetchUrl } from "@/lib/download";

/**
 * 视频节点「快速剪辑」条（对齐 LibTV 图五）：屏幕底部固定条——
 * × 取消｜⌨ 快捷键面板｜视频缩略 + 双滑块选区（显示选区时长）｜循环开关｜✓ 确认。
 * 确认走既有 clip.trimVideo（服务端 ffmpeg），完成后回调 onDone(url, duration)。
 *
 * 快捷键（挂 window，焦点在输入框时跳过）：
 *   ←/→ 移动选区 ｜ ↑/↓ 扩/缩选区 ｜ I/O 以播放头设入/出点 ｜ 按住 Shift 精确(0.01s)
 *   ⌘/Ctrl+↑↓ 快速调整(1s) ｜ Space 播放/暂停 ｜ Enter 确认剪辑 ｜ Esc 退出
 */
const fmt = (s: number) => `${s.toFixed(2)} s`;

export function QuickTrimBar({ videoUrl, projectId, nodeId, onClose, onDone }: {
  videoUrl: string;
  projectId: number;
  nodeId: string;
  onClose: () => void;
  onDone: (url: string, duration: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [kbdOpen, setKbdOpen] = useState(false);
  // 整秒磁吸：开启时拖动手柄吸附到整秒（键盘微调不受影响，仍可精确）。
  const [snap, setSnap] = useState(true);
  // 快捷键/拖拽 handler 里读最新值用 refs（listener 只挂一次）。
  const stRef = useRef({ start: 0, end: 0, duration: 0, loop: true, snap: true });
  stRef.current = { start, end, duration, loop, snap };
  // 自绘手柄拖拽（替代叠加双 range——上层 range 会永远盖住入点手柄，导致前段裁不了）。
  const dragRef2 = useRef<"start" | "end" | null>(null);
  const posToTime = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !stRef.current.duration) return 0;
    return Math.max(0, Math.min(stRef.current.duration, ((clientX - r.left) / r.width) * stRef.current.duration));
  };
  const applyDrag = (which: "start" | "end", t: number) => {
    const v = stRef.current.snap ? Math.round(t) : t;
    if (which === "start") setStart(Math.min(v, stRef.current.end - 0.2));
    else setEnd(Math.min(stRef.current.duration, Math.max(v, stRef.current.start + 0.2)));
  };

  const trimMutation = trpc.clip.trimVideo.useMutation({
    onSuccess: (r) => { toast.success("剪辑完成，已替换为选区结果"); onDone(r.url, r.duration); onClose(); },
    onError: (e) => toast.error("剪辑失败：" + e.message),
  });
  const busy = trimMutation.isPending;

  const confirm = useCallback(() => {
    const { start: s, end: e2 } = stRef.current;
    if (busy) return;
    if (!(e2 - s >= 0.2)) { toast.error("选区太短（至少 0.2 秒）"); return; }
    trimMutation.mutate({ inputUrl: videoUrl, startTime: s, endTime: e2, projectId, nodeId });
  }, [busy, trimMutation, videoUrl, projectId, nodeId]);
  const confirmRef = useRef(confirm); confirmRef.current = confirm;
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { if (v.currentTime < stRef.current.start || v.currentTime >= stRef.current.end) v.currentTime = stRef.current.start; void v.play(); }
    else v.pause();
  }, []);
  const togglePlayRef = useRef(togglePlay); togglePlayRef.current = togglePlay;

  // 播放循环：越过出点 → 回入点（loop）或暂停。
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    setCurrent(v.currentTime);
    const { start: s, end: e2, loop: lp } = stRef.current;
    if (e2 > s && v.currentTime >= e2) {
      if (lp) { v.currentTime = s; }
      else { v.pause(); }
    }
  };

  // 全局快捷键。
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      const { start: s, end: e2, duration: d } = stRef.current;
      const step = e.shiftKey ? 0.01 : (e.metaKey || e.ctrlKey) ? 1 : 0.1;
      const clamp = (v: number) => Math.max(0, Math.min(d, v));
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCloseRef.current(); }
      else if (e.key === "Enter") { e.preventDefault(); confirmRef.current(); }
      else if (e.key === " ") { e.preventDefault(); togglePlayRef.current(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const delta = e.key === "ArrowLeft" ? -step : step;
        const w = e2 - s;
        const ns = clamp(s + delta);
        setStart(ns); setEnd(Math.min(d, ns + w));
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? step : -step;
        setEnd(Math.max(s + 0.2, clamp(e2 + delta)));
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        const t = videoRef.current?.currentTime ?? 0;
        setStart(Math.min(t, e2 - 0.2));
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        const t = videoRef.current?.currentTime ?? d;
        setEnd(Math.max(t, s + 0.2));
      }
    };
    // capture 阶段抢在画布快捷键（Esc 取消选中等）之前处理。
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  const pct = (v: number) => (duration > 0 ? `${(v / duration) * 100}%` : "0%");
  const KBD_ROWS: { label: string; keys: string }[] = [
    { label: "移动选区", keys: "← →" },
    { label: "扩展/收缩选区", keys: "↑ ↓" },
    { label: "设置入点/出点", keys: "I / O" },
    { label: "精确模式", keys: "按住 Shift" },
    { label: "快速调整", keys: "⌘/Ctrl + ↑↓" },
    { label: "播放/暂停", keys: "Space" },
    { label: "确认剪辑", keys: "Enter" },
    { label: "退出", keys: "Esc" },
  ];

  return createPortal(
    <div className="nodrag" style={{ position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", zIndex: 70, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 16, background: "color-mix(in oklch, var(--c-base) 94%, transparent)", backdropFilter: "blur(20px)", border: "1px solid var(--c-bd2)", boxShadow: "0 18px 50px oklch(0 0 0 / 0.55)", maxWidth: "min(860px, 94vw)" }}>
      {/* × 取消 */}
      <button onClick={onClose} title="退出（Esc）"
        style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t2)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <X size={16} />
      </button>
      {/* ⌨ 快捷键 */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button onClick={() => setKbdOpen((v) => !v)} title="快捷键"
          style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--c-bd2)", background: kbdOpen ? "var(--c-elevated)" : "var(--c-surface)", color: "var(--c-t2)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Keyboard size={15} />
        </button>
        {kbdOpen && (
          <div style={{ position: "absolute", bottom: "calc(100% + 12px)", left: 0, width: 250, padding: 12, borderRadius: 12, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 12px 36px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", gap: 7 }}>
            {KBD_ROWS.map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--c-t2)" }}>{r.label}</span>
                <span className="font-mono" style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)", whiteSpace: "nowrap" }}>{r.keys}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 预览 + 选区轨道 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div style={{ position: "relative", width: 96, height: 54, borderRadius: 8, overflow: "hidden", background: "#000", flexShrink: 0 }}>
          <video
            ref={videoRef}
            src={mediaFetchUrl(videoUrl)}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => { const d = (e.target as HTMLVideoElement).duration || 0; setDuration(d); setStart(0); setEnd(d); }}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          <button onClick={togglePlay} title="播放/暂停（Space）"
            style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: playing ? "transparent" : "oklch(0 0 0 / 0.35)", border: "none", cursor: "pointer", color: "#fff" }}>
            {!playing && <Play size={18} />}
            {playing && <Pause size={16} style={{ opacity: 0 }} />}
          </button>
        </div>
        {/* 轨道 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "min(380px, 40vw)" }}>
          <div
            ref={trackRef}
            onPointerDown={(e) => {
              if (!duration) return;
              e.preventDefault(); e.stopPropagation();
              const t = posToTime(e.clientX);
              // 就近吸附：按下点离哪个手柄近就拖哪个 → 入点/出点都能拖（修复前段裁不了）。
              const which = Math.abs(t - stRef.current.start) <= Math.abs(t - stRef.current.end) ? "start" : "end";
              dragRef2.current = which;
              applyDrag(which, t);
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => { if (dragRef2.current) applyDrag(dragRef2.current, posToTime(e.clientX)); }}
            onPointerUp={() => { dragRef2.current = null; }}
            onPointerCancel={() => { dragRef2.current = null; }}
            style={{ position: "relative", height: 34, borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", overflow: "hidden", cursor: "ew-resize", touchAction: "none" }}>
            {/* 选区 */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(start), width: duration > 0 ? `${((end - start) / duration) * 100}%` : "100%", background: "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 22%, transparent)", border: "1px solid color-mix(in oklab, var(--ui-accent, var(--c-accent)) 55%, transparent)", pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--c-t1)", textShadow: "0 1px 2px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>{fmt(Math.max(0, end - start))}</span>
            </div>
            {/* 播放头 */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(Math.min(Math.max(current, 0), duration)), width: 2, background: "var(--c-t1)", pointerEvents: "none" }} />
            {/* 手柄视觉（拖拽由轨道 pointer 事件统一处理：就近吸附入/出点） */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(start), width: 5, borderRadius: 2, background: "var(--ui-accent, var(--c-accent))", pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${pct(end)} - 5px)`, width: 5, borderRadius: 2, background: "var(--ui-accent, var(--c-accent))", pointerEvents: "none" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--c-t4)" }}>
            <span>入 {fmt(start)}</span>
            <span>全长 {fmt(duration)}</span>
            <span>出 {fmt(end)}</span>
          </div>
        </div>
      </div>
      {/* 整秒磁吸开关：拖动手柄吸附到整秒（键盘微调不受影响） */}
      <button onClick={() => setSnap((v) => !v)} title={snap ? "整秒磁吸（开）——拖动吸附到整秒" : "整秒磁吸（关）——自由拖动"}
        style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${snap ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 55%, transparent)" : "var(--c-bd2)"}`, background: snap ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 14%, var(--c-surface))" : "var(--c-surface)", color: snap ? "var(--c-t1)" : "var(--c-t3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Magnet size={14} />
      </button>
      {/* 循环开关 */}
      <button onClick={() => setLoop((v) => !v)} title={loop ? "选区循环播放（开）" : "选区循环播放（关）"}
        style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${loop ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 55%, transparent)" : "var(--c-bd2)"}`, background: loop ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 14%, var(--c-surface))" : "var(--c-surface)", color: loop ? "var(--c-t1)" : "var(--c-t3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Repeat size={14} />
      </button>
      {/* ✓ 确认 */}
      <button onClick={confirm} disabled={busy} title="确认剪辑（Enter）"
        style={{ width: 44, height: 40, borderRadius: 12, border: "none", background: busy ? "var(--c-surface)" : "var(--c-t1)", color: busy ? "var(--c-t4)" : "var(--c-base)", cursor: busy ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={18} />}
      </button>
    </div>,
    document.body,
  );
}
