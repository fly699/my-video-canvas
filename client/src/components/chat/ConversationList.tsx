import { useState } from "react";
import { Hash, Lock, MessageSquare, Plus, Users, Globe } from "lucide-react";
import { useChat, type ConversationSummary } from "@/hooks/useChat";
import { NewConversationDialog } from "./NewConversationDialog";

export function ConversationList() {
  const { conversations, activeId, selectConversation } = useChat();
  const [dialogOpen, setDialogOpen] = useState(false);

  const lobby = conversations.filter((c) => c.type === "lobby");
  const groups = conversations.filter((c) => c.type === "group");
  const dms = conversations.filter((c) => c.type === "dm");

  return (
    <aside style={{
      width: 280, flexShrink: 0, borderRight: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
      background: "var(--c-surface, #14141a)", display: "flex", flexDirection: "column", minHeight: 0,
    }}>
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--c-bd1, rgba(255,255,255,0.05))" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t2, rgba(255,255,255,0.5))" }}>会话</span>
        <button onClick={() => setDialogOpen(true)} title="新建会话 / 私聊" style={addBtn}>
          <Plus size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        <Section title="大厅" icon={<Globe size={13} />}>
          {lobby.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => selectConversation(c.id)} />)}
        </Section>
        <Section title="群聊" icon={<Users size={13} />}>
          {groups.length === 0 && <Empty text="暂无群聊" />}
          {groups.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => selectConversation(c.id)} />)}
        </Section>
        <Section title="私聊" icon={<MessageSquare size={13} />}>
          {dms.length === 0 && <Empty text="暂无私聊" />}
          {dms.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => selectConversation(c.id)} />)}
        </Section>
      </div>
      {dialogOpen && <NewConversationDialog onClose={() => setDialogOpen(false)} />}
    </aside>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--c-t3, rgba(255,255,255,0.35))" }}>
        {icon}{title}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: "6px 12px", fontSize: 12, color: "var(--c-t4, rgba(255,255,255,0.25))" }}>{text}</div>;
}

function ConvRow({ c, active, onClick }: { c: ConversationSummary; active: boolean; onClick: () => void }) {
  const title = c.type === "dm" ? (c.peer?.name ?? `用户${c.peer?.id ?? ""}`) : c.type === "lobby" ? "大厅" : (c.title ?? "群聊");
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
      borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", marginBottom: 2,
      background: active ? "var(--c-elevated, rgba(255,255,255,0.08))" : "transparent",
      color: "var(--c-t1, #f0f0f4)",
    }}>
      <span style={{ display: "inline-flex", color: "var(--c-t3, rgba(255,255,255,0.4))" }}>
        {c.type === "dm" ? <MessageSquare size={15} /> : c.isPrivate ? <Lock size={15} /> : <Hash size={15} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14 }}>
        {title}
        {c.lastMessage && (
          <span style={{ display: "block", fontSize: 12, color: "var(--c-t3, rgba(255,255,255,0.4))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.lastMessage.senderName}: {c.lastMessage.content || "[文件]"}
          </span>
        )}
      </span>
      {c.mode === "serverless" && <Lock size={12} style={{ color: "var(--c-t4, rgba(255,255,255,0.3))" }} aria-label="端到端加密" />}
      {c.unread > 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, background: "oklch(0.58 0.22 285)", color: "#fff", borderRadius: 10, padding: "1px 7px" }}>{c.unread}</span>
      )}
    </button>
  );
}

const addBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
  borderRadius: 7, border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))",
  background: "var(--c-elevated, rgba(255,255,255,0.04))", color: "var(--c-t1, #f0f0f4)", cursor: "pointer",
};
