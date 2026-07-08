import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Command, Layers, SlidersHorizontal, Clapperboard, ImagePlus, Search, Sparkles, Maximize2, MessageSquareText, BookOpen } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useUIStyle } from "../../contexts/UIStyleContext";

// 操作小贴士：右下角极简动感卡片，定时轮播 + 情境触发（新增节点 / 进入多选），
// 自动消失，右键=这条不再显示。纯表现层，pointer-events 仅落在卡片本身，不干扰画布。
// studio:true 的贴士描述的是工作室专属 UI（命令栏/批量参数/搜索下拉等），仅在 studio 皮肤展示，
// 否则在 pro/simple 皮肤会提示根本不存在的功能。cmdk/ball/guide 跨皮肤通用。
interface Tip { id: string; icon: ReactNode; title: string; body: string; studio?: boolean }
const TIPS: Tip[] = [
  { id: "cmdk", icon: <Command size={15} />, title: "命令面板 ⌘K", body: "搜索节点后回车进入命令层：定位 / 运行 / 改比例 / 复制 / 删除，键盘全程可达。" },
  { id: "node", studio: true, icon: <Sparkles size={15} />, title: "选中即可创作", body: "选中生成节点，下方命令栏可直接改模型、比例、参考图并一键生成。" },
  { id: "multi", studio: true, icon: <Layers size={15} />, title: "多选批量操作", body: "选中 2 个以上节点，底部工具条「批量参数」可统一比例、批量运行。" },
  { id: "assemble", studio: true, icon: <Clapperboard size={15} />, title: "一键自动成片", body: "选中多段已完成视频（可加配乐），底部「自动成片」自动连线合并并加转场。" },
  { id: "ref", studio: true, icon: <ImagePlus size={15} />, title: "参考图更方便", body: "命令栏「参考图」点击上传，支持多张；也可把画布素材拖到节点上作参考。" },
  { id: "search", studio: true, icon: <Search size={15} />, title: "长列表可搜索", body: "参数下拉超过 8 项会自动出现搜索框，输入关键词即刻筛选（↑↓ 选择、Enter 确认）。" },
  { id: "expand", studio: true, icon: <SlidersHorizontal size={15} />, title: "记住展开偏好", body: "命令栏「展开全部参数」切换一次即记住，后续选中的节点自动沿用。" },
  { id: "ball", icon: <Maximize2 size={15} />, title: "助手收成悬浮球", body: "画布助手点关闭会收成左下角悬浮球：拖动移位、点击展开、右键才真正关闭。" },
  { id: "neg", studio: true, icon: <MessageSquareText size={15} />, title: "反向提示词", body: "图像 / 视频节点命令栏底部可填反向提示词，排除不想要的元素。" },
  { id: "guide", icon: <BookOpen size={15} />, title: "随时回看导览", body: "顶栏「更多 → 操作指南」可重新打开交互式新手导览。" },
];
const DKEY = "avc:tips:dismissed:v1";
const OFFKEY = "avc:tips:off:v1";
// 供「更多菜单」重新开启小贴士用：清除关闭/忽略记录。
export function resetCanvasTips(): void {
  try { localStorage.removeItem(OFFKEY); localStorage.removeItem(DKEY); } catch { /* ignore */ }
}
function loadDismissed(): Set<string> {
  try { const a = JSON.parse(localStorage.getItem(DKEY) || "[]"); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); }
}

