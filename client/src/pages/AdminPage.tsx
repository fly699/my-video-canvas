import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Shield, Trash2, Plus, ToggleLeft, ToggleRight, ClipboardList, RefreshCw, HardDrive } from "lucide-react";

type EntryType = "ip" | "user";
type Tab = "whitelist" | "logs" | "storage";

const ACTION_LABELS: Record<string, string> = {
  login_email: "邮箱登录",
  login_oauth: "OAuth 登录",
  image_gen: "图像生成",
  video_gen: "视频生成",
  audio_music: "音乐生成",
  audio_dubbing: "配音生成",
  subtitle_transcribe: "语音转录",
};

const ACTION_COLORS: Record<string, string> = {
  login_email: "oklch(0.65 0.18 250)",
  login_oauth: "oklch(0.65 0.18 200)",
  image_gen: "oklch(0.65 0.2 310)",
  video_gen: "oklch(0.65 0.2 25)",
  audio_music: "oklch(0.65 0.2 140)",
  audio_dubbing: "oklch(0.65 0.2 160)",
  subtitle_transcribe: "oklch(0.65 0.18 60)",
};

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("whitelist");

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

  return (
    <div style={pageStyle}>
      <div style={{ width: "100%", maxWidth: "900px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
          <Shield style={{ width: "22px", height: "22px", color: "oklch(0.72 0.2 285)" }} />
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--c-t1, #f0f0f4)" }}>
            管理后台
          </h1>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "0" }}>
          {([["whitelist", "白名单管理"], ["logs", "操作日志"], ["storage", "存储设置"]] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "8px 18px",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid oklch(0.72 0.2 285)" : "2px solid transparent",
                background: "none",
                color: activeTab === tab ? "var(--c-t1, #f0f0f4)" : "var(--c-t2, rgba(255,255,255,0.45))",
                fontSize: "14px",
                fontWeight: activeTab === tab ? 600 : 400,
                cursor: "pointer",
                marginBottom: "-1px",
                transition: "color 150ms ease",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "whitelist" && <WhitelistPanel />}
        {activeTab === "logs" && <LogsPanel />}
        {activeTab === "storage" && <StoragePanel />}
      </div>
    </div>
  );
}

// ── Whitelist Panel ───────────────────────────────────────────────────────────

// ── Storage Panel ─────────────────────────────────────────────────────────────

function StoragePanel() {
  const settingsQuery = trpc.admin.storage.getSettings.useQuery();
  const utils = trpc.useUtils();
  const setMut = trpc.admin.storage.setPersist.useMutation({
    onSuccess: () => utils.admin.storage.getSettings.invalidate(),
  });

  const settings = settingsQuery.data;
  const loading = settingsQuery.isLoading;

  const handleToggle = (kind: "persistAudio" | "persistVideo") => {
    if (!settings) return;
    const newValue = !settings[kind];
    if (!newValue) {
      const confirmed = confirm(
        kind === "persistAudio"
          ? "确定关闭音频持久化？\n\n新生成的音频将直接使用 Poyo 上游 URL，约 24 小时后过期。已存在的音频不受影响。"
          : "确定关闭视频持久化？\n\n新生成的视频将直接使用上游 CDN URL（Poyo/Higgsfield），约 24 小时后过期。已存在的视频不受影响。"
      );
      if (!confirmed) return;
    }
    setMut.mutate({ [kind]: newValue });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...cardStyle, alignItems: "stretch", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
          <HardDrive style={{ width: 18, height: 18, color: "oklch(0.72 0.2 285)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
              Manus S3 存储持久化
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.5 }}>
              开启后系统会自动把生成的音频/视频下载并存到 Manus S3，URL 永久可用。<br />
              关闭后节点降级为直接使用模型提供商的上游 URL（Poyo: 24h 后过期；Higgsfield: 临时 CDN）。<br />
              图像生成不受此开关影响（始终持久化）。
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ color: "var(--c-t2)", fontSize: 13, padding: 12 }}>加载中...</div>
      )}

      {settings && (
        <>
          <ToggleRow
            label="持久化音频"
            description="音乐生成 / 配音 / TTS 输出"
            enabled={settings.persistAudio}
            disabled={setMut.isPending}
            onClick={() => handleToggle("persistAudio")}
          />
          <ToggleRow
            label="持久化视频"
            description="Poyo / Higgsfield 视频生成输出"
            enabled={settings.persistVideo}
            disabled={setMut.isPending}
            onClick={() => handleToggle("persistVideo")}
          />
        </>
      )}
    </div>
  );
}

