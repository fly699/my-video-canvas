import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, PanelLeftClose, PanelLeft, Users, ExternalLink, Download, Sun, Moon, Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { ChatProvider } from "@/hooks/useChat";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatView } from "@/components/chat/ChatView";
import { MembersPanel } from "@/components/chat/MembersPanel";
import { C, iconBtn, ghostBtn } from "@/components/chat/chatTheme";
import { GuidedTour, type TourController } from "@/components/canvas/GuidedTour";
import { CHAT_TOUR_STEPS, CHAT_TOUR_DONE_KEY } from "@/lib/chatGuideSteps";
import type { TourStep } from "@/lib/guideSteps";
import { useAuth } from "@/_core/hooks/useAuth";
import { LogIn, Loader2 } from "lucide-react";
import { CHAT_MUTED_KEY } from "@/hooks/useChat";
import { ensureNotificationPermission } from "@/lib/notify";

interface BIPEvent extends Event { prompt: () => void; userChoice: Promise<{ outcome: string }> }

export default function ChatPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
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
  // 新消息提醒静音开关（横幅 + 声音 + 桌面通知），持久化。默认开启（不静音）。
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem(CHAT_MUTED_KEY) === "1"; } catch { return false; } });
  function toggleMuted() {
    setMuted((v) => {
      const next = !v;
      try { localStorage.setItem(CHAT_MUTED_KEY, next ? "1" : "0"); } catch { /* quota */ }
      if (!next) void ensureNotificationPermission(); // 取消静音时顺手申请桌面通知权限
      return next;
    });
  }
  useEffect(() => {
    try { localStorage.setItem("avc:chat-light", light ? "1" : "0"); } catch { /* quota */ }
  }, [light]);

  // 仅在「宽→窄」跨断点时收起侧栏/成员栏；否则移动端点输入框弹软键盘会触发 window.resize
  // （innerWidth 不变、innerHeight 变），旧逻辑每次都 setSidebarOpen(false) → 把渲染在侧栏内的
  // 「新建会话」对话框一起卸载（表现为「一点输入框对话框就消失」）。用 ref 记录上一次的窄屏态。
  const prevNarrowRef = useRef(narrow);
  useEffect(() => {
    const onResize = () => {
      const n = window.innerWidth < 760;
      if (n && !prevNarrowRef.current) { setSidebarOpen(false); setMembersOpen(false); }
      prevNarrowRef.current = n;
      setNarrow(n);
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
    if (!isAuthenticated) return; // 引导必须在登录后才启动
    let done = false;
    try { done = localStorage.getItem(CHAT_TOUR_DONE_KEY) === "1"; } catch { /* ignore */ }
    if (done) return;
    // 稍等布局稳定 + 给 beforeinstallprompt 一点时间（安装按钮才可能就位）再启动。
    const t = setTimeout(() => setGuideActive(true), 1200);
    return () => clearTimeout(t);
  }, [isAuthenticated]);
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
    if (!e) {
      // 浏览器未触发原生安装事件：按平台给手动安装指引。
      const ua = navigator.userAgent;
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
      if (isIOS) {
        toast.info("iPhone / iPad 安装：用 Safari 打开本页 → 点底部「分享」按钮 → 选「添加到主屏幕」。", { duration: 7000 });
      } else {
        toast.info("安装到主屏 / 桌面：用 Chrome（非无痕）以 HTTPS 打开（地址栏显示🔒）→ 安卓点右上角菜单「安装应用 / 添加到主屏幕」，电脑点地址栏右侧「安装」图标。", { duration: 7000 });
      }
      return;
    }
    e.prompt();
    await e.userChoice.catch(() => {});
    installEvt.current = null; setCanInstall(false);
  }

  // 未登录：不进入聊天（其 tRPC 调用会 401），弹出项目统一登录弹窗，引导登录后再回聊天。
  if (!authLoading && !isAuthenticated) {
    return (
      <div className={light ? "chat-root chat-light" : "chat-root"} style={{ height: viewportH != null ? `${viewportH}px` : "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.t1, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", padding: 16 }}>
        <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(2px)", background: "rgba(0,0,0,0.35)" }} />
        <div style={{ position: "relative", width: 360, maxWidth: "100%", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.35)", padding: 24, textAlign: "center" }}>
          <img src="/chat-icon.svg" width={44} height={44} alt="" style={{ borderRadius: 10, margin: "0 auto 12px" }} />
          <div style={{ fontSize: 17, fontWeight: 700, color: C.accent, marginBottom: 6 }}>聊天工作室</div>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: C.t2, marginBottom: 18 }}>登录后即可进入团队聊天、与 AI 助手对话，并接收画布产物推送。</div>
          <button
            onClick={() => navigate(`/login?next=${encodeURIComponent("/chat")}`)}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 42, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#fff", background: C.accent }}
          >
            <LogIn size={16} /> 登录 / 注册
          </button>
          <button onClick={() => navigate("/")} style={{ marginTop: 10, background: "none", border: "none", color: C.t3, fontSize: 12.5, cursor: "pointer" }}>返回首页</button>
        </div>
      </div>
    );
  }
  // 登录态加载中：先给一个占位，避免闪现聊天界面或登录弹窗。
  if (authLoading) {
    return (
      <div className={light ? "chat-root chat-light" : "chat-root"} style={{ height: viewportH != null ? `${viewportH}px` : "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.t3 }}>
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
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
            <button onClick={toggleMuted} title={muted ? "新消息提醒：已静音（点击开启）" : "新消息提醒：开启（点击静音）"} style={{ ...iconBtn, ...(muted ? { color: "var(--c-t4)" } : { border: `1px solid ${C.accent}`, color: C.accent }) }}>
              {muted ? <BellOff size={18} /> : <Bell size={18} />}
            </button>
            <button onClick={() => setLight((v) => !v)} title={light ? "切换到深色" : "切换到浅色"} style={{ ...iconBtn, ...(light ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>
              {light ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            {/* 精简小窗是桌面弹窗，手机上无意义 → 移动端隐藏 */}
            {!narrow && (
              <button onClick={openCompact} title="在精简小窗中打开" style={{ ...ghostBtn, height: 34, padding: "0 12px", fontSize: 13 }}>
                <ExternalLink size={15} /> 精简窗口
              </button>
            )}
            {/* 安装为应用：始终显示（含移动端），让用户随时能安装到主屏/桌面。可安装时高亮描边；
                浏览器暂不支持安装时点击给出对应平台的手动安装指引（见 install()）。 */}
            <button data-tour="chat-install" onClick={install} title="安装为应用（手机加到主屏 / 桌面独立窗口）" style={{ ...ghostBtn, height: 34, padding: narrow ? "0" : "0 12px", width: narrow ? 34 : undefined, fontSize: 13, ...(canInstall ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>
              <Download size={15} />{!narrow && " 安装应用"}
            </button>
            <button onClick={() => setMembersOpen((v) => !v)} title="成员/在线" style={{ ...iconBtn, ...(membersOpen ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>
              <Users size={18} />
            </button>
          </div>
        </header>

        <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
          {/* sidebar: inline when wide, overlay drawer when narrow */}
          {sidebarOpen && (narrow
            ? <Drawer side="left" onClose={() => setSidebarOpen(false)}><ConversationList onSelect={() => setSidebarOpen(false)} /></Drawer>
            : <ConversationList />)}

          <ChatView membersOpen={membersOpen} narrow={narrow} />

          {membersOpen && (narrow
            ? <Drawer side="right" onClose={() => setMembersOpen(false)}><MembersPanel /></Drawer>
            : <MembersPanel />)}
        </div>
        <GuidedTour steps={CHAT_TOUR_STEPS} controller={guideController} onStep={onGuideStep} themeClass={light ? "chat-light" : undefined} />
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
