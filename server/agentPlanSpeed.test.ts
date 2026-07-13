// #136 画布助手规划提速：非 comfyOnly 的模板增量分析不得阻塞规划链路（此前规划前要
// 串行等最多 6 次 LLM 分析调用，是「规划太慢」的头号元凶）；comfyOnly 仍必须等分析
// （否则智能体只认识半个模板库会选错模板）。同时验证 submitChat → chatStatus 轮询
// 在 running 时带 stage/elapsedMs（前端等待行显示「模型规划中 · 已 Ns」）。
import { describe, it, expect, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const llmCtl = vi.hoisted(() => ({ delayMs: 0 }));

// 模板分析挂起永不返回：若规划链路还在 await 它，非 comfyOnly 测试会直接超时。
vi.mock("./_core/templateAnalysis", () => ({
  runLibraryAnalysis: vi.fn(() => new Promise(() => { /* never resolves */ })),
}));
vi.mock("./_core/llmWithKie", () => ({
  invokeLLMWithKie: vi.fn(async () => {
    if (llmCtl.delayMs) await new Promise((r) => setTimeout(r, llmCtl.delayMs));
    return { choices: [{ message: { content: '{"reply":"收到","operations":[]}' } }] };
  }),
}));
vi.mock("./_core/whitelist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/whitelist")>();
  return { ...actual, assertLLMAllowed: vi.fn(async () => {}) };
});
vi.mock("./_core/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/permissions")>();
  return { ...actual, assertProjectAccess: vi.fn(async () => {}) };
});

import { appRouter } from "./routers";
import { runLibraryAnalysis } from "./_core/templateAnalysis";

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "u1", name: "T", email: "t@x.com", loginMethod: "manus",
      passwordHash: null, role: "user", adminLevel: 0,
      disabled: false, emailVerified: true, approved: true, verifyCode: null, verifyCodeExpiresAt: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    clientIp: "127.0.0.1",
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("#136 画布助手规划提速", () => {
  it("非 comfyOnly：模板分析后台跑（不阻塞规划），且确实被触发", async () => {
    const caller = appRouter.createCaller(ctx());
    // runLibraryAnalysis 永不 resolve——若仍被 await，这里会挂死到 vitest 超时。
    const r = await caller.agent.chat({ projectId: 1, message: "帮我做个 10 秒短片" });
    expect(r.reply).toBe("收到");
    expect(vi.mocked(runLibraryAnalysis)).toHaveBeenCalled();
  }, 5000);

  it("非 comfyOnly：在飞守卫——分析未完成时连续两轮规划只起一次分析", async () => {
    const caller = appRouter.createCaller(ctx());
    const before = vi.mocked(runLibraryAnalysis).mock.calls.length;
    await caller.agent.chat({ projectId: 1, message: "再来一版" });
    await caller.agent.chat({ projectId: 1, message: "换个风格" });
    // 上一个（永不完成的）分析还在飞，不应重复起新的。
    expect(vi.mocked(runLibraryAnalysis).mock.calls.length).toBe(before === 0 ? 1 : before);
  }, 5000);

  it("comfyOnly：仍等待模板分析完成（不提前返回半库知识的规划）", async () => {
    const caller = appRouter.createCaller(ctx());
    const p = caller.agent.chat({ projectId: 1, message: "只用 ComfyUI 做", comfyOnly: true });
    const raced = await Promise.race([p.then(() => "resolved"), sleep(300).then(() => "pending")]);
    expect(raced).toBe("pending"); // 分析挂着 → 规划必须还没返回
    p.catch(() => {}); // 挂起的 promise 测试结束即弃
  }, 5000);

  it("submitChat → chatStatus：running 带 stage/elapsedMs，完成后取到结果", async () => {
    llmCtl.delayMs = 400;
    try {
      const caller = appRouter.createCaller(ctx());
      const { jobId } = await caller.agent.submitChat({ projectId: 1, message: "做个片" });
      await sleep(120); // 快速前置步骤（devStore 读库）应已过，正卡在 LLM mock 的 400ms 上
      const running = await caller.agent.chatStatus({ jobId });
      expect(running.state).toBe("running");
      const run = running as { stage?: string; elapsedMs?: number };
      expect(run.stage).toBe("模型规划中");
      expect(typeof run.elapsedMs).toBe("number");
      // 轮询到完成
      let done: Awaited<ReturnType<typeof caller.agent.chatStatus>> | undefined;
      for (let i = 0; i < 30; i++) {
        await sleep(100);
        const st = await caller.agent.chatStatus({ jobId });
        if (st.state !== "running") { done = st; break; }
      }
      expect(done?.state).toBe("done");
      expect((done as { result?: { reply: string } }).result?.reply).toBe("收到");
    } finally {
      llmCtl.delayMs = 0;
    }
  }, 8000);
});
