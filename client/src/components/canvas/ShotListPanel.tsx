import { useMemo, useState } from "react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { X, ClipboardList, ArrowUp, ArrowDown, Loader2, Wand2, ListOrdered, Scaling, ImagePlus, Check, RotateCw, Clapperboard, Mic } from "lucide-react";
import type { StoryboardNodeData, ScriptNodeData } from "../../../../shared/types";
import { buildStoryboardGenInput, applyStoryboardGenResult, clampDurationForProvider } from "../../lib/storyboardGen";
import { propagateRefImage } from "../../lib/refImagePropagation";
import { PROVIDER_PARAMS, withParamDefaults, PROVIDER_PICKER_OPTIONS } from "./nodes/VideoTaskNode";
import { ModelPicker } from "./ModelPicker";
import { estimateVideoCost, estimateTtsCost, costEstimateLabel } from "../../lib/costEstimate";
import { DUBBING_MODELS, voicesForModel } from "./nodes/AudioNode";

// 「镜头表（Shot List）」侧向展开面板 —— 同组分镜的序列总览。
// 行业前期制作的核心文档：镜号/景别/运镜/时长/转场/对白 一表统管；
// 总时长 vs 目标时长实时校验 + 一键按比例缩放；相邻镜「衔接优化」（180° 轴线/景别递进）。
// 同组判定：与当前分镜共享同一上游脚本节点的所有分镜；无上游脚本时为画布全部分镜。

const ACCENT = "oklch(0.65 0.20 160)"; // storyboard 绿

interface ShotRow {
  id: string;
  num: number;          // 排序用编号（sceneNumber 数字化，非数字按出现序）
  title: string;
  payload: StoryboardNodeData;
}

const SHOT_TYPES = ["", "ECU", "CU", "MS", "MLS", "WS", "establishing"];
const TRANSITIONS = ["", "cut", "dissolve", "fade", "wipe", "match-cut"];

