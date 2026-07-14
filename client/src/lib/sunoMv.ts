// #153 把音乐节点选用的 Poyo 音乐模型 id 映射到 Suno 版本号（mv）。
// 仅 Suno 系 generate-music 产出的曲目才有可用于「原生续写/段落重写」的 audio_id + mv；
// MiniMax / ElevenLabs / kie 等非 Suno 模型返回 null（不提供原生续写）。
const SUNO_MODEL_TO_MV: Record<string, string> = {
  "suno-v4": "V4",
  "suno-v4.5": "V4_5",
  "suno-v4.5plus": "V4_5PLUS",
  "suno-v4.5all": "V4_5ALL",
  "suno-v5": "V5",
  "suno-v5.5": "V5_5",
  // 旧别名（generateMusic 里归一到 suno-v4）
  "suno-v3.5": "V4",
};

/** 音乐模型 id → Suno mv；非 Suno（MiniMax/ElevenLabs/kie 等）→ null。 */
export function sunoMvForModel(model: string | undefined): string | null {
  if (!model) return null;
  return SUNO_MODEL_TO_MV[model] ?? null;
}
