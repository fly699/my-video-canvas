import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Shield, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";

type EntryType = "ip" | "user";

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();

  // Whitelist settings
  const settingsQuery = trpc.admin.whitelist.getSettings.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const entriesQuery = trpc.admin.whitelist.listEntries.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const utils = trpc.useUtils();

  const setEnabledMut = trpc.admin.whitelist.setEnabled.useMutation({
    onSuccess: () => utils.admin.whitelist.getSettings.invalidate(),
  });
  const addEntryMut = trpc.admin.whitelist.addEntry.useMutation({
    onSuccess: () => utils.admin.whitelist.listEntries.invalidate(),
  });
  const removeEntryMut = trpc.admin.whitelist.removeEntry.useMutation({
    onSuccess: () => utils.admin.whitelist.listEntries.invalidate(),
  });

  // Add entry form
  const [entryType, setEntryType] = useState<EntryType>("ip");
  const [entryValue, setEntryValue] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div style={pageStyle}>
        <div style={{ color: "var(--c-t2, rgba(255,255,255,0.45))", fontSize: "14px" }}>加载中…</div>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <Shield style={{ width: "40px", height: "40px", color: "rgba(239,68,68,0.6)", marginBottom: "12px" }} />
          <h2 style={{ margin: 0, color: "var(--c-t1, #f0f0f4)", fontSize: "18px" }}>无权访问</h2>
          <p style={{ margin: "8px 0 0", color: "var(--c-t2, rgba(255,255,255,0.45))", fontSize: "14px" }}>
            此页面仅限管理员访问。
          </p>
        </div>
      </div>
    );
  }

  const enabled = settingsQuery.data?.enabled ?? false;
  const entries = entriesQuery.data ?? [];

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!entryValue.trim()) {
      setAddError("请输入 IP 或用户 ID");
      return;
    }
    try {
      await addEntryMut.mutateAsync({
        type: entryType,
        value: entryValue.trim(),
        note: entryNote.trim() || undefined,
      });
      setEntryValue("");
      setEntryNote("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "添加失败";
      setAddError(msg);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ width: "100%", maxWidth: "760px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px" }}>
          <Shield style={{ width: "22px", height: "22px", color: "oklch(0.72 0.2 285)" }} />
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--c-t1, #f0f0f4)" }}>
            白名单管理
          </h1>
        </div>

        {/* Enable/Disable toggle */}
        <div style={{ ...cardStyle, marginBottom: "20px", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
              白名单开关
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--c-t2, rgba(255,255,255,0.45))" }}>
              {enabled
                ? "白名单已启用 — 只有白名单中的 IP 或用户才能使用 AI 模型接口（管理员不受限制）"
                : "白名单已关闭 — 所有已登录用户均可使用 AI 模型接口"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnabledMut.mutate({ enabled: !enabled })}
            disabled={setEnabledMut.isPending}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              border: "none",
              borderRadius: "8px",
              cursor: setEnabledMut.isPending ? "not-allowed" : "pointer",
              background: enabled ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
              color: enabled ? "#f87171" : "#4ade80",
              fontSize: "13px",
              fontWeight: 600,
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            {enabled
              ? <><ToggleRight style={{ width: "16px", height: "16px" }} /> 已启用</>
              : <><ToggleLeft style={{ width: "16px", height: "16px" }} /> 已关闭</>}
          </button>
        </div>

        {/* Add entry form */}
        <div style={{ ...cardStyle, marginBottom: "20px" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
            添加白名单条目
          </h3>
          <form onSubmit={handleAddEntry} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {/* Type selector */}
              <div style={{ minWidth: "120px" }}>
                <label style={labelStyle}>类型</label>
                <select
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value as EntryType)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="ip">IP 地址</option>
                  <option value="user">用户 ID</option>
                </select>
              </div>

              {/* Value */}
              <div style={{ flex: 1, minWidth: "160px" }}>
                <label style={labelStyle}>{entryType === "ip" ? "IP 地址" : "用户 ID"}</label>
                <input
                  type="text"
                  value={entryValue}
                  onChange={(e) => setEntryValue(e.target.value)}
                  placeholder={entryType === "ip" ? "例：192.168.1.1" : "例：42"}
                  style={inputStyle}
                />
              </div>

              {/* Note */}
              <div style={{ flex: 2, minWidth: "180px" }}>
                <label style={labelStyle}>备注（可选）</label>
                <input
                  type="text"
                  value={entryNote}
                  onChange={(e) => setEntryNote(e.target.value)}
                  placeholder="用途说明"
                  style={inputStyle}
                />
              </div>
            </div>

            {addError && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  color: "#f87171",
                  fontSize: "13px",
                }}
              >
                {addError}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={addEntryMut.isPending}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  border: "none",
                  borderRadius: "8px",
                  background: "oklch(0.58 0.22 285 / 0.7)",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: addEntryMut.isPending ? "not-allowed" : "pointer",
                  opacity: addEntryMut.isPending ? 0.6 : 1,
                  transition: "all 0.15s",
                }}
              >
                <Plus style={{ width: "14px", height: "14px" }} />
                添加
              </button>
            </div>
          </form>
        </div>

        {/* Entries table */}
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
            白名单列表 {entries.length > 0 && <span style={{ fontWeight: 400, color: "var(--c-t2, rgba(255,255,255,0.4))", fontSize: "13px" }}>({entries.length} 条)</span>}
          </h3>

          {entriesQuery.isLoading ? (
            <div style={{ color: "var(--c-t2, rgba(255,255,255,0.45))", fontSize: "13px" }}>加载中…</div>
          ) : entries.length === 0 ? (
            <div
              style={{
                padding: "32px",
                textAlign: "center",
                color: "var(--c-t2, rgba(255,255,255,0.3))",
                fontSize: "14px",
                border: "1px dashed rgba(255,255,255,0.08)",
                borderRadius: "8px",
              }}
            >
              暂无白名单条目
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr>
                    {["类型", "值", "备注", "添加时间", "操作"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "8px 12px",
                          textAlign: "left",
                          color: "var(--c-t2, rgba(255,255,255,0.4))",
                          fontWeight: 500,
                          borderBottom: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 600,
                            background: entry.type === "ip"
                              ? "rgba(99,102,241,0.15)"
                              : "rgba(34,197,94,0.12)",
                            color: entry.type === "ip" ? "#a5b4fc" : "#4ade80",
                          }}
                        >
                          {entry.type === "ip" ? "IP" : "用户"}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "monospace", color: "var(--c-t1, #f0f0f4)" }}>
                        {entry.value}
                      </td>
                      <td style={{ ...tdStyle, color: "var(--c-t2, rgba(255,255,255,0.45))" }}>
                        {entry.note ?? "—"}
                      </td>
                      <td style={{ ...tdStyle, color: "var(--c-t2, rgba(255,255,255,0.45))", whiteSpace: "nowrap" }}>
                        {new Date(entry.createdAt).toLocaleDateString("zh-CN")}
                      </td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => removeEntryMut.mutate({ id: entry.id })}
                          disabled={removeEntryMut.isPending}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "4px 10px",
                            border: "1px solid rgba(239,68,68,0.2)",
                            borderRadius: "6px",
                            background: "rgba(239,68,68,0.08)",
                            color: "#f87171",
                            fontSize: "12px",
                            fontWeight: 500,
                            cursor: removeEntryMut.isPending ? "not-allowed" : "pointer",
                            opacity: removeEntryMut.isPending ? 0.5 : 1,
                            transition: "all 0.15s",
                          }}
                        >
                          <Trash2 style={{ width: "12px", height: "12px" }} />
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
  padding: "48px 24px",
  background: "var(--color-background, #0d0d10)",
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  background: "var(--c-surface, #1a1a22)",
  border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
  borderRadius: "12px",
  padding: "24px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--c-t2, rgba(255,255,255,0.45))",
  marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 11px",
  border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
  borderRadius: "7px",
  background: "rgba(255,255,255,0.04)",
  color: "var(--c-t1, #f0f0f4)",
  fontSize: "13px",
  outline: "none",
  boxSizing: "border-box",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "var(--c-t1, #f0f0f4)",
};
