import { IMAGE_MODELS } from "./models";
import type { AgentOperation } from "../../../shared/types";

// Rough credits estimate for a planned batch of agent operations, shown on the
// proposal card before the user applies/runs. Cloud generation (image_gen) maps
// to a representative credits cost; video bills by resolution×duration so it's
// counted as "by-model"; ComfyUI nodes run on the user's own server (free).

export interface BudgetEstimate {
  credits: number;       // sum of known cloud-image credits
  byModelCount: number;  // generation nodes whose cost depends on params (video / unknown image)
  localCount: number;    // ComfyUI nodes (own server, no cloud credits)
}

export function estimateOpsBudget(ops: AgentOperation[]): BudgetEstimate {
  let credits = 0, byModelCount = 0, localCount = 0;
  for (const op of ops) {
    if (op.op !== "create" || !op.nodeType) continue;
    switch (op.nodeType) {
      case "image_gen": {
        const model = (op.payload?.model as string | undefined) ?? "";
        const m = IMAGE_MODELS.find((x) => x.value === model);
        if (m?.cost != null) credits += m.cost;
        else byModelCount++; // model unset / billed by resolution
        break;
      }
      case "video_task":
        byModelCount++;
        break;
      case "comfyui_image":
      case "comfyui_video":
      case "comfyui_workflow":
        localCount++;
        break;
      default:
        break;
    }
  }
  return { credits, byModelCount, localCount };
}

/** Compact one-line label, or "" when nothing costs anything. */
export function budgetLabel(b: BudgetEstimate): string {
  const parts: string[] = [];
  if (b.credits > 0) parts.push(`云端约 ${b.credits} credits`);
  if (b.byModelCount > 0) parts.push(`${b.byModelCount} 项按模型计费`);
  if (b.localCount > 0) parts.push(`${b.localCount} 项本地(免费)`);
  return parts.join(" · ");
}
