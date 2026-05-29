import { useEffect } from "react";
import { useLanChat } from "@/hooks/useLanChat";
import { LanChatPanel } from "@/components/lan-chat/LanChatPanel";
import { NicknamePicker } from "@/components/lan-chat/NicknamePicker";
import { ThemeSwitcher } from "@/components/canvas/ThemeSwitcher";

/**
 * Standalone full-screen LAN chat at /lan-chat. The Express layer in
 * server/_core/index.ts 403s this path for non-LAN IPs so the bundle never
 * even loads externally — when we reach this component the user is on LAN.
 */
export default function LanChatPage() {
  const { session, join, fingerprint } = useLanChat();

  // Register a PWA manifest scoped to /lan-chat so the chat can be
  // "installed" and launched as a standalone app window — that's the only
  // way to get a truly address-bar-free window (browser security forces a
  // minimal origin bar on every popup; a web page cannot remove it). We
  // inject the <link> only here so the main canvas app's install behavior
  // is untouched. Cleaned up on unmount.
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/lan-chat.webmanifest";
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, []);

  if (!session) {
    return (
      <NicknamePicker
        fingerprint={fingerprint}
        onSubmit={async (n, gid) => { await join(n, gid); }}
      />
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col" style={{ background: "var(--c-base)" }}>
      <header
        className="flex items-center gap-3 px-4 h-12 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--c-bd1)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "oklch(0.68 0.22 285 / 0.15)", color: "oklch(0.82 0.20 285)" }}
          >
            <span style={{ fontSize: 14 }}>💬</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>局域网聊天</span>
            <span className="text-[10px]" style={{ color: "oklch(0.70 0.20 50)" }}>
              端到端加密 · 支持内网直传 · 文件上限 256MB
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* Theme picker — lets the popup/standalone window switch to a
              light theme independently (it's a separate window with its
              own ThemeProvider). */}
          <ThemeSwitcher />
          <span className="text-[11px] px-2 py-0.5 rounded" style={{
            background: session.color + "22",
            color: session.color,
            border: `1px solid ${session.color}44`,
          }}>
            {session.nickname}
          </span>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <LanChatPanel visible />
      </div>
    </div>
  );
}