export function CanvasTips() {
  const { uiStyle } = useUIStyle();
  const nodeCount = useCanvasStore((s) => s.nodes.length);
  const multi = useCanvasStore((s) => { let c = 0; for (const n of s.nodes) { if (n.selected) { c++; if (c >= 2) return true; } } return false; });

  const [tip, setTip] = useState<Tip | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dismissedRef = useRef(loadDismissed());
  const offRef = useRef(false);
  const lastRef = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  const idxRef = useRef(0);
  const prevCount = useRef(nodeCount);
  const prevMulti = useRef(false);
  // 当前皮肤下允许展示的贴士：非 studio 皮肤过滤掉 studio 专属条目（否则提示不存在的功能）。
  const isStudio = uiStyle === "studio";
  const isStudioRef = useRef(isStudio);
  isStudioRef.current = isStudio;
  const allowed = (t: Tip) => (!t.studio || isStudioRef.current) && !dismissedRef.current.has(t.id);

  useEffect(() => { try { offRef.current = localStorage.getItem(OFFKEY) === "1"; } catch { /* ignore */ } }, []);

  const hide = useCallback(() => {
    setLeaving(true);
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => { setTip(null); setLeaving(false); }, 260);
  }, []);

  const show = useCallback((t: Tip | null, force = false) => {
    if (!t || offRef.current) return;
    if (dismissedRef.current.has(t.id)) return;
    if (t.studio && !isStudioRef.current) return; // 非 studio 皮肤不展示 studio 专属贴士
    if (typeof window !== "undefined" && window.innerWidth < 640) return; // 窄屏/移动端不打扰
    const now = Date.now();
    if (!force && now - lastRef.current < 12000) return; // 冷却，避免刷屏
    lastRef.current = now;
    window.clearTimeout(hideTimer.current);
    setLeaving(false);
    setTip(t);
    hideTimer.current = window.setTimeout(() => hide(), 9000);
  }, [hide]);

  // 定时轮播下一条未忽略的贴士。
  useEffect(() => {
    const pick = () => {
      if (offRef.current) return;
      const avail = TIPS.filter(allowed);
      if (!avail.length) return;
      show(avail[idxRef.current % avail.length]);
      idxRef.current++;
    };
    const first = window.setTimeout(pick, 9000);
    const iv = window.setInterval(pick, 52000);
    return () => { window.clearTimeout(first); window.clearInterval(iv); };
  }, [show]);

  // 情境触发：新增节点 → 提示如何使用；进入多选 → 提示批量操作。
  useEffect(() => {
    if (nodeCount > prevCount.current) show(TIPS.find((t) => t.id === "node") ?? null);
    prevCount.current = nodeCount;
  }, [nodeCount, show]);
  useEffect(() => {
    if (multi && !prevMulti.current) show(TIPS.find((t) => t.id === "multi") ?? null, true);
    prevMulti.current = multi;
  }, [multi, show]);

  useEffect(() => () => { window.clearTimeout(hideTimer.current); window.clearTimeout(leaveTimer.current); }, []);

  if (!tip) return null;

  const dismissForever = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    dismissedRef.current.add(tip.id);
    try { localStorage.setItem(DKEY, JSON.stringify(Array.from(dismissedRef.current))); } catch { /* quota */ }
    hide();
  };
  const turnOffAll = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    offRef.current = true;
    try { localStorage.setItem(OFFKEY, "1"); } catch { /* quota */ }
    hide();
  };

  return createPortal(
    <div style={{ position: "fixed", right: 16, bottom: 236, zIndex: 46, pointerEvents: "none" }}>
      <style>{`
        @keyframes avc-tip-in { from { opacity: 0; transform: translateY(14px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes avc-tip-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(10px) scale(0.97); } }
        @keyframes avc-tip-bar { from { transform: scaleX(1); } to { transform: scaleX(0); } }
        @media (prefers-reduced-motion: reduce) { .avc-tip-card, .avc-tip-bar { animation: none !important; } }
      `}</style>
      <div
        key={tip.id}
        className="avc-tip-card nodrag"
        onContextMenu={dismissForever}
        onClick={hide}
        title="右键：这条不再显示 · 点击：关闭"
        style={{
          pointerEvents: "auto", position: "relative", width: 288, overflow: "hidden",
          display: "flex", gap: 11, padding: "12px 13px 14px", borderRadius: 14, cursor: "pointer",
          background: "color-mix(in oklch, var(--c-elevated) 90%, transparent)", backdropFilter: "blur(18px)",
          border: "1px solid var(--c-bd2)", boxShadow: "0 12px 34px oklch(0 0 0 / 0.32)",
          animation: `${leaving ? "avc-tip-out 0.24s ease forwards" : "avc-tip-in 0.34s cubic-bezier(0.16,1,0.3,1)"}`,
        }}
      >
        {/* 图标片 */}
        <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", background: "radial-gradient(circle at 32% 28%, oklch(0.80 0.16 310), oklch(0.60 0.22 298))",
          boxShadow: "0 3px 10px oklch(0.62 0.22 300 / 0.45)" }}>{tip.icon}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "var(--c-t4)", textTransform: "uppercase" }}>小贴士</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--c-t1)" }}>{tip.title}</span>
          </div>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: "var(--c-t3)" }}>{tip.body}</p>
          <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
            <button onClick={dismissForever} style={tipLink}>不再显示这条</button>
            <button onClick={turnOffAll} style={tipLink}>关闭全部贴士</button>
          </div>
        </div>
        {/* 自动消失进度条 */}
        {!leaving && (
          <span className="avc-tip-bar" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, transformOrigin: "left",
            background: "linear-gradient(90deg, oklch(0.80 0.16 310), oklch(0.62 0.22 300))",
            animation: "avc-tip-bar 9s linear forwards" }} />
        )}
      </div>
    </div>,
    document.body,
  );
}

const tipLink: React.CSSProperties = {
  background: "none", border: "none", padding: 0, cursor: "pointer",
  fontSize: 10.5, fontWeight: 600, color: "var(--c-t4)", textDecoration: "underline", textUnderlineOffset: 2,
};
