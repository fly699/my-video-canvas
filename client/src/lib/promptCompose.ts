// 视频生成提示词的「角色注入 + 效果注入」组装——单一事实源。
//
// 逐节点 VideoTaskNode.composeSubmissionContext 与「运行全部」(useWorkflowRunner) 的 video_task
// 分支必须共用同一套 prompt 组装，否则漂移：此前 runner 只做「剥@角色 + 注入角色」（injectCharacters），
// 丢了「剥@媒体字面量」与「后处理效果注入(connectedEffectPrompts)」——连了 post_process 效果节点
// 对「运行全部」的视频无效（S10）。这里是唯一事实源；两处都只做薄调用。
//
// 注意：ComfyUI 节点【不】走此组装（视觉条件另行配置，故 runner 的 injectCharacters 保持不含效果
// 注入）；image_gen/storyboard 因 maxLen/镜头表差异各自内联（见 imageGenBuild/storyboardGen）。
import { effectiveCharacters, stripCharacterMentions } from "./characterConditioning";
import { stripMediaMentions } from "./comfyWorkflowParams";
import { mergeCharactersIntoPrompt } from "./characterPrompt";
import { connectedEffectPrompts, appendEffectPrompts } from "./effectPrompt";

type MiniNode = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { x: number; y: number } };
type MiniEdge = { source: string; target: string };

/** 组装视频提示词：剥「@角色」→ 剥「@媒体」字面量 → 结构化注入连线/@角色 → 追加后处理效果提示词。
 *  与 VideoTaskNode.composeSubmissionContext 的 prompt 完全同序、同 maxLen。纯函数（快照注入）。 */
export function composeCharacterEffectPrompt(
  id: string,
  rawPrompt: string,
  nodes: MiniNode[],
  edges: MiniEdge[],
  maxLen: number,
): string {
  const chars = effectiveCharacters(id, rawPrompt, edges, nodes);
  return appendEffectPrompts(
    mergeCharactersIntoPrompt(stripMediaMentions(stripCharacterMentions(rawPrompt, nodes), nodes), chars, maxLen),
    connectedEffectPrompts(id, edges, nodes),
    maxLen,
  );
}
