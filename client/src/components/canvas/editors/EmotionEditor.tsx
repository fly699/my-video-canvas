import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X, RotateCcw, Loader2, Send, Coins, ScanFace, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ModelPicker, type ModelPickerOption } from "../ModelPicker";
import { IMAGE_EDIT_MODEL_GROUPS, DEFAULT_IMAGE_EDIT_MODEL, buildImageEditInstruction, comfyDenoiseForOp } from "../../../../../shared/imageEdit";
import { COMFY_LOCAL_MODEL, COMFY_LOCAL_OPTION, loadComfyCkpt, loadComfyBase } from "../../../lib/comfyLocalRoute";
import { ComfyCkptSelect } from "../ComfyCkptSelect";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import { IMAGE_MODELS } from "../../../lib/models";
import { sourceAspectRatio } from "../../../lib/imageAspect";
import {
  EMOTION_DEFAULT_CELL, EMOTION_INTENSITIES, buildEmotionPrompt, emotionCellAt, isValidEmotionRegion,
  regionToLocationPhrase, emotionTargetPhrase, withEmotionFocus, toAppliedEmotion,
  type EmotionCell, type EmotionIntensity, type EmotionRegion,
} from "../../../../../shared/emotionGrid";

// #336 情绪调节编辑器（LibTV「人像质感调节 › 情绪调节」，全模式，从节点工具条进入）。
// 5×5 情绪坐标网格（纵=激动↕平静，横=亲近↔疏离）+ SVG 表情脸实时预览 + 四字情绪定位。
// 生成走 imageEdit.run(operation="emotion") → 结果写回节点结果字段 →
// useResultHistoryCapture 自动把旧图押入版本历史。与多角度/打光编辑器同构。

export interface EmotionEditorProps {
  sourceUrl: string;
  nodeId: string;
  projectId: number;
  onApply: (url: string, extra?: Record<string, unknown>) => void;
  onClose: () => void;
}

const MODEL_KEY = "canvas.angleRelightModel"; // 与多角度/打光共用同一记忆位：三个编辑器同类（图像编辑），模型偏好互通
const loadModel = () => { try { return localStorage.getItem(MODEL_KEY) ?? ""; } catch { return ""; } };
const saveModel = (v: string) => { try { localStorage.setItem(MODEL_KEY, v); } catch { /* ignore */ } };

// 每个模型都给出价签：优先精确点数（kie/poyo），无则回退模型的 costNote（HF→「HF 计费」），
// 绝不空白（用户实报「模型没有计价」——此前 HF/默认项无价签）。
function editModelCostLabel(model: string): string {
  const id = model || DEFAULT_IMAGE_EDIT_MODEL;
  const c = estimateImageCost(id);
  if (c) return costEstimateLabel(c);
  return IMAGE_MODELS.find((m) => m.value === id)?.costNote ?? "按模型页";
}

const EDIT_MODEL_OPTIONS: ModelPickerOption[] = [
  { value: "", label: "默认（Flux Pro Kontext）", group: "默认", family: "默认", costLabel: editModelCostLabel("") },
  { ...COMFY_LOCAL_OPTION, costLabel: "自建·免积分" },
  ...IMAGE_EDIT_MODEL_GROUPS.flatMap((g) => g.models.map((m) => (
    { value: m.value, label: m.label, group: g.label, family: g.label, costLabel: editModelCostLabel(m.value) }
  ))),
];

