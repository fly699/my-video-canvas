import { useState, useEffect, useRef } from "react";
import { MessageSquare, Loader2, AlertTriangle } from "lucide-react";
import type { Fingerprint } from "@/hooks/useLanFingerprint";

interface NicknamePickerProps {
  onSubmit: (nickname: string) => Promise<void>;
  busy?: boolean;
  /** Three-state IP-detection result. Picker disables input + shows
   *  loading/error UI until state === "ready". */
  fingerprint: Fingerprint;
}

/**
 * Modal asking for a nickname. Same modal handles all three states of
 * the public-IP detection: loading spinner → error card → ready form.
 * No "skip" affordance — the join button is only clickable when the
 * fingerprint is ready, so the user can't accidentally land in a
 * silently-degraded chat.
 */
export function NicknamePicker({ onSubmit, busy, fingerprint }: NicknamePickerProps) {
  const [value, setValue] = useState(() => {
    try { return window.localStorage.getItem("lan-chat:last-nickname:v1") ?? ""; }
    catch { return ""; }
  });
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fingerprint.state === "ready") inputRef.current?.focus();
  }, [fingerprint.state]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fingerprint.state !== "ready") return;
    const trimmed = value.trim();
    if (!trimmed) { setErr("请输入昵称"); return; }
    if (trimmed.length > 20) { setErr("昵称最长 20 字"); return; }
    setErr(null);
    try {
      await onSubmit(trimmed);
      try { window.localStorage.setItem("lan-chat:last-nickname:v1", trimmed); } catch { /* quota */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加入失败");
    }
  };

  const ready = fingerprint.state === "ready";
  const disabled = !ready || busy || !value.trim();
  const sourceBadge = ready
    ? fingerprint.source === "invite"
      ? { label: "一次性邀请", color: "oklch(0.70 0.20 290)" }
      : fingerprint.source === "hash"
      ? { label: "邀请链接", color: "oklch(0.72 0.18 50)" }
      : { label: `公网 IP · ${fingerprint.groupId.slice(3)}`, color: "oklch(0.65 0.18 145)" }
    : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(8px)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-[340px] rounded-2xl p-5"
        style={{
          background: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          boxShadow: "0 24px 64px oklch(0 0 0 / 0.55)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "oklch(0.68 0.22 285 / 0.15)", color: "oklch(0.78 0.20 285)" }}
          >
            <MessageSquare style={{ width: 17, height: 17 }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>局域网聊天</p>
            <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>按公网出口 IP 分组 · 无需注册</p>
          </div>
        </div>

        {/* Loading state */}
        {fingerprint.state === "loading" && (
          <div
            className="flex items-center gap-2 py-3 px-3 rounded-lg"
            style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}
          >
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "oklch(0.78 0.20 285)" }} />
            <span className="text-xs" style={{ color: "var(--c-t2)" }}>正在获取你的公网出口 IP…</span>
          </div>
        )}

        {/* Error state — no skip, no degraded entry */}
        {fingerprint.state === "error" && (
          <div
            className="flex items-start gap-2 py-3 px-3 rounded-lg"
            style={{
              background: "oklch(0.62 0.20 25 / 0.08)",
              border: "1px solid oklch(0.62 0.20 25 / 0.30)",
            }}
          >
            <AlertTriangle style={{ width: 16, height: 16, color: "oklch(0.70 0.22 25)", flexShrink: 0, marginTop: 1 }} />
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--c-t2)" }}>
              {fingerprint.message}
            </p>
          </div>
        )}

        {/* Ready state — input + submit */}
        {ready && (
          <>
            <div className="flex items-center gap-1.5 mb-2">
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                style={{ background: `${sourceBadge!.color}22`, color: sourceBadge!.color, border: `1px solid ${sourceBadge!.color}44` }}
              >
                {sourceBadge!.label}
              </span>
              <span className="text-[9px]" style={{ color: "var(--c-t4)" }}>
                同此分组的用户才能看到你
              </span>
            </div>
            <input
              ref={inputRef}
              value={value}
              maxLength={20}
              onChange={(e) => { setValue(e.target.value); setErr(null); }}
              placeholder="昵称（最多 20 字）"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: "var(--c-input)",
                border: `1px solid ${err ? "oklch(0.62 0.20 25)" : "var(--c-bd2)"}`,
                color: "var(--c-t1)",
              }}
            />
            {err && (
              <p className="text-[10px] mt-1.5" style={{ color: "oklch(0.62 0.20 25)" }}>{err}</p>
            )}
            <button
              type="submit"
              disabled={disabled}
              className="w-full mt-3 py-2 rounded-lg text-xs font-semibold"
              style={{
                background: disabled ? "var(--c-surface)" : "oklch(0.68 0.22 285)",
                color: disabled ? "var(--c-t4)" : "white",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "加入中…" : "进入聊天"}
            </button>
          </>
        )}

        <p className="text-[9px] mt-2 leading-relaxed" style={{ color: "var(--c-t4)" }}>
          按你浏览器的公网出口 IP 分组：只有共享同一 NAT 网关（同一办公室/家庭网络）的人能看到你。跨网络用户永不互通；4G/5G 用户因运营商 CGNAT 可能与陌生人同组，请勿发送敏感信息。
        </p>
      </form>
    </div>
  );
}
