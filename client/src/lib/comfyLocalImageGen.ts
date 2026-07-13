// #87 image_gen / 分镜 云生图管线接入自建 ComfyUI。
// 当 image_gen（及分镜兜底生图）的模型选「本地 ComfyUI（自建算力）」哨兵时，改走
// comfyui.generateImage：无参考图 → txt2img，有参考图 → img2img。地址/checkpoint 复用
// 各自建入口共享的全局 localStorage（loadComfyBase / loadComfyCkpt），比例映射成
// ComfyUI 需要的显式 width/height。逐节点「生成」与「运行全部」runner 共用本纯函数，防两侧漂移。
import { loadComfyBase, loadComfyCkpt } from "./comfyLocalRoute";

/** 比例串（如 "16:9"）→ ComfyUI 的 width/height（基准 512，取 64 的整数倍）。
 *  与 useCanvasStore.aspectToComfyWH 同式；此处内联保持本纯函数零依赖、可轻量单测。 */
export function aspectToWH(aspect?: string): { width?: number; height?: number } {
  const m = /^(\d+):(\d+)$/.exec((aspect ?? "").trim());
  if (!m) return {};
  const rw = Number(m[1]), rh = Number(m[2]);
  if (!(rw > 0) || !(rh > 0)) return {};
  const r64 = (n: number) => Math.max(64, Math.round(n / 64) * 64);
  return rw >= rh
    ? { width: r64(512 * rw / rh), height: 512 }
    : { width: 512, height: r64(512 * rh / rw) };
}

export interface LocalComfyImageArgs {
  /** 已组装好的最终提示词（角色/场景已并入，与云端同源）。 */
  prompt: string;
  /** 风格串（可选）；有则前缀成 "Style: X."，与服务端 imageGen 一致。 */
  style?: string;
  negativePrompt?: string;
  /** 参考图 URL（有则 img2img，无则 txt2img）。 */
  refUrl?: string;
  /** 比例串（"16:9" 等），映射 width/height。 */
  aspect?: string;
  /** 张数（batchSize），夹到 1–8。 */
  batch?: number;
  projectId: number;
  nodeId: string;
}

/** comfyui.generateImage 的入参（loose——服务端 Zod 二次校验）。 */
export type LocalComfyImageInput = {
  projectId: number;
  nodeId: string;
  workflowTemplate: "txt2img" | "img2img";
  prompt: string;
  negPrompt?: string;
  ckpt: string;
  customBaseUrl?: string;
  width?: number;
  height?: number;
  referenceImageUrl?: string;
  batchSize: number;
};

export type LocalComfyBuildResult =
  | { ok: true; input: LocalComfyImageInput }
  | { ok: false; blocked: string };

/** 组装「本地 ComfyUI 生图」入参。缺 checkpoint 时返回 blocked（拦在提交前，不空跑占卡）。 */
export function buildLocalComfyImageInput(a: LocalComfyImageArgs): LocalComfyBuildResult {
  const ckpt = loadComfyCkpt().trim();
  if (!ckpt) return { ok: false, blocked: "请先在节点配置区选择本地 ComfyUI 的 checkpoint（自建算力）" };
  const promptCore = a.prompt?.trim() ?? "";
  if (!promptCore) return { ok: false, blocked: "请先填写提示词" };
  const base = loadComfyBase().trim();
  const { width, height } = aspectToWH(a.aspect);
  const fullPrompt = [a.style?.trim() ? `Style: ${a.style.trim()}.` : "", promptCore].filter(Boolean).join(" ");
  const neg = a.negativePrompt?.trim();
  const batch = Math.min(8, Math.max(1, Math.round(a.batch ?? 1) || 1));
  return {
    ok: true,
    input: {
      projectId: a.projectId,
      nodeId: a.nodeId,
      workflowTemplate: a.refUrl ? "img2img" : "txt2img",
      prompt: fullPrompt,
      ...(neg ? { negPrompt: neg } : {}),
      ckpt,
      ...(base ? { customBaseUrl: base } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(a.refUrl ? { referenceImageUrl: a.refUrl } : {}),
      batchSize: batch,
    },
  };
}
