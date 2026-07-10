// ── 多主体参考语法（LibTV 化 2.3）─────────────────────────────────────────────
// LibTV 交互：视频提示词里用「主体1 / 主体2 / 主体3」指代按顺序附加的参考图
// （如「把主体1放到主体2的场景里」），生成时主体编号与参考图顺序一一绑定。
//
// 本项目落法（纯提示词层，不动 API 字段）：
// - 主体N ↔ referenceImageUrls[N-1]（即参考图条自上而下第 N 张，与 buildRefUrls
//   的发送顺序同源）。
// - 提交时若提示词用了主体N，则确定性追加一行中文映射说明（多模态视频模型按文本
//   理解绑定；对不理解的模型只是无害的尾注）。
// - 越界（主体N 超出实际发送张数）在提交前拦截，避免用户以为绑定生效了。
//
// 注意与既有「角色1/角色2」编号（mergeCharactersIntoPrompt，绑定连线/@ 的角色节点）
// 互补：主体N 绑定的是【手动参考图】的顺序，两套语法可共存。

/** 匹配「主体1」~「主体9」（允许全半角空格间隔，如「主体 2」）。上限 9 与视频
 *  provider 的多图上限（videoRefCaps 最大 9）一致。 */
export const SUBJECT_TOKEN_RE = /主体\s*([1-9])/g;

/** 提示词中用到的主体编号（去重、升序）。 */
export function usedSubjectIndices(prompt: string): number[] {
  const out = new Set<number>();
  const re = new RegExp(SUBJECT_TOKEN_RE.source, "g"); // 本地实例，避免共享 lastIndex
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) out.add(Number(m[1]));
  return Array.from(out).sort((a, b) => a - b);
}

/** 越界的主体编号：提示词引用了主体N，但实际发送的参考图不足 N 张。 */
export function subjectOverflow(prompt: string, refCount: number): number[] {
  return usedSubjectIndices(prompt).filter((n) => n > refCount);
}

/** 已追加过映射说明的判据（防重复追加——重试/二次提交同一提示词时幂等）。 */
const MAPPING_MARK = "主体编号与参考图顺序对应";

/**
 * 若提示词使用了主体N（且都在参考图张数内），确定性追加一行映射说明；
 * 否则原样返回。refCount < 1 或未用主体语法时不追加。
 */
export function appendSubjectMapping(prompt: string, refCount: number): string {
  if (refCount < 1 || prompt.includes(MAPPING_MARK)) return prompt;
  const used = usedSubjectIndices(prompt).filter((n) => n <= refCount);
  if (used.length === 0) return prompt;
  const pairs = used.map((n) => `主体${n}=第${n}张参考图`).join("、");
  return `${prompt}\n（${MAPPING_MARK}：${pairs}）`;
}
