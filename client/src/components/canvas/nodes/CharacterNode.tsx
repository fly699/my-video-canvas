import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSimpleRefStrip } from "../../../hooks/useSimpleRefStrip";
import { useNodeDocks } from "../../../hooks/useNodeDocks";
import { PromptDock } from "../PromptDock";
import { useShallow } from "zustand/react/shallow";
import { BaseNode } from "../BaseNode";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { MediaImage } from "../MediaImage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { CharacterNodeData, CharacterKind, StoryboardNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { User, Users, Mountain, Upload, X, Image as ImageIcon, Loader2, Plus, Search, Save, Sparkles, Music, Dices, SlidersHorizontal, PersonStanding, Clapperboard } from "lucide-react";
import { InlineGenBar } from "../InlineGenBar";
import { ToolChip } from "../InlineBarParts";
import { useUIStyle } from "../../../contexts/UIStyleContext";
import { useCanvasMode } from "../../../contexts/CanvasModeContext";
import {
  characterToPromptInjection,
  clampLen,
  CHARACTER_PLACEHOLDERS,
  DEFAULT_PERSON_TEMPLATE,
  DEFAULT_SCENE_TEMPLATE,
} from "../../../lib/characterPrompt";
import { getGridPreset, buildGridPrompt } from "../../../../../shared/grid";
import { CharacterConsistencyPanel, type ConsistencyResult } from "../CharacterConsistencyPanel";
import { CharacterRecognitionPanel } from "../CharacterRecognitionPanel";
import { buildRecognitionRows, type RecognitionFieldRow } from "@/lib/characterRecognition";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS, type ModelPickerOption, useResolvedDefaultImageOption } from "../ModelPicker";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import { COMFY_LOCAL_MODEL, COMFY_LOCAL_OPTION, loadComfyCkpt } from "../../../lib/comfyLocalRoute";
import { ComfyCkptSelect } from "../ComfyCkptSelect";
import { PosePresetPicker } from "../PosePresetPicker";
import { ZoomableImage } from "../ZoomableImage";
import { useLightbox } from "../studio/Lightbox";
import { downloadMedia } from "../../../lib/download";
import { NodeTextArea, NodeInput } from "../NodeTextInput";
import { characterReferenceImages, deriveCharacterConditioning } from "@/lib/characterConditioning";
import { detectUpstreamImagesExpanded } from "@/lib/comfyWorkflowParams";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "character";
    title: string;
    payload: CharacterNodeData;
    projectId: number;
  };
}

// #73 三视图生成模型选项（""=系统默认），与工具箱宫格管线同源
const MA_MODEL_OPTIONS: ModelPickerOption[] = [
  { value: "", label: "默认模型（系统设置）", group: "默认", family: "默认" },
  COMFY_LOCAL_OPTION,
  ...IMAGE_MODEL_PICKER_OPTIONS,
];

