import type { TrpcContext } from "../context";
import { invokeLLMWithKie } from "../llmWithKie";
import { extractTextContent } from "../llm";
import { getOpsServer } from "../../db";
import { fetchComfyServerStatus, comfyErrorHint } from "../comfyui";
import { classifyCommand } from "./commandPolicy";

// AI ops assistant: natural language → an ops PLAN (diagnose + shell/docker steps).
// Reuses invokeLLMWithKie (unified key+gate), the templateAnalysis "strict JSON +
// heuristic fallback" shape, and the agentCatalog "capability whitelist + sanitize
// to prevent hallucination" idea. AI-generated commands are ALWAYS shown for
// human confirmation and are never eligible for auto-execute (gated at the caller).

export interface OpsStep {
  explain: string;       // 中文逐条解释（含危险后果）
  command: string;       // 实际要执行的命令
  channel: "ssh" | "api";
  dangerous: boolean;    // server-side authoritative (LLM's self-label is overridden)
}
export interface OpsPlan {
  plan: string;          // 一句话总体说明
  steps: OpsStep[];
  source: "ai" | "heuristic";
}

const SYS = `你是资深 ComfyUI 集群运维专家。根据用户的运维诉求和当前服务器上下文，产出一份「运维方案」。
严格只输出一个 JSON 对象（无 markdown 围栏、无多余文字）：
{
  "plan": "一句话说明总体思路",
  "steps": [
    { "explain": "这一步做什么、为什么、有什么风险", "command": "实际 shell 命令", "channel": "ssh" }
  ]
}
约束：
- command 必须是可直接在该服务器上执行的单行 shell 命令（docker 用 docker CLI；装节点用 git clone；下模型用 wget）。
- channel 只能是 "ssh"（宿主机命令）或 "api"（ComfyUI HTTP 操作，少用）。
- 若涉及删除/格式化/重启主机/清理数据卷等不可逆操作，必须在 explain 里明确写出后果。
- 优先最小可逆的命令；能只读诊断的先诊断。
- 不要编造不存在的文件名/路径；不确定的用占位并在 explain 提示用户替换。`;

function safeStr(x: unknown, max = 2000): string {
  return typeof x === "string" ? x.slice(0, max) : "";
}

/** Drop invalid steps and force-override the `dangerous` flag with the
 *  server-side classifier (never trust the LLM's self-assessment). Exported for
 *  unit testing the injection/danger guard. */
export function sanitizeAiSteps(raw: { plan?: unknown; steps?: unknown }): OpsStep[] {
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  const out: OpsStep[] = [];
  for (const s of steps.slice(0, 20)) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const command = safeStr(rec.command, 4000).trim();
    if (!command) continue;
    const channel = rec.channel === "api" ? "api" : "ssh";
    out.push({
      explain: safeStr(rec.explain, 800) || "（无说明）",
      command,
      channel,
      dangerous: classifyCommand(command).dangerous, // authoritative
    });
  }
  return out;
}

/** Build a small context snapshot to ground the LLM (deploy form + live status). */
async function buildSnapshot(serverId: number): Promise<string> {
  const s = await getOpsServer(serverId);
  if (!s) return "";
  const parts = [`部署形态：${s.deployForm}`, s.dockerContainer ? `容器名：${s.dockerContainer}` : "", s.comfyPath ? `ComfyUI 路径：${s.comfyPath}` : ""];
  if (s.comfyBaseUrl) {
    const st = await fetchComfyServerStatus(s.comfyBaseUrl).catch(() => null);
    if (st?.online) parts.push(`在线：v${st.version ?? "?"} 显存剩 ${Math.round((st.vramFreeMB ?? 0) / 1024)}G 队列 ${st.queueRunning ?? 0}/${st.queuePending ?? 0}`);
    else parts.push("ComfyUI API 离线");
  }
  return parts.filter(Boolean).join("；");
}

/** Heuristic fallback when the LLM is unavailable or returns unparseable output.
 *  Uses the existing comfyErrorHint knowledge base on any error text the user
 *  pasted, so basic diagnosis never depends on the LLM. */
function heuristicPlan(userQuery: string): OpsPlan {
  const hint = comfyErrorHint(userQuery).trim();
  return {
    plan: hint ? "基于报错的启发式诊断（未用 LLM）" : "无法用 LLM 生成方案，请改用终端手动排查",
    steps: hint ? [{ explain: hint, command: "echo '请按上述建议用 ComfyUI-Manager 安装插件或把文件放到对应目录后重启 ComfyUI'", channel: "ssh", dangerous: false }] : [],
    source: "heuristic",
  };
}

export async function aiGenerateOps(
  ctx: TrpcContext,
  opts: { model: string; serverId: number; userQuery: string },
): Promise<OpsPlan> {
  const snapshot = await buildSnapshot(opts.serverId);
  const user = `服务器上下文：${snapshot || "（无）"}\n\n用户诉求：${opts.userQuery.slice(0, 4000)}`;
  try {
    const resp = await invokeLLMWithKie(ctx, {
      messages: [{ role: "system", content: SYS }, { role: "user", content: user }],
      model: opts.model,
      maxTokens: 2000,
    });
    const text = extractTextContent(resp);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return heuristicPlan(opts.userQuery);
    const parsed = JSON.parse(m[0]) as { plan?: unknown; steps?: unknown };
    const steps = sanitizeAiSteps(parsed);
    if (steps.length === 0) return heuristicPlan(opts.userQuery);
    return { plan: safeStr(parsed.plan, 500) || "AI 运维方案", steps, source: "ai" };
  } catch {
    return heuristicPlan(opts.userQuery);
  }
}
