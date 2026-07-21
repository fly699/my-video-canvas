// #322 流式回显 partial 超长裁剪策略（服务端裁剪与客户端排版共用同一标记）。
//
// 背景：chatStatus 轮询捎带的 partial 原来是 slice(-8000) 只留尾部——长计划（>8000 字）
// 开头的 "reply": / "operations": 键被截掉，客户端 formatStreamPreview 的「规划形态」
// 守卫不命中，整段回退成原始 JSON 直出（用户三张截图实锤：247~283s 的大计划全程裸 JSON）。
// 改为「头部 + 省略标记 + 尾部」：头部保住 reply 草稿与规划形态特征键，尾部保住最新进展，
// 客户端按标记分窗结构化，并在窗口之间显示省略提示行。

/** 头尾之间的省略标记。选用全角括号串，正常模型输出/JSON 里几乎不可能自然出现。 */
export const STREAM_OMIT_MARK = "\n〔…中间省略…〕\n";

/**
 * partial 裁剪：≤cap 原样返回；超长 → 头 headKeep 字 + 省略标记 + 尾部（总长仍 ≈cap）。
 * headKeep 取 1800：足够容纳 reply 草稿开头 + 最初几条操作（规划形态特征键必在其中）。
 * 纯函数。
 */
export function cutStreamPartial(s: string, cap = 8000, headKeep = 1800): string {
  if (s.length <= cap) return s;
  const tailKeep = Math.max(1000, cap - headKeep - STREAM_OMIT_MARK.length);
  return s.slice(0, headKeep) + STREAM_OMIT_MARK + s.slice(-tailKeep);
}
