import { describe, it, expect } from "vitest";
import { isHiggsfieldUrl, extractHiggsfieldUrls } from "./routers/agent";

// Higgsfield MCP 产物落地：仅按主机名含 "higgsfield" 判定；其他域名的 URL 一律不动。

describe("isHiggsfieldUrl / extractHiggsfieldUrls", () => {
  it("识别 higgsfield 各子域，其余域名不受影响", () => {
    expect(isHiggsfieldUrl("https://cdn.higgsfield.ai/x/y.png")).toBe(true);
    expect(isHiggsfieldUrl("https://storage.higgsfield.com/v.mp4?sig=1")).toBe(true);
    expect(isHiggsfieldUrl("https://example.com/higgsfield.png")).toBe(false); // 路径含词不算
    expect(isHiggsfieldUrl("https://google.com/a")).toBe(false);
    expect(isHiggsfieldUrl("not-a-url")).toBe(false);
  });

  it("从混合文本抽取并去重、去尾部标点；保留其他 URL 不抽", () => {
    const text = `图在这 https://cdn.higgsfield.ai/a.png，视频 https://cdn.higgsfield.ai/b.mp4。
      参考 https://docs.example.com/keep 与重复 https://cdn.higgsfield.ai/a.png`;
    const urls = extractHiggsfieldUrls(text);
    expect(urls.sort()).toEqual(["https://cdn.higgsfield.ai/a.png", "https://cdn.higgsfield.ai/b.mp4"].sort());
  });

  it("JSON 串（operations）里的链接也能抽出", () => {
    const ops = JSON.stringify([{ op: "create", payload: { url: "https://api.higgsfield.ai/out/c.jpg" } }]);
    expect(extractHiggsfieldUrls(ops)).toEqual(["https://api.higgsfield.ai/out/c.jpg"]);
  });
});
