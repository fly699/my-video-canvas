import { describe, it, expect } from "vitest";
import { normalizeBase, resolveAudioUrl, describeFetchError, formatGradioError, buildGradioDataFromSchema, type GradioParamInfo } from "./_core/gradioTTS";

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

  it("参数数不匹配（VoxCPM2 needed 10 got 9）附自动适配提示", () => {
    const out = formatGradioError(JSON.stringify({ error: "An event handler (_generate) didn't receive enough input values (needed: 10, got: 9)." }));
    expect(out).toContain("无法自动适配");
  });
});

// ── #212 VoxCPM2 兼容：按 /info 参数表自适应组装入参 ─────────────────────────
describe("gradioTTS.buildGradioDataFromSchema（#212）", () => {
  const P = (parameter_name: string, label: string, component: string, def: unknown, pyType: string): GradioParamInfo =>
    ({ parameter_name, label, component, parameter_has_default: def !== undefined, parameter_default: def, python_type: { type: pyType } });
  const VALS = {
    text: "目标文本", controlInstruction: "温柔女声", refData: { path: "/x.wav" } as unknown,
    usePromptText: true, promptTextValue: "参考文本", cfgValue: 2.5,
    doNormalize: true, denoise: false, ditSteps: 16,
  };
  // VoxCPM2 形态：新增 streaming Checkbox 插在 cfg 之后的中段（最刁钻位置）。
  const V2: GradioParamInfo[] = [
    P("text", "Target Text", "Textbox", "", "str"),
    P("instruct", "控制指令(可选)", "Textbox", "", "str"),
    P("prompt_wav", "Prompt Speech", "Audio", null, "filepath"),
    P("use_prompt_text", "Use Prompt Text", "Checkbox", false, "bool"),
    P("prompt_text", "Prompt Text", "Textbox", "", "str"),
    P("cfg_value", "CFG Value", "Slider", 2, "float"),
    P("streaming", "Streaming Output", "Checkbox", false, "bool"),
    P("do_normalize", "Normalize Text", "Checkbox", false, "bool"),
    P("denoise", "Denoise Prompt", "Checkbox", false, "bool"),
    P("inference_timesteps", "Inference Timesteps", "Slider", 10, "int"),
  ];

  it("10 参 VoxCPM2：各值归位，中段未知新参取声明默认", () => {
    expect(buildGradioDataFromSchema(V2, VALS)).toEqual(
      ["目标文本", "温柔女声", { path: "/x.wav" }, true, "参考文本", 2.5, false, true, false, 16]);
  });

  it("经典 9 参 schema：产物与旧固定顺序完全一致", () => {
    const v1 = V2.filter((p) => p.parameter_name !== "streaming");
    expect(buildGradioDataFromSchema(v1, VALS)).toEqual(
      ["目标文本", "温柔女声", { path: "/x.wav" }, true, "参考文本", 2.5, true, false, 16]);
  });

  it("未知数值参数取默认；目标文本无落点时返回 null（调用方回退旧顺序）", () => {
    const withNum = [...V2, P("speed", "Speed", "Slider", 1.0, "float")];
    const d = buildGradioDataFromSchema(withNum, VALS)!;
    expect(d[d.length - 1]).toBe(1.0);
    const noText: GradioParamInfo[] = [P("prompt_wav", "Prompt Speech", "Audio", null, "filepath"), P("cfg", "CFG", "Slider", 2, "float")];
    expect(buildGradioDataFromSchema(noText, VALS)).toBeNull();
  });

  it("#215 指定 seed：seed 槽取用户值，Random Seed 复选框置 false", () => {
    const withSeed = [...V2, P("seed", "Seed", "Number", 0, "int"), P("randomize", "Random Seed", "Checkbox", true, "bool")];
    const d = buildGradioDataFromSchema(withSeed, { ...VALS, seed: 123 })!;
    expect(d[d.length - 2]).toBe(123);
    expect(d[d.length - 1]).toBe(false);
  });

  it("#215 未指定 seed：seed 槽取声明默认，Random Seed 保持默认（true）", () => {
    const withSeed = [...V2, P("seed", "Seed", "Number", 0, "int"), P("randomize", "Random Seed", "Checkbox", true, "bool")];
    const d = buildGradioDataFromSchema(withSeed, VALS)!;
    expect(d[d.length - 2]).toBe(0);
    expect(d[d.length - 1]).toBe(true);
  });
});
