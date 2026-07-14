import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// 语音输入统一 hook：AI 客户端 / 聊天室 AI 助手共用。
// 主路径 = 浏览器 Web Speech（免费、实时，能访问 Google/Apple 时）；
// 无法访问 Google 时 Web Speech 会以 network / service-not-allowed 报错——此时自动回退到
// 「录音 → 服务端 whisper 转写」（trpc.voice.transcribe，不经 Google），并记住偏好（localStorage）
// 下次直接走服务端。两路都把识别文本追加到输入框。
//
// getText/setText：读/写宿主输入框（AiClient 用 input，ChatView 用 text）。

type SR = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

const MODE_KEY = "avc:voice-mode"; // "auto" | "server"

function getSR(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => SR) | null;
}

function extFromMime(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "webm";
}

export function useVoiceInput(opts: { getText: () => string; setText: (s: string) => void; language?: string }) {
  const { getText, setText, language = "zh-CN" } = opts;
  const transcribeMut = trpc.voice.transcribe.useMutation();

  const [recording, setRecording] = useState(false); // 正在听/录
  const [busy, setBusy] = useState(false);           // 服务端转写中
  const recRef = useRef<SR | null>(null);
  const baseRef = useRef("");
  const modeRef = useRef<"auto" | "server">(((): "auto" | "server" => {
    try { return localStorage.getItem(MODE_KEY) === "server" ? "server" : "auto"; } catch { return "auto"; }
  })());

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const webSpeechSupported = !!getSR();
  const mediaSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  const supported = webSpeechSupported || mediaSupported;

  const setServerMode = () => { modeRef.current = "server"; try { localStorage.setItem(MODE_KEY, "server"); } catch { /* restricted */ } };

  const stopMedia = useCallback(() => {
    try { mediaRecRef.current?.stop(); } catch { /* noop */ }
  }, []);

  // 卸载清理：停识别 + 关麦克风。
  useEffect(() => () => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    try { mediaRecRef.current?.stop(); } catch { /* noop */ }
    (streamRef.current?.getTracks() ?? []).forEach((t) => t.stop());
  }, []);

  // ── 录音 → 服务端 whisper 转写 ──
  const startServer = useCallback(async () => {
    if (!mediaSupported) { toast.error("当前浏览器不支持录音"); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("无法访问麦克风（请检查权限）"); return;
    }
    streamRef.current = stream;
    const mimeCands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    let mime = "";
    for (const m of mimeCands) { try { if (MediaRecorder.isTypeSupported(m)) { mime = m; break; } } catch { /* ignore */ } }
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    baseRef.current = getText().trim() ? getText().trim() + " " : "";
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      (streamRef.current?.getTracks() ?? []).forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecRef.current = null;
      setRecording(false);
      const chunks = chunksRef.current; chunksRef.current = [];
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (blob.size < 800) { toast.info("录音太短"); return; }
      setBusy(true);
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).replace(/^data:[^,]+,/, "");
        transcribeMut.mutate(
          { base64, ext: extFromMime(type), language: language.split("-")[0] },
          {
            onSuccess: (r) => {
              setBusy(false);
              const t = (r?.text ?? "").trim();
              if (!t) { toast.info("没有识别到语音"); return; }
              setText(baseRef.current + t);
            },
            onError: (e) => { setBusy(false); toast.error("语音识别失败：" + e.message); },
          },
        );
      };
      reader.onerror = () => { setBusy(false); toast.error("读取录音失败"); };
      reader.readAsDataURL(blob);
    };
    mediaRecRef.current = rec;
    try { rec.start(); setRecording(true); } catch { toast.error("无法开始录音"); }
  }, [mediaSupported, getText, setText, language, transcribeMut]);

  // ── Web Speech（主路径）──
  const startWebSpeech = useCallback(() => {
    const Ctor = getSR();
    if (!Ctor) { void startServer(); return; }
    let rec: SR;
    try { rec = new Ctor(); } catch { void startServer(); return; }
    rec.lang = language; rec.interimResults = true; rec.continuous = true;
    baseRef.current = getText().trim() ? getText().trim() + " " : "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) baseRef.current += res[0].transcript; else interim += res[0].transcript;
      }
      setText(baseRef.current + interim);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = (ev) => {
      setRecording(false);
      const err = ev?.error;
      // Google 不可达的典型错误 → 切服务端兜底并立即重试。
      if (err === "network" || err === "service-not-allowed" || err === "not-allowed") {
        if (mediaSupported) { setServerMode(); toast.info("浏览器云端语音不可用，改用服务端识别"); void startServer(); return; }
      }
      if (err && err !== "aborted" && err !== "no-speech") toast.error("语音识别出错：" + err);
    };
    try { rec.start(); recRef.current = rec; setRecording(true); } catch { void startServer(); }
  }, [language, getText, setText, mediaSupported, startServer]);

  const toggle = useCallback(() => {
    if (busy) return;
    if (recording) {
      try { recRef.current?.stop(); } catch { /* noop */ }
      stopMedia();
      return;
    }
    if (modeRef.current === "server" || !webSpeechSupported) { void startServer(); }
    else startWebSpeech();
  }, [busy, recording, webSpeechSupported, startServer, startWebSpeech, stopMedia]);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    stopMedia();
  }, [stopMedia]);

  return { supported, recording, busy, toggle, stop };
}
