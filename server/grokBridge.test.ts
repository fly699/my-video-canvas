import { describe, it, expect } from "vitest";
import { isGrokLocalModel, grokModelArg, extraGrokArgs, pickGrokErrorDetail, resolveGrokBin, parseGrokJsonResult } from "./_core/grokBridge";

describe("isGrokLocalModel", () => {
  it("命中 grok-local / grok-local:xxx（大小写不敏感），其余不命中", () => {
    expect(isGrokLocalModel("grok-local")).toBe(true);
    expect(isGrokLocalModel("grok-local:grok-4.5")).toBe(true);
    expect(isGrokLocalModel("GROK-LOCAL")).toBe(true);
    expect(isGrokLocalModel("claude-local")).toBe(false);
    expect(isGrokLocalModel("gpt-local")).toBe(false);
    expect(isGrokLocalModel("grok-4.5")).toBe(false); // 直连 API 模型，不是桥接
    expect(isGrokLocalModel(undefined)).toBe(false);
    expect(isGrokLocalModel(123)).toBe(false);
  });
});

describe("grokModelArg", () => {
  it("无后缀 → null（订阅默认，不传 -m）", () => {
    expect(grokModelArg("grok-local")).toBeNull();
    expect(grokModelArg("grok-local:")).toBeNull();
  });
  it("取冒号后缀作 -m 值", () => {
    expect(grokModelArg("grok-local:grok-4.5")).toBe("grok-4.5");
    expect(grokModelArg("grok-local:grok-4-fast-reasoning")).toBe("grok-4-fast-reasoning");
  });
  it("非法/超长/含注入字符 → null（回退默认，防命令行注入）", () => {
    expect(grokModelArg("grok-local:a b")).toBeNull();
    expect(grokModelArg("grok-local:a;rm -rf")).toBeNull();
    expect(grokModelArg("grok-local:" + "x".repeat(80))).toBeNull();
    expect(grokModelArg(42)).toBeNull();
  });
});

describe("extraGrokArgs", () => {
  it("空/未设 → []；空格分隔切词", () => {
    expect(extraGrokArgs(undefined)).toEqual([]);
    expect(extraGrokArgs("  ")).toEqual([]);
    expect(extraGrokArgs("--output-format json")).toEqual(["--output-format", "json"]);
    expect(extraGrokArgs("  --a   --b c ")).toEqual(["--a", "--b", "c"]);
  });
});

describe("resolveGrokBin（Windows 自动探测默认安装路径，免手配 GROK_BIN）", () => {
  it("显式 GROK_BIN 最高优先，原样返回", () => {
    expect(resolveGrokBin({ env: { GROK_BIN: "D:\\tools\\grok.exe" }, platform: "win32", exists: () => false })).toBe("D:\\tools\\grok.exe");
  });
  it("Windows + 默认安装位置命中 → 绝对路径", () => {
    const bin = resolveGrokBin({
      env: { USERPROFILE: "C:\\Users\\KingT" }, platform: "win32",
      exists: (p) => p === "C:\\Users\\KingT\\.grok\\bin\\grok.exe",
    });
    expect(bin).toBe("C:\\Users\\KingT\\.grok\\bin\\grok.exe");
  });
  it("Windows + 默认位置不存在 → 回退裸名 grok（走 PATH）", () => {
    expect(resolveGrokBin({ env: { USERPROFILE: "C:\\Users\\KingT" }, platform: "win32", exists: () => false })).toBe("grok");
  });
  it("非 Windows → 裸名 grok（不探测）", () => {
    expect(resolveGrokBin({ env: { USERPROFILE: "/home/kingt" }, platform: "linux", exists: () => true })).toBe("grok");
  });
  it("Windows 无 USERPROFILE 时用 HOMEDRIVE+HOMEPATH 兜底", () => {
    const bin = resolveGrokBin({
      env: { HOMEDRIVE: "C:", HOMEPATH: "\\Users\\KingT" }, platform: "win32",
      exists: (p) => p === "C:\\Users\\KingT\\.grok\\bin\\grok.exe",
    });
    expect(bin).toBe("C:\\Users\\KingT\\.grok\\bin\\grok.exe");
  });
});

describe("parseGrokJsonResult（Grok Build 的 json 结构：回复在 text 字段，非 Claude 的 result）", () => {
  it("真机样本：取 text 字段作回复，丢弃 thought 推理", () => {
    const stdout = JSON.stringify({
      text: "你好。我是通用 AI 助手，会直接、如实、简洁地回答问题。\n\n需要什么帮助，直接说就行。",
      stopReason: "EndTurn",
      sessionId: "019f4724-4b95-7773-a780-d361a0ba8af3",
      requestId: "8c5de88a-445a-41b3-a57f-43393d96af35",
      thought: "The user is greeting me with 你好 (Hello)...",
    });
    const r = parseGrokJsonResult(stdout);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("通用 AI 助手");
    expect(r.text).not.toContain("greeting"); // thought 绝不外发
  });
  it("兼容 result / response / message 字段", () => {
    expect(parseGrokJsonResult(JSON.stringify({ result: "答A" })).text).toBe("答A");
    expect(parseGrokJsonResult(JSON.stringify({ response: "答B" })).text).toBe("答B");
    expect(parseGrokJsonResult(JSON.stringify({ message: "答C" })).text).toBe("答C");
  });
  it("末尾夹带日志时仍能抽出末尾 JSON", () => {
    const r = parseGrokJsonResult('[info] starting...\n{"text":"实际回答","stopReason":"EndTurn"}');
    expect(r.text).toBe("实际回答");
    expect(r.isError).toBe(false);
  });
  it("非 JSON 裸文本 → 原样当回复", () => {
    expect(parseGrokJsonResult("直接就是纯文本回答")).toEqual({ text: "直接就是纯文本回答", isError: false });
  });
  it("空输出 / JSON 但无文本字段 → isError", () => {
    expect(parseGrokJsonResult("").isError).toBe(true);
    expect(parseGrokJsonResult(JSON.stringify({ stopReason: "EndTurn" })).isError).toBe(true);
  });
  it("error 字段 → 作错误文本返回", () => {
    const r = parseGrokJsonResult(JSON.stringify({ error: "session expired" }));
    expect(r.isError).toBe(true);
    expect(r.text).toContain("session expired");
  });
});

describe("pickGrokErrorDetail", () => {
  it("stdout 有内容优先原样返回", () => {
    expect(pickGrokErrorDetail("答案在这", "some log", 0)).toBe("答案在这");
  });
  it("无 stdout 时从 stderr 抽错误特征行", () => {
    const stderr = "用户：hi\n助手：...\nError: session expired, please login\n横幅信息";
    expect(pickGrokErrorDetail("", stderr, 1)).toContain("session expired");
  });
  it("stderr 无错误特征时取尾部若干行", () => {
    expect(pickGrokErrorDetail("", "行1\n行2\n行3\n行4", 1)).toContain("行4");
  });
  it("全空 → 给出登录/安装排查提示", () => {
    expect(pickGrokErrorDetail("", "", 127)).toMatch(/订阅登录|XAI_API_KEY/);
  });
});
