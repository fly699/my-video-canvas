// ComfyUI 工作流经验记忆体：沉淀成功工作流、按任务相似度召回、去重、增删查清。
// dev 无 DB 时走进程内数组兜底，本测试即基于此（每例前先清空）。
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordWorkflowExperience, recallWorkflowExperiences, listWorkflowExperiences,
  searchWorkflowExperiences, deleteWorkflowExperience, clearWorkflowExperiences,
  recordWorkflowFailure, recallPitfalls,
  extractNodeClasses, extractModels, hashWorkflow,
} from "./_core/comfyExperience";
import { extractRunLessons } from "./_core/superAgent/comfyAgent";

const BASE = "http://comfy:8188";
const txt2img = JSON.stringify({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
  "3": { class_type: "KSampler", inputs: {} },
  "4": { class_type: "VAEDecode", inputs: {} },
});
const animate = JSON.stringify({
  "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
  "2": { class_type: "AnimateDiffLoader", inputs: {} },
  "3": { class_type: "VHS_VideoCombine", inputs: {} },
});

describe("comfyExperience 工作流经验记忆体", () => {
  beforeEach(async () => { await clearWorkflowExperiences(); });

  it("extractNodeClasses 抽出去重的 class_type", () => {
    expect(extractNodeClasses(txt2img).sort()).toEqual(["CLIPTextEncode", "CheckpointLoaderSimple", "KSampler", "VAEDecode"]);
    expect(extractNodeClasses("非法json")).toEqual([]);
  });

  it("hashWorkflow：键序/空白无关，内容不同则不同", () => {
    const a = hashWorkflow('{"a":1,"b":2}');
    const b = hashWorkflow('{"b":2,"a":1}');   // 仅键序不同
    const c = hashWorkflow('{"a":1,"b":3}');   // 内容不同
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("记录成功工作流并可召回相似任务；节点类自动抽取", async () => {
    const saved = await recordWorkflowExperience({ baseUrl: BASE, task: "SDXL 文生图 高清人像", workflowJson: txt2img });
    expect(saved).toBe(true);
    const rows = await listWorkflowExperiences(BASE);
    expect(rows.length).toBe(1);
    expect(rows[0].nodeClasses).toContain("KSampler");

    const hits = await recallWorkflowExperiences(BASE, "帮我做一个 sdxl 文生图", 2);
    expect(hits.length).toBe(1);
    expect(hits[0].label).toContain("文生图");
  });

  it("同服务器同图去重（hash 相同不重复沉淀）", async () => {
    expect(await recordWorkflowExperience({ baseUrl: BASE, task: "任务A", workflowJson: txt2img })).toBe(true);
    expect(await recordWorkflowExperience({ baseUrl: BASE, task: "任务B（同一张图）", workflowJson: txt2img })).toBe(false);
    expect((await listWorkflowExperiences(BASE)).length).toBe(1);
  });

  it("尾斜杠归一化：同一服务器视作一处", async () => {
    await recordWorkflowExperience({ baseUrl: "http://comfy:8188/", task: "文生图", workflowJson: txt2img });
    expect((await listWorkflowExperiences("http://comfy:8188")).length).toBe(1);
  });

  it("召回按相关度过滤：不相关任务不召回", async () => {
    await recordWorkflowExperience({ baseUrl: BASE, task: "animatediff 图生视频", workflowJson: animate });
    // 强信号拉丁词 animatediff 命中
    expect((await recallWorkflowExperiences(BASE, "用 animatediff 做动画", 2)).length).toBe(1);
    // 完全不相关
    expect((await recallWorkflowExperiences(BASE, "写一首歌", 2)).length).toBe(0);
  });

  it("检索 / 删除 / 清空", async () => {
    await recordWorkflowExperience({ baseUrl: BASE, task: "SDXL 文生图", workflowJson: txt2img });
    await recordWorkflowExperience({ baseUrl: BASE, task: "AnimateDiff 视频", workflowJson: animate });
    expect((await searchWorkflowExperiences("animatediff")).length).toBe(1); // 命中 nodeClasses
    expect((await searchWorkflowExperiences("文生图")).length).toBe(1);       // 命中 task

    const all = await listWorkflowExperiences(BASE);
    await deleteWorkflowExperience(all[0].id);
    expect((await listWorkflowExperiences(BASE)).length).toBe(1);

    await clearWorkflowExperiences();
    expect((await listWorkflowExperiences()).length).toBe(0);
  });

  it("空 workflowJson 不沉淀", async () => {
    expect(await recordWorkflowExperience({ baseUrl: BASE, task: "空", workflowJson: "  " })).toBe(false);
  });

  it("extractModels：从工作流抽出 checkpoint/lora/vae", () => {
    const wf = JSON.stringify({
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl.safetensors" } },
      "2": { class_type: "LoraLoader", inputs: { lora_name: "detail.safetensors" } },
      "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    });
    const m = extractModels(wf);
    expect(m.checkpoints).toContain("sd_xl.safetensors");
    expect(m.loras).toContain("detail.safetensors");
    expect(m.vaes).toContain("ae.safetensors");
  });

  it("失败教训沉淀 + 召回已知坑；成功范例与失败教训分离", async () => {
    // 成功范例
    await recordWorkflowExperience({ baseUrl: BASE, task: "flux 文生图", workflowJson: txt2img });
    // 失败教训
    expect(await recordWorkflowFailure({
      baseUrl: BASE, task: "flux 文生图 加 controlnet",
      status: "failed", failReasons: ["缺少节点类型（未安装）：ControlNetApplyAdvanced"],
      nodeClasses: ["ControlNetApplyAdvanced"],
    })).toBe(true);
    // 同样的坑不重复记（失败签名去重）
    expect(await recordWorkflowFailure({
      baseUrl: BASE, task: "另一个 flux controlnet 任务",
      status: "failed", failReasons: ["缺少节点类型（未安装）：ControlNetApplyAdvanced"],
    })).toBe(false);
    // 召回成功范例只含 success；召回坑只含 failure
    const succ = await recallWorkflowExperiences(BASE, "flux 文生图", 5);
    expect(succ.length).toBe(1);
    const pits = await recallPitfalls(BASE, "flux controlnet 出图", 10);
    expect(pits.some((p) => p.includes("ControlNetApplyAdvanced"))).toBe(true);
  });

  it("failReasons 为空不沉淀失败（纯噪声已过滤）", async () => {
    expect(await recordWorkflowFailure({ baseUrl: BASE, task: "x", status: "failed", failReasons: [] })).toBe(false);
  });

  it("extractRunLessons：从运行日志抽出校验/运行错误，过滤连接噪声", () => {
    const log = [
      { type: "tool_result", iteration: 1, message: "", data: { tool: "validate", ok: false, errors: ["缺少节点类型（未安装）：FooNode", "取值非法：sampler"] } },
      { type: "tool_result", iteration: 2, message: "", data: { tool: "validate", ok: true, errors: [] } },
      { type: "tool_result", iteration: 3, message: "", data: { tool: "execute", ok: false, error: "连接超时 timeout" } },
      { type: "tool_result", iteration: 4, message: "", data: { tool: "execute", ok: false, error: "CUDA out of memory" } },
    ];
    const lessons = extractRunLessons(log as never);
    expect(lessons.some((l) => l.includes("FooNode"))).toBe(true);
    expect(lessons.some((l) => l.includes("sampler"))).toBe(true);
    expect(lessons.some((l) => l.includes("CUDA out of memory"))).toBe(true);
    // 连接/超时噪声被过滤
    expect(lessons.some((l) => /timeout|超时/.test(l))).toBe(false);
  });

  it("全量记忆：meta 留存分析/样例产物/迭代/LLM，且模型自动抽取", async () => {
    await recordWorkflowExperience({
      baseUrl: BASE, task: "SDXL 文生图", workflowJson: txt2img, outputType: "image",
      meta: { images: ["/x/a.png"], iterations: 5, llmModel: "qwen", analysis: { outputType: "image" } },
    });
    const rows = await listWorkflowExperiences(BASE);
    const r = rows[0];
    expect(r.meta?.images).toEqual(["/x/a.png"]);
    expect(r.meta?.iterations).toBe(5);
    expect(r.meta?.llmModel).toBe("qwen");
    // 模型缺省时从图里自动抽取，确保「用到哪些模型」不丢
    expect(r.meta?.models?.checkpoints).toContain("sd_xl.safetensors");
  });
});
