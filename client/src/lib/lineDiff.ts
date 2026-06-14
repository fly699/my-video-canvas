// 零依赖逐行 diff（经典 LCS 动态规划）。脚本正文通常 < 8000 字、行数有限，
// O(n·m) 的 DP 表完全够用，无需引入 jsdiff/fast-diff 等依赖。
//
// 用于「脚本版本历史」面板：对比「当前正文」与某个历史版本，逐行高亮新增/删除。

export type DiffLine = { type: "same" | "add" | "del"; text: string };

/**
 * 逐行 diff。返回从 `oldText` 变为 `newText` 的逐行操作序列：
 * - "same"：两侧都有的行（未变）
 * - "del"：仅 `oldText` 有（被删除）
 * - "add"：仅 `newText` 有（被新增）
 *
 * 顺序遵循 LCS 回溯结果，使相同行尽量对齐，改动呈现为「删旧 + 增新」。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.length ? oldText.split("\n") : [];
  const b = newText.length ? newText.split("\n") : [];
  const n = a.length;
  const m = b.length;

  // dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: "del", text: a[i] }); i++; }
  while (j < m) { out.push({ type: "add", text: b[j] }); j++; }
  return out;
}

/** diff 统计：新增/删除行数，用于面板摘要（如「+3 −1」）。 */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
  }
  return { added, removed };
}
