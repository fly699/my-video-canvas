import { describe, it, expect } from "vitest";
import { normalizeBase, resolveAudioUrl } from "./_core/gradioTTS";

describe("gradioTTS.normalizeBase", () => {
  it("去掉末尾斜杠并补全 http 协议", () => {
    expect(normalizeBase("172.16.0.177:8808")).toBe("http://172.16.0.177:8808");
    expect(normalizeBase("http://172.16.0.177:8808/")).toBe("http://172.16.0.177:8808");
    expect(normalizeBase("https://tts.example.com//")).toBe("https://tts.example.com");
  });
  it("空地址抛错", () => {
    expect(() => normalizeBase("   ")).toThrow();
  });
});

describe("gradioTTS.resolveAudioUrl", () => {
  const base = "http://172.16.0.177:8808";

  it("优先用 FileData.url（绝对）", () => {
    const out = resolveAudioUrl(base, "/gradio_api", [{ url: "http://172.16.0.177:8808/gradio_api/file=/tmp/a.wav", duration: 3.2 }]);
    expect(out.url).toBe("http://172.16.0.177:8808/gradio_api/file=/tmp/a.wav");
    expect(out.duration).toBe(3.2);
  });

  it("相对 url 用 base 补全", () => {
    const out = resolveAudioUrl(base, "", [{ url: "/file=/tmp/b.wav" }]);
    expect(out.url).toBe("http://172.16.0.177:8808/file=/tmp/b.wav");
  });

  it("只有 path 时按前缀拼 file= 路由", () => {
    const out = resolveAudioUrl(base, "/gradio_api", [{ path: "/tmp/c.wav" }]);
    expect(out.url).toBe("http://172.16.0.177:8808/gradio_api/file=/tmp/c.wav");
  });

  it("输出为字符串时直接当 URL", () => {
    const out = resolveAudioUrl(base, "/gradio_api", ["http://x/y.wav"]);
    expect(out.url).toBe("http://x/y.wav");
  });

  it("既无 url 又无 path 时抛错", () => {
    expect(() => resolveAudioUrl(base, "/gradio_api", [{ foo: 1 }])).toThrow();
  });
});
