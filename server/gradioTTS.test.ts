import { describe, it, expect } from "vitest";
import { normalizeBase, resolveAudioUrl, describeFetchError, formatGradioError } from "./_core/gradioTTS";

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

describe("gradioTTS.describeFetchError", () => {
  const url = "http://172.16.0.177:8808";
  const mk = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code, message: `connect ${code}` } });

  it("ECONNREFUSED 提示端口未监听/绑定 127.0.0.1", () => {
    expect(() => describeFetchError(mk("ECONNREFUSED"), "连接 Gradio 服务", url)).toThrow(/连接被拒绝/);
  });
  it("ETIMEDOUT 提示网络不通/防火墙", () => {
    expect(() => describeFetchError(mk("ETIMEDOUT"), "连接 Gradio 服务", url)).toThrow(/连接超时/);
  });
  it("ENOTFOUND 提示解析失败", () => {
    expect(() => describeFetchError(mk("ENOTFOUND"), "连接 Gradio 服务", url)).toThrow(/解析失败/);
  });
  it("报错文案包含目标 URL 与底层 code", () => {
    expect(() => describeFetchError(mk("ECONNREFUSED"), "连接 Gradio 服务", url)).toThrow(/172\.16\.0\.177:8808/);
    expect(() => describeFetchError(mk("ECONNREFUSED"), "连接 Gradio 服务", url)).toThrow(/ECONNREFUSED/);
  });
});

describe("gradioTTS.formatGradioError", () => {
  it("从 JSON 提取 error 字段，并对 HF 模型加载失败附镜像提示", () => {
    const payload = JSON.stringify({
      error: "An error happened while trying to locate the file on the Hub and we cannot find the requested files in the local cache. Please check your connection and try again or make sure your Internet connection is on.",
      visible: true,
    });
    const out = formatGradioError(payload);
    expect(out).toContain("locate the file on the Hub");
    expect(out).not.toContain("visible"); // 只取 error 字段，不带原始 JSON 包裹
    expect(out).toContain("hf-mirror.com");
  });

  it("普通错误不追加 HF 提示", () => {
    const out = formatGradioError(JSON.stringify({ error: "CUDA out of memory" }));
    expect(out).toContain("CUDA out of memory");
    expect(out).not.toContain("hf-mirror.com");
  });

  it("非 JSON 文本原样保留", () => {
    const out = formatGradioError("Traceback: something broke");
    expect(out).toContain("something broke");
  });
});
