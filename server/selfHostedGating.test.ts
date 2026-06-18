import { describe, it, expect, vi, beforeEach } from "vitest";

// Self-hosted LLM gating must be consistent with ComfyUI (own server, zero cloud cost):
// assertLLMAllowed routes self-hosted models through the comfyui bypass, NOT the cloud
// LLM whitelist. Cloud models keep the LLM whitelist behaviour.
const settings = { id: 1, enabled: true, llmBypass: false, comfyuiBypass: false, kieEnabled: false, updatedAt: new Date() };
vi.mock("../server/db", () => ({
  getWhitelistSettings: async () => settings,
  isWhitelisted: async () => false, // 用户不在白名单
}));

const ctx = { user: { id: 7, role: "user", adminLevel: 0 } } as never; // 非超管

async function freshAssert() {
  vi.resetModules();
  const m = await import("./_core/whitelist");
  return m.assertLLMAllowed;
}
const allowed = async (fn: (c: never, model?: string) => Promise<void>, model?: string) => {
  try { await fn(ctx, model); return true; } catch { return false; }
};

describe("assertLLMAllowed — 自建 LLM 与 ComfyUI 门控一致", () => {
  beforeEach(() => {
    process.env.SELF_HOSTED_LLM_URL = "http://172.16.0.10:8000";
    process.env.SELF_HOSTED_LLM_MODELS = "Qwen3.6-35B-A3B-FP8";
    Object.assign(settings, { enabled: true, llmBypass: false, comfyuiBypass: false });
  });

  it("自建模型 + comfyuiBypass 开 → 放行（即便 llmBypass 关、用户不在白名单）", async () => {
    settings.comfyuiBypass = true;
    expect(await allowed(await freshAssert(), "Qwen3.6-35B-A3B-FP8")).toBe(true);
  });

  it("自建模型 + comfyuiBypass 关 + 白名单开 → 拦截（与 ComfyUI 一致，不看 llmBypass）", async () => {
    settings.comfyuiBypass = false; settings.llmBypass = true; // llmBypass 开也不放行自建
    expect(await allowed(await freshAssert(), "Qwen3.6-35B-A3B-FP8")).toBe(false);
  });

  it("云模型仍走 LLM 白名单：llmBypass 开 → 放行", async () => {
    settings.llmBypass = true; settings.comfyuiBypass = false;
    expect(await allowed(await freshAssert(), "gemini-3-flash-preview")).toBe(true);
  });

  it("云模型：llmBypass 关 + 白名单开 → 拦截（comfyuiBypass 开也不影响云模型）", async () => {
    settings.llmBypass = false; settings.comfyuiBypass = true;
    expect(await allowed(await freshAssert(), "gemini-3-flash-preview")).toBe(false);
  });

  it("未配置 SELF_HOSTED_LLM_URL 时，该 model 不被当作自建 → 走云白名单", async () => {
    delete process.env.SELF_HOSTED_LLM_URL;
    settings.comfyuiBypass = true; settings.llmBypass = false; // 只有 comfyui 开
    // 不再是自建 → 走云白名单(llmBypass 关、不在白名单) → 拦截
    expect(await allowed(await freshAssert(), "Qwen3.6-35B-A3B-FP8")).toBe(false);
  });
});
