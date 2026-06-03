// Client-side summary of a ComfyUI API-format workflow JSON. Used to render a
// short, border-colored annotation on the custom-workflow node ("文件名 · 模型简要")
// plus a multiline tooltip with the full model list / counts. Pure parsing — no
// server round-trip; unknown class_types degrade gracefully to just a node count.

export interface ComfyWorkflowSummary {
  ok: boolean;
  brief: string;        // e.g. "sd_xl_base · +2 LoRA · 23 节点"
  detail: string;       // multiline, for a title= tooltip
  checkpoints: string[];
  loras: string[];
  vaes: string[];
  clips: string[];
  nodeCount: number;
  paramCount: number;
}

// class_type → the input field(s) that hold a model file name.
const MODEL_FIELDS: Record<string, { kind: "ckpt" | "lora" | "vae" | "clip"; fields: string[] }> = {
  CheckpointLoaderSimple: { kind: "ckpt", fields: ["ckpt_name"] },
  CheckpointLoader: { kind: "ckpt", fields: ["ckpt_name"] },
  UNETLoader: { kind: "ckpt", fields: ["unet_name"] },
  LoraLoader: { kind: "lora", fields: ["lora_name"] },
  LoraLoaderModelOnly: { kind: "lora", fields: ["lora_name"] },
  VAELoader: { kind: "vae", fields: ["vae_name"] },
  CLIPLoader: { kind: "clip", fields: ["clip_name"] },
  DualCLIPLoader: { kind: "clip", fields: ["clip_name1", "clip_name2"] },
  HunyuanVideoModelLoader: { kind: "ckpt", fields: ["model"] },
  WanModelLoader: { kind: "ckpt", fields: ["model"] },
};

/** Strip directory and known model extensions for a compact label. */
function shorten(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

const EMPTY: ComfyWorkflowSummary = {
  ok: false, brief: "", detail: "", checkpoints: [], loras: [], vaes: [], clips: [], nodeCount: 0, paramCount: 0,
};

export function summarizeComfyWorkflow(workflowJson: string | undefined): ComfyWorkflowSummary {
  if (!workflowJson || !workflowJson.trim()) return EMPTY;
  let graph: unknown;
  try {
    graph = JSON.parse(workflowJson);
  } catch {
    return EMPTY;
  }
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return EMPTY;

  const checkpoints: string[] = [];
  const loras: string[] = [];
  const vaes: string[] = [];
  const clips: string[] = [];
  let nodeCount = 0;
  let paramCount = 0;

  for (const node of Object.values(graph as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    const classType = (node as { class_type?: unknown }).class_type;
    const inputs = (node as { inputs?: unknown }).inputs;
    if (typeof classType !== "string") continue;
    nodeCount++;

    if (inputs && typeof inputs === "object" && !Array.isArray(inputs)) {
      const entries = inputs as Record<string, unknown>;
      // Literal (non-link) inputs are user-editable params; array values are
      // node-to-node connections, not params.
      for (const v of Object.values(entries)) {
        if (!Array.isArray(v)) paramCount++;
      }
      const spec = MODEL_FIELDS[classType];
      if (spec) {
        for (const f of spec.fields) {
          const raw = entries[f];
          if (typeof raw !== "string" || !raw) continue;
          const name = shorten(raw);
          if (spec.kind === "ckpt") checkpoints.push(name);
          else if (spec.kind === "lora") loras.push(name);
          else if (spec.kind === "vae") vaes.push(name);
          else if (spec.kind === "clip") clips.push(name);
        }
      }
    }
  }

  const ck = uniq(checkpoints);
  const lo = uniq(loras);
  const va = uniq(vaes);
  const cl = uniq(clips);

  if (nodeCount === 0) return EMPTY;

  // Brief: lead with the main model (if any), then LoRA count, then node count.
  const briefParts: string[] = [];
  if (ck.length > 0) briefParts.push(ck[0]);
  if (lo.length > 0) briefParts.push(`+${lo.length} LoRA`);
  briefParts.push(`${nodeCount} 节点`);
  const brief = briefParts.join(" · ");

  // Detail: full model breakdown for the hover tooltip.
  const detailLines: string[] = [];
  if (ck.length) detailLines.push(`模型: ${ck.join(", ")}`);
  if (lo.length) detailLines.push(`LoRA: ${lo.join(", ")}`);
  if (va.length) detailLines.push(`VAE: ${va.join(", ")}`);
  if (cl.length) detailLines.push(`CLIP: ${cl.join(", ")}`);
  detailLines.push(`节点 ${nodeCount} · 参数 ${paramCount}`);
  const detail = detailLines.join("\n");

  return { ok: true, brief, detail, checkpoints: ck, loras: lo, vaes: va, clips: cl, nodeCount, paramCount };
}