const shell: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 320, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0.05 0.007 260 / 0.72)", backdropFilter: "blur(8px)" };
const card: React.CSSProperties = { width: 720, maxWidth: "94vw", maxHeight: "92vh", overflowY: "auto", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const ttl: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: "var(--c-t1)" };
const sub: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--c-t4)", textTransform: "uppercase", letterSpacing: "0.05em" };
const chip = (active?: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, padding: "5px 11px", borderRadius: 8, cursor: "pointer",
  border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`,
  background: active ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: active ? "#0b0d12" : "var(--c-t3)", fontWeight: active ? 700 : 500,
});
const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" };

/** 情绪徽章预览：大号系统 emoji（彩色、清晰、专业设计、零渲染瑕疵）置于精致渐变圆角
 *  底托内——比手绘 SVG 更干净、更「成品感」。emoji 随所选格实时切换。 */
export function EmotionFace({ emoji, size = 150 }: { emoji: string; size?: number }) {
  return (
    <div data-testid="emotion-face" style={{
      width: size, height: size, borderRadius: 26, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "radial-gradient(circle at 38% 30%, oklch(0.34 0.02 265), oklch(0.15 0.014 265))",
      border: "1px solid var(--c-bd2)",
      boxShadow: "inset 0 2px 16px oklch(0 0 0 / 0.5), inset 0 -1px 0 oklch(1 0 0 / 0.05), 0 2px 8px oklch(0 0 0 / 0.3)",
    }}>
      <span data-testid="emotion-emoji" style={{
        fontSize: Math.round(size * 0.56), lineHeight: 1,
        fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        filter: "drop-shadow(0 3px 7px oklch(0 0 0 / 0.45))",
      }}>{emoji}</span>
    </div>
  );
}

const ACCENT = "oklch(0.65 0.18 170)";

/** 多人图选脸：在源图上拖框选中目标脸；框内高亮、框外压暗（聚光）。不框=全部/主体。 */
function RegionSelect({ src, region, onChange }: { src: string; region: EmotionRegion | null; onChange: (r: EmotionRegion | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const boxFrom = (a: { x: number; y: number }, b: { x: number; y: number }): EmotionRegion =>
    ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  return (
    <div ref={ref} data-testid="emotion-region-select"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); start.current = p; onChange({ x: p.x, y: p.y, w: 0, h: 0 }); }}
      onPointerMove={(e) => { if (start.current) onChange(boxFrom(start.current, at(e))); }}
      onPointerUp={(e) => { if (start.current) { const b = boxFrom(start.current, at(e)); start.current = null; onChange(isValidEmotionRegion(b) ? b : null); } }}
      style={{ position: "relative", width: 200, borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-bd2)", background: "#000", cursor: "crosshair", userSelect: "none", touchAction: "none" }}>
      <img src={src} alt="src" draggable={false} style={{ width: "100%", display: "block", maxHeight: 150, objectFit: "cover", pointerEvents: "none" }} />
      {region && region.w > 0 && (
        <div data-testid="emotion-region" style={{
          position: "absolute", left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%`,
          border: `2px solid ${ACCENT}`, borderRadius: 3, boxShadow: "0 0 0 9999px oklch(0 0 0 / 0.42)", pointerEvents: "none",
        }} />
      )}
    </div>
  );
}

