// ── 角色分音色 casting：「角色名：台词」对白解析与分段配音计划 ──────────────────
// 纯函数（无 store / 无副作用），供镜头表批量配音与单测使用。
//
// 安全口径：解析出的「角色」只有在用户于「角色音色」表里显式分配了音色时才会
// 触发分段 casting 路径（shouldCast）；未分配 = 维持原「整段单音色 TTS」行为，
// 因此把旁白误判成角色不会改变任何现有行为，只是在分配表里多一个可忽略的候选。

export interface DialogueSegment {
  /** 角色名；null = 旁白/无角色前缀的行。 */
  role: string | null;
  /** 台词正文（已剥离「角色名：」前缀——casting 路径下 TTS 不会念出角色名）。 */
  text: string;
}

/** 逐行解析对白：「角色名：台词」（中英文冒号均可；角色名 ≤12 字、不含空白与
 *  常见标点）识别为角色段，其余行视为旁白（role=null）。空行忽略。
 *  角色名后可跟全/半角括号标注——「林晓（独白）：」「孙朗(画外音):」——role 取
 *  括号前的纯名（否则与 casting 表里的「林晓」对不上、音色分配失效），括号标注
 *  是舞台指示，不进 TTS 文本。 */
export function parseDialogueLines(dialogue: string): DialogueSegment[] {
  const out: DialogueSegment[] = [];
  for (const raw of dialogue.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^：:，。！？!?,.\s（(）)]{1,12})(?:[（(][^（）()]{0,16}[）)])?\s*[：:]\s*(.+)$/);
    if (m) out.push({ role: m[1], text: m[2].trim() });
    else out.push({ role: null, text: line });
  }
  return out;
}

/** 把对白剥成「只含台词」的纯文本（去掉每行「角色名（标注）：」前缀）——
 *  非 casting 的整段单音色 TTS 同样不该把角色名/舞台指示念出来。 */
export function stripDialogueRoles(dialogue: string): string {
  return parseDialogueLines(dialogue).map((s) => s.text).join("\n");
}

/** 从多镜对白中提取出现过的角色名（保持首次出现顺序、去重）。 */
export function extractRoles(dialogues: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dialogues) {
    if (!d) continue;
    for (const s of parseDialogueLines(d)) {
      if (s.role && !seen.has(s.role)) { seen.add(s.role); out.push(s.role); }
    }
  }
  return out;
}

export interface CastVoice { model: string; voice: string }
export type CastMap = Record<string, CastVoice>;

/** 该镜是否触发 casting 分段路径：存在角色段，且至少一个角色已被分配音色。 */
export function shouldCast(segs: DialogueSegment[], cast: CastMap): boolean {
  return segs.some((s) => s.role != null && cast[s.role] != null);
}

export interface CastPlanItem extends CastVoice { text: string }

/** 生成分段 TTS 计划：每段套用其角色的音色（未分配/旁白 → fallback）；
 *  相邻同音色段合并为一次 TTS 调用，减少请求数与拼接段数。 */
export function planCastSegments(segs: DialogueSegment[], cast: CastMap, fallback: CastVoice): CastPlanItem[] {
  const plan: CastPlanItem[] = [];
  for (const s of segs) {
    const cv = (s.role != null ? cast[s.role] : undefined) ?? fallback;
    const last = plan[plan.length - 1];
    if (last && last.model === cv.model && last.voice === cv.voice) {
      last.text += "\n" + s.text;
    } else {
      plan.push({ text: s.text, model: cv.model, voice: cv.voice });
    }
  }
  return plan;
}
