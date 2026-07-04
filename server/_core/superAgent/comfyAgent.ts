// 超级智能体 · Phase 1 —— ComfyUI 工作流「自动编写 → 校验 → 运行 → 读错 → 修正」闭环引擎。
//
// 设计要点：
// - 纯逻辑、依赖注入。LLM 与 ComfyUI 能力都以接口注入（AgentLLM / ComfyAgentTools），
//   引擎本身不 import 任何网络/服务端模块，因此可在离线单测里用假实现完整跑通闭环。
// - 不涉及任何 shell / 子进程 / 沙箱：真正的实现（PR2 的 router 适配层）用现有的
//   comfyui.ts 过程（/object_info、validateWorkflow、executeCustomWorkflow、analyzeWorkflow）
//   兑现这些工具，全程 HTTP + LLM，故与操作系统无关（Windows 直接跑）。
// - 每步 emit 事件用于 socket 流式活动日志。

/** ComfyUI 服务器上可用的资源清单——喂给 LLM 系统提示，避免它编出不存在的 checkpoint/采样器。 */
export interface ComfyResourceList {
  checkpoints: string[];
  loras: string[];
  vaes: string[];
  samplers: string[];
  schedulers: string[];
  /** 已安装的节点 class_type 列表（来自 /object_info 的键）。 */
  nodeClasses: string[];
}

/** 引擎依赖的 ComfyUI 能力（由 router 用 comfyui.ts 兑现；单测里用假实现）。 */
export interface ComfyAgentTools {
  /** 拉取目标服务器的可用资源（checkpoint/lora/采样器/节点类）。 */
  listResources(): Promise<ComfyResourceList>;
  /** 校验一份 API 格式 workflowJson（不真正生成），返回错误列表；errorNodeClasses=错误涉及的节点类名
   *  （供引擎自动补它们的精确 schema 喂回，定向修错）。 */
  validate(workflowJson: string): Promise<{ ok: boolean; errors: string[]; errorNodeClasses?: string[] }>;
  /** 真机运行一份 workflowJson，返回产物或错误。 */
  execute(workflowJson: string): Promise<{
    ok: boolean;
    error?: string;
    images?: string[];
    videos?: string[];
    outputType?: "image" | "video";
  }>;
  /** 结构分析：抽取可编辑参数绑定 / 输出节点 / 输出类型（用于写回画布节点）。 */
  analyze(workflowJson: string): Promise<{
    paramBindings: unknown[];
    outputNodeIds: string[];
    outputType: string;
  }>;
  /** 查询若干节点类的精确输入/输出 schema（字段名·类型·枚举·默认），供 LLM 写图前对齐、
   *  不再靠记忆猜。返回一段人类可读文本（每个节点一块）。可选：老适配器不实现则引擎自动禁用。 */
  describeNodes?(classNames: string[]): Promise<string>;
  /** 可选：下载安装缺失模型（checkpoint/LoRA/VAE…）。仅当宿主提供（已注册 ops 服务器 + 权限 +
   *  开关）时可用；不提供则智能体无安装能力，只能用现有资源。参数经宿主侧安全校验。 */
  installModel?(spec: { url: string; dir: string; filename: string }): Promise<{ ok: boolean; message: string }>;
  /** 可选：下载安装缺失自定义节点（git 仓库）。同上，需宿主提供。 */
  installNode?(gitUrl: string): Promise<{ ok: boolean; message: string }>;
}

