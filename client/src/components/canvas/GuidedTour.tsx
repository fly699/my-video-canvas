import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useGuideStore } from "../../hooks/useGuideStore";
import { GUIDE_STEPS, type TourStep } from "../../lib/guideSteps";

/**
 * 自研 spotlight 交互式新手导览：全屏调暗 + 镂空高亮当前目标元素 + 跟随卡片。
 * 零第三方依赖、用 var(--c-*) 主题令牌，深浅色/15 套主题自适应。
 *
 * - target 为选择器时高亮该元素（不存在则自动降级为居中卡）；为 null 时居中讲解。
 * - openPanel 由父级 onStep 回调负责程序化打开（面板多为条件渲染）。
 * - interactive 步放行镂空区指针事件，让用户「亲手试一下」。
 * - 目标矩形用 rAF 持续跟踪，兼容面板异步渲染与工具栏拖动/折叠导致的位移。
 */

const CARD_W = 384;
const RING_PAD = 8; // 高亮框相对目标的外扩

interface Rect { top: number; left: number; width: number; height: number }

function measure(selector: string | null): Rect | null {
  if (!selector) return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // 未布局/隐藏
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function rectsDiffer(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a !== b;
  return (
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  );
}

/** 依目标矩形与卡片尺寸算出卡片位置，越界自动翻边并夹在可视区内。 */
function placeCard(
  rect: Rect | null,
  cardW: number,
  cardH: number,
  vw: number,
  vh: number,
  placement: TourStep["placement"],
): { top: number; left: number } {
  const gap = 18;
  const margin = 12;
  if (!rect) {
    return { top: Math.max(margin, (vh - cardH) / 2), left: Math.max(margin, (vw - cardW) / 2) };
  }
  const clampX = (x: number) => Math.max(margin, Math.min(vw - cardW - margin, x));
  const clampY = (y: number) => Math.max(margin, Math.min(vh - cardH - margin, y));
  const centerX = clampX(rect.left + rect.width / 2 - cardW / 2);
  const centerY = clampY(rect.top + rect.height / 2 - cardH / 2);

  const below = rect.top + rect.height + gap;
  const above = rect.top - gap - cardH;
  const right = rect.left + rect.width + gap;
  const left = rect.left - gap - cardW;

  const fitsBelow = below + cardH <= vh - margin;
  const fitsAbove = above >= margin;
  const fitsRight = right + cardW <= vw - margin;
  const fitsLeft = left >= margin;

  const order: TourStep["placement"][] =
    placement === "top" ? ["top", "bottom", "right", "left"]
    : placement === "left" ? ["left", "right", "bottom", "top"]
    : placement === "right" ? ["right", "left", "bottom", "top"]
    : ["bottom", "top", "right", "left"]; // auto / bottom 默认

  for (const side of order) {
    if (side === "bottom" && fitsBelow) return { top: below, left: centerX };
    if (side === "top" && fitsAbove) return { top: above, left: centerX };
    if (side === "right" && fitsRight) return { top: centerY, left: right };
    if (side === "left" && fitsLeft) return { top: centerY, left: left };
  }
  // 都不合适：贴目标下方并夹紧
  return { top: clampY(below), left: centerX };
}

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 22, height: 22, padding: "0 6px", borderRadius: 6,
        fontSize: 11, fontWeight: 700, fontFamily: "inherit",
        background: "var(--c-elevated)", color: "var(--c-t1)",
        border: "1px solid var(--c-bd2)", boxShadow: "0 1px 0 var(--c-bd2)",
      }}
    >
      {children}
    </kbd>
  );
}

/** 外部控制器：不走全局 useGuideStore 时（如聊天页），由调用方注入状态与动作，
 *  即可复用同一套 spotlight 视觉。 */
export interface TourController {
  active: boolean;
  stepIndex: number;
  next: () => void;
  prev: () => void;
  goTo: (i: number) => void;
  stop: (done?: boolean) => void;
}

