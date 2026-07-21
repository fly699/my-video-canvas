// #298 画布助手「给每个镜头配音」口令的执行模块。
//
// 与 ShotListPanel.runDubBatch / submitDubOne（镜头表「批量配音」按钮）同源同口径：
//   收集有对白的分镜 → 逐镜复用/新建配音工位（audio 节点，audioCategory=dubbing）
//   → 角色音色 casting（脚本配音表优先、角色档案兜底；逐段 TTS + 服务端拼接）
//   → 回写 url/duration/命名 → 自动连线到对应分镜。并发 2、已出声跳过（防重复扣费）。
// 面板版深度绑定组件状态（勾选集/模型下拉/逐行状态），这里是「全画布分镜、面板
// 同款默认参数」的口令版——不重构面板（零回归优先）：casting 语义收敛在
// lib/dialogueCasting.ts 单一事实源（两处共用同一份纯函数），工位复用/命名/计价
// 口径以注释锁与面板互相对齐（改动一边务必同步另一边）。
//
// 为什么放应用层（CanvasAgentChat）而不是 agentApply：apply 层是纯画布 store 操作
//（可单测、无副作用），绝不发网络请求——与 animatic（#268）/library 入库（#260）
// 同一 architectural 边界。配音需要 audioGen tRPC，故由聊天窗抽走执行。
import { toast } from "sonner";
import { useCanvasStore } from "../hooks/useCanvasStore";
import { parseDialogueLines, stripDialogueRoles, shouldCast, planCastSegments, type CastMap } from "./dialogueCasting";
import { estimateTtsCost, costEstimateLabel } from "./costEstimate";
import { DUBBING_VOICE_CATALOG, OPENAI_VOICES } from "../../../shared/dubbingVoices";
import { titleShotNumber } from "./inputOrder";

/** 模型→可用音色 value 表：shared 目录优先；目录外 elevenlabs 系回退 ElevenLabs 表、
 *  其余回退 OpenAI 表——与 AudioNode.voicesForModel 同语义（那边给 UI 用带 label 的
 *  完整对象，这里只要 value 校验，都吃 shared 单一真源不会漂移）。 */
function voiceValuesFor(model: string): string[] {
  const entry = DUBBING_VOICE_CATALOG.find((m) => m.model === model);
  if (entry) return entry.voices.map((v) => v.value);
  if (model.includes("elevenlabs")) {
    const el = DUBBING_VOICE_CATALOG.find((m) => m.model === "elevenlabs-v3-tts");
    return (el?.voices ?? []).map((v) => v.value);
  }
  return OPENAI_VOICES.map((v) => v.value);
}

/** 最小结构化形状（便于测试直造，不拖 React Flow 类型）。 */
export interface DubScanNode { id: string; position?: { x: number; y: number }; data: { nodeType: string; title?: string; payload?: unknown } }
export interface DubScanEdge { source: string; target: string }

export interface DubShotPlan {
  sbId: string;
  sceneNumber?: number | string;
  /** 原始对白（含「角色名：」前缀，casting 解析用；提交前会剥净）。 */
  text: string;
  /** 可复用的空配音工位（有节点未出声=上次失败，复用重试）；无则新建。 */
  reuseAudioId: string | null;
  /** 本镜生效的角色音色表：角色声音档案（默认）< 上游脚本 castVoices（优先）。 */
  cast: CastMap;
}

/** 从画布快照收集可配音的镜（纯函数，单测锁口径，与面板版 runDubBatch 对齐）：
 *  - 全画布非 disabled 分镜，按 sceneNumber 升序（无镜号排最后保持相对顺序）；
 *  - 下游已出声的配音工位（audio 非 sfx/music 且有 url）→ 跳过（防重复扣费）；
 *  - 无对白 → 跳过；空工位记下 id 供复用。
 *  #300 排除分镜工作流（script→prompt→video，无 storyboard）也要能配音：
 *  - prompt 节点（非 disabled、正向文本含「角色名：台词」格式的显式对白行、
 *    且有下游视频节点）同样当镜收集——对白 = 仅角色行（纯旁白行与画面描述
 *    无法区分，刻意不收，诚实限制）；镜号取 prompt/下游视频标题镜号
 *   （titleShotNumber，与装配段序同源）；工位挂 prompt 下游（装配对位
 *    storyboardGen 无分镜段回溯 nearestUpstreamPrompt 与此配对）。
 *  - 分镜路径行为逐字节不变；两路互不排斥（分镜链的 prompt 通常无角色对白行，
 *    含对白即视为镜载体）。 */
