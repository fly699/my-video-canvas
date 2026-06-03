import { useEffect } from "react";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { detectUpstreamPrompt, detectUpstreamImages } from "../../../lib/comfyWorkflowParams";

interface AutoFillPayload {
  prompt?: string;
  negPrompt?: string;
  referenceImageUrl?: string;
  referenceImages?: { id: string; url: string; source?: string }[];
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
) {
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
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
      const imgs = detectUpstreamImages(id, edges, nodes);
      if (imgs.length > 0) {
        patch.referenceImageUrl = imgs[0];
        if (imgs.length > 1 && !(payload.referenceImages && payload.referenceImages.length > 1)) {
          patch.referenceImages = imgs.slice(0, 6).map((u, i) => ({ id: `up_${i}`, url: u, source: "upstream" as const }));
        }
      }
    }

    if (Object.keys(patch).length > 0) updateNodeData(id, patch, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, edges, nodes, payload.prompt, payload.negPrompt, payload.referenceImageUrl]);
}
