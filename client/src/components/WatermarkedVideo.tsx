import { useEffect, useRef, useState, type VideoHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Repeat, X, ChevronLeft, ChevronRight, Gauge, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Drop-in `<video>` with two always-available conveniences overlaid on the player:
 *  • a 循环播放 (loop) toggle, just after the native play control, and
 *  • a watermark-safe 全屏 (放大预览) button when the identity watermark is enabled.
 *
 * Native `<video>`-element fullscreen renders no DOM children, so a DOM watermark
 * can never overlay it. When the watermark is on we hide the native fullscreen
 * button and instead open an **in-app enlarged preview** (a fixed overlay that fills
 * the viewport but stays inside the page — NOT the browser Fullscreen API). The
 * global WatermarkOverlay's page-level layer (position:fixed, z-index 2147483600)
 * sits ABOVE this overlay, so the identity watermark is painted over the enlarged
 * video automatically — no OS/browser fullscreen (「网页全屏」) needed.
 */
export function WatermarkedVideo({ block, ...props }: VideoHTMLAttributes<HTMLVideoElement> & { block?: boolean }) {
  const { user } = useAuth();
  const { data } = trpc.system.mediaProtection.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const wm = !!user && !!data?.watermarkEnabled;
  const [loop, setLoop] = useState(false);
  const [big, setBig] = useState(false);
  // 逐帧 / 倍速：作用于原生 <video>，不引入新的 <video> 元素——nodownload / 禁右键 / 水印全部沿用。
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const SPEEDS = [1, 1.5, 2, 0.5];
  const [speed, setSpeed] = useState(1);
  const FRAME = 1 / 30; // 无法从元素取真实帧率，按 30fps 估一帧步进
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);
  const cycleSpeed = () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length] ?? 1);
  // 阻断指针按下冒泡到 React Flow 节点：这些叠加控件在收起态即可见，点击若冒泡会把节点选中→展开配置区。
  const stopToNode = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const stepFrame = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(dur, v.currentTime + dir * FRAME));
  };

  // ── #83 创意模式：hover 自动播放 + 轻量自绘控制条（替代厚重的原生 controls）──
  // 不依赖 React context（本组件也会在画布 Provider 之外使用），直接读 :root 的
  // data-canvas-mode 标记（与 index.css 创意皮肤覆盖同一信号源）。
  const creative = typeof document !== "undefined" && document.documentElement.getAttribute("data-canvas-mode") === "creative";
  const hoverPlayed = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [mutedUi, setMutedUi] = useState(false);
  const fmt = (s: number) => { const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  useEffect(() => {
    if (!creative) return;
    const v = videoRef.current; if (!v) return;
    const onT = () => setCur(v.currentTime);
    const onD = () => setDur(Number.isFinite(v.duration) ? v.duration : 0);
    const onP = () => setPlaying(!v.paused);
    const onVol = () => setMutedUi(v.muted);
    v.addEventListener("timeupdate", onT); v.addEventListener("durationchange", onD); v.addEventListener("loadedmetadata", onD);
    v.addEventListener("play", onP); v.addEventListener("pause", onP); v.addEventListener("volumechange", onVol);
    onD(); onP(); onVol();
    return () => {
      v.removeEventListener("timeupdate", onT); v.removeEventListener("durationchange", onD); v.removeEventListener("loadedmetadata", onD);
      v.removeEventListener("play", onP); v.removeEventListener("pause", onP); v.removeEventListener("volumechange", onVol);
    };
  }, [creative, props.src]);
  // hover 播放：浏览器自动播放策略可能拒绝带声播放——被拒时静音重试（预览场景可接受）。
  const hoverPlay = () => {
    const v = videoRef.current; if (!v || !v.paused || !v.currentSrc) return;
    v.play().then(() => { hoverPlayed.current = true; }).catch(() => {
      v.muted = true; setMutedUi(true);
      v.play().then(() => { hoverPlayed.current = true; }).catch(() => { /* 无源/加载失败 */ });
    });
  };
  const hoverPause = () => {
    const v = videoRef.current;
    if (v && hoverPlayed.current) { v.pause(); hoverPlayed.current = false; }
  };

  // 放大预览打开时自动暂停内联预览：放大层是另一个独立的 <video autoPlay>，
  // 不停内联（尤其 hover 自动播放中）会两路同播——双声音、双解码器。关闭后不自动续播。
  useEffect(() => {
    if (!big) return;
    const v = videoRef.current;
    if (v && !v.paused) { v.pause(); hoverPlayed.current = false; }
  }, [big]);

  // 关闭放大预览：Esc。#126 加固：capture + 阻断——放大层开着时 Esc 只关它，
  // 不连带触发画布的 Esc 副作用（取消选中/关菜单），也不被其它监听抢走。
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setBig(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [big]);

  // 始终去掉原生控件的「下载 / 远程投放」项（移动端 Chrome 的 ⋮ 菜单里也不再有下载）；
  // 水印开启时再额外禁用原生全屏（原生全屏不渲染 DOM 子节点，水印盖不上）——统一走应用内放大预览。
  const controlsList = [props.controlsList, "nodownload", "noremoteplayback", wm ? "nofullscreen" : ""].filter(Boolean).join(" ");
  const noMenu = (e: React.MouseEvent<HTMLVideoElement>) => { if (props.onContextMenu) props.onContextMenu(e); else e.preventDefault(); };

  return (
    <div
      className="wm-video-wrap"
      onMouseEnter={creative ? hoverPlay : undefined}
      onMouseLeave={creative ? hoverPause : undefined}
      style={{ position: "relative", display: block ? "block" : "inline-block", width: block ? "100%" : undefined, lineHeight: 0 }}
    >
      {/* #83 创意模式去掉厚重原生 controls，改用底部轻量自绘条；其它模式原样 */}
      <video ref={videoRef} {...props} controls={creative ? false : props.controls} loop={loop} controlsList={controlsList} disablePictureInPicture onContextMenu={noMenu}
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = speed; props.onLoadedMetadata?.(e); }} />
      {creative && (
        <div className="wm-slim nodrag" onPointerDown={stopToNode} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="wm-slim-btn" title={playing ? "暂停" : "播放"} aria-label="播放/暂停"
            onClick={() => { const v = videoRef.current; if (!v) return; hoverPlayed.current = false; if (v.paused) v.play().catch(() => { /* ignore */ }); else v.pause(); }}>
            {playing ? <Pause /> : <Play />}
          </button>
          <span className="wm-slim-time">{fmt(cur)} / {fmt(dur)}</span>
          <div className="wm-slim-track" title="点击定位"
            onClick={(e) => { const v = videoRef.current; if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.duration; }}>
            <div className="wm-slim-fill" style={{ width: `${dur > 0 ? Math.min(100, (cur / dur) * 100) : 0}%` }} />
          </div>
          <button type="button" className="wm-slim-btn" title={mutedUi ? "取消静音" : "静音"} aria-label="静音切换"
            onClick={() => { const v = videoRef.current; if (!v) return; v.muted = !v.muted; setMutedUi(v.muted); }}>
            {mutedUi ? <VolumeX /> : <Volume2 />}
          </button>
        </div>
      )}
      <button
        type="button"
        onPointerDown={stopToNode}
        onClick={(e) => { e.stopPropagation(); setLoop((v) => !v); }}
        title={loop ? "循环播放：开（点击关闭）" : "循环播放：关（点击开启）"}
        aria-label="循环播放"
        className="wm-loop-btn nodrag"
        data-on={loop ? "true" : "false"}
      >
        <Repeat style={{ width: 14, height: 14 }} />
      </button>
      {/* 逐帧步进 + 倍速（hover 显示，位于循环钮右侧）。nodrag 防止触发画布拖拽；
          onPointerDown 阻断冒泡，避免点击这些叠加钮时把节点选中→展开配置区。 */}
      <div className="wm-vctrl-row nodrag" onPointerDown={stopToNode}>
        <button type="button" className="wm-vctrl" title="上一帧" aria-label="上一帧" onClick={(e) => { e.stopPropagation(); stepFrame(-1); }}>
          <ChevronLeft style={{ width: 14, height: 14 }} />
        </button>
        <button type="button" className="wm-vctrl" title="下一帧" aria-label="下一帧" onClick={(e) => { e.stopPropagation(); stepFrame(1); }}>
          <ChevronRight style={{ width: 14, height: 14 }} />
        </button>
        <button type="button" className="wm-vctrl" data-wide title={`播放速度 ${speed}×（点击切换）`} aria-label="播放速度" onClick={(e) => { e.stopPropagation(); cycleSpeed(); }}>
          <Gauge style={{ width: 12, height: 12 }} /> {speed}×
        </button>
      </div>
      {wm && (
        <button type="button" onPointerDown={stopToNode} onClick={(e) => { e.stopPropagation(); setBig(true); }} title="放大预览（含水印）" aria-label="放大预览" className="wm-fs-btn nodrag">
          <Maximize2 style={{ width: 16, height: 16 }} />
        </button>
      )}
      {big && createPortal(
        <div
          onClick={() => setBig(false)}
          style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <video
            src={props.src}
            poster={props.poster}
            controls
            autoPlay
            loop={loop}
            controlsList={controlsList}
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
            // width/height 撑满视口 + contain：小分辨率视频也放大铺满（原 maxWidth/maxHeight
            // 只封顶不放大，720p 素材在大屏上只占中间一小块，看起来「全屏还是小窗口」）。
            style={{ width: "96vw", height: "92vh", objectFit: "contain", background: "transparent" }}
          />
          <button
            type="button"
            onClick={() => setBig(false)}
            aria-label="关闭"
            style={{ position: "fixed", top: 16, right: 16, width: 40, height: 40, borderRadius: 999, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