export function collectDubShots(
  nodes: DubScanNode[],
  edges: DubScanEdge[],
): { shots: DubShotPlan[]; total: number; skippedDone: number; skippedNoDialogue: number } {
  type SbPayload = { sceneNumber?: number | string; dialogue?: string; disabled?: boolean };
  type CharPayload = { name?: string; voiceModel?: string; voiceId?: string };
  type AudioPayload = { url?: string; audioCategory?: string };
  type ScriptPayload = { castVoices?: CastMap };
  // 角色档案默认表（全画布共享）
  const charDefaults: CastMap = {};
  for (const n of nodes) {
    if (n.data.nodeType !== "character") continue;
    const p = (n.data.payload ?? {}) as CharPayload;
    if (p.name && p.voiceModel && p.voiceId) charDefaults[p.name] = { model: p.voiceModel, voice: p.voiceId };
  }
  // 通用子例程：镜载体（分镜或 prompt）的下游配音工位状态与上游脚本 castVoices。
  const audioStation = (hostId: string): { done: boolean; reuseAudioId: string | null } => {
    let done = false; let reuseAudioId: string | null = null;
    for (const e of edges) {
      if (e.source !== hostId) continue;
      const t = nodes.find((m) => m.id === e.target);
      if (t?.data.nodeType !== "audio") continue;
      const ap = (t.data.payload ?? {}) as AudioPayload;
      if (ap.audioCategory === "sfx" || ap.audioCategory === "music") continue;
      if (ap.url) { done = true; break; }
      reuseAudioId = t.id;
    }
    return { done, reuseAudioId };
  };
  const upstreamScriptCast = (hostId: string): CastMap => {
    for (const e of edges) {
      if (e.target !== hostId) continue;
      const s = nodes.find((m) => m.id === e.source);
      if (s?.data.nodeType === "script") return ((s.data.payload ?? {}) as ScriptPayload).castVoices ?? {};
    }
    return {};
  };

  type Cand = { n: DubScanNode; text: string; sceneNumber?: number | string; order: number };
  const cands: Cand[] = [];
  // ── 分镜镜（原路径，行为不变）──
  const sbs = nodes.filter((n) => n.data.nodeType === "storyboard" && !(n.data.payload as SbPayload | undefined)?.disabled);
  sbs.forEach((n, i) => {
    const p = (n.data.payload ?? {}) as SbPayload;
    const num = Number(p.sceneNumber);
    cands.push({ n, text: (p.dialogue ?? "").trim(), sceneNumber: p.sceneNumber, order: Number.isFinite(num) && num > 0 ? num : 9000 + i });
  });
  // ── #300 prompt 镜（排除分镜工作流）──
  const VIDEO_TYPES = new Set(["video_task", "comfyui_video", "comfyui_workflow"]);
  const IMG_PASS = new Set(["image_gen", "comfyui_image"]);
  const hasDownstreamVideo = (id: string): boolean => {
    for (const e of edges) {
      if (e.source !== id) continue;
      const t = nodes.find((m) => m.id === e.target);
      if (!t) continue;
      if (VIDEO_TYPES.has(t.data.nodeType)) return true;
      // imageFirst 链：prompt→image_gen→video，多跳一层
      if (IMG_PASS.has(t.data.nodeType) && edges.some((e2) => e2.source === t.id && VIDEO_TYPES.has(nodes.find((m) => m.id === e2.target)?.data.nodeType ?? ""))) return true;
    }
    return false;
  };
  const prompts = nodes.filter((n) => n.data.nodeType === "prompt" && !(n.data.payload as { disabled?: boolean } | undefined)?.disabled);
  prompts.forEach((n, i) => {
    const pp = (n.data.payload ?? {}) as { positivePrompt?: string; promptText?: string };
    const full = (pp.positivePrompt ?? pp.promptText ?? "").trim();
    if (!full) return;
    // 只认「角色名：台词」格式的显式对白行（旁白/画面描述无法区分，不收）
    const roleLines = parseDialogueLines(full).filter((s) => s.role != null);
    if (!roleLines.length) return;
    if (!hasDownstreamVideo(n.id)) return; // 不喂视频的独立 prompt 不当镜（防误配）
    // 镜号：prompt 标题 → 下游视频标题（直连或隔 image_gen 一跳，imageFirst 链）→ 垫底
    //（与装配段序 titleShotNumber 同源）
    let num = titleShotNumber(n.data.title);
    if (!Number.isFinite(num)) {
      const vids: DubScanNode[] = [];
      for (const e of edges) {
        if (e.source !== n.id) continue;
        const t = nodes.find((m) => m.id === e.target);
        if (!t) continue;
        if (VIDEO_TYPES.has(t.data.nodeType)) vids.push(t);
        else if (IMG_PASS.has(t.data.nodeType)) {
          for (const e2 of edges) {
            if (e2.source !== t.id) continue;
            const t2 = nodes.find((m) => m.id === e2.target);
            if (t2 && VIDEO_TYPES.has(t2.data.nodeType)) vids.push(t2);
          }
        }
      }
      for (const v of vids) { const tn = titleShotNumber(v.data.title); if (Number.isFinite(tn)) { num = tn; break; } }
    }
    const text = roleLines.map((s) => `${s.role}：${s.text}`).join("\n");
    cands.push({ n, text, sceneNumber: Number.isFinite(num) ? num : undefined, order: Number.isFinite(num) ? num : 9500 + i });
  });

  cands.sort((a, b) => a.order - b.order);
  const shots: DubShotPlan[] = [];
  let skippedDone = 0, skippedNoDialogue = 0;
  for (const c of cands) {
    const st = audioStation(c.n.id);
    if (st.done) { skippedDone++; continue; }
    if (!c.text) { skippedNoDialogue++; continue; }
    shots.push({ sbId: c.n.id, sceneNumber: c.sceneNumber, text: c.text, reuseAudioId: st.reuseAudioId, cast: { ...charDefaults, ...upstreamScriptCast(c.n.id) } });
  }
  return { shots, total: cands.length, skippedDone, skippedNoDialogue };
}

