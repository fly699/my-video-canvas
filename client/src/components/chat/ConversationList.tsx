import { useState } from "react";
import { Hash, Lock, MessageSquare, Plus, Users, Globe, LogIn, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { promptDialog } from "@/components/ui/dialogService";
import { useChat, type ConversationSummary, type JoinableRoom } from "@/hooks/useChat";
import { trpc } from "@/lib/trpc";
import { NewConversationDialog } from "./NewConversationDialog";
import { C, avatarGrad, initials } from "./chatTheme";

export function ConversationList({ onSelect }: { onSelect?: () => void } = {}) {
  const { conversations, joinableRooms, activeId, selectConversation, joinRoom } = useChat();
  // 选中会话后回调（移动端用来自动收起房间抽屉）。
  const pick = (id: number) => { selectConversation(id); onSelect?.(); };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [q, setQ] = useState("");
  const utils = trpc.useUtils();
  const aiQuery = trpc.chat.assistantUserId.useQuery(undefined, { staleTime: 60 * 60_000, refetchOnWindowFocus: false });
  const assistantId = aiQuery.data?.userId;
  const openAssistantMut = trpc.chat.openAssistant.useMutation();
  const isAssistantConv = (c: ConversationSummary) => c.type === "dm" && assistantId != null && c.peer?.id === assistantId;

  async function openAI() {
    const existing = conversations.find(isAssistantConv);
    if (existing) { pick(existing.id); return; }
    try {
      const r = await openAssistantMut.mutateAsync();
      await utils.chat.listConversations.refetch();
      pick(r.id);
    } catch (e) { toast.error(e instanceof Error ? e.message : "打开 AI 助手失败"); }
  }

  const filt = (c: ConversationSummary) => {
    if (!q.trim()) return true;
    const t = (c.type === "dm" ? c.peer?.name : c.title) ?? "";
    return t.toLowerCase().includes(q.toLowerCase());
  };
  const lobby = conversations.filter((c) => c.type === "lobby");
  const groups = conversations.filter((c) => c.type === "group" && filt(c));
  // AI 助手 DM 单列在顶部专属入口，不混进普通「私聊」列表。
  const dms = conversations.filter((c) => c.type === "dm" && !isAssistantConv(c) && filt(c));
  // #R5-9 可加入的房间也随搜索过滤（此前搜索时群聊/私聊被过滤、这块仍全量显示，不一致）。
  const filteredJoinable = joinableRooms.filter((r) => !q.trim() || (r.title ?? "").toLowerCase().includes(q.toLowerCase()));

  async function handleJoin(r: JoinableRoom) {
    let password: string | undefined;
    if (r.isPrivate) {
      const entered = await promptDialog({ title: `加入「${r.title ?? "群聊"}」`, message: "该房间为私密房间，请输入密码：", placeholder: "房间密码", mask: true, confirmLabel: "加入" });
      if (entered == null) return;
      password = entered;
    }
    try { await joinRoom(r.id, password); onSelect?.(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "加入失败"); }
  }

  return (
    <aside style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.bg2, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 6, borderBottom: `1px solid ${C.border}` }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索会话…" style={{
          flex: 1, padding: "6px 10px", borderRadius: 8, fontSize: 12, outline: "none",
          border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1,
        }} />
        <button onClick={() => setDialogOpen(true)} title="新建会话 / 私聊" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30,
          borderRadius: 8, border: `1px solid ${C.accent}`, cursor: "pointer", background: C.accentSoft, color: C.accent,
          flexShrink: 0,
        }}><Plus size={16} /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 8px" }}>
        {/* 内建 AI 助手：与他私聊即 LLM 对话 */}
        <button
          onClick={openAI}
          disabled={openAssistantMut.isPending}
          title="与内建 AI 助手对话（LLM）"
          style={{
            ...rowBase, marginBottom: 12,
            background: (() => { const a = conversations.find(isAssistantConv); return a && a.id === activeId ? C.accentSoft : "var(--c-elevated, rgba(128,128,128,0.08))"; })(),
            border: `1px solid ${C.accent}55`,
          }}
        >
          <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `${C.accent}22`, color: C.accent }}>
            <Sparkles size={15} />
          </span>
          <span style={nameCol}>
            <span style={{ fontWeight: 700, fontSize: 13, color: C.t1, display: "block" }}>AI 助手</span>
            <span style={{ fontSize: 11, color: C.t3, display: "block" }}>LLM 智能对话</span>
          </span>
        </button>
        <Section title="大厅" icon={<Globe size={12} />}>
          {lobby.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => pick(c.id)} />)}
        </Section>
        <Section title="群聊" icon={<Users size={12} />}>
          {groups.length === 0 && <Empty text="暂无群聊" />}
          {groups.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => pick(c.id)} />)}
        </Section>
        <Section title="私聊" icon={<MessageSquare size={12} />}>
          {dms.length === 0 && <Empty text="暂无私聊" />}
          {dms.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => pick(c.id)} />)}
        </Section>
        {filteredJoinable.length > 0 && (
          <Section title="可加入的房间" icon={<LogIn size={12} />}>
            {filteredJoinable.map((r) => (
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
      width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
      // 柔和底色 + 彩色图标/字，不做整块实色填充（降低显眼度）
      background: `${avatarGrad(seed)}26`, color: avatarGrad(seed), fontSize: 11, fontWeight: 700,
    }}>{icon ?? initials(label)}</span>
  );
}

function ConvRow({ c, active, onClick }: { c: ConversationSummary; active: boolean; onClick: () => void }) {
  const title = c.type === "dm" ? (c.peer?.name ?? `用户${c.peer?.id ?? ""}`) : c.type === "lobby" ? "大厅" : (c.title ?? "群聊");
  const seed = c.type === "dm" ? `u${c.peer?.id}` : `c${c.id}`;
  const icon = c.type === "lobby" ? <Globe size={14} /> : c.type === "dm" ? undefined : c.isPrivate ? <Lock size={14} /> : <Hash size={14} />;
  return (
    <button onClick={onClick} style={{
      ...rowBase,
      background: active ? C.accentSoft : "transparent",
      boxShadow: active ? `inset 2px 0 0 ${C.accent}` : "none",
    }}>
      <Avatar seed={seed} label={title} icon={icon} />
      <span style={nameCol}>
        <span style={{ fontWeight: 600, fontSize: 13, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{title}</span>
        {c.lastMessage && (
          <span style={{ fontSize: 11, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
            {c.lastMessage.senderName}: {c.lastMessage.content.replace(/^\[#DLREQ:\d+\]\n?/, "📥 ") || "[文件]"}
          </span>
        )}
      </span>
      {c.mode === "serverless" && <ShieldCheck size={13} style={{ color: C.t4, flexShrink: 0 }} />}
      {c.unread > 0 && <span style={{ fontSize: 11, fontWeight: 800, background: C.accentSoft, color: C.accent, borderRadius: 10, padding: "1px 7px", flexShrink: 0 }}>{c.unread}</span>}
    </button>
  );
}

const rowBase: React.CSSProperties = {
  width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
  borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", marginBottom: 2, color: C.t1,
};
const nameCol: React.CSSProperties = { flex: 1, minWidth: 0 };
