import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, PanelLeftClose, PanelLeft, Users, ExternalLink, Download } from "lucide-react";
import { toast } from "sonner";
import { ChatProvider } from "@/hooks/useChat";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatView } from "@/components/chat/ChatView";
import { MembersPanel } from "@/components/chat/MembersPanel";
import { C, iconBtn, ghostBtn } from "@/components/chat/chatTheme";

interface BIPEvent extends Event { prompt: () => void; userChoice: Promise<{ outcome: string }> }

export default function ChatPage() {
  const [, navigate] = useLocation();
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 760);
  const [sidebarOpen, setSidebarOpen] = useState(typeof window === "undefined" || window.innerWidth >= 760);
  const [membersOpen, setMembersOpen] = useState(typeof window === "undefined" || window.innerWidth >= 1024);
  const installEvt = useRef<BIPEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);

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

  function openCompact() {
    window.open("/chat", "avc-chat", "width=460,height=780,menubar=no,toolbar=no,location=no,status=no,resizable=yes");
  }
  async function install() {
    const e = installEvt.current;
    if (!e) { toast.info("如需安装为应用，请用 Chrome 通过 localhost 或 HTTPS 打开；或点地址栏右侧的「安装」图标。"); return; }
    e.prompt();
    await e.userChoice.catch(() => {});
    installEvt.current = null; setCanInstall(false);
  }

  return (
    <ChatProvider>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.t1, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        {/* glow header */}
        <header style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", flexShrink: 0, borderBottom: `1px solid ${C.border}`,
          background: "radial-gradient(120% 180% at 0% 0%, rgba(245,158,11,0.10), transparent 60%), #0c0c10",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => navigate("/")} title="返回" style={iconBtn}><ArrowLeft size={18} /></button>
            <button onClick={() => setSidebarOpen((v) => !v)} title={sidebarOpen ? "折叠会话栏" : "展开会话栏"} style={iconBtn}>
              {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/chat-icon.svg" width={26} height={26} alt="" style={{ borderRadius: 7 }} />
              <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.3px", background: C.accentGradText, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>聊天工作室</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={openCompact} title="在精简小窗中打开" style={{ ...ghostBtn, height: 34, padding: narrow ? "0" : "0 12px", width: narrow ? 34 : undefined, fontSize: 13 }}>
              <ExternalLink size={15} />{!narrow && " 精简窗口"}
            </button>
            <button onClick={install} title="安装为桌面应用" style={{ ...ghostBtn, height: 34, padding: narrow ? "0" : "0 12px", width: narrow ? 34 : undefined, fontSize: 13, ...(canInstall ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>
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
            ? <Drawer side="left" onClose={() => setSidebarOpen(false)}><ConversationList /></Drawer>
            : <ConversationList />)}

          <ChatView membersOpen={membersOpen} />

          {membersOpen && (narrow
            ? <Drawer side="right" onClose={() => setMembersOpen(false)}><MembersPanel /></Drawer>
            : <MembersPanel />)}
        </div>
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