/** audioGen 管线的最小客户端接口（tRPC utils.client 形状），注入以便单测替身。 */
export interface DubbingClient {
  audioGen: {
    generateDubbing: { mutate: (i: { model: never; text: string; voice?: string; projectId: number; estimatedCost?: string; kieTempKey?: string }) => Promise<{ url: string; duration?: number }> };
    concatSegments: { mutate: (i: { urls: string[]; projectId: number }) => Promise<{ url: string; duration: number }> };
  };
}

/** 口令版批量配音。confirm 计价确认（与面板同文案口径）→ 并发 2 逐镜生成。 */
export async function runDubbingFromCanvas(client: DubbingClient): Promise<void> {
  const store = useCanvasStore.getState();
  const projectId = store.projectId;
  if (!projectId) { toast.error("画布还没有项目上下文，无法配音"); return; }
  const { shots, total, skippedDone, skippedNoDialogue } = collectDubShots(store.nodes, store.edges);
  if (!shots.length) {
    toast.error(total === 0
      ? "画布上没有可配音的镜——分镜节点填「对白/旁白」，或（排除分镜工作流）在提示词节点里写「角色名：台词」格式的对白行"
      : `没有可配音的镜：${skippedDone ? `${skippedDone} 镜已有配音；` : ""}${skippedNoDialogue ? `${skippedNoDialogue} 镜无对白（分镜填 dialogue；提示词节点写「角色名：台词」行）` : ""}`);
    return;
  }
  // 默认模型/音色沿用镜头表面板的同一 localStorage 键——用户在面板里选过什么，
  // 口令版就用什么（用户设置永远第一位）；从未选过 → openai_tts_real + 首音色。
  const dubModel = localStorage.getItem("shotlist:dubModel") || "openai_tts_real";
  const voices = voiceValuesFor(dubModel);
  const saved = localStorage.getItem("shotlist:dubVoice") || "";
  const dubVoice = voices.includes(saved) ? saved : voices[0] ?? "";
  const totalChars = shots.reduce((s0, s) => s0 + s.text.length, 0);
  const est = estimateTtsCost(dubModel, totalChars);
  const sumText = est ? costEstimateLabel(est) : "按量计费";
  const castShots = shots.filter((s) => shouldCast(parseDialogueLines(s.text), s.cast)).length;
  const castNote = castShots ? `；其中 ${castShots} 镜按已锁「角色音色」分角色配音` : "";
  const skipNote = `${skippedDone ? `；${skippedDone} 镜已有配音跳过` : ""}${skippedNoDialogue ? `；${skippedNoDialogue} 镜无对白跳过` : ""}`;
  if (!window.confirm(`将为 ${shots.length} 个分镜逐镜生成配音（共 ${totalChars} 字，预估 ${sumText}）${castNote}${skipNote}。继续？`)) {
    toast.info("已取消批量配音");
    return;
  }
  const tid = toast.loading(`批量配音：0/${shots.length}…`);
  let ok = 0, fail = 0;
  const dubOne = async (s: DubShotPlan): Promise<void> => {
    const st = useCanvasStore.getState();
    const own = st.nodes.find((n) => n.id === s.sbId);
    if (!own) { fail++; return; } // 节点已删守卫
    try {
      const an = s.reuseAudioId && st.nodes.some((n) => n.id === s.reuseAudioId)
        ? { id: s.reuseAudioId }
        : st.addNode("audio", { x: own.position.x, y: own.position.y + 980 });
      // 工位存「净词」（剥角色名/舞台指示）——与面板一致，节点展示/手动重生成不念名字。
      st.updateNodeData(an.id, { audioCategory: "dubbing", ttsText: stripDialogueRoles(s.text), ttsModel: dubModel, ttsVoice: dubVoice });
      if (!s.reuseAudioId) st.onConnect({ source: s.sbId, target: an.id, sourceHandle: null, targetHandle: null });

      const segs = parseDialogueLines(s.text);
      if (shouldCast(segs, s.cast)) {
        // casting 路径：逐段 TTS（相邻同音色已在 planCastSegments 合并）→ 多段服务端拼接
        const plan = planCastSegments(segs, s.cast, { model: dubModel, voice: dubVoice });
        const urls: string[] = [];
        let dur = 0;
        for (const seg of plan) {
          // ElevenLabs 系 voice 接受任意 id（角色档案常存自定义 id）必须透传；
          // 其余模型音色非法则回退该模型首音色——与面板 submitDubOne 同规则。
          const vs = voiceValuesFor(seg.model);
          const voice = seg.model.includes("elevenlabs") && seg.voice
            ? seg.voice
            : vs.includes(seg.voice) ? seg.voice : vs[0];
          const sr = await client.audioGen.generateDubbing.mutate({
            model: seg.model as never, text: seg.text, voice, projectId,
            estimatedCost: costEstimateLabel(estimateTtsCost(seg.model, seg.text.length)) || undefined,
            ...(seg.model.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
          });
          urls.push(sr.url);
          dur += sr.duration ?? 0;
        }
        let url = urls[0];
        if (urls.length > 1) {
          const cr = await client.audioGen.concatSegments.mutate({ urls, projectId });
          url = cr.url; dur = cr.duration;
        }
        const roleCount = new Set(segs.map((x) => x.role).filter((x): x is string => x != null && s.cast[x] != null)).size;
        const first = plan[0];
        useCanvasStore.getState().updateNodeData(an.id, {
          url, duration: dur,
          ...(first ? { ttsModel: first.model, ttsVoice: first.voice } : {}),
          name: `配音 · 镜${s.sceneNumber ?? "?"}（${roleCount} 角色）`,
        });
      } else {
        const speakText = stripDialogueRoles(s.text);
        const res = await client.audioGen.generateDubbing.mutate({
          model: dubModel as never, text: speakText, voice: dubVoice, projectId,
          estimatedCost: costEstimateLabel(estimateTtsCost(dubModel, speakText.length)) || undefined,
          ...(dubModel.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
        });
        useCanvasStore.getState().updateNodeData(an.id, { url: res.url, duration: res.duration, ttsText: speakText, name: `配音 · 镜${s.sceneNumber ?? "?"}` });
      }
      ok++;
    } catch {
      fail++;
    }
    toast.loading(`批量配音：${ok + fail}/${shots.length}${fail ? `（${fail} 失败）` : ""}…`, { id: tid });
  };
  const queue = [...shots];
  const worker = async () => { for (;;) { const s = queue.shift(); if (!s) return; await dubOne(s); } };
  await Promise.all([worker(), worker()]);
  if (fail === 0) toast.success(`批量配音完成：${ok} 镜每镜一条音频，已连线到对应分镜（锁定音色已沿用）`, { id: tid, duration: 8000 });
  else toast.error(`批量配音结束：成功 ${ok} 镜、失败 ${fail} 镜——失败工位保留为空，可再说一次「给每个镜头配音」复用重试`, { id: tid, duration: 10000 });
}
