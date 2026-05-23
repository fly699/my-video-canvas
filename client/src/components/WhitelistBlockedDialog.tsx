import { ShieldOff, Copy, Check } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useWhitelistBlocked } from "../hooks/useWhitelistBlocked";

const RESTRICTED_FEATURES = [
  "图像生成（Storyboard / Prompt / Image Gen 节点）",
  "视频生成（Video Task 节点）",
  "音乐生成 / 配音（Audio 节点 AI 功能）",
  "语音转录（Subtitle 节点自动转录）",
];

export function WhitelistBlockedDialog() {
  const { visible, hide } = useWhitelistBlocked();
  const [copied, setCopied] = useState<"id" | "ip" | null>(null);
  const meQuery = trpc.auth.me.useQuery(undefined, { enabled: visible, staleTime: 60_000 });

  if (!visible) return null;

  const userId = meQuery.data?.id;
  const userEmail = meQuery.data?.email;

  const copyText = async (text: string, key: "id" | "ip") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  };

  return (
    // Backdrop
    <div
      onClick={hide}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
    >
      {/* Dialog card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--c-surface, #1a1a2e)",
          border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))",
          borderRadius: 16,
          padding: "32px 28px 24px",
          width: "100%",
          maxWidth: 460,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Icon + title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "oklch(0.45 0.18 25 / 0.25)",
            border: "1px solid oklch(0.55 0.18 25 / 0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <ShieldOff size={22} color="oklch(0.72 0.18 25)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--c-t1, #fff)" }}>
              功能受限
            </h2>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--c-t4, rgba(255,255,255,0.4))", marginTop: 2 }}>
              您没有使用此 AI 功能的权限
            </p>
          </div>
        </div>

        {/* Restricted features list */}
        <div style={{
          background: "var(--c-input, rgba(255,255,255,0.04))",
          border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: 16,
        }}>
          <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--c-t3, rgba(255,255,255,0.5))", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            受限功能
          </p>
          <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
            {RESTRICTED_FEATURES.map((f) => (
              <li key={f} style={{ fontSize: 13, color: "var(--c-t2, rgba(255,255,255,0.7))", marginBottom: 4 }}>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* How to apply */}
        <div style={{
          background: "oklch(0.45 0.15 250 / 0.12)",
          border: "1px solid oklch(0.55 0.15 250 / 0.25)",
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: 20,
        }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "oklch(0.75 0.15 250)" }}>
            如何申请权限？
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--c-t2, rgba(255,255,255,0.7))", lineHeight: 1.6 }}>
            请联系系统管理员，申请将您的<strong>账户 ID</strong> 或<strong> IP 地址</strong>加入白名单。
            管理员可登录后访问 <code style={{ fontSize: 12, background: "rgba(255,255,255,0.08)", padding: "1px 5px", borderRadius: 4 }}>/admin</code> 页面进行管理。
          </p>

          {/* User identity info for copying */}
          {userId != null && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <IdentityRow
                label="我的账户 ID"
                value={String(userId)}
                extraLabel={userEmail ? `（${userEmail}）` : ""}
                copied={copied === "id"}
                onCopy={() => copyText(String(userId), "id")}
              />
            </div>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={hide}
          style={{
            width: "100%", padding: "10px 0",
            background: "var(--c-surface2, rgba(255,255,255,0.07))",
            border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))",
            borderRadius: 10, cursor: "pointer",
            fontSize: 14, fontWeight: 600, color: "var(--c-t1, #fff)",
            transition: "background 150ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.11)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--c-surface2, rgba(255,255,255,0.07))")}
        >
          知道了
        </button>
      </div>
    </div>
  );
}

function IdentityRow({
  label, value, extraLabel, copied, onCopy,
}: {
  label: string; value: string; extraLabel?: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "rgba(255,255,255,0.05)", borderRadius: 7,
      padding: "6px 10px", gap: 8,
    }}>
      <span style={{ fontSize: 12, color: "var(--c-t3, rgba(255,255,255,0.45))", flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--c-t1, #fff)", fontFamily: "monospace", flexGrow: 1 }}>
        {value}
        {extraLabel && <span style={{ fontSize: 11.5, color: "var(--c-t4, rgba(255,255,255,0.35))", marginLeft: 4 }}>{extraLabel}</span>}
      </span>
      <button
        onClick={onCopy}
        title="复制"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: copied ? "oklch(0.72 0.18 145)" : "var(--c-t3, rgba(255,255,255,0.45))",
          padding: 2, display: "flex", alignItems: "center", flexShrink: 0,
          transition: "color 150ms ease",
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
