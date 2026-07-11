import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Sparkles, ChevronDown, SlidersHorizontal } from "lucide-react";
import { MediaImage } from "./MediaImage";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "./LLMModelPicker";
import type { MarkRef } from "../../../../shared/types";

/**
 * LibTV 三段式就地输入条的共享部件：
 * - ToolChip：顶部工具行的浅灰胶囊（＋参考 / 标记 / 风格 / 聚焦 / 运镜 / 特效…）
 * - RefThumbRow：参考图缩略行（编号角标 + hover 删除），与 LibTV 图 1-5 一致
 */
export function ToolChip({ icon, label, onClick, active, title, disabled }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="nodrag"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      title={title ?? label}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px",
        borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
        background: active ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 16%, var(--c-surface))" : "var(--c-surface)",
        border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd1)"}`,
        color: active ? "var(--c-t1)" : "var(--c-t2)",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => { if (!disabled && !active) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
      onMouseLeave={(e) => { if (!disabled && !active) (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
    >
      {icon}{label}
    </button>
  );
}

export function RefThumbRow({ images, onRemove, onClick, onDoubleClick }: {
  images: { id: string; url: string }[];
  onRemove?: (id: string) => void;
  /** 点缩略图（如插入「主体N」token / 放大查看）。 */
  onClick?: (index: number) => void;
  /** 双击缩略图（LibTV：聚焦至参考图来源节点）。 */
  onDoubleClick?: (index: number) => void;
}) {
  // 悬停自动放大预览（LibTV）：hover 缩略图在其上方浮出大图。
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // 双击检测用点击计时自实现（React Flow 节点内原生 dblclick 委托不可靠）；
  // 提供 onDoubleClick 时单击动作延迟 320ms 触发，双击则取消单击、直接聚焦。
  const lastClickRef = useRef<{ i: number; t: number }>({ i: -1, t: 0 });
  const clickTimerRef = useRef<number | null>(null);
  const handleThumbClick = (i: number) => {
    if (!onDoubleClick) { onClick?.(i); return; }
    const now = Date.now();
    if (lastClickRef.current.i === i && now - lastClickRef.current.t < 320) {
      if (clickTimerRef.current !== null) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      lastClickRef.current = { i: -1, t: 0 };
      onDoubleClick(i);
      return;
    }
    lastClickRef.current = { i, t: now };
    if (onClick) {
      if (clickTimerRef.current !== null) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => { clickTimerRef.current = null; onClick(i); }, 330);
    }
  };
  if (images.length === 0) return null;
  return (
    <div
      className="nodrag"
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      // 原生捕获层拦掉 dblclick：React 的 stopPropagation 挡不住 React Flow 在
      // pane 上的原生 d3 dblclick-zoom（NodeToolbar 不在节点元素内、不被 RF 豁免），
      // 双击缩略图会连带把画布放大——必须在冒泡到 pane 之前原生截断。
      ref={(el) => {
        if (el && !(el as HTMLDivElement & { _dblGuard?: boolean })._dblGuard) {
          (el as HTMLDivElement & { _dblGuard?: boolean })._dblGuard = true;
          el.addEventListener("dblclick", (e) => e.stopPropagation());
        }
      }}
    >
      {images.map((img, i) => (
        <div key={img.id} style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}
          onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx((v) => (v === i ? null : v))}>
          {hoverIdx === i && (
            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 60, width: 220, borderRadius: 12, overflow: "hidden", border: "1px solid var(--c-bd2)", background: "var(--c-base)", boxShadow: "0 14px 44px oklch(0 0 0 / 0.55)", pointerEvents: "none" }}>
              <MediaImage src={img.url} alt={`参考 ${i + 1} 预览`} style={{ display: "block", width: "100%", maxHeight: 260, objectFit: "contain", background: "var(--c-canvas)" }} />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleThumbClick(i); }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={`${onClick ? `图片 ${i + 1}（点击插入引用）` : `图片 ${i + 1}`}${onDoubleClick ? "，双击可聚焦至来源节点" : ""}`}
            style={{ width: "100%", height: "100%", padding: 0, border: "1px solid var(--c-bd2)", borderRadius: 10, overflow: "hidden", cursor: onClick ? "pointer" : "default", background: "var(--c-input)" }}
          >
            <MediaImage src={img.url} alt={`参考 ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </button>
          {/* 编号角标（与 LibTV 一致的左上角圆标） */}
          <span style={{ position: "absolute", top: -4, left: -4, width: 16, height: 16, borderRadius: "50%", background: "oklch(0.25 0.01 260)", border: "1px solid var(--c-bd3)", color: "#fff", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>{i + 1}</span>
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(img.id); }}
              title="移除该参考图"
              style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "oklch(0.3 0.02 260)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
            >
              <X size={9} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 标记分析模型偏好（全局持久化，视觉模型才有效；默认 gpt-5.2 与服务端一致）──
const MARK_MODEL_KEY = "canvas.markModel";
export function loadMarkModel(): string {
  try {
    const v = localStorage.getItem(MARK_MODEL_KEY);
    if (v) {
      const meta = LLM_MODELS.find((m) => m.id === v);
      // 静态模型须支持视觉；不在静态表里的 id 视为管理员自建模型（动态并入），放行
      if (!meta || meta.vision) return v;
    }
  } catch { /* SSR/隐私模式下不可用 */ }
  return "gpt-5.2";
}
export function saveMarkModel(v: string) {
  try { localStorage.setItem(MARK_MODEL_KEY, v); } catch { /* ignore */ }
}

/** 换选标记元素：按记录的 token 精确改写提示词（找不到 token 时追加新 token）。 */
export function switchMark(marks: MarkRef[], prompt: string, markId: string, newName: string): { prompt: string; markRefs: MarkRef[] } | null {
  const m = marks.find((x) => x.id === markId);
  if (!m || m.element === newName) return null;
  const newToken = m.token.endsWith(m.element)
    ? m.token.slice(0, m.token.length - m.element.length) + newName
    : newName;
  const nextPrompt = prompt.includes(m.token)
    ? prompt.replace(m.token, newToken)
    : `${prompt.trim()}${prompt.trim() ? " " : ""}${newToken} `;
  return { prompt: nextPrompt, markRefs: marks.map((x) => (x.id === markId ? { ...x, element: newName, token: newToken } : x)) };
}

/** 移除标记 chip：同时从提示词删除其 token（清理多余空格）。 */
export function removeMark(marks: MarkRef[], prompt: string, markId: string): { prompt: string; markRefs: MarkRef[] } {
  const m = marks.find((x) => x.id === markId);
  const nextPrompt = m && prompt.includes(m.token) ? prompt.replace(m.token, "").replace(/ {2,}/g, " ").trimStart() : prompt;
  return { prompt: nextPrompt, markRefs: marks.filter((x) => x.id !== markId) };
}

/** LibTV（创意模式）编辑系节点的「参数设置」切换行：收起态只显本行 + 预览/状态，
 *  点击展开完整参数区（与「高级」/快捷键 A 同源，用 useCreativeAdvanced 管理状态）。 */
export function AdvancedToggleRow({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      className="nodrag"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={(open ? "收起参数区" : "展开参数区") + " · 快捷键 A"}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "7px 0", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: "var(--c-surface)", border: "1px dashed var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}
    >
      <SlidersHorizontal size={12} />
      {open ? "收起参数" : "参数设置"}
    </button>
  );
}

/** LibTV「标记」元素选择浮层：AI 分析选中图片的可引用元素，点选后回调插入引用。
 *  传入 model/onModelChange 可切换分析用的视觉模型（换选即重新分析），并显示计费标注。 */
export function MarkElementPicker({ imageUrl, elements, loading, error, onSelect, onClose, model, onModelChange }: {
  imageUrl: string;
  elements: { name: string; desc?: string }[];
  loading: boolean;
  error?: string | null;
  onSelect: (name: string) => void;
  onClose: () => void;
  /** 分析用视觉模型（可选；提供后浮层内显示模型选择 + 计费标注）。 */
  model?: string;
  onModelChange?: (m: string) => void;
}) {
  const modelMeta = model ? LLM_MODELS.find((m) => m.id === model) : undefined;
  const costLabel = modelMeta
    ? (modelMeta.costNote ? `${modelMeta.costNote} 点/百万tokens` : `计费档：${modelMeta.costTier}（按 tokens）`)
    : (model ? "自建/自定义模型 · 按端点计费" : undefined);
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(420px, 90vw)", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 24px 60px oklch(0 0 0 / 0.55)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--c-bd1)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: "var(--c-t1)" }}>
            <Sparkles size={14} /> 选择要标记的元素
          </span>
          <button onClick={onClose} title="关闭"
            style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t3)", cursor: "pointer" }}>
            <X size={13} />
          </button>
        </div>
        {/* 分析模型选择 + 计费标注（换模型立即用新模型重新分析；仅视觉模型可选） */}
        {model && onModelChange && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--c-bd1)" }}>
            <span style={{ fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }}>分析模型</span>
            {/* 视觉模型 + 自建模型（自建是否支持读图由端点决定，交给用户选择；
                自带 key 的自定义 ChatGPT/Claude 本身带 vision 标记已包含） */}
            <LLMModelPicker value={model as LLMModelId} onChange={(v) => onModelChange(v)} disabled={loading}
              filter={(m) => !!m.vision || m.provider === "SelfHosted"} />
            {costLabel && <span style={{ fontSize: 10, color: "var(--c-t4)", marginLeft: "auto", whiteSpace: "nowrap" }}>{costLabel}</span>}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, padding: 14 }}>
          <div style={{ width: 120, flexShrink: 0, borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-bd2)", background: "var(--c-canvas)", alignSelf: "flex-start" }}>
            <MediaImage src={imageUrl} alt="标记源图" style={{ display: "block", width: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--c-t3)", padding: "12px 0" }}>
                <Loader2 size={14} className="animate-spin" /> AI 正在分析图中元素…
              </div>
            )}
            {!loading && error && <div style={{ fontSize: 12, color: "oklch(0.62 0.20 25)", padding: "8px 0" }}>{error}</div>}
            {!loading && !error && elements.map((el) => (
              <button key={el.name} onClick={() => onSelect(el.name)}
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "8px 11px", borderRadius: 10, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--ui-accent, var(--c-accent))"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd2)"; }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{el.name}</span>
                {el.desc && <span style={{ fontSize: 10.5, color: "var(--c-t3)" }}>{el.desc}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** LibTV「标记」常驻引用 chips 行：缩略图 + 当前元素名 + 下拉换选（同图其它候选元素）。
 *  嵌入提示词后仍可点 chip 换选（onSwitch 同步改写提示词 token），× 移除。
 *  下拉用节点内 in-DOM 绝对定位（节点处于 React Flow transform:scale 容器内，
 *  原生 select / portal 弹层都会错位——沿用 MiniSelect 的教训）。 */
export function MarkChipRow({ marks, onSwitch, onRemove }: {
  marks: MarkRef[];
  /** 换选元素：同步更新 markRefs 与提示词 token。 */
  onSwitch: (markId: string, newName: string) => void;
  onRemove: (markId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (marks.length === 0) return null;
  return (
    <div className="nodrag" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {marks.map((m) => {
        const open = openId === m.id;
        return (
          <div key={m.id} style={{ position: "relative" }}>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : m.id); }}
              title={`标记引用：${m.token}（点击换选该图其它元素）`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 9px 0 4px", borderRadius: 99, background: "var(--c-surface)", border: `1px solid ${open ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, color: "var(--c-t1)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              <span style={{ width: 22, height: 22, borderRadius: 99, overflow: "hidden", flexShrink: 0, background: "var(--c-input)" }}>
                <MediaImage src={m.url} alt={m.element} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </span>
              {m.element}
              <ChevronDown size={11} style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenId(null); onRemove(m.id); }}
              title="移除该标记引用（同时从提示词删除）"
              style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "oklch(0.3 0.02 260)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
            >
              <X size={9} />
            </button>
            {open && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 70, minWidth: 148, maxHeight: 220, overflowY: "auto", borderRadius: 12, background: "var(--c-base)", border: "1px solid var(--c-bd2)", boxShadow: "0 14px 44px oklch(0 0 0 / 0.55)", padding: 4 }}>
                {m.elements.map((el) => {
                  const cur = el.name === m.element;
                  return (
                    <button key={el.name}
                      onClick={(e) => { e.stopPropagation(); setOpenId(null); if (!cur) onSwitch(m.id, el.name); }}
                      title={el.desc || el.name}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", borderRadius: 8, background: cur ? "var(--c-elevated)" : "transparent", border: "none", color: cur ? "var(--c-t1)" : "var(--c-t2)", cursor: cur ? "default" : "pointer", fontSize: 12.5, fontWeight: cur ? 700 : 500, textAlign: "left" }}
                      onMouseEnter={(e) => { if (!cur) (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
                      onMouseLeave={(e) => { if (!cur) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{el.name}</span>
                      {cur && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-t3)", flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
