// 工程智能体编排器（B 阶段）：目标分解解析 + 逐子任务搭建（失败重试）+ 汇总。
import { describe, it, expect, beforeEach } from "vitest";
import { parseSubtasks, runOrchestration, decomposeGoal } from "./_core/superAgent/orchestrator";
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

  it("多服务器：子任务在多台间负载均衡分配（都被用到）", async () => {
    const used: string[] = [];
    const makeTools = (baseUrl: string): ComfyAgentTools => ({
      listResources: async () => RES,
      validate: async () => ({ ok: true, errors: [] }),
      execute: async () => { used.push(baseUrl); return { ok: true, images: ["http://x/o.png"], outputType: "image" }; },
      analyze: async () => ({ paramBindings: [], outputNodeIds: ["3"], outputType: "image" }),
    });
    const r = await runOrchestration({
      goal: "g", baseUrl: "http://a", tools: makeTools("http://a"),
      servers: ["http://a", "http://b"], makeTools, llm: alwaysFinishLLM(), useMemory: false,
      decompose: async () => [
        { title: "1", task: "t1" }, { title: "2", task: "t2" }, { title: "3", task: "t3" }, { title: "4", task: "t4" },
      ],
    });
    expect(r.subtasks.length).toBe(4);
    expect(r.successCount).toBe(4);
    // 两台服务器都被分到过子任务（负载均衡）。
    expect(used).toContain("http://a");
    expect(used).toContain("http://b");
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

describe("orchestrator.verifyProduct（B1 批2：编排路径产物验收）", () => {
  it("验收钩子按子任务原始描述调用；未过喂回引擎修一轮后二次成功采纳", async () => {
    const verifyCalls: string[] = [];
    let verdictGiven = false;
    const r = await runOrchestration({
      goal: "g", baseUrl: "http://c", tools: fakeTools(), llm: alwaysFinishLLM(), useMemory: false,
      decompose: async () => [{ title: "出图", task: "文生图关键帧" }],
      verifyProduct: async (subtaskTask, { images }) => {
        verifyCalls.push(subtaskTask);
        expect(images.length).toBe(1);
        if (!verdictGiven) { verdictGiven = true; return { ok: false, reasons: ["画面全黑"] }; }
        return { ok: true, reasons: [] };
      },
    });
    // 引擎的单次拒绝守卫：验收只拒一次，第二次运行成功即采纳（钩子不再被调用）。
    expect(verifyCalls).toEqual(["文生图关键帧"]);
    expect(r.subtasks[0].status).toBe("success");
  });

  it("不传验收钩子时行为不变（后向兼容）", async () => {
    const r = await runOrchestration({
      goal: "g", baseUrl: "http://c", tools: fakeTools(), llm: alwaysFinishLLM(), useMemory: false,
      decompose: async () => [{ title: "a", task: "a" }],
    });
    expect(r.successCount).toBe(1);
  });
});

describe("orchestrator.decomposeGoal（B2 自动路由复用的轻量拆解）", () => {
  it("LLM 返回合法 JSON → 解析子任务清单", async () => {
    const llm: AgentLLM = { async complete() { return '{"subtasks":[{"title":"出图","task":"文生图"},{"title":"转视频","task":"图生视频"}]}'; } };
    const r = await decomposeGoal(llm, "做个短片", 6);
    expect(r.length).toBe(2);
    expect(r[0].title).toBe("出图");
  });
  it("LLM 输出不可解析 → 兜底整目标当单任务（自动路由据此回落单份构建）", async () => {
    const llm: AgentLLM = { async complete() { return "抱歉我不会 JSON"; } };
    const r = await decomposeGoal(llm, "画一张赛博朋克海报", 6);
    expect(r.length).toBe(1);
    expect(r[0].task).toBe("画一张赛博朋克海报");
  });
});
