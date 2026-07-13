// #140 skipComfyTemplates：客户端确定本轮不用 ComfyUI（快速设置未勾任何 comfyui_*）时，
// 规划应完全绕开模板链路——不触发模板分析、不读模板表、不注入模板知识段；
// 未跳过时行为不变（读表 + 触发后台增量分析）。注意用例顺序：skip 用例在前，
// 否则模块级 in-flight 守卫会吞掉后续分析触发的断言语义。
import { describe, it, expect, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbCtl = vi.hoisted(() => ({ listTemplateCalls: 0 }));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listComfyNodeTemplates: vi.fn(async () => { dbCtl.listTemplateCalls++; return actual.listComfyNodeTemplates(); }),
  };
});
vi.mock("./_core/templateAnalysis", () => ({
  runLibraryAnalysis: vi.fn(async () => ({ total: 0, analyzed: 0, failed: 0, skipped: 0 })),
}));
vi.mock("./_core/llmWithKie", () => ({
  invokeLLMWithKie: vi.fn(async () => ({ choices: [{ message: { content: '{"reply":"收到","operations":[]}' } }] })),
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

describe("#140 skipComfyTemplates", () => {
  it("跳过时：不读模板表、不触发模板分析，规划正常返回", async () => {
    const caller = appRouter.createCaller(ctx());
    const r = await caller.agent.chat({ projectId: 1, message: "做个 10 秒短片", skipComfyTemplates: true });
    expect(r.reply).toBe("收到");
    expect(dbCtl.listTemplateCalls).toBe(0);
    expect(vi.mocked(runLibraryAnalysis)).not.toHaveBeenCalled();
  }, 5000);

  it("未跳过时：读模板表并触发后台增量分析（行为不变）", async () => {
    const caller = appRouter.createCaller(ctx());
    const r = await caller.agent.chat({ projectId: 1, message: "再来一版" });
    expect(r.reply).toBe("收到");
    expect(dbCtl.listTemplateCalls).toBeGreaterThan(0);
    expect(vi.mocked(runLibraryAnalysis)).toHaveBeenCalled();
  }, 5000);

  it("comfyOnly 优先：即使误传 skipComfyTemplates 也仍等待全量分析并读模板", async () => {
    const caller = appRouter.createCaller(ctx());
    const before = dbCtl.listTemplateCalls;
    const r = await caller.agent.chat({ projectId: 1, message: "只用 ComfyUI", comfyOnly: true, skipComfyTemplates: true });
    // dev 模板库为空 → comfyOnly 走「模板知识库为空」的明确指引回复（不是 LLM 回复）。
    expect(r.reply).toContain("模板");
    expect(dbCtl.listTemplateCalls).toBeGreaterThan(before);
  }, 5000);
});
