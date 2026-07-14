import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { unmentionText } from "../../../lib/characterConditioning";
import type { AudioNodeData, AudioCategory } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Music, Upload, Mic, Loader2, Play, Pause, X, Volume2, Zap, Wind, HardDriveDownload, Languages, Sparkles,
  Scissors, Gauge, Download, SlidersHorizontal,
} from "lucide-react";
import { NodeToolbar, Position } from "@xyflow/react";
import { downloadMedia } from "@/lib/download";
import { InlineGenBar } from "../InlineGenBar";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { safeHref } from "@/lib/safeUrl";
import { mediaFetchUrl } from "@/lib/download";
import { NodeTextArea, NodeInput } from "../NodeTextInput";
import { PromptDock } from "../PromptDock";
import { ReferenceImageStrip, type StripItem } from "../ReferenceImageStrip";
import { useNodeDocks, useAudioStripItems } from "../../../hooks/useNodeDocks";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "../LLMModelPicker";
import { useUIStyle } from "../../../contexts/UIStyleContext";
import { useCanvasMode } from "../../../contexts/CanvasModeContext";
import { ModelPicker } from "../ModelPicker";
import { estimateMusicCost, estimateTtsCost, estimateAudioToolCost, costEstimateLabel } from "@/lib/costEstimate";
import { useDisabledModels } from "@/lib/useDisabledModels";
import { sunoMvForModel } from "@/lib/sunoMv";

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
export const MUSIC_MODELS = [
  // ── Suno (generate-music endpoint) ───
  { value: "suno-v5.5",        label: "Suno v5.5",        desc: "最新",          group: "Suno" },
  { value: "suno-v5",          label: "Suno v5",          desc: "最高质量",      group: "Suno" },
  { value: "suno-v4.5plus",    label: "Suno v4.5 PLUS",   desc: "增强版",        group: "Suno" },
  { value: "suno-v4.5all",     label: "Suno v4.5 ALL",    desc: "全能",          group: "Suno" },
  { value: "suno-v4.5",        label: "Suno v4.5",        desc: "旗舰 · 全风格", group: "Suno" },
  { value: "suno-v4",          label: "Suno v4",          desc: "稳定 · 经典",   group: "Suno" },
  // ── MiniMax (status endpoint) ───
  { value: "minimax-music-2.6", label: "MiniMax Music 2.6", desc: "歌词 / 器乐", group: "MiniMax" },
  // ── ElevenLabs Music（#151 round2 新接入；128 cr/分钟）───
  { value: "elevenlabs-music", label: "ElevenLabs Music", desc: "文本描述作曲 · 128cr/分", group: "ElevenLabs" },
  // ── kie.ai Suno（厂家仍是 Suno，平台是 Kie；12 点/次，docs/kie-pricing.md 行276）───
  { value: "kie_suno_v5_5",     label: "Suno v5.5（kie）", desc: "最新",   group: "Suno" },
  { value: "kie_suno_v5",       label: "Suno v5（kie）",   desc: "最高质量", group: "Suno" },
  { value: "kie_suno_v4_5plus", label: "Suno v4.5 PLUS（kie）", desc: "增强版", group: "Suno" },
  { value: "kie_suno_v4_5",     label: "Suno v4.5（kie）", desc: "旗舰",   group: "Suno" },
  { value: "kie_suno_v4",       label: "Suno v4（kie）",   desc: "经典",   group: "Suno" },
  { value: "kie_suno_v3_5",     label: "Suno v3.5（kie）", desc: "兼容旧曲风", group: "Suno" },
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
export const DUBBING_MODELS = [
  // ── Live (OpenAI direct) ───
  { value: "openai_tts_real",       label: "OpenAI TTS",       desc: "标准 · $0.015/1k 字符",  group: "OpenAI" },
  { value: "openai_tts_hd_real",    label: "OpenAI TTS-HD",    desc: "高清 · $0.030/1k 字符",  group: "OpenAI" },
  { value: "openai_gpt4o_mini_tts", label: "GPT-4o Mini TTS",  desc: "新 · 支持 instructions", group: "OpenAI" },
  // ── Live (Poyo) ───
  { value: "elevenlabs-v3-tts",     label: "ElevenLabs v3 TTS", desc: "Poyo · 16 积分/1k 字",  group: "ElevenLabs" },
  { value: "elevenlabs-tts-turbo-2-5", label: "ElevenLabs Turbo 2.5", desc: "Poyo · 低延迟 · 8 积分/1k 字", group: "ElevenLabs" },
  { value: "gemini-3-1-flash-tts",  label: "Gemini 3.1 Flash TTS", desc: "Poyo · 表现力/多语 · 24 积分/1k 字", group: "Google" },
  { value: "xai-tts-1",             label: "xAI TTS 1",         desc: "Poyo · 超低价 · 2.4 积分/1k 字", group: "xAI" },
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
  "elevenlabs-tts-turbo-2-5": 5000,
  "gemini-3-1-flash-tts": 5000,
  "xai-tts-1":            5000,
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

// SFX（文本→音效）。kie ElevenLabs Sound Effects 已实装；旧 stub id
// （elevenlabs_sfx / audiogen）的存量节点由下方 value 解析回退到 live 模型。
export const SFX_MODELS = [
  { value: "kie_elevenlabs_sfx", label: "ElevenLabs SFX（kie）", desc: "文本→音效 · 0.5-22s", group: "ElevenLabs" },
];

// #152 音乐工具第一批（audioCategory="tools"）。value = 服务端 tool id（禁止改名）。
// 计价挂 estimateAudioToolCost；后台可经「音频工具」使能类目开关（useDisabledModels 过滤）。
export const AUDIO_TOOL_MODELS = [
  { value: "sep_vocals", label: "人声分离", desc: "拆分人声/伴奏/鼓/贝斯等音轨 · 15cr", group: "工具" },
  { value: "cover",      label: "翻唱 / 转曲风", desc: "保留旋律换风格（需源音频）· 20cr", group: "工具" },
  { value: "extend",     label: "音频续写", desc: "从指定秒起延长歌曲 · 20cr", group: "工具" },
  { value: "lyrics",     label: "写歌词", desc: "描述主题 → AI 生成歌词 · 1cr", group: "工具" },
];

// Voice options vary by provider. Sending an OpenAI voice ID like "alloy" to
// ElevenLabs/CosyVoice causes upstream errors or silent default-voice fallback —
// both cases still bill the user. Pick a per-model list and reset on switch.
// 发音人显示统一中文（音频节点音色 chips 与镜头表 casting 下拉共用本数据源）；
// value 仍是上游 wire 名，不影响提交。
const OPENAI_VOICES = [
  { value: "alloy",   label: "艾洛伊 Alloy",   desc: "中性" },
  { value: "echo",    label: "回声 Echo",      desc: "男声" },
  { value: "fable",   label: "寓言 Fable",     desc: "英式" },
  { value: "onyx",    label: "玛瑙 Onyx",      desc: "低沉" },
  { value: "nova",    label: "新星 Nova",      desc: "女声" },
  { value: "shimmer", label: "微光 Shimmer",   desc: "柔和" },
];
// ElevenLabs V3 voice names (per Poyo OpenAPI). value === the wire name; Rachel
// is first so it becomes the default selection (matches the spec default).
const ELEVENLABS_VOICES = [
  { value: "Rachel",    label: "瑞秋 Rachel",       desc: "女声 · 旁白" },
  { value: "Aria",      label: "阿莉雅 Aria",       desc: "女声" },
  { value: "Sarah",     label: "莎拉 Sarah",        desc: "女声" },
  { value: "Laura",     label: "劳拉 Laura",        desc: "女声" },
  { value: "Charlotte", label: "夏洛特 Charlotte",  desc: "女声" },
  { value: "Alice",     label: "爱丽丝 Alice",      desc: "女声" },
  { value: "Matilda",   label: "玛蒂尔达 Matilda",  desc: "女声" },
  { value: "Jessica",   label: "杰西卡 Jessica",    desc: "女声" },
  { value: "Lily",      label: "莉莉 Lily",         desc: "女声" },
  { value: "River",     label: "里弗 River",        desc: "中性" },
  { value: "Roger",     label: "罗杰 Roger",        desc: "男声" },
  { value: "Charlie",   label: "查理 Charlie",      desc: "男声" },
  { value: "George",    label: "乔治 George",       desc: "男声" },
  { value: "Callum",    label: "卡勒姆 Callum",     desc: "男声" },
  { value: "Liam",      label: "利亚姆 Liam",       desc: "男声" },
  { value: "Will",      label: "威尔 Will",         desc: "男声" },
  { value: "Eric",      label: "埃里克 Eric",       desc: "男声" },
  { value: "Chris",     label: "克里斯 Chris",      desc: "男声" },
  { value: "Brian",     label: "布莱恩 Brian",      desc: "男声" },
  { value: "Daniel",    label: "丹尼尔 Daniel",     desc: "男声" },
  { value: "Bill",      label: "比尔 Bill",         desc: "男声" },
];

// #151 Gemini 3.1 Flash TTS 音色（官方枚举 30 个，默认 Kore；此处收录全量）。
const GEMINI_VOICES = [
  "Kore", "Puck", "Zephyr", "Charon", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
  "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((v) => ({ value: v, label: v, desc: v === "Kore" ? "默认" : "" }));
// #151 xAI TTS 音色（官方枚举 5 个，默认 eve）。
const XAI_VOICES = [
  { value: "eve", label: "Eve",  desc: "默认 · 女声" },
  { value: "ara", label: "Ara",  desc: "女声" },
  { value: "rex", label: "Rex",  desc: "男声" },
  { value: "sal", label: "Sal",  desc: "男声" },
  { value: "leo", label: "Leo",  desc: "男声" },
];

export function voicesForModel(model?: string): { value: string; label: string; desc: string }[] {
  if (modelIsVoxCPM(model)) return []; // 音色来自参考音频，无固定列表
  if (model === "gemini-3-1-flash-tts") return GEMINI_VOICES;
  if (model === "xai-tts-1") return XAI_VOICES;
  if (modelIsElevenLabs(model)) return ELEVENLABS_VOICES;
  return OPENAI_VOICES; // default for openai_tts_real / *_hd_real / gpt4o-mini / unknown
}

// ElevenLabs TTS：Poyo V3（+旧别名）+ kie 的 ElevenLabs（共用 ElevenLabs 音色与参数）。
function modelIsElevenLabs(model?: string): boolean {
  return model === "elevenlabs-v3-tts" || model === "elevenlabs-tts-turbo-2-5" || model === "elevenlabs_v3" || (!!model && model.startsWith("kie_elevenlabs"));
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
export const MUSIC_STYLES_ZH = MUSIC_STYLE_MAP.map(s => s.zh);
const MUSIC_STYLE_ZH_TO_EN: Record<string, string> = Object.fromEntries(
  MUSIC_STYLE_MAP.map(s => [s.zh, s.en]),
);

const CATEGORIES: { id: AudioCategory; label: string; icon: React.ReactNode }[] = [
  { id: "music",   label: "配乐",   icon: <Music style={{ width: 11, height: 11 }} /> },
  { id: "dubbing", label: "配音",   icon: <Mic style={{ width: 11, height: 11 }} /> },
  { id: "sfx",     label: "音效",   icon: <Zap style={{ width: 11, height: 11 }} /> },
  { id: "tools",   label: "工具",   icon: <Scissors style={{ width: 11, height: 11 }} /> },
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

function ModelSelect({ models, value, onChange, bare }: {
  models: typeof MUSIC_MODELS;
  value?: string;
  onChange: (v: string) => void;
  /** 就地输入条用：不渲染「AI 模型」label，只出 picker 本体。 */
  bare?: boolean;
}) {
  // 统一 ModelPicker：group=厂家（Suno/MiniMax/OpenAI/ElevenLabs/本地），family=真实来源平台。
  // kie 各音频模型计价不同（docs/kie-pricing.md）：Suno 12点/次、SFX 0.24点/秒、
  // ElevenLabs TTS 6点/千字、V3 对话 14点/千字。此前一律标「12点/次」——SFX 等被误导。
  const kieAudioCost = (v: string): string | undefined => {
    if (!v.startsWith("kie_")) return undefined;
    if (v.includes("sfx")) return "0.24 点/秒";
    if (v.includes("v3")) return "14 点/千字";
    if (v.includes("elevenlabs")) return "6 点/千字";
    return "12 点/次"; // kie Suno
  };
  const options = models.map((m) => ({
    value: m.value,
    label: m.label,
    group: m.group,                          // 厂家
    family: audioModelPlatform(m.value),     // 来源平台（准确）
    caps: [m.desc],
    costLabel: kieAudioCost(m.value),
  }));
  if (bare) {
    return <ModelPicker value={value ?? models[0]?.value ?? ""} onChange={onChange} options={options} searchable={false} minWidth={130} />;
  }
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
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  // 生成中刷新/切项目后，在飞 mutation 随组件卸载丢失，但持久化的 "processing" 会让标题栏
  // 常驻「生成中」进度条永久残留、与实际不符。挂载时复位遗留 processing（与 ComfyUI 节点同理）。
  useEffect(() => {
    if (payload.status === "processing") updateNodeData(id, { status: "failed", errorMessage: "生成已中断（页面刷新或连接断开），请重新生成。" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 上游分镜的「对白/旁白」→ 配音文案（只填空：本节点 ttsText 为空时才自动填入，
  // 与「上游提示词只填空」同口径，不覆盖用户已写内容）。多个上游分镜按镜号顺序拼接。
  const upstreamDialogue = useCanvasStore((st) => {
    const incoming = st.edges.filter((e) => e.target === id);
    const lines: { num: number; text: string }[] = [];
    for (const e of incoming) {
      const src = st.nodes.find((n) => n.id === e.source);
      if (src?.data.nodeType !== "storyboard") continue;
      const p = src.data.payload as { dialogue?: string; sceneNumber?: number | string };
      const d = p.dialogue?.trim();
      if (d) lines.push({ num: Number(p.sceneNumber) || 9999, text: d });
    }
    lines.sort((a, b) => a.num - b.num);
    return lines.map((l) => l.text).join("\n");
  });
  useEffect(() => {
    if (upstreamDialogue && !payload.ttsText?.trim()) {
      updateNodeData(id, { ttsText: upstreamDialogue, audioCategory: payload.audioCategory ?? "dubbing" }, true);
    }
  }, [upstreamDialogue, payload.ttsText, payload.audioCategory, id, updateNodeData]);
  // 上游分镜的「音效意图」→ 音效描述（只填空，且仅当本节点已是音效类别时——
  // 不抢 dubbing 的默认类别判定，新连线节点仍默认走配音填充）。
  const upstreamSfx = useCanvasStore((st) => {
    const incoming = st.edges.filter((e) => e.target === id);
    const lines: { num: number; text: string }[] = [];
    for (const e of incoming) {
      const src = st.nodes.find((n) => n.id === e.source);
      if (src?.data.nodeType !== "storyboard") continue;
      const p = src.data.payload as { sfx?: string; sceneNumber?: number | string };
      const s = p.sfx?.trim();
      if (s) lines.push({ num: Number(p.sceneNumber) || 9999, text: s });
    }
    lines.sort((a, b) => a.num - b.num);
    return lines.map((l) => l.text).join("，");
  });
  useEffect(() => {
    if (upstreamSfx && payload.audioCategory === "sfx" && !payload.sfxPrompt?.trim()) {
      updateNodeData(id, { sfxPrompt: upstreamSfx }, true);
    }
  }, [upstreamSfx, payload.audioCategory, payload.sfxPrompt, id, updateNodeData]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const toolFileInputRef = useRef<HTMLInputElement>(null);       // #152 音乐工具源音频上传
  const disabledModels = useDisabledModels();                    // 后台「音频工具」使能过滤

  const musicMutation = trpc.audioGen.generateMusic.useMutation({
    // payload.status 驱动 BaseNode 标题栏下方的常驻进度条/失败红条——节点收缩
    // （取消选中）后依然可见「生成中/失败」（音乐生成可达数分钟，此前收缩即失联）。
    onMutate: () => updateNodeData(id, { status: "processing", errorMessage: undefined }),
    onSuccess: (result) => {
      audioRef.current?.pause();
      setIsPlaying(false);
      // #153 持久化 audio_id/task_id（仅 Suno 系有 mv）——供「原生续写」等第二批工具使用。
      const mv = sunoMvForModel(payload.musicModel);
      updateNodeData(id, {
        url: result.url,
        duration: result.duration,
        status: "success",
        name: `${payload.musicStyle ? payload.musicStyle + " · " : ""}${payload.musicPrompt?.slice(0, 24) ?? "配乐"}`,
        poyoAudioId: mv && result.audioId ? result.audioId : undefined,
        poyoTaskId: mv && result.audioId ? result.taskId : undefined,
        poyoMv: mv && result.audioId ? mv : undefined,
      });
      toast.success("配乐生成完成");
    },
    onError: (err) => { updateNodeData(id, { status: "failed", errorMessage: err.message }); toast.error("生成失败：" + err.message); },
  });

  // #152 音乐工具（人声分离/翻唱/续写/写歌词）。结果形态随工具：音频→url、分离→toolStems、歌词→toolLyrics。
  const toolMutation = trpc.audioGen.generateMusicTool.useMutation({
    onMutate: () => updateNodeData(id, { status: "processing", errorMessage: undefined }),
    onSuccess: (result) => {
      audioRef.current?.pause();
      setIsPlaying(false);
      if (result.kind === "audio" && result.url) {
        // #153 原生续写：产出新曲目，回写新的 audio_id/task_id 以便继续链式续写（mv 沿用）。
        const isNativeExtend = !!result.audioId && !!payload.poyoAudioId;
        updateNodeData(id, {
          url: result.url, duration: result.duration, status: "success", toolStems: undefined, toolLyrics: undefined,
          name: payload.toolModel === "cover" ? "翻唱" : "续写音频",
          ...(isNativeExtend ? { poyoAudioId: result.audioId, poyoTaskId: result.taskId } : {}),
        });
        toast.success("生成完成");
      } else if (result.kind === "stems" && result.stems) {
        // 主 url 取人声（无则任一轨），全部轨存 toolStems 供列表展示/下载。
        const primary = result.stems.vocals ?? Object.values(result.stems)[0];
        updateNodeData(id, { url: primary, duration: undefined, status: "success", toolStems: result.stems, toolLyrics: undefined, name: "人声分离" });
        toast.success(`人声分离完成（${Object.keys(result.stems).length} 条音轨）`);
      } else if (result.kind === "lyrics" && result.lyrics) {
        updateNodeData(id, { toolLyrics: result.lyrics, status: "success", toolStems: undefined, name: result.title || "歌词" });
        toast.success("歌词已生成");
      }
    },
    onError: (err) => { updateNodeData(id, { status: "failed", errorMessage: err.message }); toast.error("生成失败：" + err.message); },
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
    // 同 musicMutation：payload.status 让 BaseNode 常驻进度条在节点收缩后仍可见。
    onMutate: () => updateNodeData(id, { status: "processing", errorMessage: undefined }),
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
        status: "success",
        // timestampsUrl is only present for ElevenLabs V3 TTS with timestamps on;
        // clear any stale value from a previous run otherwise.
        ttsTimestampsUrl: result.timestampsUrl ?? undefined,
        name: `配音 · ${(payload.ttsVoice ?? "alloy")} · ${payload.ttsText?.slice(0, 16) ?? ""}`,
      });
      toast.success("配音生成完成");
    },
    onError: (err) => { updateNodeData(id, { status: "failed", errorMessage: err.message }); toast.error("配音生成失败：" + err.message); },
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
  const docks = useNodeDocks(id, { hasRef: audioItems.length > 0, hasPrompt: !!promptDock.text.trim() }, { prompt: promptDock.text, ref: audioItems.map((a) => a.id).join(",") });

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

  // #152 工具源音频上传（写入 toolAudioUrl，不覆盖节点输出 url）。
  const toolUploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => { updateNodeData(id, { toolAudioUrl: result.url }); toast.success("源音频已上传"); },
    onError: (err) => { toast.error("上传失败：" + err.message); },
  });
  const handleToolAudioUpload = (file: File) => {
    if (!file.type.startsWith("audio/")) { toast.error("请选择音频文件"); return; }
    if (file.size > 30 * 1024 * 1024) { toast.error("源音频不能超过 30MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      updateNodeData(id, { toolAudioName: file.name });
      toolUploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.onerror = () => toast.error("文件读取失败");
    reader.readAsDataURL(file);
  };

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
      prompt: unmentionText(payload.musicPrompt, useCanvasStore.getState().nodes),
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

  // #153 原生续写：对本站生成的 Suno 曲目用其 audio_id 续写（无需上传源音频）。仅当本节点
  // 持久化了 poyoAudioId（Suno 系产出）时可用；产出新曲目并回写新的 audio_id 以便继续链式续写。
  const handleNativeExtend = () => {
    if (toolMutation.isPending || musicMutation.isPending) return;
    if (!payload.poyoAudioId) { toast.error("该音频不支持原生续写（仅限本站 Suno 生成的曲目）"); return; }
    toolMutation.mutate({
      tool: "extend_native",
      audioId: payload.poyoAudioId,
      mv: (payload.poyoMv || undefined) as "V4" | "V4_5" | "V4_5ALL" | "V4_5PLUS" | "V5" | "V5_5" | undefined,
      prompt: payload.musicPrompt?.trim() || undefined, // 可选：给续写方向
      estimatedCost: costEstimateLabel(estimateAudioToolCost("extend")) || undefined,
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
    // 音频提示词不该出现 @角色 标记：提交前把命中的「@角色名」清洗为纯名字
    //（TTS 正常朗读姓名，不念 at 符号；未提及时原样）。
    const speakText = unmentionText(payload.ttsText, useCanvasStore.getState().nodes);
    // 本地 VoxCPM：需服务地址；参考音频可选（上传或上游接入），不给则用模型自带/随机音色。
    if (isVox) {
      if (!payload.ttsGradioBaseUrl?.trim()) { toast.error("请先填写本地 VoxCPM 的 Gradio 服务地址"); return; }
      const refUrl = payload.ttsRefWavUrl?.trim() || detectUpstreamAudioUrl(id)?.url;
      ttsMutation.mutate({
        model: "voxcpm-local",
        text: speakText,
        projectId: data.projectId,
        customBaseUrl: payload.ttsGradioBaseUrl.trim(),
        refWavUrl: refUrl || undefined,
        controlInstruction: payload.ttsControlInstruction?.trim() || undefined,
        cfgValue: payload.ttsCfg ?? 2,
        ditSteps: payload.ttsDitSteps ?? 10,
        denoise: payload.ttsDenoise ?? false,
        doNormalize: payload.ttsDoNormalize ?? false,
        estimatedCost: costEstimateLabel(estimateTtsCost("voxcpm-local", speakText.length)) || undefined,
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
      text: speakText,
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

  const sfxMutation = trpc.audioGen.generateSFX.useMutation({
    // 同 musicMutation：payload.status 让 BaseNode 常驻进度条在节点收缩后仍可见。
    onMutate: () => updateNodeData(id, { status: "processing", errorMessage: undefined }),
    onSuccess: (result) => {
      audioRef.current?.pause();
      setIsPlaying(false);
      updateNodeData(id, {
        url: result.url,
        duration: result.duration,
        status: "success",
        name: `音效 · ${payload.sfxPrompt?.slice(0, 24) ?? ""}`,
      });
      toast.success("音效生成完成");
    },
    onError: (err) => { updateNodeData(id, { status: "failed", errorMessage: err.message }); toast.error("音效生成失败：" + err.message); },
  });
  const handleGenerateSFX = () => {
    const prompt = unmentionText(payload.sfxPrompt, useCanvasStore.getState().nodes).trim();
    if (!prompt || sfxMutation.isPending) return;
    sfxMutation.mutate({
      // 目前 SFX 仅 kie_elevenlabs_sfx 一个模型，服务端枚举亦只接受它 → 用字面量。
      // 注：扩展 SFX_MODELS 时，需同步放开服务端枚举并改为读 payload.sfxModel。
      model: "kie_elevenlabs_sfx",
      prompt: prompt.slice(0, 5000),
      duration: payload.sfxDuration != null ? Math.min(22, Math.max(0.5, payload.sfxDuration)) : undefined,
      loop: payload.sfxLoop || undefined,
      projectId: data.projectId,
      kieTempKey: localStorage.getItem("kie:tempKey") || undefined,
    });
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
  // LibTV 化：创意模式（pro 皮肤 + creative 画布）启用就地生成输入条。
  const { uiStyle } = useUIStyle();
  const { mode: canvasModeVal } = useCanvasMode();
  const isCreativeMode = uiStyle !== "studio" && canvasModeVal === "creative";
  // 创意模式点击不展开完整配置区（对齐图像/视频节点）：由输入条「高级」开关展开，
  // 取消选中即复位；快捷键 A（Canvas 派发 canvas:toggle-advanced）同样生效。
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // 输入条「设置」浮层（常用参数按类别排布；节点本体不展开）。
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (!selected) { setAdvancedOpen(false); setSettingsOpen(false); } }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const h = () => setAdvancedOpen((v) => !v);
    window.addEventListener("canvas:toggle-advanced", h);
    return () => window.removeEventListener("canvas:toggle-advanced", h);
  }, [selected]);

  // ── LibTV 化：音频操作条（截取 / 变速 / 下载）——选中且有音频结果时浮现于节点上方。
  // 截取/变速走服务端 ffmpeg（audioGen.processAudio），完成后原地替换本节点音频 URL。
  const processMutation = trpc.audioGen.processAudio.useMutation({
    onSuccess: (r) => {
      updateNodeData(id, { url: r.url, duration: r.duration || undefined });
      setTrimOpen(false); setSpeedOpen(false);
      toast.success("音频处理完成，已替换为新结果");
    },
    onError: (e) => toast.error("音频处理失败：" + e.message),
  });
  const [trimOpen, setTrimOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [trimStart, setTrimStart] = useState("0");
  const [trimEnd, setTrimEnd] = useState("");
  const audioBusy = processMutation.isPending;
  const runTrim = () => {
    const s = parseFloat(trimStart) || 0;
    const e = parseFloat(trimEnd);
    if (!isFinite(e) || e <= s) { toast.error("请输入有效的截取区间（结束秒 > 开始秒）"); return; }
    if (!payload.url) return;
    processMutation.mutate({ url: payload.url, trimStart: s, trimEnd: e, projectId: data.projectId });
  };
  const runSpeed = (sp: number) => {
    if (!payload.url) return;
    processMutation.mutate({ url: payload.url, speed: sp, projectId: data.projectId });
  };
  const audioToolBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--c-surface)", border: "none", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" };

  return (<>
    {selected && payload.url && (
      <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={10}>
        <div className="nodrag flex items-center gap-1" style={{ position: "relative", background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", borderRadius: 11, padding: "5px 7px", boxShadow: "var(--c-node-shadow-hover)" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setTrimOpen((v) => !v); setSpeedOpen(false); setTrimStart("0"); setTrimEnd(payload.duration ? String(Math.round(payload.duration * 10) / 10) : ""); }}
            disabled={audioBusy}
            title="截取（保留指定区间，其余剪掉）"
            className="studio-toolbtn rounded-lg"
            style={{ ...audioToolBtn, background: trimOpen ? "var(--c-elevated)" : "var(--c-surface)" }}
          >
            {audioBusy ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />} 截取
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setSpeedOpen((v) => !v); setTrimOpen(false); }}
            disabled={audioBusy}
            title="变速（不变调，0.5×～2×）"
            className="studio-toolbtn rounded-lg"
            style={{ ...audioToolBtn, background: speedOpen ? "var(--c-elevated)" : "var(--c-surface)" }}
          >
            <Gauge size={12} /> 变速
          </button>
          <span style={{ width: 1, height: 16, background: "var(--c-bd2)", margin: "0 1px" }} />
          <button
            onClick={(e) => { e.stopPropagation(); void downloadMedia(payload.url!, `${payload.name || data.title || "audio"}.mp3`, "video"); }}
            title="下载音频"
            className="studio-toolbtn rounded-lg"
            style={{ ...audioToolBtn, padding: "0 8px" }}
          >
            <Download size={13} />
          </button>
          {/* 截取浮层 */}
          {trimOpen && (
            <div className="nodrag" onClick={(e) => e.stopPropagation()}
              style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 40, display: "flex", alignItems: "center", gap: 6, padding: 10, borderRadius: 10, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 12px 36px rgba(0,0,0,0.45)", whiteSpace: "nowrap" }}>
              <input value={trimStart} onChange={(e) => setTrimStart(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal"
                style={{ width: 56, height: 26, padding: "0 6px", fontSize: 11.5, borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
              <span style={{ fontSize: 11, color: "var(--c-t3)" }}>秒 →</span>
              <input value={trimEnd} onChange={(e) => setTrimEnd(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder={payload.duration ? String(Math.round(payload.duration)) : "结束"}
                style={{ width: 56, height: 26, padding: "0 6px", fontSize: 11.5, borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
              <span style={{ fontSize: 11, color: "var(--c-t3)" }}>秒{payload.duration ? ` · 全长 ${Math.round(payload.duration * 10) / 10}s` : ""}</span>
              <button onClick={runTrim} disabled={audioBusy}
                style={{ height: 26, padding: "0 12px", borderRadius: 7, border: "none", fontSize: 11.5, fontWeight: 700, background: "var(--ui-accent, var(--c-accent))", color: "#0b0d12", cursor: "pointer" }}>
                {audioBusy ? "处理中…" : "确定"}
              </button>
            </div>
          )}
          {/* 变速浮层 */}
          {speedOpen && (
            <div className="nodrag" onClick={(e) => e.stopPropagation()}
              style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 40, display: "flex", alignItems: "center", gap: 4, padding: 10, borderRadius: 10, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 12px 36px rgba(0,0,0,0.45)", whiteSpace: "nowrap" }}>
              {[0.5, 0.75, 1.25, 1.5, 2].map((sp) => (
                <button key={sp} onClick={() => runSpeed(sp)} disabled={audioBusy}
                  style={{ height: 26, padding: "0 10px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
                  {audioBusy ? "…" : `${sp}×`}
                </button>
              ))}
              <span style={{ fontSize: 10.5, color: "var(--c-t4)", marginLeft: 4 }}>不变调</span>
            </div>
          )}
        </div>
      </NodeToolbar>
    )}
    <BaseNode id={id} selected={selected} nodeType="audio" title={data.title} minHeight={isCreativeMode ? 56 : 160} resizable
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
        style={(() => {
          // 创意模式：点击选中不展开完整配置区（对齐图像/视频节点），由输入条「高级」开关展开。
          // #152：音频工具（tools）形态特殊（选工具/源音频/多轨结果），底部就地条承载不下——
          // 创意模式切到 tools 类别时自动展开完整工具面板（免去「必须切工作室皮肤」的误导）。
          const open = isCreativeMode ? (advancedOpen || category === "tools") : expanded;
          return {
            overflow: "hidden",
            maxHeight: open ? "9999px" : "0px",
            transition: open
              ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
              : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
          };
        })()}
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
            {/* #153 原生续写：本站 Suno 曲目生成后出现——用 audio_id 直接续写，无需上传源音频。 */}
            {payload.poyoAudioId && (
              <button
                className="nodrag"
                onClick={handleNativeExtend}
                disabled={toolMutation.isPending || musicMutation.isPending}
                title="用本曲的 audio_id 原生续写（Suno），产出更长的曲目"
                style={{ marginTop: 6, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)",
                  opacity: (toolMutation.isPending || musicMutation.isPending) ? 0.6 : 1 }}
              >
                {toolMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 原生续写
              </button>
            )}
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
              value={SFX_MODELS.some((m) => m.value === payload.sfxModel) ? payload.sfxModel : "kie_elevenlabs_sfx"}
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <label className="nodrag" title="不指定时长，由模型按描述自动决定" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: payload.sfxDuration == null ? accent : "var(--c-t4)", cursor: "pointer" }}>
                    <input type="checkbox" checked={payload.sfxDuration == null}
                      onChange={(e) => update("sfxDuration", e.target.checked ? undefined : 5)}
                      style={{ accentColor: accent, margin: 0 }} />
                    自动
                  </label>
                  <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>
                    {payload.sfxDuration == null ? "按描述" : `${payload.sfxDuration}秒`}
                  </span>
                </span>
              </div>
              {payload.sfxDuration != null && (
                <input
                  type="range" min={0.5} max={22} step={0.1}
                  value={payload.sfxDuration}
                  onChange={(e) => update("sfxDuration", Math.round(Number(e.target.value) * 10) / 10)}
                  className="nodrag w-full"
                  style={{ accentColor: accent }}
                />
              )}
            </div>
            <label className="nodrag" title="生成可平滑无缝循环的音效（适合雨声/风声等持续氛围）" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: payload.sfxLoop ? accent : "var(--c-t3)", cursor: "pointer" }}>
              <input type="checkbox" checked={payload.sfxLoop ?? false} onChange={(e) => update("sfxLoop", e.target.checked)} style={{ accentColor: accent, margin: 0 }} />
              无缝循环（氛围声）
            </label>
            <GenerateBtn disabled={!payload.sfxPrompt?.trim() || sfxMutation.isPending} loading={sfxMutation.isPending} onClick={handleGenerateSFX} label="生成音效"
              costLabel={costEstimateLabel({ credits: 0.24 * Math.max(0.5, payload.sfxDuration ?? 5), unit: "点", approx: true })} />
          </>
        )}

        {/* ── 工具 Tools（#152 人声分离 / 翻唱 / 续写 / 写歌词）── */}
        {category === "tools" && (() => {
          const tool = payload.toolModel ?? "sep_vocals";
          const availTools = AUDIO_TOOL_MODELS.filter((m) => !disabledModels.has(m.value));
          const srcUrl = payload.toolAudioUrl ?? upstreamAudio[0]?.url ?? "";
          const needsAudio = tool !== "lyrics";
          const canRun = tool === "lyrics"
            ? !!payload.toolPrompt?.trim()
            : (!!srcUrl && (tool !== "cover" || !!payload.toolPrompt?.trim()));
          return (
          <>
            <ModelSelect
              models={availTools.length ? availTools : AUDIO_TOOL_MODELS}
              value={tool}
              onChange={(v) => update("toolModel", v)}
            />
            {/* 源音频（分离/翻唱/续写需要）：优先上游连线，可上传覆盖。 */}
            {needsAudio && (
              <div>
                <label style={labelStyle}>源音频</label>
                {srcUrl ? (
                  <div className="flex items-center gap-2" style={{ fontSize: 11, color: "var(--c-t2)" }}>
                    <Volume2 style={{ width: 12, height: 12, flexShrink: 0, color: accent }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {payload.toolAudioName || upstreamAudio[0]?.name || "已选音频"}
                    </span>
                    {payload.toolAudioUrl && (
                      <button className="nodrag" title="清除上传，改用上游音频"
                        onClick={() => update("toolAudioUrl", undefined)}
                        style={{ background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer", padding: 2 }}>
                        <X style={{ width: 11, height: 11 }} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--c-t4)" }}>连接一个上游音频节点，或点下方「上传源音频」</div>
                )}
                <button className="nodrag" onClick={() => toolFileInputRef.current?.click()}
                  style={{ marginTop: 6, fontSize: 11, padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                    background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Upload style={{ width: 11, height: 11 }} /> 上传源音频
                </button>
                <input ref={toolFileInputRef} type="file" accept="audio/*" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleToolAudioUpload(f); e.currentTarget.value = ""; }} />
              </div>
            )}
            {/* 人声分离：质量 + 目标音轨 */}
            {tool === "sep_vocals" && (
              <>
                <div>
                  <label style={labelStyle}>分离质量</label>
                  <ModelSelect bare
                    models={[
                      { value: "base", label: "标准", desc: "默认速度/质量", group: "" },
                      { value: "enhanced", label: "高质量", desc: "更准更慢", group: "" },
                      { value: "instrumental", label: "器乐优化", desc: "适合纯伴奏", group: "" },
                    ]}
                    value={payload.toolSepModel ?? "base"}
                    onChange={(v) => update("toolSepModel", v)}
                  />
                </div>
                <div>
                  <label style={labelStyle}>目标音轨</label>
                  <ModelSelect bare
                    models={[
                      { value: "general", label: "全部音轨", desc: "人声+伴奏+各乐器", group: "" },
                      { value: "vocals", label: "仅人声", desc: "", group: "" },
                      { value: "drums", label: "仅鼓", desc: "", group: "" },
                      { value: "bass", label: "仅贝斯", desc: "", group: "" },
                      { value: "piano", label: "仅钢琴", desc: "", group: "" },
                      { value: "guitar", label: "仅吉他", desc: "", group: "" },
                      { value: "other", label: "其他乐器", desc: "", group: "" },
                    ]}
                    value={payload.toolSepOutput ?? "general"}
                    onChange={(v) => update("toolSepOutput", v)}
                  />
                </div>
              </>
            )}
            {/* 翻唱 / 续写 / 写歌词：文本描述 */}
            {tool !== "sep_vocals" && (
              <div>
                <label style={labelStyle}>
                  {tool === "cover" ? "想要的风格（必填）" : tool === "extend" ? "续写方向（可选）" : "歌词主题 / 描述"}
                </label>
                <NodeTextArea className="nodrag nowheel" rows={3}
                  placeholder={tool === "cover" ? "例如：改成 lo-fi 爵士、女声、慵懒..." : tool === "extend" ? "留空则由模型自然续写；也可描述走向" : "描述主题、情绪、故事，例如：夏夜海边的告别"}
                  value={payload.toolPrompt ?? ""}
                  onValueChange={(v) => update("toolPrompt", v)}
                  style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
            )}
            {/* 续写：起始秒 */}
            {tool === "extend" && (
              <div className="flex items-center justify-between">
                <label style={{ ...labelStyle, marginBottom: 0 }}>从第几秒续写</label>
                <NodeInput type="number" className="nodrag"
                  value={String(payload.toolContinueAt ?? 0)}
                  onValueChange={(v) => update("toolContinueAt", Math.max(0, Number(v) || 0))}
                  style={{ ...fieldStyle, width: 80, textAlign: "right" }} />
              </div>
            )}
            {/* 翻唱 / 续写：模型版本 + 纯器乐 */}
            {(tool === "cover" || tool === "extend") && (
              <>
                <div>
                  <label style={labelStyle}>模型版本</label>
                  <ModelSelect bare
                    models={[
                      { value: "V5", label: "Suno V5", desc: "推荐", group: "" },
                      { value: "V5_5", label: "Suno V5.5", desc: "个性化", group: "" },
                      { value: "V4_5PLUS", label: "Suno V4.5 PLUS", desc: "更丰富", group: "" },
                      { value: "V4_5", label: "Suno V4.5", desc: "", group: "" },
                      { value: "V4", label: "Suno V4", desc: "经典", group: "" },
                    ]}
                    value={payload.toolMv ?? "V5"}
                    onChange={(v) => update("toolMv", v)}
                  />
                </div>
                <label className="nodrag" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: payload.toolInstrumental ? accent : "var(--c-t3)", cursor: "pointer" }}>
                  <input type="checkbox" checked={payload.toolInstrumental ?? false} onChange={(e) => update("toolInstrumental", e.target.checked)} style={{ accentColor: accent, margin: 0 }} />
                  纯器乐（无人声）
                </label>
              </>
            )}
            <GenerateBtn
              disabled={!canRun || toolMutation.isPending}
              loading={toolMutation.isPending}
              onClick={() => {
                if (needsAudio && !srcUrl) { toast.error("请先上传或连接一段源音频"); return; }
                toolMutation.mutate({
                  tool, projectId: data.projectId,
                  audioUrl: needsAudio ? srcUrl : undefined,
                  prompt: payload.toolPrompt?.trim() || undefined,
                  sepModel: tool === "sep_vocals" ? (payload.toolSepModel ?? "base") : undefined,
                  sepOutput: tool === "sep_vocals" ? (payload.toolSepOutput ?? "general") : undefined,
                  mv: (tool === "cover" || tool === "extend") ? ((payload.toolMv ?? "V5") as "V4" | "V4_5" | "V4_5ALL" | "V4_5PLUS" | "V5" | "V5_5") : undefined,
                  instrumental: (tool === "cover" || tool === "extend") ? (payload.toolInstrumental ?? false) : undefined,
                  continueAt: tool === "extend" ? (payload.toolContinueAt ?? 0) : undefined,
                  estimatedCost: costEstimateLabel(estimateAudioToolCost(tool)) || undefined,
                });
              }}
              label={AUDIO_TOOL_MODELS.find((m) => m.value === tool)?.label ?? "运行"}
              costLabel={costEstimateLabel(estimateAudioToolCost(tool))}
            />
            {/* 结果：分离多轨列表 / 歌词文本 */}
            {payload.toolStems && Object.keys(payload.toolStems).length > 0 && (
              <div style={{ marginTop: 4 }}>
                <label style={labelStyle}>分离结果（{Object.keys(payload.toolStems).length} 条）</label>
                <div className="flex flex-col gap-1">
                  {Object.entries(payload.toolStems).map(([stem, u]) => (
                    <div key={stem} className="flex items-center gap-2" style={{ fontSize: 11, color: "var(--c-t2)" }}>
                      <span style={{ width: 44, color: "var(--c-t4)" }}>{({ vocals: "人声", bass: "贝斯", drums: "鼓", piano: "钢琴", guitar: "吉他", other: "其他" } as Record<string, string>)[stem] ?? stem}</span>
                      <audio src={u} controls preload="none" className="nodrag" style={{ flex: 1, height: 26 }} />
                      <a href={u} download className="nodrag" title="下载" style={{ color: "var(--c-t4)" }}><Download style={{ width: 12, height: 12 }} /></a>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {payload.toolLyrics && (
              <div style={{ marginTop: 4 }}>
                <label style={labelStyle}>生成的歌词</label>
                <NodeTextArea className="nodrag nowheel" rows={6} value={payload.toolLyrics}
                  onValueChange={(v) => update("toolLyrics", v)}
                  style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.7 }} />
              </div>
            )}
          </>
          );
        })()}

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
              href={safeHref(payload.ttsTimestampsUrl)}
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

    {/* LibTV 化：创意模式就地生成输入条——类别 chips + 文本 + 翻译（配音）+ 积分 + 发送。
        读写与配置区同一 payload 字段（双向同步）；模型等细节参数仍在配置区调整。 */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={expanded} width={480}>
        <NodeTextArea
          className="nodrag nowheel"
          rows={2}
          placeholder={category === "dubbing" ? "输入要合成的配音文本…" : category === "sfx" ? "描述你想要的音效…" : category === "tools" ? "音频工具已在上方展开——选工具·连/传源音频·点运行…" : "描述你想生成的音乐…"}
          value={(category === "dubbing" ? payload.ttsText : category === "sfx" ? payload.sfxPrompt : category === "tools" ? payload.toolPrompt : payload.musicPrompt) ?? ""}
          onValueChange={(v) => updateNodeData(id, category === "dubbing" ? { ttsText: v } : category === "sfx" ? { sfxPrompt: v } : category === "tools" ? { toolPrompt: v } : { musicPrompt: v })}
          style={{ width: "100%", resize: "none", fontSize: 13, lineHeight: 1.6, padding: "6px 8px", borderRadius: 9, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {/* 类别切换 chips */}
          {([
            { key: "music" as const, label: "配乐" },
            { key: "dubbing" as const, label: "配音" },
            { key: "sfx" as const, label: "音效" },
            { key: "tools" as const, label: "工具" },
          ]).map(({ key, label }) => (
            <button key={key} className="nodrag"
              onClick={(e) => { e.stopPropagation(); updateNodeData(id, { audioCategory: key }); }}
              style={{ height: 28, padding: "0 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                background: category === key ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)",
                border: `1px solid ${category === key ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`,
                color: category === key ? "var(--c-t1)" : "var(--c-t3)" }}>
              {label}
            </button>
          ))}
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          {/* 模型选择（按类别切换字段，与配置区双向同步） */}
          {category === "music" && (
            <ModelSelect bare models={MUSIC_MODELS} value={normalizeMusicModel(payload.musicModel ?? payload.aiModel)} onChange={(v) => updateNodeData(id, { musicModel: v })} />
          )}
          {category === "dubbing" && (
            <ModelSelect bare models={DUBBING_MODELS} value={DUBBING_MODELS.some((m) => m.value === payload.ttsModel) ? payload.ttsModel : DUBBING_MODELS[0]?.value} onChange={(v) => updateNodeData(id, { ttsModel: v })} />
          )}
          {category === "sfx" && (
            <ModelSelect bare models={SFX_MODELS} value={SFX_MODELS.some((m) => m.value === payload.sfxModel) ? payload.sfxModel : "kie_elevenlabs_sfx"} onChange={(v) => updateNodeData(id, { sfxModel: v })} />
          )}
          {/* 设置浮层（LibTV）：常用参数按类别向上弹出——节点本体不再展开配置区 */}
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button className="nodrag"
              onClick={(e) => { e.stopPropagation(); setSettingsOpen((v) => !v); }}
              title="设置（风格/音色/语速/时长等常用参数）"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: settingsOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}>
              <SlidersHorizontal size={12} /> 设置
            </button>
            {settingsOpen && (
              <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 40, width: 288, maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 11, padding: 12, borderRadius: 12, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
                {category === "music" && (<>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>风格标签</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {MUSIC_STYLES_ZH.map((s) => (
                        <button key={s} className="nodrag" onClick={() => updateNodeData(id, { musicStyle: payload.musicStyle === s ? undefined : s })}
                          style={{ padding: "4px 9px", fontSize: 10.5, borderRadius: 99, border: `1px solid ${payload.musicStyle === s ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: payload.musicStyle === s ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)", color: payload.musicStyle === s ? "var(--c-t1)" : "var(--c-t2)", cursor: "pointer" }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)" }}>纯器乐</span>
                    <button className="nodrag" onClick={() => updateNodeData(id, { musicInstrumental: !(payload.musicInstrumental ?? true) })}
                      style={{ position: "relative", width: 32, height: 18, borderRadius: 9, background: (payload.musicInstrumental ?? true) ? "color-mix(in oklab, var(--ui-accent) 70%, transparent)" : "var(--c-bd1)", border: "1px solid var(--c-bd3)", cursor: "pointer" }}>
                      <span style={{ position: "absolute", top: 2, left: (payload.musicInstrumental ?? true) ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "var(--c-t1)", transition: "left 150ms ease" }} />
                    </button>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>排除元素（可选）</div>
                    <input value={payload.musicNegativeTags ?? ""} onChange={(e) => updateNodeData(id, { musicNegativeTags: e.target.value })}
                      placeholder="例如：drums, vocals" className="nodrag"
                      style={{ width: "100%", fontSize: 11, padding: "5px 8px", borderRadius: 7, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
                  </div>
                </>)}
                {category === "dubbing" && (<>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>音色</div>
                    <select value={payload.ttsVoice ?? voicesForModel(payload.ttsModel)[0]?.value ?? ""} className="nodrag"
                      onChange={(e) => updateNodeData(id, { ttsVoice: e.target.value })}
                      style={{ width: "100%", fontSize: 11, padding: "5px 8px", borderRadius: 7, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}>
                      {voicesForModel(payload.ttsModel).map((v) => <option key={v.value} value={v.value} style={{ background: "var(--c-surface)" }}>{v.label} · {v.desc}</option>)}
                    </select>
                  </div>
                  {modelSupportsSpeed(payload.ttsModel) && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)" }}>语速</span>
                        <span style={{ fontSize: 11, color: "var(--c-t3)" }}>{(payload.ttsSpeed ?? 1).toFixed(2)}×</span>
                      </div>
                      <input type="range" min={0.5} max={2} step={0.05} value={payload.ttsSpeed ?? 1} className="nodrag"
                        onChange={(e) => updateNodeData(id, { ttsSpeed: Number(e.target.value) })}
                        style={{ width: "100%", accentColor: "var(--ui-accent, var(--c-accent))" }} />
                    </div>
                  )}
                </>)}
                {category === "sfx" && (<>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>时长（秒，0.5–22，留空自动）</div>
                    <input type="number" min={0.5} max={22} step={0.5} value={payload.sfxDuration ?? ""} className="nodrag"
                      onChange={(e) => updateNodeData(id, { sfxDuration: e.target.value === "" ? undefined : Number(e.target.value) })}
                      style={{ width: "100%", fontSize: 11, padding: "5px 8px", borderRadius: 7, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)" }}>可循环</span>
                    <button className="nodrag" onClick={() => updateNodeData(id, { sfxLoop: !payload.sfxLoop })}
                      style={{ position: "relative", width: 32, height: 18, borderRadius: 9, background: payload.sfxLoop ? "color-mix(in oklab, var(--ui-accent) 70%, transparent)" : "var(--c-bd1)", border: "1px solid var(--c-bd3)", cursor: "pointer" }}>
                      <span style={{ position: "absolute", top: 2, left: payload.sfxLoop ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "var(--c-t1)", transition: "left 150ms ease" }} />
                    </button>
                  </div>
                </>)}
              </div>
            )}
          </span>
          {category === "dubbing" && (
            <button className="nodrag" onClick={(e) => { e.stopPropagation(); handleTranslate(); }} disabled={translateMut.isPending}
              title={`翻译配音文本（目标：${payload.ttsTranslateTarget ?? "英语"}，配置区可改）`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}>
              {translateMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />} 翻译
            </button>
          )}
          <div style={{ flex: 1 }} />
          {category === "music" && (
            <span title="按当前音乐模型预估的点数消耗，仅供参考" style={{ fontSize: 11, color: "var(--c-t3)", whiteSpace: "nowrap" }}>
              ⚡ {costEstimateLabel(estimateMusicCost(normalizeMusicModel(payload.musicModel ?? payload.aiModel))) || "—"}
            </span>
          )}
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          <button
            className="nodrag"
            onClick={(e) => {
              e.stopPropagation();
              if (category === "dubbing") handleGenerateTTS();
              else if (category === "sfx") handleGenerateSFX();
              else handleGenerateMusic();
            }}
            disabled={musicMutation.isPending || ttsMutation.isPending || sfxMutation.isPending}
            title="生成"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 30, borderRadius: 9, border: "none", cursor: "pointer", background: "var(--ui-accent, var(--c-accent))", color: "#0b0d12" }}
          >
            {(musicMutation.isPending || ttsMutation.isPending || sfxMutation.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
        </div>
      </InlineGenBar>
    )}
  </>);
});
