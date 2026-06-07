// 角色 / 场景 → Prompt 注入工具
//
// CharacterNode 现状（修复前）：StoryboardNode.handleGenerate 只读
// appearance / sceneDescription 两个字段拼到 prompt 末尾。其余 7-9 个
// 字段（name / role / age / outfit / signature / atmosphere / ...）
// 完全没用上 — 用户填了也丢弃。
//
// 本模块提供两个能力：
// 1. characterToPromptInjection(): 把完整 character profile 序列化成
//    一段可注入的 prompt 文本，按 user 的 customPromptTemplate 占位符
//    替换（若有），否则用 auto-generate 的格式
// 2. mergeCharactersIntoPrompt(): 接收多个连入的角色节点 + base prompt,
//    把每个角色注入成 [角色: …] 块，统一格式
//
// 占位符约定（在 customPromptTemplate 里用 {name} / {appearance} 等）:
//   {name} {role} {gender} {age} {appearance} {personality} {outfit} {signature}
//   {sceneName} {locationType} {sceneDescription} {atmosphere} {timeOfDay}
// 未填的字段被替换成空字符串 + 自动 trim 邻近的标点（避免 ",  ," 等丑陋串）

import type { CharacterNodeData } from "../../../shared/types";

/** Default auto-generated template for a person character. */
const DEFAULT_PERSON_TEMPLATE =
  "{name}，{role}，{age}{gender}，外貌：{appearance}，穿着：{outfit}，性格：{personality}，标志：{signature}";

/** Default auto-generated template for a scene/location. */
const DEFAULT_SCENE_TEMPLATE =
  "场景：{sceneName}，{locationType}，{atmosphere}氛围，{timeOfDay}，{sceneDescription}";

/** Render a single character's prompt injection block. Returns "" when the
 * character is so empty it'd be just decoration noise. */
export function characterToPromptInjection(char: CharacterNodeData): string {
  const kind = char.characterKind ?? "person";
  const template = char.customPromptTemplate
    ? char.customPromptTemplate
    : kind === "scene"
      ? DEFAULT_SCENE_TEMPLATE
      : DEFAULT_PERSON_TEMPLATE;
  const replaced = applyPlaceholders(template, char);
  const cleaned = cleanupSeparators(replaced);
  return cleaned;
}

function applyPlaceholders(template: string, char: CharacterNodeData): string {
  const get = (k: keyof CharacterNodeData) => {
    const v = char[k];
    return typeof v === "string" ? v.trim() : "";
  };
  // Match standard identifier syntax — letters, digits, underscore — so
  // user-authored templates can use `{name_field}` / `{appearance2}` etc.
  // Previously [a-zA-Z]+ silently ignored those, leaving the literal
  // `{name_field}` text in the rendered prompt.
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) => get(key as keyof CharacterNodeData));
}

/** Collapse multi-separator runs and dangling separators left over after
 * empty placeholders. Handles both Chinese (，：) and ASCII (, :) variants
 * so a template with mixed punctuation still cleans up.
 *
 * Algorithm:
 * 1. Strip any "label:" segment whose value placeholder rendered to empty.
 *    A segment is recognized by "non-separator+:" immediately followed by
 *    a separator (, or , ) or end-of-string. Iterate until no more matches
 *    in case multiple empty segments are adjacent.
 * 2. Collapse runs of separators that emerged from those deletions.
 * 3. Trim leading/trailing separators and whitespace.
 */
function cleanupSeparators(s: string): string {
  // Pass 1: remove "label:" pairs whose value is empty
  let prev: string;
  do {
    prev = s;
    s = s.replace(/[^，,：:]+[：:]\s*(?=[，,]|$)/g, "");
  } while (s !== prev);
  // Pass 2: compress separator runs, trim edges
  return s
    .replace(/[，,]\s*[，,]+/g, "，")
    .replace(/[，,]\s*$/, "")
    .replace(/^\s*[，,]/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Merge a base user prompt with one or more character injection blocks.
 * Each character becomes a bracketed `[…]` block prepended to the prompt so
 * the model sees structured identity context before the scene description. */
export function mergeCharactersIntoPrompt(basePrompt: string, characters: CharacterNodeData[]): string {
  const items = characters
    .map((c) => ({ kind: c.characterKind ?? "person", text: characterToPromptInjection(c) }))
    .filter((x) => x.text.length > 0);
  if (items.length === 0) return basePrompt;
  // With multiple items, prefix each block with a kind-appropriate ordinal
  // (角色1 / 场景1…). CRITICAL: number PERSON and SCENE with INDEPENDENT counters,
  // because only PERSON characters contribute reference images (scenes are text-only —
  // connectedCharacterRefImages skips them). Numbering persons per-kind makes the Nth
  // 角色 align with the Nth person reference image even when 场景 nodes are interleaved
  // between persons — so models with ordered references (@Image1 / character1) match.
  const multi = items.length > 1;
  let personN = 0;
  let sceneN = 0;
  const blocks = items.map((x) => {
    const isScene = x.kind === "scene";
    const ord = isScene ? ++sceneN : ++personN;
    const label = multi ? `${isScene ? "场景" : "角色"}${ord}：` : "";
    return `[${label}${x.text}]`;
  });
  const prefix = blocks.join(" ");
  return basePrompt.trim().length === 0 ? prefix : `${prefix} ${basePrompt}`;
}

/** List of placeholder keys the editor UI advertises to users. Kept in sync
 * with applyPlaceholders' get() — adding a new field means updating both. */
export const CHARACTER_PLACEHOLDERS: readonly string[] = [
  "name", "role", "gender", "age", "appearance", "personality", "outfit", "signature",
  "sceneName", "locationType", "sceneDescription", "atmosphere", "timeOfDay",
];

export { DEFAULT_PERSON_TEMPLATE, DEFAULT_SCENE_TEMPLATE };
