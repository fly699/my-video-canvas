import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X, RotateCcw, Loader2, Send, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Upload, Coins } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ModelPicker, type ModelPickerOption } from "../ModelPicker";
import { IMAGE_EDIT_MODEL_GROUPS, DEFAULT_IMAGE_EDIT_MODEL, buildImageEditInstruction, comfyDenoiseForOp } from "../../../../../shared/imageEdit";
import { COMFY_LOCAL_MODEL, COMFY_LOCAL_OPTION, loadComfyCkpt } from "../../../lib/comfyLocalRoute";
import { ComfyCkptSelect } from "../ComfyCkptSelect";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import {
  ANGLE_PRESETS, buildAnglePrompt, shotLabelForZoom, type AngleParams,
  RELIGHT_PRESETS, RELIGHT_DEFAULTS, LIGHT_DIRECTIONS, buildRelightPrompt, type RelightParams,
} from "../../../lib/angleRelight";

// #72 LibTV 多角度 / 打光 全功能编辑器（全模式，从节点工具条进入）。
// 生成走 imageEdit.run（reangle / relight）→ 结果写回节点结果字段 →
// useResultHistoryCapture 自动把旧图押入版本历史。

export interface AngleRelightProps {
  sourceUrl: string;
  nodeId: string;
  projectId: number;
  onApply: (url: string) => void;
  onClose: () => void;
}

// ── 共用小件 ─────────────────────────────────────────────────────────────────

const MODEL_KEY = "canvas.angleRelightModel";
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

function useCostLabel(model: string): string {
  return useMemo(() => {
    if (model === COMFY_LOCAL_MODEL) return "自建 · 免云端积分";
    const c = estimateImageCost(model || DEFAULT_IMAGE_EDIT_MODEL);
    return c ? costEstimateLabel(c) : "按模型页";
  }, [model]);
}

