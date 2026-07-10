import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * 画布端「持续公告」进入横幅：每次进入画布时，若有生效中的持续公告（管理员在聊天
 * 广播里勾选「设为持续公告」），在顶栏下方居中弹一条短暂横幅（📢 + 标题），
 * 5 秒后自动消失——只做提醒，不常驻（常驻横幅在聊天窗顶部，见 ChatView 的
 * PersistentAnnounceBanner）。同一条公告本次进入只弹一次；换了新公告会再次弹出。
 */
export function CanvasAnnounceBanner() {
  const q = trpc.chat.getPersistentAnnouncement.useQuery(undefined, { staleTime: 30_000, refetchInterval: 5 * 60_000 });
  const ann = q.data?.announcement ?? null;
  const [visible, setVisible] = useState(false);
  const shownKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!ann?.createdAt) return;
    if (shownKeyRef.current === ann.createdAt) return; // 同一条公告只弹一次
    shownKeyRef.current = ann.createdAt;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, [ann?.createdAt]);
  if (!ann || !visible) return null;
  return (
    <div
      className="chat-announce-blink"
      role="status"
      style={{
        position: "fixed", top: 52, left: "50%", transform: "translateX(-50%)", zIndex: 80,
        display: "flex", alignItems: "center", gap: 8, maxWidth: "min(560px, 90vw)",
        padding: "8px 16px", borderRadius: 11,
        background: "rgba(245,158,11,0.14)",
        border: "1px solid rgba(245,158,11,0.45)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
        backdropFilter: "blur(10px)",
        color: "var(--c-t1, #ededf0)", fontSize: 13, lineHeight: 1.5,
        pointerEvents: "none", // 纯提示，不挡画布交互；5 秒后自动消失
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, fontSize: 15 }}>📢</span>
      <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ann.title}</b>
    </div>
  );
}
