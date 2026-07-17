// AI 智能剪辑核心（移植自 browser-use/video-use，MIT，见 THIRD_PARTY_NOTICES.md）。
// 纯函数、无 IO：把「LLM 产出的保留区间(keep-list) + 调色档」+ 词级时间戳，映射成本项目的
// EditorDoc（视频轨按保留区间切片、每段 30ms 淡入淡出、可选逐词字幕），供 editor.aiCut 落地。
import { emptyEditorDoc, type EditorDoc, type Clip } from "@shared/editorTypes";

export type CutWord = { word: string; start: number; end: number };
export type CutRange = { start: number; end: number };
export interface AiCutPlan { keep: CutRange[]; grade?: string }

export interface AiCutSource {
  assetId?: number;
  assetUrl: string;
  width: number; height: number; fps: number;
  durationSec: number;
}
export interface AiCutOptions {
  fadeSec?: number;         // 每段淡入淡出（秒）。默认 0（直切）——fade 在导出/预览都是
                            // 「画面从黑渐显/渐黑」，内部切点加 fade 会在每个转场闪黑帧
                            //（用户实测反馈）；静音剪除的切点本在静音区，也无爆音可消。
  grade?: string;           // 覆盖 plan.grade（"none"/空 = 不调色）
  subtitles?: boolean;      // 生成逐词字幕（需要词级时间戳）
  subtitleMaxWords?: number;// 每条字幕最多词数（默认 5，兼顾"逐词"与可读/条数）
  subtitleMaxSec?: number;  // 每条字幕最长时长（默认 2.5s）
  padSec?: number;          // 每个保留区间左右外扩的安全边距（秒）——防止语音首尾（气口/辅音尾音）
                            // 被切掉。按激进度传入（轻=大边距、狠=小边距），默认 0。
}

// 字幕默认版式：底部居中（对齐常见成片字幕位置）。x/scale 让 0.8 宽的文本框水平居中，
// y=0.82 使字幕落在画面下方。预览(PreviewStage)与导出(collectTextClips)均读 transform，
// 显式写入才能保证「所见=所出」（否则二者默认值不一致：预览左上、导出左下）。
export const SUBTITLE_TRANSFORM = { x: 0.1, y: 0.82, scale: 0.8 } as const;

const VALID_GRADES = new Set(["subtle", "neutral_punch", "warm_cinematic", "none"]);

/** 从 LLM 文本里抠出剪辑方案 JSON。容错：扫描所有平衡花括号对、逐个 JSON.parse，取**第一个
 *  真正 `keep` 为数组**的对象——绝不被字符串里的 `"keep"` 字面量或 `{"keep":"yes"}` 之类诱饵骗走
 *  （否则模型先输出一句含 "keep" 的解释/候选就会让整个合法方案被判无效）。失败返回 null。 */
export function parseAiCutPlan(text: string): AiCutPlan | null {
  const rec = extractPlanObject(text);
  if (!rec) return null;
  const keepIn = Array.isArray(rec.keep) ? rec.keep : null;
  if (!keepIn) return null;
  const keep: CutRange[] = [];
  for (const r of keepIn) {
    if (!r || typeof r !== "object") continue;
    const s = Number((r as Record<string, unknown>).start);
    const e = Number((r as Record<string, unknown>).end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) keep.push({ start: s, end: e });
  }
  const grade = typeof rec.grade === "string" && VALID_GRADES.has(rec.grade) ? rec.grade : undefined;
  return { keep, grade };
}

/** 扫描文本里所有平衡花括号对（跳过字符串内的括号），逐个 JSON.parse，返回**第一个 `keep` 为
 *  数组**的对象。都不满足时，退回第一个能解析的对象（供上层判定 keep 缺失→null）。 */
