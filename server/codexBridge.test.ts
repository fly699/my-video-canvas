import { describe, it, expect } from "vitest";
import { codexModelArg, isGptLocalModel, pickCodexErrorDetail, resolveCodexSpawn } from "./_core/codexBridge";

describe("isGptLocalModel（同端点按前缀分流）", () => {
  it("gpt-local / gpt-local:xxx → true；claude-local/其它 → false", () => {
    expect(isGptLocalModel("gpt-local")).toBe(true);
    expect(isGptLocalModel("gpt-local:gpt-5.3-codex")).toBe(true);
    expect(isGptLocalModel("claude-local")).toBe(false);
    expect(isGptLocalModel(undefined)).toBe(false);
  });
});

describe("codexModelArg", () => {
  it("gpt-local（默认）→ null；后缀 → 透传；非法/超长 → null 防注入", () => {
    expect(codexModelArg("gpt-local")).toBeNull();
    expect(codexModelArg("gpt-local:gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(codexModelArg("gpt-local:a b")).toBeNull();
    expect(codexModelArg("gpt-local:" + "x".repeat(80))).toBeNull();
  });
});

describe("resolveCodexSpawn（Windows .cmd 坑，同 claude 方案）", () => {
  const A = ["exec", "-"];
  it("非 Windows：原样、不走 shell", () => {
    expect(resolveCodexSpawn("/usr/bin/codex", A, { platform: "linux" })).toEqual({ cmd: "/usr/bin/codex", args: A, shell: false });
  });
  it("Windows + .cmd + 找得到 codex.js → node 直跑、免 shell", () => {
    const r = resolveCodexSpawn("C:\\Users\\K\\AppData\\Roaming\\npm\\codex.cmd", A, { platform: "win32", exists: () => true });
    expect(r.cmd).toBe(process.execPath);
    expect(r.shell).toBe(false);
    expect(r.args[0]).toContain("codex.js");
  });
  it("Windows + .cmd + 找不到 → 兜底 shell", () => {
    expect(resolveCodexSpawn("C:\\x\\codex.cmd", A, { platform: "win32", exists: () => false }).shell).toBe(true);
  });
});

describe("pickCodexErrorDetail（错误细节抽取——不能把会话回显糊给用户）", () => {
  it("stdout 有内容优先返回 stdout", () => {
    expect(pickCodexErrorDetail("模型侧的错误答复", "一堆日志", 1)).toBe("模型侧的错误答复");
  });
  it("stderr 含会话回显 + 错误行 → 只挑错误特征行，不泄露对话转写（真机翻车场景）", () => {
    const stderr = [
      "OpenAI Codex v0.x",
      "--------",
      "user instructions:",
      "系统提示：你是画布助手",
      "用户：帮我写一首诗",
      "助手：好的，这是……",
      '警告：未找到"gpt-5.3-codex"的模型元数据。默认使用备用元数据；这会降低性能并引发问题。',
      '错误：{"类型"："error"，"status"：400}',
    ].join("\n");
    const d = pickCodexErrorDetail("", stderr, 1);
    expect(d).toContain("未找到");
    expect(d).toContain("400");
    expect(d).not.toContain("帮我写一首诗");
    expect(d).not.toContain("画布助手");
  });
  it("stderr 无错误特征行 → 只取最后 3 行兜底", () => {
    const d = pickCodexErrorDetail("", "a\nb\nc\nd\ne", 1);
    expect(d).toBe("c\nd\ne");
  });
  it("全空 → 退出码 + auth.json 提示", () => {
    const d = pickCodexErrorDetail("", "", 2);
    expect(d).toContain("退出码 2");
    expect(d).toContain("auth.json");
  });
});

describe("resolveCodexSpawn — Windows 裸名自动探测 %APPDATA%\\npm", () => {
  it("裸 codex + 探到 codex.cmd → 免配置解析（进而 node 直跑 codex.js）", () => {
    const appData = "C:\\Users\\K\\AppData\\Roaming";
    const r = resolveCodexSpawn("codex", ["exec", "-"], {
      platform: "win32", appData,
      exists: (p) => p.endsWith("codex.cmd") || p.endsWith("codex.js"),
    });
    expect(r.cmd).toBe(process.execPath);
    expect(r.args[0]).toContain("codex.js");
  });
  it("裸 codex + 探不到 → 原样（ENOENT 由错误提示接手）", () => {
    const r = resolveCodexSpawn("codex", ["exec"], { platform: "win32", appData: "C:\\x", exists: () => false });
    expect(r).toEqual({ cmd: "codex", args: ["exec"], shell: false });
  });
  it("非 Windows 不探测", () => {
    expect(resolveCodexSpawn("codex", ["exec"], { platform: "linux", exists: () => true }).cmd).toBe("codex");
  });
});