/** LLM 接口：给一组消息、拿一段文本（引擎从中解析出一个 JSON action）。 */
export interface AgentLLM {
  complete(messages: AgentMessage[]): Promise<string>;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type AgentEventType =
  | "resources" // 已拉到资源清单
  | "action" // LLM 选定的动作
  | "tool_result" // 某个工具的返回
  | "error" // 本轮出错（非致命，喂回继续）
  | "done"; // 结束（成功/失败/耗尽）

export interface AgentEvent {
  type: AgentEventType;
  iteration: number;
  /** 面向用户的中文一句话（活动日志用）。 */
  message: string;
  data?: unknown;
}

export type AgentStatus = "success" | "failed" | "exhausted" | "aborted";

export interface ComfyAgentResult {
  status: AgentStatus;
  /** 最终（或最后一版）workflowJson。 */
  workflowJson?: string;
  analysis?: { paramBindings: unknown[]; outputNodeIds: string[]; outputType: string };
  images?: string[];
  videos?: string[];
  outputType?: "image" | "video";
  iterations: number;
  /** 完整事件日志（也逐条 emit 过）。 */
  log: AgentEvent[];
}

export interface RunComfyAgentOptions {
  /** 用户的自然语言任务（如「做一个 Flux + LoRA 的高清出图工作流并调通」）。 */
  task: string;
  tools: ComfyAgentTools;
  llm: AgentLLM;
  /** 最大迭代轮数（每轮一次 LLM 调用）。默认 8。 */
  maxIterations?: number;
  /** 流式事件回调（socket 用）。 */
  emit?: (e: AgentEvent) => void;
  /** 喂回给 LLM 的工具结果字符串上限，防对话膨胀。默认 4000。 */
  maxFeedbackChars?: number;
  /** 取消信号：置位后在下一轮开头终止并返回 aborted。 */
  signal?: { aborted: boolean };
  /** 连续对话：上一版已调通的 workflowJson，本轮在其基础上按 task 修改（非从零重写）。 */
  seedWorkflowJson?: string;
  /** 连续对话：先前若干轮的精简历史（用户指令 + 结果摘要），供 LLM 理解上下文。 */
  history?: AgentMessage[];
  /** 参考范例：同库里「已在真实 ComfyUI 调通/保存」的相似工作流，供 LLM 借鉴结构/连线（已裁剪）。 */
  referenceExamples?: { label: string; workflowJson: string }[];
}

/** LLM 每轮必须返回的单个 JSON 动作。 */
interface AgentAction {
  action: "author" | "validate" | "execute" | "finish" | "give_up" | "install_model" | "install_node" | "describe_nodes";
  /** author / finish 时提供完整 API 格式 workflow 图。 */
  workflowJson?: string;
  /** 简短理由（进日志）。 */
  reasoning?: string;
  /** install_model：下载直链 / 目标子目录（checkpoints/loras/vae…）/ 文件名。 */
  modelUrl?: string;
  modelDir?: string;
  modelFilename?: string;
  /** install_node：自定义节点 git 仓库 URL。 */
  nodeGitUrl?: string;
  /** describe_nodes：要查精确输入/输出 schema 的节点类名列表。 */
  nodeClasses?: string[];
}

const VALID_ACTIONS = ["author", "validate", "execute", "finish", "give_up", "install_model", "install_node", "describe_nodes"];

const ACTION_HINT =
  '你必须只返回一个 JSON 对象，形如 {"action":"describe_nodes|author|validate|execute|finish|give_up","workflowJson":"...","reasoning":"..."}。' +
  "author/finish 时 workflowJson 必须是完整的 ComfyUI **API 格式** 图（形如 {\"节点id\":{\"class_type\":...,\"inputs\":{...}}}）。";

/** 构建系统提示（纯函数，便于单测）。continuing=多轮修改；canInstall=宿主开放了下载安装能力；
 *  canDescribe=可用 describe_nodes 查节点精确 schema。 */
export function buildSystemPrompt(task: string, res: ComfyResourceList, continuing = false, canInstall = false, canDescribe = false, examples: { label: string; workflowJson: string }[] = []): string {
  const cap = (arr: string[], n: number) => (arr.length > n ? arr.slice(0, n).concat(`…(+${arr.length - n})`) : arr);
  // 有 describe_nodes 时节点类名只作「目录」，可放宽展示上限（真正的字段规格靠查）。
  const nodeCap = canDescribe ? 400 : 120;
  return [
    "你是资深 ComfyUI 工作流工程师。目标：产出一份能在给定服务器上真机跑通的 **API 格式** workflow 图，并通过校验与运行验证。",
    continuing
      ? `这是一段多轮对话。已有一版调通的工作流（见下方消息），请在其基础上按用户新指令修改，切勿从零重写、保留无关部分。本轮指令：${task}`
      : `任务：${task}`,
    "",
    "该服务器上的可用资源（务必只用这些，切勿编造不存在的名字）：",
    `- checkpoints: ${cap(res.checkpoints, 40).join(", ") || "（无）"}`,
    `- loras: ${cap(res.loras, 40).join(", ") || "（无）"}`,
    `- vaes: ${cap(res.vaes, 20).join(", ") || "（无）"}`,
    `- samplers: ${cap(res.samplers, 40).join(", ") || "（无）"}`,
    `- schedulers: ${cap(res.schedulers, 20).join(", ") || "（无）"}`,
    `- 已安装节点类（仅名字目录${canDescribe ? "，具体输入字段用 describe_nodes 查" : ""}）: ${cap(res.nodeClasses, nodeCap).join(", ") || "（未知）"}`,
    "",
    ...(canDescribe
      ? [
          "**重要：动手写图前，先用 describe_nodes 查清你打算用的每个节点的精确输入/输出规格**（附 nodeClasses 数组，" +
            "如 {\"action\":\"describe_nodes\",\"nodeClasses\":[\"KSampler\",\"CLIPTextEncode\"]}）。它会返回每个节点的必填/可选输入字段名、类型、" +
            "枚举合法值与默认值，以及输出端口。**严禁凭记忆猜字段名**——字段名/大小写/枚举值必须与查到的完全一致，否则校验必挂。",
          "",
        ]
      : []),
    ...(examples.length
      ? [
          "参考范例（同库里已在真实 ComfyUI 调通/保存的相似工作流，可借鉴其节点组织/连线/参数写法；" +
            "但务必按上面本服务器的实际资源与节点 schema 调整，切勿照抄不存在的模型/节点名）：",
          ...examples.map((e) => `【范例：${e.label}】\n${e.workflowJson}`),
          "",
        ]
      : []),
    "工作流程：" + (canDescribe ? "describe_nodes 查清节点规格 → " : "") + "author 产出/修改工作流（系统会自动帮你 validate 并把错误喂回）→ 按错误反复修正 →",
    "自信可用时 execute 真机运行 → 若运行报错，读错误修正后再 execute → 成功后 finish。无法完成才 give_up。",
    ...(canInstall
      ? [
          "缺模型/节点时可下载安装（已开放）：install_model（附 modelUrl 直链 + modelDir 子目录如 checkpoints/loras/vae + modelFilename）；" +
            "install_node（附 nodeGitUrl 自定义节点 git 仓库）。装完会告知结果，再重试。参数会经安全校验，非法则拒绝。",
        ]
      : ["若服务器缺所需 checkpoint/LoRA/节点，只能改用现有资源或 give_up（本会话未开放下载安装）。"]),
    ACTION_HINT,
  ].join("\n");
}

/** 从 LLM 文本里稳健地抽出第一个 JSON 动作对象；失败返回 null。 */
export function extractAction(text: string): AgentAction | null {
  if (!text) return null;
  // 优先剥去 ```json ``` 围栏
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  // 再取从第一个 { 到最后一个 } 的最大块
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as AgentAction;
      if (obj && typeof obj.action === "string" && VALID_ACTIONS.includes(obj.action)) {
        return obj;
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * 跑一次 ComfyUI 工作流工程闭环。返回最终结果与完整事件日志。
 * 纯编排：所有副作用都经注入的 tools / llm，因此可被完整单测。
 */
export async function runComfyAgent(opts: RunComfyAgentOptions): Promise<ComfyAgentResult> {
  const maxIterations = opts.maxIterations ?? 8;
  const cap = opts.maxFeedbackChars ?? 4000;
  const log: AgentEvent[] = [];
  const emit = (e: AgentEvent) => { log.push(e); opts.emit?.(e); };
  const clip = (s: string) => (s.length > cap ? s.slice(0, cap) + "…（已截断）" : s);

  // 校验失败时，自动把「涉事节点」的精确 schema 连同错误一起喂回（不等 LLM 自己 describe_nodes），
  // 让它定向对照修字段——④「更聪明的修错」。无 describeNodes 或无涉事节点则返回空串。
  const autoSchema = async (iter: number, classes: string[] | undefined): Promise<string> => {
    if (!opts.tools.describeNodes || !classes?.length) return "";
    const uniq = Array.from(new Set(classes)).slice(0, 12);
    let s: string;
    try { s = await opts.tools.describeNodes(uniq); } catch { return ""; }
    emit({ type: "tool_result", iteration: iter, message: `已自动附带 ${uniq.length} 个涉事节点的输入规格`, data: { tool: "describe_nodes", auto: true, nodeClasses: uniq } });
    return `\n\n涉事节点的精确输入规格（务必对照，字段名/枚举/类型严格一致）：\n${clip(s)}`;
  };

  // 0. 拉资源清单，进系统提示。
  const resources = await opts.tools.listResources();
  emit({ type: "resources", iteration: 0, message: `已获取服务器资源：${resources.checkpoints.length} checkpoints / ${resources.loras.length} loras / ${resources.nodeClasses.length} 节点类`, data: resources });

  const continuing = !!opts.seedWorkflowJson;
  const canInstall = !!(opts.tools.installModel || opts.tools.installNode);
  const canDescribe = !!opts.tools.describeNodes;
  const messages: AgentMessage[] = [{ role: "system", content: buildSystemPrompt(opts.task, resources, continuing, canInstall, canDescribe, opts.referenceExamples ?? []) }];
  // 连续对话：并入先前若干轮精简历史。
  for (const h of opts.history ?? []) messages.push(h);

  let current: string | undefined;
  if (continuing) {
    current = opts.seedWorkflowJson;
    messages.push({ role: "user", content: `当前已有一版调通的工作流（如下）。请在其基础上按本轮指令「${opts.task}」修改，author 出完整的新版 workflowJson：\n${clip(opts.seedWorkflowJson!)}` });
  } else {
    messages.push({ role: "user", content: "开始。请先 author 产出第一版 workflowJson。" });
  }

  for (let iter = 1; iter <= maxIterations; iter++) {
    if (opts.signal?.aborted) {
      emit({ type: "done", iteration: iter, message: "已取消" });
      return { status: "aborted", workflowJson: current, iterations: iter - 1, log };
    }
    const raw = await opts.llm.complete(messages);
    messages.push({ role: "assistant", content: raw });
    const action = extractAction(raw);

    if (!action) {
      emit({ type: "error", iteration: iter, message: "LLM 未返回合法 JSON 动作，已提示重试" });
      messages.push({ role: "user", content: `上一条不是合法的单个 JSON 动作。${ACTION_HINT}` });
      continue;
    }

    emit({ type: "action", iteration: iter, message: `第 ${iter} 轮：${action.action}${action.reasoning ? " — " + action.reasoning : ""}`, data: { action: action.action, reasoning: action.reasoning } });

    if (action.action === "give_up") {
      emit({ type: "done", iteration: iter, message: `智能体放弃：${action.reasoning ?? "未说明原因"}` });
      return { status: "failed", workflowJson: current, iterations: iter, log };
    }

    if (action.action === "describe_nodes") {
      if (!opts.tools.describeNodes) { messages.push({ role: "user", content: "本会话不支持 describe_nodes，请直接 author（字段不确定就先写常见字段，靠 validate 报错修正）。" }); continue; }
      const names = (action.nodeClasses ?? []).map(String).filter(Boolean).slice(0, 30);
      if (!names.length) { messages.push({ role: "user", content: "describe_nodes 需附 nodeClasses（要查的节点类名数组）。" }); continue; }
      const desc = await opts.tools.describeNodes(names);
      emit({ type: "tool_result", iteration: iter, message: `已查询 ${names.length} 个节点的输入规格`, data: { tool: "describe_nodes", nodeClasses: names } });
      messages.push({ role: "user", content: `describe_nodes 结果（严格按此写字段名/枚举/类型）：\n${clip(desc)}` });
      continue;
    }

    if (action.action === "install_model") {
      if (!opts.tools.installModel) { messages.push({ role: "user", content: "本会话未开放下载安装能力，请改用现有资源或 give_up。" }); continue; }
      if (!action.modelUrl || !action.modelDir || !action.modelFilename) { messages.push({ role: "user", content: "install_model 需附 modelUrl + modelDir + modelFilename。" }); continue; }
      const r = await opts.tools.installModel({ url: action.modelUrl, dir: action.modelDir, filename: action.modelFilename });
      emit({ type: "tool_result", iteration: iter, message: r.ok ? `已安装模型 ${action.modelFilename}` : `安装模型失败：${clip(r.message)}`, data: { tool: "install_model", ok: r.ok } });
      messages.push({ role: "user", content: `install_model: ${r.ok ? "成功" : "失败"}。${clip(r.message)}` });
      continue;
    }

    if (action.action === "install_node") {
      if (!opts.tools.installNode) { messages.push({ role: "user", content: "本会话未开放下载安装能力，请改用现有资源或 give_up。" }); continue; }
      if (!action.nodeGitUrl) { messages.push({ role: "user", content: "install_node 需附 nodeGitUrl。" }); continue; }
      const r = await opts.tools.installNode(action.nodeGitUrl);
      emit({ type: "tool_result", iteration: iter, message: r.ok ? "已安装自定义节点" : `安装节点失败：${clip(r.message)}`, data: { tool: "install_node", ok: r.ok } });
      messages.push({ role: "user", content: `install_node: ${r.ok ? "成功" : "失败"}。${clip(r.message)}` });
      continue;
    }

    if (action.action === "author") {
      if (!action.workflowJson) {
        messages.push({ role: "user", content: "author 必须附带完整的 workflowJson。" });
        continue;
      }
      current = action.workflowJson;
      const v = await opts.tools.validate(current);
      emit({ type: "tool_result", iteration: iter, message: v.ok ? "校验通过" : `校验发现 ${v.errors.length} 处问题`, data: { tool: "validate", ok: v.ok, errors: v.errors } });
      if (v.ok) { messages.push({ role: "user", content: "validate: 通过。可以 execute 真机运行。" }); }
      else { messages.push({ role: "user", content: `validate: 失败：\n${clip(v.errors.join("\n"))}${await autoSchema(iter, v.errorNodeClasses)}\n请对照上面的字段规格修正后重新 author。` }); }
      continue;
    }

    if (action.action === "validate") {
      if (!current) { messages.push({ role: "user", content: "还没有 workflow，请先 author。" }); continue; }
      const v = await opts.tools.validate(current);
      emit({ type: "tool_result", iteration: iter, message: v.ok ? "校验通过" : `校验发现 ${v.errors.length} 处问题`, data: { tool: "validate", ok: v.ok, errors: v.errors } });
      messages.push({ role: "user", content: v.ok ? "validate: 通过。" : `validate: 失败：\n${clip(v.errors.join("\n"))}${await autoSchema(iter, v.errorNodeClasses)}` });
      continue;
    }

    if (action.action === "execute" || action.action === "finish") {
      const finalJson = action.action === "finish" ? (action.workflowJson || current) : current;
      if (!finalJson) { messages.push({ role: "user", content: `${action.action} 前还没有 workflow，请先 author。` }); continue; }
      current = finalJson;
      // finish 前先跑一次校验，未过则不接受、继续修。
      if (action.action === "finish") {
        const v = await opts.tools.validate(current);
        if (!v.ok) {
          emit({ type: "tool_result", iteration: iter, message: `finish 前校验未过（${v.errors.length} 处）`, data: { tool: "validate", ok: false, errors: v.errors } });
          messages.push({ role: "user", content: `finish 被拒：校验未过：\n${clip(v.errors.join("\n"))}${await autoSchema(iter, v.errorNodeClasses)}\n请继续修正。` });
          continue;
        }
      }
      const r = await opts.tools.execute(current);
      emit({ type: "tool_result", iteration: iter, message: r.ok ? "真机运行成功" : `运行失败：${clip(r.error ?? "未知错误")}`, data: { tool: "execute", ok: r.ok, error: r.error } });
      if (r.ok) {
        let analysis: ComfyAgentResult["analysis"];
        try { analysis = await opts.tools.analyze(current); } catch { /* 分析失败不阻断成功 */ }
        emit({ type: "done", iteration: iter, message: "工作流已调通 ✅" });
        return { status: "success", workflowJson: current, analysis, images: r.images, videos: r.videos, outputType: r.outputType, iterations: iter, log };
      }
      messages.push({ role: "user", content: `execute 失败：${clip(r.error ?? "未知错误")}\n请修正 workflowJson 后再 execute。` });
      continue;
    }
  }

  emit({ type: "done", iteration: maxIterations, message: `已达最大轮数（${maxIterations}），未调通，返回最后一版工作流` });
  return { status: "exhausted", workflowJson: current, iterations: maxIterations, log };
}