function extractPlanObject(text: string): Record<string, unknown> | null {
  let firstParsed: Record<string, unknown> | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const o = JSON.parse(text.slice(i, j + 1)) as unknown;
            if (o && typeof o === "object") {
              const rec = o as Record<string, unknown>;
              if (Array.isArray(rec.keep)) return rec;   // 命中真正的方案对象
              if (!firstParsed) firstParsed = rec;
            }
          } catch { /* 该对象非法（可能是更大对象的片段）——继续从下一个 { 扫 */ }
          i = j; // 从该对象末尾之后继续
          break;
        }
      }
    }
  }
  return firstParsed;
}

/** 静音剪除：把静音区间反转为保留区间（非静音段）。区间会先夹取排序；
 *  全片静音 → 空数组（调用方据此报「无可保留内容」）。纯函数便于单测。 */
export function invertSilencesToKeep(silences: CutRange[], durationSec: number): CutRange[] {
  const sil = sanitizeRanges(silences, durationSec);
  const keep: CutRange[] = [];
  let cursor = 0;
  for (const s of sil) {
    if (s.start > cursor) keep.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (durationSec > cursor) keep.push({ start: cursor, end: durationSec });
  return keep.filter((r) => r.end - r.start > 0.02);
}

/** 清洗保留区间：夹到 [0,duration]、去零/负长、按 start 排序、合并重叠/相邻(<0.02s)。 */
export function sanitizeRanges(ranges: CutRange[], durationSec: number): CutRange[] {
  const cleaned = ranges
    .map((r) => ({ start: Math.max(0, Math.min(r.start, durationSec)), end: Math.max(0, Math.min(r.end, durationSec)) }))
    .filter((r) => r.end - r.start > 0.02)
    .sort((a, b) => a.start - b.start);
  const merged: CutRange[] = [];
  for (const r of cleaned) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < 0.02) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** 把区间边界吸附到最近的词边界（±tol 秒内），避免切在词中间；无词表则原样返回。 */
export function snapToWordBoundaries(ranges: CutRange[], words: CutWord[], tol = 0.3): CutRange[] {
  if (!words.length) return ranges;
  const starts = words.map((w) => w.start);
  const ends = words.map((w) => w.end);
  const nearest = (arr: number[], v: number) => {
    let best = v, bestD = tol;
    for (const x of arr) { const d = Math.abs(x - v); if (d < bestD) { bestD = d; best = x; } }
    return best;
  };
  return ranges.map((r) => {
    const start = nearest(starts, r.start);
    const end = nearest(ends, r.end);
    return end > start ? { start, end } : r;
  });
}

/** 把源时间点重映射到「剪后输出时间轴」（减去它之前被删除的时长）。区间外返回 null。 */
function mapToOutput(srcT: number, kept: CutRange[]): number | null {
  let out = 0;
  for (const r of kept) {
    if (srcT < r.start) return null;      // 落在被删段里
    if (srcT <= r.end) return out + (srcT - r.start);
    out += r.end - r.start;
  }
  return null;
}

/** 逐词字幕 → 文字轨片段（映射到输出时间轴，按 maxWords/maxSec 成句，控条数）。 */
export function buildSubtitleClips(words: CutWord[], kept: CutRange[], opts: AiCutOptions, fontSize: number): Clip[] {
  const maxWords = opts.subtitleMaxWords ?? 5;
  const maxSec = opts.subtitleMaxSec ?? 2.5;
  const inKept = words.filter((w) => mapToOutput((w.start + w.end) / 2, kept) != null);
  const clips: Clip[] = [];
  let i = 0, n = 0;
  const CAP = 480; // 单轨 clip 上限 500，留余量
  while (i < inKept.length && clips.length < CAP) {
    const first = inKept[i];
    const startOut = mapToOutput(first.start, kept);
    if (startOut == null) { i++; continue; }
    const cue: CutWord[] = [];
    let j = i;
    while (j < inKept.length && cue.length < maxWords && (inKept[j].end - first.start) <= maxSec) {
      // 只把同一保留段内、时间连续的词并入一句（跨删除段则断句）
      if (mapToOutput(inKept[j].start, kept) == null) break;
      cue.push(inKept[j]); j++;
    }
    if (!cue.length) { i++; continue; }
    const endOut = mapToOutput(cue[cue.length - 1].end, kept) ?? startOut + 0.5;
    const content = cue.map((w) => w.word).join("").trim() || cue.map((w) => w.word).join(" ").trim();
    clips.push({
      id: `ai-sub-${n++}`, kind: "text", start: round3(startOut), trimIn: 0,
      trimOut: Math.max(0.3, round3(endOut - startOut)),
      transform: { ...SUBTITLE_TRANSFORM }, // 底部居中，保证预览与导出一致
      text: { content, size: fontSize, color: "#ffffff", strokeColor: "#000000", strokeWidth: Math.max(2, Math.round(fontSize / 16)), align: "center", motionStyle: "none" },
    });
    i = j;
  }
  return clips;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** 核心：保留区间 + 词级时间戳 → EditorDoc（视频切片 + 30ms 淡入淡出 + 调色 + 可选字幕）。 */
export function buildAiCutDoc(source: AiCutSource, plan: AiCutPlan, words: CutWord[], opts: AiCutOptions = {}): EditorDoc {
  // 默认直切（#147 同原则）：0.03s 画面 fade 曾让每个内部切点闪黑帧（fade=t=in 是从黑渐显）。
  const fade = opts.fadeSec ?? 0;
  const grade = (opts.grade ?? plan.grade ?? "none");
  const useGrade = !!grade && grade !== "none";
  // 先吸附到词边界，再左右外扩安全边距（防切掉语音首尾），最后 sanitize 夹取并合并重叠。
  const pad = Math.max(0, opts.padSec ?? 0);
  const snapped = snapToWordBoundaries(plan.keep, words);
  const padded = pad > 0 ? snapped.map((r) => ({ start: r.start - pad, end: r.end + pad })) : snapped;
  const kept = sanitizeRanges(padded, source.durationSec);

  const doc = emptyEditorDoc(source.width, source.height, source.fps);
  doc.normalizeAudio = true; // video-use 收尾 loudnorm；导出统一到 -14 LUFS
  const vTrack = doc.tracks.find((t) => t.type === "video")!;

  // 起点精确连续：trim 先各自取 3 位小数，段长用「取整后的 trim」计算并同样保持 3 位，
  // 逐段累加不产生浮点漂移——相邻片段 start 严格首尾相接（漂移会造成亚帧空隙，
  // 预览在空隙瞬间无激活片段 → 黑一闪；导出侧空隙则可能补黑帧）。
  let outT = 0;
  kept.forEach((r, idx) => {
    const tin = round3(r.start), tout = round3(r.end);
    const dur = tout - tin;
    if (dur <= 0.02) return;
    const f = Math.min(fade, dur / 2);
    const clip: Clip = {
      id: `ai-v-${idx}`, kind: "video",
      ...(source.assetId != null ? { assetId: source.assetId } : {}),
      assetUrl: source.assetUrl,
      start: round3(outT), trimIn: tin, trimOut: tout,
      fadeIn: round3(f), fadeOut: round3(f), fadeCurve: "hsin",
      ...(useGrade ? { effects: { filter: grade } } : {}),
    };
    vTrack.clips.push(clip);
    outT = round3(outT + dur);
  });

  if (opts.subtitles && words.length) {
    const tTrack = doc.tracks.find((t) => t.type === "text")!;
    const fontSize = Math.max(24, Math.round(source.height * 0.045));
    tTrack.clips.push(...buildSubtitleClips(words, kept, opts, fontSize));
  }
  return doc;
}

/** 统计（给前端反馈：保留/删除时长、片段/字幕数）。 */
export function aiCutStats(doc: EditorDoc, durationSec: number): { keptSec: number; removedSec: number; clips: number; subtitles: number } {
  const v = doc.tracks.find((t) => t.type === "video");
  const t = doc.tracks.find((t) => t.type === "text");
  const keptSec = (v?.clips ?? []).reduce((s, c) => s + (c.trimOut - c.trimIn), 0);
  return { keptSec: round3(keptSec), removedSec: round3(Math.max(0, durationSec - keptSec)), clips: v?.clips.length ?? 0, subtitles: t?.clips.length ?? 0 };
}
