import { useState } from "react";
import { X, Search, Users, MessageSquare } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useChat } from "@/hooks/useChat";
import { toast } from "sonner";

export function NewConversationDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"room" | "dm">("room");
  const { refetchConversations, selectConversation, serverlessAllowed } = useChat();

  // room form
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"server" | "serverless">("server");
  const createRoom = trpc.chat.createRoom.useMutation();

  // dm search
  const [q, setQ] = useState("");
  const searchQuery = trpc.chat.searchUsers.useQuery({ q }, { enabled: q.trim().length > 0 });
  const startDm = trpc.chat.startDm.useMutation();

  async function onCreateRoom() {
    if (!title.trim()) return;
    try {
      const res = await createRoom.mutateAsync({ title: title.trim(), mode, password: password || undefined });
      await refetchConversations();
      selectConversation(res.id);
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "创建失败"); }
  }

  async function onStartDm(userId: number) {
    try {
      const res = await startDm.mutateAsync({ targetUserId: userId });
      await refetchConversations();
      selectConversation(res.id);
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "无法开始私聊"); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 420, maxWidth: "90vw", background: "var(--c-surface, #1a1a22)", borderRadius: 14,
        border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", padding: 20, color: "var(--c-t1, #f0f0f4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>新建会话</span>
          <button onClick={onClose} style={iconBtn}><X size={16} /></button>
        </div>

        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, marginBottom: 16 }}>
          <TabBtn active={tab === "room"} onClick={() => setTab("room")}><Users size={14} /> 创建群聊</TabBtn>
          <TabBtn active={tab === "dm"} onClick={() => setTab("dm")}><MessageSquare size={14} /> 发起私聊</TabBtn>
        </div>

        {tab === "room" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="房间名称">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：项目讨论" style={inputStyle} />
            </Field>
            <Field label="密码（可选）">
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="留空为公开房间" style={inputStyle} />
            </Field>
            <Field label="工作模式">
              <div style={{ display: "flex", gap: 8 }}>
                <ModeChip active={mode === "server"} onClick={() => setMode("server")} title="服务器模式" desc="保存历史、可检索" />
                <ModeChip active={mode === "serverless"} onClick={() => { if (serverlessAllowed) setMode("serverless"); }} title="端到端加密" desc={serverlessAllowed ? "不留存、仅本机" : "管理员已禁用"} disabled={!serverlessAllowed} />
              </div>
            </Field>
            <button onClick={onCreateRoom} disabled={!title.trim() || createRoom.isPending} style={primaryBtn}>
              {createRoom.isPending ? "创建中…" : "创建"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ position: "relative" }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--c-t3)" }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索用户名或邮箱" style={{ ...inputStyle, paddingLeft: 32 }} />
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {searchQuery.data?.length === 0 && q && <div style={{ fontSize: 13, color: "var(--c-t3)", padding: 8 }}>未找到用户</div>}
              {searchQuery.data?.map((u) => (
                <button key={u.id} onClick={() => onStartDm(u.id)} style={userRow}>
                  <span style={{ fontWeight: 500 }}>{u.name ?? `用户${u.id}`}</span>
                  {u.email && <span style={{ fontSize: 12, color: "var(--c-t3)" }}>{u.email}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--c-t2, rgba(255,255,255,0.5))", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      padding: "7px 0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500,
      background: active ? "rgba(255,255,255,0.08)" : "transparent",
      color: active ? "var(--c-t1, #f0f0f4)" : "var(--c-t2, rgba(255,255,255,0.5))",
    }}>{children}</button>
  );
}

function ModeChip({ active, onClick, title, desc, disabled }: { active: boolean; onClick: () => void; title: string; desc: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, textAlign: "left", padding: "8px 10px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
      border: `1px solid ${active ? "#f59e0b" : "var(--c-bd2, rgba(255,255,255,0.1))"}`,
      background: active ? "rgba(245,158,11,0.15)" : "var(--c-elevated, rgba(255,255,255,0.04))",
      color: "var(--c-t1, #f0f0f4)", opacity: disabled ? 0.5 : 1,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.4))" }}>{desc}</div>
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 8, boxSizing: "border-box",
  border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", background: "var(--c-input, rgba(255,255,255,0.04))",
  color: "var(--c-t1, #f0f0f4)", fontSize: 14, outline: "none",
};
const primaryBtn: React.CSSProperties = {
  padding: "10px 0", border: "1px solid #f59e0b", borderRadius: 8, background: "rgba(245,158,11,0.12)",
  color: "#f59e0b", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 4,
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28,
  borderRadius: 7, border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))",
  background: "var(--c-elevated, rgba(255,255,255,0.04))", color: "var(--c-t1, #f0f0f4)", cursor: "pointer",
};
const userRow: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start", padding: "8px 10px",
  borderRadius: 8, border: "1px solid var(--c-bd1, rgba(255,255,255,0.05))",
  background: "var(--c-elevated, rgba(255,255,255,0.03))", color: "var(--c-t1, #f0f0f4)", cursor: "pointer", textAlign: "left",
};