export function ShotListPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { updateNodeData, batchUpdateNodeData } = useCanvasStore();
  const [fixingId, setFixingId] = useState<string | null>(null);

  // 订阅同组分镜（key 化避免每渲染重建）。
  const groupKey = useCanvasStore((s) => {
    const srcScript = s.edges.find((e) => e.target === id && s.nodes.find((n) => n.id === e.source)?.data.nodeType === "script")?.source;
    const members = s.nodes.filter((n) => {
      if (n.data.nodeType !== "storyboard") return false;
      if (!srcScript) return true; // 无上游脚本 → 全画布分镜
      return s.edges.some((e) => e.target === n.id && e.source === srcScript);
    });
    return JSON.stringify({
      src: srcScript ?? null,
      target: srcScript ? (s.nodes.find((n) => n.id === srcScript)?.data.payload as ScriptNodeData | undefined)?.totalDuration ?? null : null,
      rows: members.map((n) => [
        n.id, n.data.title, n.position.x, JSON.stringify(n.data.payload),
        // 精修工位标记：本镜出边指向 image_gen（批量生图默认跳过，避免覆盖精修流程）
        s.edges.some((e) => e.source === n.id && s.nodes.find((m) => m.id === e.target)?.data.nodeType === "image_gen") ? 1 : 0,
        // 下游视频节点状态（第一个 video_task：无→"" / idle/pending/processing/succeeded/failed）
        (() => {
          for (const e of s.edges) {
            if (e.source !== n.id) continue;
            const t = s.nodes.find((m) => m.id === e.target);
            if (t?.data.nodeType === "video_task") return (t.data.payload as { status?: string }).status ?? "idle";
          }
          return "";
        })(),
        // 下游配音节点：""=无；"empty"=有节点未出声；其余=音频时长（秒字符串）
        (() => {
          for (const e of s.edges) {
            if (e.source !== n.id) continue;
            const t = s.nodes.find((m) => m.id === e.target);
            if (t?.data.nodeType === "audio") {
              const ap = t.data.payload as { url?: string; duration?: number };
              return ap.url ? String(Math.round(ap.duration ?? 0)) : "empty";
            }
          }
          return "";
        })(),
      ]),
    });
  });
  const { rows, targetDuration, scriptId } = useMemo(() => {
    const g = JSON.parse(groupKey) as { src: string | null; target: number | null; rows: [string, string, number, string, number, string, string][] };
    const parsed: (ShotRow & { x: number; hasRefine: boolean; videoStatus: string; audioStatus: string })[] = g.rows.map(([rid, title, x, pj, refine, vstat, astat], i) => {
      const payload = JSON.parse(pj) as StoryboardNodeData;
      const n = Number(payload.sceneNumber);
      return { id: rid, num: Number.isFinite(n) && n > 0 ? n : 1000 + i, title, payload, x, hasRefine: refine === 1, videoStatus: vstat, audioStatus: astat };
    });
    parsed.sort((a, b) => a.num - b.num || a.x - b.x);
    return { rows: parsed, targetDuration: g.target, scriptId: g.src };
  }, [groupKey]);

  const totalDuration = rows.reduce((s, r) => s + (Number(r.payload.duration) || 0), 0);
  const delta = targetDuration != null ? totalDuration - targetDuration : null;

  // ── 批量生成分镜图（流水线第一段）────────────────────────────────────────────
  // 每镜独立走 buildStoryboardGenInput（各自的角色/场景/@图像注入）；并发 2；
  // 状态仅存面板本地（不污染节点 payload）；写回器自带「节点已删」守卫。
  const utils = trpc.useUtils();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const selInit = useState(() => ({ done: false }))[0];
  // 默认勾选：无图 且 无精修工位 的镜（仅首次加载时初始化，用户改动后保持）。
  if (!selInit.done && rows.length > 0) {
    selInit.done = true;
    setSel(new Set(rows.filter((r) => !r.payload.imageUrl && !r.hasRefine).map((r) => r.id)));
  }
  const [batchState, setBatchState] = useState<Record<string, "running" | "done" | "error">>({});
  const [batchBusy, setBatchBusy] = useState(false);
  const toggleSel = (rid: string) => setSel((s0) => { const n = new Set(s0); n.has(rid) ? n.delete(rid) : n.add(rid); return n; });

  const genOne = async (r: ShotRow): Promise<"done" | "error"> => {
    const { nodes, edges } = useCanvasStore.getState();
    const b = buildStoryboardGenInput({ id: r.id, payload: r.payload, nodes, edges, kieTempKey: localStorage.getItem("kie:tempKey") });
    if (b.blocked) return "error";
    try {
      const res = await utils.client.imageGen.generate.mutate(b.input as Parameters<typeof utils.client.imageGen.generate.mutate>[0]);
      const urls = applyStoryboardGenResult(r.id, res, {
        getNodes: () => useCanvasStore.getState().nodes,
        updateNodeData: (nid, pl) => useCanvasStore.getState().updateNodeData(nid, pl),
        propagateRefImage,
      });
      return urls.length ? "done" : "error";
    } catch {
      return "error";
    }
  };

  const runBatch = async () => {
    if (batchBusy) return;
    const targets = rows.filter((r) => sel.has(r.id));
    if (!targets.length) { toast.error("请先勾选要生成的分镜"); return; }
    // 组装 + Σ预估（按 cr/点 分单位汇总；blocked 镜跳过）
    const { nodes, edges } = useCanvasStore.getState();
    const builds = targets.map((r) => ({ r, b: buildStoryboardGenInput({ id: r.id, payload: r.payload, nodes, edges, kieTempKey: localStorage.getItem("kie:tempKey") }) }));
    const ready = builds.filter((x) => !x.b.blocked);
    const blockedCount = builds.length - ready.length;
    if (!ready.length) { toast.error("所选分镜均缺提示词，无法生成"); return; }
    const sums: Record<string, number> = {};
    for (const { b } of ready) {
      const m = b.costLabel.match(/([\d.]+)\s*(cr|点)/);
      if (m) sums[m[2]] = (sums[m[2]] ?? 0) + Number(m[1]);
    }
    const sumText = Object.entries(sums).map(([u, v]) => `≈${Math.round(v * 10) / 10} ${u}`).join(" + ") || "按模型页计费";
    if (!window.confirm(`将为 ${ready.length} 个分镜批量生成图像（费用预估合计 ${sumText}）${blockedCount ? `；另有 ${blockedCount} 个缺提示词将跳过` : ""}。继续？`)) return;
    setBatchBusy(true);
    setBatchState((s0) => { const n = { ...s0 }; for (const { r } of ready) delete n[r.id]; return n; });
    const queue = [...ready];
    const worker = async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        setBatchState((s0) => ({ ...s0, [item.r.id]: "running" }));
        const st = await genOne(item.r);
        setBatchState((s0) => ({ ...s0, [item.r.id]: st }));
      }
    };
    await Promise.all([worker(), worker()]); // 并发 2，不打爆上游
    setBatchBusy(false);
    toast.success("批量生成完成（失败的镜可在列表中单独重试）");
  };

  const retryOne = async (r: ShotRow) => {
    if (batchState[r.id] === "running") return;
    setBatchState((s0) => ({ ...s0, [r.id]: "running" }));
    const st = await genOne(r);
    setBatchState((s0) => ({ ...s0, [r.id]: st }));
  };

  // ── 批量图生视频（流水线第二段）────────────────────────────────────────────
  // 仅对「已有关键帧图」的镜（I2V，首帧=分镜图锁定身份）；已有下游视频节点的镜跳过
  // （防重复建/重复扣费）；时长夹取到模型档位；服务端幂等/预估/审计自动继承。
  const [videoProvider, setVideoProvider] = useState<string>(() => localStorage.getItem("shotlist:videoProvider") || "poyo_kling21_std");
  const [allowT2V, setAllowT2V] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoState, setVideoState] = useState<Record<string, "running" | "done" | "error">>({});
  const pickVideoProvider = (v: string) => { setVideoProvider(v); localStorage.setItem("shotlist:videoProvider", v); };

  const submitVideoOne = async (r: ShotRow): Promise<"done" | "error"> => {
    const store = useCanvasStore.getState();
    const own = store.nodes.find((n) => n.id === r.id);
    const projectId = store.projectId;
    if (!own || !projectId) return "error";
    const hasImg = !!r.payload.imageUrl;
    if (!hasImg && !allowT2V) return "error";
    try {
      // 建视频节点 + 连线（分镜→视频）
      const vn = store.addNode("video_task", { x: own.position.x, y: own.position.y + 560 });
      const clamped = clampDurationForProvider(PROVIDER_PARAMS[videoProvider], r.payload.duration);
      const params = withParamDefaults(videoProvider, clamped != null ? { duration: clamped } : {});
      const prompt = (r.payload.promptText || r.payload.description || "").slice(0, 4000);
      store.updateNodeData(vn.id, {
        provider: videoProvider as import("../../../../shared/types").VideoProvider, prompt,
        negativePrompt: r.payload.negativePrompt,
        referenceImageUrl: hasImg ? r.payload.imageUrl : undefined,
        params,
      });
      store.onConnect({ source: r.id, target: vn.id, sourceHandle: null, targetHandle: null });
      // 提交（服务端幂等：同 nodeId 在途任务不重复扣费）
      const task = await utils.client.videoTasks.create.mutate({
        projectId, nodeId: vn.id, provider: videoProvider as never, prompt,
        negativePrompt: r.payload.negativePrompt || undefined,
        referenceImageUrl: hasImg ? r.payload.imageUrl : undefined,
        params,
        estimatedCost: costEstimateLabel(estimateVideoCost(videoProvider, params)) || undefined,
        ...(videoProvider.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
      });
      useCanvasStore.getState().updateNodeData(vn.id, { taskId: task.id, status: task.status });
      return task.status === "failed" ? "error" : "done";
    } catch {
      return "error";
    }
  };

  const runVideoBatch = async () => {
    if (videoBusy) return;
    const targets = rows.filter((r) => sel.has(r.id) && !r.videoStatus); // 已有视频工位的跳过
    const ready = targets.filter((r) => r.payload.imageUrl || allowT2V);
    const skippedNoImg = targets.length - ready.length;
    const skippedHasVideo = rows.filter((r) => sel.has(r.id) && r.videoStatus).length;
    if (!ready.length) { toast.error(allowT2V ? "勾选镜均已有视频工位" : "勾选镜中没有已出图的（可勾选「允许文生视频」直通）"); return; }
    // Σ预估
    const sums: Record<string, number> = {};
    for (const r of ready) {
      const clamped = clampDurationForProvider(PROVIDER_PARAMS[videoProvider], r.payload.duration);
      const est = estimateVideoCost(videoProvider, withParamDefaults(videoProvider, clamped != null ? { duration: clamped } : {}));
      if (est) sums[est.unit] = (sums[est.unit] ?? 0) + est.credits;
    }
    const sumText = Object.entries(sums).map(([u, v]) => `≈${Math.round(v * 10) / 10} ${u}`).join(" + ") || "按模型页计费";
    const skipNote = [skippedNoImg ? `${skippedNoImg} 个无图镜跳过` : "", skippedHasVideo ? `${skippedHasVideo} 个已有视频工位跳过` : ""].filter(Boolean).join("；");
    if (!window.confirm(`将为 ${ready.length} 个分镜提交视频生成（${hasLabel(videoProvider)}，费用预估合计 ${sumText}）${skipNote ? `；${skipNote}` : ""}。继续？`)) return;
    setVideoBusy(true);
    const queue = [...ready];
    const worker = async () => {
      for (;;) {
        const r = queue.shift();
        if (!r) return;
        setVideoState((s0) => ({ ...s0, [r.id]: "running" }));
        const st = await submitVideoOne(r);
        setVideoState((s0) => ({ ...s0, [r.id]: st }));
      }
    };
    await Promise.all([worker(), worker()]);
    setVideoBusy(false);
    toast.success("批量视频任务已提交，后台生成中（状态见各视频节点 / 本表状态徽）");
  };
  const hasLabel = (v: string) => PROVIDER_PICKER_OPTIONS.find((o) => o.value === v)?.label ?? v;

  // ── 批量配音（流水线第三段：逐镜 per-shot VO，行业对位口径）────────────────────
  // 仅对「有对白」的勾选镜；已有下游音频节点的镜跳过（防重复扣费）；
  // 每镜一条音频 → 与该镜片段天然对位；完成后行内标注 TTS 时长 vs 镜时长偏差。
  const [dubModel, setDubModel] = useState<string>(() => localStorage.getItem("shotlist:dubModel") || "openai_tts_real");
  const dubVoices = voicesForModel(dubModel);
  const [dubVoice, setDubVoice] = useState<string>(() => localStorage.getItem("shotlist:dubVoice") || "");
  const effDubVoice = dubVoices.some((v) => v.value === dubVoice) ? dubVoice : dubVoices[0]?.value;
  const [dubBusy, setDubBusy] = useState(false);
  const [dubState, setDubState] = useState<Record<string, "running" | "done" | "error">>({});

  const submitDubOne = async (r: ShotRow): Promise<"done" | "error"> => {
    const store = useCanvasStore.getState();
    const own = store.nodes.find((n) => n.id === r.id);
    const projectId = store.projectId;
    const text = r.payload.dialogue?.trim();
    if (!own || !projectId || !text) return "error";
    try {
      const an = store.addNode("audio", { x: own.position.x, y: own.position.y + 980 });
      store.updateNodeData(an.id, { audioCategory: "dubbing", ttsText: text, ttsModel: dubModel, ttsVoice: effDubVoice });
      store.onConnect({ source: r.id, target: an.id, sourceHandle: null, targetHandle: null });
      const res = await utils.client.audioGen.generateDubbing.mutate({
        model: dubModel as never, text, voice: effDubVoice, projectId,
        estimatedCost: costEstimateLabel(estimateTtsCost(dubModel, text.length)) || undefined,
        ...(dubModel.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
      });
      useCanvasStore.getState().updateNodeData(an.id, { url: res.url, duration: res.duration, name: `配音 · 镜${r.payload.sceneNumber ?? "?"}` });
      return "done";
    } catch {
      return "error";
    }
  };

  const runDubBatch = async () => {
    if (dubBusy) return;
    const targets = rows.filter((r) => sel.has(r.id) && !r.audioStatus); // 已有配音工位的跳过
    const ready = targets.filter((r) => r.payload.dialogue?.trim());
    const skippedNoDlg = targets.length - ready.length;
    if (!ready.length) { toast.error("勾选镜中没有「对白/旁白」可配音（在分镜或镜头表里填写）"); return; }
    const totalChars = ready.reduce((s0, r) => s0 + (r.payload.dialogue?.trim().length ?? 0), 0);
    const est = estimateTtsCost(dubModel, totalChars);
    const sumText = est ? costEstimateLabel(est) : "按量计费";
    if (!window.confirm(`将为 ${ready.length} 个分镜逐镜生成配音（共 ${totalChars} 字，预估 ${sumText}）${skippedNoDlg ? `；${skippedNoDlg} 个无对白跳过` : ""}。继续？`)) return;
    setDubBusy(true);
    const queue = [...ready];
    const worker = async () => {
      for (;;) {
        const r = queue.shift();
        if (!r) return;
        setDubState((s0) => ({ ...s0, [r.id]: "running" }));
        const st = await submitDubOne(r);
        setDubState((s0) => ({ ...s0, [r.id]: st }));
      }
    };
    await Promise.all([worker(), worker()]);
    setDubBusy(false);
    toast.success("批量配音完成（每镜一条音频，已连线到对应分镜）");
  };

  const continuityMut = trpc.scripts.refineShotContinuity.useMutation({
    onSuccess: (r, vars) => {
      const targetId = fixingId;
      if (targetId) {
        updateNodeData(targetId, {
          ...(r.description ? { description: r.description } : {}),
          ...(r.promptText ? { promptText: r.promptText } : {}),
          ...(r.shotType ? { shotType: r.shotType } : {}),
          ...(r.cameraMovement ? { cameraMovement: r.cameraMovement } : {}),
        });
      }
      void vars;
      toast.success(`衔接已优化：${r.note || "已按剪辑规范调整"}`, { duration: 5000 });
    },
    onError: (e) => toast.error("衔接优化失败：" + e.message),
    onSettled: () => setFixingId(null),
  });

  /** 交换两行的编号与标题（节点位置不动，只改镜号）。 */
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= rows.length) return;
    const a = rows[i], b = rows[j];
    batchUpdateNodeData([
      { id: a.id, payload: { sceneNumber: b.num < 1000 ? b.num : j + 1 } },
      { id: b.id, payload: { sceneNumber: a.num < 1000 ? a.num : i + 1 } },
    ]);
  };

  /** 按画布 x 坐标从左到右重编号（1..n）。 */
  const renumberByPosition = () => {
    const byX = [...rows].sort((a, b) => (a as ShotRow & { x: number }).x - (b as ShotRow & { x: number }).x);
    batchUpdateNodeData(byX.map((r, i) => ({ id: r.id, payload: { sceneNumber: i + 1 } })));
    toast.success("已按画布位置重编号");
  };

  /** 按比例缩放所有镜头时长到目标总时长。 */
  const scaleToTarget = () => {
    if (!targetDuration || totalDuration <= 0) return;
    const ratio = targetDuration / totalDuration;
    batchUpdateNodeData(rows.map((r) => ({
      id: r.id,
      payload: { duration: Math.max(1, Math.round((Number(r.payload.duration) || 0) * ratio)) },
    })));
    toast.success(`已按比例缩放（×${ratio.toFixed(2)}）`);
  };

  const fixContinuity = (i: number) => {
    if (i <= 0) return;
    const prev = rows[i - 1].payload, cur = rows[i].payload;
    setFixingId(rows[i].id);
    continuityMut.mutate({
      prevShot: { description: (prev.description ?? "").slice(0, 1000), shotType: prev.shotType, cameraMovement: prev.cameraMovement, transition: prev.transition },
      currentShot: { description: (cur.description ?? "").slice(0, 1000), promptText: cur.promptText?.slice(0, 2000), shotType: cur.shotType, cameraMovement: cur.cameraMovement },
    });
  };

  return (
    <div
      className="nodrag nowheel nopan"
      style={{
        position: "absolute", left: "calc(100% + 14px)", top: 0,
        width: 520, maxHeight: 620, display: "flex", flexDirection: "column",
        background: "var(--c-base)", border: `1px solid ${ACCENT}50`, borderRadius: 14,
        boxShadow: "0 18px 60px oklch(0 0 0 / 0.45)", zIndex: 30, overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", borderBottom: `1px solid ${ACCENT}30`, background: `${ACCENT}10`, flexShrink: 0 }}>
        <ClipboardList style={{ width: 14, height: 14, color: ACCENT }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--c-t1)", flex: 1 }}>
          镜头表 · Shot List
          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: "var(--c-t3)" }}>
            {rows.length} 镜{scriptId ? "（同一脚本）" : "（全画布）"}
          </span>
        </span>
        <button onClick={onClose} className="nodrag" style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", padding: 2 }}>
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>

      {/* 时长校验条 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 13px", borderBottom: "1px solid var(--c-bd1)", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--c-t2)" }}>
          总时长 <strong style={{ color: "var(--c-t1)" }}>{totalDuration}s</strong>
          {targetDuration != null && (
            <>
              {" / 目标 "}<strong style={{ color: "var(--c-t1)" }}>{targetDuration}s</strong>
              <span style={{ marginLeft: 6, fontWeight: 700, color: delta === 0 ? "oklch(0.70 0.18 150)" : Math.abs(delta!) <= targetDuration * 0.1 ? "oklch(0.75 0.16 75)" : "oklch(0.62 0.20 25)" }}>
                {delta === 0 ? "✓ 达标" : `${delta! > 0 ? "+" : ""}${delta}s`}
              </span>
            </>
          )}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {targetDuration != null && delta !== 0 && (
            <button onClick={scaleToTarget} className="nodrag flex items-center gap-1 px-2 py-1 rounded-md" style={{ fontSize: 9.5, fontWeight: 700, background: `${ACCENT}16`, border: `1px solid ${ACCENT}45`, color: ACCENT, cursor: "pointer" }}>
              <Scaling style={{ width: 10, height: 10 }} /> 按比例缩放到目标
            </button>
          )}
          <button onClick={renumberByPosition} className="nodrag flex items-center gap-1 px-2 py-1 rounded-md" style={{ fontSize: 9.5, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
            <ListOrdered style={{ width: 10, height: 10 }} /> 按位置重编号
          </button>
        </div>
      </div>

      {/* 批量生产（流水线第一段：批量生成分镜图） */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 13px", borderBottom: "1px solid var(--c-bd1)", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t2)" }}>批量生产</span>
        <button onClick={() => setSel(new Set(rows.map((r) => r.id)))} className="nodrag" style={{ fontSize: 9.5, padding: "2px 7px", borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>全选</button>
        <button onClick={() => setSel(new Set(rows.filter((r) => !r.payload.imageUrl && !r.hasRefine).map((r) => r.id)))} className="nodrag" style={{ fontSize: 9.5, padding: "2px 7px", borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>仅无图</button>
        <button onClick={() => setSel(new Set())} className="nodrag" style={{ fontSize: 9.5, padding: "2px 7px", borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>清空</button>
        <button
          onClick={() => void runBatch()}
          disabled={batchBusy || sel.size === 0}
          title="为勾选的分镜批量生成关键帧图像（每镜各自注入角色/场景控制；提交前显示费用总预估）"
          className="nodrag ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md"
          style={{ fontSize: 10, fontWeight: 700, background: batchBusy || sel.size === 0 ? "var(--c-surface)" : `${ACCENT}16`, border: `1px solid ${batchBusy || sel.size === 0 ? "var(--c-bd2)" : `${ACCENT}50`}`, color: batchBusy || sel.size === 0 ? "var(--c-t4)" : ACCENT, cursor: batchBusy || sel.size === 0 ? "not-allowed" : "pointer" }}
        >
          {batchBusy ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <ImagePlus style={{ width: 11, height: 11 }} />}
          批量生成分镜图（{sel.size}）
        </button>
      </div>

      {/* 批量图生视频（流水线第二段） */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 13px", borderBottom: "1px solid var(--c-bd1)", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t2)", flexShrink: 0 }}>批量视频</span>
        <div style={{ width: 190 }}>
          <ModelPicker value={videoProvider} onChange={pickVideoProvider} options={PROVIDER_PICKER_OPTIONS} minWidth={190} />
        </div>
        <label className="nodrag" title="无关键帧图的镜也允许提交文生视频（跳过关键帧，角色/场景一致性弱）" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, color: allowT2V ? "oklch(0.75 0.16 75)" : "var(--c-t4)", cursor: "pointer" }}>
          <input type="checkbox" checked={allowT2V} onChange={(e) => setAllowT2V(e.target.checked)} style={{ accentColor: "oklch(0.75 0.16 75)", margin: 0 }} />
          允许文生视频
        </label>
        <button
          onClick={() => void runVideoBatch()}
          disabled={videoBusy || sel.size === 0}
          title="为勾选且已出图的镜批量提交图生视频（首帧=关键帧锁定身份；时长自动夹取到模型档位）"
          className="nodrag ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md"
          style={{ fontSize: 10, fontWeight: 700, background: videoBusy || sel.size === 0 ? "var(--c-surface)" : "oklch(0.62 0.20 25 / 0.14)", border: `1px solid ${videoBusy || sel.size === 0 ? "var(--c-bd2)" : "oklch(0.62 0.20 25 / 0.5)"}`, color: videoBusy || sel.size === 0 ? "var(--c-t4)" : "oklch(0.62 0.20 25)", cursor: videoBusy || sel.size === 0 ? "not-allowed" : "pointer" }}
        >
          {videoBusy ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <Clapperboard style={{ width: 11, height: 11 }} />}
          批量生成视频
        </button>
      </div>

      {/* 批量配音（流水线第三段：逐镜 per-shot VO） */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 13px", borderBottom: "1px solid var(--c-bd1)", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t2)", flexShrink: 0 }}>批量配音</span>
        <select className="nodrag" value={dubModel} onChange={(e) => { setDubModel(e.target.value); localStorage.setItem("shotlist:dubModel", e.target.value); }}
          style={{ fontSize: 9.5, padding: "3px 6px", borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", maxWidth: 150 }}>
          {DUBBING_MODELS.filter((m) => m.value !== "voxcpm-local").map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select className="nodrag" value={effDubVoice ?? ""} onChange={(e) => { setDubVoice(e.target.value); localStorage.setItem("shotlist:dubVoice", e.target.value); }}
          style={{ fontSize: 9.5, padding: "3px 6px", borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", maxWidth: 110 }}>
          {dubVoices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <button
          onClick={() => void runDubBatch()}
          disabled={dubBusy || sel.size === 0}
          title="为勾选且有「对白/旁白」的镜逐镜生成配音（每镜一条音频、自动连线，与该镜片段天然对位）"
          className="nodrag ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md"
          style={{ fontSize: 10, fontWeight: 700, background: dubBusy || sel.size === 0 ? "var(--c-surface)" : "oklch(0.70 0.18 340 / 0.14)", border: `1px solid ${dubBusy || sel.size === 0 ? "var(--c-bd2)" : "oklch(0.70 0.18 340 / 0.5)"}`, color: dubBusy || sel.size === 0 ? "var(--c-t4)" : "oklch(0.70 0.18 340)", cursor: dubBusy || sel.size === 0 ? "not-allowed" : "pointer" }}
        >
          {dubBusy ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <Mic style={{ width: 11, height: 11 }} />}
          批量生成配音
        </button>
      </div>

      {/* 表格 */}
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {rows.map((r, i) => {
          const isSelf = r.id === id;
          const p = r.payload;
          return (
            <div key={r.id} style={{
              display: "flex", flexDirection: "column", gap: 4, padding: "7px 9px", marginBottom: 5, borderRadius: 9,
              background: isSelf ? `${ACCENT}10` : "var(--c-input)",
              border: `1px solid ${isSelf ? `${ACCENT}45` : "var(--c-bd1)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" className="nodrag" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} style={{ accentColor: ACCENT, cursor: "pointer", margin: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: ACCENT, width: 22 }}>#{p.sceneNumber ?? i + 1}</span>
                {/* 图像/生成状态徽：精修工位 > 批量状态 > 有图/无图 */}
                {batchState[r.id] === "running" ? <Loader2 style={{ width: 11, height: 11, color: ACCENT }} className="animate-spin" />
                  : batchState[r.id] === "error" ? (
                    <button onClick={() => void retryOne(r)} title="生成失败，点击重试" className="nodrag flex items-center" style={{ background: "none", border: "none", color: "oklch(0.62 0.20 25)", cursor: "pointer", padding: 0 }}>
                      <RotateCw style={{ width: 11, height: 11 }} />
                    </button>
                  )
                  : r.hasRefine ? <span title="本镜有精修工位（图像节点），批量默认跳过" style={{ fontSize: 9 }}>🛠</span>
                  : p.imageUrl ? <Check style={{ width: 11, height: 11, color: "oklch(0.70 0.18 150)" }} />
                  : <span title="无图" style={{ width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--c-t4)", display: "inline-block" }} />}
                <span title={p.description} style={{ flex: 1, fontSize: 10.5, fontWeight: 600, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.description?.slice(0, 40) || r.title}
                </span>
                {p.beatRef && <span style={{ fontSize: 8.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "oklch(0.66 0.18 250 / 0.15)", color: "oklch(0.66 0.18 250)" }}>拍{p.beatRef}</span>}
                {p.dialogue && <span title={p.dialogue} style={{ fontSize: 8.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "oklch(0.70 0.18 340 / 0.15)", color: "oklch(0.70 0.18 340)" }}>💬</span>}
                {(videoState[r.id] === "running") ? <Loader2 style={{ width: 10, height: 10, color: "oklch(0.62 0.20 25)" }} className="animate-spin" />
                  : videoState[r.id] === "error" ? <span title="视频提交失败（可重新批量或在视频节点中提交）" style={{ fontSize: 9, color: "oklch(0.62 0.20 25)" }}>🎬✗</span>
                  : r.videoStatus === "processing" || r.videoStatus === "pending" ? <span title="视频生成中" style={{ fontSize: 9 }}>🎬⏳</span>
                  : r.videoStatus === "succeeded" ? <span title="视频已生成" style={{ fontSize: 9 }}>🎬✓</span>
                  : r.videoStatus === "failed" ? <span title="视频生成失败" style={{ fontSize: 9, color: "oklch(0.62 0.20 25)" }}>🎬✗</span>
                  : null}
                {dubState[r.id] === "running" ? <Loader2 style={{ width: 10, height: 10, color: "oklch(0.70 0.18 340)" }} className="animate-spin" />
                  : dubState[r.id] === "error" ? <span title="配音失败（可重新批量）" style={{ fontSize: 9, color: "oklch(0.62 0.20 25)" }}>🎙✗</span>
                  : r.audioStatus && r.audioStatus !== "empty" ? (() => {
                      const ad = Number(r.audioStatus), sd = Number(r.payload.duration) || 0;
                      const over = sd > 0 && ad > sd;
                      return <span title={`配音 ${ad}s / 镜 ${sd}s${over ? "——超出镜时长，建议精简对白或调慢镜" : ""}`} style={{ fontSize: 9, color: over ? "oklch(0.75 0.16 75)" : "oklch(0.70 0.18 150)" }}>🎙{ad}s{over ? "⚠" : ""}</span>;
                    })()
                  : r.audioStatus === "empty" ? <span title="已有配音工位（未出声）" style={{ fontSize: 9 }}>🎙…</span>
                  : null}
                <button onClick={() => swap(i, i - 1)} disabled={i === 0} className="nodrag" title="上移" style={{ background: "none", border: "none", color: i === 0 ? "var(--c-bd2)" : "var(--c-t3)", cursor: i === 0 ? "default" : "pointer", padding: 1 }}><ArrowUp style={{ width: 12, height: 12 }} /></button>
                <button onClick={() => swap(i, i + 1)} disabled={i === rows.length - 1} className="nodrag" title="下移" style={{ background: "none", border: "none", color: i === rows.length - 1 ? "var(--c-bd2)" : "var(--c-t3)", cursor: i === rows.length - 1 ? "default" : "pointer", padding: 1 }}><ArrowDown style={{ width: 12, height: 12 }} /></button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {/* 景别 */}
                <select className="nodrag" value={p.shotType ?? ""} onChange={(e) => updateNodeData(r.id, { shotType: e.target.value || undefined })}
                  style={{ fontSize: 9.5, padding: "2px 4px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none" }}>
                  {SHOT_TYPES.map((t) => <option key={t} value={t}>{t || "景别"}</option>)}
                </select>
                <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>{p.cameraMovement || "static"}</span>
                {/* 时长 */}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  <input className="nodrag" type="number" min={1} max={120} value={Number(p.duration) || 0}
                    onChange={(e) => updateNodeData(r.id, { duration: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })}
                    style={{ width: 38, fontSize: 9.5, padding: "2px 4px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
                  <span style={{ fontSize: 9, color: "var(--c-t4)" }}>s</span>
                </span>
                {/* 转场 */}
                <select className="nodrag" value={p.transition ?? ""} onChange={(e) => updateNodeData(r.id, { transition: e.target.value || undefined })}
                  style={{ fontSize: 9.5, padding: "2px 4px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none" }}>
                  {TRANSITIONS.map((t) => <option key={t} value={t}>{t || "转场→"}</option>)}
                </select>
                {i > 0 && (
                  <button onClick={() => fixContinuity(i)} disabled={continuityMut.isPending} className="nodrag ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                    title="按上一镜优化衔接（180° 轴线 / 景别递进 / 运镜动静衔接）"
                    style={{ fontSize: 8.5, fontWeight: 700, background: `${ACCENT}14`, border: `1px solid ${ACCENT}40`, color: ACCENT, cursor: continuityMut.isPending ? "wait" : "pointer" }}>
                    {fixingId === r.id ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Wand2 style={{ width: 10, height: 10 }} />}
                    衔接优化
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p style={{ fontSize: 11, color: "var(--c-t4)", textAlign: "center", padding: 20 }}>画布上没有分镜节点</p>}
      </div>
    </div>
  );
}
