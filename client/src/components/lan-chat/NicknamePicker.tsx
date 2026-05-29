import { useState, useEffect, useRef } from "react";
import { MessageSquare, Loader2, AlertTriangle } from "lucide-react";
import type { Fingerprint, DetectedGroup } from "@/hooks/useLanFingerprint";

interface NicknamePickerProps {
  onSubmit: (nickname: string, groupId: string) => Promise<void>;
  busy?: boolean;
  fingerprint: Fingerprint;
}

const GROUP_SOURCE_LABELS: Record<DetectedGroup["source"], string> = {
  "hash": "邀请链接分组",
  "ip-server": "服务器观测出口 IP（推荐）",
  "ip-browser": "浏览器探测出口 IP",
  "invite": "一次性邀请",
};

export function NicknamePicker({ onSubmit, busy, fingerprint }: NicknamePickerProps) {
  const [nickname, setNickname] = useState(() => {
    try { return window.localStorage.getItem("lan-chat:last-nickname:v1") ?? ""; }
    catch { return ""; }
  });
  const [err, setErr] = useState<string | null>(null);

  // Group selection state.
  // selectedGroupId: one of the detected groups.
  // useCustom + customCode: "手动输入代号" branch.
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [useCustom, setUseCustom] = useState(false);
  const [customCode, setCustomCode] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  // Auto-select the recommended group whenever fingerprint becomes ready
  // (or its groups list changes, e.g. IPs arrived after hash was pre-populated).
  useEffect(() => {
    if (fingerprint.state !== "ready") return;
    // Only auto-select if the user hasn't manually chosen yet, or if the
    // previously selected group has disappeared from the list.
    const ids = fingerprint.groups.map((g) => g.groupId);
    if (!useCustom && (!selectedGroupId || !ids.includes(selectedGroupId))) {
      setSelectedGroupId(fingerprint.groupId);
    }
  }, [fingerprint]);

  useEffect(() => {
    if (fingerprint.state === "ready") inputRef.current?.focus();
  }, [fingerprint.state]);

  useEffect(() => {
    if (useCustom) customInputRef.current?.focus();
  }, [useCustom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fingerprint.state !== "ready") return;

    const trimmedNick = nickname.trim();
    if (!trimmedNick) { setErr("请输入昵称"); return; }
    if (trimmedNick.length > 20) { setErr("昵称最长 20 字"); return; }

    let effectiveGroupId: string;
    if (useCustom) {
      const code = customCode.trim();
      if (!code) { setErr("请输入团队代号"); return; }
      effectiveGroupId = `code-${code}`;
    } else {
      if (!selectedGroupId) { setErr("请选择分组"); return; }
      effectiveGroupId = selectedGroupId;
    }

    setErr(null);
    try {
      await onSubmit(trimmedNick, effectiveGroupId);
      try { window.localStorage.setItem("lan-chat:last-nickname:v1", trimmedNick); } catch { /* quota */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加入失败");
    }
  };

  const ready = fingerprint.state === "ready";
  const disabled = !ready || busy || !nickname.trim() ||
    (useCustom ? !customCode.trim() : !selectedGroupId);

  // For invite-only (single option, non-selectable), skip the picker UI and
  // render a simple badge like the old design.
  const inviteOnly = ready && fingerprint.groups.length === 1 &&
    fingerprint.groups[0].source === "invite";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(8px)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-[380px] rounded-2xl p-5"
        style={{
          background: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          boxShadow: "0 24px 64px oklch(0 0 0 / 0.55)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "oklch(0.68 0.22 285 / 0.15)", color: "oklch(0.78 0.20 285)" }}
          >
            <MessageSquare style={{ width: 17, height: 17 }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>局域网聊天</p>
            <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>选择分组 · 无需注册</p>
          </div>
        </div>

        {/* Loading */}
        {fingerprint.state === "loading" && (
          <div
            className="flex items-center gap-2 py-3 px-3 rounded-lg mb-3"
            style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}
          >
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "oklch(0.78 0.20 285)" }} />
            <span className="text-xs" style={{ color: "var(--c-t2)" }}>正在探测你的出口 IP…</span>
          </div>
        )}

        {/* Error */}
        {fingerprint.state === "error" && (
          <div
            className="flex items-start gap-2 py-3 px-3 rounded-lg mb-3"
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

        {/* Ready — invite-only (no choice needed) */}
        {ready && inviteOnly && (
          <div className="flex items-center gap-1.5 mb-2">
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-medium"
              style={{
                background: "oklch(0.70 0.20 290 / 0.15)",
                color: "oklch(0.70 0.20 290)",
                border: "1px solid oklch(0.70 0.20 290 / 0.35)",
              }}
            >
              一次性邀请
            </span>
            <span className="text-[9px]" style={{ color: "var(--c-t4)" }}>同此分组的用户才能看到你</span>
          </div>
        )}

        {/* Ready — group picker */}
        {ready && !inviteOnly && (
          <div className="mb-3">
            <p className="text-[10px] font-medium mb-1.5" style={{ color: "var(--c-t3)" }}>
              选择要加入的分组
            </p>
            <div className="flex flex-col gap-1">
              {fingerprint.groups.map((g) => {
                const selected = !useCustom && selectedGroupId === g.groupId;
                return (
                  <button
                    key={g.groupId}
                    type="button"
                    onClick={() => { setSelectedGroupId(g.groupId); setUseCustom(false); }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left w-full"
                    style={{
                      background: selected
                        ? "oklch(0.68 0.22 285 / 0.12)"
                        : "var(--c-surface)",
                      border: `1px solid ${selected
                        ? "oklch(0.68 0.22 285 / 0.45)"
                        : "var(--c-bd1)"}`,
                      transition: "background 0.1s, border-color 0.1s",
                    }}
                  >
                    {/* Radio dot */}
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center"
                      style={{
                        border: `1.5px solid ${selected ? "oklch(0.68 0.22 285)" : "var(--c-t4)"}`,
                        background: selected ? "oklch(0.68 0.22 285)" : "transparent",
                      }}
                    >
                      {selected && (
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: "white" }}
                        />
                      )}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span
                        className="text-[12px] font-medium truncate"
                        style={{ color: "var(--c-t1)", fontFamily: "monospace" }}
                      >
                        {g.label}
                      </span>
                      <span className="text-[9px]" style={{ color: "var(--c-t4)" }}>
                        {GROUP_SOURCE_LABELS[g.source]}
                      </span>
                    </div>
                  </button>
                );
              })}

              {/* Manual code entry — must be a <div>, not <button>, because
                  it contains a child <input> (invalid HTML5 in <button>). */}
              {(() => {
                const selected = useCustom;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setUseCustom(true)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setUseCustom(true); }}
                    className="flex items-start gap-2.5 px-3 py-2 rounded-lg text-left w-full cursor-pointer"
                    style={{
                      background: selected ? "oklch(0.68 0.22 285 / 0.12)" : "var(--c-surface)",
                      border: `1px solid ${selected ? "oklch(0.68 0.22 285 / 0.45)" : "var(--c-bd1)"}`,
                      transition: "background 0.1s, border-color 0.1s",
                    }}
                  >
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
                      style={{
                        border: `1.5px solid ${selected ? "oklch(0.68 0.22 285)" : "var(--c-t4)"}`,
                        background: selected ? "oklch(0.68 0.22 285)" : "transparent",
                      }}
                    >
                      {selected && (
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "white" }} />
                      )}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-[12px] font-medium" style={{ color: "var(--c-t1)" }}>
                        手动输入代号
                      </span>
                      {selected ? (
                        <input
                          ref={customInputRef}
                          value={customCode}
                          onChange={(e) =>
                            setCustomCode(
                              e.target.value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40),
                            )
                          }
                          placeholder="team-code（字母数字._-，最多 40 字）"
                          className="mt-1 px-2 py-1 rounded text-[11px] outline-none w-full"
                          style={{
                            background: "var(--c-input)",
                            border: "1px solid var(--c-bd2)",
                            color: "var(--c-t1)",
                            fontFamily: "monospace",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-[9px]" style={{ color: "var(--c-t4)" }}>
                          跨网络团队 · 与成员共享同一代号
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Nickname input + submit (always shown when ready) */}
        {ready && (
          <>
            <input
              ref={inputRef}
              value={nickname}
              maxLength={20}
              onChange={(e) => { setNickname(e.target.value); setErr(null); }}
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
          同一公网出口 IP（同一办公室/家庭 NAT）的用户自动同组。VPN 或 4G/5G 可能与陌生人共享出口 IP，请勿发送敏感信息。跨网络团队请选择「手动输入代号」并共享同一代号。
        </p>
      </form>
    </div>
  );
}