function ToggleRow({ label, description, enabled, disabled, onClick }: {
  label: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = enabled ? ToggleRight : ToggleLeft;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 18px", background: "var(--c-surface, rgba(255,255,255,0.03))",
      border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))", borderRadius: 10,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--c-t1, #f0f0f4)" }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.4))", marginTop: 3 }}>{description}</div>
        <div style={{ fontSize: 11, color: enabled ? "oklch(0.7 0.18 145)" : "oklch(0.65 0.18 25)", marginTop: 4, fontWeight: 600 }}>
          状态：{enabled ? "已开启（永久存储）" : "已关闭（24h 后过期）"}
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          background: "none", border: "none", cursor: disabled ? "wait" : "pointer",
          padding: 4, opacity: disabled ? 0.5 : 1,
        }}
        title={enabled ? "点击关闭" : "点击开启"}
      >
        <Icon style={{
          width: 36, height: 36,
          color: enabled ? "oklch(0.7 0.18 145)" : "var(--c-t3, rgba(255,255,255,0.4))",
        }} />
      </button>
    </div>
  );
}

function WhitelistPanel() {
  const settingsQuery = trpc.admin.whitelist.getSettings.useQuery();
  const entriesQuery = trpc.admin.whitelist.listEntries.useQuery();
  const utils = trpc.useUtils();

  const setEnabledMut = trpc.admin.whitelist.setEnabled.useMutation({
    onSuccess: () => utils.admin.whitelist.getSettings.invalidate(),
  });
  const addEntryMut = trpc.admin.whitelist.addEntry.useMutation({
    onSuccess: () => utils.admin.whitelist.listEntries.invalidate(),
  });
  const removeEntryMut = trpc.admin.whitelist.removeEntry.useMutation({
    onSuccess: () => utils.admin.whitelist.listEntries.invalidate(),
    onError: (err) => alert(`删除失败：${err.message}`),
  });

  const [entryType, setEntryType] = useState<EntryType>("ip");
  const [entryValue, setEntryValue] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const enabled = settingsQuery.data?.enabled ?? false;
  const entries = entriesQuery.data ?? [];

  if (settingsQuery.isError || entriesQuery.isError) {
    return <div style={{ padding: "32px", color: "#f87171", fontSize: "14px" }}>加载白名单数据失败，请刷新页面重试。</div>;
  }
  if (settingsQuery.isLoading || entriesQuery.isLoading) {
    return <div style={{ padding: "32px", color: "var(--c-t2, rgba(255,255,255,0.4))", fontSize: "14px" }}>加载中…</div>;
  }

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!entryValue.trim()) { setAddError("请输入 IP 或用户 ID"); return; }
    try {
      await addEntryMut.mutateAsync({ type: entryType, value: entryValue.trim(), note: entryNote.trim() || undefined });
      setEntryValue(""); setEntryNote("");
    } catch (err: unknown) {
      // tRPC Zod errors come back as JSON-array strings — extract the first human-readable message.
      let msg = err instanceof Error ? err.message : "添加失败";
      try {
        const parsed = JSON.parse(msg);
        if (Array.isArray(parsed) && parsed[0]?.message) msg = parsed[0].message;
      } catch { /* not JSON, use as-is */ }
      setAddError(msg);
    }
  }

  return (
    <>
      {/* Enable/Disable toggle */}
      <div style={{ ...cardStyle, marginBottom: "20px", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>白名单开关</h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--c-t2, rgba(255,255,255,0.45))" }}>
            {enabled ? "已启用 — 只有白名单中的 IP 或账户可使用 AI 模型（管理员不受限）" : "已关闭 — 所有登录用户均可使用 AI 模型"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabledMut.mutate({ enabled: !enabled })}
          disabled={setEnabledMut.isPending}
          style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px",
            border: "none", borderRadius: "8px", cursor: "pointer", flexShrink: 0,
            background: enabled ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
            color: enabled ? "#f87171" : "#4ade80",
            fontSize: "13px", fontWeight: 600, transition: "all 0.15s",
          }}
        >
          {enabled ? <><ToggleRight style={{ width: "16px", height: "16px" }} />已启用</> : <><ToggleLeft style={{ width: "16px", height: "16px" }} />已关闭</>}
        </button>
      </div>

      {/* Add entry form */}
      <div style={{ ...cardStyle, marginBottom: "20px" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>添加白名单条目</h3>
        <form onSubmit={handleAddEntry} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ minWidth: "120px" }}>
              <label style={labelStyle}>类型</label>
              <select value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="ip">IP 地址</option>
                <option value="user">用户 ID</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "160px" }}>
              <label style={labelStyle}>{entryType === "ip" ? "IP 地址" : "用户 ID"}</label>
              <input type="text" value={entryValue} onChange={(e) => setEntryValue(e.target.value)} placeholder={entryType === "ip" ? "例：1.2.3.4" : "例：42"} style={inputStyle} />
              {entryType === "user" && <div style={{ fontSize: "11px", color: "var(--c-t2, rgba(255,255,255,0.35))", marginTop: "4px" }}>填写数字用户 ID（在操作日志"用户"列底部可查）</div>}
            </div>
            <div style={{ flex: 2, minWidth: "180px" }}>
              <label style={labelStyle}>备注（可选）</label>
              <input type="text" value={entryNote} onChange={(e) => setEntryNote(e.target.value)} placeholder="用途说明" style={inputStyle} />
            </div>
          </div>
          {addError && <div style={{ padding: "8px 12px", borderRadius: "6px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: "13px" }}>{addError}</div>}
          <div>
            <button type="submit" disabled={addEntryMut.isPending} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 16px", border: "none", borderRadius: "8px", background: "oklch(0.58 0.22 285 / 0.7)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", opacity: addEntryMut.isPending ? 0.6 : 1 }}>
              <Plus style={{ width: "14px", height: "14px" }} /> 添加
            </button>
          </div>
        </form>
      </div>

      {/* Entries table */}
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
          白名单列表{entries.length > 0 && <span style={{ fontWeight: 400, color: "var(--c-t2, rgba(255,255,255,0.4))", fontSize: "13px", marginLeft: "8px" }}>({entries.length} 条)</span>}
        </h3>
        {entries.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--c-t2, rgba(255,255,255,0.3))", fontSize: "14px", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: "8px" }}>暂无白名单条目</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr>{["类型", "值", "备注", "添加时间", "操作"].map((h) => <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "var(--c-t2, rgba(255,255,255,0.4))", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={tdStyle}><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 600, background: entry.type === "ip" ? "rgba(99,102,241,0.15)" : "rgba(34,197,94,0.12)", color: entry.type === "ip" ? "#a5b4fc" : "#4ade80" }}>{entry.type === "ip" ? "IP" : "用户"}</span></td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", color: "var(--c-t1, #f0f0f4)" }}>{entry.value}</td>
                    <td style={{ ...tdStyle, color: "var(--c-t2, rgba(255,255,255,0.45))" }}>{entry.note ?? "—"}</td>
                    <td style={{ ...tdStyle, color: "var(--c-t2, rgba(255,255,255,0.45))", whiteSpace: "nowrap" }}>{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</td>
                    <td style={tdStyle}><button type="button" onClick={() => removeEntryMut.mutate({ id: entry.id })} disabled={removeEntryMut.isPending} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "12px", fontWeight: 500, cursor: "pointer", opacity: removeEntryMut.isPending ? 0.5 : 1 }}><Trash2 style={{ width: "12px", height: "12px" }} />删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Logs Panel ────────────────────────────────────────────────────────────────

type AuditAction = "login_email" | "login_oauth" | "image_gen" | "video_gen" | "audio_music" | "audio_dubbing" | "subtitle_transcribe";

function LogsPanel() {
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState<AuditAction | "">("");
  const utils = trpc.useUtils();
  const LIMIT = 50;

  const logsQuery = trpc.admin.logs.list.useQuery(
    { limit: LIMIT, offset, action: actionFilter || undefined },
    { keepPreviousData: true } as object
  );

  const clearMut = trpc.admin.logs.clear.useMutation({
    onSuccess: () => { utils.admin.logs.list.invalidate(); setOffset(0); },
  });

  const rows = logsQuery.data?.rows ?? [];
  const total = logsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div style={cardStyle}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ClipboardList style={{ width: "16px", height: "16px", color: "oklch(0.65 0.18 250)" }} />
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
            操作日志
            {total > 0 && <span style={{ fontWeight: 400, color: "var(--c-t2, rgba(255,255,255,0.4))", fontSize: "13px", marginLeft: "8px" }}>（共 {total} 条）</span>}
          </h3>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value as AuditAction | ""); setOffset(0); }}
            style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: "12px" }}
          >
            <option value="">全部类型</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={() => logsQuery.refetch()} style={iconBtn} title="刷新">
            <RefreshCw style={{ width: "14px", height: "14px" }} />
          </button>
          <button
            onClick={() => { if (confirm("确定清空全部日志？此操作不可撤销。")) clearMut.mutate(); }}
            disabled={clearMut.isPending}
            style={{ ...iconBtn, color: "#f87171", borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)" }}
            title="清空日志"
          >
            <Trash2 style={{ width: "14px", height: "14px" }} />
          </button>
        </div>
      </div>

      {/* Table */}
      {logsQuery.isLoading ? (
        <div style={{ color: "var(--c-t2)", fontSize: "13px", padding: "24px 0" }}>加载中…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--c-t2, rgba(255,255,255,0.3))", fontSize: "14px", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: "8px" }}>暂无日志记录</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
            <thead>
              <tr>
                {["时间", "用户", "IP 地址", "地区", "操作类型", "详情"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--c-t2, rgba(255,255,255,0.4))", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => {
                const detail = log.detail as Record<string, unknown> | null;
                const geo = [log.country, log.city].filter(Boolean).join(" · ") || "—";
                const actionColor = ACTION_COLORS[log.action] ?? "var(--c-t2)";
                return (
                  <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: "12px", color: "var(--c-t2, rgba(255,255,255,0.45))" }}>
                      {new Date(log.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: "130px" }}>
                      <div style={{ color: "var(--c-t1, #f0f0f4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.userName ?? "—"}</div>
                      {log.userEmail && <div style={{ fontSize: "11px", color: "var(--c-t2, rgba(255,255,255,0.4))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.userEmail}</div>}
                      {log.userId != null && <div style={{ fontSize: "10px", color: "var(--c-t2, rgba(255,255,255,0.28))", fontFamily: "monospace" }}>ID: {log.userId}</div>}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", color: "var(--c-t1, #f0f0f4)", whiteSpace: "nowrap" }}>{log.ip}</td>
                    <td style={{ ...tdStyle, color: "var(--c-t2, rgba(255,255,255,0.45))", whiteSpace: "nowrap" }}>{geo}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 600, background: `color-mix(in oklch, ${actionColor} 15%, transparent)`, color: actionColor, border: `1px solid color-mix(in oklch, ${actionColor} 30%, transparent)` }}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, maxWidth: "220px", color: "var(--c-t2, rgba(255,255,255,0.55))" }}>
                      <DetailCell detail={detail} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginTop: "16px" }}>
          <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} style={paginBtn}>上一页</button>
          <span style={{ fontSize: "13px", color: "var(--c-t2)" }}>{currentPage} / {totalPages}</span>
          <button onClick={() => setOffset(offset + LIMIT)} disabled={currentPage >= totalPages} style={paginBtn}>下一页</button>
        </div>
      )}
    </div>
  );
}

