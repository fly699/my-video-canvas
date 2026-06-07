// post_process「效果注入」: a post_process node builds an English effect prompt
// (generatedPrompt) from the user's selected effects. Its connection hint promises
// "→ 视频任务 / 图像生成（效果注入）", but downstream nodes never consumed it — the
// only way to use it was a manual copy button. These helpers let image_gen / video_task
// APPEND (augment, never replace) connected post_process effect prompts at submit time.

type EffectNode = { id: string; data: { nodeType: string; payload?: unknown } };
type EffectEdge = { source: string; target: string };

/** Effect prompts from every connected post_process node, in edge order, de-duped. */
export function connectedEffectPrompts(targetId: string, edges: EffectEdge[], nodes: EffectNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.target !== targetId) continue;
    const src = byId.get(e.source);
    if (src?.data.nodeType !== "post_process") continue;
    const gp = (src.data.payload as { generatedPrompt?: string } | undefined)?.generatedPrompt?.trim();
    if (gp && !seen.has(gp)) { seen.add(gp); out.push(gp); }
  }
  return out;
}

/** Append effect prompts to a base prompt (comma-joined). Optionally clamp to a server
 *  prompt limit (UTF-16-safe — drops a dangling high surrogate). */
export function appendEffectPrompts(base: string, effects: string[], maxLength?: number): string {
  if (effects.length === 0) return base;
  const merged = [base.trim(), ...effects].filter((s) => s.length > 0).join(", ");
  if (maxLength === undefined || merged.length <= maxLength) return merged;
  let out = merged.slice(0, maxLength);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}
