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

/** Same estimate but over already-created canvas nodes (whole-canvas preflight).
 *  Accepts a minimal shape so it works on store nodes without importing them. */
export function estimateNodesBudget(
  nodes: Array<{ data: { nodeType: string; payload?: Record<string, unknown> } }>,
): BudgetEstimate {
  const ops: AgentOperation[] = nodes.map((n) => ({
    op: "create",
    nodeType: n.data.nodeType as AgentOperation["nodeType"],
    payload: n.data.payload,
  }));
  return estimateOpsBudget(ops);
}

/** Compact one-line label, or "" when nothing costs anything. */
export function budgetLabel(b: BudgetEstimate): string {
  const parts: string[] = [];
  if (b.credits > 0) parts.push(`云端约 ${b.credits} credits`);
  if (b.byModelCount > 0) parts.push(`${b.byModelCount} 项按模型计费`);
  if (b.localCount > 0) parts.push(`${b.localCount} 项本地(免费)`);
  return parts.join(" · ");
}

// ── Per-line-item breakdown ──────────────────────────────────────────────────
// The one-line label hides *which* operations cost what. The breakdown groups
// create-ops by (node type, model) so the proposal card can show, e.g.,
// "云端生图 · Nano Banana ×3 = 15 credits" and surface the priciest items.

export interface BudgetLineItem {
  key: string;              // grouping key (nodeType[:model])
  label: string;            // human label, e.g. "云端生图 · Nano Banana"
  count: number;
  kind: "credits" | "byModel" | "local";
  unitCredits?: number;     // per-item credits (only when kind === "credits")
  totalCredits?: number;    // count × unitCredits (only when kind === "credits")
}

const COMFY_LABEL: Record<string, string> = {
  comfyui_image: "ComfyUI 生图",
  comfyui_video: "ComfyUI 生视频",
  comfyui_workflow: "ComfyUI 工作流",
};

/** Group the planned create-ops into per-type/per-model cost lines (sorted: 已知 credits 降序 → 按模型 → 本地). */
export function estimateOpsBudgetBreakdown(ops: AgentOperation[]): BudgetLineItem[] {
  const map = new Map<string, BudgetLineItem>();
  const bump = (key: string, base: () => Omit<BudgetLineItem, "count" | "totalCredits">) => {
    const cur = map.get(key);
    if (cur) {
      cur.count++;
      if (cur.unitCredits != null) cur.totalCredits = cur.unitCredits * cur.count;
    } else {
      const b = base();
      map.set(key, { ...b, count: 1, ...(b.unitCredits != null ? { totalCredits: b.unitCredits } : {}) });
    }
  };
  for (const op of ops) {
    if (op.op !== "create" || !op.nodeType) continue;
    switch (op.nodeType) {
      case "image_gen": {
        const model = (op.payload?.model as string | undefined) ?? "";
        const m = IMAGE_MODELS.find((x) => x.value === model);
        if (m?.cost != null) {
          bump(`image_gen:${model}`, () => ({ key: `image_gen:${model}`, label: `云端生图 · ${m.label}`, kind: "credits", unitCredits: m.cost }));
        } else {
          const name = m?.label ?? "未指定模型";
          bump(`image_gen_bm:${model}`, () => ({ key: `image_gen_bm:${model}`, label: `云端生图 · ${name}（按用量计费）`, kind: "byModel" }));
        }
        break;
      }
      case "video_task":
        bump("video_task", () => ({ key: "video_task", label: "云端生视频（按时长/分辨率计费）", kind: "byModel" }));
        break;
      case "comfyui_image":
      case "comfyui_video":
      case "comfyui_workflow":
        bump(op.nodeType, () => ({ key: op.nodeType!, label: `${COMFY_LABEL[op.nodeType!]}（本地·免费）`, kind: "local" }));
        break;
      default:
        break;
    }
  }
  const rank = { credits: 0, byModel: 1, local: 2 } as const;
  return Array.from(map.values()).sort((a, b) =>
    rank[a.kind] - rank[b.kind] || (b.totalCredits ?? 0) - (a.totalCredits ?? 0) || a.label.localeCompare(b.label, "zh"),
  );
}
