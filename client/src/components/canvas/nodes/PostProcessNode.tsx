import { memo, useCallback, useState, useMemo } from "react";
import { BaseNode } from "../BaseNode";
import { InlineGenBar } from "../InlineGenBar";
import { SlidersHorizontal } from "lucide-react";
import { useCreativeAdvanced } from "../../../hooks/useCreativeAdvanced";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import type { PostProcessNodeData } from "../../../../../shared/types";
import { POST_PROCESS_CATEGORIES, buildEffectPrompt, getEffectById } from "../../../lib/postProcessOptions";
import { toast } from "sonner";
import { copyTextWithToast } from "@/lib/clipboard";
import { trpc } from "@/lib/trpc";
import { getNodeImageOutput } from "@/lib/canvasPassthrough";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { sourceAspectRatio } from "../../../lib/imageAspect";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import { Loader2 } from "lucide-react";
import { Copy, ChevronDown, ChevronRight, X, Layers, Palette, Aperture, Gauge, Sun, PenTool, Camera, ArrowLeftRight, Film, Wind, Circle, Zap, Flower2, PenLine, ScanLine, Maximize, Building2, Globe, Combine, Sparkles, Timer, Activity, TrendingUp, CloudFog, Lightbulb, Waves, Sunrise, Moon, Brush, Stars, Grid2x2, MessageSquare, Droplet, Box, Monitor, Thermometer, CircleDot, Blend, Wand2, RotateCcw, Image, type LucideIcon } from "lucide-react";

const EFFECT_ICONS: Record<string, LucideIcon> = {
  Palette, Aperture, Gauge, Sun, PenTool, Camera, ArrowLeftRight,
  Film, Wind, Circle, Zap, Flower2, PenLine, ScanLine, Maximize,
  Building2, Globe, Combine, Sparkles, Timer, Activity, TrendingUp,
  CloudFog, Lightbulb, Waves, Sunrise, Moon, Brush, Stars, Grid2x2,
  MessageSquare, Droplet, Box, Monitor, Thermometer, CircleDot,
  Blend, Wand2, RotateCcw, Image, Layers,
};

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "post_process";
    title: string;
    payload: PostProcessNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.65 0.18 190)";
const accentA = (a: number) => `oklch(0.65 0.18 190 / ${a})`;

