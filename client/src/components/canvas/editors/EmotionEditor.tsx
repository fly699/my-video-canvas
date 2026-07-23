import { useMemo, useState } from "react";
import { toast } from "sonner";
import { X, RotateCcw, Loader2, Send, Coins } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ModelPicker, type ModelPickerOption } from "../ModelPicker";
import { IMAGE_EDIT_MODEL_GROUPS, DEFAULT_IMAGE_EDIT_MODEL, buildImageEditInstruction, comfyDenoiseForOp } from "../../../../../shared/imageEdit";
import { COMFY_LOCAL_MODEL, COMFY_LOCAL_OPTION, loadComfyCkpt, loadComfyBase } from "../../../lib/comfyLocalRoute";
import { ComfyCkptSelect } from "../ComfyCkptSelect";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import { IMAGE_MODELS } from "../../../lib/models";
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

/** 参数化「瓷雕素模」表情脸（对齐 LibTV 3D 素模预览的职责）。
 *  不做卡通简笔——用多层高斯模糊的明暗层在渐变头颅上堆出体积（额头/鼻梁/颧骨高光 +
 *  眼窝/鼻底/下唇/下颌阴影），配写实杏仁眼（虹膜径向渐变+高光）、有体积的唇（丘比特弓+
 *  下唇高光）与柔和眉毛；眉抬升/倾角、眼睁开、嘴弧度/张开随情绪实时变化。 */
