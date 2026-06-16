import { describe, it, expect } from "vitest";
import { dedupe } from "./_core/idempotency";

// Guards the videoTasks.create concurrent-create fix: two requests for the SAME
// (projectId,nodeId) racing before either INSERTs must collapse into ONE
// get-or-create execution (one row → one upstream submit → one charge). Different
// nodes must run independently. Mirrors the exact key shape used in canvas.ts.
describe("videoTasks.create 并发去重（dedupe by projectId+nodeId）", () => {
  const deferred = () => { let r!: () => void; const p = new Promise<void>((res) => { r = res; }); return { p, r }; };

  it("同一 (projectId,nodeId) 并发 → get-or-create 只执行一次（防双行双扣）", async () => {
    let calls = 0;
    const gate = deferred();
    const factory = async () => { calls++; await gate.p; return { task: { id: calls }, preexisting: false as const }; };
    const key = { projectId: 1, nodeId: "n1" };
    const a = dedupe("videoCreateRow", 42, key, factory);
    const b = dedupe("videoCreateRow", 42, key, factory); // 并发：A 未结算前进入
    gate.r();
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls).toBe(1);                 // 工厂只跑一次 → 只建一行
    expect(ra.task.id).toBe(rb.task.id);   // 两个请求拿到同一行
  });

  it("不同 nodeId 并发 → 各自独立执行", async () => {
    let calls = 0;
    const gate = deferred();
    const factory = async () => { calls++; await gate.p; return { task: { id: calls }, preexisting: false as const }; };
    const a = dedupe("videoCreateRow", 42, { projectId: 1, nodeId: "nA" }, factory);
    const b = dedupe("videoCreateRow", 42, { projectId: 1, nodeId: "nB" }, factory);
    gate.r();
    await Promise.all([a, b]);
    expect(calls).toBe(2); // 不同节点不合并
  });

  it("结算后再次请求 → 重新执行（不缓存陈旧结果）", async () => {
    let calls = 0;
    const key = { projectId: 1, nodeId: "n1" };
    await dedupe("videoCreateRow", 42, key, async () => { calls++; return { task: { id: 1 }, preexisting: false as const }; });
    await dedupe("videoCreateRow", 42, key, async () => { calls++; return { task: { id: 2 }, preexisting: false as const }; });
    expect(calls).toBe(2); // promise 结算后 cache 清除，顺序重复请求各自执行（由 findInFlight 兜底幂等）
  });
});