export function GuidedTour({
  onStep, steps: stepsProp, controller,
}: {
  onStep?: (step: TourStep | null) => void;
  /** 步骤数据；缺省用画布的 GUIDE_STEPS。 */
  steps?: TourStep[];
  /** 外部状态控制器；缺省用全局 useGuideStore（画布）。 */
  controller?: TourController;
}) {
  // Hooks 必须无条件调用；controller 存在时忽略 store 的值。
  const storeActive = useGuideStore((s) => s.active);
  const storeStepIndex = useGuideStore((s) => s.stepIndex);
  const storeNext = useGuideStore((s) => s.next);
  const storePrev = useGuideStore((s) => s.prev);
  const storeGoTo = useGuideStore((s) => s.goTo);
  const storeStop = useGuideStore((s) => s.stop);

  const steps = stepsProp ?? GUIDE_STEPS;
  const active = controller ? controller.active : storeActive;
  const stepIndex = controller ? controller.stepIndex : storeStepIndex;
  const next = controller ? controller.next : storeNext;
  const prev = controller ? controller.prev : storePrev;
  const goTo = controller ? controller.goTo : storeGoTo;
  const stop = controller ? controller.stop : storeStop;

  const step: TourStep | undefined = active ? steps[stepIndex] : undefined;
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: typeof window !== "undefined" ? window.innerWidth : 1280, h: typeof window !== "undefined" ? window.innerHeight : 800 });
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(220);

  // 通知父级当前步（打开/关闭对应面板）。
  useEffect(() => {
    onStep?.(step ?? null);
    // 卸载/结束时父级会收到 null，负责收拾导览打开的面板
  }, [step, onStep]);

  // 持续跟踪目标矩形：面板异步渲染、工具栏可拖动/折叠，故用 rAF 轮询直到稳定。
  // 居中步（target 为 null）必须显式把 rect 归零，否则会残留上一步的高亮环。
  useLayoutEffect(() => {
    if (!active || !step || !step.target) { setRect(null); return; }
    const target = step.target;
    let raf = 0;
    let last: Rect | null = null;
    let started = false;
    const tick = () => {
      const r = measure(target);
      if (!started || rectsDiffer(last, r)) { started = true; last = r; setRect(r); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, step]);

  // 可视区尺寸
  useEffect(() => {
    if (!active) return;
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  // 测量卡片高度用于放置
  useLayoutEffect(() => {
    if (cardRef.current) {
      const h = cardRef.current.offsetHeight;
      if (h && Math.abs(h - cardH) > 1) setCardH(h);
    }
  }, [step, rect, cardH]);

  // 键盘导航
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!active) return;
    if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    else if (e.key === "Escape") { e.preventDefault(); stop(true); }
  }, [active, next, prev, stop]);
  useEffect(() => {
    if (!active) return;
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [active, handleKey]);

  if (!active || !step) return null;

  const total = steps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;
  const pos = placeCard(rect, CARD_W, cardH, vp.w, vp.h, step.placement);
  const spot = rect
    ? { top: rect.top - RING_PAD, left: rect.left - RING_PAD, width: rect.width + RING_PAD * 2, height: rect.height + RING_PAD * 2 }
    : null;
  const accent = "oklch(0.68 0.22 285)";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }}>
      <style>{`
        @keyframes avc-tour-card-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
        @keyframes avc-tour-pulse { 0% { opacity: 0.9; transform: scale(1); } 70% { opacity: 0; transform: scale(1.12); } 100% { opacity: 0; transform: scale(1.12); } }
      `}</style>

      {/* 遮罩：有目标时用 box-shadow 挖洞；无目标时整屏调暗。非交互步加全屏 blocker 吞点击。 */}
      {spot ? (
        <>
          {/* 非交互步：全屏拦截层（透明），交互步省略以放行目标点击 */}
          {!step.interactive && (
            <div
              onClick={() => { /* 吞掉误点，导览期间不误触画布 */ }}
              style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "auto", background: "transparent" }}
            />
          )}
          {/* 高亮框：box-shadow 向外铺满形成镂空调暗 + 描边 + 柔光 */}
          <div
            style={{
              position: "fixed",
              top: spot.top, left: spot.left, width: spot.width, height: spot.height,
              borderRadius: 12,
              boxShadow: `0 0 0 9999px oklch(0.03 0.01 285 / 0.64), 0 0 0 2px ${accent}, 0 0 26px 4px oklch(0.68 0.22 285 / 0.55)`,
              transition: "top 260ms cubic-bezier(0.4,0,0.2,1), left 260ms cubic-bezier(0.4,0,0.2,1), width 260ms cubic-bezier(0.4,0,0.2,1), height 260ms cubic-bezier(0.4,0,0.2,1)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
          {/* 呼吸脉冲环 */}
          <div
            style={{
              position: "fixed",
              top: spot.top, left: spot.left, width: spot.width, height: spot.height,
              borderRadius: 12, border: `2px solid ${accent}`,
              animation: "avc-tour-pulse 1.8s ease-out infinite",
              pointerEvents: "none", zIndex: 2,
            }}
          />
        </>
      ) : (
        <div style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "auto", background: "oklch(0.03 0.01 285 / 0.64)" }} />
      )}

      {/* 交互步的行动提示徽标（贴在高亮框上方） */}
      {spot && step.interactive && step.actionHint && (
        <div
          style={{
            position: "fixed", top: Math.max(6, spot.top - 30), left: spot.left, zIndex: 3,
            padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
            color: "white", background: `linear-gradient(135deg, ${accent}, oklch(0.60 0.20 310))`,
            boxShadow: "0 4px 14px oklch(0.68 0.22 285 / 0.4)", pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          👆 {step.actionHint}
        </div>
      )}

      {/* 跟随卡片 */}
      <div
        ref={cardRef}
        style={{
          position: "fixed", top: pos.top, left: pos.left, width: CARD_W, maxWidth: "calc(100vw - 24px)",
          zIndex: 4, pointerEvents: "auto",
          background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 16,
          boxShadow: "0 24px 64px oklch(0 0 0 / 0.5), 0 0 0 1px oklch(0.68 0.22 285 / 0.2)",
          animation: "avc-tour-card-in 240ms cubic-bezier(0.4,0,0.2,1)",
          overflow: "hidden",
        }}
      >
        {/* 顶部渐变条 */}
        <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, oklch(0.60 0.20 310), oklch(0.72 0.16 200))` }} />

        <div style={{ padding: "16px 18px 14px" }}>
          {/* 章节 + 进度 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: accent, textTransform: "uppercase" }}>
              {step.chapter}
            </span>
            <span style={{ fontSize: 11, color: "var(--c-t3)" }}>{stepIndex + 1} / {total}</span>
          </div>

          {/* 标题 */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                background: "oklch(0.68 0.22 285 / 0.14)", border: "1px solid oklch(0.68 0.22 285 / 0.3)",
              }}
            >
              {step.icon}
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--c-t1)", lineHeight: 1.35, paddingTop: 2 }}>
              {step.title}
            </h3>
          </div>

          {/* 正文 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {step.body.map((p, i) => (
              <p key={i} style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: "var(--c-t2)" }}>{p}</p>
            ))}
          </div>

          {/* 流程链示意 */}
          {step.flow && (
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {step.flow.map((label, i) => (
                <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                      background: "var(--c-surface)", border: "1px solid var(--c-bd1)", color: "var(--c-t1)",
                    }}
                  >
                    {label}
                  </span>
                  {i < step.flow!.length - 1 && <span style={{ color: accent, fontSize: 12 }}>→</span>}
                </span>
              ))}
            </div>
          )}

          {/* 键位 */}
          {step.keys && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
              {step.keys.map((k, i) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <KeyCap>{k}</KeyCap>
                  {i < step.keys!.length - 1 && <span style={{ color: "var(--c-t3)", fontSize: 12 }}>+</span>}
                </span>
              ))}
            </div>
          )}

          {/* 提示条 */}
          {step.tip && (
            <div
              style={{
                display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12,
                padding: "8px 10px", borderRadius: 8,
                background: "oklch(0.72 0.16 90 / 0.1)", border: "1px solid oklch(0.72 0.16 90 / 0.28)",
              }}
            >
              <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1.5 }}>💡</span>
              <span style={{ fontSize: 12, lineHeight: 1.55, color: "var(--c-t2)" }}>{step.tip}</span>
            </div>
          )}
        </div>

        {/* 进度点 */}
        <div style={{ display: "flex", justifyContent: "center", gap: 5, padding: "0 18px 10px" }}>
          {steps.map((s, i) => (
            <button
              key={s.id}
              onClick={() => goTo(i)}
              aria-label={`跳到第 ${i + 1} 步：${s.title}`}
              style={{
                width: i === stepIndex ? 18 : 6, height: 6, borderRadius: 999, border: "none", padding: 0, cursor: "pointer",
                background: i === stepIndex ? accent : "var(--c-bd2)",
                transition: "width 200ms ease, background 200ms ease",
              }}
            />
          ))}
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 18px", borderTop: "1px solid var(--c-bd2)", background: "var(--c-surface)", gap: 10,
          }}
        >
          <button
            onClick={() => stop(true)}
            style={{
              background: "none", border: "none", color: "var(--c-t3)", fontSize: 12, cursor: "pointer", padding: "6px 4px",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
          >
            跳过导览
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            {!isFirst && (
              <button
                onClick={prev}
                style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                  background: "var(--c-base)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-base)"; }}
              >
                上一步
              </button>
            )}
            <button
              onClick={next}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: `linear-gradient(135deg, ${accent}, oklch(0.60 0.20 310))`, border: "none", color: "white",
                boxShadow: "0 4px 16px oklch(0.68 0.22 285 / 0.3)",
              }}
            >
              {isLast ? "开始创作 🚀" : "下一步"}
              {!isLast && <span style={{ fontSize: 12 }}>→</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
