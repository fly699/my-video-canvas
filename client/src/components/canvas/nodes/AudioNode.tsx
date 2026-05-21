import { memo, useCallback, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AudioNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Music, Upload, Mic, Loader2, Play, Pause, X, Volume2 } from "lucide-react";

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
const BORDER_DEFAULT = "oklch(0.20 0.008 260)";

const TTS_VOICES = [
  { value: "alloy",   label: "Alloy",   desc: "中性" },
  { value: "echo",    label: "Echo",    desc: "男声" },
  { value: "fable",   label: "Fable",   desc: "英式" },
  { value: "onyx",    label: "Onyx",    desc: "低沉" },
  { value: "nova",    label: "Nova",    desc: "女声" },
  { value: "shimmer", label: "Shimmer", desc: "柔和" },
];

export const AudioNode = memo(function AudioNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [isPlaying, setIsPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatingTts, setGeneratingTts] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const source = payload.source ?? "upload";

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { url: result.url, storageKey: result.storageKey });
      setUploading(false);
      toast.success("音频已上传");
    },
    onError: (err) => {
      setUploading(false);
      toast.error("上传失败：" + err.message);
    },
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
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => toast.error("播放失败"));
    }
  }, [isPlaying]);

  const formatDuration = (s?: number) =>
    s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "--:--";

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    fontSize: 12,
    background: "oklch(0.09 0.006 260)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: BORDER_DEFAULT,
    borderRadius: 8,
    color: "oklch(0.86 0.006 260)",
    outline: "none",
    transition: "border-color 150ms ease",
    lineHeight: 1.5,
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="audio" title={data.title} minHeight={160} resizable>
      <div className="flex flex-col gap-3 p-3.5">

        {/* Source toggle */}
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "oklch(0.09 0.006 260)", border: "1px solid oklch(0.18 0.008 260)" }}>
          {(["upload", "tts"] as const).map((s) => (
            <button
              key={s}
              onClick={() => updateNodeData(id, { source: s })}
              className="nodrag flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: source === s ? accentA(0.18) : "transparent",
                border: `1px solid ${source === s ? accentA(0.40) : "transparent"}`,
                color: source === s ? accent : "oklch(0.48 0.008 260)",
                cursor: "pointer",
              }}
            >
              {s === "upload" ? <Upload style={{ width: 11, height: 11 }} /> : <Mic style={{ width: 11, height: 11 }} />}
              {s === "upload" ? "上传文件" : "文字转语音"}
            </button>
          ))}
        </div>

        {source === "upload" ? (
          <>
            {payload.url ? (
              <div
                className="flex flex-col gap-2 rounded-lg p-2.5"
                style={{ background: "oklch(0.09 0.006 260)", border: `1px solid ${accentA(0.25)}` }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: accentA(0.15), border: `1px solid ${accentA(0.3)}` }}
                  >
                    <Volume2 style={{ width: 14, height: 14, color: accent }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "oklch(0.80 0.006 260)" }}>
                      {payload.name ?? "音频文件"}
                    </p>
                    <p style={{ fontSize: 10, color: "oklch(0.42 0.006 260)" }}>
                      {formatDuration(payload.duration)}
                      {payload.size ? ` · ${(payload.size / 1024 / 1024).toFixed(1)} MB` : ""}
                    </p>
                  </div>
                  <button
                    onClick={handlePlayPause}
                    className="nodrag w-7 h-7 rounded-full flex items-center justify-center transition-all flex-shrink-0"
                    style={{ background: accentA(0.18), border: `1px solid ${accentA(0.4)}`, color: accent }}
                  >
                    {isPlaying ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
                  </button>
                </div>
                {payload.url && (
                  <audio
                    ref={audioRef}
                    src={payload.url}
                    onEnded={() => setIsPlaying(false)}
                    onLoadedMetadata={(e) => updateNodeData(id, { duration: (e.target as HTMLAudioElement).duration })}
                    style={{ display: "none" }}
                  />
                )}
                <div className="flex gap-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all flex-1"
                    style={{ background: "oklch(0.12 0.007 260)", border: "1px solid oklch(0.22 0.008 260)", color: "oklch(0.48 0.008 260)", cursor: "pointer" }}
                  >
                    <Upload style={{ width: 10, height: 10 }} />
                    替换
                  </button>
                  <button
                    onClick={() => updateNodeData(id, { url: undefined, name: undefined, duration: undefined })}
                    className="nodrag p-1.5 rounded transition-all"
                    style={{ background: "oklch(0.12 0.007 260)", border: "1px solid oklch(0.22 0.008 260)", color: "oklch(0.45 0.008 260)", cursor: "pointer" }}
                    title="清除"
                  >
                    <X style={{ width: 10, height: 10 }} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="nodrag flex flex-col items-center justify-center gap-2 w-full py-5 rounded-lg transition-all"
                style={{
                  background: uploading ? "oklch(0.12 0.007 260)" : accentA(0.06),
                  border: `1.5px dashed ${uploading ? "oklch(0.22 0.008 260)" : accentA(0.35)}`,
                  color: uploading ? "oklch(0.45 0.008 260)" : accent,
                  cursor: uploading ? "not-allowed" : "pointer",
                }}
              >
                {uploading ? <Loader2 style={{ width: 20, height: 20 }} className="animate-spin" /> : <Music style={{ width: 20, height: 20 }} />}
                <span className="text-xs">{uploading ? "上传中..." : "点击上传音频"}</span>
                <span style={{ fontSize: 10, color: "oklch(0.38 0.006 260)" }}>支持 MP3、WAV、M4A</span>
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
        ) : (
          <>
            {/* TTS mode */}
            <textarea
              placeholder="输入要转换为语音的文字..."
              value={payload.ttsText ?? ""}
              onChange={(e) => updateNodeData(id, { ttsText: e.target.value })}
              rows={3}
              className="nodrag"
              style={{ ...fieldStyle, resize: "none", lineHeight: 1.6, fontFamily: "var(--font-sans)" }}
              onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.5); }}
              onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
            />
            {/* Voice selector */}
            <div className="flex flex-wrap gap-1">
              {TTS_VOICES.map((v) => (
                <button
                  key={v.value}
                  onClick={() => updateNodeData(id, { ttsVoice: v.value })}
                  className="nodrag flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-all"
                  style={{
                    background: payload.ttsVoice === v.value ? accentA(0.15) : "oklch(0.09 0.006 260)",
                    border: `1px solid ${payload.ttsVoice === v.value ? accentA(0.40) : "oklch(0.20 0.008 260)"}`,
                    color: payload.ttsVoice === v.value ? accent : "oklch(0.50 0.008 260)",
                    cursor: "pointer",
                    fontWeight: payload.ttsVoice === v.value ? 600 : 400,
                  }}
                >
                  {v.label}
                  <span style={{ color: "oklch(0.38 0.006 260)", fontSize: 9 }}>{v.desc}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                if (!payload.ttsText?.trim()) { toast.error("请先输入文字内容"); return; }
                toast.info("TTS 功能即将上线，敬请期待");
              }}
              disabled={generatingTts || !payload.ttsText?.trim()}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
              style={{
                background: generatingTts || !payload.ttsText?.trim() ? "oklch(0.13 0.007 260)" : accentA(0.15),
                borderWidth: 1, borderStyle: "solid",
                borderColor: generatingTts || !payload.ttsText?.trim() ? BORDER_DEFAULT : accentA(0.4),
                color: generatingTts || !payload.ttsText?.trim() ? "oklch(0.38 0.006 260)" : accent,
                cursor: generatingTts || !payload.ttsText?.trim() ? "not-allowed" : "pointer",
              }}
            >
              {generatingTts ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Mic style={{ width: 12, height: 12 }} />}
              {generatingTts ? "生成中..." : "生成语音"}
            </button>
            {payload.url && (
              <div className="flex items-center gap-2 rounded-lg p-2" style={{ background: "oklch(0.09 0.006 260)", border: `1px solid ${accentA(0.25)}` }}>
                <Volume2 style={{ width: 12, height: 12, color: accent, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "oklch(0.60 0.006 260)", flex: 1 }}>语音已生成 {formatDuration(payload.duration)}</span>
                <button onClick={handlePlayPause} className="nodrag" style={{ background: "none", border: "none", color: accent, cursor: "pointer" }}>
                  {isPlaying ? <Pause style={{ width: 12, height: 12 }} /> : <Play style={{ width: 12, height: 12 }} />}
                </button>
                <audio ref={audioRef} src={payload.url} onEnded={() => setIsPlaying(false)} style={{ display: "none" }} />
              </div>
            )}
          </>
        )}
      </div>
    </BaseNode>
  );
});
