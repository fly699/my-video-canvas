import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { X, Check, Keyboard, Loader2, Play, Pause, Repeat, Magnet, Gauge, Volume2, VolumeX, Camera, Wand2, Scissors } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { mediaFetchUrl } from "@/lib/download";
import { confirmDialog } from "@/components/ui/dialogService";

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
  // 整秒磁吸：开启时拖动手柄吸附到整秒（键盘微调不受影响，仍可精确）。默认关闭，自由拖动。
  const [snap, setSnap] = useState(false);
  // #127 轻量增强：变速（确认时随剪辑一并应用）+ 静音（去掉原声）。
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
  const [speed, setSpeed] = useState<number>(1);
  const [mute, setMute] = useState(false);
  // 快捷键/拖拽 handler 里读最新值用 refs（listener 只挂一次）。
  const stRef = useRef({ start: 0, end: 0, duration: 0, loop: true, snap: false });
  stRef.current = { start, end, duration, loop, snap };
  // 自绘手柄拖拽（替代叠加双 range——上层 range 会永远盖住入点手柄，导致前段裁不了）。
  // 用户反馈修复：按在选区中段 = "move" 整体平移（保持宽度）；靠近手柄才拖入/出点。
  const dragRef2 = useRef<"start" | "end" | "move" | null>(null);
  const moveGrabRef = useRef(0); // move 模式：按下点相对入点的时间偏移
  const posToTime = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !stRef.current.duration) return 0;
    return Math.max(0, Math.min(stRef.current.duration, ((clientX - r.left) / r.width) * stRef.current.duration));
  };
  // 节点里的预览视频（画布上那个）：快剪期间跟随小预览同步 seek / 播放（静音防双声）。
  const nodeVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const nv = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"] video`) as HTMLVideoElement | null;
    nodeVideoRef.current = nv;
    if (!nv) return;
    const wasMuted = nv.muted;
    nv.muted = true; // 声音只从快剪条预览出，节点侧静音防双声
    if (!nv.paused) nv.pause();
    return () => { nv.muted = wasMuted; nodeVideoRef.current = null; };
  }, [nodeId]);
  // 拖动手柄 = 实时 seek：小预览与节点预览都跳到手柄时间（所拖即所见）。
  const seekBoth = (t: number) => {
    const v = videoRef.current;
    if (v) { if (!v.paused) v.pause(); v.currentTime = t; }
    const nv = nodeVideoRef.current;
    if (nv) { if (!nv.paused) nv.pause(); nv.currentTime = t; }
  };

  const applyDrag = (which: "start" | "end" | "move", t: number) => {
    const { snap: sn, duration: d, start: s, end: e2 } = stRef.current;
    if (which === "move") {
      const w = e2 - s;
      let ns = Math.max(0, Math.min(d - w, t - moveGrabRef.current));
      if (sn) ns = Math.max(0, Math.min(d - w, Math.round(ns)));
      setStart(ns); setEnd(ns + w);
      seekBoth(ns);
      return;
    }
    const v = sn ? Math.round(t) : t;
    if (which === "start") { const nv = Math.min(v, e2 - 0.2); setStart(nv); seekBoth(nv); }
    else { const nv = Math.min(d, Math.max(v, s + 0.2)); setEnd(nv); seekBoth(nv); }
  };

  const trimMutation = trpc.clip.trimVideo.useMutation({
    onSuccess: (r) => { toast.success("剪辑完成，已替换为选区结果"); onDone(r.url, r.duration); onClose(); },
    onError: (e) => toast.error("剪辑失败：" + e.message),
  });
  // #127 截取当前帧：服务端 ffmpeg 抽帧并自动记入素材库（复用剪辑器的 extractFrame）。
  const frameMutation = trpc.clip.extractFrame.useMutation({
    onSuccess: () => toast.success("已截取当前帧，存入素材库（左栏「资产」可见）"),
    onError: (e) => toast.error("截帧失败：" + e.message),
  });
  const busy = trimMutation.isPending;

  // 本机 AI 自动剪辑：ffmpeg silencedetect（零 LLM 成本）找静音段 → 掐头去尾设入/出点。
  const silenceMutation = trpc.clip.detectSilences.useMutation();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [multiCutBusy, setMultiCutBusy] = useState(false);
  // 中段静音单选区跳不过 → 征询后一键生成剪辑器「多段剪除」时间轴并跳转
  //（服务端 editor.silenceCut 复用剪辑器同一条静音剪除管线；原视频与节点不动，剪辑器里可微调后导出）。
  const openMultiCutInEditor = useCallback(async (interior: number) => {
    const d = stRef.current.duration;
    if (!d || multiCutBusy) return;
    const ok = await confirmDialog({
      title: `发现 ${interior} 处中段静音`,
      message: "快剪只有单个选区，跳不过中段静音。是否自动生成「多段剪除」时间轴并打开视频剪辑器？原视频与节点保持不变，剪辑器里可继续微调后导出。",
    });
    if (!ok) return;
    setMultiCutBusy(true);
    toast.info("正在生成多段剪除时间轴…");
    try {
      const v = videoRef.current;
      const w = v?.videoWidth || 1280, h = v?.videoHeight || 720;
      const r = await utils.client.editor.silenceCut.mutate({ assetUrl: videoUrl, durationSec: d, width: w, height: h, fps: 30 });
      if (!r.doc) { toast.info(r.message || "未生成剪辑"); return; }
      const clips = r.doc.tracks.find((t) => t.type === "video")?.clips.length ?? 0;
      const { id } = await utils.client.editor.create.mutate({ name: `静音剪除 · ${clips}段`, projectId, width: w, height: h, fps: 30 });
      await utils.client.editor.save.mutate({ id, doc: r.doc });
      toast.success(`已生成 ${clips} 段剪除结果，正在打开剪辑器…`);
      navigate(`/editor/${id}`);
    } catch (e) {
      toast.error("生成失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setMultiCutBusy(false);
    }
  }, [multiCutBusy, utils, videoUrl, projectId, navigate]);
  // 分割（直接在快剪时间轴上）：S/剪刀按钮在播放头处加切点（纯前端状态，不发请求）；
  // 时间轴上出现切线，点击分段可剔除/恢复，点击切线删除该切点；确认时把保留段一次性合成。
  const [cuts, setCuts] = useState<number[]>([]);
  const [removedSegs, setRemovedSegs] = useState<Set<string>>(new Set());
  const [splitBusy, setSplitBusy] = useState(false);
  const segKey = (a: number, b: number) => `${a.toFixed(3)}|${b.toFixed(3)}`;
  const splitAt = useCallback(() => {
    const { duration: d, start: s, end: e2 } = stRef.current;
    const t = videoRef.current?.currentTime ?? 0;
    if (!d) return;
    if (t <= s + 0.1 || t >= e2 - 0.1) { toast.error("播放头需位于选区内（距两端至少 0.1 秒）——点时间轴或播放到目标位置再分割"); return; }
    setCuts((prev) => (prev.some((c) => Math.abs(c - t) < 0.05) ? prev : [...prev, t].sort((x, y) => x - y)));
  }, []);
  const splitAtRef = useRef(splitAt); splitAtRef.current = splitAt;

  const autoTrim = useCallback(async () => {
    const { duration: d } = stRef.current;
    if (silenceMutation.isPending || !d) return;
    toast.info("本机分析静音中…（不消耗 AI 调用）");
    try {
      const { silences } = await silenceMutation.mutateAsync({ inputUrl: videoUrl, durationSec: d, projectId });
      if (!silences.length) { toast.info("未检测到明显静音段，入/出点保持不变"); return; }
      // 掐头去尾：起始静音（贴 0 开始）→ 入点收到其结束；结尾静音（贴片尾结束）→ 出点收到其开始。
      const lead = silences.find((s) => s.start <= 0.05);
      const trail = [...silences].reverse().find((s) => s.end >= d - 0.05);
      let ns = lead ? Math.min(lead.end, d - 0.2) : 0;
      let ne = trail ? Math.max(trail.start, ns + 0.2) : d;
      if (ne - ns < 0.2) { ns = 0; ne = d; }
      const interior = silences.filter((s) => s !== lead && s !== trail).length;
      if (!lead && !trail) { await openMultiCutInEditor(interior); return; }
      setStart(ns); setEnd(ne);
      seekBoth(ns);
      if (interior) {
        toast.success(`已自动掐头去尾：入 ${ns.toFixed(2)}s · 出 ${ne.toFixed(2)}s`);
        await openMultiCutInEditor(interior); // 中段还有静音 → 顺带征询是否去剪辑器多段剪除
      } else {
        toast.success(`已自动掐头去尾：入 ${ns.toFixed(2)}s · 出 ${ne.toFixed(2)}s`);
      }
    } catch (e) {
      toast.error("静音分析失败：" + (e instanceof Error ? e.message : String(e)));
    }
  }, [silenceMutation, videoUrl, projectId, openMultiCutInEditor]);

  // 时间轴缩略帧（本地抽帧，不发请求）：临时 <video> 逐点 seek + canvas 截帧，完成即释放。
  const [strip, setStrip] = useState<string[]>([]);
  useEffect(() => {
    if (!duration || duration <= 0) return;
    let cancelled = false;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.src = mediaFetchUrl(videoUrl);
    v.muted = true; v.playsInline = true; v.preload = "auto";
    const N = 8;
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 36;
    const c2d = canvas.getContext("2d");
    const seek = (t: number) => new Promise<void>((res, rej) => {
      const done = () => { v.removeEventListener("seeked", done); res(); };
      v.addEventListener("seeked", done);
      const guard = setTimeout(() => { v.removeEventListener("seeked", done); rej(new Error("seek timeout")); }, 4000);
      void guard;
      v.currentTime = Math.min(Math.max(t, 0), Math.max(0, duration - 0.05));
    });
    void (async () => {
      try {
        await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("load fail")); });
        const frames: string[] = [];
        for (let i = 0; i < N; i++) {
          if (cancelled || !c2d) return;
          await seek(((i + 0.5) / N) * duration);
          c2d.drawImage(v, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL("image/jpeg", 0.55));
        }
        if (!cancelled) setStrip(frames);
      } catch { /* 跨域/解码失败 → 无缩略帧背景，不影响剪辑 */ }
      finally { v.removeAttribute("src"); v.load(); }
    })();
    return () => { cancelled = true; v.removeAttribute("src"); v.load(); };
  }, [duration, videoUrl]);

  const confirm = useCallback(() => {
    const { start: s, end: e2 } = stRef.current;
    if (busy || splitBusy) return;
    if (!(e2 - s >= 0.2)) { toast.error("选区太短（至少 0.2 秒）"); return; }
    // 分割模式：选区被切点分成若干段，剔除的段跳过，相邻保留段合并回连续区间。
    const inner = cuts.filter((c) => c > s + 0.05 && c < e2 - 0.05).sort((a, b) => a - b);
    const bounds = [s, ...inner, e2];
    const kept: { start: number; end: number }[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (removedSegs.has(segKey(bounds[i], bounds[i + 1]))) continue;
      const last = kept[kept.length - 1];
      if (last && Math.abs(bounds[i] - last.end) < 0.001) last.end = bounds[i + 1];
      else kept.push({ start: bounds[i], end: bounds[i + 1] });
    }
    if (!kept.length) { toast.error("所有分段都被剔除了——至少保留一段"); return; }
    if (kept.length === 1) {
      // 单连续区间（无切点 / 剔除后仍连续）→ 原 trimVideo 路径，变速/静音照常支持。
      trimMutation.mutate({
        inputUrl: videoUrl, startTime: kept[0].start, endTime: kept[0].end, projectId, nodeId,
        // #127 变速/静音随剪辑一并应用（1×/未静音时不传，保持原行为字节级不变）
        ...(speed !== 1 ? { speed } : {}),
        ...(mute ? { audioVolume: 0 } : {}),
      });
      return;
    }
    // 多段 → 服务端一次性拼接（clip.cutSegments，本机 ffmpeg 免 AI）。
    if (speed !== 1 || mute) toast.info("多段拼接暂不支持变速/静音，这两项已按原样忽略");
    setSplitBusy(true);
    utils.client.clip.cutSegments.mutate({ inputUrl: videoUrl, projectId, nodeId, segments: kept })
      .then((r) => {
        toast.success(`已按 ${kept.length} 段拼接完成（剔除部分已剪除），已替换为结果`);
        onDone(r.url, r.duration);
        onClose();
      })
      .catch((e) => toast.error("多段剪辑失败：" + (e instanceof Error ? e.message : String(e))))
      .finally(() => setSplitBusy(false));
  }, [busy, splitBusy, cuts, removedSegs, trimMutation, videoUrl, projectId, nodeId, speed, mute, utils, onDone, onClose]);
  const confirmRef = useRef(confirm); confirmRef.current = confirm;
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    const nv = nodeVideoRef.current;
    if (v.paused) {
      if (v.currentTime < stRef.current.start || v.currentTime >= stRef.current.end) v.currentTime = stRef.current.start;
      void v.play();
      // 节点预览同步播放（静音）：同起点、同速率
      if (nv) { nv.currentTime = v.currentTime; nv.playbackRate = v.playbackRate; void nv.play().catch(() => { /* 无源 */ }); }
    } else { v.pause(); nv?.pause(); }
  }, []);
  const togglePlayRef = useRef(togglePlay); togglePlayRef.current = togglePlay;

  // 变速实时作用于预览（确认时服务端 ffmpeg 也按同倍速出片，所听即所得）。
  useEffect(() => { const v = videoRef.current; if (v) v.playbackRate = speed; }, [speed]);

  // 播放循环：越过出点 → 回入点（loop）或暂停。
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    setCurrent(v.currentTime);
    const { start: s, end: e2, loop: lp } = stRef.current;
    if (e2 > s && v.currentTime >= e2) {
      if (lp) { v.currentTime = s; }
      else { v.pause(); nodeVideoRef.current?.pause(); }
    }
    // 节点预览跟播：漂移超过 0.35s 时校正（含循环回卷），播放态跟随
    const nv = nodeVideoRef.current;
    if (nv) {
      if (Math.abs(nv.currentTime - v.currentTime) > 0.35) nv.currentTime = v.currentTime;
      if (!v.paused && nv.paused) void nv.play().catch(() => { /* 无源 */ });
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
      // 已处理的键必须同时 stopPropagation：ReactFlow 自带「方向键移动选中节点」，
      // 之前只 preventDefault 不阻断传播 → 用户按 ←/→ 移动选区时节点也跟着跑。
      const eat = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === "Escape") { eat(); onCloseRef.current(); }
      else if (e.key === "Enter") { eat(); confirmRef.current(); }
      else if (e.key === " ") { eat(); togglePlayRef.current(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        eat();
        const delta = e.key === "ArrowLeft" ? -step : step;
        const w = e2 - s;
        const ns = clamp(s + delta);
        setStart(ns); setEnd(Math.min(d, ns + w));
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        eat();
        const delta = e.key === "ArrowUp" ? step : -step;
        setEnd(Math.max(s + 0.2, clamp(e2 + delta)));
      } else if (e.key === "i" || e.key === "I") {
        eat();
        const t = videoRef.current?.currentTime ?? 0;
        setStart(Math.min(t, e2 - 0.2));
      } else if (e.key === "o" || e.key === "O") {
        eat();
        const t = videoRef.current?.currentTime ?? d;
        setEnd(Math.max(t, s + 0.2));
      } else if (e.key === "s" || e.key === "S") {
        eat();
        splitAtRef.current();
      }
    };
    // capture 阶段抢在画布快捷键（Esc 取消选中等）之前处理。
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  const pct = (v: number) => (duration > 0 ? `${(v / duration) * 100}%` : "0%");
  const KBD_ROWS: { label: string; keys: string }[] = [
    { label: "整体平移选区", keys: "拖选区中段 / ← →" },
    { label: "扩展/收缩选区", keys: "↑ ↓" },
    { label: "设置入点/出点", keys: "I / O" },
    { label: "精确模式", keys: "按住 Shift" },
    { label: "快速调整", keys: "⌘/Ctrl + ↑↓" },
    { label: "播放/暂停", keys: "Space" },
    { label: "确认剪辑", keys: "Enter" },
    { label: "退出", keys: "Esc" },
    { label: "在播放头分割", keys: "S / 剪刀按钮" },
    { label: "剔除/恢复分段", keys: "点击分段" },
    { label: "删除切点 / 全部清除", keys: "点切线 / 右键剪刀" },
    { label: "自动剪辑（掐头去尾）", keys: "魔棒按钮" },
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
          {/* 用户反馈修复：预览不再写死 muted——声音跟随右侧「静音」开关（开=预览也无声，
              直接听得出效果）；变速同理实时作用于预览（playbackRate 同步 effect）。 */}
          <video
            ref={videoRef}
            src={mediaFetchUrl(videoUrl)}
            muted={mute}
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
              const { start: s, end: e2 } = stRef.current;
              const r = trackRef.current!.getBoundingClientRect();
              const handlePx = 12; // 手柄命中半径（屏幕像素）
              const px = (tv: number) => r.left + (tv / stRef.current.duration) * r.width;
              // 三段式：手柄附近拖入/出点；选区中段整体平移；选区外就近拉手柄。
              let which: "start" | "end" | "move";
              if (Math.abs(e.clientX - px(s)) <= handlePx) which = "start";
              else if (Math.abs(e.clientX - px(e2)) <= handlePx) which = "end";
              else if (t > s && t < e2) { which = "move"; moveGrabRef.current = t - s; }
              else which = Math.abs(t - s) <= Math.abs(t - e2) ? "start" : "end";
              dragRef2.current = which;
              if (which !== "move") applyDrag(which, t);
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => { if (dragRef2.current) applyDrag(dragRef2.current, posToTime(e.clientX)); }}
            onPointerUp={() => { dragRef2.current = null; }}
            onPointerCancel={() => { dragRef2.current = null; }}
            style={{ position: "relative", height: 34, borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", overflow: "hidden", cursor: "ew-resize", touchAction: "none" }}>
            {/* 缩略帧背景（本地抽帧 filmstrip）：拖动时能看见剪的是什么画面 */}
            {strip.length > 0 && (
              <div style={{ position: "absolute", inset: 0, display: "flex", pointerEvents: "none" }}>
                {strip.map((f, i) => (
                  <img key={i} src={f} alt="" style={{ flex: 1, minWidth: 0, height: "100%", objectFit: "cover", opacity: 0.55, display: "block" }} />
                ))}
              </div>
            )}
            {/* 选区 */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(start), width: duration > 0 ? `${((end - start) / duration) * 100}%` : "100%", background: "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 22%, transparent)", border: "1px solid color-mix(in oklab, var(--ui-accent, var(--c-accent)) 55%, transparent)", pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--c-t1)", textShadow: "0 1px 2px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>{fmt(Math.max(0, end - start))}</span>
            </div>
            {/* 播放头 */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(Math.min(Math.max(current, 0), duration)), width: 2, background: "var(--c-t1)", pointerEvents: "none" }} />
            {/* 手柄视觉（拖拽由轨道 pointer 事件统一处理：就近吸附入/出点） */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(start), width: 5, borderRadius: 2, background: "var(--ui-accent, var(--c-accent))", pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${pct(end)} - 5px)`, width: 5, borderRadius: 2, background: "var(--ui-accent, var(--c-accent))", pointerEvents: "none" }} />
            {/* 分割模式：切线（点击删除切点）+ 分段点选剔除/恢复；首末段向内收缩给手柄留抓取区 */}
            {duration > 0 && cuts.filter((c) => c > start + 0.05 && c < end - 0.05).length > 0 && (() => {
              const inner = cuts.filter((c) => c > start + 0.05 && c < end - 0.05);
              const bounds = [start, ...inner, end];
              return (
                <>
                  {bounds.slice(0, -1).map((a, i) => {
                    const b = bounds[i + 1];
                    const key = segKey(a, b);
                    const off = removedSegs.has(key);
                    const insetL = i === 0 ? 12 : 4, insetR = i === bounds.length - 2 ? 12 : 4;
                    return (
                      <div key={key}
                        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        onClick={(e) => { e.stopPropagation(); setRemovedSegs((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; }); }}
                        title={off ? `${a.toFixed(2)}–${b.toFixed(2)}s 已剔除（点击恢复）` : `${a.toFixed(2)}–${b.toFixed(2)}s 保留中（点击剔除，确认时跳过该段）`}
                        style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${pct(a)} + ${insetL}px)`, width: `calc(${((b - a) / duration) * 100}% - ${insetL + insetR}px)`, zIndex: 2, cursor: "pointer", background: off ? "oklch(0.5 0.19 25 / 0.5)" : "transparent", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                        {off && <span style={{ fontSize: 8.5, fontWeight: 800, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)", paddingBottom: 1 }}>剔除</span>}
                      </div>
                    );
                  })}
                  {inner.map((c) => (
                    <div key={`cut-${c}`}
                      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      onClick={(e) => { e.stopPropagation(); setCuts((prev) => prev.filter((x) => x !== c)); }}
                      title={`切点 ${c.toFixed(2)}s（点击删除）`}
                      style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${pct(c)} - 3px)`, width: 7, zIndex: 3, cursor: "pointer", display: "flex", justifyContent: "center" }}>
                      <div style={{ width: 2, height: "100%", background: "oklch(0.78 0.17 60)", boxShadow: "0 0 3px oklch(0.78 0.17 60 / 0.8)" }} />
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--c-t4)" }}>
            <span>入 {fmt(start)}</span>
            <span>全长 {fmt(duration)}</span>
            <span>出 {fmt(end)}</span>
          </div>
        </div>
      </div>
      {/* 分割（S）：播放头处加切点——时间轴分段可点选剔除，确认时多段一次合成；右键清除全部切点 */}
      <button onClick={splitAt}
        onContextMenu={(e) => { e.preventDefault(); if (cuts.length) { setCuts([]); setRemovedSegs(new Set()); toast.info("已清除全部切点"); } }}
        title={`在播放头处分割（S）——切开后点击分段可剔除/恢复，点击切线删除切点，确认时按保留段合成${cuts.length ? `；当前 ${cuts.length} 个切点（右键清除全部）` : ""}`}
        style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${cuts.length ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 55%, transparent)" : "var(--c-bd2)"}`, background: cuts.length ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 14%, var(--c-surface))" : "var(--c-surface)", color: cuts.length ? "var(--c-t1)" : "var(--c-t3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Scissors size={14} />
      </button>
      {/* 本机 AI 自动剪辑：ffmpeg 静音分析（零 AI 调用）→ 掐头去尾；中段静音则可一键去剪辑器多段剪除 */}
      <button onClick={() => void autoTrim()} disabled={silenceMutation.isPending || multiCutBusy}
        title="本机 AI 自动剪辑：分析静音自动掐头去尾；检出中段静音时可一键生成剪辑器多段剪除（本地 ffmpeg，免 AI 调用）"
        style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: silenceMutation.isPending || multiCutBusy ? "var(--c-t4)" : "var(--c-t3)", cursor: silenceMutation.isPending || multiCutBusy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {silenceMutation.isPending || multiCutBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
      </button>
      {/* #127 变速：循环 0.5→0.75→1→1.25→1.5→2×，确认时随剪辑一并应用 */}
      <button onClick={() => setSpeed((v) => SPEEDS[(SPEEDS.indexOf(v as typeof SPEEDS[number]) + 1) % SPEEDS.length])}
        title={`变速 ${speed}×（点击切换；确认时随剪辑应用${speed !== 1 ? `，成片时长约 ${fmt(Math.max(0, end - start) / speed)}` : ""}）`}
        style={{ height: 34, padding: "0 9px", borderRadius: 10, border: `1px solid ${speed !== 1 ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 55%, transparent)" : "var(--c-bd2)"}`, background: speed !== 1 ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 14%, var(--c-surface))" : "var(--c-surface)", color: speed !== 1 ? "var(--c-t1)" : "var(--c-t3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0, fontSize: 11, fontWeight: 700 }}>
        <Gauge size={13} /> {speed}×
      </button>
      {/* #127 静音：确认时去掉原声 */}
      <button onClick={() => setMute((v) => !v)} title={mute ? "静音（开）——预览与成片都去掉原声" : "静音（关）——保留原声（预览可试听）"}
        style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${mute ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 55%, transparent)" : "var(--c-bd2)"}`, background: mute ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 14%, var(--c-surface))" : "var(--c-surface)", color: mute ? "var(--c-t1)" : "var(--c-t3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {mute ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
      {/* #127 截取当前帧 → 素材库 */}
      <button onClick={() => { if (!frameMutation.isPending) frameMutation.mutate({ inputUrl: videoUrl, time: Math.min(Math.max(current, 0), Math.max(0, duration - 0.01)), projectId, nodeId }); }}
        disabled={frameMutation.isPending}
        title="截取当前帧为图片（存入素材库，可作参考图/封面）"
        style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: frameMutation.isPending ? "wait" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {frameMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
      </button>
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
      {/* ✓ 确认（多段合成期间同样转圈禁用） */}
      <button onClick={confirm} disabled={busy || splitBusy} title="确认剪辑（Enter）"
        style={{ width: 44, height: 40, borderRadius: 12, border: "none", background: busy || splitBusy ? "var(--c-surface)" : "var(--c-t1)", color: busy || splitBusy ? "var(--c-t4)" : "var(--c-base)", cursor: busy || splitBusy ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {busy || splitBusy ? <Loader2 size={17} className="animate-spin" /> : <Check size={18} />}
      </button>
    </div>,
    document.body,
  );
}
