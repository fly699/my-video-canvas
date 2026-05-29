import { useState } from "react";
import { Hash, Lock, MessageSquare, Plus, Users, Globe, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useChat, type ConversationSummary, type JoinableRoom } from "@/hooks/useChat";
import { NewConversationDialog } from "./NewConversationDialog";
import { C, avatarGrad, initials } from "./chatTheme";

export function ConversationList() {
  const { conversations, joinableRooms, activeId, selectConversation, joinRoom } = useChat();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [q, setQ] = useState("");

  const filt = (c: ConversationSummary) => {
    if (!q.trim()) return true;
    const t = (c.type === "dm" ? c.peer?.name : c.title) ?? "";
    return t.toLowerCase().includes(q.toLowerCase());
  };
  const lobby = conversations.filter((c) => c.type === "lobby");
  const groups = conversations.filter((c) => c.type === "group" && filt(c));
  const dms = conversations.filter((c) => c.type === "dm" && filt(c));

  async function handleJoin(r: JoinableRoom) {
    let password: string | undefined;
    if (r.isPrivate) {
      const entered = window.prompt(`房间「${r.title ?? "群聊"}」需要密码：`);
      if (entered == null) return;
      password = entered;
    }
    try { await joinRoom(r.id, password); }
    catch (e) { toast.error(e instanceof Error ? e.message : "加入失败"); }
  }

  return (
    <aside style={{ width: 286, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.bg2, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.border}` }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索会话…" style={{
          flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 13, outline: "none",
          border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1,
        }} />
        <button onClick={() => setDialogOpen(true)} title="新建会话 / 私聊" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
          borderRadius: 10, border: `1px solid ${C.accent}`, cursor: "pointer", background: C.accentSoft, color: C.accent,
          flexShrink: 0,
        }}><Plus size={18} /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 8px" }}>
        <Section title="大厅" icon={<Globe size={12} />}>
          {lobby.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => selectConversation(c.id)} />)}
        </Section>
        <Section title="群聊" icon={<Users size={12} />}>
          {groups.length === 0 && <Empty text="暂无群聊" />}
          {groups.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => selectConversation(c.id)} />)}
        </Section>
        <Section title="私聊" icon={<MessageSquare size={12} />}>
          {dms.length === 0 && <Empty text="暂无私聊" />}
          {dms.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => selectConversation(c.id)} />)}
        </Section>
        {joinableRooms.length > 0 && (
          <Section title="可加入的房间" icon={<LogIn size={12} />}>
            {joinableRooms.map((r) => (
              <button key={r.id} onClick={() => handleJoin(r)} style={rowBase}>
                <Avatar seed={`g${r.id}`} label={r.title ?? "群"} icon={r.isPrivate ? <Lock size={14} /> : <Hash size={14} />} />
                <span style={nameCol}>{r.title ?? "群聊"}</span>
                {r.mode === "serverless" && <ShieldCheck size={13} style={{ color: C.t4 }} />}
                <span style={{ fontSize: 11, color: C.accent, fontWeight: 700 }}>加入</span>
              </button>
            ))}
          </Section>
        )}
      </div>
      {dialogOpen && <NewConversationDialog onClose={() => setDialogOpen(false)} />}
    </aside>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px 6px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: C.t3 }}>
        {icon}{title}
      </div>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={{ padding: "6px 12px", fontSize: 12, color: C.t4 }}>{text}</div>;
}

function Avatar({ seed, label, icon }: { seed: string | number; label: string; icon?: React.ReactNode }) {
  return (
    <span style={{
      width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: avatarGrad(seed), color: "#fff", fontSize: 13, fontWeight: 700,
    }}>{icon ?? initials(label)}</span>
  );
}

function ConvRow({ c, active, onClick }: { c: ConversationSummary; active: boolean; onClick: () => void }) {
  const title = c.type === "dm" ? (c.peer?.name ?? `用户${c.peer?.id ?? ""}`) : c.type === "lobby" ? "大厅" : (c.title ?? "群聊");
  const seed = c.type === "dm" ? `u${c.peer?.id}` : `c${c.id}`;
  const icon = c.type === "lobby" ? <Globe size={15} /> : c.type === "dm" ? undefined : c.isPrivate ? <Lock size={15} /> : <Hash size={15} />;
  return (
    <button onClick={onClick} style={{
      ...rowBase,
      background: active ? C.accentSoft : "transparent",
      boxShadow: active ? `inset 2px 0 0 ${C.accent}` : "none",
    }}>
      <Avatar seed={seed} label={title} icon={icon} />
      <span style={nameCol}>
        <span style={{ fontWeight: 600, fontSize: 14, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{title}</span>
        {c.lastMessage && (
          <span style={{ fontSize: 12, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
            {c.lastMessage.senderName}: {c.lastMessage.content || "[文件]"}
          </span>
        )}
      </span>
      {c.mode === "serverless" && <ShieldCheck size={13} style={{ color: C.t4, flexShrink: 0 }} />}
      {c.unread > 0 && <span style={{ fontSize: 11, fontWeight: 800, background: C.accentSoft, color: C.accent, borderRadius: 10, padding: "1px 7px", flexShrink: 0 }}>{c.unread}</span>}
    </button>
  );
}

const rowBase: React.CSSProperties = {
  width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
  borderRadius: 12, border: "none", cursor: "pointer", textAlign: "left", marginBottom: 3, color: C.t1,
};
const nameCol: React.CSSProperties = { flex: 1, minWidth: 0 };
