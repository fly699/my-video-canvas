import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wrench, Save, Loader2, ShieldAlert, Lock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

/** 管理员后台「配置体检 › 工程智能体权限」：把原本只能改 SUPER_AGENT_* 环境变量的三项开关
 *  （代码任务 / Bash 放行 / ComfyUI 缺件自动安装）搬到后台开关，保存即时生效、无需重启。
 *  语义：后台一旦保存即以本页为准、覆盖 .env（含显式关掉 env 已开的项）；从未保存过才回退 env。
 *  修改属高危（等于放开服务器上的代码/命令执行），故限站长（L5）；其余管理员可见但只读。 */
export function SuperAgentPermSection() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.getSuperAgent.useQuery();
  const saveMut = trpc.admin.models.setSuperAgent.useMutation();
  const myLevel = useAuth().user?.adminLevel ?? 0;
  const canEdit = myLevel >= 5;

  const [codeEnabled, setCodeEnabled] = useState(false);
  const [allowBash, setAllowBash] = useState(false);
  const [autoInstall, setAutoInstall] = useState(false);

  useEffect(() => {
    if (q.data) {
      setCodeEnabled(!!q.data.codeEnabled);
      setAllowBash(!!q.data.allowBash);
      setAutoInstall(!!q.data.autoInstall);
    }
  }, [q.data]);

  const save = async () => {
    try {
      await saveMut.mutateAsync({ codeEnabled, allowBash, autoInstall });
      await utils.admin.models.getSuperAgent.invalidate();
      await utils.admin.config.checklist.invalidate();
      toast.success("已保存工程智能体权限，即时生效（无需重启）");
    } catch (e) {
      toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140));
    }
  };

  const env = q.data?.env;
  const dbConfigured = q.data?.dbConfigured;
  const dirty = !!q.data && (codeEnabled !== !!q.data.codeEnabled || allowBash !== !!q.data.allowBash || autoInstall !== !!q.data.autoInstall);

  const toggleRow = (
    on: boolean, set: (v: boolean) => void, accent: string, label: string, hint: React.ReactNode, envOn?: boolean,
  ) => (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, color: "var(--c-t2)", cursor: canEdit ? "pointer" : "not-allowed", opacity: canEdit ? 1 : 0.75 }}>
      <input type="checkbox" checked={on} disabled={!canEdit} onChange={(e) => set(e.target.checked)} className="nodrag" style={{ marginTop: 2, accentColor: accent }} />
      <span style={{ flex: 1 }}>
        <strong style={{ color: "var(--c-t1)" }}>{label}</strong>
        {on && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: accent }}>● 已开启</span>}
        {typeof envOn === "boolean" && (
          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--c-t4)" }}>（.env 当前：{envOn ? "已设=1" : "未设"}）</span>
        )}
        <br /><span style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.7 }}>{hint}</span>
      </span>
    </label>
  );

  return (
    <div style={{ border: "1px solid oklch(0.7 0.16 40 / 0.4)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12, background: "oklch(0.7 0.16 40 / 0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        <Wrench className="w-4 h-4" style={{ color: "oklch(0.7 0.16 40)" }} /> 工程智能体权限（代码任务 / Bash / 自动安装）
        {!canEdit && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 4, fontSize: 10.5, fontWeight: 600, color: "var(--c-t4)" }}><Lock className="w-3 h-3" /> 仅站长可修改（当前只读）</span>}
      </div>

      <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.7, margin: 0 }}>
        「工程智能体」是走 ComfyUI/LLM 的高级智能体，可自动搭建工作流、跑代码任务。以下三项开关原来只能改
        服务器 <code>.env</code> 的 <code>SUPER_AGENT_*</code>，现可在此直接开关，<strong>保存即时生效、无需重启</strong>。
        一旦本页保存过，即<strong>以本页为准、覆盖 <code>.env</code></strong>（未保存过才回退 <code>.env</code>）。
      </p>

      {/* 高危提示 */}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 10, background: "oklch(0.7 0.16 25 / 0.10)", border: "1px solid oklch(0.7 0.16 25 / 0.4)" }}>
        <ShieldAlert className="w-4 h-4" style={{ color: "oklch(0.68 0.19 25)", flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 11, color: "var(--c-t2)", lineHeight: 1.8, margin: 0 }}>
          <strong style={{ color: "oklch(0.7 0.16 25)" }}>高危权限，仅在受信任部署开启。</strong>
          「代码任务」会在服务器上以受限工作区跑 Claude Code；再开「Bash 放行」等于放开任意命令执行——
          务必同时配好执行前审批（<code>SUPER_AGENT_PERMISSION_CMD</code>），否则危险命令只能靠事后监控。
          代码任务的<strong>使用</strong>本身仍限超级管理员（L4），本开关的<strong>修改</strong>限站长（L5）。
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 4px" }}>
        {toggleRow(codeEnabled, setCodeEnabled, "oklch(0.7 0.16 40)", "代码任务（Claude Code 编码智能体）",
          <>放行「工程智能体·代码任务」：在一次性受限工作区里读写文件、（可选）跑命令。对应 <code>SUPER_AGENT_CODE_ENABLED=1</code>。关闭时该通道完全 inert。</>,
          env?.codeEnabled)}
        {toggleRow(allowBash, setAllowBash, "oklch(0.68 0.19 25)", "Bash 放行（第二把钥匙）",
          <>额外放行原始 Bash（任意 shell）。<strong>仅在「代码任务」已开时有意义</strong>；不开则只放行 Read/Edit/Write（只读沙箱最安全）。对应 <code>SUPER_AGENT_CODE_ALLOW_BASH=1</code>。{allowBash && !q.data?.permissionCmdSet && <span style={{ color: "oklch(0.72 0.16 60)" }}> ⚠ 未检测到执行前审批（SUPER_AGENT_PERMISSION_CMD），危险命令只能事后监控。</span>}</>,
          env?.allowBash)}
        {toggleRow(autoInstall, setAutoInstall, "oklch(0.68 0.16 160)", "ComfyUI 缺件自动安装",
          <>允许智能体在缺模型/自定义节点时自动下载安装。<strong>仅对「已在运维台注册 SSH 且启用、地址匹配」的 ComfyUI 服务器生效</strong>，且需 L3+ 用户。对应 <code>SUPER_AGENT_AUTO_INSTALL=1</code>。</>,
          env?.autoInstall)}
      </div>

      {q.isLoading && <div style={{ fontSize: 12, color: "var(--c-t3)", display: "flex", alignItems: "center", gap: 6 }}><Loader2 className="w-3.5 h-3.5 animate-spin" /> 读取当前配置…</div>}
      {dbConfigured === false && !q.isLoading && (
        <div style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.6 }}>当前仍沿用 <code>.env</code> 的 <code>SUPER_AGENT_*</code>（后台尚未保存过）。点「保存」后即改由本页接管。</div>
      )}

      {canEdit ? (
        <button onClick={save} disabled={saveMut.isPending || !dirty} className="nodrag flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg self-start"
          style={{ fontSize: 12, fontWeight: 700, background: dirty ? "oklch(0.7 0.16 40)" : "var(--c-input)", border: "1px solid oklch(0.7 0.16 40 / 0.5)", color: dirty ? "#2a1200" : "var(--c-t3)", cursor: saveMut.isPending || !dirty ? "not-allowed" : "pointer" }}>
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {dirty ? "保存权限配置" : "无改动"}
        </button>
      ) : (
        <div style={{ fontSize: 11, color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 5 }}><Lock className="w-3.5 h-3.5" /> 修改工程智能体权限需站长（L5）身份。</div>
      )}
    </div>
  );
}
