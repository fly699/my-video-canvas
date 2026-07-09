import { describe, it, expect } from "vitest";
import { pushResultSnapshot, RESULT_HISTORY_CAP } from "./resultHistory";
import type { ResultSnapshot } from "../../../shared/types";

const s = (url: string, at = 0): ResultSnapshot => ({ url, at });

describe("pushResultSnapshot（节点版本历史 + 回滚）", () => {
  it("新图追加到最前，最新在前", () => {
    let h = pushResultSnapshot(undefined, s("a", 1));
    h = pushResultSnapshot(h, s("b", 2));
    h = pushResultSnapshot(h, s("c", 3));
    expect(h.map((x) => x.url)).toEqual(["c", "b", "a"]);
  });

  it("已在历史里的 url（回滚到旧快照 / 重复产出）→ 原样返回同一引用，不重排、不重复", () => {
    const h = pushResultSnapshot(pushResultSnapshot(undefined, s("a", 1)), s("b", 2)); // [b,a]
    const same1 = pushResultSnapshot(h, s("a", 9)); // 回滚到 a
    expect(same1).toBe(h);                          // 同引用（调用方据此跳过写入，防更新环）
    expect(same1.map((x) => x.url)).toEqual(["b", "a"]); // 顺序不变
    const same2 = pushResultSnapshot(h, s("b", 9)); // 当前就是 b
    expect(same2).toBe(h);
  });

  it("空 url 不记录", () => {
    const h = pushResultSnapshot(undefined, s("a", 1));
    expect(pushResultSnapshot(h, s("", 2))).toBe(h);
  });

  it(`封顶 ${RESULT_HISTORY_CAP} 条，丢弃最旧`, () => {
    let h: ResultSnapshot[] | undefined;
    for (let i = 0; i < RESULT_HISTORY_CAP + 5; i++) h = pushResultSnapshot(h, s(`u${i}`, i));
    expect(h!).toHaveLength(RESULT_HISTORY_CAP);
    expect(h![0].url).toBe(`u${RESULT_HISTORY_CAP + 4}`); // 最新
    expect(h![h!.length - 1].url).toBe("u5");            // 最旧的 u0..u4 已被挤出
  });
});