export function EmotionFace({ face, size = 168 }: { face: EmotionFaceParams; size?: number }) {
  const n = (v: number) => Math.round(v * 10) / 10;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  // ── 表情驱动量 ──
  const cy = 124;                                   // 眼睛基线
  const ap = clamp(face.eyeOpen, 0.1, 1.4);         // 睁开度
  const lidUp = 13 * Math.min(ap, 1.4), lidLo = 7 * Math.min(ap, 1);
  const sleepy = ap < 0.34;
  const irisY = cy - (1 - Math.min(ap, 1)) * 1;
  const by = 100 - face.browRaise * 11;             // 眉基线（抬升↑）
  const innerY = by - face.browAngle * 10;          // 正=内端上挑(悲/惊)、负=内端下压(怒)
  const outerY = by + face.browAngle * 4;
  const together = face.browAngle < 0 ? -face.browAngle * 5 : 0; // 怒→眉头收拢
  const furrow = face.browAngle < -0.3;             // 眉间竖纹
  const lipY = 192, mid = lipY + face.mouthCurve * 15, gap = clamp(face.mouthOpen, 0, 1) * 16;
  // ── 配色（冷灰瓷像，深底上显高级）──
  const shadow = "oklch(0.34 0.02 258)", hi = "oklch(0.97 0.008 250)";
  const stroke = "oklch(0.4 0.015 258)", browCol = "oklch(0.43 0.02 258)";
  // 唇去饱和（瓷像统一材质，避免粉唇在灰脸上跳色）
  const lip = "oklch(0.58 0.014 30)", lipLo = "oklch(0.67 0.016 32)", mouthDark = "oklch(0.28 0.02 25)";
  // 单眼渲染
  const eye = (cx: number, tid?: string) => {
    const almond = `M${cx - 20},${cy} Q${cx},${cy - lidUp} ${cx + 20},${cy} Q${cx},${cy + lidLo} ${cx - 20},${cy} Z`;
    if (sleepy) {
      const d = (0.34 - ap) * 12;
      return (
        <g key={cx}>
          <path d={`M${cx - 19},${cy} Q${cx},${cy + d} ${cx + 19},${cy}`} data-testid={tid} fill="none" stroke={stroke} strokeWidth={2.6} strokeLinecap="round" />
          <path d={`M${cx - 15},${cy + 5} Q${cx},${cy + 5 + d * 0.5} ${cx + 15},${cy + 5}`} fill="none" stroke={shadow} strokeWidth={1} opacity={0.5} strokeLinecap="round" />
        </g>
      );
    }
    const clip = `ef-clip-${cx}`;
    return (
      <g key={cx}>
        <clipPath id={clip}><path d={almond} /></clipPath>
        <path d={almond} data-testid={tid} fill="url(#ef-sclera)" />
        <g clipPath={`url(#${clip})`}>
          <circle cx={cx} cy={irisY} r={9} fill="url(#ef-iris)" />
          <circle cx={cx} cy={irisY} r={3.7} fill="oklch(0.16 0.01 258)" />
          <circle cx={cx - 3} cy={irisY - 3.5} r={2.1} fill="#fff" opacity={0.92} />
          <circle cx={cx + 2.5} cy={irisY + 2.5} r={1} fill="#fff" opacity={0.6} />
          {/* 上睑投影 */}
          <path d={`M${cx - 20},${cy} Q${cx},${cy - lidUp} ${cx + 20},${cy}`} fill="none" stroke={shadow} strokeWidth={4} opacity={0.4} />
        </g>
        {/* 上睫线 + 下睑 */}
        <path d={`M${cx - 20},${cy} Q${cx},${cy - lidUp} ${cx + 20},${cy}`} fill="none" stroke={stroke} strokeWidth={2.2} strokeLinecap="round" />
        <path d={`M${cx - 18},${cy + 1} Q${cx},${cy + lidLo + 1} ${cx + 18},${cy + 1}`} fill="none" stroke={shadow} strokeWidth={1.1} opacity={0.45} strokeLinecap="round" />
      </g>
    );
  };
  return (
    <svg width={size} height={n(size * 260 / 240)} viewBox="0 0 240 260" data-testid="emotion-face" style={{ display: "block" }}>
      <defs>
        <radialGradient id="ef-skin" cx="42%" cy="30%" r="78%">
          <stop offset="0%" stopColor="oklch(0.93 0.01 250)" />
          <stop offset="55%" stopColor="oklch(0.78 0.012 252)" />
          <stop offset="100%" stopColor="oklch(0.5 0.018 256)" />
        </radialGradient>
        <linearGradient id="ef-neck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.6 0.016 256)" />
          <stop offset="100%" stopColor="oklch(0.42 0.02 258)" />
        </linearGradient>
        <radialGradient id="ef-sclera" cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor="oklch(0.97 0.004 250)" />
          <stop offset="100%" stopColor="oklch(0.85 0.008 252)" />
        </radialGradient>
        <radialGradient id="ef-iris" cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor="oklch(0.62 0.03 245)" />
          <stop offset="70%" stopColor="oklch(0.42 0.03 250)" />
          <stop offset="100%" stopColor="oklch(0.3 0.025 255)" />
        </radialGradient>
        <filter id="ef-b4" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4" /></filter>
        <filter id="ef-b7" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" /></filter>
        <filter id="ef-b10" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="10" /></filter>
      </defs>

      {/* 颈 + 头颅 */}
      <path d="M100,206 L98,250 Q120,262 142,250 L140,206 Z" fill="url(#ef-neck)" />
      <ellipse cx={100} cy={244} rx={52} ry={14} fill={shadow} opacity={0.35} filter="url(#ef-b7)" />
      <path d="M120,44 C86,44 60,72 56,116 C54,150 62,182 84,206 C96,220 108,228 120,230 C132,228 144,220 156,206 C178,182 186,150 184,116 C180,72 154,44 120,44 Z" fill="url(#ef-skin)" />
      {/* 耳（收拢贴头，加接缝阴影 + 耳廓内凹） */}
      <ellipse cx={59} cy={134} rx={8} ry={14} fill="url(#ef-skin)" />
      <ellipse cx={181} cy={134} rx={8} ry={14} fill="url(#ef-skin)" />
      <path d="M60,127 Q56,134 60,142" fill="none" stroke={shadow} strokeWidth={1.4} opacity={0.4} strokeLinecap="round" />
      <path d="M180,127 Q184,134 180,142" fill="none" stroke={shadow} strokeWidth={1.4} opacity={0.4} strokeLinecap="round" />
      <ellipse cx={64} cy={132} rx={4} ry={22} fill={shadow} opacity={0.18} filter="url(#ef-b4)" />
      <ellipse cx={176} cy={132} rx={4} ry={22} fill={shadow} opacity={0.18} filter="url(#ef-b4)" />

      {/* 阴影层（模糊，堆体积） */}
      <g>
        <ellipse cx={168} cy={140} rx={30} ry={64} fill={shadow} opacity={0.3} filter="url(#ef-b10)" />
        <ellipse cx={94} cy={cy + 2} rx={22} ry={13} fill={shadow} opacity={0.26} filter="url(#ef-b7)" />
        <ellipse cx={146} cy={cy + 2} rx={22} ry={13} fill={shadow} opacity={0.26} filter="url(#ef-b7)" />
        <ellipse cx={120} cy={172} rx={20} ry={10} fill={shadow} opacity={0.32} filter="url(#ef-b7)" />
        <ellipse cx={120} cy={206} rx={22} ry={9} fill={shadow} opacity={0.28} filter="url(#ef-b7)" />
        <ellipse cx={120} cy={224} rx={30} ry={14} fill={shadow} opacity={0.28} filter="url(#ef-b10)" />
      </g>
      {/* 高光层（模糊，提亮凸面） */}
      <g>
        <ellipse cx={106} cy={80} rx={34} ry={26} fill={hi} opacity={0.5} filter="url(#ef-b10)" />
        <ellipse cx={119} cy={140} rx={9} ry={30} fill={hi} opacity={0.5} filter="url(#ef-b7)" />
        <ellipse cx={90} cy={150} rx={18} ry={12} fill={hi} opacity={0.32} filter="url(#ef-b7)" />
        <ellipse cx={119} cy={214} rx={16} ry={11} fill={hi} opacity={0.3} filter="url(#ef-b7)" />
        <ellipse cx={120} cy={158} rx={9} ry={6} fill={hi} opacity={0.4} filter="url(#ef-b4)" />
      </g>

      {/* 眉 */}
      <path data-testid="ef-brow-l"
        d={`M66,${n(outerY)} Q90,${n(by - 5)} ${n(110 - together)},${n(innerY - 1)} L${n(110 - together)},${n(innerY + 5)} Q90,${n(by + 3)} 66,${n(outerY + 5)} Z`}
        fill={browCol} />
      <path data-testid="ef-brow-r"
        d={`M174,${n(outerY)} Q150,${n(by - 5)} ${n(130 + together)},${n(innerY - 1)} L${n(130 + together)},${n(innerY + 5)} Q150,${n(by + 3)} 174,${n(outerY + 5)} Z`}
        fill={browCol} />
      {furrow && (
        <g stroke={shadow} strokeWidth={1.6} strokeLinecap="round" opacity={clamp(-face.browAngle, 0, 1) * 0.6}>
          <path d={`M116,${n(by + 2)} L114,${n(by + 14)}`} fill="none" />
          <path d={`M124,${n(by + 2)} L126,${n(by + 14)}`} fill="none" />
        </g>
      )}

      {/* 眼 */}
      {eye(94, "ef-eye-l")}
      {eye(146)}

      {/* 鼻 */}
      <path d={`M120,110 L120,150`} stroke={hi} strokeWidth={3} opacity={0.35} strokeLinecap="round" filter="url(#ef-b4)" />
      <path d="M106,156 Q104,164 111,166" fill="none" stroke={shadow} strokeWidth={1.6} opacity={0.5} strokeLinecap="round" />
      <path d="M134,156 Q136,164 129,166" fill="none" stroke={shadow} strokeWidth={1.6} opacity={0.5} strokeLinecap="round" />
      <ellipse cx={110} cy={165} rx={2.4} ry={1.6} fill={shadow} opacity={0.6} />
      <ellipse cx={130} cy={165} rx={2.4} ry={1.6} fill={shadow} opacity={0.6} />

      {/* 唇（丘比特弓 + 下唇体积 + 张口内腔） */}
      <path d={`M114,178 L113,186`} stroke={shadow} strokeWidth={0.9} opacity={0.35} />
      <path d={`M126,178 L127,186`} stroke={shadow} strokeWidth={0.9} opacity={0.35} />
      <path d={`M92,${lipY} C100,${n(lipY - 9)} 110,${n(lipY - 8)} 120,${n(lipY - 3)} C130,${n(lipY - 8)} 140,${n(lipY - 9)} 148,${lipY} Q120,${n(mid)} 92,${lipY} Z`} fill={lip} />
      {gap > 3 ? (
        <>
          <path d={`M92,${lipY} Q120,${n(mid)} 148,${lipY} Q120,${n(mid + gap)} 92,${lipY} Z`} fill={mouthDark} />
          <path d={`M97,${n(lipY + gap * 0.35)} Q120,${n(mid + gap + 8)} 143,${n(lipY + gap * 0.35)} Q120,${n(mid + gap)} 97,${n(lipY + gap * 0.35)} Z`} fill={lipLo} />
        </>
      ) : (
        <path d={`M97,${n(lipY + 2)} Q120,${n(mid + 11)} 143,${n(lipY + 2)} Q120,${n(mid + 3)} 97,${n(lipY + 2)} Z`} fill={lipLo} />
      )}
      <ellipse cx={120} cy={n((gap > 3 ? mid + gap + 4 : mid + 7))} rx={12} ry={2.4} fill={hi} opacity={0.3} />
      <path data-testid="ef-mouth" d={`M92,${lipY} Q120,${n(mid)} 148,${lipY}`} fill="none" stroke={shadow} strokeWidth={1.4} opacity={0.7} />
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
    return editModelCostLabel(model);
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