function DetailCell({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return <span>—</span>;
  const parts: string[] = [];
  if (detail.model) parts.push(`模型：${detail.model}`);
  if (detail.provider) parts.push(`提供商：${detail.provider}`);
  if (detail.prompt) parts.push(`提示词：${String(detail.prompt).slice(0, 60)}${String(detail.prompt).length > 60 ? "…" : ""}`);
  if (detail.text) parts.push(`文本：${String(detail.text).slice(0, 60)}${String(detail.text).length > 60 ? "…" : ""}`);
  if (detail.taskId) parts.push(`任务 ID：${detail.taskId}`);
  if (detail.resultUrl) parts.push("✓ 已生成");
  if (detail.resultCount) parts.push(`共 ${detail.resultCount} 张`);
  if (detail.method) parts.push(`方式：${detail.method}`);
  if (detail.segmentCount) parts.push(`字幕 ${detail.segmentCount} 条`);
  if (detail.language) parts.push(`语言：${detail.language}`);
  if (parts.length === 0) return <span>{JSON.stringify(detail).slice(0, 80)}</span>;
  return <span title={parts.join(" | ")}>{parts.slice(0, 2).join(" | ")}{parts.length > 2 ? " …" : ""}</span>;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  height: "100dvh", overflowY: "auto",
  display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "flex-start", padding: "48px 24px", background: "var(--color-background, #0d0d10)",
};

const cardStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  background: "var(--c-surface, #1a1a22)",
  border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
  borderRadius: "12px", padding: "24px",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "12px", fontWeight: 500,
  color: "var(--c-t2, rgba(255,255,255,0.45))", marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 11px",
  border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
  borderRadius: "7px", background: "rgba(255,255,255,0.04)",
  color: "var(--c-t1, #f0f0f4)", fontSize: "13px", outline: "none", boxSizing: "border-box",
};

const tdStyle: React.CSSProperties = { padding: "9px 10px", color: "var(--c-t1, #f0f0f4)" };

const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: "30px", height: "30px", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "7px", background: "rgba(255,255,255,0.04)",
  color: "var(--c-t2, rgba(255,255,255,0.45))", cursor: "pointer",
};

const paginBtn: React.CSSProperties = {
  padding: "6px 14px", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "7px", background: "rgba(255,255,255,0.04)",
  color: "var(--c-t1, #f0f0f4)", fontSize: "13px", cursor: "pointer",
};
