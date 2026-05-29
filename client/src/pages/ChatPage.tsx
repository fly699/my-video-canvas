import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { ChatProvider } from "@/hooks/useChat";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatView } from "@/components/chat/ChatView";
import { ThemeSwitcher } from "@/components/canvas/ThemeSwitcher";

export default function ChatPage() {
  const [, navigate] = useLocation();
  return (
    <ChatProvider>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--c-canvas, #0d0d10)", color: "var(--c-t1, #f0f0f4)" }}>
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", borderBottom: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
          background: "var(--c-surface, #14141a)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => navigate("/")} title="返回" style={iconBtn}>
              <ArrowLeft size={18} />
            </button>
            <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.3px" }}>聊天</span>
          </div>
          <ThemeSwitcher />
        </header>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <ConversationList />
          <ChatView />
        </div>
      </div>
    </ChatProvider>
  );
}

const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 32, height: 32, borderRadius: 8, border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))",
  background: "var(--c-elevated, rgba(255,255,255,0.04))", color: "var(--c-t1, #f0f0f4)", cursor: "pointer",
};
