import { parseDialogueLines } from "./dialogueCasting";

// ── 从镜头表生成字幕：确定性对位（零 ASR）────────────────────────────────────
// 数据源：合并节点装配时存下的逐镜对白（segDialogues）+ 合并完成后服务端回传的
// 各段成片起点（segStarts，xfade offset 精确值）。每镜内多行对白按字数比例切分
// 该段时间；行首「角色名：」剥离（字幕不显示角色名前缀）；有配音时长时字幕在
// 配音结束处收口（不挂到画面切走之后）。纯函数，单测友好。

export interface ShotSubtitleEntry { start: number; end: number; text: string }

export function buildShotSubtitles(opts: {
  segStarts: number[];
  segDialogues: (string | null | undefined)[];
  /** 成片总时长（用于最后一段的结束时间；缺省=末段起点+5s 兜底）。 */
  totalDuration?: number;
  /** 各镜配音时长（秒；有则将该镜字幕整体压缩到配音时长内）。 */
  voiceDurations?: (number | null | undefined)[];
}): ShotSubtitleEntry[] {
  const { segStarts, segDialogues, totalDuration, voiceDurations } = opts;
  const out: ShotSubtitleEntry[] = [];
  for (let i = 0; i < segStarts.length; i++) {
    const dialogue = segDialogues[i]?.trim();
    if (!dialogue) continue;
    const start = segStarts[i];
    const segEnd = i + 1 < segStarts.length ? segStarts[i + 1] : (totalDuration ?? start + 5);
    let span = Math.max(0.5, segEnd - start);
    const vd = voiceDurations?.[i];
    if (vd != null && vd > 0) span = Math.min(span, vd);
    const lines = parseDialogueLines(dialogue); // 剥「角色名：」前缀
    const totalChars = lines.reduce((s, l) => s + Math.max(1, l.text.length), 0);
    let t = start;
    for (let j = 0; j < lines.length; j++) {
      const w = Math.max(1, lines[j].text.length) / totalChars;
      const end = j === lines.length - 1 ? start + span : t + span * w;
      out.push({ start: round2(t), end: round2(Math.max(t + 0.3, end)), text: lines[j].text });
      t = end;
    }
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
