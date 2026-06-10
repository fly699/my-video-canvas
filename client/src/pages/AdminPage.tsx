import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Shield, Trash2, Plus, ToggleLeft, ToggleRight, ClipboardList, RefreshCw, HardDrive, ArrowLeft, Loader2, CheckCircle2, XCircle, DownloadCloud, RotateCw, GitCommit, X, Check, CheckSquare, Square, Download, Play } from "lucide-react";
import { ComfyStressPanel } from "@/components/admin/ComfyStressPanel";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { downloadTextFile } from "@/lib/download";
import { toast } from "sonner";
import { adminTabFromUrl, ADMIN_TAB_EVENT } from "@/lib/adminNav";
import { LLM_MODELS, IMAGE_MODELS, VIDEO_MODELS, modelGroupOrder, platformBadge } from "@/lib/models";

type EntryType = "ip" | "user";
type Tab = "whitelist" | "kie" | "users" | "logs" | "comfyLogs" | "storage" | "models" | "chat" | "comfyStress" | "assets" | "downloads" | "system";

const ACTION_LABELS: Record<string, string> = {
  login_email: "邮箱登录",
  login_oauth: "OAuth 登录",
  image_gen: "图像生成",
  video_gen: "视频生成",
  audio_music: "音乐生成",
  audio_dubbing: "配音生成",
  subtitle_transcribe: "语音转录",
  poyo_stage: "Poyo 暂存",
  kie_gen: "kie 生成",
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
  // Initial tab comes from ?tab= so deep links (e.g. a download-approval "查看")
  // land on the right sub-page instead of the default.
  const [activeTab, setActiveTab] = useState<Tab>(() => adminTabFromUrl() as Tab);
  const [, navigate] = useLocation();

  // Switch tab when a deep-link event fires while this page is already mounted
  // (a query-only URL change doesn't remount the page).
  useEffect(() => {
    const onSetTab = (e: Event) => {
      const tab = (e as CustomEvent<string>).detail;
      if (tab) setActiveTab(tab as Tab);
    };
    window.addEventListener(ADMIN_TAB_EVENT, onSetTab);
    return () => window.removeEventListener(ADMIN_TAB_EVENT, onSetTab);
  }, []);

  // 「系统更新」标签红点：是否有新版本（服务端 15 分钟缓存）
  const { data: updateInfo } = trpc.admin.update.available.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const hasUpdate = (updateInfo?.behind ?? 0) > 0;
  // History.back() handles "I came from a project" / "I came via direct URL"
  // both correctly. If there's no history entry (e.g. direct deep link), fall
  // back to the home page so the user is never trapped on this screen.
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate("/");
    }
  };

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
        {/* Header — back button + title */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
          <button
            onClick={handleBack}
            title="返回上一页"
            style={{
              width: 32, height: 32, padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 8,
              background: "var(--c-surface, rgba(255,255,255,0.04))",
              border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
              color: "var(--c-t2, rgba(255,255,255,0.65))",
              cursor: "pointer",
              transition: "background 150ms ease, color 150ms ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--c-elevated, rgba(255,255,255,0.08))";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t1, #f0f0f4)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--c-surface, rgba(255,255,255,0.04))";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t2, rgba(255,255,255,0.65))";
            }}
          >
            <ArrowLeft style={{ width: 16, height: 16 }} />
          </button>
          <Shield style={{ width: "22px", height: "22px", color: "oklch(0.72 0.2 285)" }} />
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--c-t1, #f0f0f4)" }}>
            管理后台
          </h1>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px", borderBottom: "1px solid var(--c-bd1, rgba(255,255,255,0.06))", paddingBottom: "0" }}>
          {([["whitelist", "白名单管理"], ["kie", "kie.ai 密钥"], ["users", "用户管理"], ["logs", "操作日志"], ["comfyLogs", "ComfyUI 日志"], ["storage", "存储设置"], ["models", "模型管理"], ["chat", "聊天管理"], ["comfyStress", "ComfyUI 压测"], ["assets", "素材库(全用户)"], ["downloads", "下载审批"], ["system", "系统更新"]] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                position: "relative",
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
              {tab === "system" && hasUpdate && (
                <span style={{
                  position: "absolute", top: 4, right: 6, width: 7, height: 7, borderRadius: "50%",
                  background: "oklch(0.65 0.22 25)",
                }} />
              )}
            </button>
          ))}
        </div>

        {activeTab === "whitelist" && <WhitelistPanel />}
        {activeTab === "kie" && <KiePanel />}
        {activeTab === "users" && <UsersPanel />}
        {activeTab === "logs" && <LogsPanel />}
        {activeTab === "comfyLogs" && <ComfyUsageLogsPanel />}
        {activeTab === "storage" && <StoragePanel />}
        {activeTab === "models" && <ModelsPanel />}
        {activeTab === "chat" && <ChatAdminPanel />}
        {activeTab === "comfyStress" && <ComfyStressPanel />}
        {activeTab === "assets" && <AssetsAdminPanel />}
        {activeTab === "downloads" && <DownloadsAdminPanel />}
        {activeTab === "system" && <SystemUpdatePanel />}
      </div>
    </div>
  );
}

// ── 用户管理 Panel（管理员）─────────────────────────────────────────────────
function UsersPanel() {
  const utils = trpc.useUtils();
  const { user: me } = useAuth();
  const { data: users, isLoading } = trpc.admin.users.list.useQuery();
  const resetMut = trpc.admin.users.resetPassword.useMutation({
    onSuccess: () => toast.success("密码已重置"),
    onError: (e) => toast.error("重置失败：" + e.message),
  });
  const disableMut = trpc.admin.users.setDisabled.useMutation({
    onSuccess: () => { void utils.admin.users.list.invalidate(); },
    onError: (e) => toast.error("操作失败：" + e.message),
  });
  const delMut = trpc.admin.users.delete.useMutation({
    onSuccess: () => { toast.success("用户已删除"); void utils.admin.users.list.invalidate(); },
    onError: (e) => toast.error("删除失败：" + e.message),
  });

  const onReset = (id: number, label: string) => {
    const pw = window.prompt(`为「${label}」设置新密码（至少 6 位）：`)?.trim();
    if (!pw) return;
    if (pw.length < 6) { toast.error("新密码至少 6 位"); return; }
    resetMut.mutate({ userId: id, newPassword: pw });
  };
  const onToggleDisabled = (id: number, disabled: boolean, label: string) => {
    if (!confirm(`确定${disabled ? "冻结" : "解冻"}用户「${label}」？${disabled ? "\n冻结后该用户将无法登录、且当前会话立即失效。" : ""}`)) return;
    disableMut.mutate({ userId: id, disabled });
  };
  const onDelete = (id: number, label: string) => {
    if (!confirm(`确定删除用户「${label}」？此操作不可恢复（仅删除用户账号，其拥有的项目数据不在此处级联清理）。`)) return;
    delMut.mutate({ userId: id });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1)" }}>用户管理</h3>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-t2)", lineHeight: 1.5 }}>
          重置密码、冻结/解冻、删除用户。冻结的用户无法登录、现有会话立即失效。不能对自己冻结或删除。
        </p>
      </div>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        {isLoading ? (
          <div style={{ padding: 16, fontSize: 12, color: "var(--c-t3)" }}>加载中…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>ID</th><th style={thStyle}>名称 / 邮箱</th><th style={thStyle}>登录方式</th>
                <th style={thStyle}>角色</th><th style={thStyle}>状态</th><th style={thStyle}>最近登录</th><th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => {
                const label = u.name || u.email || ("#" + u.id);
                const isSelf = u.id === me?.id;
                return (
                  <tr key={u.id} style={{ borderTop: "1px solid var(--c-bd2)", opacity: u.disabled ? 0.6 : 1 }}>
                    <td style={tdStyle}>{u.id}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{u.name || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--c-t3)" }}>{u.email || u.openId}</div>
                    </td>
                    <td style={tdStyle}>{u.loginMethod || "—"}</td>
                    <td style={tdStyle}>{u.role === "admin" ? "管理员" : "用户"}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
                        background: u.disabled ? "oklch(0.62 0.2 25 / 0.15)" : "oklch(0.72 0.18 155 / 0.15)",
                        color: u.disabled ? "oklch(0.65 0.2 25)" : "oklch(0.6 0.18 155)" }}>
                        {u.disabled ? "已冻结" : "正常"}
                      </span>
                    </td>
                    <td style={tdStyle}>{u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleString() : "—"}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button onClick={() => onReset(u.id, label)} disabled={!u.hasPassword} style={btnSecondary(!u.hasPassword)} title={u.hasPassword ? "重置该用户密码" : "非邮箱密码账号，无法重置密码"}>重置密码</button>
                        <button onClick={() => onToggleDisabled(u.id, !u.disabled, label)} disabled={isSelf} style={btnSecondary(isSelf)}>{u.disabled ? "解冻" : "冻结"}</button>
                        <button onClick={() => onDelete(u.id, label)} disabled={isSelf} style={{ ...btnSecondary(isSelf), color: isSelf ? "var(--c-t4)" : "oklch(0.65 0.2 25)" }}>删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(users?.length ?? 0) === 0 && <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "var(--c-t3)" }}>暂无用户</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Whitelist Panel ───────────────────────────────────────────────────────────

// ── Storage Panel ─────────────────────────────────────────────────────────────

