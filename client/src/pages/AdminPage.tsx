import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Shield, Trash2, Plus, ToggleLeft, ToggleRight, ClipboardList, RefreshCw, HardDrive, ArrowLeft, Loader2, CheckCircle2, XCircle, DownloadCloud, RotateCw, GitCommit } from "lucide-react";
import { ComfyStressPanel } from "@/components/admin/ComfyStressPanel";

type EntryType = "ip" | "user";
type Tab = "whitelist" | "logs" | "storage" | "chat" | "comfyStress" | "system";

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
  const [, navigate] = useLocation();

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
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "0" }}>
          {([["whitelist", "白名单管理"], ["logs", "操作日志"], ["storage", "存储设置"], ["chat", "聊天管理"], ["comfyStress", "ComfyUI 压测"], ["system", "系统更新"]] as [Tab, string][]).map(([tab, label]) => (
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
        {activeTab === "logs" && <LogsPanel />}
        {activeTab === "storage" && <StoragePanel />}
        {activeTab === "chat" && <ChatAdminPanel />}
        {activeTab === "comfyStress" && <ComfyStressPanel />}
        {activeTab === "system" && <SystemUpdatePanel />}
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
  // Active probe: uploads a small object via storagePut to confirm the S3
  // pipeline really works. Without this, the admin can flip toggles to ON
  // but generated assets still come back as upstream URLs because of a
  // silent Forge config / S3 issue. Result is shown inline with the
  // failing pipeline stage so the fix is obvious.
  const testMut = trpc.admin.storage.test.useMutation();

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
                    正常（{testMut.data.ms}ms · {testMut.data.backend === "s3" ? "MinIO/S3" : "—"}）
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
            statusOn="已开启（仅在 MinIO/S3 未公网时中转）"
            statusOff="已关闭（不影响原有存储逻辑）"
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

              {available && (
                <span style={{ fontSize: 12, color: available.behind > 0 ? "oklch(0.78 0.18 60)" : "oklch(0.7 0.18 145)" }}>
                  {available.behind > 0
                    ? `有 ${available.behind} 个新提交待更新${available.latest ? `（最新：${available.latest}）` : ""}`
                    : "已是最新版本"}
                </span>
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
            <input type="number" min={1} max={512} defaultValue={s.maxFileMb} onBlur={(e) => mu.mutate({ maxFileMb: Number(e.target.value) })} style={{ width: 80, ...chatInput }} />
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
const thStyle: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left", fontWeight: 600,
  color: "var(--c-t3, rgba(255,255,255,0.5))", fontSize: 10, textTransform: "uppercase",
  letterSpacing: "0.06em", borderBottom: "1px solid var(--c-bd1)",
};

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
