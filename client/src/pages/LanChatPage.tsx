import { useLanChat } from "@/hooks/useLanChat";
import { LanChatPanel } from "@/components/lan-chat/LanChatPanel";
import { NicknamePicker } from "@/components/lan-chat/NicknamePicker";

/**
 * Standalone full-screen LAN chat at /lan-chat. The Express layer in
 * server/_core/index.ts 403s this path for non-LAN IPs so the bundle never
 * even loads externally — when we reach this component the user is on LAN.
 */
export default function LanChatPage() {
  const { session, join } = useLanChat();

  if (!session) {
    return <NicknamePicker onSubmit={async (n) => { await join(n); }} />;
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
          <span className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>局域网聊天</span>
        </div>
        <span className="ml-auto text-[11px] px-2 py-0.5 rounded" style={{
          background: session.color + "22",
          color: session.color,
          border: `1px solid ${session.color}44`,
        }}>
          {session.nickname}
        </span>
      </header>
      <div className="flex-1 min-h-0">
        <LanChatPanel visible />
      </div>
    </div>
  );
}
