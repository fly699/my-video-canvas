import { useMemo, useState } from "react";
import { MessageSquare, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChat";
import { trpc } from "@/lib/trpc";
import { C, avatarGrad, initials } from "./chatTheme";

interface Row { userId: number; name: string; online: boolean }

export function MembersPanel() {
  const { activeConv, presence, myUserId, openDm, createGroupWith } = useChat();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const detailQuery = trpc.chat.getConversation.useQuery(
    { conversationId: activeConv?.id ?? 0 },
    { enabled: !!activeConv && activeConv.type !== "lobby" },
  );

  const rows: Row[] = useMemo(() => {
    const onlineIds = new Set(presence.map((p) => p.userId));
    const map = new Map<number, Row>();
    // conversation members (groups/dms)
    for (const m of detailQuery.data?.members ?? []) {
      map.set(m.userId, { userId: m.userId, name: m.name, online: onlineIds.has(m.userId) });
    }
    // lobby / anyone currently online
    for (const p of presence) {
      if (!map.has(p.userId)) map.set(p.userId, { userId: p.userId, name: p.name, online: true });
    }
    return Array.from(map.values()).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }, [detailQuery.data, presence]);

  const onlineCount = rows.filter((r) => r.online).length;

  function toggle(id: number) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function makeGroup() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const title = window.prompt("群聊名称：", "新群聊");
    if (!title) return;
    try { await createGroupWith(title, ids); setSelected(new Set()); toast.success("群聊已创建"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "创建失败"); }
  }

  if (!activeConv) {
    return <aside style={panel}><div style={{ padding: 16, color: C.t3, fontSize: 13 }}>选择会话查看成员</div></aside>;
  }

  return (
    <aside style={panel}>
      <div style={{ padding: "14px 14px 10px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
          <UsersRound size={16} style={{ color: C.accent }} /> 成员
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.t3 }}>
            <span style={{ color: C.online }}>● {onlineCount} 在线</span> / {rows.length}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {rows.length === 0 && <div style={{ padding: 12, color: C.t4, fontSize: 13 }}>暂无在线成员</div>}
        {rows.map((r) => {
          const me = r.userId === myUserId;
          return (
            <div key={r.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 10 }}>
              {!me && (
                <input type="checkbox" checked={selected.has(r.userId)} onChange={() => toggle(r.userId)}
                       title="选择以组建群聊" style={{ accentColor: C.accent, width: 15, height: 15 }} />
              )}
              {me && <span style={{ width: 15 }} />}
              <span style={{ position: "relative", flexShrink: 0 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: avatarGrad(`u${r.userId}`), color: "#fff", fontSize: 12, fontWeight: 700 }}>{initials(r.name)}</span>
                <span style={{ position: "absolute", right: -2, bottom: -2, width: 11, height: 11, borderRadius: "50%", background: r.online ? C.online : C.offline, border: `2px solid ${C.bg2}` }} title={r.online ? "在线" : "离线"} />
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}{me && <span style={{ color: C.t3, fontSize: 12 }}>（我）</span>}
              </span>
              {!me && (
                <button onClick={() => openDm(r.userId).catch((e) => toast.error(e instanceof Error ? e.message : "无法私聊"))}
                        title="发起私聊" style={{ display: "inline-flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)", color: C.t2, cursor: "pointer", flexShrink: 0 }}>
                  <MessageSquare size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>
          <button onClick={makeGroup} style={{ width: "100%", padding: "10px 0", border: "none", borderRadius: 10, cursor: "pointer", background: C.accentGrad, color: "#1a1205", fontWeight: 700, boxShadow: "0 4px 14px rgba(245,158,11,0.25)" }}>
            组建群聊（已选 {selected.size} 人）
          </button>
        </div>
      )}
    </aside>
  );
}

const panel: React.CSSProperties = {
  width: 244, flexShrink: 0, borderLeft: `1px solid ${C.border}`, background: C.bg2,
  display: "flex", flexDirection: "column", minHeight: 0,
};
