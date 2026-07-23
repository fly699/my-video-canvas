import { useMemo, useState } from "react";
import { toast } from "sonner";
import { X, RotateCcw, Loader2, Send, Coins } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ModelPicker, type ModelPickerOption } from "../ModelPicker";
import { IMAGE_EDIT_MODEL_GROUPS, DEFAULT_IMAGE_EDIT_MODEL, buildImageEditInstruction, comfyDenoiseForOp } from "../../../../../shared/imageEdit";
import { COMFY_LOCAL_MODEL, COMFY_LOCAL_OPTION, loadComfyCkpt, loadComfyBase } from "../../../lib/comfyLocalRoute";
import { ComfyCkptSelect } from "../ComfyCkptSelect";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import { sourceAspectRatio } from "../../../lib/imageAspect";
import {
  EMOTION_GRID, EMOTION_DEFAULT_CELL, EMOTION_INTENSITIES, buildEmotionPrompt, emotionCellAt,
  type EmotionCell, type EmotionIntensity, type EmotionFaceParams,
} from "../../../../../shared/emotionGrid";

// #336 情绪调节编辑器（LibTV「人像质感调节 › 情绪调节」，全模式，从节点工具条进入）。
// 5×5 情绪坐标网格（纵=激动↕平静，横=亲近↔疏离）+ SVG 表情脸实时预览 + 四字情绪定位。
// 生成走 imageEdit.run(operation="emotion") → 结果写回节点结果字段 →
// useResultHistoryCapture 自动把旧图押入版本历史。与多角度/打光编辑器同构。

export interface EmotionEditorProps {
  sourceUrl: string;
  nodeId: string;
  projectId: number;
  onApply: (url: string) => void;
  onClose: () => void;
}

const MODEL_KEY = "canvas.angleRelightModel"; // 与多角度/打光共用同一记忆位：三个编辑器同类（图像编辑），模型偏好互通
const loadModel = () => { try { return localStorage.getItem(MODEL_KEY) ?? ""; } catch { return ""; } };
const saveModel = (v: string) => { try { localStorage.setItem(MODEL_KEY, v); } catch { /* ignore */ } };

