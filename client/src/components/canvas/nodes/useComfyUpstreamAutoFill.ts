import { useEffect } from "react";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { detectUpstreamPrompt, detectUpstreamImages } from "../../../lib/comfyWorkflowParams";
import { deriveCharacterConditioning, effectiveCharacterRefImages, effectiveCharacters } from "../../../lib/characterConditioning";
import type { CharacterNodeData, ComfyuiIPAdapter, ComfyuiLoraEntry } from "../../../../../shared/types";

interface AutoFillPayload {
  prompt?: string;
  negPrompt?: string;
  referenceImageUrl?: string;
  referenceImages?: { id: string; url: string; source?: string }[];
  // ComfyUI image-node conditioning (present only on comfyui_image nodes).
  ipadapter?: ComfyuiIPAdapter;
  loras?: ComfyuiLoraEntry[];
}

/**
 * Pull-based upstream auto-fill for the structured ComfyUI image/video nodes,
 * complementing the push model (propagateRefImage):
 *  - upstream prompt text (prompt / storyboard / script / ai_chat) → blank prompt/negPrompt
 *  - upstream images (multiple) → blank referenceImageUrl + referenceImages[]
 * Only fills BLANK fields, so user edits are never overwritten and there's no
 * update loop (once filled, the guards stop firing).
 */
export function useComfyUpstreamAutoFill(
  id: string,
  payload: AutoFillPayload,
  updateNodeData: (id: string, patch: Record<string, unknown>, silent?: boolean) => void,
  opts?: { characterConditioning?: boolean; characterLora?: boolean },
) {
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const characterConditioning = opts?.characterConditioning ?? false;
  const characterLora = opts?.characterLora ?? false;
  useEffect(() => {
    const patch: Record<string, unknown> = {};

    if (!payload.prompt || !payload.prompt.trim()) {
      const { positive, negative } = detectUpstreamPrompt(id, edges, nodes);
      if (positive) {
        patch.prompt = positive;
        if (negative && (!payload.negPrompt || !payload.negPrompt.trim())) patch.negPrompt = negative;
      }
    }

    if (!payload.referenceImageUrl) {
      // Nodes WITHOUT the IPAdapter path (e.g. comfyui_video) lock character
      // identity via referenceImages instead — so fold any connected character's
      // views in alongside upstream images. comfyui_image uses IPAdapter (below),
      // so we don't duplicate the character into its img2img references.
      const upstream = detectUpstreamImages(id, edges, nodes);
      // @提及感知：@角色（未连线）的参考图也要并入，与下方 IPAdapter/LoRA 及提示词
      // 文字注入(effectiveCharacters)同口径，避免「文字进了 prompt 但锁脸/LoRA 不生效」。
      const charRefs = characterConditioning ? [] : effectiveCharacterRefImages(id, payload.prompt ?? "", edges, nodes);
      const imgs = Array.from(new Set([...upstream, ...charRefs]));
      if (imgs.length > 0) {
        patch.referenceImageUrl = imgs[0];
        if (imgs.length > 1 && !(payload.referenceImages && payload.referenceImages.length > 1)) {
          patch.referenceImages = imgs.slice(0, 6).map((u, i) => ({ id: `up_${i}`, url: u, source: "upstream" as const }));
        }
      }
    }

    // Character → IPAdapter face-lock + character LoRA (comfyui_image, opt-in), or
    // character LoRA only (comfyui_video, which has no IPAdapter path).
    // Fill-only-when-blank, so user edits and the no-op once-filled guard hold.
    if (characterConditioning || characterLora) {
      const charPayload = upstreamCharacter(id, payload.prompt ?? "", edges, nodes);
      if (charPayload) {
        const cond = deriveCharacterConditioning(charPayload, { ipadapter: payload.ipadapter, loras: payload.loras });
        if (characterConditioning && cond.ipadapter) patch.ipadapter = cond.ipadapter;
        if (cond.loras) patch.loras = cond.loras;
      }
    }

    if (Object.keys(patch).length > 0) updateNodeData(id, patch, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, edges, nodes, payload.prompt, payload.negPrompt, payload.referenceImageUrl, characterConditioning, characterLora]);
}

/** The PRIMARY upstream `character` payload — connected OR @-mentioned, topmost by
 *  canvas position, matching the prompt-text injection order so the IPAdapter face and
 *  the injected identity text refer to the same character. */
function upstreamCharacter(
  id: string,
  prompt: string,
  edges: { source: string; target: string }[],
  nodes: { id: string; data: { nodeType: string; payload?: unknown }; position?: { x: number; y: number } }[],
): CharacterNodeData | undefined {
  // First PERSON character (scenes carry no identity/IPAdapter). effectiveCharacters
  // unifies connected + @提及, same as the prompt-text injection path.
  return effectiveCharacters(id, prompt, edges, nodes).find((c) => (c.characterKind ?? "person") !== "scene");
}
