import { describe, it, expect } from "vitest";
import {
  runComfyAgent,
  extractAction,
  buildSystemPrompt,
  nodeClassesMentioned,
  type ComfyAgentTools,
  type AgentLLM,
  type ComfyResourceList,
} from "./_core/superAgent/comfyAgent";

const RES: ComfyResourceList = {
  checkpoints: ["sd_xl_base_1.0.safetensors"],
  loras: ["detail.safetensors"],
  vaes: ["vae.safetensors"],
  samplers: ["euler", "dpmpp_2m"],
  schedulers: ["normal", "karras"],
  nodeClasses: ["KSampler", "CheckpointLoaderSimple", "SaveImage", "CLIPTextEncode"],
};

/** 脚本化假 LLM：按预设动作序列逐轮返回（忽略输入消息，除非提供 inspector）。 */
function scriptedLLM(script: string[], onCall?: (msgs: { role: string; content: string }[], i: number) => void): AgentLLM {
  let i = 0;
  return {
    async complete(messages) {
      onCall?.(messages, i);
      const out = script[Math.min(i, script.length - 1)];
      i++;
      return out;
    },
  };
}

/** 可编程假工具。 */
function fakeTools(over: Partial<ComfyAgentTools> = {}): ComfyAgentTools {
  return {
    listResources: async () => RES,
    validate: async () => ({ ok: true, errors: [] }),
    execute: async () => ({ ok: true, images: ["http://x/out.png"], outputType: "image" }),
    analyze: async () => ({ paramBindings: [{ nodeId: "3", fieldPath: "inputs.text" }], outputNodeIds: ["9"], outputType: "image" }),
    ...over,
  };
}

const WF = (tag: string) => JSON.stringify({ "3": { class_type: "KSampler", inputs: { seed: 1, _tag: tag } } });

describe("extractAction", () => {
  it("解析裸 JSON 动作", () => {
    expect(extractAction('{"action":"author","workflowJson":"{}"}')?.action).toBe("author");
  });
  it("解析 ```json 围栏包裹的动作", () => {
    const a = extractAction("好的：\n```json\n{\"action\":\"execute\",\"reasoning\":\"跑一下\"}\n```\n");
    expect(a?.action).toBe("execute");
    expect(a?.reasoning).toBe("跑一下");
  });
  it("解析夹在散文中的 JSON", () => {
    expect(extractAction('我先产出图。{"action":"finish","workflowJson":"{}"} 完成。')?.action).toBe("finish");
  });
  it("非法/无 action 返回 null", () => {
    expect(extractAction("完全没有 json")).toBeNull();
    expect(extractAction('{"foo":1}')).toBeNull();
    expect(extractAction('{"action":"delete"}')).toBeNull(); // 未知动作
  });
});

describe("nodeClassesMentioned", () => {
  const WF = JSON.stringify({ "3": { class_type: "KSampler" }, "13": { class_type: "VAEDecode" }, "4": { class_type: "CheckpointLoaderSimple" } });
  it("报错点名 class_type → 返回该类", () => {
    expect(nodeClassesMentioned("Error in KSampler: bad sampler", WF)).toEqual(["KSampler"]);
  });
  it("报错点名节点 id（数字边界，3 不命中 13）", () => {
    expect(nodeClassesMentioned("prompt_outputs failed at node 3:", WF)).toEqual(["KSampler"]);
    expect(nodeClassesMentioned("failed at node 13", WF)).toEqual(["VAEDecode"]); // 不把 3 也带出来
  });
  it("无点名 / 非法 JSON / 空 → 空数组", () => {
    expect(nodeClassesMentioned("some generic error", WF)).toEqual([]);
    expect(nodeClassesMentioned("KSampler", "not json")).toEqual([]);
    expect(nodeClassesMentioned("", WF)).toEqual([]);
  });
});

describe("buildSystemPrompt", () => {
  it("含任务与资源清单，且不泄露不存在的资源", () => {
    const p = buildSystemPrompt("做一个出图工作流", RES);
    expect(p).toContain("做一个出图工作流");
    expect(p).toContain("sd_xl_base_1.0.safetensors");
    expect(p).toContain("euler");
  });
  it("有参考范例时把范例并入提示（label + workflowJson）", () => {
    const p = buildSystemPrompt("出图", RES, false, false, false, [{ label: "SDXL 高清出图", workflowJson: '{"3":{"class_type":"KSampler"}}' }]);
    expect(p).toContain("参考范例");
    expect(p).toContain("SDXL 高清出图");
    expect(p).toContain("KSampler");
    // 无范例则不出现该段
    expect(buildSystemPrompt("出图", RES)).not.toContain("参考范例");
  });
  it("canDescribe 时引导先查 schema 再写；未开启则不提", () => {
    const on = buildSystemPrompt("出图", RES, false, false, true);
    expect(on).toContain("describe_nodes");
    expect(on).toContain("严禁凭记忆猜字段名");
    const off = buildSystemPrompt("出图", RES, false, false, false);
    expect(off).not.toContain("describe_nodes 查");
  });
});

