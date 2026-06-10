import { memo, useCallback, useMemo, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AudioNodeData, AudioCategory } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Music, Upload, Mic, Loader2, Play, Pause, X, Volume2, Zap, Wind, HardDriveDownload, Languages, Sparkles,
} from "lucide-react";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { mediaFetchUrl } from "@/lib/download";
import { NodeTextArea, NodeInput } from "../NodeTextInput";
import { PromptDock } from "../PromptDock";
import { ReferenceImageStrip, type StripItem } from "../ReferenceImageStrip";
import { useNodeDocks, useAudioStripItems } from "../../../hooks/useNodeDocks";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "../LLMModelPicker";
import { ModelPicker } from "../ModelPicker";
import { estimateMusicCost, estimateTtsCost, costEstimateLabel } from "@/lib/costEstimate";

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

// Poyo-backed music models. Suno variants route to `generate-music` (mv param);
// MiniMax Music 2.6 routes to its own model id via the standard status endpoint.
// Suno track length is determined by the model version — there is no duration param.
const MUSIC_MODELS = [
  // ── Suno (generate-music endpoint) ───
  { value: "suno-v5.5",        label: "Suno v5.5",        desc: "最新",          group: "Suno" },
  { value: "suno-v5",          label: "Suno v5",          desc: "最高质量",      group: "Suno" },
  { value: "suno-v4.5plus",    label: "Suno v4.5 PLUS",   desc: "增强版",        group: "Suno" },
  { value: "suno-v4.5all",     label: "Suno v4.5 ALL",    desc: "全能",          group: "Suno" },
  { value: "suno-v4.5",        label: "Suno v4.5",        desc: "旗舰 · 全风格", group: "Suno" },
  { value: "suno-v4",          label: "Suno v4",          desc: "稳定 · 经典",   group: "Suno" },
  // ── MiniMax (status endpoint) ───
  { value: "minimax-music-2.6", label: "MiniMax Music 2.6", desc: "歌词 / 器乐", group: "MiniMax" },
  // ── kie.ai Suno（厂家仍是 Suno，平台是 Kie；12 点/次，docs/kie-pricing.md 行276）───
  { value: "kie_suno_v5_5",     label: "Suno v5.5（kie）", desc: "最新",   group: "Suno" },
  { value: "kie_suno_v5",       label: "Suno v5（kie）",   desc: "最高质量", group: "Suno" },
  { value: "kie_suno_v4_5plus", label: "Suno v4.5 PLUS（kie）", desc: "增强版", group: "Suno" },
  { value: "kie_suno_v4_5",     label: "Suno v4.5（kie）", desc: "旗舰",   group: "Suno" },
  { value: "kie_suno_v4",       label: "Suno v4（kie）",   desc: "经典",   group: "Suno" },
];

function musicModelIsMiniMax(m?: string): boolean {
  return m === "minimax-music-2.6";
}
function musicModelIsKie(m?: string): boolean {
  return !!m && m.startsWith("kie_suno_");
}

// Normalize legacy saved model ids to a live one (mirrors server-side normalization).
function normalizeMusicModel(m?: string): string {
  if (m === "suno-v3.5") return "suno-v4";
  if (m === "minimax-music-02") return "minimax-music-2.6";
  if (m && MUSIC_MODELS.some((x) => x.value === m)) return m;
  return "suno-v5"; // mureka / unknown → default
}

// Dubbing/TTS models. The "openai_*_real" entries hit OpenAI's /v1/audio/speech
// directly (live). "elevenlabs-v3-tts" routes to Poyo's ElevenLabs V3 TTS.
const DUBBING_MODELS = [
  // ── Live (OpenAI direct) ───
  { value: "openai_tts_real",       label: "OpenAI TTS",       desc: "标准 · $0.015/1k 字符",  group: "OpenAI" },
  { value: "openai_tts_hd_real",    label: "OpenAI TTS-HD",    desc: "高清 · $0.030/1k 字符",  group: "OpenAI" },
  { value: "openai_gpt4o_mini_tts", label: "GPT-4o Mini TTS",  desc: "新 · 支持 instructions", group: "OpenAI" },
  // ── Live (Poyo) ───
  { value: "elevenlabs-v3-tts",     label: "ElevenLabs v3 TTS", desc: "Poyo · 16 积分/1k 字",  group: "ElevenLabs" },
  // ── Live (kie ElevenLabs) ───
  { value: "kie_elevenlabs_tts",    label: "ElevenLabs Turbo（kie）", desc: "kie · 6 积分/1k 字",  group: "ElevenLabs" },
  { value: "kie_elevenlabs_tts_ml", label: "ElevenLabs 多语 v2（kie）", desc: "kie · 12 积分/1k 字", group: "ElevenLabs" },
  { value: "kie_elevenlabs_v3",     label: "ElevenLabs V3 对话（kie）", desc: "kie · 14 积分/1k 字", group: "ElevenLabs" },
  // ── 本地 / 自托管（Gradio）───
  { value: "voxcpm-local",          label: "本地 VoxCPM2",      desc: "自托管 · 参考音色克隆",  group: "本地" },
];

// Per-model TTS text limit (characters). Submitting more than this either errors
// at the provider or is silently truncated — in both cases the user pays.
const TTS_TEXT_LIMIT: Record<string, number> = {
  "elevenlabs-v3-tts":   5000,
  "voxcpm-local":        5000,
  openai_tts_real:       4096,
  openai_tts_hd_real:    4096,
  openai_gpt4o_mini_tts: 4096,
};

// 本地 VoxCPM（Gradio）模型：靠参考音频克隆音色，无固定音色列表。
function modelIsVoxCPM(model?: string): boolean {
  return model === "voxcpm-local";
}