const EDIT_MODEL_OPTIONS: ModelPickerOption[] = [
  { value: "", label: "默认（Flux Pro Kontext）", group: "默认", family: "默认" },
  COMFY_LOCAL_OPTION,
  ...IMAGE_EDIT_MODEL_GROUPS.flatMap((g) => g.models.map((m) => {
    const c = estimateImageCost(m.value);
    return { value: m.value, label: m.label, group: g.label, family: g.label, costLabel: c ? costEstimateLabel(c) : undefined };
  })),
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

/** SVG 参数化表情脸（对齐 LibTV 3D 素模预览的职责：所选情绪的即时可视化）。
 *  素模灰阶风格：头 + 眉（抬升/倾角）+ 眼（睁开度）+ 嘴（弧度/张开），随格点实时变化。 */
export function EmotionFace({ face, size = 168 }: { face: EmotionFaceParams; size?: number }) {
  const s = size / 168; // 以 168 视图为基准整体缩放
  const browY = 62 - face.browRaise * 9;             // 眉基线（抬升↑）
  const innerDrop = -face.browAngle * 7;             // 内端位移：负角(怒)内端下压，正角(悲)内端上挑
  const outerDrop = face.browAngle * 3;
  const eyeRy = Math.max(1.2, 7 * Math.min(1.4, Math.max(0.1, face.eyeOpen)));
  const pupilR = face.eyeOpen < 0.28 ? 0 : 3.4;      // 眯到极低就不画瞳孔
  const mouthY = 118;
  const curve = -face.mouthCurve * 16;               // 控制点位移：正弧度→上扬
  const open = Math.max(0, Math.min(1, face.mouthOpen)) * 14;
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" data-testid="emotion-face" style={{ display: "block" }}>
      <defs>
        <radialGradient id="ef-head" cx="50%" cy="38%" r="72%">
          <stop offset="0%" stopColor="oklch(0.78 0.005 260)" />
          <stop offset="100%" stopColor="oklch(0.48 0.01 260)" />
        </radialGradient>
      </defs>
      {/* 颈 + 头 */}
      <rect x={70} y={128} width={28} height={30} rx={9} fill="oklch(0.55 0.008 260)" />
      <ellipse cx={84} cy={84} rx={54} ry={64} fill="url(#ef-head)" stroke="oklch(0.35 0.01 260)" strokeWidth={1} />
      <g transform={`scale(${s})`} style={{ transformOrigin: "center" }} />
      {/* 眉（随情绪抬升/倾斜） */}
      <path d={`M ${46} ${browY + outerDrop} Q ${58} ${browY - 3} ${72} ${browY + innerDrop}`} fill="none" stroke="oklch(0.3 0.01 260)" strokeWidth={4} strokeLinecap="round" data-testid="ef-brow-l" />
      <path d={`M ${96} ${browY + innerDrop} Q ${110} ${browY - 3} ${122} ${browY + outerDrop}`} fill="none" stroke="oklch(0.3 0.01 260)" strokeWidth={4} strokeLinecap="round" data-testid="ef-brow-r" />
      {/* 眼（睁开度） */}
      <ellipse cx={60} cy={80} rx={11} ry={eyeRy} fill="#fff" stroke="oklch(0.35 0.01 260)" strokeWidth={1} data-testid="ef-eye-l" />
      <ellipse cx={108} cy={80} rx={11} ry={eyeRy} fill="#fff" stroke="oklch(0.35 0.01 260)" strokeWidth={1} />
      {pupilR > 0 && <circle cx={60} cy={80} r={Math.min(pupilR, eyeRy - 0.6)} fill="oklch(0.22 0.01 260)" />}
      {pupilR > 0 && <circle cx={108} cy={80} r={Math.min(pupilR, eyeRy - 0.6)} fill="oklch(0.22 0.01 260)" />}
      {/* 鼻 */}
      <path d="M 84 88 L 81 102 L 87 102" fill="none" stroke="oklch(0.4 0.01 260)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* 嘴（弧度 + 张开） */}
      {open > 2 ? (
        <path d={`M 64 ${mouthY} Q 84 ${mouthY + curve} 104 ${mouthY} Q 84 ${mouthY + curve + open} 64 ${mouthY} Z`}
          fill="oklch(0.28 0.02 20)" stroke="oklch(0.3 0.01 260)" strokeWidth={1.5} data-testid="ef-mouth" />
      ) : (
        <path d={`M 64 ${mouthY} Q 84 ${mouthY + curve} 104 ${mouthY}`}
          fill="none" stroke="oklch(0.3 0.01 260)" strokeWidth={3.5} strokeLinecap="round" data-testid="ef-mouth" />
      )}
    </svg>
  );
}