export function EmotionEditor({ sourceUrl, nodeId, projectId, onApply, onClose }: EmotionEditorProps) {
  const [cell, setCell] = useState<EmotionCell>(EMOTION_DEFAULT_CELL);
  const [hoverCell, setHoverCell] = useState<EmotionCell | null>(null);
  const [intensity, setIntensity] = useState<EmotionIntensity>("moderate");
  const [region, setRegion] = useState<EmotionRegion | null>(null); // 多人图选脸：手动框（null=全部/主体）
  const [faces, setFaces] = useState<{ name: string; desc?: string }[]>([]); // 人脸自动识别 chip
  const [targetDesc, setTargetDesc] = useState<string | null>(null); // 选中的人物 chip（与手动框二选一）
  const [override, setOverride] = useState<string | null>(null);
  const [model, setModel] = useState(loadModel);
  const run = trpc.imageEdit.run.useMutation();
  const comfyGen = trpc.comfyui.generateImage.useMutation();
  const detect = trpc.aiEnhance.analyzeImageElements.useMutation();

  const preview = hoverCell ?? cell; // hover 试看，点击定选（对齐打光预设「试穿」交互）
  const auto = useMemo(() => buildEmotionPrompt(cell, intensity), [cell, intensity]);
  const promptText = override ?? auto;
  const costLabel = useMemo(() => {
    if (model === COMFY_LOCAL_MODEL) return "自建 · 免云端积分";
    return editModelCostLabel(model);
  }, [model]);

  const pick = (c: EmotionCell) => { setCell(c); setOverride(null); };
  const reset = () => { setCell(EMOTION_DEFAULT_CELL); setIntensity("moderate"); setOverride(null); setRegion(null); setTargetDesc(null); };

  // 手动框与人物 chip 二选一：画框即清 chip，选 chip 即清框（都指向「改哪张脸」）。
  const onRegionChange = (r: EmotionRegion | null) => { setRegion(r); if (isValidEmotionRegion(r)) setTargetDesc(null); };
  const runDetect = () => {
    if (detect.isPending) return;
    detect.mutate({ imageUrl: sourceUrl }, {
      onSuccess: (r) => { setFaces(r.elements ?? []); if (!r.elements?.length) toast.info("未识别到可指定的人物/元素"); },
      onError: (e) => toast.error("人脸识别失败：" + (e instanceof Error ? e.message : String(e))),
    });
  };
  const pickFace = (f: { name: string; desc?: string }) => {
    const key = [f.name, f.desc].filter(Boolean).join("，");
    setTargetDesc((prev) => (prev === key ? null : key)); // 再点一次取消
    setRegion(null);
  };

  // 「改哪张脸」的自然语言指代：手动框优先，其次人物 chip，都没有=全部/主体。
  const focusPhrase = isValidEmotionRegion(region)
    ? regionToLocationPhrase(region)
    : (targetDesc ? emotionTargetPhrase(targetDesc) : "");

  const send = async () => {
    if (run.isPending || comfyGen.isPending) return;
    try {
      let url: string | undefined;
      // 多人图选脸：把「只改这张脸、其他人不动」的约束前置进提示词（框选=方位 / chip=人物描述）
      const finalPrompt = withEmotionFocus(promptText, focusPhrase);
      if (model === COMFY_LOCAL_MODEL) {
        // 本地自建：comfyui img2img（服务端 assertComfyuiAllowed 门控 + comfyui_image_gen 审计）
        const ckpt = loadComfyCkpt();
        if (!ckpt) { toast.error("请先在下方选择本地 ComfyUI 的 checkpoint 模型"); return; }
        const r = await comfyGen.mutateAsync({
          nodeId, projectId, workflowTemplate: "img2img", ckpt, customBaseUrl: loadComfyBase() || undefined,
          prompt: buildImageEditInstruction("emotion", finalPrompt).slice(0, 2000),
          referenceImageUrl: sourceUrl, denoise: comfyDenoiseForOp("emotion"),
        });
        url = r.url;
      } else {
        // 只改表情不改画幅：显式继承源图比例（同打光口径，防云端编辑模型按默认枚举改画幅）
        const aspect = await sourceAspectRatio(sourceUrl);
        const r = await run.mutateAsync({
          sourceImageUrl: sourceUrl, operation: "emotion", model: model || undefined,
          prompt: finalPrompt.slice(0, 900), estimatedCost: costLabel,
          ...(aspect ? { aspectRatio: aspect } : {}),
          ...(projectId ? { projectId } : {}),
        });
        url = (r as { url?: string }).url;
      }
      if (!url) throw new Error("模型未返回图片");
      // #336 批2：把情绪档写回节点，供下游视频节点把表情词自然注入提示词。
      onApply(url, { appliedEmotion: toAppliedEmotion(cell, intensity) });
      toast.success("情绪调节已生成，原图已存入版本历史");
      onClose();
    } catch (e) { toast.error("情绪调节生成失败：" + (e instanceof Error ? e.message : String(e))); }
  };

  const busy = run.isPending || comfyGen.isPending;
  return (
    <div className="nodrag nowheel" style={shell} onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={ttl}>🎭 情绪调节</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>只改人物表情，身份/姿势/构图/光线不变</span>
          <div style={{ flex: 1 }} />
          <button onClick={reset} style={{ ...chip() }} title="恢复默认（淡然自若 · 适中）"><RotateCcw size={11} /> 重置</button>
          <button data-testid="emotion-close" onClick={onClose} style={iconBtn}><X size={13} /></button>
        </div>

        <div style={{ display: "flex", gap: 18, alignItems: "stretch" }}>
          {/* 左：源图 + 表情脸预览 + 情绪定位 */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: 220, flexShrink: 0 }}>
            <RegionSelect src={sourceUrl} region={region} onChange={onRegionChange} />
            {/* 多人图选脸：框选目标脸（不框=全部/主体） */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, width: 200, fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.4 }}>
              <ScanFace size={13} style={{ flexShrink: 0, color: isValidEmotionRegion(region) ? ACCENT : "var(--c-t4)" }} />
              {isValidEmotionRegion(region) ? (
                <>
                  <span style={{ color: ACCENT, fontWeight: 600 }}>已选定这张脸</span>
                  <button onClick={() => setRegion(null)} style={{ marginLeft: "auto", ...chip() }}>清除</button>
                </>
              ) : (
                <span>多人图：框选或识别下方人物指定要调整表情的那张脸（不选=全部/主体）</span>
              )}
            </div>
            {/* 人脸自动识别 chip（复用 AI 元素分析）：点选人物 = 指定改哪张脸（与手动框二选一） */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5, width: 200 }}>
              <button data-testid="emotion-detect" onClick={runDetect} disabled={detect.isPending}
                style={{ ...chip(), justifyContent: "center", cursor: detect.isPending ? "wait" : "pointer" }}
                title="用视觉模型识别图中人物，点选即锁定要调整表情的那张脸（多人图更省心）">
                {detect.isPending ? <Loader2 size={11} className="animate-spin" /> : <Users size={11} />}
                {detect.isPending ? "识别中…" : "识别人物"}
              </button>
              {faces.length > 0 && (
                <div data-testid="emotion-faces" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {faces.map((f, i) => {
                    const key = [f.name, f.desc].filter(Boolean).join("，");
                    const active = targetDesc === key;
                    return (
                      <button key={f.name + i} data-testid={`emotion-face-chip-${i}`} onClick={() => pickFace(f)}
                        title={f.desc || f.name} style={{ ...chip(active), fontSize: 10.5, padding: "3px 8px" }}>
                        {f.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {targetDesc && (
                <span data-testid="emotion-target" style={{ fontSize: 10.5, color: ACCENT, fontWeight: 600 }}>
                  已锁定：{targetDesc}
                </span>
              )}
            </div>
            <EmotionFace emoji={preview.emoji} size={150} />
            <div style={{ fontSize: 12, color: "var(--c-t3)" }} data-testid="emotion-name">
              情绪定位 <b style={{ color: "var(--c-t1)", fontSize: 13, marginLeft: 6 }}>{preview.name}</b>
            </div>
          </div>

          {/* 右：5×5 情绪坐标网格（纵=激动↕平静，横=亲近↔疏离） */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0, borderRadius: 12, background: "oklch(0.17 0.008 260)", border: "1px solid var(--c-bd2)", padding: "12px 8px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t4)" }}>激动</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t4)", writingMode: "vertical-rl", letterSpacing: 2, flexShrink: 0 }}>亲近</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 42px)", gridTemplateRows: "repeat(5, 42px)", placeItems: "center", gap: 2 }} data-testid="emotion-grid">
                {Array.from({ length: 25 }, (_, i) => {
                  const row = Math.floor(i / 5), col = i % 5;
                  const c = emotionCellAt(row, col)!;
                  const selected = cell.id === c.id;
                  const hovered = hoverCell?.id === c.id;
                  return (
                    <button key={c.id} title={c.name} data-testid={`emotion-cell-${c.id}`}
                      onClick={() => pick(c)} onMouseEnter={() => setHoverCell(c)} onMouseLeave={() => setHoverCell(null)}
                      style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, cursor: "pointer",
                        borderRadius: 10, transition: "all 120ms ease",
                        border: `1px solid ${selected ? "var(--ui-accent, var(--c-accent))" : "transparent"}`,
                        background: selected ? "oklch(0.65 0.18 170 / 0.18)" : hovered ? "oklch(1 0 0 / 0.06)" : "transparent",
                        transform: selected ? "scale(1.12)" : hovered ? "scale(1.06)" : "scale(1)" }}>
                      <span style={{ fontSize: 22, lineHeight: 1, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif', opacity: selected || hovered ? 1 : 0.82 }}>{c.emoji}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t4)", writingMode: "vertical-rl", letterSpacing: 2, flexShrink: 0 }}>疏离</div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t4)" }}>平静</div>
          </div>
        </div>

        {/* 强度档 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={sub}>强度</span>
          {EMOTION_INTENSITIES.map((lv) => (
            <button key={lv.value} onClick={() => { setIntensity(lv.value); setOverride(null); }} style={chip(intensity === lv.value)}>{lv.label}</button>
          ))}
        </div>

        {/* 生成描述（按格点+强度自动生成，可编辑） */}
        <textarea data-testid="emotion-prompt" value={promptText} onChange={(e) => setOverride(e.target.value)} rows={2}
          style={{ width: "100%", resize: "vertical", padding: "8px 10px", fontSize: 12, lineHeight: 1.6, background: "var(--c-input)", color: "var(--c-t2)", border: "1px dashed var(--c-bd2)", borderRadius: 8, outline: "none" }} />

        {/* 本地 ComfyUI（自建）：仅选自建模型时出现 */}
        {model === COMFY_LOCAL_MODEL && <div style={{ marginTop: 4 }}><ComfyCkptSelect enabled width={160} /></div>}
        {/* 底部：模型 + 积分 + 发送 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--c-bd1)", paddingTop: 10 }}>
          <ModelPicker value={model} onChange={(v) => { setModel(v); saveModel(v); }} options={EDIT_MODEL_OPTIONS} minWidth={200} />
          <div style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-t3)", whiteSpace: "nowrap" }} title="预计消耗（按所选编辑模型估算）">
            <Coins size={12} /> {costLabel}
          </span>
          <button onClick={() => void send()} disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 9, border: "none", cursor: busy ? "wait" : "pointer", background: "var(--ui-accent, var(--c-accent))", color: "#0b0d12", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", opacity: busy ? 0.7 : 1 }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {busy ? "生成中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