// VoxCPM 控制指令快速模板：多级（分类 → 短语），点击把短语拼进控制指令。
// pos: "front" 的（方言/语种口音）插到指令最前面，其余追加到末尾。
const VOX_CONTROL_TEMPLATES: { cat: string; pos: "front" | "end"; items: string[] }[] = [
  { cat: "方言口音", pos: "front", items: ["普通话", "粤语", "四川话", "东北话", "河南话", "陕西话", "天津话", "山东话", "上海话", "重庆话", "云南话", "湖南话", "江西话", "闽南语", "客家话", "潮汕话", "台湾腔", "香港普通话", "新疆口音", "甜美奶音"] },
  { cat: "语种口音", pos: "front", items: ["美式英语", "英式英语", "澳洲英语", "印度英语", "日语", "韩语", "法语", "德语", "西班牙语", "意大利语", "葡萄牙语", "俄语", "泰语", "越南语", "印尼语", "阿拉伯语"] },
  { cat: "语速", pos: "end", items: ["语速很慢", "语速较慢", "语速正常", "语速较快", "语速很快", "语速极快"] },
  { cat: "语气情感", pos: "end", items: ["语气平静", "热情洋溢", "严肃正式", "温柔", "活泼可爱", "甜美", "深情", "悲伤", "愤怒", "惊讶", "害怕", "神秘低语", "新闻播音腔", "纪录片旁白", "广告腔", "撒娇", "慵懒", "俏皮", "冷淡", "急促紧张", "搞笑夸张", "阴森恐怖"] },
  { cat: "音色风格", pos: "end", items: ["低沉磁性", "清亮", "沙哑", "浑厚", "明亮", "温暖", "空灵", "童声", "少年音", "青年音", "中年音", "老年音", "御姐音", "萝莉音", "大叔音", "机械音", "电音"] },
];

// 配音文本翻译目标：语言 + 中文方言（分组下拉）。
const TRANSLATE_TARGETS: { group: string; items: string[] }[] = [
  { group: "语言", items: ["英语", "日语", "韩语", "法语", "德语", "西班牙语", "俄语", "繁体中文", "简体中文"] },
  { group: "方言", items: ["粤语", "四川话", "东北话", "河南话", "陕西话", "天津话", "上海话", "闽南语", "客家话", "台湾腔"] },
];

// 翻译默认模型：取第一个非隐藏的 LLM。
const DEFAULT_LLM: LLMModelId = (LLM_MODELS.find((m) => !m.hidden) ?? LLM_MODELS[0]).id;

