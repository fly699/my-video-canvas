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
import { User, Mountain, Upload, X, Image as ImageIcon, Loader2, Plus, Search, Save, Sparkles, Music, Dices } from "lucide-react";
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
import { ZoomableImage } from "../ZoomableImage";
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
  const maSliceMut = trpc.imageGrid.slice.useMutation();
  const handleMultiAngle = async () => {
    if (multiAngleBusy) return;
    const preset = getGridPreset("turnaround")!;
    const subject = charPromptText.trim() || [payload.name, payload.appearance, payload.outfit, payload.role].filter(Boolean).join(", ");
    if (!subject) { toast.error("请先填写角色外貌 / 服装等描述"); return; }
    setMultiAngleBusy(true);
    try {
      const gen = await maGenMut.mutateAsync({
        prompt: buildGridPrompt(subject, preset),
        ...(payload.referenceImageUrl?.trim() ? { referenceImageUrl: payload.referenceImageUrl.trim() } : {}),
        aspectRatio: preset.sheetAspect,
        poyoAspectRatio: preset.sheetAspect,
        reveAspectRatio: preset.sheetAspect,
        projectId: data.projectId,
      });
      const gridUrl = gen.urls?.[0] || gen.url || "";
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

  const heroMedia = payload.referenceImageUrl ? (
    <div className="relative" style={{ width: "100%" }}>
      <MediaImage
        src={payload.referenceImageUrl}
        alt="参考图"
        style={{ width: "100%", maxHeight: 240, objectFit: "cover", display: "block" }}
        draggable={false}
      />
      {isOwnStorageUrl(payload.referenceImageUrl) && (
        <div title="已存储到 MinIO·长期有效" className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
          style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }} />
      )}
    </div>
  ) : (() => {
    // 无参考图：用紧凑摘要卡作折叠预览（角色/场景关键字段），使节点收缩后高度与提示词
    // 节点相当，而不是被 minHeight 撑高、依旧显示整张表单。
    const bits = [payload.role, payload.appearance, payload.outfit, payload.locationType, payload.atmosphere, payload.sceneDescription]
      .map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
    if (bits.length === 0) return null; // 完全空 → 不收缩（提示用户填写）
    return (
      <div style={{ padding: "9px 14px 11px", display: "flex", flexDirection: "column", gap: 3, textAlign: "left" }}>
        {bits.slice(0, 3).map((b, i) => (
          <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: i === 0 ? "var(--c-t2)" : "var(--c-t3)", fontWeight: i === 0 ? 600 : 400, display: "-webkit-box", WebkitLineClamp: i === 0 ? 1 : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{b}</div>
        ))}
      </div>
    );
  })();

  return (
    <BaseNode id={id} selected={selected} nodeType="character" title={data.title} minHeight={160} resizable heroMedia={heroMedia}
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
      <div className="flex flex-col gap-3 p-3.5">

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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
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
              <LLMModelPicker value={recognizeModel} onChange={setRecognizeModel} disabled={recognizeMut.isPending} filter={(m) => !!m.vision} />
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

      </div>
    </BaseNode>
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
                <button onClick={() => handleRemove(idx)} className="opacity-0 group-hover/slot:opacity-100" style={{ position: "absolute", top: 2, right: 2, width: 16, height: 16, padding: 0, borderRadius: "50%", background: "oklch(0 0 0 / 0.6)", border: "none", color: "white", cursor: "pointer", transition: "opacity 150ms ease", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
