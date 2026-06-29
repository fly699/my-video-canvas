import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Users, Mail, Link2, X, Trash2, Copy, Globe, Lock, ChevronDown } from "lucide-react";

type Role = "viewer" | "editor" | "admin";

interface Props {
  projectId: number;
  /** Effective role of the current user — gates UI affordances */
  currentUserRole: "owner" | Role;
  publicReadAccess: boolean;
  onClose: () => void;
}

const ROLE_LABEL: Record<Role | "owner", string> = {
  viewer: "查看者",
  editor: "编辑者",
  admin: "管理员",
  owner: "所有者",
};

const ROLE_DESC: Record<Role, string> = {
  viewer: "只读 — 可查看画布与协作光标",
  editor: "编辑 — 可增删改节点、触发 AI 生成",
  admin: "管理 — 编辑权限 + 邀请/移除成员",
};

export function CollaborationPanel({ projectId, currentUserRole, publicReadAccess, onClose }: Props) {
  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
  const isOwner = currentUserRole === "owner";

  const utils = trpc.useUtils();
  const membersQ = trpc.collaboration.listMembers.useQuery({ projectId });
  const shareLinksQ = trpc.collaboration.listShareLinks.useQuery({ projectId }, { enabled: isAdmin });

  const inviteMu = trpc.collaboration.inviteByEmail.useMutation({
    onSuccess: () => { toast.success("邀请已发送"); membersQ.refetch(); setInviteEmail(""); },
    onError: (e) => toast.error(e.message),
  });
  const updateRoleMu = trpc.collaboration.updateMemberRole.useMutation({
    onSuccess: () => { membersQ.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const removeMu = trpc.collaboration.removeMember.useMutation({
    onSuccess: () => { toast.success("已移除"); membersQ.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  // Optimistic update so the toggle visually flips the instant the user
  // clicks — without it, the bg color only updates after the projects.get
  // refetch completes (~500ms+), which reads to users as "click did nothing".
  const setPublicMu = trpc.collaboration.setPublicAccess.useMutation({
    onMutate: async (vars) => {
      await utils.projects.get.cancel({ id: vars.projectId });
      const prev = utils.projects.get.getData({ id: vars.projectId });
      if (prev) {
        utils.projects.get.setData(
          { id: vars.projectId },
          { ...prev, publicReadAccess: vars.publicReadAccess },
        );
      }
      return { prev };
    },
    onError: (e, vars, ctx) => {
      if (ctx?.prev) utils.projects.get.setData({ id: vars.projectId }, ctx.prev);
      toast.error(e.message);
    },
    onSettled: (_data, _err, vars) => {
      utils.projects.get.invalidate({ id: vars.projectId });
    },
    onSuccess: () => { toast.success("已更新"); },
  });
  const leaveMu = trpc.collaboration.leaveProject.useMutation({
    onSuccess: () => {
      toast.success("已退出项目");
      setTimeout(() => { window.location.href = "/"; }, 600);
    },
    onError: (e) => toast.error(e.message),
  });
  const createLinkMu = trpc.collaboration.createShareLink.useMutation({
    onSuccess: () => { shareLinksQ.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const revokeLinkMu = trpc.collaboration.revokeShareLink.useMutation({
    onSuccess: () => { toast.success("已撤销"); shareLinksQ.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");

  const [linkRole, setLinkRole] = useState<Role>("editor");
  const [linkMaxUses, setLinkMaxUses] = useState(1);
  const [linkExpiresInDays, setLinkExpiresInDays] = useState(7);

  return (
    <div
      className="fixed top-0 right-0 h-full z-40 flex flex-col"
      style={{
        width: 360,
        background: "color-mix(in oklch, var(--c-base) 97%, transparent)",
        backdropFilter: "blur(28px)",
        borderLeft: "1px solid var(--c-bd2)",
        boxShadow: "-8px 0 40px oklch(0 0 0 / 0.28)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
        <Users style={{ width: 14, height: 14, color: "oklch(0.68 0.22 285)" }} />
        <span className="text-sm font-semibold flex-1" style={{ color: "var(--c-t1)" }}>协作管理</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "var(--c-t4)", background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}>
          {ROLE_LABEL[currentUserRole]}
        </span>
        <button onClick={onClose} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: "var(--c-t4)" }}>
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Public read toggle (owner only) */}
        {isOwner && (
          <section>
            <SectionHeader icon={publicReadAccess ? Globe : Lock} title="公开访问" />
            <div
              className="flex items-start gap-3 p-3 rounded-lg"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}
            >
              <div className="flex-1">
                <p className="text-xs font-medium" style={{ color: "var(--c-t1)" }}>
                  {publicReadAccess ? "已开启 — 任何登录用户可查看" : "已关闭 — 仅授权成员可查看"}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--c-t4)" }}>
                  开启后他人通过项目链接可进入只读模式；编辑仍需被显式邀请
                </p>
              </div>
              <button
                role="switch"
                aria-checked={publicReadAccess}
                onClick={() => setPublicMu.mutate({ projectId, publicReadAccess: !publicReadAccess })}
                disabled={setPublicMu.isPending}
                className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
                style={{ background: publicReadAccess ? "oklch(0.68 0.22 285)" : "var(--c-bd2)" }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                  style={{ left: publicReadAccess ? 18 : 2 }}
                />
              </button>
            </div>
          </section>
        )}

        {/* Invite by email */}
        {isAdmin && (
          <section>
            <SectionHeader icon={Mail} title="邮箱邀请" />
            <div className="space-y-2">
              <input
                type="email"
                placeholder="对方的邮箱地址"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
              />
              <div className="flex gap-2">
                <RoleSelect value={inviteRole} onChange={setInviteRole} />
                <button
                  disabled={!inviteEmail || inviteMu.isPending}
                  onClick={() => inviteMu.mutate({ projectId, email: inviteEmail.trim(), role: inviteRole })}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                  style={{
                    background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                    opacity: !inviteEmail || inviteMu.isPending ? 0.5 : 1,
                  }}
                >
                  {inviteMu.isPending ? "发送中…" : "发送邀请"}
                </button>
              </div>
              <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>
                {ROLE_DESC[inviteRole]}
              </p>
            </div>
          </section>
        )}

        {/* Share links */}
        {isAdmin && (
          <section>
            <SectionHeader icon={Link2} title="分享链接" />
            <div className="space-y-2">
              <div className="flex gap-1.5 items-center">
                <RoleSelect value={linkRole} onChange={setLinkRole} />
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={linkMaxUses}
                  onChange={(e) => setLinkMaxUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  className="w-14 px-2 py-1.5 rounded-lg text-xs outline-none"
                  style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
                  title="最大使用次数"
                />
                <span className="text-[10px]" style={{ color: "var(--c-t4)" }}>次</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={linkExpiresInDays}
                  onChange={(e) => setLinkExpiresInDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                  className="w-14 px-2 py-1.5 rounded-lg text-xs outline-none"
                  style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
                  title="有效天数"
                />
                <span className="text-[10px]" style={{ color: "var(--c-t4)" }}>天</span>
              </div>
              <button
                disabled={createLinkMu.isPending}
                onClick={() => createLinkMu.mutate({ projectId, role: linkRole, maxUses: linkMaxUses, expiresInDays: linkExpiresInDays })}
                className="w-full px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-bd2)",
                  color: "var(--c-t1)",
                }}
              >
                {createLinkMu.isPending ? "创建中…" : "+ 生成新链接"}
              </button>
              <div className="space-y-1.5">
                {(shareLinksQ.data ?? []).filter((l) => l.active).length === 0 && (
                  <p className="text-[10px] text-center py-3" style={{ color: "var(--c-t4)" }}>暂无活跃链接</p>
                )}
                {(shareLinksQ.data ?? []).filter((l) => l.active).map((l) => (
                  <ShareLinkRow
                    key={l.id}
                    link={l}
                    onCopyLong={() => {
                      const url = `${window.location.origin}/invite/${l.token}`;
                      navigator.clipboard.writeText(url).then(() => toast.success("完整链接已复制"));
                    }}
                    onCopyShort={() => {
                      if (!l.shortCode) return;
                      const url = `${window.location.origin}/i/${l.shortCode}`;
                      navigator.clipboard.writeText(url).then(() => toast.success("短链接已复制"));
                    }}
                    onRevoke={() => revokeLinkMu.mutate({ projectId, linkId: l.id })}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Members list */}
        <section>
          <SectionHeader icon={Users} title="项目成员" />
          <div className="space-y-1.5">
            {(membersQ.data ?? []).map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isAdmin={isAdmin}
                onRoleChange={(role) => updateRoleMu.mutate({ projectId, memberId: m.id, role })}
                onRemove={() => removeMu.mutate({ projectId, memberId: m.id })}
              />
            ))}
            {(membersQ.data ?? []).length === 0 && (
              <p className="text-[10px] text-center py-3" style={{ color: "var(--c-t4)" }}>暂无其他成员</p>
            )}
          </div>
        </section>

        {/* Self-leave (non-owner) */}
        {!isOwner && (
          <section>
            <button
              onClick={() => {
                if (confirm("确认退出此项目？")) leaveMu.mutate({ projectId });
              }}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium"
              style={{
                background: "transparent",
                border: "1px solid oklch(0.62 0.20 25 / 0.4)",
                color: "oklch(0.62 0.20 25)",
              }}
            >退出项目</button>
          </section>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{ style?: React.CSSProperties; className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon style={{ width: 12, height: 12, color: "var(--c-t3)" }} />
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--c-t3)" }}>{title}</span>
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Role)}
        className="appearance-none pl-2.5 pr-7 py-1.5 rounded-lg text-xs outline-none cursor-pointer"
        style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
      >
        <option value="viewer">查看者</option>
        <option value="editor">编辑者</option>
        <option value="admin">管理员</option>
      </select>
      <ChevronDown style={{ width: 12, height: 12, position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: "var(--c-t4)", pointerEvents: "none" }} />
    </div>
  );
}

interface MemberRowProps {
  member: {
    id: number;
    userId: number | null;
    email: string | null;
    role: Role;
    status: "pending" | "active";
  };
  isAdmin: boolean;
  onRoleChange: (role: Role) => void;
  onRemove: () => void;
}

function MemberRow({ member, isAdmin, onRoleChange, onRemove }: MemberRowProps) {
  const label = member.email ?? `用户 #${member.userId}`;
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
      style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate" style={{ color: "var(--c-t1)" }}>{label}</p>
        <p className="text-[10px]" style={{ color: member.status === "pending" ? "oklch(0.72 0.18 45)" : "var(--c-t4)" }}>
          {member.status === "pending" ? "待注册激活" : ROLE_LABEL[member.role]}
        </p>
      </div>
      {isAdmin ? (
        <>
          <RoleSelect value={member.role} onChange={onRoleChange} />
          <button
            onClick={onRemove}
            className="w-6 h-6 rounded flex items-center justify-center"
            style={{ color: "oklch(0.62 0.20 25)" }}
            title="移除成员"
          ><Trash2 style={{ width: 12, height: 12 }} /></button>
        </>
      ) : (
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: "var(--c-t3)", background: "var(--c-input)" }}>
          {ROLE_LABEL[member.role]}
        </span>
      )}
    </div>
  );
}

interface ShareLinkRowProps {
  link: {
    id: number;
    token: string;
    role: Role;
    maxUses: number;
    usesCount: number;
    expiresAt: Date;
    shortCode?: string;
  };
  onCopyLong: () => void;
  onCopyShort: () => void;
  onRevoke: () => void;
}

function ShareLinkRow({ link, onCopyLong, onCopyShort, onRevoke }: ShareLinkRowProps) {
  const remaining = link.maxUses - link.usesCount;
  const daysLeft = Math.max(0, Math.ceil((new Date(link.expiresAt).getTime() - Date.now()) / 86400_000));
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
      style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono truncate" style={{ color: "var(--c-t2)" }}>{link.token.slice(0, 12)}…</p>
        <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>
          {ROLE_LABEL[link.role]} · 剩 {remaining} 次 · {daysLeft}天
        </p>
      </div>
      <button onClick={onCopyLong} className="px-2 h-6 rounded flex items-center gap-1 text-[10px]" style={{ color: "var(--c-t3)", border: "1px solid var(--c-bd2)" }} title="复制完整链接">
        <Copy style={{ width: 11, height: 11 }} />长
      </button>
      {link.shortCode && (
        <button onClick={onCopyShort} className="px-2 h-6 rounded flex items-center gap-1 text-[10px]" style={{ color: "oklch(0.72 0.18 285)", border: "1px solid oklch(0.68 0.22 285 / 0.4)" }} title="复制短链接（适合 SMS / WeChat / QR 码）">
          <Copy style={{ width: 11, height: 11 }} />短
        </button>
      )}
      <button onClick={onRevoke} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: "oklch(0.62 0.20 25)" }} title="撤销链接">
        <Trash2 style={{ width: 12, height: 12 }} />
      </button>
    </div>
  );
}
