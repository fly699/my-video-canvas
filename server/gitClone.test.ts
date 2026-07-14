import { describe, it, expect } from "vitest";
import { parseGitHubRepo, buildAuthedRemote, publicRemote, isValidBranchName, redactToken } from "./_core/superAgent/gitClone";

describe("parseGitHubRepo", () => {
  it("接受多种 GitHub 定位形式", () => {
    expect(parseGitHubRepo("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGitHubRepo("https://github.com/fly699/my-video-canvas")).toEqual({ owner: "fly699", repo: "my-video-canvas" });
    expect(parseGitHubRepo("https://github.com/fly699/my-video-canvas.git")).toEqual({ owner: "fly699", repo: "my-video-canvas" });
    expect(parseGitHubRepo("git@github.com:a/b.git")).toEqual({ owner: "a", repo: "b" });
    expect(parseGitHubRepo("https://github.com/a/b/tree/main")).toEqual({ owner: "a", repo: "b" });
  });
  it("拒绝非 github.com / 非法字符 / 路径穿越", () => {
    expect(parseGitHubRepo("https://gitlab.com/a/b")).toBeNull();
    expect(parseGitHubRepo("https://evil.com/github.com/a/b")).toBeNull();
    expect(parseGitHubRepo("a/b;rm -rf")).toBeNull();
    expect(parseGitHubRepo("../../etc/passwd")).toBeNull();
    expect(parseGitHubRepo("")).toBeNull();
    expect(parseGitHubRepo("onlyowner")).toBeNull();
  });
});

describe("buildAuthedRemote / publicRemote", () => {
  it("带 token 的远程地址用 x-access-token 用户名 + 编码 token", () => {
    expect(buildAuthedRemote({ owner: "a", repo: "b" }, "tok en/x")).toBe("https://x-access-token:tok%20en%2Fx@github.com/a/b.git");
  });
  it("公开地址不含 token", () => {
    expect(publicRemote({ owner: "a", repo: "b" })).toBe("https://github.com/a/b");
  });
});

describe("isValidBranchName", () => {
  it("合法分支", () => {
    expect(isValidBranchName("main")).toBe(true);
    expect(isValidBranchName("feature/x-1")).toBe(true);
  });
  it("拒绝危险/非法分支", () => {
    expect(isValidBranchName("a b")).toBe(false);
    expect(isValidBranchName("a;rm")).toBe(false);
    expect(isValidBranchName("a..b")).toBe(false);
    expect(isValidBranchName("/x")).toBe(false);
    expect(isValidBranchName("x.lock")).toBe(false);
    expect(isValidBranchName("")).toBe(false);
  });
});

describe("redactToken", () => {
  it("抹掉明文与编码后的 token", () => {
    expect(redactToken("clone https://x-access-token:secret123@github.com/a/b.git", "secret123"))
      .toBe("clone https://x-access-token:***@github.com/a/b.git");
    expect(redactToken("url=sec%2Fret", "sec/ret")).toBe("url=***");
  });
  it("token 为空 → 原样", () => {
    expect(redactToken("hello", undefined)).toBe("hello");
  });
});
