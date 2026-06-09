import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, X, Loader2 } from "lucide-react";

/** 修改自己的密码弹窗（受控）。调用 POST /api/auth/change-password（校验当前密码）。
 *  仅对邮箱密码账号有效；OAuth/dev 账号后端会返回相应错误。 */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (next.length < 6) { toast.error("新密码至少 6 位"); return; }
    if (next !== confirm) { toast.error("两次输入的新密码不一致"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data?.error || "修改密码失败"); return; }
      toast.success("密码已修改");
      close();
    } catch (e) {
      toast.error("修改密码失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const input: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: 8, fontSize: 13,
    background: "var(--c-input, var(--c-surface))", border: "1px solid var(--c-bd2)",
    color: "var(--c-t1)", outline: "none",
  };

  return (
    <div onMouseDown={close} style={{ position: "fixed", inset: 0, zIndex: 100000, background: "oklch(0 0 0 / 0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 360, maxWidth: "100%", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 12px 40px oklch(0 0 0 / 0.5)", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <KeyRound style={{ width: 16, height: 16, color: "oklch(0.72 0.2 285)" }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--c-t1)" }}>修改密码</span>
          <button onClick={close} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--c-t3)" }}><X style={{ width: 16, height: 16 }} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input type="password" placeholder="当前密码" value={current} onChange={(e) => setCurrent(e.target.value)} style={input} autoFocus />
          <input type="password" placeholder="新密码（至少 6 位）" value={next} onChange={(e) => setNext(e.target.value)} style={input} />
          <input type="password" placeholder="确认新密码" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={input}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={close} disabled={busy} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 13, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>取消</button>
          <button onClick={submit} disabled={busy} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 13, background: "oklch(0.72 0.2 285 / 0.15)", border: "1px solid oklch(0.72 0.2 285 / 0.4)", color: "oklch(0.72 0.2 285)", cursor: busy ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {busy && <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />}确定
          </button>
        </div>
      </div>
    </div>
  );
}
