import { describe, it, expect } from "vitest";
import { safeName, parseRange } from "./_core/fileRelay";

describe("fileRelay.safeName", () => {
  it("保留普通文件名（含中文/空格/点）", () => {
    expect(safeName("bigfile.mov")).toBe("bigfile.mov");
    expect(safeName("我的 视频.mp4")).toBe("我的 视频.mp4");
    expect(safeName("a.b.c.tar.gz")).toBe("a.b.c.tar.gz");
  });
  it("拒绝路径穿越与分隔符", () => {
    expect(safeName("../etc/passwd")).toBe("passwd"); // basename 取末段
    expect(safeName("/abs/path/x")).toBe("x");
    expect(safeName("a/b")).toBe("b");
    expect(safeName("..")).toBeNull();
    expect(safeName(".")).toBeNull();
    expect(safeName("")).toBeNull();
    expect(safeName("a\\b")).toBeNull();
    expect(safeName("a\0b")).toBeNull();
  });
  it("超长拒绝", () => {
    expect(safeName("x".repeat(256))).toBeNull();
    expect(safeName("x".repeat(255))).toBe("x".repeat(255));
  });
});

describe("fileRelay.parseRange", () => {
  const size = 1000;
  it("无 Range 返回 null（整文件）", () => {
    expect(parseRange(undefined, size)).toBeNull();
  });
  it("正常区间", () => {
    expect(parseRange("bytes=0-499", size)).toEqual({ start: 0, end: 499 });
    expect(parseRange("bytes=500-999", size)).toEqual({ start: 500, end: 999 });
  });
  it("开放结尾取到文件末", () => {
    expect(parseRange("bytes=200-", size)).toEqual({ start: 200, end: 999 });
  });
  it("后缀范围（最后 N 字节）", () => {
    expect(parseRange("bytes=-100", size)).toEqual({ start: 900, end: 999 });
  });
  it("end 超出按文件末截断", () => {
    expect(parseRange("bytes=900-99999", size)).toEqual({ start: 900, end: 999 });
  });
  it("非法返回 invalid", () => {
    expect(parseRange("bytes=abc", size)).toBe("invalid");
    expect(parseRange("items=0-10", size)).toBe("invalid");
    expect(parseRange("bytes=-", size)).toBe("invalid");
    expect(parseRange("bytes=500-100", size)).toBe("invalid"); // start>end
  });
});
