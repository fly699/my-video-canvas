// #303 双重人声（重音）冲突判定——纯函数，单测锁口径。
//
// 背景：可发声的视频模型（如 Grok Imagine）会把提示词里的台词【直接念出来】
//（#145 对白语种规则正是要求把台词原样写进视频提示词）；若该镜又生成了 TTS
// 配音并在装配时混入，成片就是两路人声叠着说话。此函数判定「这个镜的视频
// 提示词是否会念出这段对白」，供批量配音 confirm 与装配提示消费。
//
// 防误报是第一优先（宁可漏报不可误报——误报会让用户不敢配音）：
//  ① 主规则（精确）：对白里某句台词正文（剥掉「角色名：」前缀、≥4 字）
//     【原样出现】在视频提示词里——助手按规则原样写入，子串必中；
//  ② 辅规则：视频提示词自身含「角色名：台词」格式行，且该角色名出现在
//     本镜对白的角色集合里——防止「风格：写实」「运镜：推近」这类参数行
//     被当成对白（这些"角色名"不会在对白角色集合里）。
import { parseDialogueLines } from "./dialogueCasting";

export function videoPromptSpeaks(videoPrompt: string | undefined | null, dialogue: string | undefined | null): boolean {
  const vp = (videoPrompt ?? "").trim();
  const d = (dialogue ?? "").trim();
  if (!vp || !d) return false;
  const segs = parseDialogueLines(d);
  // ① 台词正文子串命中（旁白行同样适用）
  for (const s of segs) {
    const t = s.text.trim();
    if (t.length >= 4 && vp.includes(t)) return true;
  }
  // ② 视频提示词自含角色对白行，且角色属于本镜对白的角色集合
  const roles = new Set(segs.map((s) => s.role).filter((r): r is string => r != null));
  if (roles.size === 0) return false;
  return parseDialogueLines(vp).some((s) => s.role != null && roles.has(s.role));
}
