// #152 音乐工具第一批（人声分离/翻唱/续写/写歌词）提交体守卫。
// 参数与响应形态严格按 Poyo 官方 api-manual/music-series schema（MCP 取回）。
// fetch 双次调用：第 1 次 submit（断言 body），第 2 次 detail（返回 finished 结果）。
import { describe, expect, it, vi, beforeEach } from "vitest";

// 关闭音频转存：persistAudioUrl 直接返回上游 URL，避免对每条 stem 再 fetch（测试无 S3）。
vi.mock("./_core/storageConfig", () => ({ isAudioPersistenceEnabled: async () => false }));

process.env.POYO_API_KEY = "test-key";

let submitBody: { model: string; input: Record<string, unknown> } | null = null;

// mock：submit 捕获 body；detail 返回 finished + 指定 file。
function stubFetch(detailFile: Record<string, unknown>) {
  submitBody = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.includes("/api/generate/submit")) {
      submitBody = JSON.parse(init!.body!);
      return { ok: true, json: async () => ({ code: 200, data: { task_id: "t_music" } }) } as unknown as Response;
    }
    // detail/music
    return { ok: true, json: async () => ({ code: 200, data: { status: "finished", files: [detailFile] } }) } as unknown as Response;
  }));
}

beforeEach(() => { submitBody = null; });

const AUDIO = "https://cdn.example.com/song.mp3";

async function run(opts: Record<string, unknown>) {
  const { submitAndPollPoyoMusicTool } = await import("./_core/poyoAudio");
  return submitAndPollPoyoMusicTool(opts as Parameters<typeof submitAndPollPoyoMusicTool>[0]);
}

describe("#152 poyo 音乐工具提交体", () => {
  it("人声分离：audio_url + model_name + output_type；解析 vocal_removal JSON 多轨", async () => {
    stubFetch({ vocal_removal: JSON.stringify({ vocals: "https://x/v.mp3", drums: "https://x/d.mp3", other: "" }) });
    const r = await run({ tool: "sep_vocals", audioUrl: AUDIO, sepModel: "enhanced", sepOutput: "vocals" });
    expect(submitBody!.model).toBe("upload-and-separate-vocals");
    expect(submitBody!.input.audio_url).toBe(AUDIO);
    expect(submitBody!.input.model_name).toBe("enhanced");
    expect(submitBody!.input.output_type).toBe("vocals");
    expect(r.kind).toBe("stems");
    // 空串 URL 的 other 轨被丢弃；只保留有效轨。
    expect(Object.keys(r.stems!).sort()).toEqual(["drums", "vocals"]);
  });

  it("翻唱：upload_url + 非自定义 custom_mode + mv + prompt(≤500)；产出音频", async () => {
    stubFetch({ audio_url: "https://x/cover.mp3", duration: 120 });
    const r = await run({ tool: "cover", audioUrl: AUDIO, prompt: "lo-fi 爵士", mv: "V4_5", instrumental: true });
    expect(submitBody!.model).toBe("upload-and-cover-audio");
    expect(submitBody!.input.upload_url).toBe(AUDIO);
    expect(submitBody!.input.custom_mode).toBe(false);
    expect(submitBody!.input.mv).toBe("V4_5");
    expect(submitBody!.input.instrumental).toBe(true);
    expect(submitBody!.input.prompt).toBe("lo-fi 爵士");
    expect(r.kind).toBe("audio");
    expect(r.url).toBe("https://x/cover.mp3");
    expect(r.duration).toBe(120);
  });

  it("翻唱缺风格描述 → 报错（不提交）", async () => {
    stubFetch({ audio_url: "https://x/cover.mp3" });
    await expect(run({ tool: "cover", audioUrl: AUDIO, prompt: "" })).rejects.toThrow(/翻唱风格/);
  });

  it("续写：upload_url + default_param_flag=false + continue_at + mv 兜底 V5", async () => {
    stubFetch({ audio_url: "https://x/ext.mp3" });
    const r = await run({ tool: "extend", audioUrl: AUDIO, continueAt: 30, mv: "bogus" });
    expect(submitBody!.model).toBe("upload-and-extend-audio");
    expect(submitBody!.input.default_param_flag).toBe(false);
    expect(submitBody!.input.continue_at).toBe(30);
    expect(submitBody!.input.mv).toBe("V5"); // 非法 mv 钳到 V5
    expect(r.kind).toBe("audio");
  });

  it("写歌词：仅 prompt，产出文本；无源音频不报错", async () => {
    stubFetch({ text: "第一段歌词\n第二段", title: "夏夜" });
    const r = await run({ tool: "lyrics", prompt: "夏夜海边的告别" });
    expect(submitBody!.model).toBe("generate-lyrics");
    expect(submitBody!.input.prompt).toBe("夏夜海边的告别");
    expect(submitBody!.input.audio_url).toBeUndefined();
    expect(r.kind).toBe("lyrics");
    expect(r.lyrics).toContain("歌词");
    expect(r.title).toBe("夏夜");
  });

  it("分离/翻唱/续写缺源音频 → 报错（不提交）", async () => {
    stubFetch({ audio_url: "x" });
    await expect(run({ tool: "sep_vocals", audioUrl: "" })).rejects.toThrow(/源音频/);
    await expect(run({ tool: "extend", audioUrl: "  " })).rejects.toThrow(/源音频/);
  });

  it("wire 映射表锁定（禁止改名）", async () => {
    const { POYO_MUSIC_TOOL_WIRE } = await import("./_core/poyoAudio");
    expect(POYO_MUSIC_TOOL_WIRE).toEqual({
      sep_vocals: "upload-and-separate-vocals",
      cover: "upload-and-cover-audio",
      extend: "upload-and-extend-audio",
      lyrics: "generate-lyrics",
      extend_native: "extend-music", // #153 原生续写（audio_id 路径）
    });
  });
});

describe("#152 音乐工具计价", () => {
  it("estimateAudioToolCost：分离15 / 翻唱20 / 续写20 / 写歌词1 cr", async () => {
    const { estimateAudioToolCost } = await import("../client/src/lib/costEstimate");
    expect(estimateAudioToolCost("sep_vocals")).toEqual({ credits: 15, unit: "cr", approx: false });
    expect(estimateAudioToolCost("cover")).toEqual({ credits: 20, unit: "cr", approx: false });
    expect(estimateAudioToolCost("extend")).toEqual({ credits: 20, unit: "cr", approx: false });
    expect(estimateAudioToolCost("lyrics")).toEqual({ credits: 1, unit: "cr", approx: false });
    expect(estimateAudioToolCost("unknown")).toBeNull();
  });

  it("画布预算：tools 类别按工具计入 cr 总额", async () => {
    const { estimateCanvasBudget } = await import("../client/src/lib/costEstimate");
    const b = estimateCanvasBudget([
      { data: { nodeType: "audio", payload: { audioCategory: "tools", toolModel: "cover" } } },
      { data: { nodeType: "audio", payload: { audioCategory: "tools", toolModel: "lyrics" } } },
    ]);
    expect(b.cr).toBe(21); // 20 + 1
    expect(b.runnableCount).toBe(2);
    expect(b.lines.some((l) => l.label.includes("翻唱"))).toBe(true);
  });
});
