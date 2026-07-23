// #336 情绪调节（对齐 LibTV「人像质感调节 › 情绪调节」）：二维情绪坐标系
// 纵轴=唤醒度（激动 ↕ 平静），横轴=亲疏度（亲近 ↔ 疏离），5×5 = 25 个预设情绪档。
// 每格：四字「情绪定位」命名 + 英文表情描述（喂给图像编辑模型）+ SVG 预览脸参数。
// 纯数据 + 纯函数，前后端共用、可单测。生成端走 imageEdit.run(operation="emotion")，
// 只改面部表情、身份/姿势/构图/光线严格不变。

export interface EmotionFaceParams {
  /** 眉毛整体抬升 0..1（惊讶抬高） */
  browRaise: number;
  /** 眉毛内端倾角 -1..1：负=内端下压（怒），正=内端上挑（悲/惊） */
  browAngle: number;
  /** 眼睛睁开度 0.1..1.4：1=常态，>1 瞪眼，<0.5 眯/垂 */
  eyeOpen: number;
  /** 嘴角弧度 -1..1：正=上扬（笑），负=下撇（悲/怒） */
  mouthCurve: number;
  /** 张嘴程度 0..1 */
  mouthOpen: number;
}

export interface EmotionCell {
  /** 稳定 id："r{row}c{col}" */
  id: string;
  /** 行 0(激动)..4(平静) */
  row: number;
  /** 列 0(亲近)..4(疏离) */
  col: number;
  /** 四字情绪定位（中文命名，UI 展示） */
  name: string;
  /** 英文情绪短语（提示词主词） */
  en: string;
  /** 英文表情细节描述（提示词正文） */
  desc: string;
  face: EmotionFaceParams;
}

const C = (
  row: number, col: number, name: string, en: string, desc: string,
  browRaise: number, browAngle: number, eyeOpen: number, mouthCurve: number, mouthOpen: number,
): EmotionCell => ({ id: `r${row}c${col}`, row, col, name, en, desc, face: { browRaise, browAngle, eyeOpen, mouthCurve, mouthOpen } });

/** 25 格情绪表：行=唤醒度（0 最激动 → 4 最平静），列=亲疏度（0 最亲近 → 4 最疏离）。
 *  锚点与 LibTV 实录对齐：中心=淡然自若；右上=心跳骤停；中上偏右=强忍悲戚；左下=积郁憋闷。 */