describe("runComfyAgent — 闭环编排", () => {
  it("author(校验过) → execute 成功：返回 success + 产物 + 分析", async () => {
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools(),
      llm: scriptedLLM([
        `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
        `{"action":"execute"}`,
      ]),
    });
    expect(r.status).toBe("success");
    expect(r.workflowJson).toContain("v1");
    expect(r.images).toEqual(["http://x/out.png"]);
    expect(r.analysis?.outputNodeIds).toEqual(["9"]);
    expect(r.iterations).toBe(2);
  });

  it("校验失败 → 把错误喂回 → 第二版 author 通过 → execute 成功", async () => {
    let validateCalls = 0;
    const seenPrompts: string[] = [];
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools({
        validate: async (wf) => {
          validateCalls++;
          return wf.includes("v2") ? { ok: true, errors: [] } : { ok: false, errors: ["KSampler.sampler_name 非法：'foo'"] };
        },
      }),
      llm: scriptedLLM(
        [
          `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
          `{"action":"author","workflowJson":${JSON.stringify(WF("v2"))}}`,
          `{"action":"execute"}`,
        ],
        (msgs) => { seenPrompts.push(msgs[msgs.length - 1].content); },
      ),
    });
    expect(r.status).toBe("success");
    expect(validateCalls).toBe(2);
    // 第二轮 author 前，上一条 user 消息应包含被喂回的校验错误
    expect(seenPrompts.some((p) => p.includes("sampler_name 非法"))).toBe(true);
  });

  it("execute 报错 → 喂回错误 → 修正后再 execute 成功", async () => {
    let execCalls = 0;
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools({
        execute: async (wf) => {
          execCalls++;
          return wf.includes("fixed")
            ? { ok: true, images: ["ok.png"], outputType: "image" }
            : { ok: false, error: "Error: VAEDecode 缺少 vae 输入" };
        },
      }),
      llm: scriptedLLM([
        `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
        `{"action":"execute"}`,
        `{"action":"author","workflowJson":${JSON.stringify(WF("fixed"))}}`,
        `{"action":"execute"}`,
      ]),
    });
    expect(r.status).toBe("success");
    expect(execCalls).toBe(2);
    expect(r.workflowJson).toContain("fixed");
  });

  it("finish 前自动校验：未过则拒绝并继续", async () => {
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools({
        validate: async (wf) => (wf.includes("good") ? { ok: true, errors: [] } : { ok: false, errors: ["坏图"] }),
      }),
      llm: scriptedLLM([
        `{"action":"finish","workflowJson":${JSON.stringify(WF("bad"))}}`, // 校验不过 → 被拒
        `{"action":"finish","workflowJson":${JSON.stringify(WF("good"))}}`, // 过 → execute
      ]),
    });
    expect(r.status).toBe("success");
    expect(r.workflowJson).toContain("good");
  });

  it("系统提示按 canInstall 切换安装说明", () => {
    expect(buildSystemPrompt("出图", RES, false, true)).toContain("install_model");
    expect(buildSystemPrompt("出图", RES, false, false)).toContain("未开放下载安装");
  });

  it("describe_nodes：有工具 → 调用、把 schema 喂回、再 author/execute 成功", async () => {
    let queried: string[] | null = null;
    const seen: string[] = [];
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools({ describeNodes: async (names) => { queried = names; return "【KSampler】 输出: LATENT\n  必填: seed: INT=0"; } }),
      llm: scriptedLLM(
        [`{"action":"describe_nodes","nodeClasses":["KSampler","CLIPTextEncode"]}`,
         `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`, `{"action":"execute"}`],
        (msgs) => seen.push(msgs[msgs.length - 1].content),
      ),
    });
    expect(r.status).toBe("success");
    expect(queried).toEqual(["KSampler", "CLIPTextEncode"]);
    expect(seen.some((c) => c.includes("严格按此写字段名") && c.includes("KSampler"))).toBe(true);
    expect(r.log.some((e) => e.type === "tool_result" && (e.data as { tool: string }).tool === "describe_nodes")).toBe(true);
  });

  it("校验失败自动补涉事节点 schema：无需 LLM 主动 describe，错误+规格一起喂回并修正成功", async () => {
    let describeCalls = 0;
    let firstValidate = true;
    const seen: string[] = [];
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools({
        describeNodes: async (names) => { describeCalls++; return `【${names[0]}】 必填: seed: INT=0`; },
        validate: async () => {
          if (firstValidate) { firstValidate = false; return { ok: false, errors: ["必填输入缺失：节点 3(KSampler).seed"], errorNodeClasses: ["KSampler"] }; }
          return { ok: true, errors: [] };
        },
      }),
      llm: scriptedLLM(
        [`{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
         `{"action":"author","workflowJson":${JSON.stringify(WF("v2"))}}`, `{"action":"execute"}`],
        (msgs) => seen.push(msgs[msgs.length - 1].content),
      ),
    });
    expect(r.status).toBe("success");
    expect(describeCalls).toBe(1); // 校验失败时自动查了一次
    expect(seen.some((c) => c.includes("涉事节点的精确输入规格") && c.includes("KSampler"))).toBe(true);
    expect(r.log.some((e) => e.type === "tool_result" && (e.data as { auto?: boolean }).auto === true)).toBe(true);
  });

  it("校验失败但无 describeNodes 工具：只喂错误、不崩溃", async () => {
    let firstValidate = true;
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools({
        validate: async () => {
          if (firstValidate) { firstValidate = false; return { ok: false, errors: ["某错误"], errorNodeClasses: ["KSampler"] }; }
          return { ok: true, errors: [] };
        },
      }),
      llm: scriptedLLM([
        `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
        `{"action":"author","workflowJson":${JSON.stringify(WF("v2"))}}`, `{"action":"execute"}`]),
    });
    expect(r.status).toBe("success");
  });

  it("execute 真机失败：报错点名的节点自动补 schema，再修正后成功", async () => {
    let describedWith: string[] | null = null;
    let firstExec = true;
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools({
        describeNodes: async (names) => { describedWith = names; return `【${names[0]}】 必填: seed: INT=0`; },
        execute: async () => {
          if (firstExec) { firstExec = false; return { ok: false, error: "Error while executing KSampler: value out of range" }; }
          return { ok: true, images: ["http://x/o.png"], outputType: "image" };
        },
      }),
      llm: scriptedLLM([
        `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
        `{"action":"execute"}`,
        `{"action":"author","workflowJson":${JSON.stringify(WF("v2"))}}`,
        `{"action":"execute"}`,
      ]),
    });
    expect(r.status).toBe("success");
    expect(describedWith).toEqual(["KSampler"]); // execute 报错点名 KSampler → 自动查其 schema
  });

  it("describe_nodes：无工具 → 提示直接 author、不崩溃", async () => {
    const seen: string[] = [];
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools(), // 无 describeNodes
      llm: scriptedLLM(
        [`{"action":"describe_nodes","nodeClasses":["KSampler"]}`,
         `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`, `{"action":"execute"}`],
        (msgs) => seen.push(msgs[msgs.length - 1].content),
      ),
    });
    expect(r.status).toBe("success");
    expect(seen.some((c) => c.includes("不支持 describe_nodes"))).toBe(true);
  });

  it("install_model：有安装工具 → 调用、把结果喂回、继续；缺模型装完后 execute 成功", async () => {
    let installed: { url: string; dir: string; filename: string } | null = null;
    const r = await runComfyAgent({
      task: "用某缺失的 checkpoint 出图",
      tools: fakeTools({
        installModel: async (spec) => { installed = spec; return { ok: true, message: "downloaded 2.1GB" }; },
      }),
      llm: scriptedLLM([
        `{"action":"install_model","modelUrl":"https://civitai.com/x.safetensors","modelDir":"checkpoints","modelFilename":"x.safetensors"}`,
        `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
        `{"action":"execute"}`,
      ]),
    });
    expect(r.status).toBe("success");
    expect(installed).toEqual({ url: "https://civitai.com/x.safetensors", dir: "checkpoints", filename: "x.safetensors" });
    expect(r.log.some((e) => e.type === "tool_result" && (e.data as { tool: string }).tool === "install_model")).toBe(true);
  });

  it("install_model：无安装工具 → 提示未开放、不崩溃", async () => {
    const seen: string[] = [];
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools(), // 无 installModel
      llm: scriptedLLM(
        [`{"action":"install_model","modelUrl":"https://x/x.safetensors","modelDir":"checkpoints","modelFilename":"x.safetensors"}`,
         `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`, `{"action":"execute"}`],
        (msgs) => seen.push(msgs[msgs.length - 1].content),
      ),
    });
    expect(r.status).toBe("success");
    expect(seen.some((c) => c.includes("未开放下载安装"))).toBe(true);
  });

  it("install_node：有工具 → 调用并继续", async () => {
    let git: string | null = null;
    const r = await runComfyAgent({
      task: "用某自定义节点",
      tools: fakeTools({ installNode: async (u) => { git = u; return { ok: true, message: "cloned" }; } }),
      llm: scriptedLLM([
        `{"action":"install_node","nodeGitUrl":"https://github.com/a/b"}`,
        `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
        `{"action":"execute"}`,
      ]),
    });
    expect(r.status).toBe("success");
    expect(git).toBe("https://github.com/a/b");
  });

  it("give_up → failed", async () => {
    const r = await runComfyAgent({
      task: "不可能的任务",
      tools: fakeTools(),
      llm: scriptedLLM([`{"action":"give_up","reasoning":"服务器没有所需模型"}`]),
    });
    expect(r.status).toBe("failed");
    expect(r.log.some((e) => e.type === "done" && e.message.includes("放弃"))).toBe(true);
  });

  it("达到最大轮数未调通 → exhausted，保留最后一版", async () => {
    const r = await runComfyAgent({
      task: "出图",
      maxIterations: 3,
      tools: fakeTools({ validate: async () => ({ ok: false, errors: ["永远失败"] }) }),
      llm: scriptedLLM([`{"action":"author","workflowJson":${JSON.stringify(WF("x"))}}`]), // 每轮都 author，永远校验失败
    });
    expect(r.status).toBe("exhausted");
    expect(r.iterations).toBe(3);
    expect(r.workflowJson).toContain("x");
  });

  it("连续对话：seedWorkflowJson + history 注入初始消息，在上一版基础上改", async () => {
    const seenMsgs: { role: string; content: string }[][] = [];
    const r = await runComfyAgent({
      task: "把分辨率改成 1024x1024",
      tools: fakeTools(),
      llm: scriptedLLM(
        [`{"action":"author","workflowJson":${JSON.stringify(WF("v2"))}}`, `{"action":"execute"}`],
        (msgs) => { seenMsgs.push(msgs.map((m) => ({ role: m.role, content: m.content }))); },
      ),
      seedWorkflowJson: WF("v1"),
      history: [{ role: "user", content: "先做个 SDXL 出图" }, { role: "assistant", content: "已调通 v1" }],
    });
    expect(r.status).toBe("success");
    const first = seenMsgs[0];
    // 系统提示应进入「多轮/在已有工作流上修改」模式
    expect(first[0].content).toContain("多轮对话");
    // 历史被并入
    expect(first.some((m) => m.content.includes("先做个 SDXL 出图"))).toBe(true);
    // 种子工作流被作为「当前工作流」喂入
    expect(first.some((m) => m.content.includes("v1") && m.content.includes("在其基础上"))).toBe(true);
  });

  it("signal 置位 → 下一轮开头终止，返回 aborted", async () => {
    const signal = { aborted: false };
    let calls = 0;
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools({ validate: async () => ({ ok: false, errors: ["再来一轮"] }) }),
      llm: {
        async complete() { calls++; signal.aborted = true; return `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`; },
      },
      signal,
    });
    expect(r.status).toBe("aborted");
    expect(calls).toBe(1); // 第二轮开头即终止
    expect(r.log.some((e) => e.type === "done" && e.message.includes("取消"))).toBe(true);
  });

  it("LLM 返回非法 JSON → 提示重试、不崩溃", async () => {
    let calls = 0;
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools(),
      llm: {
        async complete() {
          calls++;
          if (calls === 1) return "我在思考……（没有 JSON）";
          if (calls === 2) return `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`;
          return `{"action":"execute"}`;
        },
      },
    });
    expect(r.status).toBe("success");
    expect(r.log.some((e) => e.type === "error")).toBe(true);
  });

  it("emit 回调收到与 log 一致的事件流", async () => {
    const emitted: string[] = [];
    const r = await runComfyAgent({
      task: "出图",
      tools: fakeTools(),
      emit: (e) => emitted.push(e.type),
      llm: scriptedLLM([
        `{"action":"author","workflowJson":${JSON.stringify(WF("v1"))}}`,
        `{"action":"execute"}`,
      ]),
    });
    expect(r.status).toBe("success");
    expect(emitted[0]).toBe("resources");
    expect(emitted).toContain("action");
    expect(emitted).toContain("tool_result");
    expect(emitted[emitted.length - 1]).toBe("done");
    expect(emitted.length).toBe(r.log.length);
  });
});
