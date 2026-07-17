import { useEffect, useState } from "react";
import type { ClipKind } from "@shared/editorTypes";
import { mediaFetchUrl } from "@/lib/download";

// Lazily-built, module-level caches so a thumbnail/waveform is extracted once per
// asset and reused across re-renders and clips. All extraction is best-effort —
// on any failure (CORS taint, decode error, oversized file) we fall back to no
// thumbnail, so the timeline keeps working regardless of the media source.
const videoThumbCache = new Map<string, string>();   // key -> dataURL
const audioPeaksCache = new Map<string, number[]>();  // url -> normalized peaks
const inFlight = new Set<string>();
// Waiters keyed the same as inFlight: when a SECOND clip of the same asset mounts while the
// first is still extracting, it can't kick off its own extraction (deduped) and its effect
// deps never change, so it would stay blank forever. Instead it registers here; the extractor
// notifies all waiters on completion so every clip of the asset picks up the cached result.
const waiters = new Map<string, Set<() => void>>();
function addWaiter(key: string, cb: () => void): () => void {
  let set = waiters.get(key);
  if (!set) { set = new Set(); waiters.set(key, set); }
  set.add(cb);
  return () => { const s = waiters.get(key); if (s) { s.delete(cb); if (s.size === 0) waiters.delete(key); } };
}
function notifyWaiters(key: string): void {
  const set = waiters.get(key);
  if (set) { waiters.delete(key); for (const cb of Array.from(set)) cb(); }
}

const vKey = (url: string, t: number) => `${url}#${Math.round(t)}`;

function getAudioContext(): AudioContext | null {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** Capture the first frame of a video clip (at its in-point) as a data URL. */
function useVideoThumb(url: string | undefined, trimIn: number): string | null {
  const [thumb, setThumb] = useState<string | null>(() => (url ? videoThumbCache.get(vKey(url, trimIn)) ?? null : null));
  useEffect(() => {
    if (!url) { setThumb(null); return; }
    const key = vKey(url, trimIn);
    const cached = videoThumbCache.get(key);
    if (cached) { setThumb(cached); return; }
    if (inFlight.has(key)) {
      // another clip of this asset is already extracting — wait for it, then read the cache.
      let cancelled = false;
      const off = addWaiter(key, () => { const c = videoThumbCache.get(key); if (c && !cancelled) setThumb(c); });
      return () => { cancelled = true; off(); };
    }
    inFlight.add(key);
    let cancelled = false;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "metadata";
    const done = () => { inFlight.delete(key); notifyWaiters(key); try { v.removeAttribute("src"); v.load(); } catch { /* ignore */ } };
    const fail = () => { if (!cancelled) setThumb(null); done(); };
    v.addEventListener("error", fail, { once: true });
    v.addEventListener("loadeddata", () => {
      const seekTo = Math.min(Math.max(0.05, trimIn), Math.max(0.05, (v.duration || 1) - 0.05));
      const grab = () => {
        try {
          const w = 160;
          const ratio = v.videoHeight / Math.max(1, v.videoWidth);
          const h = Math.max(1, Math.round(w * (Number.isFinite(ratio) && ratio > 0 ? ratio : 0.56)));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const ctx = cv.getContext("2d");
          if (ctx) {
            ctx.drawImage(v, 0, 0, w, h);
            const data = cv.toDataURL("image/jpeg", 0.6); // throws if the canvas is tainted
            videoThumbCache.set(key, data);
            if (!cancelled) setThumb(data);
          }
        } catch { if (!cancelled) setThumb(null); }
        done();
      };
      v.addEventListener("seeked", grab, { once: true });
      try { v.currentTime = seekTo; } catch { grab(); }
    }, { once: true });
    // 修「打开剪辑器时间轴素材不自动加载」：外链存储多半没有 CORS 头，
    // crossOrigin=anonymous 直连会直接 error（缩略/波形全灭，播放却正常——播放走代理）。
    // 统一改走同源 /api/video-proxy（blob:/相对路径原样透传），canvas 不再跨域污染。
    v.src = mediaFetchUrl(url);
    return () => { cancelled = true; };
  }, [url, trimIn]);
  return thumb;
}

// 波形提取全局串行队列：多个片段同时整文件 fetch + decode 会抢素材库/页面带宽，
// 且并发大解码引发内存峰值——一次只跑一个，其余排队（inFlight 去重仍然生效）。
let peaksChain: Promise<void> = Promise.resolve();

/** Decode an audio clip and compute normalized peak samples for a waveform.
 *  maxBytes：文件大小上限（视频比音频更大，调用方给更紧的上限防内存峰值）。 */
function useAudioPeaks(url: string | undefined, maxBytes = 40 * 1024 * 1024): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(() => (url ? audioPeaksCache.get(url) ?? null : null));
  useEffect(() => {
    if (!url) { setPeaks(null); return; }
    const cached = audioPeaksCache.get(url);
    if (cached) { setPeaks(cached); return; }
    const key = `a:${url}`;
    if (inFlight.has(key)) {
      // another clip of this asset is already extracting — wait for it, then read the cache.
      let waiterCancelled = false;
      const off = addWaiter(key, () => { const c = audioPeaksCache.get(url); if (c && !waiterCancelled) setPeaks(c); });
      return () => { waiterCancelled = true; off(); };
    }
    inFlight.add(key);
    let cancelled = false;
    const task = async () => {
      let ac: AudioContext | null = null;
      try {
        // 让出首屏：等页面空闲再开始整文件下载/解码（波形是增强信息，不该跟素材库抢加载）。
        await new Promise<void>((r) => {
          const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
          if (w.requestIdleCallback) w.requestIdleCallback(() => r(), { timeout: 3000 });
          else setTimeout(r, 800);
        });
        if (cancelled && !waiters.has(key)) return;
        const res = await fetch(mediaFetchUrl(url)); // 同源代理：外链存储无 CORS 头时 fetch 才不被拦
        const buf = await res.arrayBuffer();
        if (buf.byteLength > maxBytes) throw new Error("audio too large to waveform");
        ac = getAudioContext();
        if (!ac) throw new Error("no AudioContext");
        const audio = await ac.decodeAudioData(buf);
        const ch = audio.getChannelData(0);
        const N = 240;
        const block = Math.max(1, Math.floor(ch.length / N));
        const out: number[] = [];
        let max = 0.0001;
        for (let i = 0; i < N; i++) {
          let peak = 0;
          const base = i * block;
          for (let j = 0; j < block; j++) { const a = Math.abs(ch[base + j] || 0); if (a > peak) peak = a; }
          out.push(peak);
          if (peak > max) max = peak;
          // 长素材整条 PCM 上亿样本，单次同步遍历会把主线程卡到「页面无响应」——
          // 每 12 块让出一次事件循环（约几 ms 一段），UI 保持可交互。
          if (i % 12 === 11) await new Promise((r) => setTimeout(r, 0));
        }
        const norm = out.map((p) => p / max); // 0..1
        audioPeaksCache.set(url, norm);
        if (!cancelled) setPeaks(norm);
      } catch {
        if (!cancelled) setPeaks(null);
      } finally {
        inFlight.delete(key);
        notifyWaiters(key); // wake other clips of this asset (cache is set on success above)
        try { await ac?.close(); } catch { /* ignore */ }
      }
    };
    peaksChain = peaksChain.then(task, task); // 串行化（前一个失败也继续）
    return () => { cancelled = true; };
  }, [url, maxBytes]);
  return peaks;
}

