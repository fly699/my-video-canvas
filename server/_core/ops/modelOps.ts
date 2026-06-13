import { sshExec, tailLines } from "./sshExec";
import { getOpsServer } from "../../db";
import { fetchComfyModels } from "../comfyui";
import type { ComfyModelList } from "../comfyui";

// Model / LoRA / custom-node management. Listing models uses the ComfyUI HTTP API
// (/object_info via fetchComfyModels) — no host login needed. Installing nodes
// and downloading models go over SSH (git clone / wget) which works regardless of
// the ComfyUI-Manager version installed. All user-supplied args are charset-
// validated AND single-quoted before reaching the shell.

/** Reject anything with shell-dangerous characters; the value is also single-
 *  quoted at the call site, so this is defense in depth. */
function safeArg(s: string): boolean {
  return s.length > 0 && s.length < 2048 && !/[;&|`$<>(){}'"\\\s]/.test(s);
}
function sq(s: string): string { return `'${s}'`; } // safe because safeArg rejects quotes

// Allowed model subdirectories under ComfyUI's models/ — mirrors the directory
// knowledge in comfyErrorHint so a "missing file" hint maps to the right install
// target.
export const MODEL_DIRS = [
  "checkpoints", "loras", "vae", "controlnet", "clip", "text_encoders", "unet",
  "diffusion_models", "ipadapter", "upscale_models", "embeddings", "clip_vision", "style_models",
] as const;
export type ModelDir = (typeof MODEL_DIRS)[number];

const MODEL_EXT_RE = /^[\w][\w.\-]*\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i;
const GIT_URL_RE = /^https:\/\/[\w.\-]+\/[\w.\-/]+?(\.git)?$/;
const DL_URL_RE = /^https?:\/\/[\w.\-]+(:\d+)?\/[\w.\-/%?=&:@~+]+$/;

// Exported pure validators (injection guard) — unit-tested in server/ops.test.ts.
export function isValidGitUrl(s: string): boolean { return safeArg(s) && GIT_URL_RE.test(s); }
export function isValidModelFilename(s: string): boolean { return safeArg(s) && MODEL_EXT_RE.test(s); }
export function isValidDownloadUrl(s: string): boolean { return safeArg(s) && DL_URL_RE.test(s); }

async function requireComfyPath(serverId: number): Promise<string> {
  const s = await getOpsServer(serverId);
  if (!s) throw new Error("服务器不存在");
  if (!s.comfyPath || !safeArg(s.comfyPath)) throw new Error("该服务器未设置有效的 ComfyUI 路径（请在「服务器」页填写 comfyPath）");
  return s.comfyPath;
}

/** List all models/LoRA/etc the ComfyUI server reports (HTTP API). */
export async function listModels(serverId: number): Promise<ComfyModelList> {
  const s = await getOpsServer(serverId);
  if (!s) throw new Error("服务器不存在");
  if (!s.comfyBaseUrl) throw new Error("该服务器未配置 ComfyUI API 地址，无法列出模型");
  return fetchComfyModels(s.comfyBaseUrl);
}

export interface CustomNode { name: string; isGit: boolean; }

/** List installed custom nodes by listing custom_nodes/ over SSH. */
export async function listCustomNodes(serverId: number): Promise<CustomNode[]> {
  const comfyPath = await requireComfyPath(serverId);
  const dir = `${comfyPath.replace(/\/+$/, "")}/custom_nodes`;
  // One entry per line: name + whether it has a .git dir.
  const res = await sshExec(serverId, `for d in ${sq(dir)}/*/; do n=$(basename "$d"); if [ -d "$d/.git" ]; then echo "$n\tgit"; else echo "$n\t-"; fi; done`, { timeoutMs: 30_000 });
  if (res.exitCode !== 0) throw new Error(res.output.trim() || "列出 custom_nodes 失败");
  const nodes: CustomNode[] = [];
  for (const line of res.output.split(/\r?\n/)) {
    const [name, kind] = line.split("\t");
    const n = (name ?? "").trim();
    if (n && n !== "*" && !n.startsWith("__")) nodes.push({ name: n, isGit: kind?.trim() === "git" });
  }
  return nodes;
}

/** Install a custom node by git-cloning into custom_nodes and pip-installing its
 *  requirements (the universal method, Manager-version-independent). */
export async function installCustomNode(serverId: number, gitUrl: string): Promise<{ ok: boolean; output: string; command: string }> {
  if (!isValidGitUrl(gitUrl)) throw new Error("仅支持 https 的 git 仓库地址");
  const comfyPath = await requireComfyPath(serverId);
  const nodesDir = `${comfyPath.replace(/\/+$/, "")}/custom_nodes`;
  // Derive a target folder name from the repo (validated: clone won't run if it
  // contains anything unsafe because safeArg already passed on the whole URL).
  const repoName = (gitUrl.split("/").pop() || "node").replace(/\.git$/, "");
  const command = `cd ${sq(nodesDir)} && git clone ${sq(gitUrl)} && cd ${sq(repoName)} && ([ -f requirements.txt ] && pip install -r requirements.txt || echo 'no requirements.txt')`;
  const res = await sshExec(serverId, command, { timeoutMs: 300_000 });
  return { ok: res.exitCode === 0, output: tailLines(res.output, 80), command };
}

/** Download a model file into the chosen models/ subdirectory over SSH. */
export async function installModel(serverId: number, url: string, dir: ModelDir, filename: string): Promise<{ ok: boolean; output: string; command: string }> {
  if (!MODEL_DIRS.includes(dir)) throw new Error("非法模型目录");
  if (!isValidModelFilename(filename)) throw new Error("非法文件名（需 .safetensors/.ckpt/.gguf 等扩展名）");
  if (!isValidDownloadUrl(url)) throw new Error("非法下载地址");
  const comfyPath = await requireComfyPath(serverId);
  const target = `${comfyPath.replace(/\/+$/, "")}/models/${dir}/${filename}`;
  // -L follow redirects, -C - resume, --fail on HTTP errors.
  const command = `mkdir -p ${sq(`${comfyPath.replace(/\/+$/, "")}/models/${dir}`)} && wget -L -c -O ${sq(target)} ${sq(url)}`;
  const res = await sshExec(serverId, command, { timeoutMs: 1_800_000 });
  return { ok: res.exitCode === 0, output: tailLines(res.output, 60), command };
}
