import { describe, it, expect } from "vitest";
import { isGrokLocalModel, grokModelArg, extraGrokArgs, pickGrokErrorDetail } from "./_core/grokBridge";

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