/** Visual fill for a timeline clip: image / video first-frame thumbnail, or an
 *  audio waveform. Falls back to nothing (the clip's solid color) on failure. */
export function ClipThumb({ kind, assetUrl, trimIn, color }: {
  kind: ClipKind;
  assetUrl?: string;
  trimIn: number;
  color: string;
}) {
  const videoThumb = useVideoThumb(kind === "video" ? assetUrl : undefined, trimIn);
  // 批3：视频片段也解码音轨画波形（decodeAudioData 对 mp4/webm 取首条音轨；纯画面/超大
  // 文件/解码失败均静默回退无波形）。与音频片段共用同一 peaks 缓存与去重。
  // 视频上限收紧到 25MB：整文件解码的内存峰值远大于音频，大视频跳过波形（修「素材库慢/无响应」）。
  const peaks = useAudioPeaks(kind === "audio" || kind === "video" ? assetUrl : undefined, kind === "video" ? 25 * 1024 * 1024 : undefined);

  if (kind === "image" && assetUrl) {
    return <div style={{ position: "absolute", inset: 0, opacity: 0.45, backgroundImage: `url(${assetUrl})`, backgroundSize: "cover", backgroundPosition: "center", pointerEvents: "none" }} />;
  }
  if (kind === "video" && (videoThumb || (peaks && peaks.length > 0))) {
    return (
      <>
        {videoThumb && <div style={{ position: "absolute", inset: 0, opacity: 0.5, backgroundImage: `url(${videoThumb})`, backgroundSize: "cover", backgroundPosition: "center", pointerEvents: "none" }} />}
        {peaks && peaks.length > 0 && (
          // 底部 32% 高度的波形条：叠在缩略图上方，便于对口型/音效定位剪切点。
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "32%", display: "flex", alignItems: "flex-end", gap: 0, padding: "0 2px", pointerEvents: "none" }}>
            {peaks.map((p, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0, height: `${Math.max(8, p * 100)}%`, background: "oklch(0.92 0.02 250 / 0.55)", borderRadius: 0.5 }} />
            ))}
          </div>
        )}
      </>
    );
  }
  if (kind === "audio" && peaks && peaks.length > 0) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 0, padding: "0 2px", pointerEvents: "none", opacity: 0.7 }}>
        {peaks.map((p, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0, height: `${Math.max(6, p * 86)}%`, background: color, opacity: 0.65, borderRadius: 0.5 }} />
        ))}
      </div>
    );
  }
  return null;
}
