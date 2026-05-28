import { useState, useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";

interface NicknamePickerProps {
  onSubmit: (nickname: string) => Promise<void>;
  busy?: boolean;
}

/**
 * Modal asking for a nickname. Used on first entry to /lan-chat or first
 * time the canvas widget opens. localStorage caches the last nickname so
 * returning users get a one-click rejoin.
 */
export function NicknamePicker({ onSubmit, busy }: NicknamePickerProps) {
  const [value, setValue] = useState(() => {
    try { return window.localStorage.getItem("lan-chat:last-nickname:v1") ?? ""; }
    catch { return ""; }
  });
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(8px)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-[320px] rounded-2xl p-5"
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
            <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>输入昵称即可开聊，无需注册</p>
          </div>
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
          disabled={busy || !value.trim()}
          className="w-full mt-3 py-2 rounded-lg text-xs font-semibold"
          style={{
            background: busy || !value.trim() ? "var(--c-surface)" : "oklch(0.68 0.22 285)",
            color: busy || !value.trim() ? "var(--c-t4)" : "white",
            cursor: busy || !value.trim() ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "加入中…" : "进入聊天"}
        </button>
        <p className="text-[9px] mt-2 leading-relaxed" style={{ color: "var(--c-t4)" }}>
          本功能仅限同一局域网内使用；公网访问会被服务端拒绝。消息持久化保存到服务端数据库。
        </p>
      </form>
    </div>
  );
}