// 控制指令「快速模板」多级选择器：分类 tab + 短语 chip，点击拼接进控制指令。
function ControlTemplatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const insert = (phrase: string, pos: "front" | "end") => {
    const cur = (value ?? "").trim();
    if (cur.includes(phrase)) return;                       // 已含则不重复
    if (!cur) { onChange(phrase); return; }
    onChange(pos === "front" ? phrase + "，" + cur : cur + "，" + phrase);  // 语种/方言插最前
  };
  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="nodrag flex items-center gap-1"
        style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 7, cursor: "pointer",
          background: open ? accentA(0.15) : "var(--c-input)", border: `1px solid ${open ? accentA(0.4) : "var(--c-bd2)"}`,
          color: open ? accent : "var(--c-t3)" }}
      >
        <Sparkles style={{ width: 11, height: 11 }} /> 快速模板（方言/语速/语气/音色）
      </button>
      {open && (
        <div className="nodrag nowheel" style={{ marginTop: 6, padding: 8, borderRadius: 9, background: "var(--c-surface)", border: "1px solid var(--c-bd2)" }}>
          <div className="flex flex-wrap gap-1" style={{ marginBottom: 7 }}>
            {VOX_CONTROL_TEMPLATES.map((t, i) => (
              <button key={t.cat} onClick={() => setTab(i)} className="nodrag"
                style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                  background: tab === i ? accentA(0.18) : "transparent", border: `1px solid ${tab === i ? accentA(0.4) : "var(--c-bd2)"}`,
                  color: tab === i ? accent : "var(--c-t3)", fontWeight: tab === i ? 600 : 400 }}>
                {t.cat}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {VOX_CONTROL_TEMPLATES[tab].items.map((it) => (
              <button key={it} onClick={() => insert(it, VOX_CONTROL_TEMPLATES[tab].pos)} className="nodrag"
                style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                  background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}>
                {it}
              </button>
            ))}
          </div>
          {(value ?? "").trim() && (
            <button onClick={() => onChange("")} className="nodrag"
              style={{ marginTop: 7, fontSize: 10, padding: "2px 7px", borderRadius: 6, cursor: "pointer",
                background: "transparent", border: "none", color: "var(--c-t4)" }}>
              清空控制指令
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
// ElevenLabs V3 voice names (per Poyo OpenAPI). value === the wire name; Rachel
// is first so it becomes the default selection (matches the spec default).
const ELEVENLABS_VOICES = [
  { value: "Rachel",    label: "Rachel",    desc: "女声 · 旁白" },
  { value: "Aria",      label: "Aria",      desc: "女声" },
  { value: "Sarah",     label: "Sarah",     desc: "女声" },
  { value: "Laura",     label: "Laura",     desc: "女声" },
  { value: "Charlotte", label: "Charlotte", desc: "女声" },
  { value: "Alice",     label: "Alice",     desc: "女声" },
  { value: "Matilda",   label: "Matilda",   desc: "女声" },
  { value: "Jessica",   label: "Jessica",   desc: "女声" },
  { value: "Lily",      label: "Lily",      desc: "女声" },
  { value: "River",     label: "River",     desc: "中性" },
  { value: "Roger",     label: "Roger",     desc: "男声" },
  { value: "Charlie",   label: "Charlie",   desc: "男声" },
  { value: "George",    label: "George",    desc: "男声" },
  { value: "Callum",    label: "Callum",    desc: "男声" },
  { value: "Liam",      label: "Liam",      desc: "男声" },
  { value: "Will",      label: "Will",      desc: "男声" },
  { value: "Eric",      label: "Eric",      desc: "男声" },
  { value: "Chris",     label: "Chris",     desc: "男声" },
  { value: "Brian",     label: "Brian",     desc: "男声" },
  { value: "Daniel",    label: "Daniel",    desc: "男声" },
  { value: "Bill",      label: "Bill",      desc: "男声" },
];

function voicesForModel(model?: string): { value: string; label: string; desc: string }[] {
  if (modelIsVoxCPM(model)) return []; // 音色来自参考音频，无固定列表
  if (modelIsElevenLabs(model)) return ELEVENLABS_VOICES;
  return OPENAI_VOICES; // default for openai_tts_real / *_hd_real / gpt4o-mini / unknown
}

// ElevenLabs TTS：Poyo V3（+旧别名）+ kie 的 ElevenLabs（共用 ElevenLabs 音色与参数）。
function modelIsElevenLabs(model?: string): boolean {
  return model === "elevenlabs-v3-tts" || model === "elevenlabs_v3" || (!!model && model.startsWith("kie_elevenlabs"));
}
function modelIsKieTTS(model?: string): boolean {
  return !!model && model.startsWith("kie_elevenlabs");
}

// `speed` is only meaningful for OpenAI TTS. ElevenLabs V3 uses `stability`
// instead, so the speed slider is hidden for it.
function modelSupportsSpeed(model?: string): boolean {
  return !modelIsElevenLabs(model) && !modelIsVoxCPM(model);
}

/** 探测上游连入的音频 URL（素材[音频] / 音频节点），用作 VoxCPM 参考音色。 */
function detectUpstreamAudioUrl(nodeId: string): { url: string; name?: string } | undefined {
  const { edges, nodes } = useCanvasStore.getState();
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    const p = src.data.payload as { url?: string; type?: string; name?: string };
    if (src.data.nodeType === "audio" && p.url) return { url: p.url, name: p.name };
    if (src.data.nodeType === "asset" && p.type === "audio" && p.url) return { url: p.url, name: p.name };
  }
  return undefined;
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

// 音频模型的真实「来源平台」（按 value 准确判定，别再一刀切成 Poyo）：
//  - kie_*            → Kie
//  - openai_*         → OpenAI（直连 OpenAI /v1/audio/speech）
//  - voxcpm*          → 本地（自托管 Gradio）
//  - elevenlabs*      → Poyo（ElevenLabs V3 经 Poyo）
//  - suno-* / minimax / mureka → Poyo
function audioModelPlatform(value: string): string {
  if (value.startsWith("kie_")) return "Kie";
  if (value.startsWith("openai_")) return "OpenAI";
  if (value.startsWith("voxcpm")) return "本地";
  if (value.startsWith("elevenlabs")) return "Poyo";
  return "Poyo";
}

function ModelSelect({ models, value, onChange }: {
  models: typeof MUSIC_MODELS;
  value?: string;
  onChange: (v: string) => void;
}) {
  // 统一 ModelPicker：group=厂家（Suno/MiniMax/OpenAI/ElevenLabs/本地），family=真实来源平台。
  // kie Suno 标价 12 点/次（docs/kie-pricing.md 行276）；其它平台价格写在 desc 里。
  const options = models.map((m) => ({
    value: m.value,
    label: m.label,
    group: m.group,                          // 厂家
    family: audioModelPlatform(m.value),     // 来源平台（准确）
    caps: [m.desc],
    costLabel: m.value.startsWith("kie_") ? "12 点/次" : undefined,
  }));
  return (
    <div>
      <label style={labelStyle}>AI 模型</label>
      <ModelPicker
        value={value ?? models[0]?.value ?? ""}
        onChange={onChange}
        options={options}
        searchable={false}
      />
    </div>
  );
}

function GenerateBtn({
  disabled, label, loading, onClick, costLabel,
}: { disabled?: boolean; label: string; loading?: boolean; onClick: () => void; costLabel?: string }) {
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
      {!loading && costLabel && (
        <span
          title="按当前模型与文本实时预估的点数消耗，仅供参考，实际以平台账单为准"
          style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: accentA(0.18), letterSpacing: "0.02em" }}
        >
          {costLabel}
        </span>
      )}
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
  const refFileInputRef = useRef<HTMLInputElement>(null);

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

  // 配音文本翻译（支持语言与中文方言），翻译后覆盖 ttsText。
  const translateMut = trpc.aiEnhance.translate.useMutation({
    onSuccess: (r) => {
      if (r.result?.trim()) {
        updateNodeData(id, { ttsText: r.result.trim() });
        toast.success("已翻译并覆盖配音文本");
      } else {
        toast.error("翻译返回为空");
      }
    },
    onError: (err) => toast.error("翻译失败：" + err.message),
  });
  const handleTranslate = () => {
    if (translateMut.isPending) return;
    const text = payload.ttsText?.trim();
    if (!text) { toast.error("请先输入配音文本"); return; }
    translateMut.mutate({
      text,
      target: payload.ttsTranslateTarget ?? "英语",
      model: payload.ttsTranslateModel || undefined,
    });
  };

  const ttsMutation = trpc.audioGen.generateDubbing.useMutation({
    onSuccess: (result) => {
      audioRef.current?.pause();
      setIsPlaying(false);
      // Always write duration (undefined for OpenAI TTS). The brief "--:--"
      // window until <audio onLoadedMetadata> fires is the correct UX —
      // preserving a stale duration from a previous run (e.g. music
      // 30s → TTS 5s on the same node) would actively lie about the new clip.
      updateNodeData(id, {
        url: result.url,
        duration: result.duration,
        // timestampsUrl is only present for ElevenLabs V3 TTS with timestamps on;
        // clear any stale value from a previous run otherwise.
        ttsTimestampsUrl: result.timestampsUrl ?? undefined,
        name: `配音 · ${(payload.ttsVoice ?? "alloy")} · ${payload.ttsText?.slice(0, 16) ?? ""}`,
      });
      toast.success("配音生成完成");
    },
    onError: (err) => toast.error("配音生成失败：" + err.message),
  });

  // Resolve active category (support legacy source field)
  const category: AudioCategory = payload.audioCategory
    ?? (payload.source === "tts" ? "dubbing" : "upload");

  // 顶部「提示词吸附框」(PromptDock)：把本节点真正送去生成的文本按类别汇总，
  // 节点收缩后也能一眼确认。配音=配音文本、音乐=音乐描述(另有歌词时备注)、音效=音效描述。
  const promptDock = (() => {
    if (category === "dubbing") return { text: payload.ttsText ?? "", neg: undefined as string | undefined, label: "配音文本", note: "送去 TTS 合成的文本" };
    if (category === "music") return { text: payload.musicPrompt ?? "", neg: payload.musicNegativeTags?.trim() || undefined, label: "音乐描述", note: payload.musicLyrics?.trim() ? "AI 音乐描述（另含歌词）" : "AI 音乐描述" };
    if (category === "sfx") return { text: payload.sfxPrompt ?? "", neg: undefined as string | undefined, label: "音效描述", note: "送去音效生成的描述" };
    return { text: "", neg: undefined as string | undefined, label: "提示词", note: undefined as string | undefined };
  })();
  // 左侧吸附窗的「音频」波形项：参与本节点的上游音频 + 配音的参考音色（只读、放末尾）。
  const upstreamAudio = useAudioStripItems(id);
  const audioItems: StripItem[] = useMemo(() => {
    const own: StripItem[] = (category === "dubbing" && payload.ttsRefWavUrl?.trim())
      ? [{ id: "refvoice:" + payload.ttsRefWavUrl, url: payload.ttsRefWavUrl, name: payload.ttsRefWavName || "参考音色", label: "音频", kind: "audio", removable: false }]
      : [];
    return [...upstreamAudio, ...own];
  }, [upstreamAudio, category, payload.ttsRefWavUrl, payload.ttsRefWavName]);
  const docks = useNodeDocks(id, { hasRef: audioItems.length > 0, hasPrompt: !!promptDock.text.trim() });

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

  // 参考音频（VoxCPM 克隆音色）单独上传 —— 写入 ttsRefWavUrl，不覆盖节点的输出 url。
  const [refUploading, setRefUploading] = useState(false);
  const refUploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { ttsRefWavUrl: result.url });
      setRefUploading(false);
      toast.success("参考音频已上传");
    },
    onError: (err) => { setRefUploading(false); toast.error("参考音频上传失败：" + err.message); },
  });

  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) { toast.error("请选择音频文件"); e.target.value = ""; return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("参考音频不能超过 16MB"); e.target.value = ""; return; }
    setRefUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      updateNodeData(id, { ttsRefWavName: file.name });
      refUploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.onerror = () => { setRefUploading(false); toast.error("文件读取失败"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // accept="audio/*" is only an MIME hint; check the actual file type before sending bytes
    if (!file.type.startsWith("audio/")) {
      toast.error("请选择音频文件");
      e.target.value = "";
      return;
    }
    // Match the server's 16 MB hard cap in upload.ts so the user doesn't pay the
    // upload latency on a file that's going to be rejected anyway
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16MB"); e.target.value = ""; return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      // Write metadata only after the read succeeds so a failed read can't leave
      // the node showing stale name/size with no actual URL
      updateNodeData(id, { name: file.name, mimeType: file.type, size: file.size });
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.onerror = () => {
      setUploading(false);
      toast.error("文件读取失败");
    };
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
    const modelVal = normalizeMusicModel(payload.musicModel ?? payload.aiModel) as
      | "suno-v4" | "suno-v4.5" | "suno-v4.5plus" | "suno-v4.5all" | "suno-v5" | "suno-v5.5"
      | "minimax-music-2.6";
    const isMiniMax = musicModelIsMiniMax(modelVal);
    // MiniMax requires a prompt of at least 10 chars — block early to avoid a wasted call.
    if (isMiniMax && payload.musicPrompt.trim().length < 10) {
      toast.error("MiniMax Music 2.6 的描述需至少 10 个字符，请补充");
      return;
    }
    // Server caps lyrics at max(3500) — block over-long lyrics with a clear message
    // instead of a confusing 400 (the textarea has no maxLength).
    if (isMiniMax && (payload.musicLyrics?.length ?? 0) > 3500) {
      toast.error(`歌词上限 3500 字，当前 ${payload.musicLyrics!.length} 字，请截断`);
      return;
    }
    // Translate Chinese style tag to English — Suno expects English genre keywords;
    // MiniMax has no style param so it's omitted there.
    const styleEn = (!isMiniMax && payload.musicStyle)
      ? (MUSIC_STYLE_ZH_TO_EN[payload.musicStyle] ?? payload.musicStyle)
      : undefined;
    musicMutation.mutate({
      model: modelVal,
      prompt: payload.musicPrompt,
      style: styleEn,
      instrumental: payload.musicInstrumental ?? (isMiniMax ? false : true),
      negativeTags: !isMiniMax ? (payload.musicNegativeTags || undefined) : undefined,
      lyrics: isMiniMax ? (payload.musicLyrics || undefined) : undefined,
      // kie Suno auths with its own key (临时 > 分配 > 公用).
      ...(musicModelIsKie(modelVal) ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
      // 实时点数预估随请求上报，成功/失败都计入管理员日志（仅供参考）。
      estimatedCost: costEstimateLabel(estimateMusicCost(modelVal)) || undefined,
      projectId: data.projectId,
    });
  };

  const handleGenerateTTS = () => {
    if (ttsMutation.isPending) return;
    if (!payload.ttsText?.trim()) { toast.error("请先输入配音文本"); return; }
    const validTTS = DUBBING_MODELS.map((m) => m.value);
    const rawTTS = payload.ttsModel ?? payload.aiModel ?? "openai_tts_real";
    // Old saved nodes may carry the legacy "elevenlabs_v3" id — keep it routable
    // (server normalizes it); otherwise fall back to the default OpenAI model.
    const model = (validTTS.includes(rawTTS) || rawTTS === "elevenlabs_v3" ? rawTTS : "openai_tts_real") as
      | "openai_tts_real" | "openai_tts_hd_real" | "openai_gpt4o_mini_tts"
      | "elevenlabs-v3-tts" | "elevenlabs_v3";
    // Reject overlong text early — the provider would charge for the prefix and
    // truncate (or reject) the rest. Better to surface the limit before submit.
    const limit = TTS_TEXT_LIMIT[model] ?? (modelIsElevenLabs(model) ? 5000 : 4096);
    if (payload.ttsText.length > limit) {
      toast.error(`${model} 单次配音上限 ${limit} 字，当前 ${payload.ttsText.length} 字，请截断`);
      return;
    }
    const isVox = modelIsVoxCPM(model);
    // 本地 VoxCPM：需服务地址；参考音频可选（上传或上游接入），不给则用模型自带/随机音色。
    if (isVox) {
      if (!payload.ttsGradioBaseUrl?.trim()) { toast.error("请先填写本地 VoxCPM 的 Gradio 服务地址"); return; }
      const refUrl = payload.ttsRefWavUrl?.trim() || detectUpstreamAudioUrl(id)?.url;
      ttsMutation.mutate({
        model: "voxcpm-local",
        text: payload.ttsText,
        projectId: data.projectId,
        customBaseUrl: payload.ttsGradioBaseUrl.trim(),
        refWavUrl: refUrl || undefined,
        controlInstruction: payload.ttsControlInstruction?.trim() || undefined,
        cfgValue: payload.ttsCfg ?? 2,
        ditSteps: payload.ttsDitSteps ?? 10,
        denoise: payload.ttsDenoise ?? false,
        doNormalize: payload.ttsDoNormalize ?? false,
        estimatedCost: costEstimateLabel(estimateTtsCost("voxcpm-local", payload.ttsText.length)) || undefined,
      });
      return;
    }
    // Voice names differ per provider; refuse a voice not valid for this model.
    const allowedVoices = voicesForModel(model).map(v => v.value);
    const voice = payload.ttsVoice && allowedVoices.includes(payload.ttsVoice)
      ? payload.ttsVoice
      : allowedVoices[0];
    const isEleven = modelIsElevenLabs(model);
    ttsMutation.mutate({
      model,
      text: payload.ttsText,
      voice,
      projectId: data.projectId,
      // OpenAI-only
      speed: isEleven ? undefined : (modelSupportsSpeed(model) ? payload.ttsSpeed : undefined),
      // ElevenLabs V3-only (per official OpenAPI)
      stability: isEleven ? (payload.ttsStability ?? 0.5) : undefined,
      timestamps: isEleven ? (payload.ttsTimestamps ?? false) : undefined,
      languageCode: isEleven ? (payload.ttsLanguageCode || undefined) : undefined,
      applyTextNormalization: isEleven ? (payload.ttsTextNormalization ?? "auto") : undefined,
      // kie ElevenLabs：自有 key（临时 > 分配 > 公用）
      ...(modelIsKieTTS(model) ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
      // 实时点数预估随请求上报，成功/失败都计入管理员日志（仅供参考）。
      estimatedCost: costEstimateLabel(estimateTtsCost(model, payload.ttsText.length)) || undefined,
    });
  };

  const handleGenerateSFXStub = () => {
    toast.info("音效生成即将上线，敬请期待");
  };

  const formatDuration = (s?: number) =>
    s != null ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "--:--";

  // 绿点指示：音频是否已落到我方 MinIO 长期存储（/manus-storage/ 路径）。
  const audioStoredInMinio = isOwnStorageUrl(payload.url);

  // ── Audio player (shared across modes) ──────────────────────────────────────
  const audioPlayer = payload.url ? (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-2"
      style={{ background: "var(--c-input)", border: `1px solid ${accentA(0.25)}` }}
    >
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Volume2 style={{ width: 13, height: 13, color: audioStoredInMinio ? "oklch(0.72 0.18 155)" : accent }} />
        {audioStoredInMinio && (
          <div
            title="已存储到 MinIO·长期有效"
            style={{ position: "absolute", top: -2, right: -2, width: 6, height: 6, borderRadius: "50%", background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 1.5px oklch(0.72 0.18 155 / 0.35)" }}
          />
        )}
      </div>
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
        src={payload.url ? mediaFetchUrl(payload.url) : undefined}
        onEnded={() => setIsPlaying(false)}
        onEmptied={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => update("duration", (e.target as HTMLAudioElement).duration)}
        style={{ display: "none" }}
      />
    </div>
  ) : null;

  const expanded = Boolean(selected) || Boolean((payload as { pinned?: boolean }).pinned);

  return (
    <BaseNode id={id} selected={selected} nodeType="audio" title={data.title} minHeight={160} resizable
      onHeaderHoverChange={docks.onHeaderHoverChange}
      leftDock={
        <>
          <ReferenceImageStrip
            images={audioItems}
            open={docks.refOpen}
            accent={accent}
            readOnly
            title="音频"
            readOnlyHint={<>参与本节点的音频<br />（上游连入 / 参考音色）</>}
            onClose={() => docks.setRefOpen(false)}
            onRemove={() => {}}
            onMove={() => {}}
            onInsertUrls={() => {}}
            onDropFiles={() => {}}
            onZoom={() => {}}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinRef}
          />
          <PromptDock
            open={docks.promptOpen}
            text={promptDock.text}
            negText={promptDock.neg}
            label={promptDock.label}
            note={promptDock.note}
            accent={accent}
            onClose={() => docks.setPromptOpen(false)}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinPrompt}
          />
        </>
      }>
      <div
        style={{
          overflow: "hidden",
          maxHeight: expanded ? "9999px" : "0px",
          transition: expanded
            ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
            : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
        }}
      >
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
        {category === "music" && (() => {
          const musicModel = normalizeMusicModel(payload.musicModel ?? payload.aiModel);
          const isMiniMax = musicModelIsMiniMax(musicModel);
          const instrumentalDefault = isMiniMax ? false : true;
          return (
          <>
            <ModelSelect
              models={MUSIC_MODELS}
              value={MUSIC_MODELS.some(m => m.value === payload.musicModel) ? payload.musicModel : musicModel}
              onChange={(v) => update("musicModel", v)}
            />
            <div>
              <label style={labelStyle}>音乐描述</label>
              <NodeTextArea className="nodrag nowheel"
                placeholder={isMiniMax ? "描述歌曲主题、情绪、风格（至少 10 字）..." : "描述你想要的配乐风格、氛围、节奏..."}
                value={payload.musicPrompt ?? ""}
                onValueChange={(v) => update("musicPrompt", v)}
                rows={3}

                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            {/* Style tags — Suno only (MiniMax has no style param) */}
            {!isMiniMax && (
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
            )}
            {/* Lyrics — MiniMax only (optional; empty → model auto-writes lyrics) */}
            {isMiniMax && (
              <div>
                <label style={labelStyle}>歌词（可选）</label>
                <NodeTextArea className="nodrag nowheel"
                  placeholder="留空则由模型自动生成歌词；纯器乐请打开下方开关"
                  value={payload.musicLyrics ?? ""}
                  onValueChange={(v) => update("musicLyrics", v)}
                  rows={3}
                  style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
            )}
            {/* Instrumental toggle */}
            <div className="flex items-center justify-between">
              <label style={{ ...labelStyle, marginBottom: 0 }}>纯器乐</label>
              <button
                onClick={() => update("musicInstrumental", !(payload.musicInstrumental ?? instrumentalDefault))}
                className="nodrag relative flex-shrink-0"
                style={{
                  width: 32, height: 18, borderRadius: 9,
                  background: (payload.musicInstrumental ?? instrumentalDefault) ? accentA(0.5) : "var(--c-bd1)",
                  border: `1px solid ${(payload.musicInstrumental ?? instrumentalDefault) ? accentA(0.5) : "var(--c-bd3)"}`,
                  cursor: "pointer",
                  transition: "background 150ms ease",
                }}
              >
                <span style={{
                  position: "absolute", top: 2,
                  left: (payload.musicInstrumental ?? instrumentalDefault) ? 14 : 2,
                  width: 12, height: 12, borderRadius: "50%",
                  background: "var(--c-t1)",
                  transition: "left 150ms ease",
                }} />
              </button>
            </div>
            {/* Negative tags — Suno only (exclude unwanted elements) */}
            {!isMiniMax && (
              <div>
                <label style={labelStyle}>排除元素（可选）</label>
                <NodeInput
                  placeholder="例如：drums, vocals, distortion"
                  value={payload.musicNegativeTags ?? ""}
                  onValueChange={(v) => update("musicNegativeTags", v)}
                  className="nodrag"
                  style={fieldStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
            )}
            <GenerateBtn
              disabled={!payload.musicPrompt?.trim()}
              loading={musicMutation.isPending}
              onClick={handleGenerateMusic}
              label="生成配乐"
              costLabel={costEstimateLabel(estimateMusicCost(normalizeMusicModel(payload.musicModel ?? payload.aiModel)))}
            />
          </>
          );
        })()}

        {/* ── 配音 Dubbing ── */}
        {category === "dubbing" && (() => {
          const ttsModel = (payload.ttsModel ?? (DUBBING_MODELS.find(m => m.value === payload.aiModel) ? payload.aiModel : undefined) ?? "openai_tts_real") as string;
          const voices = voicesForModel(ttsModel);
          const textLimit = TTS_TEXT_LIMIT[ttsModel] ?? (modelIsElevenLabs(ttsModel) ? 5000 : 4096);
          const supportsSpeed = modelSupportsSpeed(ttsModel);
          const isEleven = modelIsElevenLabs(ttsModel);
          const isVox = modelIsVoxCPM(ttsModel);
          const upstreamRef = isVox ? detectUpstreamAudioUrl(id) : undefined;
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
              <NodeTextArea className="nodrag nowheel"
                placeholder="输入要转换为语音的文字..."
                value={payload.ttsText ?? ""}
                onValueChange={(v) => update("ttsText", v)}
                rows={4}

                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
              {/* AI 翻译（支持语言与方言）：翻译后覆盖配音文本 */}
              {isVox && (
                <div style={{ marginTop: 7 }}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Languages style={{ width: 12, height: 12, color: "var(--c-t4)", flexShrink: 0 }} />
                    <select
                      value={payload.ttsTranslateTarget ?? "英语"}
                      onChange={(e) => update("ttsTranslateTarget", e.target.value)}
                      className="nodrag"
                      style={{ ...fieldStyle, width: "auto", flex: "0 0 auto", padding: "4px 8px", fontSize: 11, cursor: "pointer" }}
                    >
                      {TRANSLATE_TARGETS.map((g) => (
                        <optgroup key={g.group} label={g.group}>
                          {g.items.map((it) => <option key={it} value={it} style={{ background: "var(--c-base)" }}>{it}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <LLMModelPicker
                      value={(payload.ttsTranslateModel as LLMModelId) || DEFAULT_LLM}
                      onChange={(m) => update("ttsTranslateModel", m)}
                      disabled={translateMut.isPending}
                    />
                    <button
                      onClick={handleTranslate}
                      disabled={translateMut.isPending || !payload.ttsText?.trim()}
                      className="nodrag flex items-center gap-1"
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, marginLeft: "auto",
                        background: translateMut.isPending ? "var(--c-surface)" : accentA(0.15),
                        border: `1px solid ${translateMut.isPending ? BORDER_DEFAULT : accentA(0.4)}`,
                        color: translateMut.isPending ? "var(--c-t4)" : accent,
                        cursor: translateMut.isPending || !payload.ttsText?.trim() ? "not-allowed" : "pointer" }}
                    >
                      {translateMut.isPending
                        ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                        : <Languages style={{ width: 11, height: 11 }} />}
                      {translateMut.isPending ? "翻译中..." : "翻译"}
                    </button>
                  </div>
                  <p style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 4 }}>翻译后覆盖配音文本，可选目标语言或方言（粤语 / 四川话 / 东北话…）</p>
                </div>
              )}
            </div>
            {/* Voice selector — varies per provider (本地 VoxCPM 无固定音色，隐藏) */}
            {voices.length > 0 && (
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
            )}
            {/* ── 本地 VoxCPM（Gradio）专属：服务地址 + 参考音色 + 参数 ── */}
            {isVox && (
              <>
                {/* Gradio 服务地址 */}
                <div>
                  <label style={labelStyle}>Gradio 服务地址</label>
                  <NodeInput
                    placeholder="例如：http://172.16.0.177:8808"
                    value={payload.ttsGradioBaseUrl ?? ""}
                    onValueChange={(v) => update("ttsGradioBaseUrl", v)}
                    className="nodrag"
                    noMention
                    style={fieldStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                  />
                </div>
                {/* 参考音频（可选，克隆音色）：上传 or 上游接入；不给则用模型自带/随机音色 */}
                <div>
                  <label style={labelStyle}>参考音频（可选，克隆音色）</label>
                  {payload.ttsRefWavUrl ? (
                    <div className="flex items-center gap-2" style={{ ...fieldStyle, padding: "6px 8px" }}>
                      <Volume2 style={{ width: 12, height: 12, color: accent, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {payload.ttsRefWavName ?? "已上传参考音频"}
                      </span>
                      <button
                        onClick={() => updateNodeData(id, { ttsRefWavUrl: undefined, ttsRefWavName: undefined })}
                        className="nodrag flex-shrink-0"
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-t4)" }}
                        title="移除参考音频"
                      >
                        <X style={{ width: 12, height: 12 }} />
                      </button>
                    </div>
                  ) : upstreamRef ? (
                    <div className="flex items-center gap-2" style={{ ...fieldStyle, padding: "6px 8px", borderColor: accentA(0.4) }}>
                      <Volume2 style={{ width: 12, height: 12, color: accent, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        上游音频：{upstreamRef.name ?? "已连入"}
                      </span>
                    </div>
                  ) : null}
                  <button
                    onClick={() => refFileInputRef.current?.click()}
                    disabled={refUploading}
                    className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] transition-all"
                    style={{
                      marginTop: 6,
                      background: "var(--c-input)",
                      border: `1px dashed ${BORDER_DEFAULT}`,
                      color: "var(--c-t3)",
                      cursor: refUploading ? "not-allowed" : "pointer",
                    }}
                  >
                    {refUploading
                      ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                      : <Upload style={{ width: 11, height: 11 }} />}
                    {refUploading ? "上传中..." : (payload.ttsRefWavUrl ? "更换参考音频" : "上传参考音频")}
                  </button>
                  {!payload.ttsRefWavUrl && !upstreamRef && (
                    <p style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 4, lineHeight: 1.5 }}>
                      可不填：留空则用模型自带/随机音色；也可上传或从上游「音频 / 素材(音频)」节点连线克隆音色
                    </p>
                  )}
                </div>
                {/* 音色/风格控制指令（可选）+ 快速模板 */}
                <div>
                  <label style={labelStyle}>控制指令（可选）</label>
                  <NodeInput
                    placeholder="例如：用粤语，语速较慢，语气温柔"
                    value={payload.ttsControlInstruction ?? ""}
                    onValueChange={(v) => update("ttsControlInstruction", v)}
                    className="nodrag"
                    noMention
                    style={fieldStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                  />
                  <ControlTemplatePicker
                    value={payload.ttsControlInstruction ?? ""}
                    onChange={(v) => update("ttsControlInstruction", v)}
                  />
                </div>
                {/* CFG */}
                <div>
                  <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>CFG</label>
                    <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>
                      {(payload.ttsCfg ?? 2).toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={5} step={0.1}
                    value={payload.ttsCfg ?? 2}
                    onChange={(e) => update("ttsCfg", Number(e.target.value))}
                    className="nodrag w-full"
                    style={{ accentColor: accent }}
                  />
                </div>
                {/* 扩散步数 */}
                <div>
                  <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>扩散步数</label>
                    <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>
                      {payload.ttsDitSteps ?? 10}
                    </span>
                  </div>
                  <input
                    type="range" min={4} max={50} step={1}
                    value={payload.ttsDitSteps ?? 10}
                    onChange={(e) => update("ttsDitSteps", Number(e.target.value))}
                    className="nodrag w-full"
                    style={{ accentColor: accent }}
                  />
                </div>
                {/* 降噪 / 文本规范化 开关 */}
                {([
                  { key: "ttsDenoise" as const, label: "参考音频降噪" },
                  { key: "ttsDoNormalize" as const, label: "文本规范化" },
                ]).map(({ key, label }) => {
                  const on = (payload[key] as boolean | undefined) ?? false;
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
                      <button
                        onClick={() => update(key, !on)}
                        className="nodrag relative flex-shrink-0"
                        style={{
                          width: 32, height: 18, borderRadius: 9,
                          background: on ? accentA(0.5) : "var(--c-bd1)",
                          border: `1px solid ${on ? accentA(0.5) : "var(--c-bd3)"}`,
                          cursor: "pointer", transition: "background 150ms ease",
                        }}
                      >
                        <span style={{
                          position: "absolute", top: 2, left: on ? 14 : 2,
                          width: 12, height: 12, borderRadius: "50%",
                          background: "var(--c-t1)", transition: "left 150ms ease",
                        }} />
                      </button>
                    </div>
                  );
                })}
                <input
                  ref={refFileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleRefUpload}
                  style={{ display: "none" }}
                />
              </>
            )}
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
            {/* ── ElevenLabs V3-only controls (per official OpenAPI) ── */}
            {isEleven && (
              <>
                {/* Stability 0–1 */}
                <div>
                  <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>稳定性</label>
                    <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>
                      {(payload.ttsStability ?? 0.5).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={payload.ttsStability ?? 0.5}
                    onChange={(e) => update("ttsStability", Number(e.target.value))}
                    className="nodrag w-full"
                    style={{ accentColor: accent }}
                  />
                </div>
                {/* Timestamps toggle */}
                <div className="flex items-center justify-between">
                  <label style={{ ...labelStyle, marginBottom: 0 }}>时间戳 (timestamps.json)</label>
                  <button
                    onClick={() => update("ttsTimestamps", !(payload.ttsTimestamps ?? false))}
                    className="nodrag relative flex-shrink-0"
                    style={{
                      width: 32, height: 18, borderRadius: 9,
                      background: (payload.ttsTimestamps ?? false) ? accentA(0.5) : "var(--c-bd1)",
                      border: `1px solid ${(payload.ttsTimestamps ?? false) ? accentA(0.5) : "var(--c-bd3)"}`,
                      cursor: "pointer",
                      transition: "background 150ms ease",
                    }}
                  >
                    <span style={{
                      position: "absolute", top: 2,
                      left: (payload.ttsTimestamps ?? false) ? 14 : 2,
                      width: 12, height: 12, borderRadius: "50%",
                      background: "var(--c-t1)",
                      transition: "left 150ms ease",
                    }} />
                  </button>
                </div>
                {/* Language code (ISO 639-1, optional) */}
                <div>
                  <label style={labelStyle}>语言代码 (ISO 639-1，可选)</label>
                  <NodeInput
                    placeholder="例如：en / zh / ja"
                    value={payload.ttsLanguageCode ?? ""}
                    onValueChange={(v) => update("ttsLanguageCode", v)}
                    className="nodrag"
                    style={fieldStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                  />
                </div>
                {/* apply_text_normalization */}
                <div>
                  <label style={labelStyle}>文本规范化</label>
                  <select
                    value={payload.ttsTextNormalization ?? "auto"}
                    onChange={(e) => update("ttsTextNormalization", e.target.value)}
                    className="nodrag"
                    style={{ ...fieldStyle, cursor: "pointer" }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                  >
                    <option value="auto" style={{ background: "var(--c-base)" }}>auto（自动）</option>
                    <option value="on" style={{ background: "var(--c-base)" }}>on（开启）</option>
                    <option value="off" style={{ background: "var(--c-base)" }}>off（关闭）</option>
                  </select>
                </div>
              </>
            )}
            <GenerateBtn
              disabled={!payload.ttsText?.trim() || textLen > textLimit}
              loading={ttsMutation.isPending}
              onClick={handleGenerateTTS}
              label="生成配音"
              costLabel={costEstimateLabel(estimateTtsCost(ttsModel, textLen))}
            />
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
              <NodeTextArea className="nodrag nowheel"
                placeholder="描述需要的音效，例如：雨声、脚步声、爆炸声..."
                value={payload.sfxPrompt ?? ""}
                onValueChange={(v) => update("sfxPrompt", v)}
                rows={3}

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
          </>
        )}

        {/* ── 上传 Upload ── */}
        {category === "upload" && (
          <>
            {payload.url ? (
              <>
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
      </div>{/* end collapse wrapper */}
      {/* Player is rendered outside the collapse wrapper so it stays visible
          even when the node is not selected — music / dubbing generation can
          take 10-30 s; users often click elsewhere while waiting, collapsing
          the node before the result arrives. */}
      {audioPlayer && (
        <div className="px-3 pb-3">
          {audioPlayer}
          {/* ElevenLabs V3 TTS timestamps.json download link */}
          {payload.ttsTimestampsUrl && (
            <a
              href={payload.ttsTimestampsUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="nodrag flex items-center gap-1 mt-1.5"
              style={{ fontSize: 10.5, color: accent, textDecoration: "none" }}
            >
              <HardDriveDownload style={{ width: 11, height: 11 }} />
              下载 timestamps.json
            </a>
          )}
        </div>
      )}
    </BaseNode>
  );
});
