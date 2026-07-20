// #268 画布助手「生成动态样片」口令的执行模块。
//
// 与 ShotListPanel.runAnimatic（#137 镜头表面板按钮）同源同管线：
//   收集分镜（关键帧图 + 时长/转场 + 逐镜配音）→ buildAnimaticDoc（同一纯函数核心）
//   → editor.create / save / export → 轮询 exportStatus → 成片落 asset 节点。
// 面板版深度绑定组件状态（勾选集、比例/KenBurns 控件、逐阶段进度条），这里是
// 「全镜头表、默认参数」的口令版——不重构面板（零回归优先），两处共享的合成语义
// 全部收敛在 buildAnimaticDoc 单一事实源里，收集与轮询的口径以注释锁互相对齐。
//
// 为什么放在应用层（CanvasAgentChat）而不是 agentApply：apply 层是纯画布 store
// 操作（可单测、无副作用），绝不发网络请求——与 #260 library 入库同一architectural
// 边界。animatic 需要 tRPC 渲染管线，故由聊天窗抽走执行。
import { toast } from "sonner";
import { useCanvasStore } from "../hooks/useCanvasStore";
import { buildAnimaticDoc, type AnimaticShot } from "./animatic";

/** 从画布快照收集可进样片的镜头（纯函数，单测锁口径）：
 *  - 按分镜 sceneNumber 升序（与装配端一致；无镜号排最后保持相对顺序）；
 *  - disabled（跳过参与，#134）与无关键帧图的镜剔除；
 *  - 逐镜配音 = 分镜下游 audio 节点（sfx 除外），与装配端/面板版同口径。 */
export function collectAnimaticShots(
  nodes: Array<{ id: string; data: { nodeType: string; payload?: unknown } }>,
  edges: Array<{ source: string; target: string }>,
): { shots: AnimaticShot[]; total: number; skippedNoImage: number } {
  type SbPayload = { sceneNumber?: number | string; imageUrl?: string; duration?: number; transition?: string; disabled?: boolean };
  const sbs = nodes
    .filter((n) => n.data.nodeType === "storyboard" && !(n.data.payload as SbPayload | undefined)?.disabled)
    .map((n, i) => {
      const p = (n.data.payload ?? {}) as SbPayload;
      const num = Number(p.sceneNumber);
      return { id: n.id, p, order: Number.isFinite(num) && num > 0 ? num : 9000 + i };
    })
    .sort((a, b) => a.order - b.order);
  const withImg = sbs.filter((s) => !!s.p.imageUrl);
  const shots: AnimaticShot[] = withImg.map((s) => {
    let voiceUrl: string | null = null, voiceDuration: number | null = null;
    for (const e of edges) {
      if (e.source !== s.id) continue;
      const t = nodes.find((n) => n.id === e.target);
      if (t?.data.nodeType !== "audio") continue;
      const ap = (t.data.payload ?? {}) as { url?: string; duration?: number; audioCategory?: string };
      if (ap.audioCategory === "sfx" || !ap.url) continue;
      voiceUrl = ap.url; voiceDuration = ap.duration ?? null;
      break;
    }
    return { imageUrl: s.p.imageUrl!, duration: s.p.duration, transition: s.p.transition, voiceUrl, voiceDuration };
  });
  return { shots, total: sbs.length, skippedNoImage: sbs.length - withImg.length };
}

/** editor 渲染管线的最小客户端接口（tRPC utils.client 形状），注入以便单测替身。 */
export interface AnimaticEditorClient {
  editor: {
    create: { mutate: (i: { name: string; projectId?: number; width: number; height: number; fps: number }) => Promise<{ id: number }> };
    save: { mutate: (i: { id: number; doc: unknown }) => Promise<unknown> };
    export: { mutate: (i: { id: number; quality: "medium" }) => Promise<{ jobId: string }> };
    exportStatus: { query: (i: { jobId: string }) => Promise<{ status: string; stage?: string | null; progress?: number | null; url?: string | null; error?: string | null }> };
  };
}

/** 口令版一键动态样片：渲染完把成片放到画布 anchor 右上方的 asset 节点。
 *  失败/无可用镜以 toast 报告并抛出（调用方决定是否吞掉）。 */
export async function runAnimaticFromCanvas(
  client: AnimaticEditorClient,
  opts: { aspect?: string } = {},
): Promise<void> {
  const store = useCanvasStore.getState();
  const { shots, skippedNoImage } = collectAnimaticShots(store.nodes, store.edges);
  if (!shots.length) {
    toast.error("没有可用的镜：请先给分镜生成/上传关键帧图，再让我生成动态样片");
    return;
  }
  const aspect = opts.aspect ?? "16:9";
  const dims = aspect === "9:16" ? { width: 720, height: 1280 } : aspect === "1:1" ? { width: 960, height: 960 } : { width: 1280, height: 720 };
  const doc = buildAnimaticDoc(shots, { ...dims, kenBurns: true });
  const name = `动态样片 · ${shots.length}镜`;
  const tid = toast.loading(`动态样片：创建渲染任务（${shots.length} 镜${skippedNoImage ? `，${skippedNoImage} 镜无图已跳过` : ""}）…`);
  try {
    const { id: sessId } = await client.editor.create.mutate({ name, projectId: store.projectId ?? undefined, ...dims, fps: 30 });
    await client.editor.save.mutate({ id: sessId, doc });
    const { jobId } = await client.editor.export.mutate({ id: sessId, quality: "medium" });
    const t0 = Date.now();
    for (;;) {
      await new Promise((res) => setTimeout(res, 1500));
      if (Date.now() - t0 > 10 * 60_000) throw new Error("渲染超过 10 分钟未完成——可稍后到「剪辑」里打开该会话查看结果");
      let st: Awaited<ReturnType<typeof client.editor.exportStatus.query>>;
      try { st = await client.editor.exportStatus.query({ jobId }); } catch { continue; } // 网络抖动下一轮再查
      if (st.status === "error") throw new Error(st.error || "渲染失败");
      toast.loading(`动态样片：${st.stage || "渲染中"} ${st.progress ?? 0}%`, { id: tid });
      if (st.status === "done" && st.url) {
        const s2 = useCanvasStore.getState();
        // 落位：画布现有节点包围盒右上方（与面板版「宿主节点右上」语义等价，
        // 口令版无宿主节点，取包围盒角落避免压到工作流）。
        const xs = s2.nodes.map((n) => n.position.x), ys = s2.nodes.map((n) => n.position.y);
        const an = s2.addNode("asset", { x: (xs.length ? Math.max(...xs) : 0) + 560, y: ys.length ? Math.min(...ys) : 0 });
        s2.updateNodeData(an.id, { url: st.url, type: "video", name } as never);
        toast.success(`动态样片已生成（${shots.length} 镜）——成片已放到画布，也可在剪辑器「${name}」里继续精修`, { id: tid, duration: 8000 });
        return;
      }
    }
  } catch (e) {
    toast.error("动态样片失败：" + (e instanceof Error ? e.message : String(e)), { id: tid });
  }
}