function StoragePanel() {
  const settingsQuery = trpc.admin.storage.getSettings.useQuery();
  const utils = trpc.useUtils();
  const reach = trpc.config.mediaReachability.useQuery(undefined, { staleTime: 30_000 });
  const poyoStagingActive = reach.data?.poyoStagingActive ?? false;
  const setMut = trpc.admin.storage.setPersist.useMutation({
    onSuccess: () => {
      utils.admin.storage.getSettings.invalidate();
      utils.config.mediaReachability.invalidate(); // 刷新「已生效」绿灯
    },
  });
  // Active probe: uploads a small object via storagePut to confirm the S3
  // pipeline really works. Without this, the admin can flip toggles to ON
  // but generated assets still come back as upstream URLs because of a
  // silent Forge config / S3 issue. Result is shown inline with the
  // failing pipeline stage so the fix is obvious.
  const testMut = trpc.admin.storage.test.useMutation();

  // Admin config export/import: the storage-settings panel + admin-managed global
  // ComfyUI servers and per-server GPU pins, as a single JSON file (backup /
  // migrate between deployments).
  const setGlobalServersMut = trpc.comfyui.setGlobalServers.useMutation();
  const setGlobalGpuMut = trpc.comfyui.setGlobalGpuIndex.useMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ioBusy, setIoBusy] = useState(false);

  const STORAGE_KEYS = [
    "persistAudio", "persistVideo", "persistImage", "presignTtlSec", "poyoUploadFallback",
    "minioOnly", "preferUpstreamRefSource", "downloadAuthEnabled", "forceStorageRelay",
    "watermarkEnabled", "downloadWatermarkEnabled", "devtoolsBlockEnabled",
  ] as const;

  const exportConfig = async () => {
    setIoBusy(true);
    try {
      const [s, comfyServers, comfyGpuIndex] = await Promise.all([
        utils.admin.storage.getSettings.fetch(),
        utils.comfyui.globalServers.fetch(),
        utils.comfyui.globalGpuIndex.fetch(),
      ]);
      const storageSettings: Record<string, boolean | number> = {};
      for (const k of STORAGE_KEYS) { const v = (s as Record<string, unknown>)[k]; if (typeof v === "boolean" || typeof v === "number") storageSettings[k] = v; }
      const cfg = {
        _type: "ai-video-canvas-admin-config",
        _version: 1,
        exportedAt: new Date().toISOString(),
        storageSettings,
        comfyServers,
        comfyGpuIndex,
      };
      downloadTextFile(`avc-admin-config-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(cfg, null, 2));
      toast.success("配置已导出");
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally { setIoBusy(false); }
  };

  const importConfig = async (file: File) => {
    setIoBusy(true);
    try {
      const cfg = JSON.parse(await file.text()) as Record<string, unknown>;
      if (cfg._type !== "ai-video-canvas-admin-config") throw new Error("不是有效的管理员配置文件");
      if (!confirm("导入将用文件内容覆盖当前的存储设置、全局 ComfyUI 服务器与显卡选择，确定继续？")) { setIoBusy(false); return; }
      const ss = (cfg.storageSettings ?? {}) as Record<string, unknown>;
      const patch: Record<string, boolean | number> = {};
      for (const k of STORAGE_KEYS) { const v = ss[k]; if (typeof v === "boolean" || typeof v === "number") patch[k] = v; }
      if (Object.keys(patch).length > 0) await setMut.mutateAsync(patch);
      if (Array.isArray(cfg.comfyServers)) await setGlobalServersMut.mutateAsync({ servers: (cfg.comfyServers as unknown[]).filter((u): u is string => typeof u === "string") });
      if (cfg.comfyGpuIndex && typeof cfg.comfyGpuIndex === "object") {
        const gi: Record<string, number> = {};
        for (const [k, v] of Object.entries(cfg.comfyGpuIndex as Record<string, unknown>)) if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 63) gi[k] = v;
        await setGlobalGpuMut.mutateAsync({ gpuIndex: gi });
      }
      await Promise.all([
        utils.admin.storage.getSettings.invalidate(),
        utils.comfyui.globalServers.invalidate(),
        utils.comfyui.globalGpuIndex.invalidate(),
      ]);
      toast.success("配置已导入并生效");
    } catch (e) {
      toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally { setIoBusy(false); }
  };

  const settings = settingsQuery.data;
  const loading = settingsQuery.isLoading;

  const handleToggle = (kind: "persistAudio" | "persistVideo" | "persistImage") => {
    if (!settings) return;
    const newValue = !settings[kind];
    if (!newValue) {
      const messages: Record<typeof kind, string> = {
        persistAudio: "确定关闭音频持久化？\n\n新生成的音频将直接使用 Poyo 上游 URL，约 24 小时后过期。已存在的音频不受影响。",
        persistVideo: "确定关闭视频持久化？\n\n新生成的视频将直接使用上游 CDN URL（Poyo/Higgsfield），约 24 小时后过期。已存在的视频不受影响。",
        persistImage: "确定关闭图像持久化？\n\n新生成的图像将直接使用上游 CDN URL（Poyo 24h / Higgsfield 临时），过期后画布上的缩略图、分镜参考图都会断图。\n\n注意：Forge 内置图像后端始终持久化（不受此开关影响）。已存在的图像不受影响。",
      };
      const confirmed = confirm(messages[kind]);
      if (!confirmed) return;
    }
    setMut.mutate({ [kind]: newValue });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Config export / import (backup & migrate between deployments) */}
      <div style={{ ...cardStyle, alignItems: "stretch", padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <DownloadCloud style={{ width: 18, height: 18, color: "oklch(0.72 0.2 285)", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>配置 导出 / 导入</h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--c-t3, rgba(255,255,255,0.55))" }}>
              导出本页存储设置 + 全局 ComfyUI 服务器与显卡选择为 JSON，便于备份或迁移到其他部署。导入会覆盖当前对应配置。
            </p>
          </div>
          <button onClick={() => void exportConfig()} disabled={ioBusy}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: ioBusy ? "not-allowed" : "pointer", color: "#fff", background: "oklch(0.6 0.16 250)", border: "none", opacity: ioBusy ? 0.6 : 1 }}>
            <DownloadCloud style={{ width: 14, height: 14 }} /> 导出
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={ioBusy}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: ioBusy ? "not-allowed" : "pointer", color: "var(--c-t1)", background: "var(--c-input, #1a1a20)", border: "1px solid var(--c-bd2)", opacity: ioBusy ? 0.6 : 1 }}>
            <RotateCw style={{ width: 14, height: 14 }} /> 导入
          </button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importConfig(f); e.target.value = ""; }} />
        </div>
      </div>
      <div style={{ ...cardStyle, alignItems: "stretch", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
          <HardDrive style={{ width: 18, height: 18, color: "oklch(0.72 0.2 285)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
              对象存储持久化（MinIO / S3 本地存储）
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.5 }}>
              开启后系统会自动把生成的音频/视频/图像存到你的对象存储（推荐自建 MinIO，数据不出本机），URL 永久可用。<br />
              关闭后节点降级为直接使用模型提供商的上游 URL（Poyo: 24h 后过期；Higgsfield: 临时 CDN）。<br />
              配置：S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY（可运行 deploy\setup-minio.bat 一键配置）。<br />
              <strong>存储后端优先级</strong>：配齐 S3_* → 用 <strong>MinIO/S3</strong>（首选）；否则若配了 Forge 凭据 → 回退 <strong>Forge 内置存储</strong>；都没有 → <strong>无持久化</strong>，所有存储操作会失败。
              <strong>Forge 内置存储现已降级为「未配 S3 时的回退」</strong>，配了 MinIO/S3 后不再走它。
            </p>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => testMut.mutate()}
                disabled={testMut.isPending}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", fontSize: 12, fontWeight: 500,
                  background: "oklch(0.68 0.22 285 / 0.12)",
                  border: "1px solid oklch(0.68 0.22 285 / 0.35)",
                  borderRadius: 6,
                  color: "oklch(0.78 0.18 285)",
                  cursor: testMut.isPending ? "not-allowed" : "pointer",
                }}
              >
                {testMut.isPending
                  ? <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />
                  : <RefreshCw style={{ width: 12, height: 12 }} />}
                测试存储连通性
              </button>
              {testMut.data?.ok && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <CheckCircle2 style={{ width: 14, height: 14, color: "oklch(0.7 0.18 145)" }} />
                  <span style={{ color: "oklch(0.7 0.18 145)" }}>
                    正常（{testMut.data.ms}ms · {testMut.data.backend === "s3" ? "MinIO/S3" : testMut.data.backend === "forge" ? "Forge" : "—"}）
                  </span>
                  <code style={{ fontSize: 10, color: "var(--c-t3)", background: "var(--c-surface)", padding: "1px 5px", borderRadius: 4 }}>
                    {testMut.data.url}
                  </code>
                </div>
              )}
              {testMut.data && !testMut.data.ok && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 100%" }}>
                  <XCircle style={{ width: 14, height: 14, color: "oklch(0.65 0.18 25)", flexShrink: 0 }} />
                  <span style={{ color: "oklch(0.78 0.18 25)" }}>
                    失败（{testMut.data.stage}, {testMut.data.ms}ms）：{testMut.data.error}
                  </span>
                </div>
              )}
              {testMut.error && !testMut.data && (
                <span style={{ fontSize: 12, color: "oklch(0.65 0.18 25)" }}>
                  请求失败: {testMut.error.message}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, alignItems: "stretch", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <HardDrive style={{ width: 18, height: 18, color: "oklch(0.72 0.16 65)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
              关于 Forge 平台（非存储依赖）
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.6 }}>
              <strong style={{ color: "oklch(0.82 0.14 65)" }}>请区分两层，互不影响：</strong><br />
              <strong>① 上面的「持久化开关」</strong>：只管"生成的媒体要不要落对象存储"，
              <strong>不影响</strong>本卡片下列任何非存储功能；关闭它至多让媒体降级为上游临时 URL（配了 MinIO 时甚至被忽略）。<br />
              <strong>② Forge 凭据（环境变量 BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY）</strong>：是部署层面的整个 Forge 平台开关。
              「Forge 内置存储」虽已被 MinIO/S3 取代为回退，但该平台仍是必需基础设施，与对象存储配置无关，承担以下子系统：<br />
              • <strong>LLM 代理</strong>：Claude / Gemini 等非 GPT 模型经 Forge `/v1/chat/completions` 调用<br />
              • <strong>图像生成</strong>：`manus_forge` 模型，以及未配 Poyo Key 时的兜底<br />
              • <strong>语音转写</strong>：Whisper（音频转文字）<br />
              • <strong>定时任务</strong>：heartbeat 计划任务<br />
              • <strong>站内通知</strong>：项目所有者通知<br />
              • <strong>Data API / 地图</strong>：YouTube、Google Maps 等外部 API 代理<br />
              因此让上述功能失效的是<strong>移除环境变量里的 Forge 凭据</strong>（运维操作），而<strong>不是</strong>点上面的持久化开关。即使存储全切 MinIO，也不要删 Forge 凭据。
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ color: "var(--c-t2)", fontSize: 13, padding: 12 }}>加载中...</div>
      )}

      {settings && (
        <>
          <div style={{
            padding: "10px 14px",
            background: "oklch(0.70 0.16 65 / 0.10)",
            border: "1px solid oklch(0.70 0.16 65 / 0.35)",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.6,
            color: "oklch(0.82 0.14 65)",
          }}>
            <strong>下列开关仅在未配置 MinIO/S3、回退到 Forge 内置存储时才生效。</strong><br />
            自有 MinIO/S3 是本地磁盘、无配额成本，因此一旦配置好（S3_ENDPOINT/S3_BUCKET/...），
            系统对音/视/图<strong>恒为持久化</strong>，以下开关将被忽略。这些开关本质是
            「Forge 内置存储（有配额计费）」的省钱阀门。<br />
            关闭后多数媒体降级为模型提供商的上游临时 URL（Poyo 24h / Higgsfield 临时）；
            但 <strong>OpenAI TTS 例外</strong>——它只返回 mp3 字节流、无可降级的 URL，
            音频持久化关闭时会<strong>直接拒绝生成</strong>。
          </div>
          <ToggleRow
            label="持久化图像（Forge 存储）"
            description="仅 Forge 存储后端生效（配置 MinIO/S3 后恒持久化、此开关被忽略）。作用对象：Poyo / Higgsfield 图像生成输出（它们返回临时 CDN URL，关闭则不转存、直接用 24h 临时链接）。注：manus_forge 图像模型因只返回字节流、无临时 URL，生成图始终落盘（存到当前存储后端：MinIO 或 Forge），不受此开关控制。"
            enabled={settings.persistImage}
            disabled={setMut.isPending}
            onClick={() => handleToggle("persistImage")}
          />
          <ToggleRow
            label="持久化音频（Forge 存储）"
            description="仅 Forge 存储后端生效（配置 MinIO/S3 后恒持久化、此开关被忽略）。作用对象：音乐生成 / 配音 / TTS 输出。"
            enabled={settings.persistAudio}
            disabled={setMut.isPending}
            onClick={() => handleToggle("persistAudio")}
          />
          <ToggleRow
            label="持久化视频（Forge 存储）"
            description="仅 Forge 存储后端生效（配置 MinIO/S3 后恒持久化、此开关被忽略）。作用对象：Poyo / Higgsfield 视频生成输出。"
            enabled={settings.persistVideo}
            disabled={setMut.isPending}
            onClick={() => handleToggle("persistVideo")}
          />
          <PresignTtlRow
            value={settings.presignTtlSec}
            disabled={setMut.isPending}
            onSave={(sec) => setMut.mutate({ presignTtlSec: sec })}
          />
          <ToggleRow
            label="Poyo 流式暂存（参考图/视频公网中转）"
            description={
              "附加功能·默认关闭：当 MinIO/S3 未暴露公网（未设 S3_PUBLIC_ENDPOINT）时，把参考图/视频经 Poyo 流式上传换取公网 URL 供 AI 模型读取。关闭后完全不影响原有存储逻辑。需配置 POYO_API_KEY。" +
              "\n限制：图片支持 JPEG / PNG / GIF / WebP，公网有效期约 72 小时；视频支持 MP4 / WebM / MOV / AVI / MKV，单文件 ≤ 100MB，有效期约 24 小时；每次 1 个文件；接口限流 5 次/分钟。仅用于生成时临时中转参考素材，不替代本地持久化存储。"
            }
            enabled={settings.poyoUploadFallback}
            disabled={setMut.isPending}
            onClick={() => setMut.mutate({ poyoUploadFallback: !settings.poyoUploadFallback })}
            statusOn={poyoStagingActive
              ? "🟢 已生效：参考图/视频会经 Poyo 暂存换取公网链接（生成时后端打印 [storage] Poyo 暂存 日志）"
              : "⚠️ 已开启，但未检测到 POYO_API_KEY → 暂不生效，请在服务端配置 POYO_API_KEY 后重启"}
            statusOff="已关闭（不影响原有存储逻辑）"
          />
          <ToggleRow
            label="仅允许 MinIO/S3（禁用 Forge 存储回退）"
            description={
              "开启后，下列「无专属持久化开关」的写入被限制为自建 MinIO/S3：用户上传、聊天附件、画布上传、本地剪辑产物。未配置 MinIO/S3 时这些写入将直接失败，而不是回退到 Forge 存储。\n" +
              "不影响：上面三个 AI 产物持久化开关（音/视/图各自控制）；Forge 的非存储功能（LLM 代理 / 语音转写 / 定时任务 / 通知 / Data API / manus_forge 画图模型）；读取既有文件。\n" +
              "注：ComfyUI 内网节点产物为安全考量已「永久硬锁 MinIO/S3」，无视此开关——未配 MinIO/S3 时一律拒绝、绝不落 Forge。请先配置 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY 再开启本开关。"
            }
            enabled={settings.minioOnly}
            disabled={setMut.isPending}
            onClick={() => setMut.mutate({ minioOnly: !settings.minioOnly })}
            statusOn="已开启（仅 MinIO/S3，绝不落 Forge 存储）"
            statusOff="已关闭（未配 MinIO 时回退 Forge 存储）"
          />
          <ToggleRow
            label="参考源优先用 AI 平台临时链接（公网有效时）"
            description={
              "开启后：当下游节点（视频/图像/ComfyUI 等）的参考图是从上游 AI 出图节点（Poyo / Higgsfield）自动填入时，若该上游临时公网链接经主动探测仍然有效，自动把参考源改用此公网链接。\n" +
              "用途：上游模型本就能直接读取该公网链接，可规避「自建 MinIO 未对公网开放、上游拉不到参考图」的问题。\n" +
              "不影响：用户手动填写/上传的参考图；ComfyUI 本地出图（无上游临时链接）；以及所有其他传递/获取逻辑。默认关闭，关闭后与原有行为完全一致。"
            }
            enabled={settings.preferUpstreamRefSource}
            disabled={setMut.isPending}
            onClick={() => setMut.mutate({ preferUpstreamRefSource: !settings.preferUpstreamRefSource })}
            statusOn="已开启（参考源在有效时优先用 AI 平台临时链接）"
            statusOff="已关闭（沿用持久化链接，行为不变）"
          />
          <ToggleRow
            label="严格下载授权（非管理员下载须经批准）"
            description={
              "开启后：除管理员外，任何人下载原始文件都必须持有一张「一次性授权」——来自①用户申请→管理员在「下载审批」批准，或②管理员主动按文件/项目授权。每张授权对每个文件仅可成功下载一次。\n" +
              "覆盖范围：所有经服务端下载的原文件（/manus-storage 及图片/视频代理的 download 路径）；普通查看/播放不受影响。\n" +
              "默认关闭，关闭后与原有行为完全一致（任何人都可下载）。"
            }
            enabled={settings.downloadAuthEnabled}
            disabled={setMut.isPending}
            onClick={() => setMut.mutate({ downloadAuthEnabled: !settings.downloadAuthEnabled })}
            statusOn="已开启（非管理员须持授权才能下载）"
            statusOff="已关闭（任何人都可下载，行为不变）"
          />
          <ToggleRow
            label="防盗链：始终服务器中转，不暴露真实存储链接"
            description={
              "作用：让浏览器 F12 看不到 S3/MinIO 的真实预签名直链——存储代理不再 307 跳转，一律由本服务器流式中转，F12 只看到需登录的同源 /manus-storage 路径。\n" +
              "重要：这【不等于防下载】。已登录用户仍能从该同源链接把字节流存成原文件；它只防『真实直链被复制/转发出去群发盗刷』。要真正限制下载请用『严格下载授权』，要可追责请配合水印。\n" +
              "代价：媒体流量经应用服务器、占带宽，且自建 MinIO 部署本就走中转（此开关对它无额外影响），仅对『存储可被浏览器直连』的部署有差异。\n" +
              "仅改取流路径，不影响上传/生成/播放。默认关闭，关闭后与原有行为完全一致。"
            }
            enabled={settings.forceStorageRelay}
            disabled={setMut.isPending}
            onClick={() => setMut.mutate({ forceStorageRelay: !settings.forceStorageRelay })}
            statusOn="已开启（一律服务器中转，隐藏真实链接）"
            statusOff="已关闭（可直连时 307 跳转，行为不变）"
          />
          <ToggleRow
            label="可追源水印（页面叠加观看者身份）"
            description={
              "开启后：在应用界面叠加一层很淡的、平铺的水印，内容为当前观看者的身份（邮箱/ID）。截图、录屏、二次转发的画面都会带上是谁泄露的标识，便于追责与威慑。\n" +
              "限制：水印是页面叠加层，不会写进原始媒体文件——它防的是「截图/录屏外传」，并非阻止下载原文件（防下载请配合上面的两个开关）。\n" +
              "说明：纯叠加层（鼠标穿透、不挡操作），不触碰任何媒体处理流程。默认关闭，关闭后界面无任何变化。"
            }
            enabled={settings.watermarkEnabled}
            disabled={setMut.isPending}
            onClick={() => setMut.mutate({ watermarkEnabled: !settings.watermarkEnabled })}
            statusOn="已开启（界面叠加观看者身份水印）"
            statusOff="已关闭（无水印，行为不变）"
          />
          <ToggleRow
            label="下载文件烧入可追源水印（图片+视频）"
            description={
              "开启后：用户下载原文件时，服务器用 ffmpeg 把「下载者身份+时间」水印烧进文件本身（图片、视频均生效），下载到本地的文件也能追溯是谁泄露的。\n" +
              "代价：下载时需重新编码，大视频会变慢、占 CPU；仅对走本服务器代理的图片/视频生效（音频与外部无法处理的文件原样下载）。\n" +
              "安全：任何编码失败都会自动回退为原文件下载，绝不让下载失败。默认关闭，关闭后与原有行为完全一致。"
            }
            enabled={settings.downloadWatermarkEnabled}
            disabled={setMut.isPending}
            onClick={() => setMut.mutate({ downloadWatermarkEnabled: !settings.downloadWatermarkEnabled })}
            statusOn="已开启（下载的图片/视频烧入下载者水印）"
            statusOff="已关闭（下载原文件，行为不变）"
          />
          <ToggleRow
            label="阻止 F12 / 右键（仅威慑，非真正安全）"
            description={
              "开启后：非管理员页面会拦截右键菜单和开发者工具快捷键（F12、Ctrl+Shift+I/J/C、Ctrl+U）。管理员自己不受影响，便于排障。\n" +
              "请务必知悉：这只是【弱威慑】，无法真正阻止——用户可在打开页面前先开 devtools、用浏览器菜单、禁用 JS、或直接抓包来绕过。真正防护请依赖下载授权 + 水印 + 服务端鉴权。\n" +
              "默认关闭，关闭后行为完全不变。"
            }
            enabled={settings.devtoolsBlockEnabled}
            disabled={setMut.isPending}
            onClick={() => setMut.mutate({ devtoolsBlockEnabled: !settings.devtoolsBlockEnabled })}
            statusOn="已开启（非管理员拦右键/F12，仅威慑）"
            statusOff="已关闭（行为不变）"
          />
        </>
      )}
    </div>
  );
}

/**
 * 预签名 GET URL 有效期（自建 MinIO/S3）。越长越方便上游 AI 慢任务拉取，越短泄露暴露窗口越小。
 * 仅对自建 S3/MinIO 后端生效；Forge 后端的有效期由 Forge 服务端决定。
 */
function PresignTtlRow({ value, disabled, onSave }: {
  value: number;
  disabled?: boolean;
  onSave: (sec: number) => void;
}) {
  const [mins, setMins] = useState(() => Math.round(value / 60));
  const dirty = mins * 60 !== value;
  const valid = Number.isFinite(mins) && mins >= 1 && mins <= 10080; // 1 分 … 7 天
  return (
    <div style={{ ...cardStyle, alignItems: "stretch", padding: "14px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>预签名 URL 有效期</div>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.5 }}>
            自建 MinIO/S3 读取链接的有效时长。上游 AI 任务慢时调长，安全优先则调短（1 分钟–7 天，默认 60 分钟）。仅影响新生成的链接。
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={1}
            max={10080}
            value={Number.isFinite(mins) ? mins : ""}
            onChange={(e) => setMins(Math.trunc(Number(e.target.value)))}
            disabled={disabled}
            style={{
              width: 90, padding: "6px 8px", fontSize: 13,
              background: "var(--c-surface)", color: "var(--c-t1)",
              border: "1px solid var(--c-bd2)", borderRadius: 6, outline: "none",
            }}
          />
          <span style={{ fontSize: 12, color: "var(--c-t3)" }}>分钟</span>
          <button
            onClick={() => valid && onSave(mins * 60)}
            disabled={disabled || !dirty || !valid}
            style={{
              padding: "6px 14px", fontSize: 12, fontWeight: 500, borderRadius: 6,
              background: dirty && valid ? "oklch(0.68 0.22 285 / 0.15)" : "var(--c-surface)",
              border: `1px solid ${dirty && valid ? "oklch(0.68 0.22 285 / 0.4)" : "var(--c-bd2)"}`,
              color: dirty && valid ? "oklch(0.78 0.18 285)" : "var(--c-t4)",
              cursor: disabled || !dirty || !valid ? "not-allowed" : "pointer",
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, description, enabled, disabled, onClick, statusOn, statusOff }: {
  label: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  onClick: () => void;
  statusOn?: string;
  statusOff?: string;
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
        <div style={{ fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.4))", marginTop: 3, whiteSpace: "pre-line", lineHeight: 1.6 }}>{description}</div>
        <div style={{ fontSize: 11, color: enabled ? "oklch(0.7 0.18 145)" : "oklch(0.65 0.18 25)", marginTop: 4, fontWeight: 600 }}>
          状态：{enabled ? (statusOn ?? "已开启（永久存储）") : (statusOff ?? "已关闭（24h 后过期）")}
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

// ── Model visibility (使能开关) Panel ─────────────────────────────────────────

type ModelCatItem = { value: string; label: string; group: string };
type ModelCat = { key: string; label: string; hint: string; accent: string; models: ModelCatItem[] };

const MODEL_CATEGORIES: ModelCat[] = [
  {
    key: "llm",
    label: "对话 / 推理（LLM）模型",
    hint: "用于 AI对话、智能体(Agent)、脚本、提示词、分镜文本扩写、看图识人、ComfyUI 提示词翻译等节点",
    accent: "oklch(0.68 0.18 280)",
    models: LLM_MODELS.filter((m) => !m.hidden).map((m) => ({ value: m.id, label: m.label, group: m.provider })),
  },
  {
    key: "image",
    label: "图像生成模型",
    hint: "用于 图像生成、分镜、提示词 节点",
    accent: "oklch(0.72 0.20 330)",
    models: IMAGE_MODELS.map((m) => ({ value: m.value, label: m.label, group: m.group })),
  },
  {
    key: "video",
    label: "视频生成模型",
    hint: "用于 视频任务 节点",
    accent: "oklch(0.68 0.22 25)",
    models: VIDEO_MODELS.map((m) => ({ value: m.value, label: m.label, group: m.group })),
  },
];

const ALL_MODEL_VALUES = MODEL_CATEGORIES.flatMap((c) => c.models.map((m) => m.value));

function ModelsPanel() {
  const utils = trpc.useUtils();
  const query = trpc.admin.models.getDisabled.useQuery();
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  // 以服务端数据为准初始化本地集合（仅在服务端集合变化时同步，避免覆盖用户连续点选）。
  const serverKey = (query.data?.disabledModels ?? []).slice().sort().join(",");
  useEffect(() => {
    setDisabled(new Set(query.data?.disabledModels ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const setMut = trpc.admin.models.setDisabled.useMutation({
    onSuccess: () => {
      void utils.admin.models.getDisabled.invalidate();
      void utils.config.modelToggles.invalidate();
    },
    onError: (e) => toast.error(`保存失败：${e.message}`),
  });

  const persist = (next: Set<string>) => {
    setDisabled(next);
    setMut.mutate({ disabledModels: Array.from(next) });
  };
  const toggleOne = (value: string) => {
    const next = new Set(disabled);
    next.has(value) ? next.delete(value) : next.add(value);
    persist(next);
  };
  // 对一组模型整体启用/禁用。
  const setGroupEnabled = (values: string[], enabled: boolean) => {
    const next = new Set(disabled);
    for (const v of values) enabled ? next.delete(v) : next.add(v);
    persist(next);
  };

  const enabledCount = ALL_MODEL_VALUES.filter((v) => !disabled.has(v)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{
        padding: "12px 16px", background: "oklch(0.70 0.16 285 / 0.10)",
        border: "1px solid oklch(0.70 0.16 285 / 0.35)", borderRadius: 10,
        fontSize: 12.5, lineHeight: 1.7, color: "var(--c-t2)",
      }}>
        <strong style={{ color: "var(--c-t1)" }}>模型使能开关</strong>
        ：勾选 = 该模型在对应节点的模型下拉里<strong>显示</strong>，取消勾选 = 隐藏。按节点功能分组，
        每组列出全部可用 AI 模型。仅控制「界面是否显示」，<strong>不影响</strong>已经选用该模型的旧节点继续运行。
        修改即时保存、对所有用户生效（约 30 秒内）。当前已启用 <strong style={{ color: "var(--c-t1)" }}>{enabledCount}</strong> / {ALL_MODEL_VALUES.length} 个模型。
        {query.isLoading && <span style={{ color: "var(--c-t3)" }}>（加载中…）</span>}
      </div>

      {MODEL_CATEGORIES.map((cat) => {
        // 该分类下按来源平台分组（Kie 排在 Poyo 之前），便于整组开关。
        const byGroup = new Map<string, ModelCatItem[]>();
        for (const m of cat.models) {
          const arr = byGroup.get(m.group) ?? [];
          arr.push(m);
          byGroup.set(m.group, arr);
        }
        const groups = Array.from(byGroup.entries()).sort((a, b) => modelGroupOrder(a[0]) - modelGroupOrder(b[0]));
        const catValues = cat.models.map((m) => m.value);
        const catEnabled = catValues.filter((v) => !disabled.has(v)).length;
        const allOn = catEnabled === catValues.length;

        return (
          <div key={cat.key} style={{
            border: `1px solid var(--c-bd1)`, borderRadius: 12, overflow: "hidden",
            background: "var(--c-surface)",
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              padding: "13px 16px", borderBottom: "1px solid var(--c-bd1)",
              background: `${cat.accent}14`,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)" }}>
                  {cat.label}
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: cat.accent }}>
                    {catEnabled}/{catValues.length} 已启用
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--c-t3)", marginTop: 3 }}>{cat.hint}</div>
              </div>
              <button
                onClick={() => setGroupEnabled(catValues, !allOn)}
                disabled={setMut.isPending}
                style={{
                  flexShrink: 0, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${cat.accent}55`, background: "transparent",
                  color: cat.accent, fontSize: 12, fontWeight: 700,
                }}
              >
                {allOn ? "全部停用" : "全部启用"}
              </button>
            </div>

            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
              {groups.map(([group, items]) => {
                const groupValues = items.map((m) => m.value);
                const groupAllOn = groupValues.every((v) => !disabled.has(v));
                const badge = platformBadge(group);
                return (
                  <div key={group}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", padding: "2px 8px",
                        borderRadius: 5, background: badge.bg, color: badge.fg,
                      }}>{group}</span>
                      <button
                        onClick={() => setGroupEnabled(groupValues, !groupAllOn)}
                        disabled={setMut.isPending}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          fontSize: 11, fontWeight: 600, color: "var(--c-t3)", padding: 0,
                        }}
                      >
                        {groupAllOn ? "本组全不选" : "本组全选"}
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                      {items.map((m) => {
                        const on = !disabled.has(m.value);
                        return (
                          <button
                            key={m.value}
                            onClick={() => toggleOne(m.value)}
                            disabled={setMut.isPending}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                              padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                              border: `1px solid ${on ? `${cat.accent}40` : "var(--c-bd1)"}`,
                              background: on ? `${cat.accent}10` : "var(--c-base)",
                            }}
                          >
                            {on
                              ? <CheckSquare style={{ width: 16, height: 16, color: cat.accent, flexShrink: 0 }} />
                              : <Square style={{ width: 16, height: 16, color: "var(--c-t4)", flexShrink: 0 }} />}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: on ? "var(--c-t1)" : "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</div>
                              <div style={{ fontSize: 9.5, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.value}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── System Update Panel ───────────────────────────────────────────────────────

function SystemUpdatePanel() {
  const utils = trpc.useUtils();
  const versionQuery = trpc.admin.update.version.useQuery(undefined, { refetchOnWindowFocus: false });
  const statusQuery = trpc.admin.update.status.useQuery(undefined, {
    refetchOnWindowFocus: false,
    // 更新进行中时每 1.5s 轮询进度，否则停止轮询
    refetchInterval: (q) => (q.state.data?.state === "running" ? 1500 : false),
  });
  const availableQuery = trpc.admin.update.available.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const checkMut = trpc.admin.update.check.useMutation({
    onSuccess: () => { void utils.admin.update.available.invalidate(); },
  });
  const runMut = trpc.admin.update.run.useMutation({
    onSuccess: () => { void utils.admin.update.status.invalidate(); },
  });
  const restartMut = trpc.admin.update.restart.useMutation({
    onSuccess: (r) => {
      if (r.restarting) toast.success("服务正在重启，约 5–15 秒后请刷新页面");
      else toast.message(r.reason ?? "当前环境不支持自动重启");
    },
    onError: (e) => toast.error("重启失败：" + e.message),
  });

  const handleRestart = () => {
    if (running || restartMut.isPending) return;
    if (!confirm("确定重启服务？\n\n用于加载手动修改过的 .env。期间页面会短暂中断（约 5–15 秒），请稍候刷新。")) return;
    restartMut.mutate();
  };

  const status = statusQuery.data;
  const running = status?.state === "running";
  const version = versionQuery.data;
  // 缓存的可用更新信息（打开标签即显示，未手动检查时也可见）
  const available = checkMut.data ?? availableQuery.data;

  const handleRun = () => {
    if (running) return;
    const ok = confirm(
      "确定开始更新？\n\n将执行：拉取最新代码 → 安装依赖 → 数据库迁移 → 构建。\n" +
      "构建成功后服务会自动重启（约 1–3 分钟），期间页面会短暂中断，请稍候刷新。"
    );
    if (!ok) return;
    runMut.mutate();
  };

  const badge = (() => {
    switch (status?.state) {
      case "running": return { text: "更新中", color: "oklch(0.7 0.16 250)" };
      case "success": return { text: status.willRestart ? "构建完成，正在重启" : "完成", color: "oklch(0.7 0.18 145)" };
      case "uptodate": return { text: "已是最新版本", color: "oklch(0.7 0.18 145)" };
      case "error": return { text: "失败", color: "oklch(0.7 0.18 25)" };
      default: return null;
    }
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 当前版本 + 操作 */}
      <div style={{ ...cardStyle, alignItems: "stretch", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <DownloadCloud style={{ width: 18, height: 18, color: "oklch(0.72 0.2 285)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>
              系统更新（应用内一键更新）
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.5 }}>
              在服务器本机执行：拉取最新代码 → 安装依赖 → 数据库迁移 → 构建。<br />
              构建成功后服务会自动重启以加载新版本（生产环境下由 Windows 服务 / pm2 接管重启）。
            </p>

            {/* 当前版本信息 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12, color: "var(--c-t2)" }}>
              <GitCommit style={{ width: 14, height: 14, flexShrink: 0 }} />
              {versionQuery.isLoading ? "读取版本…" : version ? (
                <span>
                  当前版本 <code style={{ background: "var(--c-surface)", padding: "1px 6px", borderRadius: 4 }}>{version.commit}</code>
                  {version.date && <span style={{ color: "var(--c-t3)" }}> · {new Date(version.date).toLocaleString()}</span>}
                  {version.subject && <span style={{ color: "var(--c-t3)" }}> · {version.subject}</span>}
                </span>
              ) : "版本信息不可用（可能不是 git 部署）"}
            </div>

            {/* 操作按钮 */}
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => checkMut.mutate()}
                disabled={checkMut.isPending || running}
                style={btnSecondary(checkMut.isPending || running)}
              >
                {checkMut.isPending
                  ? <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />
                  : <RefreshCw style={{ width: 12, height: 12 }} />}
                检查更新
              </button>

              <button
                onClick={handleRun}
                disabled={running}
                style={btnPrimary(running)}
              >
                {running
                  ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                  : <RotateCw style={{ width: 13, height: 13 }} />}
                {running ? "更新中…" : "立即更新"}
              </button>

              <button
                onClick={handleRestart}
                disabled={running || restartMut.isPending}
                style={btnSecondary(running || restartMut.isPending)}
                title="仅重启服务（不更新代码），用于加载手动修改过的 .env 配置"
              >
                {restartMut.isPending
                  ? <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />
                  : <RotateCw style={{ width: 12, height: 12 }} />}
                重启服务
              </button>

              {available && (
                available.error
                  ? <span style={{ fontSize: 12, color: "oklch(0.65 0.18 25)" }}>检查失败：{available.error}</span>
                  : <span style={{ fontSize: 12, color: available.behind > 0 ? "oklch(0.78 0.18 60)" : "oklch(0.7 0.18 145)" }}>
                      {available.behind > 0
                        ? `有 ${available.behind} 个新提交待更新${available.latest ? `（最新：${available.latest}）` : ""}`
                        : "已是最新版本"}
                    </span>
              )}
              {available && !available.error && available.behind > 0 && (available.changes?.length ?? 0) > 0 && (
                <div style={{ width: "100%", marginTop: 4, maxHeight: 180, overflowY: "auto", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--c-bd2)", background: "var(--c-surface)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--c-t3)", marginBottom: 6 }}>更新内容（{available.changes.length} 项变更）</div>
                  <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
                    {available.changes.map((c, i) => <li key={i} style={{ fontSize: 12, color: "var(--c-t2)", lineHeight: 1.5 }}>{c}</li>)}
                  </ul>
                </div>
              )}
              {checkMut.error && (
                <span style={{ fontSize: 12, color: "oklch(0.65 0.18 25)" }}>检查失败：{checkMut.error.message}</span>
              )}
              {runMut.error && (
                <span style={{ fontSize: 12, color: "oklch(0.65 0.18 25)" }}>启动失败：{runMut.error.message}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 进度 / 状态 */}
      {status && status.state !== "idle" && (
        <div style={{ ...cardStyle, alignItems: "stretch", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            {badge && (
              <span style={{
                fontSize: 12, fontWeight: 600, color: badge.color,
                background: "var(--c-surface, rgba(255,255,255,0.04))",
                border: `1px solid ${badge.color}`, borderRadius: 6, padding: "3px 10px",
              }}>
                {badge.text}
              </span>
            )}
            {status.step && <span style={{ fontSize: 13, color: "var(--c-t1)" }}>{status.step}</span>}
          </div>

          {status.state === "success" && status.willRestart && (
            <div style={{ fontSize: 12, color: "oklch(0.78 0.18 60)", marginBottom: 10, lineHeight: 1.5 }}>
              服务正在重启以加载新版本，约数十秒后完成。完成后请手动刷新页面（若使用已安装的应用窗口，必要时关掉重开）。
            </div>
          )}
          {status.state === "error" && status.error && (
            <div style={{ fontSize: 12, color: "oklch(0.78 0.18 25)", marginBottom: 10 }}>错误：{status.error}</div>
          )}

          {/* 日志输出 */}
          {status.log.length > 0 && (
            <pre style={{
              margin: 0, maxHeight: 320, overflow: "auto",
              fontSize: 11, lineHeight: 1.5,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              color: "var(--c-t2, rgba(255,255,255,0.7))",
              background: "var(--c-surface, rgba(0,0,0,0.25))",
              border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))",
              borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>
              {status.log.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 7,
    padding: "8px 16px", fontSize: 13, fontWeight: 600,
    background: disabled ? "var(--c-surface, rgba(255,255,255,0.06))" : "oklch(0.58 0.22 285 / 0.85)",
    border: "1px solid oklch(0.68 0.22 285 / 0.4)", borderRadius: 8,
    color: disabled ? "var(--c-t3, rgba(255,255,255,0.4))" : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 6,
    padding: "8px 14px", fontSize: 12, fontWeight: 500,
    background: "oklch(0.68 0.22 285 / 0.12)",
    border: "1px solid oklch(0.68 0.22 285 / 0.35)", borderRadius: 8,
    color: "oklch(0.78 0.18 285)",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
  };
}

function WhitelistPanel() {
  const settingsQuery = trpc.admin.whitelist.getSettings.useQuery();
  const entriesQuery = trpc.admin.whitelist.listEntries.useQuery();
  const utils = trpc.useUtils();

  const setEnabledMut = trpc.admin.whitelist.setEnabled.useMutation({
    onSuccess: () => utils.admin.whitelist.getSettings.invalidate(),
  });
  const setComfyuiBypassMut = trpc.admin.whitelist.setComfyuiBypass.useMutation({
    onSuccess: () => utils.admin.whitelist.getSettings.invalidate(),
  });
  const setLlmBypassMut = trpc.admin.whitelist.setLlmBypass.useMutation({
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
  const comfyuiBypass = settingsQuery.data?.comfyuiBypass ?? false;
  const llmBypass = settingsQuery.data?.llmBypass ?? false;
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

      {/* ComfyUI bypass toggle — ComfyUI is the user's own local server, so it can be freed independently */}
      <div style={{ ...cardStyle, marginBottom: "20px", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>ComfyUI 节点豁免白名单</h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--c-t2, rgba(255,255,255,0.45))", lineHeight: 1.5 }}>
            {comfyuiBypass
              ? "已豁免 — ComfyUI 生图 / 生视频 / 工作流节点不受白名单限制，所有登录用户均可使用（本地服务器，不消耗云端配额）"
              : "未豁免 — ComfyUI 节点与其他 AI 功能一样受白名单管控"}
            <br />
            <span style={{ color: "var(--c-t3, rgba(255,255,255,0.35))", fontSize: "12px" }}>
              提示：此开关仅在上方「白名单开关」启用时才有实际效果；其他云端 AI（Poyo / Higgsfield 等）始终受白名单保护。
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setComfyuiBypassMut.mutate({ comfyuiBypass: !comfyuiBypass })}
          disabled={setComfyuiBypassMut.isPending}
          style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px",
            border: "none", borderRadius: "8px", cursor: "pointer", flexShrink: 0,
            background: comfyuiBypass ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.15)",
            color: comfyuiBypass ? "#4ade80" : "var(--c-t2, rgba(255,255,255,0.5))",
            fontSize: "13px", fontWeight: 600, transition: "all 0.15s",
          }}
        >
          {comfyuiBypass ? <><ToggleRight style={{ width: "16px", height: "16px" }} />已豁免</> : <><ToggleLeft style={{ width: "16px", height: "16px" }} />未豁免</>}
        </button>
      </div>

      {/* LLM bypass toggle — text/vision LLM is cheap, can be opened independently */}
      <div style={{ ...cardStyle, marginBottom: "20px", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>LLM 模型单独开放</h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--c-t2, rgba(255,255,255,0.45))", lineHeight: 1.5 }}>
            {llmBypass
              ? "已开放 — 大模型对话、角色一致性检查等 LLM（文本/视觉）功能不受白名单限制，所有登录用户均可使用"
              : "未开放 — LLM 功能与其他 AI 一样受白名单管控"}
            <br />
            <span style={{ color: "var(--c-t3, rgba(255,255,255,0.35))", fontSize: "12px" }}>
              提示：此开关仅在上方「白名单开关」启用时才有实际效果；图像 / 视频 / 音频等付费生成始终受白名单保护。
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLlmBypassMut.mutate({ llmBypass: !llmBypass })}
          disabled={setLlmBypassMut.isPending}
          style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px",
            border: "none", borderRadius: "8px", cursor: "pointer", flexShrink: 0,
            background: llmBypass ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.15)",
            color: llmBypass ? "#4ade80" : "var(--c-t2, rgba(255,255,255,0.5))",
            fontSize: "13px", fontWeight: 600, transition: "all 0.15s",
          }}
        >
          {llmBypass ? <><ToggleRight style={{ width: "16px", height: "16px" }} />已开放</> : <><ToggleLeft style={{ width: "16px", height: "16px" }} />未开放</>}
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

type AuditAction = "login_email" | "login_oauth" | "image_gen" | "video_gen" | "audio_music" | "audio_dubbing" | "subtitle_transcribe" | "kie_gen";

function LogsPanel() {
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState<AuditAction | "">("");
  const [userInput, setUserInput] = useState("");   // 输入框（回车/失焦才应用）
  const [userFilter, setUserFilter] = useState(""); // 已应用的用户名/邮箱/ID 筛选
  const utils = trpc.useUtils();
  const LIMIT = 50;

  const logsQuery = trpc.admin.logs.list.useQuery(
    { limit: LIMIT, offset, action: actionFilter || undefined, user: userFilter || undefined },
    { keepPreviousData: true } as object
  );
  const applyUser = () => { setUserFilter(userInput.trim()); setOffset(0); };

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
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyUser(); }}
            onBlur={applyUser}
            placeholder="用户名 / 邮箱 / ID"
            style={{ ...inputStyle, width: 150, padding: "6px 10px", fontSize: "12px" }}
          />
          {userFilter && (
            <button onClick={() => { setUserInput(""); setUserFilter(""); setOffset(0); }} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12, cursor: "pointer" }} title="清除用户筛选">用户：{userFilter} ✕</button>
          )}
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

// ── ComfyUI usage logs (per-user / per-server, detailed) ─────────────────────
function ComfyUsageLogsPanel() {
  const [offset, setOffset] = useState(0);
  const [rangeDays, setRangeDays] = useState("7");
  const [statusFilter, setStatusFilter] = useState<"" | "success" | "error">("");
  const [hostFilter, setHostFilter] = useState("");
  const utils = trpc.useUtils();
  const LIMIT = 50;
  // Anchor sinceMs at selection time so the query key is stable (no refetch loop).
  const sinceMs = useMemo(() => (rangeDays === "0" ? undefined : Date.now() - Number(rangeDays) * 86400000), [rangeDays]);

  const summaryQ = trpc.admin.comfyLogs.summary.useQuery({ sinceMs });
  const listQ = trpc.admin.comfyLogs.list.useQuery(
    { limit: LIMIT, offset, status: statusFilter || undefined, host: hostFilter || undefined, sinceMs },
    { keepPreviousData: true } as object,
  );
  const clearMut = trpc.admin.comfyLogs.clear.useMutation({
    onSuccess: () => { utils.admin.comfyLogs.list.invalidate(); utils.admin.comfyLogs.summary.invalidate(); setOffset(0); },
  });

  const s = summaryQ.data;
  const rows = (listQ.data?.rows ?? []) as Array<Record<string, unknown>>;
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const errRate = s && s.totals.runs > 0 ? Math.round((s.totals.errors / s.totals.runs) * 100) : 0;

  const stat = (label: string, value: string, color = "var(--c-t1)") => (
    <div style={{ flex: 1, minWidth: 110, padding: "10px 12px", borderRadius: 8, background: "var(--c-surface, rgba(255,255,255,0.03))", border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))" }}>
      <div style={{ fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.45))" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
  const miniTable = (title: string, header: string, items: Array<{ key: string; label: string; runs: number; errors: number; avgMs: number; onClick?: () => void }>) => (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 6 }}>{title}</div>
      <div style={{ border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--c-surface, rgba(255,255,255,0.03))" }}>
            {[header, "运行", "失败", "均时"].map((h) => <th key={h} style={{ padding: "5px 8px", textAlign: "left", color: "var(--c-t3)", fontWeight: 500 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={4} style={{ padding: 10, color: "var(--c-t4)", textAlign: "center" }}>暂无</td></tr> :
              items.slice(0, 8).map((it) => (
                <tr key={it.key} onClick={it.onClick} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", cursor: it.onClick ? "pointer" : "default" }}>
                  <td style={{ padding: "5px 8px", color: "var(--c-t1)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.label}>{it.label}</td>
                  <td style={{ padding: "5px 8px", color: "var(--c-t2)" }}>{it.runs}</td>
                  <td style={{ padding: "5px 8px", color: it.errors > 0 ? "#f87171" : "var(--c-t3)" }}>{it.errors}</td>
                  <td style={{ padding: "5px 8px", color: "var(--c-t3)" }}>{(it.avgMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <HardDrive style={{ width: 16, height: 16, color: "oklch(0.72 0.2 285)" }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>ComfyUI 使用日志
            {total > 0 && <span style={{ fontWeight: 400, color: "var(--c-t2)", fontSize: 13, marginLeft: 8 }}>（共 {total} 条）</span>}</h3>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={rangeDays} onChange={(e) => { setRangeDays(e.target.value); setOffset(0); }} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12 }}>
            {[["1", "近 24 小时"], ["7", "近 7 天"], ["30", "近 30 天"], ["0", "全部"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as "" | "success" | "error"); setOffset(0); }} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12 }}>
            <option value="">全部状态</option><option value="success">成功</option><option value="error">失败</option>
          </select>
          {hostFilter && <button onClick={() => { setHostFilter(""); setOffset(0); }} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12, cursor: "pointer" }} title="清除服务器筛选">服务器：{hostFilter} ✕</button>}
          <button onClick={() => { listQ.refetch(); summaryQ.refetch(); }} style={iconBtn} title="刷新"><RefreshCw style={{ width: 14, height: 14 }} /></button>
          <button onClick={() => { if (confirm("确定清空全部 ComfyUI 使用日志？")) clearMut.mutate(); }} disabled={clearMut.isPending} style={{ ...iconBtn, color: "#f87171", borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)" }} title="清空"><Trash2 style={{ width: 14, height: 14 }} /></button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {stat("总运行", String(s?.totals.runs ?? 0))}
        {stat("失败", String(s?.totals.errors ?? 0), (s?.totals.errors ?? 0) > 0 ? "#f87171" : "var(--c-t1)")}
        {stat("失败率", `${errRate}%`, errRate >= 20 ? "#f87171" : "var(--c-t1)")}
        {stat("平均耗时", `${((s?.totals.avgMs ?? 0) / 1000).toFixed(1)}s`)}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        {miniTable("按用户", "用户", (s?.byUser ?? []).map((u) => ({ key: String(u.userId ?? "?"), label: u.userEmail || (u.userId != null ? `ID:${u.userId}` : "未知"), runs: u.runs, errors: u.errors, avgMs: u.avgMs })))}
        {miniTable("按服务器", "host:port", (s?.byHost ?? []).map((h) => ({ key: h.host ?? "?", label: h.host ?? "—", runs: h.runs, errors: h.errors, avgMs: h.avgMs, onClick: h.host ? () => { setHostFilter(h.host!); setOffset(0); } : undefined })))}
      </div>

      {/* Detailed table */}
      {listQ.isLoading ? <div style={{ color: "var(--c-t2)", fontSize: 13, padding: "24px 0" }}>加载中…</div>
        : rows.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "var(--c-t2)", fontSize: 14, border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 8 }}>暂无记录</div>
        : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>{["时间", "用户", "操作", "服务器", "模型", "状态", "耗时", "结果 / 错误"].map((h) => <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--c-t2)", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((log) => {
                const ok = log.status === "success";
                const detail = (log.detail as Record<string, unknown> | null) ?? null;
                return (
                  <tr key={String(log.id)} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "var(--c-t2)" }}>{new Date(log.createdAt as string).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ ...tdStyle, maxWidth: 150 }}><div style={{ color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(log.userEmail as string) || (log.userName as string) || (log.userId != null ? `ID:${log.userId}` : "—")}</div></td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "var(--c-t2)" }}>{String(log.action)}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", whiteSpace: "nowrap", color: "var(--c-t1)", cursor: "pointer" }} onClick={() => { if (log.host) { setHostFilter(String(log.host)); setOffset(0); } }} title="点击按此服务器筛选">{String(log.host ?? "—")}</td>
                    <td style={{ ...tdStyle, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--c-t2)" }} title={String(log.model ?? "")}>{String(log.model ?? "—")}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}><span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: ok ? "oklch(0.75 0.18 150)" : "#f87171", background: ok ? "oklch(0.75 0.18 150 / 0.12)" : "rgba(239,68,68,0.1)", border: `1px solid ${ok ? "oklch(0.75 0.18 150 / 0.3)" : "rgba(239,68,68,0.3)"}` }}>{ok ? "成功" : "失败"}</span></td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "var(--c-t2)" }}>{log.durationMs != null ? `${(Number(log.durationMs) / 1000).toFixed(1)}s` : "—"}</td>
                    <td style={{ ...tdStyle, maxWidth: 240, color: ok ? "var(--c-t2)" : "#f87171" }}>
                      <span title={ok ? String(log.resultUrl ?? "") : String(log.errorMessage ?? "")} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                        {ok ? (log.resultUrl ? `✓ 已生成${log.resultCount ? ` ×${log.resultCount}` : ""}` : (detail ? Object.keys(detail).length + " 项参数" : "✓")) : String(log.errorMessage ?? "失败")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
          <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} style={paginBtn}>上一页</button>
          <span style={{ fontSize: 13, color: "var(--c-t2)" }}>{currentPage} / {totalPages}</span>
          <button onClick={() => setOffset(offset + LIMIT)} disabled={currentPage >= totalPages} style={paginBtn}>下一页</button>
        </div>
      )}
    </div>
  );
}


// ── Chat administration ────────────────────────────────────────────────────────

function ChatAdminPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ChatSettingsPanel />
      <ChatConversationsPanel />
      <ChatMessageSearchPanel />
      <ChatBansPanel />
    </div>
  );
}

function ChatSettingsPanel() {
  const utils = trpc.useUtils();
  const q = trpc.admin.chat.getSettings.useQuery();
  const mu = trpc.admin.chat.setSettings.useMutation({ onSuccess: () => utils.admin.chat.getSettings.invalidate() });
  const s = q.data;
  return (
    <div style={chatCard}>
      <h3 style={chatCardTitle}>聊天设置</h3>
      {!s ? <p style={chatDim}>加载中…</p> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={chatToggleRow}>
            <span>允许「无服务器（端到端加密）」模式</span>
            <input type="checkbox" checked={s.serverlessAllowed} onChange={(e) => mu.mutate({ serverlessAllowed: e.target.checked })} />
          </label>
          <label style={chatToggleRow}>
            <span>启用全局大厅</span>
            <input type="checkbox" checked={s.lobbyEnabled} onChange={(e) => mu.mutate({ lobbyEnabled: e.target.checked })} />
          </label>
          <label style={chatToggleRow}>
            <span>单文件大小上限 (MB)</span>
            <input type="number" min={1} max={5120} defaultValue={s.maxFileMb} onBlur={(e) => mu.mutate({ maxFileMb: Number(e.target.value) })} style={{ width: 80, ...chatInput }} />
          </label>
        </div>
      )}
    </div>
  );
}

function ChatConversationsPanel() {
  const [type, setType] = useState<"" | "lobby" | "group" | "dm">("");
  const [mode, setMode] = useState<"" | "server" | "serverless">("");
  const q = trpc.admin.chat.listConversations.useQuery({
    type: type || undefined, mode: mode || undefined, limit: 50, offset: 0,
  });
  const utils = trpc.useUtils();
  const delMu = trpc.admin.chat.deleteConversation.useMutation({ onSuccess: () => utils.admin.chat.listConversations.invalidate() });
  return (
    <div style={chatCard}>
      <h3 style={chatCardTitle}>会话列表</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} style={chatInput}>
          <option value="">全部类型</option><option value="lobby">大厅</option><option value="group">群聊</option><option value="dm">私聊</option>
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} style={chatInput}>
          <option value="">全部模式</option><option value="server">服务器</option><option value="serverless">端到端</option>
        </select>
      </div>
      <table style={chatTable}>
        <thead><tr><ChatTh>ID</ChatTh><ChatTh>类型</ChatTh><ChatTh>模式</ChatTh><ChatTh>标题</ChatTh><ChatTh>成员</ChatTh><ChatTh>操作</ChatTh></tr></thead>
        <tbody>
          {q.data?.rows.map((c) => (
            <tr key={c.id}>
              <ChatTd>{c.id}</ChatTd><ChatTd>{c.type}</ChatTd>
              <ChatTd>{c.mode === "serverless" ? "🔒端到端" : "服务器"}</ChatTd>
              <ChatTd>{c.title ?? (c.type === "dm" ? "（私聊）" : c.type === "lobby" ? "大厅" : "—")}</ChatTd>
              <ChatTd>{c.memberCount}</ChatTd>
              <ChatTd><button onClick={() => { if (confirm("删除该会话及其消息？")) delMu.mutate({ conversationId: c.id }); }} style={chatDanger}>删除</button></ChatTd>
            </tr>
          ))}
        </tbody>
      </table>
      {q.data?.rows.length === 0 && <p style={chatDim}>暂无会话</p>}
    </div>
  );
}

function ChatMessageSearchPanel() {
  const [keyword, setKeyword] = useState("");
  const [convId, setConvId] = useState("");
  const [userId, setUserId] = useState("");
  const [submitted, setSubmitted] = useState<{ keyword?: string; conversationId?: number; userId?: number } | null>(null);
  const q = trpc.admin.chat.searchMessages.useQuery(
    { ...submitted, limit: 50, offset: 0 },
    { enabled: submitted !== null },
  );
  return (
    <div style={chatCard}>
      <h3 style={chatCardTitle}>消息检索（仅服务器模式可见明文）</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input placeholder="关键词" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={chatInput} />
        <input placeholder="会话ID" value={convId} onChange={(e) => setConvId(e.target.value)} style={{ ...chatInput, width: 100 }} />
        <input placeholder="用户ID" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ ...chatInput, width: 100 }} />
        <button onClick={() => setSubmitted({ keyword: keyword || undefined, conversationId: convId ? Number(convId) : undefined, userId: userId ? Number(userId) : undefined })} style={chatPrimarySm}>搜索</button>
      </div>
      {q.data?.encrypted && <p style={chatDim}>🔒 该会话为端到端加密，服务器无内容，仅可见元数据。</p>}
      {q.data && !q.data.encrypted && (
        <table style={chatTable}>
          <thead><tr><ChatTh>时间</ChatTh><ChatTh>会话</ChatTh><ChatTh>发送者</ChatTh><ChatTh>内容</ChatTh></tr></thead>
          <tbody>
            {q.data.rows.map((m) => (
              <tr key={m.id}>
                <ChatTd>{new Date(m.createdAt).toLocaleString()}</ChatTd>
                <ChatTd>{m.conversationId}</ChatTd>
                <ChatTd>{m.senderName} (#{m.senderId})</ChatTd>
                <ChatTd>{m.content || (m.attachments ? "[文件]" : "")}</ChatTd>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.data && !q.data.encrypted && q.data.rows.length === 0 && <p style={chatDim}>无匹配消息</p>}
    </div>
  );
}

function ChatBansPanel() {
  const utils = trpc.useUtils();
  const q = trpc.admin.chat.listBans.useQuery();
  const [userId, setUserId] = useState("");
  const banMu = trpc.admin.chat.banUser.useMutation({ onSuccess: () => { utils.admin.chat.listBans.invalidate(); setUserId(""); } });
  const unbanMu = trpc.admin.chat.unbanUser.useMutation({ onSuccess: () => utils.admin.chat.listBans.invalidate() });
  return (
    <div style={chatCard}>
      <h3 style={chatCardTitle}>封禁管理</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input placeholder="用户ID" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ ...chatInput, width: 120 }} />
        <button onClick={() => { if (userId) banMu.mutate({ userId: Number(userId), scope: "global" }); }} style={chatDanger}>全局封禁</button>
      </div>
      <table style={chatTable}>
        <thead><tr><ChatTh>用户</ChatTh><ChatTh>范围</ChatTh><ChatTh>原因</ChatTh><ChatTh>操作</ChatTh></tr></thead>
        <tbody>
          {q.data?.map((b) => (
            <tr key={b.id}>
              <ChatTd>{b.userName} (#{b.userId})</ChatTd>
              <ChatTd>{b.scope === "global" ? "全局" : `会话#${b.conversationId}`}</ChatTd>
              <ChatTd>{b.reason ?? "—"}</ChatTd>
              <ChatTd><button onClick={() => unbanMu.mutate({ id: b.id })} style={paginBtn}>解封</button></ChatTd>
            </tr>
          ))}
        </tbody>
      </table>
      {q.data?.length === 0 && <p style={chatDim}>暂无封禁</p>}
    </div>
  );
}

function ChatTh({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: "var(--c-t2, rgba(255,255,255,0.5))", borderBottom: "1px solid var(--c-bd2, rgba(255,255,255,0.08))" }}>{children}</th>;
}
function ChatTd({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "6px 8px", fontSize: 13, borderBottom: "1px solid var(--c-bd1, rgba(255,255,255,0.04))", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</td>;
}

const chatCard: React.CSSProperties = { background: "var(--c-surface, #1a1a22)", border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))", borderRadius: 12, padding: 20, width: "100%" };
const chatCardTitle: React.CSSProperties = { margin: "0 0 14px", fontSize: 15, fontWeight: 600 };
const chatDim: React.CSSProperties = { fontSize: 13, color: "var(--c-t3, rgba(255,255,255,0.4))" };
const chatToggleRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 };
const chatInput: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", background: "var(--c-input, rgba(255,255,255,0.04))", color: "var(--c-t1, #f0f0f4)", fontSize: 13, outline: "none" };
const chatTable: React.CSSProperties = { width: "100%", borderCollapse: "collapse" };
const chatDanger: React.CSSProperties = { padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, cursor: "pointer" };
const chatPrimarySm: React.CSSProperties = { padding: "7px 16px", borderRadius: 8, border: "none", background: "oklch(0.58 0.22 285 / 0.9)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" };

// ── Styles ────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  height: "100dvh", overflowY: "auto",
  display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "flex-start", padding: "48px 24px", background: "var(--c-canvas, #0d0d10)",
};

// ── kie.ai key management ─────────────────────────────────────────────────────

function KiePanel() {
  const utils = trpc.useUtils();
  const wl = trpc.admin.whitelist.getSettings.useQuery();
  const cryptoQ = trpc.admin.kie.cryptoConfigured.useQuery();
  const keysQ = trpc.admin.kie.listKeys.useQuery();
  const [selKey, setSelKey] = useState<{ id: number; name: string } | null>(null);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [note, setNote] = useState("");

  const setKieEnabled = trpc.admin.whitelist.setKieEnabled.useMutation({ onSuccess: () => utils.admin.whitelist.getSettings.invalidate() });
  const addKey = trpc.admin.kie.addKey.useMutation({
    onSuccess: (r) => { utils.admin.kie.listKeys.invalidate(); setName(""); setApiKey(""); setNote(""); toast.success(`已添加${typeof r.credit === "number" ? `（当前余额 ${r.credit}）` : "（余额校验失败，仍已保存）"}`); },
    onError: (e) => toast.error(e.message),
  });
  const toggleKey = trpc.admin.kie.setKeyEnabled.useMutation({ onSuccess: () => utils.admin.kie.listKeys.invalidate() });
  const delKey = trpc.admin.kie.deleteKey.useMutation({ onSuccess: () => { utils.admin.kie.listKeys.invalidate(); setSelKey(null); } });

  const kieEnabled = wl.data?.kieEnabled ?? false;
  const cryptoOk = cryptoQ.data?.configured ?? false;
  const keys = keysQ.data ?? [];

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <ToggleRow
          label="公用 kie 额度（白名单 kie 开关）"
          description={"开启：通过白名单的非管理员用户可使用主 env key（KIE_API_KEY）跑 kie。\n关闭：仅有管理员分配 key、或自填临时 key 的用户能用。管理员始终可用。"}
          enabled={kieEnabled}
          disabled={setKieEnabled.isPending}
          onClick={() => setKieEnabled.mutate({ kieEnabled: !kieEnabled })}
          statusOn="已开启（白名单用户可用公用 key）"
          statusOff="已关闭（仅分配/临时 key 可用）"
        />
      </div>

      {!cryptoOk && (
        <div style={{ ...cardStyle, marginBottom: 20, border: "1px solid rgba(239,68,68,0.3)" }}>
          <div style={{ color: "#f87171", fontSize: 13, lineHeight: 1.6 }}>
            未配置 <code style={{ fontFamily: "monospace" }}>KIE_KEY_SECRET</code> 环境变量 —— 无法加密存储分配 key。请在部署环境设置后重启，再录入 key。
          </div>
        </div>
      )}

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "var(--c-t1)" }}>录入 kie API key（加密存储，不入 env）</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: "1 1 160px" }}><label style={labelStyle}>别名</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="如：员工A-限额" /></div>
          <div style={{ flex: "2 1 260px" }}><label style={labelStyle}>API key</label><input type="password" style={inputStyle} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="kie.ai API key" /></div>
          <div style={{ flex: "1 1 160px" }}><label style={labelStyle}>备注（可选）</label><input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="用途说明" /></div>
        </div>
        <button
          disabled={!name.trim() || !apiKey.trim() || addKey.isPending || !cryptoOk}
          onClick={() => addKey.mutate({ name: name.trim(), apiKey: apiKey.trim(), note: note.trim() || undefined })}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid oklch(0.72 0.15 200 / 0.3)", background: "oklch(0.72 0.15 200 / 0.14)", color: "oklch(0.72 0.15 200)", fontSize: 13, fontWeight: 600, cursor: (!name.trim() || !apiKey.trim() || addKey.isPending || !cryptoOk) ? "not-allowed" : "pointer", opacity: (!name.trim() || !apiKey.trim() || addKey.isPending || !cryptoOk) ? 0.5 : 1 }}
        >
          <Plus style={{ width: 14, height: 14 }} /> {addKey.isPending ? "添加中…" : "添加并校验余额"}
        </button>
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--c-t1)" }}>已录入的 key（{keys.length}）</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["别名", "末4位", "授权用户", "成组状态", "操作"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {keys.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--c-t3)" }} colSpan={5}>暂无 key</td></tr>}
              {keys.map((k) => (
                <tr key={k.id} style={{ borderBottom: "1px solid var(--c-bd1)" }}>
                  <td style={tdStyle}>{k.name}{k.note ? <span style={{ color: "var(--c-t3)", fontSize: 11 }}> · {k.note}</span> : null}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", color: "var(--c-t2)" }}>…{k.keyLast4}</td>
                  <td style={tdStyle}>{k.activeBindingCount}/{k.bindingCount}</td>
                  <td style={tdStyle}>
                    <button onClick={() => toggleKey.mutate({ keyId: k.id, enabled: !k.enabled })} disabled={toggleKey.isPending} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${k.enabled ? "oklch(0.7 0.18 145 / 0.3)" : "rgba(239,68,68,0.25)"}`, background: k.enabled ? "oklch(0.7 0.18 145 / 0.1)" : "rgba(239,68,68,0.08)", color: k.enabled ? "oklch(0.7 0.18 145)" : "#f87171" }}>
                      {k.enabled ? "已启用" : "已停用"}
                    </button>
                  </td>
                  <td style={tdStyle}>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSelKey(selKey?.id === k.id ? null : { id: k.id, name: k.name })} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, border: "1px solid var(--c-bd2)", background: selKey?.id === k.id ? "var(--c-elevated)" : "transparent", color: "var(--c-t2)", cursor: "pointer" }}>
                        {selKey?.id === k.id ? "收起绑定" : "管理绑定"}
                      </button>
                      <button onClick={() => { if (window.confirm(`删除 key「${k.name}」及其全部绑定？`)) delKey.mutate({ keyId: k.id }); }} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 12, cursor: "pointer" }}>
                        <Trash2 style={{ width: 12, height: 12 }} /> 删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selKey && <KieBindings keyId={selKey.id} keyName={selKey.name} />}
    </>
  );
}

function KieBindings({ keyId, keyName }: { keyId: number; keyName: string }) {
  const utils = trpc.useUtils();
  const listQ = trpc.admin.kie.listBindings.useQuery({ keyId });
  const usersQ = trpc.admin.users.list.useQuery();
  const [userId, setUserId] = useState("");          // 解析后的目标用户 ID（字符串）
  const [query, setQuery] = useState("");            // 搜索框：用户名 / 邮箱 / ID
  const [picked, setPicked] = useState<{ id: number; label: string } | null>(null);
  const [note, setNote] = useState("");

  const invalidate = () => { utils.admin.kie.listBindings.invalidate({ keyId }); utils.admin.kie.listKeys.invalidate(); };
  const reset = () => { setUserId(""); setQuery(""); setPicked(null); setNote(""); };
  const bind = trpc.admin.kie.bindUser.useMutation({ onSuccess: () => { invalidate(); reset(); toast.success("已绑定"); }, onError: (e) => toast.error(e.message) });
  const toggleBinding = trpc.admin.kie.setBindingEnabled.useMutation({ onSuccess: invalidate });
  const unbind = trpc.admin.kie.unbind.useMutation({ onSuccess: invalidate });

  // 按用户名 / 邮箱 / ID 模糊匹配（最多 8 条）。
  const q = query.trim().toLowerCase();
  const matches = q
    ? (usersQ.data ?? []).filter((u) =>
        String(u.id) === q || (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q),
      ).slice(0, 8)
    : [];

  const rows = listQ.data ?? [];
  return (
    <div style={{ ...cardStyle, marginBottom: 20, border: "1px solid oklch(0.72 0.15 200 / 0.3)" }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--c-t1)" }}>key「{keyName}」的授权用户</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 240px", position: "relative" }}>
          <label style={labelStyle}>绑定用户（用户名 / 邮箱 / ID）</label>
          {picked ? (
            <div style={{ ...inputStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked.label}（ID {picked.id}）</span>
              <button onClick={() => { setPicked(null); setUserId(""); }} style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", flexShrink: 0 }}><X style={{ width: 14, height: 14 }} /></button>
            </div>
          ) : (
            <input style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入用户名 / 邮箱 / ID 搜索…" />
          )}
          {!picked && matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4, background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 8, boxShadow: "0 8px 24px oklch(0 0 0 / 0.4)", maxHeight: 220, overflowY: "auto" }}>
              {matches.map((u) => {
                const label = u.name || u.email || ("#" + u.id);
                return (
                  <button key={u.id} onClick={() => { setPicked({ id: u.id, label }); setUserId(String(u.id)); setQuery(""); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", background: "none", border: "none", borderBottom: "1px solid var(--c-bd1)", cursor: "pointer", color: "var(--c-t1)", fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{u.name || "—"}</span>
                    <span style={{ color: "var(--c-t3)", fontSize: 11 }}> · {u.email || u.openId} · ID {u.id}{u.disabled ? " · 已冻结" : ""}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ flex: "1 1 180px" }}><label style={labelStyle}>备注（可选）</label><input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button disabled={!/^\d+$/.test(userId.trim()) || bind.isPending} onClick={() => bind.mutate({ keyId, userId: parseInt(userId.trim(), 10), note: note.trim() || undefined })} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--c-bd2)", background: "var(--c-elevated)", color: "var(--c-t1)", fontSize: 13, cursor: (/^\d+$/.test(userId.trim()) && !bind.isPending) ? "pointer" : "not-allowed", opacity: (/^\d+$/.test(userId.trim()) && !bind.isPending) ? 1 : 0.5 }}>
          <Plus style={{ width: 14, height: 14 }} /> 绑定用户
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["用户", "授权状态", "操作"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--c-t3)" }} colSpan={3}>暂无绑定用户</td></tr>}
            {rows.map((b) => (
              <tr key={b.id} style={{ borderBottom: "1px solid var(--c-bd1)" }}>
                <td style={tdStyle}>ID {b.userId}{b.userEmail ? <span style={{ color: "var(--c-t3)", fontSize: 11 }}> · {b.userEmail}</span> : null}{b.note ? <span style={{ color: "var(--c-t3)", fontSize: 11 }}> · {b.note}</span> : null}</td>
                <td style={tdStyle}>
                  <button onClick={() => toggleBinding.mutate({ bindingId: b.id, enabled: !b.enabled })} disabled={toggleBinding.isPending} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${b.enabled ? "oklch(0.7 0.18 145 / 0.3)" : "rgba(239,68,68,0.25)"}`, background: b.enabled ? "oklch(0.7 0.18 145 / 0.1)" : "rgba(239,68,68,0.08)", color: b.enabled ? "oklch(0.7 0.18 145)" : "#f87171" }}>
                    {b.enabled ? "已授权" : "已停用"}
                  </button>
                </td>
                <td style={tdStyle}>
                  <button onClick={() => unbind.mutate({ bindingId: b.id })} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 12, cursor: "pointer" }}>
                    <Trash2 style={{ width: 12, height: 12 }} /> 解绑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
  borderRadius: "7px", background: "var(--c-input, rgba(255,255,255,0.04))",
  color: "var(--c-t1, #f0f0f4)", fontSize: "13px", outline: "none", boxSizing: "border-box",
};

