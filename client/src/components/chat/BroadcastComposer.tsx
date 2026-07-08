import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Search, Users, Radio, Hash, User as UserIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { C } from "./chatTheme";

/**
 * 管理员广播编辑器（多选收件人）：标题 + 正文 + 收件对象（全体 / 自定义：勾选用户、房间/群组）。
 * 复用于「广播频道」内的「发起广播」入口，以及管理后台聊天面板。收件人取并集去重后下发到各自
 * 「系统公告」房 + 触发通知，并在共享「广播频道」留档。管理员(L3+) 专用（服务端 managerProc 二次门控）。
 */
export function BroadcastComposer({ onClose, onSent }: { onClose: () => void; onSent?: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"all" | "custom">("all");
  const [userIds, setUserIds] = useState<Set<number>>(new Set());
  const [convIds, setConvIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const targetsQ = trpc.admin.chat.broadcastTargets.useQuery(undefined, { enabled: scope === "custom", staleTime: 60_000 });
  const mu = trpc.admin.chat.broadcast.useMutation({
    onSuccess: (r) => { toast.success(`已广播给 ${r.delivered} / ${r.total} 位收件人`); onSent?.(); onClose(); },
    onError: (e) => toast.error("广播失败：" + e.message),
  });

  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const users = targetsQ.data?.users ?? [];
  const rooms = targetsQ.data?.rooms ?? [];
  const filteredUsers = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return users;
    return users.filter((u) => (u.name ?? "").toLowerCase().includes(kw) || (u.email ?? "").toLowerCase().includes(kw));
  }, [users, search]);

  const customCount = userIds.size + convIds.size;
  const canSend = !!title.trim() && !!body.trim() && !mu.isPending &&
    (scope === "all" || customCount > 0);

  const toggle = (set: Set<number>, id: number, setter: (s: Set<number>) => void) => {
    const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); setter(next);
  };

  const send = () => {
    if (!title.trim() || !body.trim()) { toast.error("请填写标题和正文"); return; }
    const scopeLabel = scope === "all" ? "全体用户" : `${customCount} 个所选对象（用户 ${userIds.size} · 房间 ${convIds.size}）`;
    if (!confirm(`确认向【${scopeLabel}】广播这条公告？\n\n标题：${title.trim()}`)) return;
    const targets = scope === "all"
      ? { all: true }
      : { userIds: Array.from(userIds), conversationIds: Array.from(convIds) };
    mu.mutate({ title: title.trim(), body: body.trim(), targets });
  };

  const chip = (active: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9,
    border: `1px solid ${active ? C.accent : C.borderStrong}`, background: active ? C.accentSoft : C.elevated,
    color: active ? C.accent : C.t1, cursor: "pointer", fontWeight: 600, fontSize: 13,
  });
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.borderStrong}`,
    background: C.bg, color: C.t1, fontSize: 13, outline: "none", boxSizing: "border-box",
  };
  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderRadius: 8, cursor: "pointer",
    background: active ? C.accentSoft : "transparent", color: C.t1, fontSize: 13,
  });

  return createPortal(
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="发起广播"
        style={{ width: "min(560px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,0.45)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <Radio size={18} style={{ color: C.accent }} />
          <b style={{ color: C.t1, fontSize: 15, flex: 1 }}>发起广播</b>
          <button onClick={onClose} aria-label="关闭" style={{ display: "inline-flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8, border: `1px solid ${C.border}`, background: C.elevated, color: C.t2, cursor: "pointer" }}><X size={16} /></button>
        </div>

        {/* body (scroll) */}
        <div style={{ padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="公告标题（如：系统将于今晚 22:00 维护）" maxLength={120} style={inputStyle} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="公告正文…" maxLength={2000} rows={4} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />

          {/* recipient scope */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setScope("all")} style={chip(scope === "all")}><Users size={14} /> 全体用户</button>
            <button onClick={() => setScope("custom")} style={chip(scope === "custom")}><Hash size={14} /> 自定义收件人</button>
          </div>

          {scope === "custom" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {targetsQ.isLoading ? (
                <p style={{ color: C.t3, fontSize: 12, margin: 0 }}>加载候选收件人…</p>
              ) : (
                <>
                  {/* rooms / groups */}
                  {rooms.length > 0 && (
                    <div>
                      <div style={{ color: C.t3, fontSize: 11, fontWeight: 700, margin: "2px 2px 6px" }}>房间 / 群组（选中即发给其全部成员）</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 9, padding: 5 }}>
                        {rooms.map((r) => (
                          <label key={r.id} style={rowStyle(convIds.has(r.id))}>
                            <input type="checkbox" checked={convIds.has(r.id)} onChange={() => toggle(convIds, r.id, setConvIds)} />
                            <Hash size={13} style={{ color: C.t3 }} />
                            <span style={{ flex: 1 }}>{r.title ?? `房间${r.id}`}</span>
                            <span style={{ color: C.t4, fontSize: 11 }}>{r.memberCount} 人</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* users */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "2px 2px 6px" }}>
                      <span style={{ color: C.t3, fontSize: 11, fontWeight: 700, flex: 1 }}>用户（{userIds.size} 已选 / 共 {users.length}）</span>
                      <div style={{ position: "relative", width: 150 }}>
                        <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: C.t4 }} />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索用户" style={{ ...inputStyle, padding: "5px 8px 5px 24px", fontSize: 12 }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 180, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 9, padding: 5 }}>
                      {filteredUsers.length === 0 ? (
                        <p style={{ color: C.t4, fontSize: 12, textAlign: "center", padding: "10px 0", margin: 0 }}>{users.length === 0 ? "暂无用户（开发模式无用户表）" : "无匹配用户"}</p>
                      ) : filteredUsers.map((u) => (
                        <label key={u.id} style={rowStyle(userIds.has(u.id))}>
                          <input type="checkbox" checked={userIds.has(u.id)} onChange={() => toggle(userIds, u.id, setUserIds)} />
                          <UserIcon size={13} style={{ color: C.t3 }} />
                          <span style={{ flex: 1 }}>{u.name ?? `用户${u.id}`}</span>
                          <span style={{ color: C.t4, fontSize: 11 }}>{u.email ?? ""}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, color: C.t4, flex: 1 }}>
            {scope === "all" ? "将下发给全体用户" : `将下发给 ${customCount} 个所选对象`} · {title.length}/120 · {body.length}/2000
          </span>
          <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.elevated, color: C.t2, cursor: "pointer", fontSize: 13 }}>取消</button>
          <button onClick={send} disabled={!canSend} style={{ padding: "8px 16px", borderRadius: 9, border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accent, cursor: canSend ? "pointer" : "not-allowed", fontWeight: 600, fontSize: 13, opacity: canSend ? 1 : 0.5 }}>
            {mu.isPending ? "广播中…" : "发送广播"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