const accent = "oklch(0.66 0.18 140)";
const accentA = (a: number) => `oklch(0.66 0.18 140 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = accentA(0.5);

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 12,
  background: "var(--c-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
  borderRadius: 8,
  color: "var(--c-t1)",
  outline: "none",
  transition: "border-color 150ms ease",
  lineHeight: 1.5,
  fontFamily: "var(--font-sans)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

const LOCATION_TYPES = ["室内", "室外", "城市", "自然", "历史", "科幻", "奇幻", "水下"];
const ATMOSPHERES = ["明亮", "昏暗", "神秘", "浪漫", "紧张", "宁静", "史诗"];
const TIME_OF_DAY = ["清晨", "上午", "正午", "下午", "黄昏", "夜晚", "深夜"];

const KINDS: { id: CharacterKind; label: string; icon: React.ReactNode }[] = [
  { id: "person", label: "人物",   icon: <User style={{ width: 12, height: 12 }} /> },
  { id: "scene",  label: "场景",   icon: <Mountain style={{ width: 12, height: 12 }} /> },
];

export const CharacterNode = memo(function CharacterNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  const [uploading, setUploading] = useState(false);
  // LibTV 化（#70 创意模式）：角色小卡形态——完整表单默认收起，由底部输入条「高级」
  // （或快捷键 A）展开；其它模式不受影响。
  const { uiStyle } = useUIStyle();
  const { mode: canvasModeVal } = useCanvasMode();
  const isCreativeMode = uiStyle !== "studio" && canvasModeVal === "creative";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // #76 批1：hero 姓名条就地改名。React Flow 节点内原生 dblclick 委托不可靠且会触发
  // 画布 d3 缩放（#69 RefThumbRow 同款教训）——改用 onClick 计时自实现双击（320ms 窗口），
  // 并在根元素挂原生 dblclick stopPropagation+preventDefault 截断 d3 缩放。
  const [nameEditing, setNameEditing] = useState(false);
  // #111 角色接姿势库：3D 摆姿截图 → 追加为备用视角（姿势参考）
  const [posePickerOpen, setPosePickerOpen] = useState(false);
  const lastNameClickRef = useRef(0);
  const onNameBarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastNameClickRef.current < 320) { setNameEditing(true); lastNameClickRef.current = 0; return; }
    lastNameClickRef.current = now;
  }, []);
  const nameBarRef = useCallback((el: HTMLDivElement | null) => {
    const e = el as (HTMLDivElement & { _dblGuard?: boolean }) | null;
    if (e && !e._dblGuard) { e._dblGuard = true; e.addEventListener("dblclick", (ev) => { ev.stopPropagation(); ev.preventDefault(); }); }
  }, []);
  useEffect(() => { if (!selected) setAdvancedOpen(false); }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const h = () => setAdvancedOpen((v) => !v);
    window.addEventListener("canvas:toggle-advanced", h);
    return () => window.removeEventListener("canvas:toggle-advanced", h);
  }, [selected]);
  // 左侧吸附参考图预览窗（与内嵌主图/备用视角网格并存、同源同步）。无按钮：悬停标题栏
  // 1 秒临时展开，点击吸附窗钉住持久展开（与其它生成节点统一）。
  const hasRefImg = !!(payload.referenceImageUrl?.trim() || (payload.additionalImageUrls?.length ?? 0) > 0);
  // 角色特征文字 → 连线下游生成节点时注入其提示词的那段文本（与运行时同源）。
  const charPromptText = characterToPromptInjection(payload);
  const docks = useNodeDocks(id, { hasRef: hasRefImg, hasPrompt: !!charPromptText.trim() }, { prompt: charPromptText, ref: `${payload.referenceImageUrl ?? ""}|${(payload.additionalImageUrls ?? []).join(",")}` });
  const refStrip = useSimpleRefStrip(id, payload, "multi", { accent, maxAdditional: MAX_ADDITIONAL_IMAGES, open: docks.refOpen, onOpenChange: docks.setRefOpen, onHoverChange: docks.onDockHoverChange, onPin: docks.pinRef });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const kind: CharacterKind = payload.characterKind ?? "person";

  // Receive upstream IMAGES (素材 / 图像生成 / ComfyUI 图像 / ComfyUI 自定义) as this
  // character/scene's reference images, IN ORDER: first → main 参考图, the rest → 备用视角
  // (additionalImageUrls, cap 8). Batch-expanded (a single node outputting N images fills
  // N slots). Kind-safe (image-only). Selector returns a stable string key (join) to avoid
  // array-ref churn. Triggers ONLY when the character has no reference images yet, so manual
  // uploads / edits are never overwritten (per user choice).
  const upstreamImagesKey = useCanvasStore((s) => detectUpstreamImagesExpanded(id, s.edges, s.nodes).join("\n"));
  useEffect(() => {
    const list = upstreamImagesKey ? upstreamImagesKey.split("\n").filter(Boolean) : [];
    if (list.length === 0) return;
    const patch: Record<string, unknown> = {};
    // 主参考图：仅当还没有时用第一张上游图填充（不覆盖手动上传/选择的主图）。
    const hasMain = !!payload.referenceImageUrl?.trim();
    if (!hasMain) { patch.referenceImageUrl = list[0]; patch.referenceStorageKey = undefined; }
    const main = hasMain ? payload.referenceImageUrl!.trim() : list[0];
    // 备用视角：把「所有已连接的上游图」并入（去重、排除主图、上限 8）。【只增不删】——
    // 新连进来的会被纳入、已有的（含手动添加）保留。修复此前「fill-once」导致增量连线时
    // 只保留最早那一两张、后连的被忽略（用户连了多张却只显示「参考图 2」）的问题。
    const curExtras = (payload.additionalImageUrls ?? []).map((u) => (u ?? "").trim()).filter(Boolean);
    const merged = Array.from(new Set([...curExtras, ...list.filter((u) => u !== main)])).slice(0, MAX_ADDITIONAL_IMAGES);
    const changed = merged.length !== curExtras.length || merged.some((u, i) => u !== curExtras[i]);
    if (changed) patch.additionalImageUrls = merged;
    if (Object.keys(patch).length) updateNodeData(id, patch, true);
  }, [upstreamImagesKey, payload.referenceImageUrl, payload.additionalImageUrls, id, updateNodeData]);

  // ── Connected storyboards with generated images (downstream of this character)
  // Select FLAT tuples (id, imageUrl, sceneNumber) — useShallow uses Object.is
  // element-wise, so primitives stay equal across renders. Selecting an array
  // of fresh `{id, imageUrl, sceneNumber}` literals (the obvious shape) defeats
  // useShallow because each object literal has a new reference every call.
  // Rebuild the object form inside useMemo gated on the tuple array.
  const connectedTuples = useCanvasStore(
    useShallow((s) => {
      const outgoing = s.edges.filter((e) => e.source === id);
      const flat: Array<string | number | undefined> = [];
      for (const edge of outgoing) {
        const t = s.nodes.find((n) => n.id === edge.target && n.data.nodeType === "storyboard");
        if (!t) continue;
        const p = t.data.payload as StoryboardNodeData;
        if (p.imageUrl) flat.push(t.id, p.imageUrl, p.sceneNumber);
      }
      return flat;
    }),
  );
  const connectedStoryboards = useMemo(() => {
    const out: Array<{ id: string; imageUrl: string; sceneNumber?: number | string }> = [];
    for (let i = 0; i < connectedTuples.length; i += 3) {
      out.push({
        id: connectedTuples[i] as string,
        imageUrl: connectedTuples[i + 1] as string,
        sceneNumber: connectedTuples[i + 2] as number | string | undefined,
      });
    }
    return out;
  }, [connectedTuples]);

  const [consistencyOpen, setConsistencyOpen] = useState(false);
  const [consistencyResult, setConsistencyResult] = useState<ConsistencyResult | null>(null);
  const [consistencyScenes, setConsistencyScenes] = useState<{ ids: string[]; urls: string[] }>({ ids: [], urls: [] });

  // AI 参考图识别 → 预览弹窗（勾选后才写入字段）。模型可选（需视觉能力）。
  const [recognizeRows, setRecognizeRows] = useState<RecognitionFieldRow[] | null>(null);
  // 看图识人需要视觉模型。本部署里 Claude 不支持读图（Poyo Claude 不接受 image_url），
  // 故默认 GPT-5.2，且选择器只显示支持视觉的模型（见 models.ts 的 vision 标记）。
  const [recognizeModel, setRecognizeModel] = useState<LLMModelId>("gpt-5.2");
  const recognizeMut = trpc.scripts.analyzeCharacterFromImages.useMutation({
    onSuccess: (res) => {
      const rows = buildRecognitionRows(payload, res.fields);
      if (rows.length === 0) { toast.info("未识别出可填充的字段"); return; }
      setRecognizeRows(rows);
    },
    onError: (err) => toast.error("AI 识别失败：" + err.message),
  });
  const handleRecognize = () => {
    if (recognizeMut.isPending) return;
    const imgs = characterReferenceImages(payload).slice(0, 9);
    if (imgs.length === 0) { toast.error("请先上传或连接参考图"); return; }
    recognizeMut.mutate({ imageUrls: imgs, characterKind: kind, model: recognizeModel });
  };

  // 一键多视角：用角色描述（+已有参考图作身份）生成三视图大图 → 切成 front/side/back，
  // 写入 referenceImageUrl（正面）+ additionalImageUrls（侧/背），强化跨镜一致性。
  const [multiAngleBusy, setMultiAngleBusy] = useState(false);
  const maGenMut = trpc.imageGen.generate.useMutation();
  const maComfyMut = trpc.comfyui.generateImage.useMutation();
  const maSliceMut = trpc.imageGrid.slice.useMutation();
  // #73 纳管：三视图生成此前隐形走服务端默认模型且无计价——补模型选择（与工具箱宫格
  // 管线共享 localStorage 键，同族操作同一偏好）+ 计价显示，并回传 model/estimatedCost。
  const [maModel, setMaModel] = useState<string>(() => { try { return localStorage.getItem("canvas.toolkitImageModel") ?? ""; } catch { return ""; } });
  const resolvedDftImg = useResolvedDefaultImageOption();
  const maOptionsResolved = useMemo(() => MA_MODEL_OPTIONS.map((o) => (o.value === "" ? { ...o, label: '默认 · ' + resolvedDftImg.label, costLabel: resolvedDftImg.costLabel } : o)), [resolvedDftImg.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const maCost = useMemo(() => { if (!maModel) return "按系统默认模型"; if (maModel === COMFY_LOCAL_MODEL) return "自建 · 免云端积分"; const c = estimateImageCost(maModel); return c ? costEstimateLabel(c) : "按模型页"; }, [maModel]);
  const pickMaModel = (v: string) => { setMaModel(v); try { localStorage.setItem("canvas.toolkitImageModel", v); } catch { /* ignore */ } };
  const handleMultiAngle = async () => {
    if (multiAngleBusy) return;
    const preset = getGridPreset("turnaround")!;
    const subject = charPromptText.trim() || [payload.name, payload.appearance, payload.outfit, payload.role].filter(Boolean).join(", ");
    if (!subject) { toast.error("请先填写角色外貌 / 服装等描述"); return; }
    setMultiAngleBusy(true);
    try {
      let gridUrl = "";
      if (maModel === COMFY_LOCAL_MODEL) {
        // #77 本地自建：comfyui img2img（有参考图身份约束；无图时也可纯文生但保持 img2img 需图，
        // 故无图时回落 txt2img）
        const ckpt = loadComfyCkpt();
        if (!ckpt) { toast.error("本地 ComfyUI 需先选择 checkpoint 模型"); setMultiAngleBusy(false); return; }
        const ref = payload.referenceImageUrl?.trim();
        const gen = await maComfyMut.mutateAsync({
          nodeId: id, projectId: data.projectId, ckpt,
          workflowTemplate: ref ? "img2img" : "txt2img",
          prompt: buildGridPrompt(subject, preset).slice(0, 2000),
          ...(ref ? { referenceImageUrl: ref, denoise: 0.75 } : {}),
        });
        gridUrl = gen.url || "";
      } else {
        const gen = await maGenMut.mutateAsync({
          prompt: buildGridPrompt(subject, preset),
          ...(payload.referenceImageUrl?.trim() ? { referenceImageUrl: payload.referenceImageUrl.trim() } : {}),
          aspectRatio: preset.sheetAspect,
          poyoAspectRatio: preset.sheetAspect,
          reveAspectRatio: preset.sheetAspect,
          projectId: data.projectId,
          ...(maModel ? { model: maModel, estimatedCost: maCost } : {}),
        } as Parameters<typeof maGenMut.mutateAsync>[0]);
        gridUrl = gen.urls?.[0] || gen.url || "";
      }
      if (!gridUrl) { toast.error("三视图生成失败：未返回图像"); setMultiAngleBusy(false); return; }
      const sliced = await maSliceMut.mutateAsync({ imageUrl: gridUrl, rows: preset.rows, cols: preset.cols, projectId: data.projectId });
      if (sliced.urls.length < 1) { toast.error("切分失败：未产生子图"); setMultiAngleBusy(false); return; }
      const [front, ...rest] = sliced.urls;
      updateNodeData(id, {
        referenceImageUrl: front,
        referenceStorageKey: undefined,
        additionalImageUrls: rest.slice(0, MAX_ADDITIONAL_IMAGES),
      });
      toast.success(`已生成多视角参考（${sliced.urls.length} 张：正面/侧面/背面）`);
    } catch (err) {
      toast.error("多视角生成失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setMultiAngleBusy(false);
    }
  };

  const utils = trpc.useUtils();
  // 缓存待保存输入，便于同名冲突时确认覆盖再次提交。
  const pendingSaveRef = useRef<{ name: string; characterKind: "person" | "scene"; payload: Record<string, unknown>; thumbnail?: string } | null>(null);
  const saveLibMut = trpc.characterLibrary.create.useMutation({
    onSuccess: () => { pendingSaveRef.current = null; toast.success("已保存到角色库"); utils.characterLibrary.list.invalidate(); },
    onError: (err) => {
      // 同名冲突 → 询问是否覆盖（即编辑保存）。
      const isConflict = err.data?.code === "CONFLICT" || /已存在同名/.test(err.message);
      if (isConflict && pendingSaveRef.current) {
        const inp = pendingSaveRef.current;
        if (window.confirm(`${err.message}。是否覆盖更新该角色？`)) {
          saveLibMut.mutate({ ...inp, overwrite: true });
          return;
        }
        pendingSaveRef.current = null;
        return;
      }
      toast.error("保存到角色库失败：" + err.message);
    },
  });
  const saveToLibrary = useCallback(() => {
    const name = (payload.name || payload.sceneName || "").trim();
    if (!name) { toast.error(kind === "scene" ? "请先填写场景名" : "请先填写角色名"); return; }
    // Strip graph-specific/transient fields so a re-instantiated character doesn't
    // inherit the original's agent ownership / scene membership / creator.
    const { createdBy: _c, ownerAgentId: _o, sceneGroup: _s, ...rest } = payload as Record<string, unknown>;
    void _c; void _o; void _s;
    // Strip the OPPOSITE kind's fields: a node toggled person↔scene keeps the now-hidden
    // fields in its payload, which would otherwise be saved and resurface if the library
    // entry is later toggled. Keep only this kind's fields + the shared ones.
    const PERSON_ONLY = ["name", "role", "gender", "age", "appearance", "personality", "outfit", "signature", "loraName", "loraStrength", "ipadapterWeight", "consistencySeed"];
    const SCENE_ONLY = ["sceneName", "locationType", "sceneDescription", "atmosphere", "timeOfDay"];
    const stripKeys = kind === "scene" ? PERSON_ONLY : SCENE_ONLY;
    const clean = Object.fromEntries(Object.entries(rest).filter(([k]) => !stripKeys.includes(k)));
    clean.characterKind = kind; // pin authoritatively (covers legacy/undefined)
    const input = { name, characterKind: kind, payload: clean, thumbnail: payload.referenceImageUrl || undefined };
    pendingSaveRef.current = input; // for overwrite-on-conflict
    saveLibMut.mutate(input);
  }, [payload, kind, saveLibMut]);

  const consistencyMut = trpc.scripts.checkCharacterConsistency.useMutation({
    onSuccess: (result) => {
      setConsistencyResult(result as ConsistencyResult);
      setConsistencyOpen(true);
    },
    onError: (err) => {
      toast.error("一致性审查失败：" + err.message);
    },
  });

  const profileText = useMemo(() => characterToPromptInjection(payload), [payload]);

  const handleCheckConsistency = () => {
    if (connectedStoryboards.length < 2) {
      toast.error("至少需要连接 2 个已生成图像的分镜节点");
      return;
    }
    // Sort by sceneNumber so the LLM sees them in narrative order
    const sorted = [...connectedStoryboards].sort((a, b) => {
      const sa = a.sceneNumber;
      const sb = b.sceneNumber;
      if (typeof sa === "number" && typeof sb === "number") return sa - sb;
      if (typeof sa === "number") return -1;
      if (typeof sb === "number") return 1;
      return String(sa ?? "").localeCompare(String(sb ?? ""));
    });
    const ids = sorted.map((s) => s.id);
    const urls = sorted.map((s) => s.imageUrl).slice(0, 10);
    setConsistencyScenes({ ids: ids.slice(0, 10), urls });
    consistencyMut.mutate({
      // Clamp to the server's zod limits (characterName max 120, profileText max 1500)
      // so a long name / customPromptTemplate-driven profile can't trigger BAD_REQUEST.
      characterName: clampLen((payload.name || payload.sceneName || "").trim(), 120) || undefined,
      characterKind: kind,
      profileText: profileText.length > 0 ? clampLen(profileText, 1500) : undefined,
      imageUrls: urls,
      // #73：一致性审查此前不传 model（服务端默认），改随「识别」选择的视觉模型（含自建/桥接）
      model: recognizeModel,
    });
  };

  const canCheck = connectedStoryboards.length >= 2;

  const update = useCallback(
    (key: keyof CharacterNodeData, value: unknown) => updateNodeData(id, { [key]: value }),
    [id, updateNodeData],
  );

  // "应用到所有连接的分镜" — push this character's identity into every downstream
  // generation node, NON-DESTRUCTIVELY: a reference image / IPAdapter the user
  // already set is preserved; only blank fields are filled. comfyui_image gets
  // IPAdapter face-lock (via deriveCharacterConditioning) + character LoRA; others
  // get the face reference image when they have none.
  const batchUpdateNodeData = useCanvasStore((s) => s.batchUpdateNodeData);
  const buildShotPatch = useCallback((nt: string, tp: Record<string, unknown>, refs: string[], loraName?: string): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    const addLora = () => {
      if (!loraName) return;
      const loras = (tp.loras as { name: string; strengthModel: number }[] | undefined) ?? [];
      if (!loras.some((l) => l.name === loraName)) p.loras = [...loras, { name: loraName, strengthModel: payload.loraStrength ?? 0.8 }];
    };
    const fillRefIfBlank = () => { if (refs[0] && !((tp.referenceImageUrl as string | undefined)?.trim())) p.referenceImageUrl = refs[0]; };
    // 一致性种子：设了就钉到所有支持 seed 的下游生成节点（权威覆盖——锁种子的本意就是
    // 让同角色跨镜头用同一随机种子；未支持 seed 的节点忽略该字段，无副作用）。
    const cs = payload.consistencySeed;
    if (typeof cs === "number" && Number.isFinite(cs) && ["image_gen", "storyboard", "comfyui_image", "comfyui_video", "video_task"].includes(nt)) {
      if ((tp.seed as number | undefined) !== cs) p.seed = cs;
    }
    if (nt === "comfyui_image") {
      // Identity via IPAdapter + LoRA only — do NOT set referenceImageUrl (that's the
      // img2img/inpaint source; setting it would unintentionally turn a txt2img into img2img).
      const cond = deriveCharacterConditioning(payload, { ipadapter: tp.ipadapter as never, loras: tp.loras as never });
      if (cond.ipadapter) p.ipadapter = cond.ipadapter; // fill-only-when-blank inside
      if (cond.loras) p.loras = cond.loras;
    } else if (nt === "comfyui_video") {
      fillRefIfBlank();
      addLora();
    } else if (nt === "image_gen" || nt === "storyboard" || nt === "video_task") {
      fillRefIfBlank();
    }
    return p;
  }, [payload]);

  // Apply this character's identity to its shots. `wholeScene`: also reach every
  // shot sharing a sceneGroup with any directly-connected shot (agent-planned
  // scenes stamp `sceneGroup` on nodes), so one click covers the whole scene.
  const applyToConnectedShots = useCallback((wholeScene = false) => {
    const st = useCanvasStore.getState();
    // 场景 (scene) nodes contribute location TEXT only (via prompt injection) — their
    // image is a backdrop, never a face/identity reference, so don't push it into any
    // downstream referenceImageUrl/LoRA. Consistent with connectedCharacterRefImages.
    const isScene = (payload.characterKind ?? "person") === "scene";
    const refs = isScene ? [] : characterReferenceImages(payload);
    const loraName = isScene ? undefined : payload.loraName?.trim();
    const directTargetIds = new Set(st.edges.filter((e) => e.source === id).map((e) => e.target));
    const targetIds = new Set(directTargetIds);
    if (wholeScene) {
      const sceneKeys = new Set<string>();
      for (const t of st.nodes) {
        if (!directTargetIds.has(t.id)) continue;
        const sg = (t.data.payload as { sceneGroup?: string }).sceneGroup?.trim();
        if (sg) sceneKeys.add(sg);
      }
      if (sceneKeys.size > 0) {
        for (const n of st.nodes) {
          const sg = (n.data.payload as { sceneGroup?: string }).sceneGroup?.trim();
          if (sg && sceneKeys.has(sg)) targetIds.add(n.id);
        }
      }
    }
    const updates: { id: string; payload: Record<string, unknown> }[] = [];
    for (const t of st.nodes) {
      if (!targetIds.has(t.id)) continue;
      const p = buildShotPatch(t.data.nodeType, (t.data.payload ?? {}) as Record<string, unknown>, refs, loraName);
      if (Object.keys(p).length > 0) updates.push({ id: t.id, payload: p });
    }
    if (updates.length > 0) { batchUpdateNodeData(updates); toast.success(`角色已套用到 ${updates.length} 个${wholeScene ? "本场景" : "连接的"}节点`); }
    else if (isScene) toast.info("场景节点的描述会在生成时自动注入提示词，无需手动套用参考图");
    else toast.info(wholeScene ? "未找到本场景的镜头（场景信息由智能体规划时生成）" : "没有可套用的连接节点（先把本角色连到生成/分镜节点）");
  }, [id, payload, batchUpdateNodeData, buildShotPatch]);

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { referenceImageUrl: result.url, referenceStorageKey: result.storageKey });
      setUploading(false);
      toast.success("参考图已上传");
    },
    onError: (err) => { setUploading(false); toast.error("上传失败：" + err.message); },
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("图片不能超过 16MB"); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Tag selector helper
  const TagPicker = ({ label, options, value, onChange }: {
    label: string;
    options: string[];
    value?: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(value === opt ? undefined : opt)}
            className="nodrag px-2 py-0.5 rounded text-[10px] transition-all"
            style={{
              background: value === opt ? accentA(0.15) : "var(--c-input)",
              border: `1px solid ${value === opt ? accentA(0.4) : "var(--c-bd2)"}`,
              color: value === opt ? accent : "var(--c-t3)",
              cursor: "pointer",
              fontWeight: value === opt ? 600 : 400,
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

  // #76 批3：hover 主图操作带 + 从库替换。库条目 payload 为角色快照，整包写回；
  // characterKind 以库条目为准；storageKey 清空避免误关联旧上传。
  const [libPickerOpen, setLibPickerOpen] = useState(false);
  const libQuery = trpc.characterLibrary.list.useQuery(undefined, { enabled: libPickerOpen });
  const replaceFromLibrary = useCallback((entry: { name: string; characterKind: string; payload: Record<string, unknown> }) => {
    updateNodeData(id, { ...entry.payload, characterKind: entry.characterKind as CharacterKind, referenceStorageKey: undefined });
    setLibPickerOpen(false);
    toast.success(`已替换为「${entry.name}」（库快照整包写回）`);
  }, [id, updateNodeData]);

  // #76 批2：多视角缩略条——主图 + 备用视角横排；点击备用图与主图互换（保持
  // referenceImageUrl=正面/主视角、additionalImageUrls=其余 的既有语义，下游条件化不变）。
  const extraViews = (payload.additionalImageUrls ?? []).map((u) => (u ?? "").trim()).filter(Boolean);
  const swapView = useCallback((idx: number) => {
    const st = useCanvasStore.getState();
    const pl = st.nodes.find((n) => n.id === id)?.data.payload as CharacterNodeData | undefined;
    const extras = (pl?.additionalImageUrls ?? []).map((u) => (u ?? "").trim()).filter(Boolean);
    const cur = pl?.referenceImageUrl?.trim();
    const next = extras[idx];
    if (!next || !cur) return;
    extras[idx] = cur;
    st.updateNodeData(id, { referenceImageUrl: next, referenceStorageKey: undefined, additionalImageUrls: extras });
  }, [id]);
  const removeView = useCallback((idx: number) => {
    const st = useCanvasStore.getState();
    const pl = st.nodes.find((n) => n.id === id)?.data.payload as CharacterNodeData | undefined;
    const extras = (pl?.additionalImageUrls ?? []).map((u) => (u ?? "").trim()).filter(Boolean);
    extras.splice(idx, 1);
    st.updateNodeData(id, { additionalImageUrls: extras });
  }, [id]);
  const openViewLightbox = useCallback((startIdx: number) => {
    const all = [payload.referenceImageUrl?.trim(), ...extraViews].filter((u): u is string => !!u);
    if (all.length) useLightbox.getState().open(all, Math.min(startIdx, all.length - 1), "image", data.title, id);
  }, [payload.referenceImageUrl, extraViews, data.title, id]);

  // #133：角色库下拉（从库整包替换）——hero hover 带与空态引导卡共用同一份 JSX。
  const libPickerDropdown = (
    <div className="nowheel" style={{ width: 210, maxHeight: 240, overflowY: "auto", padding: 6, borderRadius: 10, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 10px 30px oklch(0 0 0 / 0.5)", display: "flex", flexDirection: "column", gap: 3 }}>
      {libQuery.isLoading && <span style={{ fontSize: 10.5, color: "var(--c-t4)", padding: 6 }}>加载角色库…</span>}
      {!libQuery.isLoading && (libQuery.data ?? []).length === 0 && <span style={{ fontSize: 10.5, color: "var(--c-t4)", padding: 6 }}>角色库为空——先「存库」积累角色</span>}
      {(libQuery.data ?? []).map((it) => (
        <button key={it.id} onClick={(e) => { e.stopPropagation(); replaceFromLibrary(it as never); }}
          title={`替换为「${it.name}」`}
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 6px", borderRadius: 7, border: "1px solid var(--c-bd1)", background: "var(--c-surface)", cursor: "pointer", textAlign: "left" }}>
          {it.thumbnail
            ? <img src={it.thumbnail.startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent(it.thumbnail)}` : it.thumbnail} alt="" style={{ width: 26, height: 26, objectFit: "cover", borderRadius: 5, flexShrink: 0 }} />
            : <span style={{ width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 5, background: "var(--c-input)", flexShrink: 0 }}>{it.characterKind === "scene" ? <Mountain style={{ width: 13, height: 13, color: "var(--c-t4)" }} /> : <User style={{ width: 13, height: 13, color: "var(--c-t4)" }} />}</span>}
          <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: "var(--c-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</span>
          <span style={{ fontSize: 9, color: "var(--c-t4)", flexShrink: 0 }}>{it.characterKind === "scene" ? "场景" : "人物"}</span>
        </button>
      ))}
    </div>
  );

  // #76 批1：LibTV 角色卡——hero 底部姓名/身份渐变标签条（双击就地改名）
  const displayName = ((kind === "scene" ? payload.sceneName : payload.name) ?? "").trim();
  const commitName = (v: string) => { update(kind === "scene" ? "sceneName" : "name", v.trim()); setNameEditing(false); };
  const nameBar = (
    <div
      ref={nameBarRef}
      className="nodrag absolute left-0 right-0 bottom-0 z-10 flex items-center"
      onClick={onNameBarClick}
      onDoubleClick={(e) => e.stopPropagation()}
      title="双击改名"
      // #82 底部留白 18px：「人物」标签 / 种子 chip 抬离底边中央连线桩点的热区（原 8px 时
      // chips 与 handle 几乎贴在同一水平带上，点标签极易误触拖出连线）。
      style={{ padding: "18px 12px 18px", gap: 6, background: "linear-gradient(transparent, oklch(0 0 0 / 0.74))", cursor: "text" }}
    >
      {nameEditing ? (
        <input
          autoFocus
          defaultValue={displayName}
          placeholder={kind === "scene" ? "场景名…" : "角色名…"}
          onBlur={(e) => commitName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commitName((e.target as HTMLInputElement).value); if (e.key === "Escape") setNameEditing(false); }}
          onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, minWidth: 0, height: 24, padding: "0 8px", borderRadius: 6, fontSize: 12.5, fontWeight: 700, background: "oklch(0 0 0 / 0.5)", border: `1px solid ${accentA(0.5)}`, color: "#fff", outline: "none" }}
        />
      ) : (
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "#fff", textShadow: "0 1px 4px oklch(0 0 0 / 0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {displayName || (kind === "scene" ? "未命名场景" : "未命名角色")}
        </span>
      )}
      {/* 类别按钮：点击直接在 人物↔场景 间切换（此前是纯标签，点击会冒泡到姓名条触发改名，
          看起来就是「按不到」）。pointerDown 一并阻断，避免节点选中/拖拽抢事件。 */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); update("characterKind", kind === "scene" ? "person" : "scene"); }}
        title={kind === "scene" ? "当前：场景（点击切换为人物）" : "当前：人物（点击切换为场景）"}
        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, height: 18, padding: "0 8px", borderRadius: 9, fontSize: 9.5, fontWeight: 700, lineHeight: 1, background: accentA(0.28), border: `1px solid ${accentA(0.5)}`, color: "#fff", cursor: "pointer" }}
      >
        {kind === "scene" ? "场景" : "人物"}
      </button>
      {/* #76 批3：一致性种子快捷位——未锁=随机锁定；已锁=显示短码，再点重掷（表单里可解锁/精调）。
          与类别按钮同高同字号（此前 padding/字号不一致导致两枚 chip 大小不齐）。 */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); update("consistencySeed", Math.floor(Math.random() * 2_147_483_647)); }}
        title={payload.consistencySeed != null ? `一致性种子已锁定 #${payload.consistencySeed}（点击重掷；解锁在资料面板）` : "随机锁定一致性种子（应用到分镜时钉到全部镜头）"}
        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, height: 18, padding: "0 7px", borderRadius: 9, fontSize: 9.5, fontWeight: 700, lineHeight: 1, background: payload.consistencySeed != null ? accentA(0.45) : "oklch(0 0 0 / 0.45)", border: `1px solid ${payload.consistencySeed != null ? accentA(0.7) : "var(--c-bd3)"}`, color: "#fff", cursor: "pointer" }}
      >
        <Dices style={{ width: 10, height: 10, flexShrink: 0 }} />
        {payload.consistencySeed != null ? `#${String(payload.consistencySeed).slice(0, 6)}` : "种子"}
      </button>
    </div>
  );

  // #76 批2：多视角缩略条（仅创意模式、有主图且有备用视角时显示）。
  // 首格=当前主图（高亮不可点），其余=备用视角：点击设为主图（互换）、hover 放大/下载/删除。
  const VIEW_LABELS = ["正面", "侧面", "背面"];
  const viewStrip = isCreativeMode && payload.referenceImageUrl && extraViews.length > 0 ? (
    <div className="nodrag flex items-center" style={{ gap: 4, padding: "5px 6px", background: "oklch(0.13 0.01 285)", borderTop: "1px solid var(--c-bd1)", overflowX: "auto" }}>
      {[payload.referenceImageUrl, ...extraViews].map((u, i) => (
        <div key={`${i}-${u.slice(-24)}`} className="group/view relative flex-shrink-0"
          title={i === 0 ? `主图（${VIEW_LABELS[0]}）` : `点击设为主图${i < VIEW_LABELS.length ? `（${VIEW_LABELS[i]}）` : ""}`}
          onClick={(e) => { e.stopPropagation(); if (i > 0) swapView(i - 1); }}
          style={{ width: 44, height: 44, borderRadius: 7, overflow: "hidden", cursor: i === 0 ? "default" : "pointer", border: `2px solid ${i === 0 ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, opacity: i === 0 ? 1 : 0.85 }}>
          <img src={u.startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent(u)}` : u} alt={`视角${i}`} draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <div className="absolute inset-0 items-end justify-center gap-0.5 hidden group-hover/view:flex" style={{ background: "oklch(0 0 0 / 0.35)", paddingBottom: 2 }}>
            <button title="放大预览" onClick={(e) => { e.stopPropagation(); openViewLightbox(i); }}
              style={{ width: 15, height: 15, padding: 0, borderRadius: 4, border: "none", background: "oklch(0 0 0 / 0.65)", color: "#fff", cursor: "pointer", fontSize: 9, lineHeight: "15px" }}>⛶</button>
            <button title="下载" onClick={(e) => { e.stopPropagation(); void downloadMedia(u, `character-view-${i}.png`); }}
              style={{ width: 15, height: 15, padding: 0, borderRadius: 4, border: "none", background: "oklch(0 0 0 / 0.65)", color: "#fff", cursor: "pointer", fontSize: 9, lineHeight: "15px" }}>⤓</button>
            {i > 0 && (
              <button title="删除该视角" onClick={(e) => { e.stopPropagation(); removeView(i - 1); }}
                style={{ width: 15, height: 15, padding: 0, borderRadius: 4, border: "none", background: "oklch(0.4 0.16 25 / 0.9)", color: "#fff", cursor: "pointer", fontSize: 9, lineHeight: "15px" }}>×</button>
            )}
          </div>
        </div>
      ))}
      <span style={{ fontSize: 9.5, color: "var(--c-t4)", paddingLeft: 2, whiteSpace: "nowrap" }}>{extraViews.length + 1} 视图</span>
    </div>
  ) : null;

  const heroMedia = payload.referenceImageUrl ? (
    <div style={{ width: "100%" }}>
    <div className="group/chero relative" style={{ width: "100%" }}>
      {/* #74：随预览自适应——按原图比例铺满宽度，框体高度跟随图片（resizable 可再拉大） */}
      <MediaImage
        src={payload.referenceImageUrl}
        alt="参考图"
        style={{ width: "100%", height: "auto", display: "block" }}
        draggable={false}
      />
      {isOwnStorageUrl(payload.referenceImageUrl) && (
        <div title="已存储到 MinIO·长期有效" className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
          style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }} />
      )}
      {/* #76 批3：hover 主图操作带（仅创意模式）——存库 / 从库替换 / 应用到分镜 */}
      {isCreativeMode && (
        <div className="nodrag absolute top-1.5 right-1.5 z-10 flex-col items-end gap-1 hidden group-hover/chero:flex" style={{ display: undefined }}>
          <div className="flex items-center gap-1 opacity-0 group-hover/chero:opacity-100" style={{ transition: "opacity 150ms ease" }}>
            {([
              { key: "save", label: "存库", title: "保存到角色库（跨项目复用）", onClick: () => saveToLibrary() },
              { key: "lib", label: "从库替换", title: "从角色库选择条目整包替换本节点", onClick: () => setLibPickerOpen((v) => !v) },
              { key: "apply", label: "应用到分镜", title: "把本角色的参考/LoRA/种子套用到所有连接的生成/分镜节点", onClick: () => applyToConnectedShots(false) },
            ] as const).map((b) => (
              <button key={b.key} title={b.title} onClick={(e) => { e.stopPropagation(); b.onClick(); }}
                style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 7, border: "1px solid var(--c-bd3)", background: "oklch(0.08 0.006 260 / 0.85)", color: "var(--c-t1)", cursor: "pointer", whiteSpace: "nowrap", backdropFilter: "blur(6px)" }}>
                {b.label}
              </button>
            ))}
          </div>
{libPickerOpen && libPickerDropdown}
        </div>
      )}
      {/* 姓名条仅创意模式——studio 选中态 hero 可见（CSS 只藏未选中态），不得漏入 */}
      {isCreativeMode && nameBar}
    </div>
    {viewStrip}
    </div>
  ) : (() => {
    // 无参考图：用紧凑摘要卡作折叠预览（角色/场景关键字段），使节点收缩后高度与提示词
    // 节点相当，而不是被 minHeight 撑高、依旧显示整张表单。
    const bits = [payload.role, payload.appearance, payload.outfit, payload.locationType, payload.atmosphere, payload.sceneDescription]
      .map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
    // 非创意（studio 选中态会渲染 hero）：维持旧摘要卡口径，空则不渲染
    if (!isCreativeMode) {
      if (bits.length === 0) return null;
      return (
        <div style={{ padding: "9px 14px 11px", display: "flex", flexDirection: "column", gap: 3, textAlign: "left" }}>
          {bits.slice(0, 3).map((b, i) => (
            <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: i === 0 ? "var(--c-t2)" : "var(--c-t3)", fontWeight: i === 0 ? 600 : 400, display: "-webkit-box", WebkitLineClamp: i === 0 ? 1 : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{b}</div>
          ))}
        </div>
      );
    }
    // #76 批1 → #133 升级：LibTV 式空态引导卡——无主图时常驻显示剪影 + 两个直达入口
    //（上传主图 / 从角色库选），不再塌成一条光杆标题栏；已填字段以摘要行带出。
    return (
      <div style={{ position: "relative", padding: "18px 14px 44px", display: "flex", flexDirection: "column", alignItems: "center", gap: 7, textAlign: "center", background: "linear-gradient(oklch(0.2 0.015 285 / 0.35), transparent)" }}>
        {bits.length === 0 && (<>
          {kind === "scene"
            ? <Mountain style={{ width: 30, height: 30, color: "var(--c-t4)", opacity: 0.7 }} />
            : <User style={{ width: 30, height: 30, color: "var(--c-t4)", opacity: 0.7 }} />}
          <div className="nodrag flex items-center justify-center" style={{ gap: 6 }}>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              disabled={uploading}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 11px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: accentA(0.16), border: `1px solid ${accentA(0.45)}`, color: accent, cursor: uploading ? "wait" : "pointer" }}>
              <Upload style={{ width: 11, height: 11 }} /> {uploading ? "上传中…" : "上传主图"}
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setLibPickerOpen((v) => !v); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 11px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
              <Users style={{ width: 11, height: 11 }} /> 从角色库选
            </button>
          </div>
          <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>也可直接拖入图片，或选中后用「多视角」生成</span>
          {libPickerOpen && <div className="nodrag" style={{ display: "flex", justifyContent: "center" }}>{libPickerDropdown}</div>}
        </>)}
        {bits.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, textAlign: "left", width: "100%", marginTop: 2 }}>
            {bits.slice(0, 3).map((b, i) => (
              <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: i === 0 ? "var(--c-t2)" : "var(--c-t3)", fontWeight: i === 0 ? 600 : 400, display: "-webkit-box", WebkitLineClamp: i === 0 ? 1 : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{b}</div>
            ))}
          </div>
        )}
        {nameBar}
      </div>
    );
  })();

  // #76 批1：完整资料表单（单一来源）——工作室/专业渲染在卡体内；创意模式渲染在
  // 输入条下方的浮动资料面板里（卡体保持纯「角色卡」形态）。
  const formBody = (
    <>
        {/* Kind toggle */}
        <div
          className="flex gap-0.5 p-0.5 rounded-lg"
          style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}
        >
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => update("characterKind", k.id)}
              className="nodrag flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: kind === k.id ? accentA(0.18) : "transparent",
                border: `1px solid ${kind === k.id ? accentA(0.40) : "transparent"}`,
                color: kind === k.id ? accent : "var(--c-t3)",
                cursor: "pointer",
              }}
            >
              {k.icon}
              {k.label}
            </button>
          ))}
        </div>

        {/* ── Reference image ── */}
        <div>
          <label style={labelStyle}>参考图</label>
          {payload.referenceImageUrl ? (
            <div className="relative rounded-lg overflow-hidden" style={{ border: `1px solid ${accentA(0.3)}`, width: "fit-content", maxWidth: "100%", marginInline: "auto" }}>
              <ZoomableImage src={payload.referenceImageUrl} alt="参考图" maxHeight={200} radius={0} />
              {isOwnStorageUrl(payload.referenceImageUrl) && (
                <div title="已存储到 MinIO·长期有效" className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
                  style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }} />
              )}
              <div className="absolute top-1.5 right-1.5 flex gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="nodrag p-1 rounded transition-all"
                  style={{ background: "oklch(0.08 0.006 260 / 0.85)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)", cursor: uploading ? "not-allowed" : "pointer" }}
                  title="替换图片"
                >
                  <Upload style={{ width: 11, height: 11 }} />
                </button>
                <button
                  onClick={() => updateNodeData(id, { referenceImageUrl: undefined, referenceStorageKey: undefined })}
                  disabled={uploading}
                  className="nodrag p-1 rounded transition-all"
                  style={{ background: "oklch(0.08 0.006 260 / 0.85)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)", cursor: uploading ? "not-allowed" : "pointer" }}
                  title="清除图片"
                >
                  <X style={{ width: 11, height: 11 }} />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="nodrag flex items-center justify-center gap-2 w-full py-4 rounded-lg transition-all"
              style={{
                background: accentA(0.05),
                border: `1.5px dashed ${accentA(0.30)}`,
                color: "var(--c-t3)",
                cursor: uploading ? "not-allowed" : "pointer",
              }}
            >
              {uploading
                ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
                : <ImageIcon style={{ width: 16, height: 16 }} />}
              <span style={{ fontSize: 11 }}>{uploading ? "上传中..." : "上传参考图（可选）"}</span>
            </button>
          )}
          {kind === "person" && (
            <button
              onClick={handleMultiAngle}
              disabled={multiAngleBusy}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10.5px] font-medium transition-all"
              style={{ marginTop: 6, background: accentA(0.10), border: `1px solid ${accentA(0.32)}`, color: accent, cursor: multiAngleBusy ? "not-allowed" : "pointer" }}
              title="用角色描述（+已有参考图）生成正面/侧面/背面三视图，写入主参考图与备用视角"
            >
              {multiAngleBusy ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <Sparkles style={{ width: 11, height: 11 }} />}
              {multiAngleBusy ? "生成多视角中…" : "一键多视角（三视图参考）"}
            </button>
          )}
          {kind === "person" && (
            <button
              onClick={(e) => { e.stopPropagation(); setPosePickerOpen(true); }}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10.5px] font-medium transition-all"
              style={{ marginTop: 4, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
              title="从导演台姿势库挑一个 3D 姿势，截图作为该角色的姿势参考视角（追加到备用视角）"
            >
              🕺 姿势库（3D 摆姿作参考视角）
            </button>
          )}
          {/* #73 纳管：三视图生成模型选择 + 计价（此前隐形走服务端默认模型） */}
          <div className="nodrag flex items-center gap-2" style={{ marginTop: 4 }}>
            <ModelPicker value={maModel} onChange={pickMaModel} options={maOptionsResolved} minWidth={150} />
            <ComfyCkptSelect enabled={maModel === COMFY_LOCAL_MODEL} width={140} />
            <span style={{ fontSize: 9.5, color: "var(--c-t4)", whiteSpace: "nowrap" }} title="三视图为单张大图，计一次生成">预计：{maCost}</span>
          </div>
        </div>

        {/* ── 人物 (Person) fields ── */}
        {kind === "person" && (
          <>
            <div className="flex gap-2">
              <div className="flex-1">
                <label style={labelStyle}>姓名</label>
                <NodeInput
                  type="text"
                  placeholder="角色姓名"
                  value={payload.name ?? ""}
                  onValueChange={(v) => update("name", v)}
                  className="nodrag"
                  style={fieldStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
              <div style={{ width: 100 }}>
                <label style={labelStyle}>性别</label>
                <select
                  value={payload.gender ?? ""}
                  onChange={(e) => update("gender", e.target.value)}
                  className="nodrag"
                  style={{ ...fieldStyle, cursor: "pointer" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                >
                  <option value="">不限</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                  <option value="中性">中性</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label style={labelStyle}>职业 / 角色定位</label>
                <NodeInput
                  type="text"
                  placeholder="主角、侦探、教授..."
                  value={payload.role ?? ""}
                  onValueChange={(v) => update("role", v)}
                  className="nodrag"
                  style={fieldStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
              <div style={{ width: 80 }}>
                <label style={labelStyle}>年龄</label>
                <NodeInput
                  type="text"
                  placeholder="25岁"
                  value={payload.age ?? ""}
                  onValueChange={(v) => update("age", v)}
                  className="nodrag"
                  style={fieldStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
            </div>
            <div>
              <label style={labelStyle}>外貌特征</label>
              <NodeTextArea className="nodrag nowheel"
                placeholder="身高、发色、眼神、服装风格..."
                value={payload.appearance ?? ""}
                onValueChange={(v) => update("appearance", v)}
                rows={2}

                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            <div>
              <label style={labelStyle}>性格特征</label>
              <NodeTextArea className="nodrag nowheel"
                placeholder="开朗、内敛、冷静、热情..."
                value={payload.personality ?? ""}
                onValueChange={(v) => update("personality", v)}
                rows={2}

                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            {/* ── New: outfit & signature (Character Bible essentials) ── */}
            <div>
              <label style={labelStyle}>服装 (Outfit)</label>
              <NodeTextArea className="nodrag nowheel"
                placeholder="黑色西装 + 红色领带 / 米色风衣 + 牛仔裤..."
                value={payload.outfit ?? ""}
                onValueChange={(v) => update("outfit", v)}
                rows={2}
                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            <div>
              <label style={labelStyle}>标志性 / 特征物件</label>
              <NodeInput
                type="text"
                placeholder="银怀表、左眼疤痕、铜色头发、墨镜..."
                value={payload.signature ?? ""}
                onValueChange={(v) => update("signature", v)}
                className="nodrag"
                style={fieldStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
          </>
        )}

        {/* ── 场景 (Scene) fields ── */}
        {kind === "scene" && (
          <>
            <div>
              <label style={labelStyle}>场景名称</label>
              <NodeInput
                type="text"
                placeholder="废弃工厂、霓虹都市、古代宫廷..."
                value={payload.sceneName ?? ""}
                onValueChange={(v) => update("sceneName", v)}
                className="nodrag"
                style={fieldStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            <TagPicker
              label="地点类型"
              options={LOCATION_TYPES}
              value={payload.locationType}
              onChange={(v) => update("locationType", v)}
            />
            <TagPicker
              label="时间"
              options={TIME_OF_DAY}
              value={payload.timeOfDay}
              onChange={(v) => update("timeOfDay", v)}
            />
            <TagPicker
              label="氛围"
              options={ATMOSPHERES}
              value={payload.atmosphere}
              onChange={(v) => update("atmosphere", v)}
            />
            <div>
              <label style={labelStyle}>场景描述</label>
              <NodeTextArea className="nodrag nowheel"
                placeholder="详细描述场景的视觉元素、光线、质感..."
                value={payload.sceneDescription ?? ""}
                onValueChange={(v) => update("sceneDescription", v)}
                rows={3}

                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
          </>
        )}

        {/* ── Additional reference images (multi-view) ──
            Up to 4 alternate views for better identity preservation. They're
            stored for forward compatibility with multi-image conditioning;
            downstream nodes consume only the primary referenceImageUrl today. */}
        {selected && (
          <AdditionalImagesSection
            urls={payload.additionalImageUrls ?? []}
            onChange={(urls) => update("additionalImageUrls", urls.length > 0 ? urls : undefined)}
            accent={accent}
          />
        )}

        {/* ── 角色携带的音频 / 视频参考（@音频 / @视频，供数字人 / omni 模型）──
            urls[0]→referenceXxxUrl（主项），其余→additionalXxxUrls。库 payload 存任意字段，无需迁移。 */}
        {selected && (
          <MediaRefsSection
            kind="audio"
            urls={[payload.referenceAudioUrl, ...(payload.additionalAudioUrls ?? [])].filter((u): u is string => !!u)}
            onChange={(urls) => updateNodeData(id, { referenceAudioUrl: urls[0], additionalAudioUrls: urls.length > 1 ? urls.slice(1) : undefined })}
            accent={accent}
          />
        )}
        {selected && (
          <MediaRefsSection
            kind="video"
            urls={[payload.referenceVideoUrl, ...(payload.additionalVideoUrls ?? [])].filter((u): u is string => !!u)}
            onChange={(urls) => updateNodeData(id, { referenceVideoUrl: urls[0], additionalVideoUrls: urls.length > 1 ? urls.slice(1) : undefined })}
            accent={accent}
          />
        )}

        {/* AI 识别：依据参考图（含备用视角）分析并填充角色/场景参数（弹窗勾选后应用） */}
        {selected && (
          <div className="flex flex-col gap-1.5">
            <div className="nodrag" onPointerDown={(e) => e.stopPropagation()}>
              <LLMModelPicker value={recognizeModel} onChange={setRecognizeModel} disabled={recognizeMut.isPending} filter={(m) => !!m.vision || m.provider === "SelfHosted"} />
            </div>
            <button
              onClick={handleRecognize}
              disabled={recognizeMut.isPending || characterReferenceImages(payload).length === 0}
              className="nodrag flex items-center justify-center gap-1.5 w-full rounded-lg text-[11px] font-medium transition-all"
              style={{
                padding: "7px 10px",
                background: characterReferenceImages(payload).length === 0 ? "var(--c-input)" : "oklch(0.68 0.18 300 / 0.12)",
                border: `1px solid ${characterReferenceImages(payload).length === 0 ? "var(--c-bd2)" : "oklch(0.68 0.18 300 / 0.4)"}`,
                color: characterReferenceImages(payload).length === 0 ? "var(--c-t4)" : "oklch(0.72 0.16 300)",
                cursor: recognizeMut.isPending || characterReferenceImages(payload).length === 0 ? "not-allowed" : "pointer",
              }}
              title={kind === "scene" ? "AI 依据参考图识别场景设定" : "AI 依据参考图识别人物设定"}
            >
              {recognizeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {recognizeMut.isPending ? "识别中…" : (kind === "scene" ? "AI 识别场景" : "AI 识别人物")}
            </button>
          </div>
        )}

        {/* ── ComfyUI identity lock (IPAdapter face-lock + character LoRA) ──
            Connecting this character upstream of a ComfyUI 图像 node auto-fills its
            IPAdapter with the reference image(s) (face-lock) + adds the LoRA. The
            button below force-applies to every connected node at once. */}
        {selected && (
          <div className="nodrag" style={{ marginTop: 10, padding: "9px 10px", borderRadius: 8, background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t2)", marginBottom: 6 }}>ComfyUI 身份锁定（IPAdapter + 角色 LoRA）</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>角色 LoRA 文件（可选）</label>
                <NodeInput value={payload.loraName ?? ""} placeholder="character_xxx.safetensors"
                  onValueChange={(v: string) => update("loraName", v.trim() || undefined)} />
              </div>
              <div style={{ width: 78 }}>
                <label style={labelStyle}>LoRA 强度</label>
                <NodeInput value={String(payload.loraStrength ?? "")} placeholder="0.8"
                  onValueChange={(v: string) => { const n = parseFloat(v); update("loraStrength", Number.isFinite(n) ? n : undefined); }} />
              </div>
              <div style={{ width: 78 }}>
                <label style={labelStyle}>人脸强度</label>
                <NodeInput value={String(payload.ipadapterWeight ?? "")} placeholder="0.8"
                  onValueChange={(v: string) => { const n = parseFloat(v); update("ipadapterWeight", Number.isFinite(n) ? n : undefined); }} />
              </div>
            </div>
            {/* 一致性种子：设了就在「应用到分镜」时把同一 seed 钉到该角色所有下游生成节点 */}
            <div className="flex items-center gap-1.5">
              <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }} title="同一角色跨镜头用相同随机种子 → 最大化一致性。应用到分镜时一并下发。">一致性种子</label>
              <NodeInput value={String(payload.consistencySeed ?? "")} placeholder="未锁定（各镜头随机）"
                onValueChange={(v: string) => { const n = parseInt(v, 10); update("consistencySeed", Number.isFinite(n) ? n : undefined); }} />
              <button onClick={() => update("consistencySeed", Math.floor(Math.random() * 2_147_483_647))} className="nodrag flex items-center justify-center rounded-lg"
                title="随机一个种子并锁定" style={{ width: 28, height: 28, flexShrink: 0, background: accentA(0.14), border: `1px solid ${accentA(0.4)}`, color: accent, cursor: "pointer" }}>
                <Dices className="w-3.5 h-3.5" />
              </button>
              {payload.consistencySeed != null && (
                <button onClick={() => update("consistencySeed", undefined)} className="nodrag flex items-center justify-center rounded-lg"
                  title="解除锁定" style={{ width: 28, height: 28, flexShrink: 0, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => applyToConnectedShots(false)} className="nodrag flex items-center justify-center gap-1.5 flex-1 py-1.5 rounded-lg transition-all"
                style={{ fontSize: 11.5, fontWeight: 600, background: accentA(0.16), border: `1px solid ${accentA(0.4)}`, color: accent, cursor: "pointer" }}
                title="把本角色的人脸参考 + LoRA 套用到所有连接的生成/分镜节点（comfyui_image 走 IPAdapter）">
                <User className="w-3.5 h-3.5" /> 应用到连接的分镜
              </button>
              <button onClick={() => applyToConnectedShots(true)} className="nodrag flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg transition-all whitespace-nowrap"
                style={{ fontSize: 11, fontWeight: 600, background: "transparent", border: `1px solid ${accentA(0.4)}`, color: accent, cursor: "pointer" }}
                title="套用到与已连接镜头同属一个场景的全部镜头（场景信息由智能体规划时生成）">
                本场景
              </button>
            </div>
            <button onClick={saveToLibrary} disabled={saveLibMut.isPending}
              className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg transition-all mt-1.5"
              style={{ fontSize: 11, fontWeight: 600, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: saveLibMut.isPending ? "wait" : "pointer" }}
              title="把本角色保存到全局角色库，跨项目快速复用">
              <Save className="w-3.5 h-3.5" /> 保存到角色库
            </button>
            <div style={{ fontSize: 9, color: "var(--c-t4)", marginTop: 5, lineHeight: 1.4 }}>
              连到 ComfyUI 图像节点会自动填 IPAdapter 人脸参考（需在该节点选 IPAdapter 模型；服务端仅 SD 体系支持 IPAdapter，Flux/SD3 走参考图/提示词）。
            </div>
          </div>
        )}

        {/* ── Live prompt preview + customizable template ──
            Shows exactly what gets injected into downstream nodes. Users who
            want fine-grained control can override the default template with
            their own placeholder string. */}
        {selected && (
          <PromptPreviewSection
            payload={payload}
            onChange={(template) => update("customPromptTemplate", template || undefined)}
          />
        )}

        {/* ── Character Consistency Validator ──
            Surface only when at least 2 downstream storyboards have generated
            images. Calls a vision LLM (claude-sonnet-4-6) to score
            facial/hairstyle/outfit/age/signature consistency. */}
        {selected && (
          <div>
            <button
              onClick={handleCheckConsistency}
              disabled={!canCheck || consistencyMut.isPending}
              className="nodrag flex items-center justify-center gap-2 w-full py-2 rounded-lg transition-all"
              style={{
                background: canCheck && !consistencyMut.isPending ? accentA(0.18) : "var(--c-input)",
                border: `1px solid ${canCheck && !consistencyMut.isPending ? accentA(0.45) : "var(--c-bd2)"}`,
                color: canCheck && !consistencyMut.isPending ? accent : "var(--c-t4)",
                cursor: canCheck && !consistencyMut.isPending ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 600,
              }}
              title={canCheck
                ? `检查 ${connectedStoryboards.length} 个分镜的视觉一致性`
                : "请先把此角色连接到至少 2 个已生成图像的分镜节点"}
            >
              {consistencyMut.isPending ? (
                <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
              ) : (
                <Search style={{ width: 13, height: 13 }} />
              )}
              {consistencyMut.isPending
                ? "AI 审查中…"
                : canCheck
                  ? `🔍 检查一致性（${connectedStoryboards.length} 个分镜）`
                  : "🔍 检查一致性（需 ≥2 个分镜）"}
            </button>
            {!canCheck && (
              <p style={{ margin: "6px 0 0", fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5 }}>
                把此角色节点连接到多个 storyboard 分镜并生成图像，AI 会分析五官 / 发型 / 服装 / 年龄 / 标志性特征的连贯性
              </p>
            )}
          </div>
        )}

        {/* Notes (shared) */}
        {selected && (
          <div>
            <label style={labelStyle}>补充备注</label>
            <NodeTextArea className="nodrag nowheel"
              placeholder="其他需要记录的信息..."
              value={payload.notes ?? ""}
              onValueChange={(v) => update("notes", v)}
              rows={2}

              style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
              onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
            />
          </div>
        )}
    </>
  );

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="character" title={data.title} minHeight={isCreativeMode ? 72 : 160} resizable heroMedia={heroMedia} heroBareHeader={!!payload.referenceImageUrl?.trim()}
      onHeaderHoverChange={docks.onHeaderHoverChange}
      leftDock={
        <>
          {refStrip.strip}
          <PromptDock
            open={docks.promptOpen}
            text={charPromptText}
            label="角色提示词"
            note="注入下游提示词"
            accent={accent}
            onClose={() => docks.setPromptOpen(false)}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinPrompt}
          />
        </>
      }
      onAssetImageDrop={(urls) => updateNodeData(id, { referenceImageUrl: urls[0], referenceStorageKey: undefined, ...(urls.length > 1 ? { additionalImageUrls: urls.slice(1, 1 + MAX_ADDITIONAL_IMAGES) } : {}) })}>
      {consistencyOpen && consistencyResult && (
        <CharacterConsistencyPanel
          characterName={payload.name || payload.sceneName}
          sceneNodeIds={consistencyScenes.ids}
          imageUrls={consistencyScenes.urls}
          result={consistencyResult}
          onClose={() => setConsistencyOpen(false)}
        />
      )}
      {recognizeRows && (
        <CharacterRecognitionPanel
          kind={kind}
          rows={recognizeRows}
          onApply={(patch) => {
            if (Object.keys(patch).length > 0) { updateNodeData(id, patch); toast.success(`已填充 ${Object.keys(patch).length} 个字段`); }
            setRecognizeRows(null);
          }}
          onClose={() => setRecognizeRows(null)}
        />
      )}
      <div className="flex flex-col" style={isCreativeMode ? { padding: 0, gap: 0 } : { padding: 14, gap: 12 }}>
        {/* 隐藏文件输入常驻卡体（不随表单/浮层卸载）——创意态输入条「参考图」按钮仍可触发上传 */}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        {/* #76 批1：创意模式下表单不再进卡体（改挂输入条下浮动资料面板）；工作室/专业保持原样 */}
        {!isCreativeMode && formBody}
      </div>
    </BaseNode>
    {/* ── LibTV（创意模式）就地输入条：类别 / 参考图 / 识别 / 多视角 ‖ 姓名 / 高级 / 存库 ── */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={!!selected} width={500}>
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {KINDS.map((k) => (
            <ToolChip key={k.id} icon={k.icon} label={k.label} active={kind === k.id}
              onClick={() => update("characterKind", k.id)} title={`切换为${k.label}`} />
          ))}
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          <ToolChip icon={uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} label="参考图"
            onClick={() => fileInputRef.current?.click()} disabled={uploading} title="上传参考图（可拖入素材）" />
          <ToolChip icon={recognizeMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} label="识别"
            onClick={handleRecognize} disabled={recognizeMut.isPending} title="AI 看图识别，自动填充外貌/服装等字段" />
          <ToolChip icon={multiAngleBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} label="多视角"
            onClick={() => void handleMultiAngle()} disabled={multiAngleBusy} title="一键多视角（三视图参考，强化跨镜一致性）" />
          {/* #133 批C：高频操作一级化——姿势库 / 应用到分镜 从 hover 带提为输入条常驻 chip */}
          <ToolChip icon={<PersonStanding size={13} />} label="姿势库"
            onClick={() => setPosePickerOpen(true)} title="姿势库：22 款 3D 摆姿截图作参考（弹窗底部还可直通分镜）" />
          <ToolChip icon={<Clapperboard size={13} />} label="应用到分镜"
            onClick={() => applyToConnectedShots(false)} title="把本角色的参考/LoRA/一致性种子套用到所有连接的生成/分镜节点" />
        </div>
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            value={(kind === "scene" ? payload.sceneName : payload.name) ?? ""}
            placeholder={kind === "scene" ? "场景名…" : "角色名…"}
            onChange={(e) => update(kind === "scene" ? "sceneName" : "name", e.target.value)}
            className="nodrag"
            style={{ flex: 1, minWidth: 0, height: 30, padding: "0 10px", borderRadius: 9, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", fontSize: 12.5, outline: "none" }}
          />
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起资料面板" : "展开资料面板（职业/外貌/性格/服装等，浮现于输入条下方）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <SlidersHorizontal size={12} /> 高级
          </button>
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); saveToLibrary(); }}
            title="保存到角色库（跨项目复用）"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "var(--ui-accent, var(--c-accent))", border: "none", color: "#0b0d12", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <Save size={12} /> 存库
          </button>
        </div>
        {/* #76 批1：下浮动资料面板——「高级」展开时表单浮现在输入条下方（内部滚动），
            卡体不再被表单撑开；有状态挂载物（隐藏上传 input、识别/一致性面板）常驻卡体不受影响 */}
        {advancedOpen && (
          <div className="nodrag nowheel flex flex-col" style={{ gap: 12, maxHeight: "52vh", overflowY: "auto", overscrollBehavior: "contain", paddingTop: 10, marginTop: 4, borderTop: "1px solid var(--c-bd1)" }}>
            {formBody}
          </div>
        )}
      </InlineGenBar>
    )}
    {/* #111 姿势库（portal 到 body；挂在顶层，不依赖 hero/hover 分支渲染） */}
    {posePickerOpen && (
      <PosePresetPicker
        onApply={(url) => {
          const st = useCanvasStore.getState();
          const pl = st.nodes.find((n) => n.id === id)?.data.payload as CharacterNodeData | undefined;
          const extras = (pl?.additionalImageUrls ?? []).map((u) => (u ?? "").trim()).filter(Boolean);
          if (!pl?.referenceImageUrl?.trim()) {
            st.updateNodeData(id, { referenceImageUrl: url, referenceStorageKey: undefined });
          } else {
            st.updateNodeData(id, { additionalImageUrls: [...extras, url].slice(0, 8) });
          }
        }}
        onClose={() => setPosePickerOpen(false)}
      />
    )}
    </>
  );
});

// ── Additional reference images (multi-view) ───────────────────────────
// Up to 4 alternate views. Each slot is a square with thumbnail + delete X
// on hover; an empty slot opens a file picker. Uploads reuse the same
// trpc.upload.uploadImage mutation as the primary reference image.
const MAX_ADDITIONAL_IMAGES = 8;
function AdditionalImagesSection({
  urls,
  onChange,
  accent,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  accent: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const uploadMut = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      if (uploadingIdx === null) return;
      const next = urls.slice();
      next[uploadingIdx] = result.url;
      onChange(next);
      setUploadingIdx(null);
    },
    onError: (err) => {
      toast.error(`备用视角上传失败：${err.message}`);
      setUploadingIdx(null);
    },
  });
  const handlePick = (slotIdx: number) => {
    setUploadingIdx(slotIdx);
    fileInputRef.current?.click();
  };
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) { setUploadingIdx(null); return; }
    if (file.size > 16 * 1024 * 1024) {
      toast.error("图片不能超过 16MB");
      setUploadingIdx(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMut.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const handleRemove = (slotIdx: number) => {
    const next = urls.slice();
    next.splice(slotIdx, 1);
    onChange(next);
  };
  return (
    <div>
      <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)", display: "block", marginBottom: 5 }}>
        备用视角参考图 ({urls.length}/{MAX_ADDITIONAL_IMAGES})
      </label>
      <div className="grid grid-cols-4 gap-1.5 nodrag">
        {Array.from({ length: MAX_ADDITIONAL_IMAGES }).map((_, idx) => {
          const url = urls[idx];
          const isLoading = uploadingIdx === idx && uploadMut.isPending;
          if (url) {
            return (
              <div
                key={idx}
                className="group/slot relative"
                style={{
                  aspectRatio: "1",
                  borderRadius: 6,
                  overflow: "hidden",
                  border: `1px solid ${accent}30`,
                  background: "var(--c-input)",
                }}
              >
                <img
                  src={url.startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent(url)}` : url}
                  alt={`视角 ${idx + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                />
                <button
                  onClick={() => handleRemove(idx)}
                  data-touch-show
                  className="opacity-0 group-hover/slot:opacity-100"
                  style={{
                    position: "absolute", top: 2, right: 2,
                    width: 16, height: 16, padding: 0, borderRadius: "50%",
                    background: "oklch(0 0 0 / 0.6)", border: "none",
                    color: "white", cursor: "pointer", transition: "opacity 150ms ease",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <X style={{ width: 9, height: 9 }} />
                </button>
              </div>
            );
          }
          // Empty slot — click to upload (only the next-available slot is enabled
          // to keep the gallery dense)
          const isNextSlot = idx === urls.length;
          return (
            <button
              key={idx}
              onClick={() => isNextSlot && handlePick(urls.length)}
              disabled={!isNextSlot || isLoading}
              style={{
                aspectRatio: "1",
                borderRadius: 6,
                background: isNextSlot ? "var(--c-input)" : "transparent",
                border: `1px dashed ${isNextSlot ? "var(--c-bd3)" : "var(--c-bd1)"}`,
                cursor: isNextSlot ? "pointer" : "not-allowed",
                opacity: isNextSlot ? 1 : 0.4,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--c-t4)",
                transition: "border-color 150ms ease",
              }}
              onMouseEnter={(e) => {
                if (isNextSlot) (e.currentTarget as HTMLElement).style.borderColor = accent;
              }}
              onMouseLeave={(e) => {
                if (isNextSlot) (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd3)";
              }}
            >
              {isLoading
                ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
                : <Plus style={{ width: 14, height: 14 }} />}
            </button>
          );
        })}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFile}
      />
    </div>
  );
}

const MAX_MEDIA_REFS = 4;
/**
 * 角色携带的音频 / 视频参考上传区（与备用视角图同构）。复用 upload.uploadImage（其白名单
 * 已含 audio/* 与 video/*）。urls[0]→referenceXxxUrl，其余→additionalXxxUrls（由父组件拆分写回）。
 * audio 用播放磁贴，video 用 <video> 首帧磁贴；点击播放/暂停，悬停删除。
 */
function MediaRefsSection({ kind, urls, onChange, accent }: {
  kind: "audio" | "video";
  urls: string[];
  onChange: (urls: string[]) => void;
  accent: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const uploadMut = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      if (uploadingIdx === null) return;
      const next = urls.slice(); next[uploadingIdx] = result.url; onChange(next); setUploadingIdx(null);
    },
    onError: (err) => { toast.error(`${kind === "audio" ? "音频" : "视频"}上传失败：${err.message}`); setUploadingIdx(null); },
  });
  const handlePick = (slotIdx: number) => { setUploadingIdx(slotIdx); fileInputRef.current?.click(); };
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) { setUploadingIdx(null); return; }
    if (file.size > 16 * 1024 * 1024) { toast.error(`${kind === "audio" ? "音频" : "视频"}不能超过 16MB`); setUploadingIdx(null); return; }
    const reader = new FileReader();
    reader.onload = () => uploadMut.mutate({ base64: (reader.result as string).split(",")[1], mimeType: file.type, filename: file.name });
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const handleRemove = (slotIdx: number) => { const next = urls.slice(); next.splice(slotIdx, 1); onChange(next); };
  const label = kind === "audio" ? "音频参考" : "视频参考";
  return (
    <div>
      <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)", display: "block", marginBottom: 5 }}>
        {label} ({urls.length}/{MAX_MEDIA_REFS})
      </label>
      <div className="grid grid-cols-4 gap-1.5 nodrag">
        {Array.from({ length: MAX_MEDIA_REFS }).map((_, idx) => {
          const url = urls[idx];
          const isLoading = uploadingIdx === idx && uploadMut.isPending;
          if (url) {
            return (
              <div key={idx} className="group/slot relative" style={{ aspectRatio: "1", borderRadius: 6, overflow: "hidden", border: `1px solid ${accent}30`, background: "var(--c-input)" }}>
                {kind === "video"
                  ? <video src={url.startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent(url)}` : url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})} onMouseLeave={(e) => (e.currentTarget as HTMLVideoElement).pause()} />
                  : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: accent }}><Music style={{ width: 16, height: 16 }} /></div>}
                <button onClick={() => handleRemove(idx)} data-touch-show className="opacity-0 group-hover/slot:opacity-100" style={{ position: "absolute", top: 2, right: 2, width: 16, height: 16, padding: 0, borderRadius: "50%", background: "oklch(0 0 0 / 0.6)", border: "none", color: "white", cursor: "pointer", transition: "opacity 150ms ease", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <X style={{ width: 9, height: 9 }} />
                </button>
              </div>
            );
          }
          const isNextSlot = idx === urls.length;
          return (
            <button key={idx} onClick={() => isNextSlot && handlePick(urls.length)} disabled={!isNextSlot || isLoading}
              style={{ aspectRatio: "1", borderRadius: 6, background: isNextSlot ? "var(--c-input)" : "transparent", border: `1px dashed ${isNextSlot ? "var(--c-bd3)" : "var(--c-bd1)"}`, cursor: isNextSlot ? "pointer" : "not-allowed", opacity: isNextSlot ? 1 : 0.4, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-t4)", transition: "border-color 150ms ease" }}
              onMouseEnter={(e) => { if (isNextSlot) (e.currentTarget as HTMLElement).style.borderColor = accent; }}
              onMouseLeave={(e) => { if (isNextSlot) (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd3)"; }}>
              {isLoading ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <Plus style={{ width: 14, height: 14 }} />}
            </button>
          );
        })}
      </div>
      <input ref={fileInputRef} type="file" accept={kind === "audio" ? "audio/*" : "video/*"} style={{ display: "none" }} onChange={handleFile} />
    </div>
  );
}

// ── Live prompt preview + customizable template ───────────────────────
// Shows users exactly what's injected into downstream prompts (the result of
// characterToPromptInjection on the current payload). A collapsible advanced
// editor lets power users override the template with placeholders.
function PromptPreviewSection({
  payload,
  onChange,
}: {
  payload: CharacterNodeData;
  onChange: (template: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const preview = characterToPromptInjection(payload);
  const kind = payload.characterKind ?? "person";
  const defaultTemplate = kind === "scene" ? DEFAULT_SCENE_TEMPLATE : DEFAULT_PERSON_TEMPLATE;
  const usingCustom = !!payload.customPromptTemplate;
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
        <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>
          Prompt 注入预览
        </label>
        <button
          onClick={() => setEditing((v) => !v)}
          className="nodrag"
          style={{
            padding: "1px 7px", fontSize: 10, borderRadius: 99,
            background: "transparent", border: "1px solid var(--c-bd2)",
            color: usingCustom ? "oklch(0.78 0.18 285)" : "var(--c-t4)",
            cursor: "pointer",
          }}
        >
          {editing ? "完成" : (usingCustom ? "自定义模板" : "默认模板")}
        </button>
      </div>
      <div
        style={{
          padding: "8px 10px",
          fontSize: 11,
          lineHeight: 1.55,
          background: "var(--c-input)",
          border: "1px dashed var(--c-bd2)",
          borderRadius: 6,
          color: preview.length > 0 ? "var(--c-t2)" : "var(--c-t4)",
          fontFamily: "'JetBrains Mono', monospace",
          fontStyle: preview.length === 0 ? "italic" : "normal",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {preview.length > 0 ? `[${preview}]` : "(填写字段后将显示注入到下游的 prompt 块)"}
      </div>
      {editing && (
        <div className="nodrag" style={{ marginTop: 6 }}>
          <NodeTextArea
            className="nodrag nowheel"
            placeholder={defaultTemplate}
            value={payload.customPromptTemplate ?? ""}
            onValueChange={(v) => onChange(v)}
            rows={3}
            style={{
              width: "100%",
              padding: "7px 10px",
              fontSize: 11,
              background: "var(--c-input)",
              border: "1px solid var(--c-bd2)",
              borderRadius: 6,
              color: "var(--c-t1)",
              outline: "none",
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
          <div style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 4, lineHeight: 1.5 }}>
            可用占位符（未填字段会被自动 trim）：
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
              {CHARACTER_PLACEHOLDERS.map((p) => (
                <code
                  key={p}
                  onClick={() => onChange((payload.customPromptTemplate ?? "") + `{${p}}`)}
                  style={{
                    fontSize: 10,
                    padding: "1px 5px",
                    borderRadius: 3,
                    background: "var(--c-surface)",
                    color: "var(--c-t3)",
                    cursor: "pointer",
                  }}
                >
                  {`{${p}}`}
                </code>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