const tdStyle: React.CSSProperties = { padding: "9px 10px", color: "var(--c-t1, #f0f0f4)" };
const thStyle: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left", fontWeight: 600,
  color: "var(--c-t3, rgba(255,255,255,0.5))", fontSize: 10, textTransform: "uppercase",
  letterSpacing: "0.06em", borderBottom: "1px solid var(--c-bd1)",
};

const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: "30px", height: "30px", border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))",
  borderRadius: "7px", background: "var(--c-input, rgba(255,255,255,0.04))",
  color: "var(--c-t2, rgba(255,255,255,0.45))", cursor: "pointer",
};

const paginBtn: React.CSSProperties = {
  padding: "6px 14px", border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))",
  borderRadius: "7px", background: "var(--c-input, rgba(255,255,255,0.04))",
  color: "var(--c-t1, #f0f0f4)", fontSize: "13px", cursor: "pointer",
};

// ── Downloads approval panel ──────────────────────────────────────────────────
function DownloadsAdminPanel() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"pending" | "active" | "revoked" | "denied" | "">("pending");
  const [preview, setPreview] = useState<AdminAsset | null>(null);
  // 统一有效期控件（审批 / 授权整个项目 / 主动授权共用）：数量 + 单位 + 永久。
  const [expAmount, setExpAmount] = useState(1);
  const [expUnit, setExpUnit] = useState<"hour" | "day">("hour");
  const [expForever, setExpForever] = useState(false);
  const expiresMs = (): number | undefined => expForever ? undefined : Date.now() + expAmount * (expUnit === "day" ? 86400_000 : 3600_000);
  const expLabel = expForever ? "永久" : `${expAmount}${expUnit === "day" ? "天" : "小时"}`;
  // decide/grant 通用的有效期参数（永久 → permanent；否则 → expiresAt 时间戳）。
  const expDecideArg = (): { permanent: true } | { expiresAt: number } => expForever ? { permanent: true } : { expiresAt: expiresMs()! };
  // 主动授权表单状态
  const [showGrant, setShowGrant] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantProjectSel, setGrantProjectSel] = useState<Set<number>>(new Set());
  const [grantNote, setGrantNote] = useState("");
  // 实时倒计时：每秒推进一个 now 时间戳，驱动「剩余有效期」显示。
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowTs(Date.now()), 1000); return () => clearInterval(t); }, []);
  const fmtRemain = (exp: string | number | Date): string => {
    const ms = new Date(exp).getTime() - nowTs;
    if (ms <= 0) return "已过期";
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d > 0) return `${d}天 ${h}时 ${m}分`;
    if (h > 0) return `${h}时 ${m}分 ${sec}秒`;
    if (m > 0) return `${m}分 ${sec}秒`;
    return `${sec}秒`;
  };
  const userProjects = trpc.admin.downloads.userProjects.useQuery(
    { email: grantEmail.trim() },
    { enabled: showGrant && !!grantEmail.trim() },
  );
  const { data: grants, isFetching } = trpc.admin.downloads.list.useQuery({ status: status || undefined, limit: 300 });
  const onDone = () => void utils.admin.downloads.list.invalidate();
  const decideMut = trpc.admin.downloads.decide.useMutation({ onSuccess: onDone });
  const revokeMut = trpc.admin.downloads.revoke.useMutation({ onSuccess: onDone });
  const grantMut = trpc.admin.downloads.grant.useMutation({ onSuccess: onDone });
  const busy = decideMut.isPending || revokeMut.isPending || grantMut.isPending;

  const chip = (active: boolean): React.CSSProperties => ({
    fontSize: 12, padding: "4px 11px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "oklch(0.72 0.2 285)" : "var(--c-bd2)"}`,
    background: active ? "oklch(0.72 0.2 285 / 0.15)" : "transparent",
    color: active ? "oklch(0.78 0.16 285)" : "var(--c-t2, rgba(255,255,255,0.55))",
  });
  const statusColor = (s: string) => s === "pending" ? "oklch(0.8 0.16 85)" : s === "active" ? "oklch(0.72 0.18 155)" : s === "denied" ? "oklch(0.7 0.18 25)" : "var(--c-t3,rgba(255,255,255,0.4))";
  const statusLabel = (s: string) => ({ pending: "待审批", active: "已授权", revoked: "已撤销", denied: "已拒绝" } as Record<string, string>)[s] ?? s;
  const btn = (color: string, bg = "transparent"): React.CSSProperties => ({ fontSize: 12, padding: "5px 11px", borderRadius: 7, border: `1px solid ${color}`, background: bg, color, cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12.5, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.6 }}>
        在「存储设置 → 严格下载授权」开启后，非管理员下载原文件须持「一次性授权」。可在此审批用户申请、查证文件，或主动按文件/整个项目授权。每张授权对每个文件仅可成功下载一次。
      </div>

      {/* 主动授权（无需用户提交申请）— 直接给某用户授权某项目，可指定任意有效期 */}
      <div style={{ border: "1px solid oklch(0.72 0.2 285 / 0.3)", borderRadius: 8, overflow: "hidden", background: "oklch(0.72 0.2 285 / 0.04)" }}>
        <button onClick={() => setShowGrant((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: "transparent", border: "none", color: "oklch(0.8 0.16 285)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <span>＋ 主动授权（无需用户申请，直接授权整个项目）</span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>{showGrant ? "收起" : "展开"}</span>
        </button>
        {showGrant && (() => {
          const u = userProjects.data?.user;
          const projects = userProjects.data?.projects ?? [];
          const owned = projects.filter((p) => p.role === "owner");
          const collab = projects.filter((p) => p.role === "collaborator");
          const canGrant = !!u && grantProjectSel.size > 0 && !grantMut.isPending;
          const inp: React.CSSProperties = { fontSize: 12.5, padding: "6px 9px", borderRadius: 7, border: "1px solid var(--c-bd2, rgba(255,255,255,0.14))", background: "var(--c-input, rgba(255,255,255,0.04))", color: "var(--c-t1,#f0f0f4)", width: "100%" };
          const toggleProj = (id: number) => setGrantProjectSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
          const submit = async () => {
            if (!u || grantProjectSel.size === 0) return;
            const expiresAt = expiresMs();
            const ids = Array.from(grantProjectSel);
            for (const pid of ids) {
              try { await grantMut.mutateAsync({ userId: u.id, scope: "project", projectId: pid, note: grantNote.trim() || undefined, expiresAt }); } catch { /* per-project, keep going */ }
            }
            setStatus("active"); setGrantProjectSel(new Set()); setGrantNote("");
          };
          const projRow = (p: { id: number; name: string; role: string }) => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer", background: grantProjectSel.has(p.id) ? "oklch(0.72 0.2 285 / 0.12)" : "transparent", fontSize: 12.5, color: "var(--c-t1,#f0f0f4)" }}>
              <input type="checkbox" checked={grantProjectSel.has(p.id)} onChange={() => toggleProj(p.id)} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              <span style={{ fontSize: 10.5, color: "var(--c-t4,rgba(255,255,255,0.4))" }}>#{p.id}</span>
            </label>
          );
          return (
            <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--c-t3,rgba(255,255,255,0.5))" }}>用户邮箱</label>
                <input value={grantEmail} onChange={(e) => { setGrantEmail(e.target.value); setGrantProjectSel(new Set()); }} placeholder="输入用户邮箱后自动列出其项目" style={inp} />
                <div style={{ fontSize: 11, marginTop: 3, color: u ? "oklch(0.74 0.18 155)" : "oklch(0.7 0.18 25)" }}>
                  {grantEmail.trim() ? (userProjects.isFetching ? "查找中…" : u ? `✓ ${u.name ?? u.email ?? `用户 ${u.id}`}（id ${u.id}）` : "未找到该邮箱用户") : "　"}
                </div>
              </div>

              {/* 该用户的项目（自有 + 协作）— 勾选要授权的 */}
              {u && (
                <div style={{ border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", borderRadius: 7, maxHeight: 240, overflowY: "auto", padding: "4px 0" }}>
                  {projects.length === 0 && <div style={{ fontSize: 12, color: "var(--c-t4,rgba(255,255,255,0.4))", padding: "10px 10px", textAlign: "center" }}>该用户暂无可授权的项目</div>}
                  {owned.length > 0 && <>
                    <div style={{ fontSize: 10.5, color: "var(--c-t3,rgba(255,255,255,0.5))", padding: "4px 10px 2px", fontWeight: 600 }}>自有项目（{owned.length}）</div>
                    {owned.map(projRow)}
                  </>}
                  {collab.length > 0 && <>
                    <div style={{ fontSize: 10.5, color: "var(--c-t3,rgba(255,255,255,0.5))", padding: "6px 10px 2px", fontWeight: 600 }}>参与协作的项目（{collab.length}）</div>
                    {collab.map(projRow)}
                  </>}
                </div>
              )}

              <div style={{ fontSize: 11.5, color: "var(--c-t3,rgba(255,255,255,0.5))" }}>
                有效期：<span style={{ color: "oklch(0.8 0.16 285)", fontWeight: 600 }}>{expLabel}</span>
                {!expForever && <span style={{ color: "var(--c-t4,rgba(255,255,255,0.35))" }}>（到期 {new Date(expiresMs()!).toLocaleString("zh-CN")}）</span>}
                <span style={{ color: "var(--c-t4,rgba(255,255,255,0.35))" }}> · 在上方「有效期」处调整</span>
              </div>
              <input value={grantNote} onChange={(e) => setGrantNote(e.target.value)} placeholder="备注（可选，记入授权与日志）" style={inp} />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button disabled={!canGrant} onClick={() => void submit()}
                  style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 16px", borderRadius: 7, border: "1px solid oklch(0.72 0.2 285)", background: canGrant ? "oklch(0.72 0.2 285 / 0.18)" : "transparent", color: "oklch(0.82 0.16 285)", cursor: canGrant ? "pointer" : "not-allowed", opacity: canGrant ? 1 : 0.5 }}>
                  {grantMut.isPending ? "授权中…" : `授权选中的 ${grantProjectSel.size} 个项目`}
                </button>
                <span style={{ fontSize: 11, color: "var(--c-t4,rgba(255,255,255,0.35))" }}>授权后立即生效（status=active），并记入审计日志</span>
              </div>
            </div>
          );
        })()}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {([["pending", "待审批"], ["active", "已授权"], ["denied", "已拒绝"], ["revoked", "已撤销"], ["", "全部"]] as const).map(([v, l]) => (
          <button key={v} style={chip(status === v)} onClick={() => setStatus(v)}>{l}</button>
        ))}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--c-t3,rgba(255,255,255,0.5))" }} title="审批 / 授权整个项目 / 主动授权 共用此有效期">
          有效期
          <input type="number" min={1} disabled={expForever} value={expAmount}
            onChange={(e) => setExpAmount(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            style={{ width: 56, fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--c-bd2, rgba(255,255,255,0.14))", background: "var(--c-input, rgba(255,255,255,0.04))", color: "var(--c-t1,#f0f0f4)", opacity: expForever ? 0.5 : 1 }}
          />
          <select disabled={expForever} value={expUnit} onChange={(e) => setExpUnit(e.target.value as "hour" | "day")}
            style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--c-bd2, rgba(255,255,255,0.14))", background: "var(--c-input, rgba(255,255,255,0.04))", color: "var(--c-t1,#f0f0f4)", opacity: expForever ? 0.5 : 1 }}>
            <option value="hour">小时</option>
            <option value="day">天</option>
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={expForever} onChange={(e) => setExpForever(e.target.checked)} /> 永久
          </label>
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--c-t3, rgba(255,255,255,0.4))" }}>{isFetching ? "加载中…" : `${grants?.length ?? 0} 条`}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(grants ?? []).map((g) => {
          const isImg = g.fileType === "image" && g.fileUrl;
          const openPreview = () => g.fileUrl && setPreview({ id: g.id, name: g.fileName ?? "文件", type: g.fileType ?? "other", url: g.fileUrl, userId: g.userId, source: null, provider: null, model: null });
          return (
          <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--c-bd1, rgba(255,255,255,0.08))", background: "var(--c-surface, rgba(255,255,255,0.02))" }}>
            {/* File preview thumbnail — click to verify */}
            <div
              onClick={g.fileUrl ? openPreview : undefined}
              title={g.fileUrl ? "点击查看文件" : undefined}
              style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 7, overflow: "hidden", background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", cursor: g.fileUrl ? "zoom-in" : "default" }}
            >
              {isImg ? <img src={g.fileUrl!} alt={g.fileName ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ fontSize: 9.5, color: "var(--c-t3,rgba(255,255,255,0.4))" }}>{g.fileType ?? "文件"}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--c-t1,#f0f0f4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ color: statusColor(g.status), fontWeight: 600 }}>{statusLabel(g.status)}</span>
                {" · "}{g.fileName ?? (g.scope === "project" ? `项目 ${g.projectName ?? g.projectId}` : (g.storageKey ?? `assetId ${g.assetId ?? "?"}`))}
              </div>
              <div style={{ fontSize: 11, color: "var(--c-t3,rgba(255,255,255,0.4))", marginTop: 2, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.6 }}>
                申请人：{g.requesterName ?? `u${g.userId}`}{g.requesterEmail ? `（${g.requesterEmail}）` : ""}
                {" · "}{g.origin === "request" ? "用户申请" : "管理员授权"}
                {" · "}{g.scope === "asset" ? "单文件" : "整个项目"}
                {g.projectName ? ` · 项目：${g.projectName}` : ""}
                {g.reason ? ` · 理由：${g.reason}` : ""}{g.note ? ` · 备注：${g.note}` : ""}
                {" · 申请："}{new Date(g.createdAt).toLocaleString("zh-CN")}
                {g.status === "active" && (g.expiresAt
                  ? <span style={{ color: new Date(g.expiresAt).getTime() - nowTs <= 0 ? "oklch(0.7 0.18 25)" : "oklch(0.78 0.16 85)", fontWeight: 600 }}>{" · 剩余 "}{fmtRemain(g.expiresAt)}<span style={{ fontWeight: 400, color: "var(--c-t4,rgba(255,255,255,0.35))" }}>（至 {new Date(g.expiresAt).toLocaleString("zh-CN")}）</span></span>
                  : <span style={{ color: "oklch(0.72 0.18 155)", fontWeight: 600 }}>{" · 永久有效"}</span>)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
              {g.fileUrl && (
                <a href={g.fileUrl} target="_blank" rel="noreferrer" style={{ ...btn("var(--c-t3,rgba(255,255,255,0.5))"), textDecoration: "none" }}>查看</a>
              )}
              {g.status === "pending" && (
                <>
                  <button disabled={busy} onClick={() => decideMut.mutate({ grantId: g.id, approve: true, ...expDecideArg() })} style={btn("oklch(0.74 0.18 155)", "oklch(0.6 0.16 155 / 0.12)")}>批准（{expLabel}）</button>
                  <button disabled={busy} onClick={() => decideMut.mutate({ grantId: g.id, approve: false })} style={btn("oklch(0.74 0.18 25)")}>拒绝</button>
                  {g.projectId != null && (
                    <button disabled={busy} title={`一次性授权该用户下载这个项目的全部文件（有效期 ${expLabel}，并结掉本申请）`} onClick={() => grantMut.mutate(
                      { userId: g.userId, scope: "project", projectId: g.projectId!, note: "审批时授权整个项目", expiresAt: expiresMs() },
                      { onSuccess: () => decideMut.mutate({ grantId: g.id, approve: true, ...expDecideArg() }) }, // resolve the pending request too
                    )} style={btn("oklch(0.72 0.2 285)")}>授权整个项目（{expLabel}）</button>
                  )}
                </>
              )}
              {g.status === "active" && (
                <button disabled={busy} onClick={() => revokeMut.mutate({ grantId: g.id })} style={btn("var(--c-t2,rgba(255,255,255,0.5))")}>撤销</button>
              )}
            </div>
          </div>
          );
        })}
        {(grants ?? []).length === 0 && !isFetching && (
          <div style={{ fontSize: 12.5, color: "var(--c-t3,rgba(255,255,255,0.4))", padding: "16px 0", textAlign: "center" }}>暂无记录</div>
        )}
      </div>
      {(decideMut.error || revokeMut.error || grantMut.error) && (
        <div style={{ fontSize: 11.5, color: "oklch(0.7 0.18 25)" }}>{(decideMut.error || revokeMut.error || grantMut.error)?.message}</div>
      )}
      {preview && <AdminAssetLightbox asset={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ── Admin asset lightbox (click-to-enlarge) ──────────────────────────────────
type AdminAsset = { id: number; name: string; type: string; url: string; userId: number; source: string | null; provider: string | null; model: string | null };
function AdminAssetLightbox({ asset, onClose }: { asset: AdminAsset; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "oklch(0 0 0 / 0.8)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        style={{ position: "relative", maxWidth: 960, width: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", background: "var(--c-elevated, #1a1a20)", border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--c-bd1, rgba(255,255,255,0.08))" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--c-t1,#f0f0f4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <a href={asset.url} download={asset.name} target="_blank" rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 8, fontSize: 12, color: "var(--c-t2,rgba(255,255,255,0.6))", border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))" }}>
              <Download style={{ width: 13, height: 13 }} /> 下载
            </a>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-t3,rgba(255,255,255,0.4))", background: "transparent", border: "none", cursor: "pointer" }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: 16, background: "rgba(0,0,0,0.3)" }}>
          {asset.type === "image" ? (
            <img src={asset.url} alt={asset.name} style={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain" }} />
          ) : asset.type === "video" ? (
            <WatermarkedVideo src={asset.url} controls autoPlay style={{ maxWidth: "100%", maxHeight: "72vh" }} />
          ) : asset.type === "audio" ? (
            <audio src={asset.url} controls autoPlay style={{ width: "100%" }} />
          ) : (
            <div style={{ fontSize: 13, color: "var(--c-t3,rgba(255,255,255,0.4))" }}>该文件类型无法预览，请下载查看</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Assets Panel (admin cross-user media library) ─────────────────────────────
function AssetsAdminPanel() {
  const [userId, setUserId] = useState<string>("");
  const [type, setType] = useState<"" | "image" | "video" | "audio" | "other">("");
  const [source, setSource] = useState<"" | "upload" | "generated" | "external">("");
  const [q, setQ] = useState("");
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<AdminAsset | null>(null);
  const { data: assets, isFetching } = trpc.admin.assets.list.useQuery({
    userId: userId.trim() ? Number(userId.trim()) : undefined,
    type: type || undefined,
    source: source || undefined,
    q: q.trim() || undefined,
    limit: 300,
  });

  const deleteMut = trpc.admin.assets.delete.useMutation({
    onSuccess: (r) => { setSelected(new Set()); void utils.admin.assets.list.invalidate(); void utils.admin.assets.backfillStatus.invalidate(); void r; },
  });
  const hardDeleteMut = trpc.admin.assets.hardDelete.useMutation({
    onSuccess: (r) => {
      setSelected(new Set());
      void utils.admin.assets.list.invalidate();
      void utils.admin.assets.backfillStatus.invalidate();
      alert(`已彻底删除 ${r.count} 条记录；物理删除 MinIO 对象 ${r.objectsDeleted} 个${r.objectsFailed ? `，${r.objectsFailed} 个未能删除（非 S3/MinIO 后端或对象不存在）` : ""}。`);
    },
  });
  const list = (assets ?? []) as AdminAsset[];
  const selecting = selected.size > 0;
  const allSelected = list.length > 0 && list.every((a) => selected.has(a.id));
  const toggleSelect = (id: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelectAll = () => setSelected((prev) => {
    if (list.every((a) => prev.has(a.id))) { const n = new Set(prev); for (const a of list) n.delete(a.id); return n; }
    const n = new Set(prev); for (const a of list) n.add(a.id); return n;
  });
  const handleBulkDelete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`确认删除选中的 ${ids.length} 个素材？（软删除：保留文件，仅从素材库隐藏）`)) return;
    deleteMut.mutate({ ids });
  };
  // 彻底删除（仅管理员，服务端 adminProcedure 再校验）：物理删 MinIO 对象 + 删行，不可恢复。
  // 二次确认：先警告，再要求输入数量确认，杜绝误触。
  const handleHardDelete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`⚠️ 彻底删除选中的 ${ids.length} 个素材？\n\n这将物理删除 MinIO 中的文件对象并删除数据库记录，无法恢复、无法找回！\n（普通"删除"只是隐藏，文件仍保留；彻底删除则真正抹除。）`)) return;
    const answer = prompt(`此操作不可逆。请输入要删除的数量「${ids.length}」以确认彻底删除：`);
    if (answer == null) return;
    if (answer.trim() !== String(ids.length)) { alert("输入与数量不符，已取消。"); return; }
    hardDeleteMut.mutate({ ids });
  };

  // 一键回填历史素材（扫描画布节点，把已在 MinIO 但未入库的图片/视频补入素材库）。
  const backfillStatus = trpc.admin.assets.backfillStatus.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchInterval: (qr) => (qr.state.data?.state === "running" ? 1200 : false),
  });
  const backfillMut = trpc.admin.assets.backfill.useMutation({
    onSuccess: () => { void utils.admin.assets.backfillStatus.invalidate(); },
  });
  const bf = backfillStatus.data;
  const bfRunning = bf?.state === "running";
  // 回填成功后刷新素材列表，让新补入的记录立即可见。
  useEffect(() => {
    if (bf?.state === "success") void utils.admin.assets.list.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bf?.state, bf?.finishedAt]);
  const handleBackfill = () => {
    if (bfRunning) return;
    if (!confirm("扫描全部画布节点，把历史生成的图片/视频补入素材库？\n该操作幂等（重复运行不会产生重复记录），可安全多次执行。")) return;
    backfillMut.mutate();
  };
  const chip = (active: boolean): React.CSSProperties => ({
    fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "oklch(0.72 0.2 285)" : "var(--c-bd2)"}`,
    background: active ? "oklch(0.72 0.2 285 / 0.15)" : "transparent",
    color: active ? "oklch(0.78 0.16 285)" : "var(--c-t2, rgba(255,255,255,0.55))",
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="用户 ID（空=全部）" inputMode="numeric"
          style={{ width: 130, padding: "6px 10px", borderRadius: 7, border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))", background: "var(--c-input, rgba(255,255,255,0.04))", color: "var(--c-t1,#f0f0f4)", fontSize: 13 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按名称搜索"
          style={{ flex: 1, minWidth: 140, padding: "6px 10px", borderRadius: 7, border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))", background: "var(--c-input, rgba(255,255,255,0.04))", color: "var(--c-t1,#f0f0f4)", fontSize: 13 }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {([["", "全部"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["other", "其他"]] as const).map(([v, l]) => (
          <button key={v} style={chip(type === v)} onClick={() => setType(v)}>{l}</button>
        ))}
        <span style={{ width: 1, background: "var(--c-bd2, rgba(255,255,255,0.1))", margin: "0 4px" }} />
        {([["", "全来源"], ["upload", "上传"], ["generated", "生成"], ["external", "外部"]] as const).map(([v, l]) => (
          <button key={v} style={chip(source === v)} onClick={() => setSource(v)}>{l}</button>
        ))}
      </div>
      {/* 历史素材回填 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        padding: "10px 12px", borderRadius: 8,
        border: "1px solid var(--c-bd1, rgba(255,255,255,0.08))", background: "var(--c-surface, rgba(255,255,255,0.02))",
      }}>
        <button
          onClick={handleBackfill}
          disabled={bfRunning}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "7px 14px", fontSize: 12.5, fontWeight: 600,
            background: bfRunning ? "var(--c-input, rgba(255,255,255,0.06))" : "oklch(0.62 0.18 60 / 0.85)",
            border: "1px solid oklch(0.68 0.18 60 / 0.4)", borderRadius: 8,
            color: bfRunning ? "var(--c-t3, rgba(255,255,255,0.4))" : "#1a1205",
            cursor: bfRunning ? "not-allowed" : "pointer", flexShrink: 0,
          }}
        >
          {bfRunning
            ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
            : <DownloadCloud style={{ width: 13, height: 13 }} />}
          {bfRunning ? "回填中…" : "补历史素材数据"}
        </button>
        <div style={{ fontSize: 12, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.5 }}>
          {bf?.state === "running"
            ? `扫描中：${bf.scanned}${bf.total ? `/${bf.total}` : ""} 个节点，已补 ${bf.recorded} 条…`
            : bf?.state === "success"
              ? `完成：扫描 ${bf.scanned} 个节点，补入 ${bf.recorded} 条（去重自动跳过），${bf.skipped} 条无归属跳过。`
              : bf?.state === "error"
                ? <span style={{ color: "oklch(0.7 0.18 25)" }}>失败：{bf.error}</span>
                : "把历史生成、已在 MinIO 但未入库的图片/视频补入素材库（幂等，可重复运行）。"}
          {backfillMut.error && <span style={{ color: "oklch(0.7 0.18 25)", marginLeft: 8 }}>启动失败：{backfillMut.error.message}</span>}
        </div>
      </div>

      {/* Count + multi-select toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--c-t3, rgba(255,255,255,0.4))" }}>
            {isFetching ? "加载中…" : `${list.length} 个素材`}
          </span>
          {list.length > 0 && (
            <button onClick={toggleSelectAll} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "4px 9px", borderRadius: 7, border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))", background: "transparent", color: "var(--c-t2,rgba(255,255,255,0.6))", cursor: "pointer" }}>
              {allSelected ? <CheckSquare style={{ width: 14, height: 14, color: "oklch(0.72 0.2 285)" }} /> : <Square style={{ width: 14, height: 14 }} />}
              {allSelected ? "取消全选" : "全选"}
              {selecting && <span style={{ color: "oklch(0.78 0.16 285)" }}>· 已选 {selected.size}</span>}
            </button>
          )}
        </div>
        {selecting && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={handleBulkDelete} disabled={deleteMut.isPending}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "5px 11px", borderRadius: 7, border: "1px solid oklch(0.6 0.16 25 / 0.4)", background: "transparent", color: "oklch(0.78 0.16 25)", cursor: deleteMut.isPending ? "not-allowed" : "pointer" }}>
              {deleteMut.isPending ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : <Trash2 style={{ width: 13, height: 13 }} />} 删除选中（隐藏）
            </button>
            <button onClick={handleHardDelete} disabled={hardDeleteMut.isPending} title="物理删除 MinIO 文件 + 数据库记录，不可恢复（仅管理员）"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "5px 11px", borderRadius: 7, border: "1px solid oklch(0.6 0.2 25 / 0.7)", background: "oklch(0.6 0.2 25 / 0.12)", color: "oklch(0.82 0.2 25)", fontWeight: 600, cursor: hardDeleteMut.isPending ? "not-allowed" : "pointer" }}>
              {hardDeleteMut.isPending ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : <Trash2 style={{ width: 13, height: 13 }} />} 彻底删除
            </button>
            <button onClick={() => setSelected(new Set())}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, padding: "5px 9px", borderRadius: 7, border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))", background: "transparent", color: "var(--c-t3,rgba(255,255,255,0.4))", cursor: "pointer" }}>
              <X style={{ width: 13, height: 13 }} /> 取消
            </button>
          </div>
        )}
      </div>
      {deleteMut.error && <div style={{ fontSize: 11.5, color: "oklch(0.7 0.18 25)" }}>删除失败：{deleteMut.error.message}</div>}
      {hardDeleteMut.error && <div style={{ fontSize: 11.5, color: "oklch(0.7 0.18 25)" }}>彻底删除失败：{hardDeleteMut.error.message}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
        {list.map((a) => {
          const isSel = selected.has(a.id);
          return (
          <div key={a.id} style={{ position: "relative", border: `1px solid ${isSel ? "oklch(0.72 0.2 285)" : "rgba(255,255,255,0.1)"}`, borderRadius: 10, overflow: "hidden", background: "var(--c-surface, rgba(255,255,255,0.03))", boxShadow: isSel ? "0 0 0 1px oklch(0.72 0.2 285)" : "none" }}>
            {/* checkbox */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleSelect(a.id); }}
              title={isSel ? "取消选择" : "选择"}
              style={{ position: "absolute", top: 6, left: 6, zIndex: 5, width: 20, height: 20, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: isSel ? "oklch(0.72 0.2 285)" : "oklch(0 0 0 / 0.55)", color: "white", border: isSel ? "none" : "1px solid oklch(1 0 0 / 0.5)" }}
            >
              {isSel && <Check style={{ width: 13, height: 13 }} strokeWidth={3} />}
            </button>
            {/* preview (click to enlarge, or toggle while selecting) */}
            <div
              onClick={() => { if (selecting) toggleSelect(a.id); else setPreview(a); }}
              style={{ height: 110, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative", overflow: "hidden" }}
            >
              {a.type === "image" ? (
                <img src={a.url} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : a.type === "video" ? (
                <>
                  <video src={a.url} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.5)" }}>
                      <Play style={{ width: 14, height: 14, color: "white" }} fill="white" />
                    </div>
                  </div>
                </>
              ) : (
                <span style={{ fontSize: 11, color: "var(--c-t3,rgba(255,255,255,0.4))" }}>{a.type}</span>
              )}
            </div>
            <div style={{ padding: "7px 9px" }}>
              <div style={{ fontSize: 12, color: "var(--c-t1,#f0f0f4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>{a.name}</div>
              <div style={{ fontSize: 10.5, color: "var(--c-t3,rgba(255,255,255,0.4))", marginTop: 2 }}>
                u{a.userId} · {a.source === "generated" ? `生成${a.provider ? "·" + a.provider : ""}` : a.source === "external" ? "外部" : "上传"}{a.model ? ` · ${a.model}` : ""}
              </div>
              <a href={a.url} download={a.name} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                style={{ fontSize: 11, color: "oklch(0.72 0.16 240)", display: "inline-block", marginTop: 4 }}>下载</a>
            </div>
          </div>
          );
        })}
      </div>
      {preview && <AdminAssetLightbox asset={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
