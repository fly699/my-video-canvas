import { describe, it, expect } from "vitest";
import { dedupe, _resetDedupeCacheForTests } from "./_core/idempotency";

// M1 regression: the dedupe key must ignore the cosmetic `estimatedCost` field
// (recomputed per render). Two otherwise-identical paid requests that differ only
// in estimatedCost must still collapse into ONE execution (one charge).
describe("dedupe key 忽略展示字段 estimatedCost（M1）", () => {
  it("仅 estimatedCost 不同的并发请求 → 合并为一次执行", async () => {
    _resetDedupeCacheForTests();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fn = async () => { calls++; await gate; return calls; };
    const a = dedupe("imageGen", 1, { model: "kie_gpt", prompt: "cat", estimatedCost: "≈5 cr" }, fn);
    const b = dedupe("imageGen", 1, { model: "kie_gpt", prompt: "cat", estimatedCost: "≈6 cr" }, fn);
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1); // 一次执行 → 一次扣费
  });

  it("真正影响计费的字段不同 → 不合并", async () => {
    _resetDedupeCacheForTests();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fn = async () => { calls++; await gate; return calls; };
    const a = dedupe("imageGen", 1, { model: "kie_gpt", prompt: "cat", estimatedCost: "≈5 cr" }, fn);
    const b = dedupe("imageGen", 1, { model: "kie_gpt", prompt: "dog", estimatedCost: "≈5 cr" }, fn);
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(2); // prompt 不同 → 两次
  });
});
