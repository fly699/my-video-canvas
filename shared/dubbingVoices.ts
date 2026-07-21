/**
 * #295 配音模型 × 音色目录（shared 单一真源，供两端消费）：
 *  - server（agentCatalog sanitize + agent 提示词注入）校验/展示画布助手「锁定角色音色」
 *    （canvas set_voice 操作）的取值——LLM 只能从这里选，防幻觉音色 id；
 *  - client（agentApply 落地守卫）二次校验后写入角色节点声音档案（voiceModel/voiceId）。
 *
 * 四组音色常量（OPENAI/ELEVENLABS/GEMINI/XAI）在此定义并导出，
 * client/src/components/canvas/nodes/AudioNode.tsx 的 voicesForModel 直接 import 复用
 * ——两端物理上同一份数据，杜绝漂移（曾经各存一份靠守卫测试对齐，现已收敛为单源）。
 * voxcpm-local 刻意不在目录里——它的音色来自参考音频克隆，没有可枚举的
 * voiceId，助手锁不了（提示词会引导用户走声音克隆节点）。
 */

export interface DubbingVoice { value: string; label: string; desc: string }

export const OPENAI_VOICES: DubbingVoice[] = [
  { value: "alloy",   label: "艾洛伊 Alloy",   desc: "中性" },
  { value: "echo",    label: "回声 Echo",      desc: "男声" },
  { value: "fable",   label: "寓言 Fable",     desc: "英式" },
  { value: "onyx",    label: "玛瑙 Onyx",      desc: "低沉" },
  { value: "nova",    label: "新星 Nova",      desc: "女声" },
  { value: "shimmer", label: "微光 Shimmer",   desc: "柔和" },
];
export const ELEVENLABS_VOICES: DubbingVoice[] = [
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
export const GEMINI_VOICES: DubbingVoice[] = [
  "Kore", "Puck", "Zephyr", "Charon", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
  "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((v) => ({ value: v, label: v, desc: v === "Kore" ? "默认" : "" }));
export const XAI_VOICES: DubbingVoice[] = [
  { value: "eve", label: "Eve",  desc: "默认 · 女声" },
  { value: "ara", label: "Ara",  desc: "女声" },
  { value: "rex", label: "Rex",  desc: "男声" },
  { value: "sal", label: "Sal",  desc: "男声" },
  { value: "leo", label: "Leo",  desc: "男声" },
];

/** 模型 id → { 展示名, 计费说明, 音色表 }。顺序即推荐顺序（便宜稳定的在前）。 */
export const DUBBING_VOICE_CATALOG: { model: string; label: string; note: string; voices: DubbingVoice[] }[] = [
  { model: "openai_tts_real",          label: "OpenAI TTS",              note: "标准", voices: OPENAI_VOICES },
  { model: "openai_tts_hd_real",       label: "OpenAI TTS-HD",           note: "高清", voices: OPENAI_VOICES },
  { model: "openai_gpt4o_mini_tts",    label: "GPT-4o Mini TTS",         note: "支持风格指令", voices: OPENAI_VOICES },
  { model: "elevenlabs-v3-tts",        label: "ElevenLabs v3 TTS",       note: "Poyo", voices: ELEVENLABS_VOICES },
  { model: "elevenlabs-tts-turbo-2-5", label: "ElevenLabs Turbo 2.5",    note: "Poyo · 低延迟", voices: ELEVENLABS_VOICES },
  { model: "kie_elevenlabs_tts",       label: "ElevenLabs Turbo（kie）",  note: "kie", voices: ELEVENLABS_VOICES },
  { model: "kie_elevenlabs_tts_ml",    label: "ElevenLabs 多语 v2（kie）", note: "kie", voices: ELEVENLABS_VOICES },
  { model: "kie_elevenlabs_v3",        label: "ElevenLabs V3 对话（kie）", note: "kie", voices: ELEVENLABS_VOICES },
  { model: "gemini-3-1-flash-tts",     label: "Gemini 3.1 Flash TTS",    note: "Poyo · 表现力/多语", voices: GEMINI_VOICES },
  { model: "xai-tts-1",                label: "xAI TTS 1",               note: "Poyo · 超低价", voices: XAI_VOICES },
];

export function isValidDubbingVoice(model?: unknown, voice?: unknown): boolean {
  if (typeof model !== "string" || typeof voice !== "string") return false;
  const entry = DUBBING_VOICE_CATALOG.find((m) => m.model === model);
  return !!entry && entry.voices.some((v) => v.value === voice);
}

export function dubbingVoiceLabel(model: string, voice: string): string {
  const entry = DUBBING_VOICE_CATALOG.find((m) => m.model === model);
  const v = entry?.voices.find((x) => x.value === voice);
  return v ? `${v.label}${v.desc ? `·${v.desc}` : ""}（${entry!.label}）` : `${voice}（${model}）`;
}

/** 提示词用的紧凑清单（≈900 字符）：OpenAI/ElevenLabs/xAI 全量带性别描述，Gemini 只列名
 *  （官方星名无性别语义，模型据名挑不出「温柔女声」，引导优先前三组）。 */
export function dubbingVoicePromptLines(): string {
  const fmt = (vs: DubbingVoice[]) => vs.map((v) => `${v.value}(${v.desc || v.label})`).join(" ");
  return [
    `- OpenAI 系（openai_tts_real / openai_tts_hd_real / openai_gpt4o_mini_tts）音色：${fmt(OPENAI_VOICES)}`,
    `- ElevenLabs 系（elevenlabs-v3-tts / elevenlabs-tts-turbo-2-5 / kie_elevenlabs_tts / kie_elevenlabs_tts_ml / kie_elevenlabs_v3）音色：${fmt(ELEVENLABS_VOICES)}`,
    `- xai-tts-1 音色：${fmt(XAI_VOICES)}`,
    `- gemini-3-1-flash-tts 音色：${GEMINI_VOICES.map((v) => v.value).join("/")}（星名无音色语义，除非用户点名否则别选）`,
  ].join("\n");
}