export function EmotionEditor({ sourceUrl, nodeId, projectId, onApply, onClose }: EmotionEditorProps) {
  const [cell, setCell] = useState<EmotionCell>(EMOTION_DEFAULT_CELL);
  const [hoverCell, setHoverCell] = useState<EmotionCell | null>(null);
  const [intensity, setIntensity] = useState<EmotionIntensity>("moderate");
  const [override, setOverride] = useState<string | null>(null);
  const [model, setModel] = useState(loadModel);
  const run = trpc.imageEdit.run.useMutation();
  const comfyGen = trpc.comfyui.generateImage.useMutation();

  const preview = hoverCell ?? cell; // hover 试看，点击定选（对齐打光预设「试穿」交互）
  const auto = useMemo(() => buildEmotionPrompt(cell, intensity), [cell, intensity]);
  const promptText = override ?? auto;
  const costLabel = useMemo(() => {
    if (model === COMFY_LOCAL_MODEL) return "自建 · 免云端积分";
    const c = estimateImageCost(model || DEFAULT_IMAGE_EDIT_MODEL);
    return c ? costEstimateLabel(c) : "按模型页";
  }, [model]);

  const pick = (c: EmotionCell) => { setCell(c); setOverride(null); };
  const reset = () => { setCell(EMOTION_DEFAULT_CELL); setIntensity("moderate"); setOverride(null); };

  const send = async () => {
    if (run.isPending || comfyGen.isPending) return;
    try {
      let url: string | undefined;
      if (model === COMFY_LOCAL_MODEL) {
        // 本地自建：comfyui img2img（服务端 assertComfyuiAllowed 门控 + comfyui_image_gen 审计）
        const ckpt = loadComfyCkpt();
        if (!ckpt) { toast.error("请先在下方选择本地 ComfyUI 的 checkpoint 模型"); return; }
        const r = await comfyGen.mutateAsync({
          nodeId, projectId, workflowTemplate: "img2img", ckpt, customBaseUrl: loadComfyBase() || undefined,
          prompt: buildImageEditInstruction("emotion", promptText).slice(0, 2000),
          referenceImageUrl: sourceUrl, denoise: comfyDenoiseForOp("emotion"),
        });
        url = r.url;
      } else {
        // 只改表情不改画幅：显式继承源图比例（同打光口径，防云端编辑模型按默认枚举改画幅）
        const aspect = await sourceAspectRatio(sourceUrl);
        const r = await run.mutateAsync({
          sourceImageUrl: sourceUrl, operation: "emotion", model: model || undefined,
          prompt: promptText.slice(0, 900), estimatedCost: costLabel,
          ...(aspect ? { aspectRatio: aspect } : {}),
          ...(projectId ? { projectId } : {}),
        });
        url = (r as { url?: string }).url;
      }
      if (!url) throw new Error("模型未返回图片");
      onApply(url);
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
            <div style={{ position: "relative", width: 200, borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-bd2)", background: "#000" }}>
              <img src={sourceUrl} alt="src" draggable={false} style={{ width: "100%", display: "block", maxHeight: 150, objectFit: "cover" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "oklch(0.17 0.008 260)", border: "1px solid var(--c-bd2)", padding: 6 }}>
              <EmotionFace face={preview.face} size={150} />
            </div>
            <div style={{ fontSize: 12, color: "var(--c-t3)" }} data-testid="emotion-name">
              情绪定位 <b style={{ color: "var(--c-t1)", fontSize: 13, marginLeft: 6 }}>{preview.name}</b>
            </div>
          </div>

          {/* 右：5×5 情绪坐标网格（纵=激动↕平静，横=亲近↔疏离） */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0, borderRadius: 12, background: "oklch(0.17 0.008 260)", border: "1px solid var(--c-bd2)", padding: "12px 8px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t4)" }}>激动</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t4)", writingMode: "vertical-rl", letterSpacing: 2, flexShrink: 0 }}>亲近</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 40px)", gridTemplateRows: "repeat(5, 40px)", placeItems: "center" }} data-testid="emotion-grid">
                {Array.from({ length: 25 }, (_, i) => {
                  const row = Math.floor(i / 5), col = i % 5;
                  const c = emotionCellAt(row, col)!;
                  const selected = cell.id === c.id;
                  const hovered = hoverCell?.id === c.id;
                  const d = selected ? 22 : hovered ? 18 : 11;
                  return (
                    <button key={c.id} title={c.name} data-testid={`emotion-cell-${c.id}`}
                      onClick={() => pick(c)} onMouseEnter={() => setHoverCell(c)} onMouseLeave={() => setHoverCell(null)}
                      style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <span style={{ width: d, height: d, borderRadius: "50%", transition: "all 120ms ease",
                        background: selected ? "#fff" : hovered ? "oklch(0.8 0.01 260)" : "oklch(0.45 0.012 260)",
                        boxShadow: selected ? "0 0 10px oklch(1 0 0 / 0.5)" : undefined }} />
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
