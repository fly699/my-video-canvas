// 工程智能体编排器（B 阶段）：目标分解解析 + 逐子任务搭建（失败重试）+ 汇总。
import { describe, it, expect, beforeEach } from "vitest";
import { parseSubtasks, runOrchestration } from "./_core/superAgent/orchestrator";
import type { ComfyAgentTools, AgentLLM } from "./_core/superAgent/comfyAgent";
import { clearWorkflowExperiences } from "./_core/comfyExperience";

const RES = { checkpoints: ["sd_xl.safetensors"], loras: [], vaes: [], samplers: ["euler"], schedulers: ["normal"], nodeClasses: ["KSampler", "SaveImage"] };

/** 每轮直接 finish 一个可用图的假 LLM（让每个子任务一轮成功）。 */
function alwaysFinishLLM(): AgentLLM {
  return { async complete() { return '{"action":"finish","workflowJson":"{\\"3\\":{\\"class_type\\":\\"KSampler\\",\\"inputs\\":{}}}"}'; } };
}
function fakeTools(over: Partial<ComfyAgentTools> = {}): ComfyAgentTools {
  return {
    listResources: async () => RES,
    validate: async () => ({ ok: true, errors: [] }),
    execute: async () => ({ ok: true, images: ["http://x/o.png"], outputType: "image" }),
    analyze: async () => ({ paramBindings: [], outputNodeIds: ["3"], outputType: "image" }),
    ...over,
  };
}

describe("orchestrator.parseSubtasks", () => {
  it("解析 {subtasks:[...]}，title 缺省取 task 前缀", () => {
    const r = parseSubtasks('{"subtasks":[{"title":"出图","task":"文生图关键帧"},{"task":"图生视频"}]}', "目标", 6);
    expect(r.length).toBe(2);
    expect(r[0]).toEqual({ title: "出图", task: "文生图关键帧" });
    expect(r[1].title).toBe("图生视频"); // 无 title → 取 task 前缀
  });
  it("剥 ```json``` 围栏", () => {
    const r = parseSubtasks('```json\n{"subtasks":[{"task":"A"}]}\n```', "目标", 6);
    expect(r.length).toBe(1);
  });
  it("解析失败 → 兜底把整个目标当单个子任务", () => {
    const r = parseSubtasks("这不是 JSON", "做个赛博朋克短片", 6);
    expect(r).toEqual([{ title: "做个赛博朋克短片", task: "做个赛博朋克短片" }]);
  });
  it("超过 max 截断", () => {
    const many = { subtasks: Array.from({ length: 20 }, (_, i) => ({ task: `t${i}` })) };
    expect(parseSubtasks(JSON.stringify(many), "g", 5).length).toBe(5);
  });
});

describe("orchestrator.runOrchestration", () => {
  beforeEach(async () => { await clearWorkflowExperiences(); });

  it("按注入的分解逐个搭建，全部成功汇总", async () => {
    const events: string[] = [];
    const r = await runOrchestration({
      goal: "做一个赛博朋克短片",
      baseUrl: "http://comfy:8188",
      tools: fakeTools(),
      llm: alwaysFinishLLM(),
      useMemory: false,
      emit: (e) => events.push(e.message),
      decompose: async () => [
        { title: "出图", task: "文生图关键帧" },
        { title: "图生视频", task: "把关键帧转视频" },
      ],
    });
    expect(r.subtasks.length).toBe(2);
    expect(r.successCount).toBe(2);
    expect(r.subtasks.every((s) => s.status === "success")).toBe(true);
    expect(events.some((m) => m.includes("编排完成"))).toBe(true);
  });

  it("子任务首次失败 → 带教训重试一次", async () => {
    let calls = 0;
    // 前若干轮 execute 失败，触发一次重试后成功。
    const tools = fakeTools({
      execute: async () => { calls++; return calls <= 1 ? { ok: false, error: "缺少节点：FooNode 未安装" } : { ok: true, images: ["http://x/o.png"], outputType: "image" }; },
    });
    // LLM：先 finish（触发 execute 失败）→ 再 finish（第二次 execute 成功）。
    const llm: AgentLLM = { async complete() { return '{"action":"finish","workflowJson":"{\\"3\\":{\\"class_type\\":\\"KSampler\\",\\"inputs\\":{}}}"}'; } };
    // maxIterations:1 → 首次 runComfyAgent 只能试一轮，execute 失败即耗尽（失败）；编排器再整体重试一次 → 成功。
    const r = await runOrchestration({
      goal: "g", baseUrl: "http://c", tools, llm, useMemory: false, maxIterations: 1,
      decompose: async () => [{ title: "出图", task: "文生图" }],
    });
    expect(r.subtasks[0].retried).toBe(true);
    expect(r.subtasks[0].status).toBe("success");
  });

  it("取消信号置位后不再开始新子任务", async () => {
    const signal = { aborted: true };
    const r = await runOrchestration({
      goal: "g", baseUrl: "http://c", tools: fakeTools(), llm: alwaysFinishLLM(), signal, useMemory: false,
      decompose: async () => [{ title: "a", task: "a" }, { title: "b", task: "b" }],
    });
    expect(r.subtasks.length).toBe(0);
  });
});