export const EMOTION_GRID: EmotionCell[] = [
  // ── 行 0：激动 ──
  C(0, 0, "欣喜若狂", "ecstatic joy", "beaming open-mouthed laugh, eyes crinkled with delight, cheeks lifted", 0.8, 0.2, 0.55, 1, 0.9),
  C(0, 1, "喜极而泣", "tears of joy", "overwhelmed happy crying, brows pinched upward, trembling joyful smile with teary eyes", 0.6, 0.5, 0.45, 0.7, 0.5),
  C(0, 2, "慷慨激昂", "impassioned fervor", "fired-up determined expression, intense wide eyes, brows drawn, mouth open mid-shout with conviction", 0.5, -0.4, 1.15, 0.15, 0.7),
  C(0, 3, "惊惶失措", "panicked alarm", "frightened panic, eyes wide with fear, raised arched brows, mouth agape in a gasp", 1, 0.6, 1.4, -0.35, 0.8),
  C(0, 4, "怒不可遏", "explosive rage", "furious anger, brows slammed down and knotted, glaring eyes, snarling downturned open mouth", 0.1, -1, 1.2, -0.7, 0.6),
  // ── 行 1 ──
  C(1, 0, "满面春风", "beaming warmth", "radiant warm smile lighting up the whole face, soft happy eyes", 0.5, 0.1, 0.75, 0.9, 0.35),
  C(1, 1, "兴致勃勃", "lively enthusiasm", "bright-eyed enthusiasm, eager smile, brows lifted with interest", 0.55, 0, 1.05, 0.6, 0.3),
  C(1, 2, "跃跃欲试", "eager anticipation", "keen anticipation, alert sparkling eyes, lips parted in a ready half-smile", 0.6, -0.1, 1.1, 0.4, 0.2),
  C(1, 3, "强忍悲戚", "restrained grief", "suppressed sorrow about to break through, brows pinched upward, glistening eyes, lips pressed tight and quivering downward", 0.25, 0.8, 0.6, -0.5, 0.05),
  C(1, 4, "心跳骤停", "heart-stopping shock", "sudden dumbstruck shock, eyes blown wide and frozen, brows shot up, jaw dropped speechless", 0.95, 0.45, 1.35, -0.2, 0.7),
  // ── 行 2：中间 ──
  C(2, 0, "温柔含笑", "gentle tender smile", "soft affectionate smile, warm relaxed gaze, kind eyes", 0.35, 0.15, 0.7, 0.55, 0.05),
  C(2, 1, "会心一笑", "knowing smile", "subtle knowing smile playing at the lips, amused glint in the eyes", 0.3, 0, 0.65, 0.45, 0),
  C(2, 2, "淡然自若", "calm composure", "serene composed neutral expression, steady relaxed gaze, natural at ease", 0.3, 0, 0.8, 0.05, 0),
  C(2, 3, "若有所思", "pensive thought", "thoughtful faraway look, slightly knitted brows, gaze drifting in contemplation", 0.2, 0.25, 0.6, -0.1, 0),
  C(2, 4, "冷眼旁观", "cold detachment", "cold detached stare, level unblinking gaze, faint hard set of the mouth", 0.15, -0.35, 0.75, -0.25, 0),
  // ── 行 3 ──
  C(3, 0, "脉脉温情", "tender affection", "quiet tender affection, soft lowered gaze, faint loving smile", 0.3, 0.2, 0.55, 0.4, 0),
  C(3, 1, "安然恬静", "serene tranquility", "peaceful tranquil expression, gently relaxed features, calm half-lidded eyes", 0.25, 0.1, 0.5, 0.25, 0),
  C(3, 2, "平心静气", "even-tempered calm", "steady even-tempered calm, smooth untroubled brow, composed mouth", 0.25, 0, 0.6, 0.1, 0),
  C(3, 3, "黯然神伤", "quiet sorrow", "quiet heartbroken sadness, downcast glistening eyes, inner brows raised, mouth turned down", 0.15, 0.6, 0.45, -0.45, 0),
  C(3, 4, "心灰意冷", "disheartened chill", "disillusioned weary coldness, dull distant eyes, faint bitter downturn of the lips", 0.1, 0.35, 0.5, -0.35, 0),
  // ── 行 4：平静 ──
  C(4, 0, "积郁憋闷", "pent-up gloom", "sullen pent-up brooding, brows pressed low, heavy-lidded dark stare, mouth clamped in a grim line", 0.05, -0.55, 0.55, -0.55, 0),
  C(4, 1, "倦意朦胧", "drowsy weariness", "sleepy weariness, drooping heavy eyelids, slack relaxed mouth", 0.1, 0.15, 0.3, -0.1, 0.1),
  C(4, 2, "心如止水", "still-water calm", "utterly still meditative calm, softly closed-down gaze, perfectly relaxed neutral face", 0.2, 0, 0.5, 0, 0),
  C(4, 3, "意兴阑珊", "listless indifference", "listless indifference, unfocused half-lidded eyes, faintly sagging mouth", 0.1, 0.2, 0.4, -0.2, 0),
  C(4, 4, "冷若冰霜", "icy frost", "glacial frozen expression, hard emotionless eyes, brows faintly lowered, lips set in a cold line", 0.05, -0.3, 0.6, -0.4, 0),
];

/** 按行列取格（越界返回 undefined）。 */
export function emotionCellAt(row: number, col: number): EmotionCell | undefined {
  return EMOTION_GRID.find((c) => c.row === row && c.col === col);
}

/** 中心默认格（淡然自若）。 */
export const EMOTION_DEFAULT_CELL = EMOTION_GRID.find((c) => c.row === 2 && c.col === 2)!;

// ── 强度档 ────────────────────────────────────────────────────────────────────
export type EmotionIntensity = "subtle" | "moderate" | "strong";
export const EMOTION_INTENSITIES: { value: EmotionIntensity; label: string; en: string }[] = [
  { value: "subtle", label: "轻微", en: "subtle and understated, barely-there micro-expression" },
  { value: "moderate", label: "适中", en: "clearly visible and natural" },
  { value: "strong", label: "强烈", en: "intense and dramatic, full-force" },
];

/** 组装情绪表情描述（作为 imageEdit「emotion」操作的 userPrompt 段）。
 *  身份/姿势/构图不变的硬约束由 buildImageEditInstruction("emotion") 统一包裹。 */
export function buildEmotionPrompt(cell: EmotionCell, intensity: EmotionIntensity = "moderate"): string {
  const level = EMOTION_INTENSITIES.find((i) => i.value === intensity) ?? EMOTION_INTENSITIES[1];
  return `"${cell.en}" (${cell.name}) — ${cell.desc}. The emotional expression should be ${level.en}.`;
}