const shell: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 320, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0.05 0.007 260 / 0.72)", backdropFilter: "blur(8px)" };
const card: React.CSSProperties = { width: 700, maxWidth: "94vw", maxHeight: "92vh", overflowY: "auto", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const ttl: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: "var(--c-t1)" };
const sub: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--c-t4)", textTransform: "uppercase", letterSpacing: "0.05em" };
const chip = (active?: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, padding: "5px 11px", borderRadius: 8, cursor: "pointer",
  border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`,
  background: active ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: active ? "#0b0d12" : "var(--c-t3)", fontWeight: active ? 700 : 500,
});
const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" };

function SliderRow({ label, value, min, max, step = 1, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 62, fontSize: 11.5, color: "var(--c-t3)", flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--ui-accent, var(--c-accent))", cursor: "pointer" }} />
      <input type="number" min={min} max={max} step={step} value={Math.round(value)}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        style={{ width: 54, padding: "3px 6px", fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums", background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 6, outline: "none" }} />
      {suffix && <span style={{ fontSize: 10.5, color: "var(--c-t4)", width: 14 }}>{suffix}</span>}
    </div>
  );
}

/** 球面控件：中心缩略图 + 线框球 + 可拖拽定位点（水平→环绕角偏移，垂直→俯仰/仰角）。
 *  front=true 渲染为正面平面圆（打光的「正面」视图），false 为透视线框球。 */
function SphereControl({ az, el, onDrag, thumb, size = 190, front = false, dotColor }: {
  az: number; el: number; onDrag: (az: number, el: number) => void;
  thumb?: string; size?: number; front?: boolean; dotColor?: string;
}) {
  const R = size / 2;
  const wrap180 = (v: number) => { let x = ((v + 180) % 360 + 360) % 360 - 180; return x; };
  // 线性盘面映射：x = 环绕角（前半球 ±120° 可拖，全程用滑杆），y = 俯仰 ±90°
  const px = Math.max(-120, Math.min(120, wrap180(az))) / 120 * R * 0.88;
  const py = -Math.max(-90, Math.min(90, el)) / 90 * R * 0.88;
  const dragging = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const apply = (clientX: number, clientY: number) => {
    const r = rootRef.current?.getBoundingClientRect(); if (!r) return;
    const dx = (clientX - (r.left + R)) / (R * 0.88), dy = (clientY - (r.top + R)) / (R * 0.88);
    const nAz = Math.max(-120, Math.min(120, dx * 120));
    const nEl = Math.max(-90, Math.min(90, -dy * 90));
    onDrag(Math.round(((nAz % 360) + 360) % 360), Math.round(nEl));
  };
  return (
    <div ref={rootRef} data-testid="sphere-control"
      onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); apply(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (dragging.current) apply(e.clientX, e.clientY); }}
      onPointerUp={() => { dragging.current = false; }}
      style={{ position: "relative", width: size, height: size, borderRadius: "50%", flexShrink: 0, cursor: "crosshair", touchAction: "none",
        background: front ? "radial-gradient(circle at 50% 42%, oklch(0.32 0.02 260), oklch(0.16 0.015 260))" : "radial-gradient(circle at 38% 32%, oklch(0.34 0.02 260), oklch(0.14 0.015 260))",
        border: "1px solid var(--c-bd2)", boxShadow: "inset 0 0 30px oklch(0 0 0 / 0.35)" }}>
      {/* 线框（纬线 + 经线） */}
      <svg width={size} height={size} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.55 }}>
        {front ? (
          <>
            <circle cx={R} cy={R} r={R * 0.62} fill="none" stroke="var(--c-bd2)" />
            <circle cx={R} cy={R} r={R * 0.3} fill="none" stroke="var(--c-bd2)" />
            <line x1={R} y1={6} x2={R} y2={size - 6} stroke="var(--c-bd2)" />
            <line x1={6} y1={R} x2={size - 6} y2={R} stroke="var(--c-bd2)" />
          </>
        ) : (
          <>
            {[0.28, 0.55, 0.8].map((f) => (
              <ellipse key={`lat${f}`} cx={R} cy={R} rx={R * 0.92} ry={R * 0.92 * f} fill="none" stroke="var(--c-bd2)" />
            ))}
            {[0.28, 0.62].map((f) => (
              <ellipse key={`lon${f}`} cx={R} cy={R} rx={R * 0.92 * f} ry={R * 0.92} fill="none" stroke="var(--c-bd2)" />
            ))}
            <circle cx={R} cy={R} r={R * 0.92} fill="none" stroke="var(--c-bd2)" />
          </>
        )}
      </svg>
      {/* 中心缩略图（源图） */}
      {thumb && (
        <img src={thumb} alt="src" draggable={false}
          style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: size * 0.36, height: size * 0.36, objectFit: "cover", borderRadius: "50%", border: "2px solid var(--c-bd2)", pointerEvents: "none", opacity: 0.95 }} />
      )}
      {/* 定位点 */}
      <span data-testid="sphere-dot" style={{ position: "absolute", left: R + px - 8, top: R + py - 8, width: 16, height: 16, borderRadius: "50%", background: dotColor ?? "var(--ui-accent, var(--c-accent))", border: "2.5px solid #fff", boxShadow: "0 0 10px oklch(0 0 0 / 0.5), 0 0 14px currentColor", pointerEvents: "none" }} />
    </div>
  );
}

// ── 多角度编辑器 ─────────────────────────────────────────────────────────────

export function MultiAngleEditor({ sourceUrl, nodeId, projectId, onApply, onClose }: AngleRelightProps) {
  const [presetKey, setPresetKey] = useState("custom");
  const [params, setParams] = useState<AngleParams>({ yaw: 0, pitch: 0, zoom: 40 });
  const [promptOn, setPromptOn] = useState(true);
  const [override, setOverride] = useState<string | null>(null);
  const [model, setModel] = useState(loadModel);
  const auto = useMemo(() => buildAnglePrompt(params, presetKey), [params, presetKey]);
  const promptText = override ?? auto;
  const costLabel = useCostLabel(model);
  const run = trpc.imageEdit.run.useMutation();
  const comfyGen = trpc.comfyui.generateImage.useMutation();

  const setP = useCallback((p: Partial<AngleParams>) => { setParams((s) => ({ ...s, ...p })); setPresetKey((k) => (k === "custom" ? k : "custom")); setOverride(null); }, []);
  const applyPreset = (key: string) => {
    const preset = ANGLE_PRESETS.find((x) => x.key === key); if (!preset) return;
    setPresetKey(key);
    if (key !== "custom") setParams(preset.params);
    setOverride(null);
  };
  const reset = () => { setPresetKey("custom"); setParams({ yaw: 0, pitch: 0, zoom: 40 }); setOverride(null); };
  const nudge = (dyaw: number, dpitch: number) => setP({ yaw: ((params.yaw + dyaw) % 360 + 360) % 360, pitch: Math.max(-90, Math.min(90, params.pitch + dpitch)) });

  const send = async () => {
    if (run.isPending || comfyGen.isPending) return;
    try {
      let url: string | undefined;
      if (model === COMFY_LOCAL_MODEL) {
        // #77 本地自建：走 comfyui img2img（服务端 assertComfyuiAllowed 门控 + comfyui_image_gen 审计）
        const ckpt = loadComfyCkpt();
        if (!ckpt) { toast.error("请先在下方选择本地 ComfyUI 的 checkpoint 模型"); return; }
        const r = await comfyGen.mutateAsync({
          nodeId, projectId, workflowTemplate: "img2img", ckpt,
          prompt: buildImageEditInstruction("reangle", promptText).slice(0, 2000),
          referenceImageUrl: sourceUrl, denoise: comfyDenoiseForOp("reangle"),
        });
        url = r.url;
      } else {
        const r = await run.mutateAsync({
          sourceImageUrl: sourceUrl, operation: "reangle", model: model || undefined,
          prompt: promptText.slice(0, 900), estimatedCost: costLabel,
          ...(projectId ? { projectId } : {}),
        });
        url = (r as { url?: string }).url;
      }
      if (!url) throw new Error("模型未返回图片");
      onApply(url);
      toast.success("多角度已生成，原图已存入版本历史");
      onClose();
    } catch (e) { toast.error("多角度生成失败：" + (e instanceof Error ? e.message : String(e))); }
  };

  return (
    <div className="nodrag nowheel" style={shell} onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={ttl}>📐 多角度 · 换机位重拍</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>同一主体与场景，换个机位角度</span>
          <div style={{ flex: 1 }} />
          <button onClick={reset} style={{ ...chip() }} title="恢复默认参数"><RotateCcw size={11} /> 重置参数</button>
          <button onClick={onClose} style={iconBtn}><X size={13} /></button>
        </div>

        {/* 预设 tabs */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ANGLE_PRESETS.map((p) => (
            <button key={p.key} onClick={() => applyPreset(p.key)} style={chip(presetKey === p.key)}>{p.label}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {/* 球面控件 + 四向微调 */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <button onClick={() => nudge(0, 5)} style={iconBtn} title="俯拍 +5°"><ArrowUp size={13} /></button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => nudge(-5, 0)} style={iconBtn} title="环绕 −5°"><ArrowLeft size={13} /></button>
              <SphereControl az={params.yaw} el={params.pitch} thumb={sourceUrl}
                onDrag={(az, el) => setP({ yaw: az, pitch: el })} />
              <button onClick={() => nudge(5, 0)} style={iconBtn} title="环绕 +5°"><ArrowRight size={13} /></button>
            </div>
            <button onClick={() => nudge(0, -5)} style={iconBtn} title="仰拍 +5°"><ArrowDown size={13} /></button>
          </div>
          {/* 滑杆组 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <SliderRow label="水平环绕" value={params.yaw} min={0} max={360} suffix="°" onChange={(v) => setP({ yaw: v })} />
            <SliderRow label="垂直俯仰" value={params.pitch} min={-90} max={90} suffix="°" onChange={(v) => setP({ pitch: v })} />
            <SliderRow label="景别缩放" value={params.zoom} min={0} max={100} onChange={(v) => setP({ zoom: v })} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--c-t4)", padding: "0 66px 0 72px" }}>
              <span>全景</span><span>中景</span><span>近景</span><span>特写</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--c-t3)" }}>当前：{shotLabelForZoom(params.zoom)} · 环绕 {Math.round(params.yaw)}° · 俯仰 {Math.round(params.pitch)}°</div>
          </div>
        </div>

        {/* 提示词开关 + 可编辑描述 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--c-t3)", cursor: "pointer" }}>
            <input type="checkbox" checked={promptOn} onChange={(e) => setPromptOn(e.target.checked)} style={{ accentColor: "var(--ui-accent, var(--c-accent))" }} />
            提示词（按参数自动生成，可编辑）
          </label>
          {promptOn && (
            <textarea value={promptText} onChange={(e) => setOverride(e.target.value)} rows={2}
              style={{ width: "100%", resize: "vertical", padding: "8px 10px", fontSize: 12, lineHeight: 1.6, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none" }} />
          )}
        </div>

        {/* 底部：模型 + 积分 + 发送 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--c-bd1)", paddingTop: 10 }}>
          <ModelPicker value={model} onChange={(v) => { setModel(v); saveModel(v); }} options={EDIT_MODEL_OPTIONS} minWidth={200} />
          <ComfyCkptSelect enabled={model === COMFY_LOCAL_MODEL} width={160} />
          <div style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-t3)", whiteSpace: "nowrap" }} title="预计消耗（按所选编辑模型估算）">
            <Coins size={12} /> {costLabel}
          </span>
          <button onClick={() => void send()} disabled={run.isPending || comfyGen.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 9, border: "none", cursor: (run.isPending || comfyGen.isPending) ? "wait" : "pointer", background: "var(--ui-accent, var(--c-accent))", color: "#0b0d12", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", opacity: (run.isPending || comfyGen.isPending) ? 0.7 : 1 }}>
            {(run.isPending || comfyGen.isPending) ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {(run.isPending || comfyGen.isPending) ? "生成中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 打光编辑器 ───────────────────────────────────────────────────────────────

export function RelightEditor({ sourceUrl, nodeId, projectId, onApply, onClose }: AngleRelightProps) {
  const [view, setView] = useState<"persp" | "front">("persp");
  const [params, setParams] = useState<RelightParams>({ ...RELIGHT_DEFAULTS });
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [refUrl, setRefUrl] = useState<string>("");
  const [model, setModel] = useState(loadModel);
  const refInput = useRef<HTMLInputElement>(null);
  const uploadMut = trpc.upload.uploadImage.useMutation();
  const run = trpc.imageEdit.run.useMutation();
  const comfyGen = trpc.comfyui.generateImage.useMutation();
  const auto = useMemo(() => buildRelightPrompt(params, presetKey ?? undefined), [params, presetKey]);
  const promptText = override ?? auto;
  const costLabel = useCostLabel(model);

  const setP = useCallback((p: Partial<RelightParams>) => { setParams((s) => ({ ...s, ...p })); setOverride(null); }, []);
  // 手动动方位/智能文字视为脱离预设；亮度/颜色/轮廓光是叠加项，保留预设
  const setDir = (azimuth: number, elevation: number) => { setPresetKey(null); setP({ azimuth, elevation }); };
  const reset = () => { setParams({ ...RELIGHT_DEFAULTS }); setPresetKey(null); setOverride(null); setRefUrl(""); };

  const onRefFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = () => rej(new Error("读取失败")); r.readAsDataURL(file); });
      const r = await uploadMut.mutateAsync({ base64: b64, mimeType: file.type, filename: file.name });
      setRefUrl(r.url);
      toast.success("已设为光效参考图");
    } catch (err) { toast.error("参考图上传失败：" + (err instanceof Error ? err.message : String(err))); }
  };

  const send = async () => {
    if (run.isPending || comfyGen.isPending) return;
    try {
      let url: string | undefined;
      if (model === COMFY_LOCAL_MODEL) {
        const ckpt = loadComfyCkpt();
        if (!ckpt) { toast.error("请先在下方选择本地 ComfyUI 的 checkpoint 模型"); return; }
        const r = await comfyGen.mutateAsync({
          nodeId, projectId, workflowTemplate: "img2img", ckpt,
          prompt: buildImageEditInstruction("relight", promptText).slice(0, 2000),
          referenceImageUrl: sourceUrl, denoise: comfyDenoiseForOp("relight"),
        });
        url = r.url;
      } else {
        const r = await run.mutateAsync({
          sourceImageUrl: sourceUrl, operation: "relight", model: model || undefined,
          prompt: promptText.slice(0, 900), estimatedCost: costLabel,
          ...(projectId ? { projectId } : {}),
          ...(refUrl ? { refImageUrl: refUrl } : {}),
        });
        url = (r as { url?: string }).url;
      }
      if (!url) throw new Error("模型未返回图片");
      onApply(url);
      toast.success("打光已生成，原图已存入版本历史");
      onClose();
    } catch (e) { toast.error("打光生成失败：" + (e instanceof Error ? e.message : String(e))); }
  };

  return (
    <div className="nodrag nowheel" style={shell} onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={ttl}>💡 打光效果</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>只改光照，内容与构图不变</span>
          <div style={{ flex: 1 }} />
          <button onClick={reset} style={{ ...chip() }} title="恢复默认参数"><RotateCcw size={11} /> 重置参数</button>
          <button onClick={onClose} style={iconBtn}><X size={13} /></button>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {/* 左：光源球面控件（透视/正面双视图） */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {([["persp", "透视"], ["front", "正面"]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setView(k)} style={chip(view === k)}>{lbl}</button>
              ))}
            </div>
            <SphereControl az={params.azimuth} el={params.elevation} front={view === "front"} thumb={view === "front" ? sourceUrl : undefined}
              dotColor={params.color || "#ffd66b"} onDrag={(az, el) => setDir(az, el)} />
            {/* 主光源六方位 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, width: 190 }}>
              {LIGHT_DIRECTIONS.map((d) => (
                <button key={d.key} onClick={() => setDir(d.azimuth, d.elevation)}
                  style={chip(Math.abs(params.azimuth - d.azimuth) < 1 && Math.abs(params.elevation - d.elevation) < 1)}>{d.label}</button>
              ))}
            </div>
          </div>

          {/* 右：全局参数 + 智能模式 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={sub}>全局</div>
            <SliderRow label="亮度" value={params.brightness} min={0} max={200} suffix="%" onChange={(v) => setP({ brightness: v })} />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 62, fontSize: 11.5, color: "var(--c-t3)" }}>颜色</span>
              <input type="color" value={params.color || "#ffffff"} onChange={(e) => setP({ color: e.target.value })}
                style={{ width: 54, height: 26, padding: 0, background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, cursor: "pointer" }} />
              {params.color ? (
                <button onClick={() => setP({ color: "" })} style={{ ...chip() }}>清除（不指定）</button>
              ) : <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>未指定（保持原色温）</span>}
              <div style={{ flex: 1 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--c-t3)", cursor: "pointer" }}>
                <input type="checkbox" checked={params.rimLight} onChange={(e) => setP({ rimLight: e.target.checked })} style={{ accentColor: "var(--ui-accent, var(--c-accent))" }} />
                轮廓光
              </label>
            </div>
            <div style={sub}>智能模式</div>
            <textarea value={params.smartText ?? ""} onChange={(e) => { setPresetKey(null); setP({ smartText: e.target.value }); }}
              placeholder="描述想要的打光效果或情绪风格，如「深夜便利店冷白灯光，孤独感」"
              rows={2} style={{ width: "100%", resize: "vertical", padding: "8px 10px", fontSize: 12, lineHeight: 1.6, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => refInput.current?.click()} disabled={uploadMut.isPending} style={{ ...chip() }} title="上传一张参考图，让模型匹配它的光照氛围">
                {uploadMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} 光效参考图
              </button>
              {refUrl && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <img src={refUrl} alt="ref" style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 6, border: "1px solid var(--c-bd2)" }} />
                  <button onClick={() => setRefUrl("")} style={{ ...iconBtn, width: 20, height: 20 }}><X size={10} /></button>
                </span>
              )}
              <input ref={refInput} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void onRefFile(e)} />
            </div>
          </div>
        </div>

        {/* 预设网格 8 款 */}
        <div style={sub}>预设</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {RELIGHT_PRESETS.map((p) => (
            <button key={p.key} onClick={() => { setPresetKey(p.key); setOverride(null); }} title={p.prompt}
              style={{ position: "relative", height: 52, borderRadius: 9, overflow: "hidden", cursor: "pointer", border: `2px solid ${presetKey === p.key ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: p.swatch, padding: 0 }}>
              <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "3px 6px", fontSize: 10.5, fontWeight: 700, color: "#fff", background: "linear-gradient(transparent, oklch(0 0 0 / 0.66))", textAlign: "left" }}>{p.label}</span>
            </button>
          ))}
        </div>

        {/* 生成描述（可编辑） */}
        <textarea value={promptText} onChange={(e) => setOverride(e.target.value)} rows={2}
          style={{ width: "100%", resize: "vertical", padding: "8px 10px", fontSize: 12, lineHeight: 1.6, background: "var(--c-input)", color: "var(--c-t2)", border: "1px dashed var(--c-bd2)", borderRadius: 8, outline: "none" }} />

        {/* 底部：模型 + 积分 + 发送 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--c-bd1)", paddingTop: 10 }}>
          <ModelPicker value={model} onChange={(v) => { setModel(v); saveModel(v); }} options={EDIT_MODEL_OPTIONS} minWidth={200} />
          <ComfyCkptSelect enabled={model === COMFY_LOCAL_MODEL} width={160} />
          <div style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-t3)", whiteSpace: "nowrap" }} title="预计消耗（按所选编辑模型估算）">
            <Coins size={12} /> {costLabel}
          </span>
          <button onClick={() => void send()} disabled={run.isPending || comfyGen.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 9, border: "none", cursor: (run.isPending || comfyGen.isPending) ? "wait" : "pointer", background: "var(--ui-accent, var(--c-accent))", color: "#0b0d12", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", opacity: (run.isPending || comfyGen.isPending) ? 0.7 : 1 }}>
            {(run.isPending || comfyGen.isPending) ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {(run.isPending || comfyGen.isPending) ? "生成中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
