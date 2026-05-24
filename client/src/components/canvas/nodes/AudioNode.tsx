import { memo, useCallback, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AudioNodeData, AudioCategory } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Music, Upload, Mic, Loader2, Play, Pause, X, Volume2, Zap, Wind,
} from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "audio";
    title: string;
    payload: AudioNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.68 0.20 340)";
const accentA = (a: number) => `oklch(0.68 0.20 340 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = accentA(0.5);

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 12,
  background: "var(--c-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
  borderRadius: 8,
  color: "var(--c-t1)",
  outline: "none",
  transition: "border-color 150ms ease",
  lineHeight: 1.5,
  fontFamily: "var(--font-sans)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

// ── Model lists ───────────────────────────────────────────────────────────────

// Real Poyo-backed music models
const MUSIC_MODELS = [
  { value: "suno-v4.5",       label: "Suno v4.5",       desc: "旗舰 · 全风格",   group: "Suno" },
  { value: "suno-v5",         label: "Suno v5",         desc: "8 分钟 · 最高质量",group: "Suno" },
  { value: "mureka",           label: "Mureka",          desc: "昆仑 · 中文友好", group: "Mureka" },
  { value: "minimax-music-02", label: "MiniMax Music-02",desc: "多模态 · 精准",   group: "MiniMax" },
];

// Per-model maximum music duration (seconds). UI range slider clamps to this.
// Source: each provider's documented duration limit.
const MUSIC_MAX_DURATION: Record<string, number> = {
  "suno-v4.5":         240, // 4 min
  "suno-v5":           480, // 8 min — flagship
  "mureka":            240,
  "minimax-music-02":  180,
};

// Dubbing/TTS — coming soon; no Poyo TTS endpoint confirmed
const DUBBING_MODELS = [
  { value: "openai_tts_hd",    label: "OpenAI TTS-HD",   desc: "高清 · 自然",     group: "OpenAI" },
  { value: "openai_tts",       label: "OpenAI TTS",      desc: "标准 · 快速",     group: "OpenAI" },
  { value: "elevenlabs_v3",    label: "ElevenLabs v3",   desc: "拟真 · 多语言",   group: "ElevenLabs" },
  { value: "cosyvoice_2",      label: "CosyVoice 2.0",   desc: "阿里 · 中文优化", group: "Alibaba" },
];

// Per-model TTS text limit (characters). Submitting more than this either errors
// at the provider or is silently truncated — in both cases the user pays.
const TTS_TEXT_LIMIT: Record<string, number> = {
  openai_tts_hd: 4096,
  openai_tts:    4096,
  elevenlabs_v3: 5000,
  cosyvoice_2:   2000,
};

// SFX — coming soon
const SFX_MODELS = [
  { value: "elevenlabs_sfx",   label: "ElevenLabs SFX",  desc: "音效 · 精准",     group: "ElevenLabs" },
  { value: "audiogen",         label: "AudioGen",        desc: "Meta · 开源",     group: "Meta" },
];

// Voice options vary by provider. Sending an OpenAI voice ID like "alloy" to
// ElevenLabs/CosyVoice causes upstream errors or silent default-voice fallback —
// both cases still bill the user. Pick a per-model list and reset on switch.
const OPENAI_VOICES = [
  { value: "alloy",   label: "Alloy",   desc: "中性" },
  { value: "echo",    label: "Echo",    desc: "男声" },
  { value: "fable",   label: "Fable",   desc: "英式" },
  { value: "onyx",    label: "Onyx",    desc: "低沉" },
  { value: "nova",    label: "Nova",    desc: "女声" },
  { value: "shimmer", label: "Shimmer", desc: "柔和" },
];
const ELEVENLABS_VOICES = [
  { value: "21m00Tcm4TlvDq8ikWAM", label: "Rachel",  desc: "女声 · 美式" },
  { value: "AZnzlk1XvdvUeBnXmlld", label: "Domi",    desc: "女声 · 自信" },
  { value: "EXAVITQu4vr4xnSDxMaL", label: "Bella",   desc: "女声 · 柔和" },
  { value: "ErXwobaYiN019PkySvjV", label: "Antoni",  desc: "男声 · 温暖" },
  { value: "VR6AewLTigWG4xSOukaG", label: "Arnold",  desc: "男声 · 深沉" },
  { value: "pNInz6obpgDQGcFmaJgB", label: "Adam",    desc: "男声 · 旁白" },
];
const COSYVOICE_VOICES = [
  { value: "中文女", label: "中文女", desc: "标准 · 女声" },
  { value: "中文男", label: "中文男", desc: "标准 · 男声" },
  { value: "英文女", label: "英文女", desc: "English · F" },
  { value: "英文男", label: "英文男", desc: "English · M" },
  { value: "日语男", label: "日语男", desc: "日本語 · M" },
  { value: "粤语女", label: "粤语女", desc: "广东话 · F" },
];

function voicesForModel(model?: string): { value: string; label: string; desc: string }[] {
  if (model === "elevenlabs_v3") return ELEVENLABS_VOICES;
  if (model === "cosyvoice_2") return COSYVOICE_VOICES;
  return OPENAI_VOICES; // default for openai_tts / openai_tts_hd / unknown
}

// ElevenLabs uses voice_settings (stability/style) for pacing, not a `speed` field.
// Server still accepts speed, but for elevenlabs we hide the slider so users don't
// expect it to take effect (and don't waste credits tuning a no-op).
function modelSupportsSpeed(model?: string): boolean {
  return model !== "elevenlabs_v3";
}

// Suno/Poyo style tags expect English genre keywords. Submitting raw Chinese
// labels like "流行" gets ignored or treated as prompt noise → user pays for a
// generation whose style barely matches the picked tag.
const MUSIC_STYLE_MAP: { zh: string; en: string }[] = [
  { zh: "流行",   en: "pop" },
  { zh: "摇滚",   en: "rock" },
  { zh: "爵士",   en: "jazz" },
  { zh: "古典",   en: "classical" },
  { zh: "电子",   en: "electronic" },
  { zh: "嘻哈",   en: "hip-hop" },
  { zh: "氛围",   en: "ambient" },
  { zh: "史诗",   en: "epic cinematic" },
  { zh: "轻音乐", en: "easy listening" },
  { zh: "中国风", en: "traditional chinese" },
];
const MUSIC_STYLES_ZH = MUSIC_STYLE_MAP.map(s => s.zh);
const MUSIC_STYLE_ZH_TO_EN: Record<string, string> = Object.fromEntries(
  MUSIC_STYLE_MAP.map(s => [s.zh, s.en]),
);

const CATEGORIES: { id: AudioCategory; label: string; icon: React.ReactNode }[] = [
  { id: "music",   label: "配乐",   icon: <Music style={{ width: 11, height: 11 }} /> },
  { id: "dubbing", label: "配音",   icon: <Mic style={{ width: 11, height: 11 }} /> },
  { id: "sfx",     label: "音效",   icon: <Zap style={{ width: 11, height: 11 }} /> },
  { id: "upload",  label: "上传",   icon: <Upload style={{ width: 11, height: 11 }} /> },
];

// ── Shared sub-components (defined at module level to avoid React remount) ─────

function ModelSelect({ models, value, onChange }: {
  models: typeof MUSIC_MODELS;
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label style={labelStyle}>AI 模型</label>
      <select
        value={value ?? models[0]?.value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="nodrag"
        style={{ ...fieldStyle, cursor: "pointer" }}
        onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
      >
        {models.map((m) => (
          <option key={m.value} value={m.value} style={{ background: "var(--c-base)" }}>
            {m.label} — {m.desc}
          </option>
        ))}
      </select>
    </div>
  );
}

function GenerateBtn({
  disabled, label, loading, onClick,
}: { disabled?: boolean; label: string; loading?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
      style={{
        background: loading || disabled ? "var(--c-surface)" : accentA(0.15),
        borderWidth: 1, borderStyle: "solid",
        borderColor: loading || disabled ? BORDER_DEFAULT : accentA(0.4),
        color: loading || disabled ? "var(--c-t4)" : accent,
        cursor: loading || disabled ? "not-allowed" : "pointer",
      }}
    >
      {loading
        ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
        : <Zap style={{ width: 12, height: 12 }} />}
      {loading ? "生成中..." : label}
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export const AudioNode = memo(function AudioNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [isPlaying, setIsPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const musicMutation = trpc.audioGen.generateMusic.useMutation({
    onSuccess: (result) => {
      audioRef.current?.pause();
      setIsPlaying(false);
      updateNodeData(id, {
        url: result.url,
        duration: result.duration,
        name: `${payload.musicStyle ? payload.musicStyle + " · " : ""}${payload.musicPrompt?.slice(0, 24) ?? "配乐"}`,
      });
      toast.success("配乐生成完成");
    },
    onError: (err) => toast.error("生成失败：" + err.message),
  });

  const ttsMutation = trpc.audioGen.generateDubbing.useMutation({
    onSuccess: (result) => {
      audioRef.current?.pause();
      setIsPlaying(false);
      updateNodeData(id, {
        url: result.url,
        duration: result.duration,
        name: `配音 · ${(payload.ttsVoice ?? "alloy")} · ${payload.ttsText?.slice(0, 16) ?? ""}`,
      });
      toast.success("配音生成完成");
    },
    onError: (err) => toast.error("配音生成失败：" + err.message),
  });

  // Resolve active category (support legacy source field)
  const category: AudioCategory = payload.audioCategory
    ?? (payload.source === "tts" ? "dubbing" : "upload");

  const update = useCallback(
    (key: keyof AudioNodeData, value: unknown) => updateNodeData(id, { [key]: value }),
    [id, updateNodeData],
  );

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { url: result.url, storageKey: result.storageKey });
      setUploading(false);
      toast.success("音频已上传");
    },
    onError: (err) => { setUploading(false); toast.error("上传失败：" + err.message); },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast.error("文件不能超过 50MB"); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    updateNodeData(id, { name: file.name, mimeType: file.type, size: file.size });
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    if (!audioRef.current.paused) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => toast.error("播放失败"));
    }
  }, []);

  const handleGenerateMusic = () => {
    if (musicMutation.isPending) return;
    if (!payload.musicPrompt?.trim()) { toast.error("请先输入音乐描述"); return; }
    const validMusic = MUSIC_MODELS.map((m) => m.value);
    const raw = payload.musicModel ?? payload.aiModel ?? "suno-v4.5";
    const modelVal = (validMusic.includes(raw) ? raw : "suno-v4.5") as "suno-v4.5" | "suno-v5" | "mureka" | "minimax-music-02";
    // Clamp duration to the picked model's actual max (UI also clamps, but if
    // payload.musicDuration was set under a different model we'd otherwise send
    // a too-large value that the provider would either reject or silently cap).
    const maxDur = MUSIC_MAX_DURATION[modelVal] ?? 240;
    const durationSeconds = Math.min(payload.musicDuration ?? 30, maxDur);
    // Translate Chinese style tag to English — Suno/Poyo expect English genre
    // keywords; raw Chinese gets ignored or treated as prompt noise.
    const styleEn = payload.musicStyle ? (MUSIC_STYLE_ZH_TO_EN[payload.musicStyle] ?? payload.musicStyle) : undefined;
    musicMutation.mutate({
      model: modelVal,
      prompt: payload.musicPrompt,
      style: styleEn,
      durationSeconds,
      instrumental: payload.musicInstrumental ?? true,
      negativePrompt: payload.musicNegativeTags || undefined,
      projectId: data.projectId,
    });
  };

  const handleGenerateTTS = () => {
    if (ttsMutation.isPending) return;
    if (!payload.ttsText?.trim()) { toast.error("请先输入配音文本"); return; }
    const validTTS = DUBBING_MODELS.map((m) => m.value);
    const rawTTS = payload.ttsModel ?? payload.aiModel ?? "openai_tts";
    const model = (validTTS.includes(rawTTS) ? rawTTS : "openai_tts") as "openai_tts_hd" | "openai_tts" | "elevenlabs_v3" | "cosyvoice_2";
    // Reject overlong text early — the provider would charge for the prefix and
    // truncate (or reject) the rest. Better to surface the limit before submit.
    const limit = TTS_TEXT_LIMIT[model] ?? 4096;
    if (payload.ttsText.length > limit) {
      toast.error(`${model} 单次配音上限 ${limit} 字，当前 ${payload.ttsText.length} 字，请截断`);
      return;
    }
    // Voice IDs differ per provider; refuse an OpenAI voice id under ElevenLabs etc.
    const allowedVoices = voicesForModel(model).map(v => v.value);
    const voice = payload.ttsVoice && allowedVoices.includes(payload.ttsVoice)
      ? payload.ttsVoice
      : allowedVoices[0];
    // ElevenLabs v3 doesn't honour `speed`; don't send it (the field is meaningful only for OpenAI/CosyVoice).
    const speed = modelSupportsSpeed(model) ? payload.ttsSpeed : undefined;
    ttsMutation.mutate({
      model,
      text: payload.ttsText,
      voice,
      speed,
      projectId: data.projectId,
    });
  };

  const handleGenerateSFXStub = () => {
    toast.info("音效生成即将上线，敬请期待");
  };

  const formatDuration = (s?: number) =>
    s != null ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "--:--";

  // ── Audio player (shared across modes) ──────────────────────────────────────
  const audioPlayer = payload.url ? (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-2"
      style={{ background: "var(--c-input)", border: `1px solid ${accentA(0.25)}` }}
    >
      <Volume2 style={{ width: 13, height: 13, color: accent, flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <p className="truncate" style={{ fontSize: 11, color: "var(--c-t2)" }}>
          {payload.name ?? "音频"}
        </p>
        <p style={{ fontSize: 10, color: "var(--c-t4)" }}>{formatDuration(payload.duration)}</p>
      </div>
      <button
        onClick={handlePlayPause}
        className="nodrag w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
        style={{ background: accentA(0.18), border: `1px solid ${accentA(0.4)}`, color: accent }}
      >
        {isPlaying ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
      </button>
      <button
        onClick={() => updateNodeData(id, { url: undefined, name: undefined, duration: undefined, storageKey: undefined })}
        className="nodrag p-1.5 rounded transition-all"
        style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: "pointer" }}
      >
        <X style={{ width: 10, height: 10 }} />
      </button>
      <audio
        ref={audioRef}
        src={payload.url}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => update("duration", (e.target as HTMLAudioElement).duration)}
        style={{ display: "none" }}
      />
    </div>
  ) : null;

  return (
    <BaseNode id={id} selected={selected} nodeType="audio" title={data.title} minHeight={160} resizable>
      <div className="flex flex-col gap-3 p-3.5">

        {/* Category tabs */}
        <div
          className="flex gap-0.5 p-0.5 rounded-lg"
          style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}
        >
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => updateNodeData(id, { audioCategory: c.id })}
              className="nodrag flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[10.5px] font-medium transition-all"
              style={{
                background: category === c.id ? accentA(0.18) : "transparent",
                border: `1px solid ${category === c.id ? accentA(0.40) : "transparent"}`,
                color: category === c.id ? accent : "var(--c-t3)",
                cursor: "pointer",
              }}
            >
              {c.icon}
              {c.label}
            </button>
          ))}
        </div>

        {/* ── 配乐 Music ── */}
        {category === "music" && (
          <>
            <ModelSelect
              models={MUSIC_MODELS}
              value={payload.musicModel ?? (MUSIC_MODELS.find(m => m.value === payload.aiModel) ? payload.aiModel : undefined)}
              onChange={(v) => {
                // Clamp existing duration to the new model's cap so the slider doesn't display a value above its max
                const newMax = MUSIC_MAX_DURATION[v] ?? 240;
                const cur = payload.musicDuration ?? 30;
                if (cur > newMax) {
                  updateNodeData(id, { musicModel: v, musicDuration: newMax });
                } else {
                  update("musicModel", v);
                }
              }}
            />
            <div>
              <label style={labelStyle}>音乐描述</label>
              <textarea
                placeholder="描述你想要的配乐风格、氛围、节奏..."
                value={payload.musicPrompt ?? ""}
                onChange={(e) => update("musicPrompt", e.target.value)}
                rows={3}
                className="nodrag"
                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            {/* Style tags */}
            <div>
              <label style={labelStyle}>风格标签</label>
              <div className="flex flex-wrap gap-1">
                {MUSIC_STYLES_ZH.map((s) => (
                  <button
                    key={s}
                    onClick={() => update("musicStyle", payload.musicStyle === s ? undefined : s)}
                    className="nodrag px-2 py-0.5 rounded text-[10px] transition-all"
                    style={{
                      background: payload.musicStyle === s ? accentA(0.15) : "var(--c-input)",
                      border: `1px solid ${payload.musicStyle === s ? accentA(0.4) : "var(--c-bd2)"}`,
                      color: payload.musicStyle === s ? accent : "var(--c-t3)",
                      cursor: "pointer",
                      fontWeight: payload.musicStyle === s ? 600 : 400,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {/* Duration — slider max varies per model (suno-v5 supports up to 480s) */}
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>时长</label>
                <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>{payload.musicDuration ?? 30}秒</span>
              </div>
              {(() => {
                const cur = (payload.musicModel ?? payload.aiModel ?? "suno-v4.5") as string;
                const maxDur = MUSIC_MAX_DURATION[cur] ?? 240;
                return (
                  <input
                    type="range"
                    min={10}
                    max={maxDur}
                    step={5}
                    value={Math.min(payload.musicDuration ?? 30, maxDur)}
                    onChange={(e) => update("musicDuration", Number(e.target.value))}
                    className="nodrag w-full"
                    style={{ accentColor: accent }}
                  />
                );
              })()}
            </div>
            {/* Instrumental toggle — previously hard-coded true, hiding the vocal-music capability */}
            <div className="flex items-center justify-between">
              <label style={{ ...labelStyle, marginBottom: 0 }}>纯器乐</label>
              <button
                onClick={() => update("musicInstrumental", !(payload.musicInstrumental ?? true))}
                className="nodrag relative flex-shrink-0"
                style={{
                  width: 32, height: 18, borderRadius: 9,
                  background: (payload.musicInstrumental ?? true) ? accentA(0.5) : "var(--c-bd1)",
                  border: `1px solid ${(payload.musicInstrumental ?? true) ? accentA(0.5) : "var(--c-bd3)"}`,
                  cursor: "pointer",
                  transition: "background 150ms ease",
                }}
              >
                <span style={{
                  position: "absolute", top: 2,
                  left: (payload.musicInstrumental ?? true) ? 14 : 2,
                  width: 12, height: 12, borderRadius: "50%",
                  background: "var(--c-t1)",
                  transition: "left 150ms ease",
                }} />
              </button>
            </div>
            {/* Negative tags — exclude unwanted elements */}
            <div>
              <label style={labelStyle}>排除元素（可选）</label>
              <input
                placeholder="例如：drums, vocals, distortion"
                value={payload.musicNegativeTags ?? ""}
                onChange={(e) => update("musicNegativeTags", e.target.value)}
                className="nodrag"
                style={fieldStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            <GenerateBtn
              disabled={!payload.musicPrompt?.trim()}
              loading={musicMutation.isPending}
              onClick={handleGenerateMusic}
              label="生成配乐"
            />
            {audioPlayer}
          </>
        )}

        {/* ── 配音 Dubbing ── */}
        {category === "dubbing" && (() => {
          const ttsModel = (payload.ttsModel ?? (DUBBING_MODELS.find(m => m.value === payload.aiModel) ? payload.aiModel : undefined) ?? "openai_tts") as string;
          const voices = voicesForModel(ttsModel);
          const textLimit = TTS_TEXT_LIMIT[ttsModel] ?? 4096;
          const supportsSpeed = modelSupportsSpeed(ttsModel);
          const textLen = (payload.ttsText ?? "").length;
          return (
          <>
            <ModelSelect
              models={DUBBING_MODELS}
              value={payload.ttsModel ?? (DUBBING_MODELS.find(m => m.value === payload.aiModel) ? payload.aiModel : undefined)}
              onChange={(v) => {
                // Reset voice when the picked model doesn't recognize the previously chosen one
                const allowed = voicesForModel(v).map(x => x.value);
                if (payload.ttsVoice && !allowed.includes(payload.ttsVoice)) {
                  updateNodeData(id, { ttsModel: v, ttsVoice: allowed[0] });
                } else {
                  update("ttsModel", v);
                }
              }}
            />
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>配音文本</label>
                <span style={{
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                  color: textLen > textLimit ? "oklch(0.62 0.20 25)" : "var(--c-t4)",
                }}>
                  {textLen} / {textLimit}
                </span>
              </div>
              <textarea
                placeholder="输入要转换为语音的文字..."
                value={payload.ttsText ?? ""}
                onChange={(e) => update("ttsText", e.target.value)}
                rows={4}
                className="nodrag"
                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            {/* Voice selector — varies per provider */}
            <div>
              <label style={labelStyle}>音色</label>
              <div className="flex flex-wrap gap-1">
                {voices.map((v) => (
                  <button
                    key={v.value}
                    onClick={() => update("ttsVoice", v.value)}
                    className="nodrag flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-all"
                    style={{
                      background: payload.ttsVoice === v.value ? accentA(0.15) : "var(--c-input)",
                      border: `1px solid ${payload.ttsVoice === v.value ? accentA(0.40) : "var(--c-bd2)"}`,
                      color: payload.ttsVoice === v.value ? accent : "var(--c-t3)",
                      cursor: "pointer",
                      fontWeight: payload.ttsVoice === v.value ? 600 : 400,
                    }}
                  >
                    {v.label}
                    <span style={{ color: "var(--c-t4)", fontSize: 9 }}>{v.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* Speed slider — ElevenLabs v3 doesn't honour this; hide rather than mislead */}
            {supportsSpeed && (
              <div>
                <label style={labelStyle}>语速</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={payload.ttsSpeed ?? 1.0}
                    onChange={(e) => update("ttsSpeed", Number(e.target.value))}
                    className="nodrag flex-1"
                    style={{ accentColor: accent }}
                  />
                  <span style={{ fontSize: 11, color: "var(--c-t3)", width: 30, textAlign: "right" }}>
                    {(payload.ttsSpeed ?? 1.0).toFixed(1)}x
                  </span>
                </div>
              </div>
            )}
            <GenerateBtn
              disabled={!payload.ttsText?.trim() || textLen > textLimit}
              loading={ttsMutation.isPending}
              onClick={handleGenerateTTS}
              label="生成配音"
            />
            {audioPlayer}
          </>
          );
        })()}

        {/* ── 音效 SFX ── */}
        {category === "sfx" && (
          <>
            <ModelSelect
              models={SFX_MODELS}
              value={payload.sfxModel ?? (SFX_MODELS.find(m => m.value === payload.aiModel) ? payload.aiModel : undefined)}
              onChange={(v) => update("sfxModel", v)}
            />
            <div>
              <label style={labelStyle}>音效描述</label>
              <textarea
                placeholder="描述需要的音效，例如：雨声、脚步声、爆炸声..."
                value={payload.sfxPrompt ?? ""}
                onChange={(e) => update("sfxPrompt", e.target.value)}
                rows={3}
                className="nodrag"
                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>时长</label>
                <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>{payload.sfxDuration ?? 5}秒</span>
              </div>
              <input
                type="range"
                min={1}
                max={22}
                step={1}
                value={payload.sfxDuration ?? 5}
                onChange={(e) => update("sfxDuration", Number(e.target.value))}
                className="nodrag w-full"
                style={{ accentColor: accent }}
              />
            </div>
            <GenerateBtn disabled={!payload.sfxPrompt?.trim()} loading={false} onClick={handleGenerateSFXStub} label="生成音效（即将上线）" />
            {audioPlayer}
          </>
        )}

        {/* ── 上传 Upload ── */}
        {category === "upload" && (
          <>
            {payload.url ? (
              <>
                {audioPlayer}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="nodrag flex items-center justify-center gap-1 w-full py-1.5 rounded-lg text-[10px] transition-all"
                  style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}
                >
                  <Upload style={{ width: 10, height: 10 }} />
                  替换文件
                </button>
              </>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="nodrag flex flex-col items-center justify-center gap-2 w-full py-6 rounded-lg transition-all"
                style={{
                  background: uploading ? "var(--c-surface)" : accentA(0.06),
                  border: `1.5px dashed ${uploading ? "var(--c-bd2)" : accentA(0.35)}`,
                  color: uploading ? "var(--c-t4)" : accent,
                  cursor: uploading ? "not-allowed" : "pointer",
                }}
              >
                {uploading
                  ? <Loader2 style={{ width: 20, height: 20 }} className="animate-spin" />
                  : <Wind style={{ width: 20, height: 20 }} />}
                <span className="text-xs">{uploading ? "上传中..." : "点击上传音频"}</span>
                <span style={{ fontSize: 10, color: "var(--c-t4)" }}>支持 MP3、WAV、M4A、OGG</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </>
        )}

      </div>
    </BaseNode>
  );
});
