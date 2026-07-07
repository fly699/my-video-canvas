// 组装 comfyui_workflow 自定义工作流的「运行入参」——**逐节点「运行」按钮与「运行全部/框选」
// runner 共用同一份逻辑**，杜绝二者分叉（此前 runner 漏了上游提示词/角色/多图/比例，正是本函数
// 存在的理由）。纯函数（快照注入）：喂当前画布 nodes/edges 与节点 payload，产出要提交给服务端的
// workflowJson(已按比例覆盖) + paramValues(已注入 prompt/图/音频/角色/lora/seed) + 图/音频参数键。
import type { ComfyuiWorkflowNodeData, WorkflowParamBinding } from "../../../shared/types";
import {
  detectUpstreamPrompt, positivePromptParamKey, listUpstreamImageSources, mentionedMediaSources,
  resolveImageParamsWithMap, listUpstreamAudioSources, resolveAudioParamsWithMap, fillWorkflowPromptParams,
  fillWorkflowLoraParam, parseAspectRatioFromText, detectUpstreamAspectRatio, applyAspectToWorkflow,
} from "./comfyWorkflowParams";
import { effectiveCharacters, effectiveCharacterRefImages, connectedCharacterLora, stripCharacterMentions } from "./characterConditioning";
import { mergeCharactersIntoPrompt } from "./characterPrompt";

type WFNode = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { x: number; y: number } };
type WFEdge = { source: string; target: string };

export interface WorkflowRunInput {
  workflowJson: string;                       // 已按比例覆盖（若适用）
  paramValues: Record<string, unknown>;       // 已注入 prompt/图/音频/角色/lora/seed
  imageParamKeys: string[];
  audioParamKeys: string[];
  seedPatch: Record<string, unknown>;         // 本次随机化的种子（调用方持久化写回表单）
}

export function buildWorkflowRunInput(
  nodeId: string, payload: ComfyuiWorkflowNodeData, nodes: WFNode[], edges: WFEdge[],
): WorkflowRunInput {
  const bindings = payload.paramBindings as WorkflowParamBinding[] | undefined;
  const upstreamPrompt = detectUpstreamPrompt(nodeId, edges, nodes);
  // 角色 = 连线 + 生效提示词里的「@角色」提及（提及只从「实际生效」的提示词解析，与 fill 同口径）。
  const posPromptKey = positivePromptParamKey(bindings);
  const posCur = posPromptKey && typeof payload.paramValues?.[posPromptKey] === "string" ? (payload.paramValues[posPromptKey] as string) : "";
  const upPos = (upstreamPrompt.positive ?? "").trim();
  const preferUpstream = payload.preferUpstreamPrompt !== false;
  const mentionText = preferUpstream ? (upPos || posCur) : (posCur.trim() ? posCur : upPos);
  const chars = effectiveCharacters(nodeId, mentionText, edges, nodes);
  const charRefImgs = effectiveCharacterRefImages(nodeId, mentionText, edges, nodes);
  const sources = [
    ...listUpstreamImageSources(nodeId, edges, nodes),
    ...charRefImgs.map((url, i) => ({ id: `char_ref_${i}`, title: `角色参考${i + 1}`, url })),
    ...mentionedMediaSources(mentionText, "image", nodes).map((m) => ({ id: m.id, title: m.name, url: m.url })),
  ];
  const imgResolved = resolveImageParamsWithMap(bindings, payload.paramValues ?? {}, sources, payload.imageSourceMap ?? {});
  const imageParamKeys = imgResolved.imageParamKeys;
  const audioSources = [
    ...listUpstreamAudioSources(nodeId, edges, nodes),
    ...mentionedMediaSources(mentionText, "audio", nodes).map((m) => ({ id: m.id, title: m.name, url: m.url })),
  ];
  const audioResolved = resolveAudioParamsWithMap(bindings, imgResolved.paramValues, audioSources, payload.audioSourceMap ?? {});
  const audioParamKeys = audioResolved.audioParamKeys;
  let paramValues = fillWorkflowPromptParams(bindings, audioResolved.paramValues, upstreamPrompt, { force: preferUpstream });
  // 角色身份前置到生效正向词（增强而非替换；去掉字面量「@名字」）。
  if (chars.length > 0 && posPromptKey) {
    const cur = typeof paramValues[posPromptKey] === "string" ? (paramValues[posPromptKey] as string) : "";
    paramValues = { ...paramValues, [posPromptKey]: mergeCharactersIntoPrompt(stripCharacterMentions(cur, nodes), chars) };
  }
  const charLora = connectedCharacterLora(nodeId, edges, nodes);
  if (charLora) paramValues = fillWorkflowLoraParam(bindings, paramValues, charLora.name);
  // 种子：除非用户钉住（randomizeSeed===false），每次运行重随机所有 seed 参数并回写表单。
  const seedPatch: Record<string, unknown> = {};
  if (payload.randomizeSeed !== false) {
    for (const b of bindings ?? []) {
      if (b.type === "number" && (/seed/i.test(b.fieldPath) || b.label.includes("种子"))) {
        seedPatch[`${b.nodeId}.${b.fieldPath}`] = Math.floor(Math.random() * 2_147_483_647);
      }
    }
  }
  const effectiveParamValues = { ...paramValues, ...seedPatch };
  // 比例覆盖：① 手动「按比例覆盖」→ payload.aspectRatio；② 否则从生效提示词解析；③ 提示词没写则
  // 回退上游输入图比例（仅图生视频 outputType==="video"，避免误伤文生图）。
  const effPosForRatio = posPromptKey && typeof effectiveParamValues[posPromptKey] === "string" ? (effectiveParamValues[posPromptKey] as string) : "";
  const effectiveAspect = payload.overrideRatioSize
    ? payload.aspectRatio
    : (parseAspectRatioFromText(effPosForRatio || mentionText || upstreamPrompt.positive)
      || (payload.outputType === "video" ? detectUpstreamAspectRatio(nodeId, edges, nodes) : undefined));
  const rawJson = (payload.workflowJson as string) || "";
  const workflowJson = effectiveAspect ? applyAspectToWorkflow(rawJson, effectiveAspect).json : rawJson;
  return { workflowJson, paramValues: effectiveParamValues, imageParamKeys, audioParamKeys, seedPatch };
}
