// 工程智能体（super_agent）「接收上游上下文」的纯逻辑：把画布助手连入的提示词/角色/场景/参考图
// 编译成一段追加到工程智能体 task 的文本，让工程智能体据此搭建 ComfyUI 工作流（此前 super_agent
// 无输入桩、根本收不到画布助手产出的提示词与角色——用户反馈）。纯函数便于单测。
import { detectUpstreamPrompt, detectUpstreamImagesExpanded } from "./comfyWorkflowParams";

type MiniNode = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { y?: number } };
type MiniEdge = { source: string; target: string };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");

/** 把一个角色节点（人物/场景）编译成一行设定文本。 */
export function characterLine(n: MiniNode): string {
  const p = (n.data.payload ?? {}) as Record<string, unknown>;
  const isScene = p.characterKind === "scene" || (!str(p.name) && (str(p.sceneName) || str(p.sceneDescription)));
  if (isScene) {
    const name = str(p.sceneName) || str(n.data.title) || "场景";
    const desc = [str(p.locationType), str(p.sceneDescription), str(p.atmosphere), str(p.timeOfDay)].filter(Boolean).join("，");
    return `场景「${name}」${desc ? "：" + desc : ""}`;
  }
  const name = str(p.name) || str(n.data.title) || "角色";
  const desc = [str(p.role), str(p.gender), str(p.age), str(p.appearance), str(p.outfit), str(p.personality), str(p.signature)].filter(Boolean).join("，");
  return `角色「${name}」${desc ? "：" + desc : ""}`;
}

export interface AgentUpstreamContext {
  prompt?: string;
  negative?: string;
  characters: string[];
  imageUrls: string[];
}

/** 收集连入某 super_agent 节点的上游上下文：提示词（prompt/分镜/脚本/AI对话）、角色/场景设定、参考图。 */
export function collectAgentUpstream(nodeId: string, edges: MiniEdge[], nodes: MiniNode[]): AgentUpstreamContext {
  const { positive, negative } = detectUpstreamPrompt(nodeId, edges, nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const characters: string[] = [];
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    const src = byId.get(e.source);
    if (src?.data.nodeType === "character") {
      const line = characterLine(src);
      if (line) characters.push(line);
    }
  }
  return {
    prompt: positive || undefined,
    negative: negative || undefined,
    characters: Array.from(new Set(characters)),
    imageUrls: detectUpstreamImagesExpanded(nodeId, edges, nodes),
  };
}

/** 上游是否有任何可用上下文（用于 UI 提示「已接收上游」）。 */
export function hasAgentUpstream(ctx: AgentUpstreamContext): boolean {
  return !!ctx.prompt || !!ctx.negative || ctx.characters.length > 0 || ctx.imageUrls.length > 0;
}

/** 上游上下文的一句话摘要（UI 徽标用），无内容→""。 */
export function agentUpstreamSummary(ctx: AgentUpstreamContext): string {
  const bits: string[] = [];
  if (ctx.prompt) bits.push("提示词");
  if (ctx.characters.length) bits.push(`${ctx.characters.length} 个角色/场景`);
  if (ctx.imageUrls.length) bits.push(`${ctx.imageUrls.length} 张参考图`);
  return bits.join(" · ");
}

/** 把上游上下文拼成追加到 task 的文本块（无内容→""）。 */
export function buildAgentTaskContext(ctx: AgentUpstreamContext): string {
  const lines: string[] = [];
  if (ctx.prompt) lines.push(`【参考提示词】${ctx.prompt}`);
  if (ctx.negative) lines.push(`【负向提示词】${ctx.negative}`);
  if (ctx.characters.length) lines.push(`【角色/场景设定】\n${ctx.characters.map((c) => "- " + c).join("\n")}`);
  if (ctx.imageUrls.length) lines.push(`【参考图】共 ${ctx.imageUrls.length} 张（如工作流支持 img2img/参考，可据此设图源）：\n${ctx.imageUrls.map((u) => "- " + u).join("\n")}`);
  return lines.join("\n");
}

/** 组合用户指令与上游上下文为最终发给工程智能体的 task。 */
export function composeAgentTask(instruction: string, ctx: AgentUpstreamContext): string {
  const block = buildAgentTaskContext(ctx);
  if (!block) return instruction;
  return `${instruction}\n\n（以下是画布上游连入本工程智能体的参考信息，请在搭建工作流时据此设置提示词/角色/风格/图源）：\n${block}`;
}
