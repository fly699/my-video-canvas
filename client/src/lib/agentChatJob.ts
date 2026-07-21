import type { trpc } from "./trpc";

type Client = ReturnType<typeof trpc.useUtils>["client"];
type ChatInput = Parameters<Client["agent"]["submitChat"]["mutate"]>[0];
export type AgentChatResult = Awaited<ReturnType<Client["agent"]["chat"]["mutate"]>>;

/** 画布助手 / 智能体节点的规划调用：submitChat 提交 → chatStatus 轮询取结果。
 *  不押一条 HTTP 长连接（3~10 分钟的本机模型生成中，断连/掐线/服务重启都曾让
 *  已生成完的结果白丢）。轮询为短请求：单次失败自动重试；连续 3 次 missing 判
 *  任务丢失（服务器重启）；signal 中止立即抛 AbortError（后台任务仍会跑完，结果丢弃）。
 *  首轮 0.8s 快查（云端模型几秒就完，不白等 2.5s），之后间隔按 +300ms 温和爬坡至 2.5s 上限。
 *  爬坡而非固定 2.5s：job 完成到客户端发现平均少死等约 0.6–1.2s（chatStatus 是纯内存查询、
 *  不碰 DB，加密轮询近乎零成本），对 4–8s 就返回的云端模型收益最明显；长任务仍收敛到 2.5s
 *  避免高频轮询。20 分钟硬上限。 */
export async function runAgentChatJob(
  client: Client,
  input: ChatInput,
  signal?: AbortSignal,
  /** #136 每次轮询到 running 时回调服务端阶段（分析模板库/模型规划中…）与已耗时，供 UI 实时显示。
   *  #306 partial：流式回显增量文本（仅本机桥接模型+开关开时有值），供进行中气泡实时预览。 */
  onProgress?: (p: { stage?: string; elapsedMs?: number; partial?: string }) => void,
): Promise<AgentChatResult> {
  const { jobId } = await client.agent.submitChat.mutate(input);
  return pollAgentChatJob(client, jobId, signal, onProgress);
}

/** #251 只轮询已有 jobId（跨进出画布续跑：重进画布后凭服务端记的 pending jobId 接着等结果）。
 *  轮询节奏/异常语义与 runAgentChatJob 完全一致（本就是从它抽出的内核）。 */
export async function pollAgentChatJob(
  client: Client,
  jobId: string,
  signal?: AbortSignal,
  onProgress?: (p: { stage?: string; elapsedMs?: number; partial?: string }) => void,
): Promise<AgentChatResult> {
  // 可中断等待：abort 时立即唤醒，而不是睡满整个轮询间隔（否则点「取消」最多要干等 2.5s 才有反馈）。
  const wait = (ms: number) => new Promise<void>((res) => {
    const done = () => { signal?.removeEventListener("abort", done); clearTimeout(t); res(); };
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
  const startedAt = Date.now();
  let missCount = 0;
  let delay = 800;
  for (;;) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    if (Date.now() - startedAt > 20 * 60_000) throw new Error("生成超过 20 分钟仍未完成。请重试，或缩短输入/减少一次性规划的镜头数。");
    await wait(delay);
    delay = Math.min(2500, delay + 300); // 温和爬坡：800→1100→1400…→2500，快返回少死等、长任务不高频

    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    let st: Awaited<ReturnType<Client["agent"]["chatStatus"]["query"]>>;
    try {
      st = await client.agent.chatStatus.query({ jobId });
    } catch { continue; } // 网络抖动/服务重启中：下一轮再试
    if (st.state === "running") {
      const run = st as { stage?: string; elapsedMs?: number; partial?: string };
      onProgress?.({ stage: run.stage, elapsedMs: run.elapsedMs, partial: run.partial });
      continue;
    }
    if (st.state === "missing") {
      if (++missCount >= 3) throw new Error("任务已丢失（服务器可能重启过）。请重新发送。");
      continue;
    }
    if (st.state === "error") throw new Error(st.error || "生成失败");
    return st.result as AgentChatResult;
  }
}