export const PostProcessNode = memo(function PostProcessNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;

  const selectedEffects: string[] = payload.selectedEffects ?? [];
  const intensities: Record<string, number> = payload.effectIntensities ?? {};

  const [activeCategory, setActiveCategory] = useState(POST_PROCESS_CATEGORIES[0].id);
  const [showPromptPreview, setShowPromptPreview] = useState(false);

  const activeCat = POST_PROCESS_CATEGORIES.find(c => c.id === activeCategory) ?? POST_PROCESS_CATEGORIES[0];

  // Compute generated prompt
  const generatedPrompt = useMemo(
    () => buildEffectPrompt(selectedEffects, intensities),
    [selectedEffects, intensities]
  );

  const toggleEffect = useCallback((effectId: string) => {
    const effect = getEffectById(effectId);
    if (!effect) return;

    let next: string[];
    if (selectedEffects.includes(effectId)) {
      next = selectedEffects.filter(e => e !== effectId);
    } else {
      // Remove incompatible effects
      const incompatible = effect.incompatibleWith ?? [];
      next = [...selectedEffects.filter(e => !incompatible.includes(e)), effectId];
    }
    const newPrompt = buildEffectPrompt(next, intensities);
    updateNodeData(id, { selectedEffects: next, generatedPrompt: newPrompt });
  }, [id, selectedEffects, intensities, updateNodeData]);

  const setIntensity = useCallback((effectId: string, value: number) => {
    const next = { ...intensities, [effectId]: value };
    const newPrompt = buildEffectPrompt(selectedEffects, next);
    updateNodeData(id, { effectIntensities: next, generatedPrompt: newPrompt });
  }, [id, selectedEffects, intensities, updateNodeData]);

  const removeEffect = useCallback((effectId: string) => {
    const next = selectedEffects.filter(e => e !== effectId);
    const newPrompt = buildEffectPrompt(next, intensities);
    updateNodeData(id, { selectedEffects: next, generatedPrompt: newPrompt });
  }, [id, selectedEffects, intensities, updateNodeData]);

  const copyPrompt = useCallback(() => {
    if (!generatedPrompt) { toast.error("尚未选择任何效果"); return; }
    void copyTextWithToast(generatedPrompt, "效果提示词已复制到剪贴板");
  }, [generatedPrompt]);

  const clearAll = useCallback(() => {
    updateNodeData(id, { selectedEffects: [], effectIntensities: {}, generatedPrompt: "" });
  }, [id, updateNodeData]);

  // ── #99 可执行化：检测上游图像 → 一键把已选效果应用为新图 ──────────────────────
  // 走 imageGen 参考图管线：t2i→i2i 自动切换与源图比例继承由 #89 全链路保障，
  // 结果落 outputUrl 并向下游参考图传播——后处理从「提示词生成器」升级为真正的执行节点。
  const { ppEdges, ppNodes } = useCanvasStore(useShallow((s) => ({ ppEdges: s.edges, ppNodes: s.nodes })));
  const srcUrl = useMemo(() => {
    for (const e of ppEdges.filter((e) => e.target === id)) {
      const src = ppNodes.find((n) => n.id === e.source);
      if (!src) continue;
      const url = getNodeImageOutput(src.data.nodeType, src.data.payload as Record<string, unknown>);
      if (url) return url;
    }
    return payload.inputImageUrl?.trim() || undefined;
  }, [ppEdges, ppNodes, id, payload.inputImageUrl]);
  const [applyModel, setApplyModel] = useState("");
  const applyMut = trpc.imageGen.generate.useMutation({
    onSuccess: (r) => {
      const url = r.url ?? r.urls?.[0];
      if (!url) { updateNodeData(id, { status: "failed", errorMessage: "未返回结果图像" }); toast.error("应用效果失败：未返回图像"); return; }
      updateNodeData(id, { outputUrl: url, status: "done", errorMessage: undefined });
      propagateRefImage(id, url);
      toast.success("效果已应用，结果图已生成");
    },
    onError: (err) => { updateNodeData(id, { status: "failed", errorMessage: err.message }); toast.error("应用效果失败：" + err.message); },
  });
  const isApplying = payload.status === "processing" || applyMut.isPending;
  const handleApply = useCallback(async () => {
    if (isApplying) return;
    if (!srcUrl) { toast.error("请先连接上游图像节点（图像生成/素材/分镜等）"); return; }
    if (!generatedPrompt) { toast.error("请先选择至少一个效果"); return; }
    updateNodeData(id, { status: "processing", errorMessage: undefined });
    const ar = await sourceAspectRatio(srcUrl); // 结果必须继承源图画幅
    applyMut.mutate({
      prompt: `Apply the following post-processing effects to the reference image, keeping the subject, composition and content strictly identical — change only the visual treatment: ${generatedPrompt}`,
      referenceImageUrl: srcUrl,
      ...(ar ? { aspectRatio: ar, poyoAspectRatio: ar, reveAspectRatio: ar } : {}),
      ...(data.projectId ? { projectId: data.projectId } : {}),
      ...(applyModel ? { model: applyModel, estimatedCost: costEstimateLabel(estimateImageCost(applyModel)) || "按模型页" } : {}),
    } as Parameters<typeof applyMut.mutate>[0]);
  }, [isApplying, srcUrl, generatedPrompt, id, data.projectId, applyModel, applyMut, updateNodeData]);
  const canApply = !!srcUrl && !!generatedPrompt && !isApplying;
  const applySection = (
    <div className="flex flex-col gap-2" style={{ padding: "10px 12px", borderTop: "1px solid var(--c-bd1)" }}>
      <div className="flex items-center gap-2">
        <ModelPicker value={applyModel} onChange={setApplyModel} disabled={isApplying} minWidth={150} accent={accent}
          options={[{ value: "", label: "默认模型（系统设置）", group: "默认", family: "默认" }, ...IMAGE_MODEL_PICKER_OPTIONS]} />
        <span style={{ fontSize: 10, color: "var(--c-t4)", marginLeft: "auto", whiteSpace: "nowrap" }}>
          {applyModel ? (costEstimateLabel(estimateImageCost(applyModel)) || "按模型页") : "按系统默认模型"}
        </span>
      </div>
      <button onClick={() => void handleApply()} disabled={!canApply}
        title={!srcUrl ? "请先连接上游图像节点" : !generatedPrompt ? "请先选择效果" : isApplying ? "生成中…" : "把已选效果应用到上游图像，生成结果图"}
        className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
        style={{ background: !canApply ? "var(--c-surface)" : accentA(0.15), border: `1px solid ${!canApply ? "var(--c-bd2)" : accentA(0.5)}`, color: !canApply ? "var(--c-t4)" : accent, cursor: !canApply ? "not-allowed" : "pointer" }}>
        {isApplying ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Wand2 style={{ width: 12, height: 12 }} />}
        {isApplying ? "应用效果生成中..." : `应用效果到上游图像${selectedEffects.length ? `（已选 ${selectedEffects.length}）` : ""}`}
      </button>
      {payload.status === "failed" && payload.errorMessage && (
        <p style={{ fontSize: 10, color: "oklch(0.62 0.20 25)", margin: 0 }}>{payload.errorMessage}</p>
      )}
    </div>
  );

  const expanded = Boolean(selected) || Boolean((payload as { pinned?: boolean }).pinned);

  // #97 LibTV：创意模式参数下浮（高级机制，快捷键 A）。
  const { isCreativeMode, advancedOpen, setAdvancedOpen } = useCreativeAdvanced(selected);
  // 配置区单一来源：非创意内联卡体（原样）；创意模式挂输入条「参数与操作」下浮面板。
  const configBody = (
    <>

        {/* ── Category tab bar ── */}
        <div
          className="flex gap-0.5 px-2 py-1.5 overflow-x-auto"
          style={{ borderBottom: `1px solid var(--c-bd1)`, background: "var(--c-base)" }}
        >
          {POST_PROCESS_CATEGORIES.map(cat => {
            const active = cat.id === activeCategory;
            const selectedCount = cat.effects.filter(e => selectedEffects.includes(e.id)).length;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all flex-shrink-0"
                style={{
                  background: active ? `${cat.color}20` : "transparent",
                  border: active ? `1px solid ${cat.color}45` : "1px solid transparent",
                  color: active ? cat.color : "var(--c-t4)",
                  position: "relative",
                }}
              >
                {(() => { const I = EFFECT_ICONS[cat.icon]; return I ? <I style={{ width: 11, height: 11, flexShrink: 0 }} /> : null; })()}
                <span className="hidden sm:inline">{cat.label}</span>
                {selectedCount > 0 && (
                  <span
                    style={{
                      minWidth: 14, height: 14, borderRadius: 7, fontSize: 8, fontWeight: 700,
                      background: cat.color, color: "oklch(0.98 0 0)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "0 3px",
                    }}
                  >
                    {selectedCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Effect grid for active category ── */}
        <div className="p-2.5" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {activeCat.effects.map(effect => {
              const isSelected = selectedEffects.includes(effect.id);
              const catColor = activeCat.color;
              const intensity = intensities[effect.id] ?? 0.6;
              return (
                <div key={effect.id} className="flex flex-col gap-1">
                  <button
                    onClick={() => toggleEffect(effect.id)}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-all"
                    style={{
                      background: isSelected ? `${catColor}18` : "var(--c-input)",
                      border: isSelected ? `1.5px solid ${catColor}50` : "1px solid var(--c-bd1)",
                      color: isSelected ? catColor : "var(--c-t3)",
                      cursor: "pointer",
                    }}
                    title={effect.description}
                  >
                    {(() => { const I = EFFECT_ICONS[effect.icon]; return I ? <I style={{ width: 10, height: 10, flexShrink: 0 }} /> : null; })()}
                    <span style={{ fontSize: 10, fontWeight: isSelected ? 600 : 400, lineHeight: 1.3 }}>
                      {effect.label}
                    </span>
                    {isSelected && (
                      <div
                        style={{
                          marginLeft: "auto", width: 6, height: 6, borderRadius: "50%",
                          background: catColor, flexShrink: 0,
                        }}
                      />
                    )}
                  </button>
                  {/* Intensity slider — only for selected effects with hasIntensity */}
                  {isSelected && effect.hasIntensity && (
                    <div className="flex items-center gap-1.5 px-2">
                      <span style={{ fontSize: 9, color: "var(--c-t4)", flexShrink: 0 }}>
                        {effect.intensityLabel ?? "强度"}
                      </span>
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={intensity}
                        onChange={e => setIntensity(effect.id, parseFloat(e.target.value))}
                        className="flex-1"
                        style={{ height: 3, accentColor: catColor }}
                      />
                      <span style={{ fontSize: 9, color: "var(--c-t4)", width: 24, textAlign: "right", flexShrink: 0 }}>
                        {Math.round(intensity * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Selected effects chips ── */}
        <div className="px-2.5 py-2" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>
              已选效果 {selectedEffects.length > 0 ? `(${selectedEffects.length})` : ""}
            </span>
            {selectedEffects.length > 0 && (
              <button
                onClick={clearAll}
                style={{ fontSize: 9, color: "oklch(0.45 0.012 25)", cursor: "pointer", background: "none", border: "none" }}  /* warm-hue, intentional */
              >
                清除全部
              </button>
            )}
          </div>
          {selectedEffects.length === 0 ? (
            <div style={{ fontSize: 10, color: "var(--c-t4)", fontStyle: "italic", textAlign: "center", padding: "6px 0" }}>
              点击上方效果开始选择 →
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {selectedEffects.map(eid => {
                const effect = getEffectById(eid);
                if (!effect) return null;
                const cat = POST_PROCESS_CATEGORIES.find(c => c.effects.some(e => e.id === eid));
                return (
                  <span
                    key={eid}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px]"
                    style={{
                      background: cat ? `${cat.color}18` : accentA(0.12),
                      border: `1px solid ${cat ? `${cat.color}35` : accentA(0.30)}`,
                      color: cat?.color ?? accent,
                    }}
                  >
                    {(() => { const I = EFFECT_ICONS[effect.icon]; return I ? <I style={{ width: 8, height: 8 }} /> : null; })()}
                    {effect.label}
                    <button
                      onClick={() => removeEffect(eid)}
                      style={{ lineHeight: 0, background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.7, marginLeft: 1 }}
                    >
                      <X style={{ width: 8, height: 8 }} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Prompt preview ── */}
        <div className="px-2.5 py-2">
          <button
            onClick={() => setShowPromptPreview(p => !p)}
            className="flex items-center gap-1.5 w-full"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-t4)", textAlign: "left" }}
          >
            {showPromptPreview ? <ChevronDown style={{ width: 10, height: 10 }} /> : <ChevronRight style={{ width: 10, height: 10 }} />}
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              效果提示词预览
            </span>
            {generatedPrompt && (
              <Layers style={{ width: 9, height: 9, color: accent, marginLeft: "auto" }} />
            )}
          </button>

          {showPromptPreview && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              <div
                className="rounded-lg p-2"
                style={{ background: "var(--c-input)", border: accentA(0.20) + " 1px solid", minHeight: 40 }}
              >
                <p style={{ fontSize: 10, color: generatedPrompt ? "var(--c-t2)" : "var(--c-t4)", lineHeight: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {generatedPrompt || "— 选择效果后自动生成 —"}
                </p>
              </div>
              {generatedPrompt && (
                <div className="flex gap-1.5">
                  <button
                    onClick={copyPrompt}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium transition-all"
                    style={{ background: accentA(0.12), border: `1px solid ${accentA(0.35)}`, color: accent, cursor: "pointer" }}
                  >
                    <Copy style={{ width: 10, height: 10 }} />
                    复制效果词
                  </button>
                  <div
                    style={{ fontSize: 9, color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 3, background: accentA(0.06), border: `1px solid ${accentA(0.15)}`, borderRadius: 8, padding: "0 8px" }}
                  >
                    复制提示词注入视频/图像节点
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
    </>
  );

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="post_process" title={data.title} minHeight={320} resizable
      onRun={() => void handleApply()} running={isApplying} canRun={!!srcUrl && !!generatedPrompt} hasResult={!!payload.outputUrl}
      heroMedia={payload.outputUrl ? <img src={payload.outputUrl} alt="后处理结果" style={{ width: "100%", height: "auto", display: "block" }} /> : undefined}>
      <div
        style={{
          overflow: "hidden",
          maxHeight: expanded ? "9999px" : "0px",
          transition: expanded
            ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
            : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
        }}
      >
      <div className="flex flex-col nodrag" style={{ userSelect: "none" }}>
        {!isCreativeMode ? (<>{configBody}{applySection}</>) : <div style={{ padding: "12px 14px", fontSize: 11.5, color: "var(--c-t3)" }}>已选 {selectedEffects.length} 个效果 — 选中节点后在下方浮动面板中选择与应用</div>}
      </div>
      </div>{/* end collapse wrapper */}
    </BaseNode>
    {/* ── #97 LibTV（创意模式）就地输入条：参数与操作下浮面板（屏幕恒定） ── */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={!!selected} width={440}>
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t2)", whiteSpace: "nowrap" }}>后处理</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>效果类别 / 强度 / 提示词预览</span>
          <button className="nodrag" onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起参数面板" : "展开参数与操作面板（浮现于输入条下方，不撑开节点卡体）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
            <SlidersHorizontal size={12} /> 参数与操作
          </button>
        </div>
        {advancedOpen && (
          <div className="nodrag nowheel flex flex-col" style={{ gap: 12, maxHeight: "52vh", overflowY: "auto", overscrollBehavior: "contain", paddingTop: 10, marginTop: 4, borderTop: "1px solid var(--c-bd1)" }}>
            {configBody}
            {applySection}
          </div>
        )}
      </InlineGenBar>
    )}
    </>
  );
});
