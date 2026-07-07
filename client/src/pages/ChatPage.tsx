import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, PanelLeftClose, PanelLeft, Users, ExternalLink, Download, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
import { ChatProvider } from "@/hooks/useChat";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatView } from "@/components/chat/ChatView";
import { MembersPanel } from "@/components/chat/MembersPanel";
import { C, iconBtn, ghostBtn } from "@/components/chat/chatTheme";
import { GuidedTour, type TourController } from "@/components/canvas/GuidedTour";
import { CHAT_TOUR_STEPS, CHAT_TOUR_DONE_KEY } from "@/lib/chatGuideSteps";
import type { TourStep } from "@/lib/guideSteps";

interface BIPEvent extends Event { prompt: () => void; userChoice: Promise<{ outcome: string }> }

export default function ChatPage() {
  const [, navigate] = useLocation();
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 760);
  const [sidebarOpen, setSidebarOpen] = useState(typeof window === "undefined" || window.innerWidth >= 760);
  const [membersOpen, setMembersOpen] = useState(typeof window === "undefined" || window.innerWidth >= 1024);
  const installEvt = useRef<BIPEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  // 专有浅色主题：仅作用于聊天页（含 Chrome 应用），通过 .chat-light 包裹隔离，
  // 不影响画布主题。持久化在独立的 localStorage key。
  // 聊天页默认浅色主题：未显式切换过（localStorage 无键）→ 浅色；用户切过则沿用其选择（"1" 浅/"0" 深）。
  const [light, setLight] = useState(() => {
    try { const v = localStorage.getItem("avc:chat-light"); return v === null ? true : v === "1"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("avc:chat-light", light ? "1" : "0"); } catch { /* quota */ }
  }, [light]);

  useEffect(() => {
    const onResize = () => {
      const n = window.innerWidth < 760;
      setNarrow(n);
      if (n) { setSidebarOpen(false); setMembersOpen(false); }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onBIP = (e: Event) => { e.preventDefault(); installEvt.current = e as BIPEvent; setCanInstall(true); };
    window.addEventListener("beforeinstallprompt", onBIP);
    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  // 移动端真实可视高度：100vh/100dvh 在部分手机浏览器（尤其地址栏在底部的 Chrome）仍会把
  // 浏览器 UI 算进去，底部输入框被顶出视口而「消失」。用 visualViewport.height 精确绑定根容器
  // 高度（地址栏收展、软键盘弹起都实时跟随），彻底不依赖 dvh 支持度。
  const [viewportH, setViewportH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const apply = () => setViewportH(Math.round(vv ? vv.height : window.innerHeight));
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  // ── 首次进入引导（复用画布 GuidedTour + 外部 controller）──
  const [guideActive, setGuideActive] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  useEffect(() => {
    let done = false;
    try { done = localStorage.getItem(CHAT_TOUR_DONE_KEY) === "1"; } catch { /* ignore */ }
    if (done) return;
    // 稍等布局稳定 + 给 beforeinstallprompt 一点时间（安装按钮才可能就位）再启动。
    const t = setTimeout(() => setGuideActive(true), 1200);
    return () => clearTimeout(t);
  }, []);
  const markGuideDone = () => { try { localStorage.setItem(CHAT_TOUR_DONE_KEY, "1"); } catch { /* quota */ } };
  const guideController: TourController = {
    active: guideActive,
    stepIndex: guideStep,
    next: () => { if (guideStep >= CHAT_TOUR_STEPS.length - 1) { markGuideDone(); setGuideActive(false); setGuideStep(0); } else setGuideStep((i) => i + 1); },
    prev: () => setGuideStep((i) => Math.max(0, i - 1)),
    goTo: (i) => setGuideStep(Math.max(0, Math.min(i, CHAT_TOUR_STEPS.length - 1))),
    stop: (d) => { if (d) markGuideDone(); setGuideActive(false); setGuideStep(0); },
  };
  // 到「切换房间」步时把会话栏展开，让用户看到房间列表本体。
  const onGuideStep = (step: TourStep | null) => { if (step?.id === "chat-rooms") setSidebarOpen(true); };

  function openCompact() {
    window.open("/chat", "avc-chat", "width=460,height=780,menubar=no,toolbar=no,location=no,status=no,resizable=yes");
  }
  async function install() {
    const e = installEvt.current;
    if (!e) { toast.info("无法安装：请用普通（非无痕）Chrome 窗口、HTTPS 且证书已受信任（地址栏显示🔒）打开；满足后点地址栏右侧的「安装」图标即可。"); return; }
    e.prompt();
    await e.userChoice.catch(() => {});
    installEvt.current = null; setCanInstall(false);
  }

  return (
    <ChatProvider>
      <div className={light ? "chat-root chat-light" : "chat-root"} style={{ height: viewportH != null ? `${viewportH}px` : undefined, display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg, color: C.t1, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        {/* glow header */}
        <header style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", flexShrink: 0, borderBottom: `1px solid ${C.border}`,
          background: C.bg2,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button data-tour="chat-back" onClick={() => navigate("/")} title="返回" style={iconBtn}><ArrowLeft size={18} /></button>
            <button data-tour="chat-rooms-toggle" onClick={() => setSidebarOpen((v) => !v)} title={sidebarOpen ? "折叠会话栏" : "展开会话栏"} style={iconBtn}>
              {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src="/chat-icon.svg" width={20} height={20} alt="" style={{ borderRadius: 6 }} />
              <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.2px", color: C.accent }}>聊天工作室</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setLight((v) => !v)} title={light ? "切换到深色" : "切换到浅色"} style={{ ...iconBtn, ...(light ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>
              {light ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            {/* 精简小窗是桌面弹窗，手机上无意义 → 移动端隐藏 */}
            {!narrow && (
              <button onClick={openCompact} title="在精简小窗中打开" style={{ ...ghostBtn, height: 34, padding: "0 12px", fontSize: 13 }}>
                <ExternalLink size={15} /> 精简窗口
              </button>
            )}
            {/* 安装为应用：移动端仅当浏览器确实可安装时才显示，否则藏起来省空间 */}
            {(!narrow || canInstall) && (
              <button data-tour="chat-install" onClick={install} title="安装为桌面应用" style={{ ...ghostBtn, height: 34, padding: narrow ? "0" : "0 12px", width: narrow ? 34 : undefined, fontSize: 13, ...(canInstall ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>
                <Download size={15} />{!narrow && " 安装应用"}
              </button>
            )}
            <button onClick={() => setMembersOpen((v) => !v)} title="成员/在线" style={{ ...iconBtn, ...(membersOpen ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>
              <Users size={18} />
            </button>
          </div>
        </header>

        <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
          {/* sidebar: inline when wide, overlay drawer when narrow */}
          {sidebarOpen && (narrow
            ? <Drawer side="left" onClose={() => setSidebarOpen(false)}><ConversationList /></Drawer>
            : <ConversationList />)}

          <ChatView membersOpen={membersOpen} narrow={narrow} />

          {membersOpen && (narrow
            ? <Drawer side="right" onClose={() => setMembersOpen(false)}><MembersPanel /></Drawer>
            : <MembersPanel />)}
        </div>
        <GuidedTour steps={CHAT_TOUR_STEPS} controller={guideController} onStep={onGuideStep} />
      </div>
    </ChatProvider>
  );
}

function Drawer({ side, onClose, children }: { side: "left" | "right"; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40, display: "flex", justifyContent: side === "left" ? "flex-start" : "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ height: "100%", boxShadow: "0 0 40px rgba(0,0,0,0.5)" }}>{children}</div>
    </div>
  );
}
