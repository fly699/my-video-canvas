import { useState, useEffect, useRef, useMemo, useContext, createContext } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Shield, Trash2, Plus, ToggleLeft, ToggleRight, ClipboardList, ClipboardCheck, RefreshCw, HardDrive, ArrowLeft, Loader2, CheckCircle2, XCircle, DownloadCloud, RotateCw, RotateCcw, GitCommit, X, Check, CheckSquare, Square, Download, Play, KeyRound, Users, ScrollText, Boxes, MessageCircle, Activity, Image as ImageIcon, Wrench, Globe2, MailCheck, FileBarChart2, FileText, ExternalLink, Server as ServerIcon, BrainCircuit, Search, Send, Upload, GraduationCap, Lock, Copy, UploadCloud, type LucideIcon } from "lucide-react";
import { allTutorialImageSlugs } from "@/lib/tutorialContent";
import { ConfigChecklistPanel } from "@/components/admin/ConfigChecklistPanel";
import { ConfigBackupSection } from "@/components/admin/ConfigBackupSection";
import { ComfyServersPanel } from "@/components/admin/ComfyServersPanel";
import { ComfyStressPanel } from "@/components/admin/ComfyStressPanel";
import { ComfyOpsPanel } from "@/components/admin/ComfyOpsPanel";
import { AuroraBackground } from "@/components/AuroraBackground";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { downloadTextFile } from "@/lib/download";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ui/dialogService";
import { adminTabFromUrl, ADMIN_TAB_EVENT } from "@/lib/adminNav";
import { SelfHostedLlmSection } from "@/components/admin/SelfHostedLlmSection";
import { TranscribeEndpointSection } from "@/components/admin/TranscribeEndpointSection";
import { VoxcpmEndpointSection } from "@/components/admin/VoxcpmEndpointSection";
import { BridgeMcpSection } from "@/components/admin/BridgeMcpSection";
import { SuperAgentPermSection } from "@/components/admin/SuperAgentPermSection";
import { SystemDefaultModelsSection } from "@/components/admin/SystemDefaultModelsSection";
import { TunnelPanel } from "@/components/admin/TunnelPanel";
import { BroadcastComposer } from "@/components/chat/BroadcastComposer";
import { LLM_MODELS, IMAGE_MODELS, VIDEO_MODELS, TRANSCRIBE_MODELS, modelGroupOrder, platformBadge } from "@/lib/models";
import { useSelfHostedLlmModels } from "@/lib/useSelfHostedModels";
import { DEFAULT_TAB_ACCESS, ADMIN_LEVEL_LABELS, EDITABLE_TAB_KEYS, type TabAccess } from "@shared/adminPerms";

// 权限矩阵二维级别（{view 可见, operate 可操作}）经 Context 下发给各 Panel，
// 使 LevelGate 与各 canX 写门控在「静态地板」之上叠加站长配置的 operate（取严 max）。
const AdminMatrixContext = createContext<Record<string, TabAccess>>(DEFAULT_TAB_ACCESS);
/** 某 tab 的矩阵 operate 级别（未配置回退默认）。 */
function useTabOperate(tab: string): number {
  const acc = useContext(AdminMatrixContext);
  return acc[tab]?.operate ?? DEFAULT_TAB_ACCESS[tab]?.operate ?? 1;
}
/** 某页某写操作的生效门槛 = max(静态地板, 矩阵 operate)。矩阵只会在静态地板之上进一步收紧。 */
function useEffOperate(tab: string, staticFloor: number): number {
  return Math.max(staticFloor, useTabOperate(tab));
}

type EntryType = "ip" | "user";
type Tab = "whitelist" | "kie" | "users" | "logs" | "comfyLogs" | "llmLogs" | "perms" | "storage" | "staging" | "models" | "chat" | "comfyServers" | "comfyStress" | "comfyOps" | "assets" | "downloads" | "tutorialImgs" | "system" | "config" | "tunnel" | "auth" | "report" | "intro";

// 标签页定义：[key, 中文标签, 图标, 专属色相(oklch hue)]。
// #237 标签多了不好识别：每个标签配一个稳定的专属色相——图标常显该色、
// 激活态的边框/底色/阴影也用该色（替代原先统一紫色），颜色+图标双通道辨识。
const TAB_DEFS: [Tab, string, LucideIcon, number][] = [
  ["whitelist", "白名单管理", Shield, 150],
  ["kie", "kie.ai 密钥", KeyRound, 85],
  ["users", "用户管理", Users, 245],
  ["auth", "注册认证", MailCheck, 185],
  ["logs", "操作日志", ClipboardList, 65],
  ["comfyLogs", "ComfyUI 日志", ScrollText, 45],
  ["llmLogs", "LLM 日志", BrainCircuit, 305],
  ["storage", "存储设置", HardDrive, 215],
  ["staging", "文件暂存", UploadCloud, 175],
  ["models", "模型管理", Boxes, 285],
  ["tunnel", "公网隧道", Globe2, 165],
  ["chat", "聊天管理", MessageCircle, 350],
  ["comfyServers", "ComfyUI 服务器", ServerIcon, 265],
  ["comfyStress", "ComfyUI 压测", Activity, 25],
  ["comfyOps", "ComfyUI 运维中心", Wrench, 105],
  ["assets", "素材库(全用户)", ImageIcon, 330],
  ["downloads", "下载审批", DownloadCloud, 140],
  ["tutorialImgs", "教程截图", GraduationCap, 95],
  ["system", "系统更新", RotateCw, 15],
  ["config", "配置体检", ClipboardCheck, 125],
  ["report", "工作成果报告", FileBarChart2, 235],
  ["intro", "项目功能汇报", FileText, 200],
  ["perms", "权限管理", Lock, 0],
];

// 管理员级别 → 可执行的「写操作」最低级别（与服务端 levelProcedure 一致）：
//   L1 查看员=只读看板  ·  L2 运营=白名单/冻结/清日志/下载审批
//   L3 管理员=密钥/存储/模型/聊天治理/压测/运维  ·  L4 超管=管理员管理/系统更新/配置导出导入
// 任意管理员都可「进入查看」全部标签；下面各 Panel 用 LevelGate / canX 按级别禁用写操作。
const LEVEL_NAME: Record<number, string> = { 1: "查看员", 2: "运营", 3: "管理员", 4: "超级管理员" };

const ACTION_LABELS: Record<string, string> = {
  login_email: "邮箱登录",
  login_oauth: "OAuth 登录",
  image_gen: "图像生成",
  video_gen: "视频生成",
  audio_music: "音乐生成",
  audio_dubbing: "配音生成",
  subtitle_transcribe: "语音转录",
  superagent_comfy_build: "工程智能体·工作流",
  superagent_code_task: "工程智能体·代码任务",
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
  superagent_comfy_build: "oklch(0.68 0.19 200)",
  superagent_code_task: "oklch(0.66 0.2 285)",
};

// 「白名单管理」「下载审批」限管理员 L3+（查看员 L1、运营 L2 均无权，含查看）。
export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const myLevel = user?.adminLevel ?? 0;
  // 权限矩阵（站长在「权限管理」页配置各页最低查看级别；默认日志/聊天=L4、白名单/下载审批=L3）。
  // 服务端对日志/聊天接口同口径强制，这里只做 tab 可见性与越权兜底跳转。
  const permsQ = trpc.admin.perms.get.useQuery(undefined, { enabled: user?.role === "admin", staleTime: 30_000 });
  const tabAccess = permsQ.data?.access ?? DEFAULT_TAB_ACCESS;
  // tab 可见性按 view（可见/只读级）：达到 view 即可进入查看；页内写操作再按 operate 门控。
  const tabAllowed = (tab: Tab) => myLevel >= (tabAccess[tab]?.view ?? DEFAULT_TAB_ACCESS[tab]?.view ?? 1);
  // Initial tab comes from ?tab= so deep links (e.g. a download-approval "查看")
  // land on the right sub-page instead of the default.
  const [activeTab, setActiveTab] = useState<Tab>(() => adminTabFromUrl() as Tab);
  const [, navigate] = useLocation();

  // 越权兜底：（经深链/事件）落到无权标签时跳回第一个有权限的页，避免看到无权面板。
  useEffect(() => {
    if (!permsQ.data) return;
    if (!tabAllowed(activeTab)) {
      const first = TAB_DEFS.find(([t]) => tabAllowed(t))?.[0];
      if (first && first !== activeTab) setActiveTab(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myLevel, activeTab, permsQ.data]);

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
  // 任意管理员（L1+）都可进入所有标签页「查看」；页内的「写操作」再按级别禁用
  // （见各 Panel 的 LevelGate / canX 门控）。故此处不再按级别锁标签。
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
      <AuroraBackground />
      <div style={{ width: "100%", maxWidth: "1040px", position: "relative", zIndex: 1 }}>
        {/* Header — back button + gradient icon tile + title */}
        <div className="animate-fade-up" style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
          <button
            onClick={handleBack}
            title="返回上一页"
            style={{
              width: 34, height: 34, padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 10,
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
          <div
            style={{
              width: 38, height: 38, borderRadius: 12, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
              boxShadow: "0 4px 18px oklch(0.68 0.22 285 / 0.35)",
            }}
          >
            <Shield style={{ width: 19, height: 19, color: "#fff" }} />
          </div>
          <div>
            <h1 className="text-gradient-animated" style={{ margin: 0, fontSize: "21px", fontWeight: 700 }}>
              管理后台
            </h1>
            <p style={{ margin: 0, fontSize: "11px", color: "var(--c-t4, rgba(255,255,255,0.35))" }}>
              Admin Console · 系统管理与运维
            </p>
          </div>
        </div>

        {/* Tabs — 胶囊式（带图标） */}
        <div className="animate-fade-up" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "20px", animationDelay: "60ms" }}>
          {TAB_DEFS.filter(([tab]) => tabAllowed(tab)).map(([tab, label, Icon, hue]) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  position: "relative",
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  padding: "7px 13px",
                  borderRadius: 10,
                  border: active ? `1px solid oklch(0.68 0.20 ${hue} / 0.50)` : "1px solid var(--c-bd1, rgba(255,255,255,0.06))",
                  background: active
                    ? `linear-gradient(135deg, oklch(0.68 0.20 ${hue} / 0.20), oklch(0.60 0.18 ${hue} / 0.10))`
                    : "var(--c-surface, rgba(255,255,255,0.03))",
                  color: active ? "var(--c-t1, #f0f0f4)" : "var(--c-t3, rgba(255,255,255,0.45))",
                  fontSize: "13px",
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  boxShadow: active ? `0 2px 14px oklch(0.68 0.20 ${hue} / 0.20)` : "none",
                  transition: "all 160ms ease",
                }}
                onMouseEnter={(e) => {
                  if (activeTab === tab) return;
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "var(--c-elevated, rgba(255,255,255,0.07))";
                  el.style.color = "var(--c-t1, #f0f0f4)";
                }}
                onMouseLeave={(e) => {
                  if (activeTab === tab) return;
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "var(--c-surface, rgba(255,255,255,0.03))";
                  el.style.color = "var(--c-t3, rgba(255,255,255,0.45))";
                }}
              >
                {/* 图标常显专属色（非激活稍暗），颜色+图标双通道辨识 */}
                <Icon style={{ width: 14, height: 14, color: active ? `oklch(0.76 0.17 ${hue})` : `oklch(0.62 0.12 ${hue})` }} />
                {label}
                {tab === "system" && hasUpdate && (
                  <span style={{
                    position: "absolute", top: 5, right: 6, width: 7, height: 7, borderRadius: "50%",
                    background: "oklch(0.65 0.22 25)", boxShadow: "0 0 6px oklch(0.65 0.22 25 / 0.8)",
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* 面板：key 驱动切换入场动效；Context 下发矩阵 operate 给各 Panel 的写门控 */}
        <AdminMatrixContext.Provider value={tabAccess}>
        <div key={activeTab} className="animate-fade-up">
          {/* 单一级别面板：整面在 switch 处用 LevelGate 包裹（低于该级别 → 整面只读）。
              混合级别面板（白名单/存储/聊天/素材/下载/用户/系统）在各自 Panel 内部按操作分级门控。 */}
          {activeTab === "whitelist" && <WhitelistPanel />}
          {activeTab === "kie" && <LevelGate need={3} tab="kie"><KiePanel /></LevelGate>}
          {activeTab === "users" && <UsersPanel />}
          {activeTab === "auth" && <LevelGate need={3} tab="auth"><AuthPanel /></LevelGate>}
          {activeTab === "logs" && <div style={{ display: "flex", flexDirection: "column", gap: 16 }}><LogEmailCard /><LogsPanel /></div>}
          {activeTab === "comfyLogs" && <ComfyUsageLogsPanel />}
          {activeTab === "perms" && <PermsPanel />}
          {activeTab === "llmLogs" && <LlmLogsPanel />}
          {activeTab === "storage" && <StoragePanel />}
          {activeTab === "staging" && <StagingPanel />}
          {activeTab === "models" && <LevelGate need={3} tab="models"><ModelsHubPanel /></LevelGate>}
          {activeTab === "chat" && <ChatAdminPanel />}
          {activeTab === "comfyServers" && <LevelGate need={3} tab="comfyServers" label="只读模式 · 修改全局 ComfyUI 服务器列表需「管理员」及以上权限"><ComfyServersPanel /></LevelGate>}
          {activeTab === "comfyStress" && <LevelGate need={3} tab="comfyStress" label="只读模式 · ComfyUI 压测需「管理员」及以上权限"><ComfyStressPanel /></LevelGate>}
          {activeTab === "comfyOps" && <LevelGate need={3} tab="comfyOps" label="只读模式 · ComfyUI 运维（SSH/Docker/安装/脚本）需「管理员」及以上权限"><ComfyOpsPanel /></LevelGate>}
          {activeTab === "assets" && <AssetsAdminPanel />}
          {activeTab === "downloads" && <DownloadsAdminPanel />}
          {activeTab === "tutorialImgs" && <TutorialImagesPanel />}
          {activeTab === "system" && <SystemUpdatePanel />}
          {activeTab === "config" && <LevelGate need={3} tab="config"><div style={{ display: "flex", flexDirection: "column", gap: 16 }}><SuperAgentPermSection /><ConfigChecklistPanel /></div></LevelGate>}
          {activeTab === "tunnel" && <LevelGate need={3} tab="tunnel"><TunnelPanel /></LevelGate>}
          {activeTab === "report" && <ReportFrame src="/work-report.html" title="工作成果量化评估报告" desc="基于 Git 全量历史与会话转录的多维度量化评估（提交/工时/代码量/Token/工作量系数 + 立项初衷与对比表）" />}
          {activeTab === "intro" && <ReportFrame src="/project-report.html" title="项目功能汇报" desc="平台全功能图文汇报（含「界面实录」真实截图：系统架构 / AI 模型矩阵 / ComfyUI 算力 / 3D 导演台 / 安全防护 / 私有定制）" />}
        </div>
        </AdminMatrixContext.Provider>
      </div>
    </div>
  );
}

// 管理员级别标签（与服务端 levelProcedure 一致）。
const ADMIN_LEVELS: [number, string][] = [[0, "普通用户"], [1, "查看员"], [2, "运营"], [3, "管理员"], [4, "超级管理员"], [5, "站长"]];
const adminLevelLabel = (lv: number) => ADMIN_LEVELS.find(([n]) => n === lv)?.[1] ?? "普通用户";

/** 当前登录管理员的级别（0 普通 … 4 超管）。 */
function useMyLevel(): number {
  return useAuth().user?.adminLevel ?? 0;
}

/**
 * 只读门控容器：级别不足 `need` 时，把 children 整体设为「只读」——顶部显示一条
 * 提示条，内容区 `pointer-events:none` + 降透明度（仍可见、可滚动，但任何控件都点不动）。
 * 用于「点进去能看、不能改」的写操作区域；与服务端 levelProcedure 一一对应，是 UI 层防误触，
 * 真正的权限以后端为准。级别足够时原样渲染、零副作用。
 */
function LevelGate({ need, tab, children, label, innerStyle }: { need: number; tab?: string; children: React.ReactNode; label?: string; innerStyle?: React.CSSProperties }) {
  const lvl = useMyLevel();
  // 生效门槛 = max(静态地板 need, 该页矩阵 operate)。站长把该页 operate 调高即进一步收紧。
  const matrixOp = useTabOperate(tab ?? "");
  const effNeed = tab ? Math.max(need, matrixOp) : need;
  // 级别足够：原样渲染（fragment 不产生 DOM 节点，外层 flex gap 等布局完全不受影响）。
  if (lvl >= effNeed) return <>{children}</>;
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
        padding: "8px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 500,
        background: "oklch(0.70 0.14 65 / 0.10)", border: "1px solid oklch(0.70 0.14 65 / 0.30)",
        color: "oklch(0.82 0.13 65)",
      }}>
        <Shield style={{ width: 14, height: 14, flexShrink: 0 }} />
        {label ?? `只读模式 · 修改需「${LEVEL_NAME[effNeed] ?? `L${effNeed}`}」及以上权限`}
        <span style={{ color: "var(--c-t3, rgba(255,255,255,0.45))", fontWeight: 400 }}>（当前：{adminLevelLabel(lvl)}）</span>
      </div>
      <div style={{ pointerEvents: "none", opacity: 0.5, ...innerStyle }} aria-disabled>
        {children}
      </div>
    </div>
  );
}

// ── 用户管理 Panel（管理员）─────────────────────────────────────────────────
function UsersPanel() {
  const utils = trpc.useUtils();
  const { user: me } = useAuth();
  const { data: users, isLoading } = trpc.admin.users.list.useQuery();
  // #R5-2 用户量大时需搜索 / 状态筛选 / 分页（与同页日志面板一致）。纯客户端过滤（列表已全量拉取）。
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "pending" | "disabled" | "admin">("all");
  const [userPage, setUserPage] = useState(0);
  const USERS_PER_PAGE = 20;
  useEffect(() => { setUserPage(0); }, [userSearch, userFilter]);
  // 实时在线状态 + 今日在线时长：轮询 presence 统计，叠加到用户表。
  const { data: onlineStats } = trpc.admin.users.onlineStats.useQuery(undefined, { refetchInterval: 15000, refetchOnWindowFocus: true });
  const statMap = new Map((onlineStats ?? []).map((s) => [s.userId, s]));
  const onlineSet = new Set((onlineStats ?? []).filter((s) => s.online).map((s) => s.userId));
  const onlineCount = onlineSet.size;
  // 活跃会话（同账号多登录分列，含 IP/指纹）——可展开
  const [showSessions, setShowSessions] = useState(false);
  const { data: activeSessions } = trpc.admin.users.activeSessions.useQuery(undefined, { refetchInterval: 15000, enabled: showSessions });
  const fmtDur = (sec: number): string => {
    if (sec < 60) return `${sec}秒`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}分`;
    const h = Math.floor(m / 60);
    return `${h}时${m % 60}分`;
  };
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
  const approveMut = trpc.admin.users.setApproved.useMutation({
    onSuccess: (_r, v) => { toast.success(v.approved ? "已批准，该用户可登录" : "已驳回"); void utils.admin.users.list.invalidate(); },
    onError: (e) => toast.error("操作失败：" + e.message),
  });
  // 管理员分级：仅超级管理员(L4)可改他人级别。0=普通·1=查看员·2=运营·3=管理员·4=超管。
  const setLevelMut = trpc.admin.users.setLevel.useMutation({
    onSuccess: () => { toast.success("已更新管理员级别"); void utils.admin.users.list.invalidate(); },
    onError: (e) => toast.error("操作失败：" + e.message),
  });
  const lvl = me?.adminLevel ?? 0;
  const opUsers = useTabOperate("users"); // 站长为「用户」页设的 operate（在各静态地板之上再收紧）
  const isSuper = lvl >= Math.max(4, opUsers);   // 管理员管理=超管 L4+
  const canFreeze = lvl >= Math.max(2, opUsers); // 冻结/解冻=运营 L2+
  const canManage = lvl >= Math.max(3, opUsers); // 重置密码/删除=管理员 L3+

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
  const onSetApproved = (id: number, approved: boolean, label: string) => {
    if (!approved && !confirm(`确定驳回用户「${label}」的注册？该用户将无法登录（可稍后再批准）。`)) return;
    approveMut.mutate({ userId: id, approved });
  };
  const pendingCount = (users ?? []).filter((u) => (u as { approved?: boolean }).approved === false).length;

  // 搜索(姓名/邮箱/ID) + 状态筛选 + 分页。
  const q = userSearch.trim().toLowerCase();
  const filteredUsers = (users ?? []).filter((u) => {
    if (userFilter === "pending" && (u as { approved?: boolean }).approved !== false) return false;
    if (userFilter === "disabled" && !u.disabled) return false;
    if (userFilter === "admin" && (u.adminLevel ?? 0) < 1) return false;
    if (!q) return true;
    return (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q) || String(u.id).includes(q) || (u.openId ?? "").toLowerCase().includes(q);
  });
  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
  const clampedUserPage = Math.min(userPage, totalUserPages - 1);
  const pagedUsers = filteredUsers.slice(clampedUserPage * USERS_PER_PAGE, (clampedUserPage + 1) * USERS_PER_PAGE);
  const FILTERS: [typeof userFilter, string][] = [["all", "全部"], ["pending", "待审批"], ["disabled", "已冻结"], ["admin", "管理员"]];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1)" }}>用户管理</h3>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "oklch(0.6 0.18 155)", padding: "2px 9px", borderRadius: 99, background: "oklch(0.7 0.18 155 / 0.12)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.7 0.18 155)" }} />{onlineCount} 在线
          </span>
          {pendingCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: "oklch(0.7 0.17 60 / 0.16)", color: "oklch(0.68 0.17 60)" }}>
              {pendingCount} 个待审批
            </span>
          )}
          <button onClick={() => setShowSessions((v) => !v)} style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 99, background: showSessions ? "oklch(0.65 0.18 250 / 0.18)" : "var(--c-surface, rgba(255,255,255,0.05))", color: showSessions ? "oklch(0.68 0.16 250)" : "var(--c-t2)", border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", cursor: "pointer" }}>
            {showSessions ? "收起活跃会话" : "活跃会话 · IP/指纹"}
          </button>
        </div>
        {/* 活跃会话：同一账号在不同设备/浏览器/网络的登录分别列出，含 IP + 设备/会话指纹，
            用于溯源「同账号多人同时使用」。会话粒度 = 用户+会话指纹+设备指纹+IP 去重。 */}
        {showSessions && (
          <div style={{ marginTop: 10, border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))", borderRadius: 8, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 720 }}>
              <thead><tr style={{ background: "var(--c-surface, rgba(255,255,255,0.03))" }}>
                {["用户", "IP", "设备指纹", "会话指纹", "连接数", "上线时刻", "UA"].map((h) => <th key={h} style={{ padding: "6px 9px", textAlign: "left", color: "var(--c-t3)", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(activeSessions ?? []).length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 14, textAlign: "center", color: "var(--c-t4)" }}>暂无活跃会话（无人在线，或刚重启）</td></tr>
                ) : (activeSessions ?? []).map((s, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "6px 9px", color: "var(--c-t1)", whiteSpace: "nowrap" }}>{s.userName ?? "?"} <span style={{ color: "var(--c-t4)", fontFamily: "monospace" }}>#{s.userId}</span></td>
                    <td style={{ padding: "6px 9px", fontFamily: "monospace", color: "var(--c-t1)", whiteSpace: "nowrap" }}>{s.ip}</td>
                    <td style={{ padding: "6px 9px", fontFamily: "monospace", color: "var(--c-t2)", whiteSpace: "nowrap" }} title={s.deviceFp ?? ""}>{s.deviceFp ? s.deviceFp.slice(0, 12) : "—"}</td>
                    <td style={{ padding: "6px 9px", fontFamily: "monospace", color: "var(--c-t3)", whiteSpace: "nowrap" }}>{s.sessionFp ?? "—"}</td>
                    <td style={{ padding: "6px 9px", color: "var(--c-t3)", textAlign: "center" }}>{s.socketCount}</td>
                    <td style={{ padding: "6px 9px", color: "var(--c-t3)", whiteSpace: "nowrap" }}>{new Date(s.connectedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td style={{ padding: "6px 9px", color: "var(--c-t4)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.userAgent ?? ""}>{s.userAgent ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--c-t4)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              同一账号出现多行 = 多处登录（不同设备/浏览器/IP）。设备指纹相同但 IP/会话不同 = 同一设备多次登录；设备指纹不同 = 不同设备/人。
            </div>
          </div>
        )}
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-t2)", lineHeight: 1.5 }}>
          重置密码、冻结/解冻、删除用户。冻结的用户无法登录、现有会话立即失效。不能对自己冻结或删除。
          {isSuper
            ? "「管理员级别」列可加/降管理员并设级别（仅你这个超级管理员可改，且不能改自己）：查看员=只读看板 · 运营=白名单/冻结/清日志 · 管理员=设置/密钥/删除 · 超级管理员=管理员管理/系统更新。"
            : "「管理员级别」仅超级管理员可修改。"}
        </p>
      </div>
      {/* 搜索 + 状态筛选 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          placeholder="搜索 姓名 / 邮箱 / ID…"
          style={{ flex: "1 1 220px", minWidth: 160, fontSize: 12.5, padding: "7px 11px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }}
        />
        <div style={{ display: "flex", gap: 5 }}>
          {FILTERS.map(([v, lb]) => {
            const on = userFilter === v;
            const cnt = v === "all" ? (users?.length ?? 0) : v === "pending" ? pendingCount : v === "disabled" ? (users ?? []).filter((u) => u.disabled).length : (users ?? []).filter((u) => (u.adminLevel ?? 0) >= 1).length;
            return (
              <button key={v} onClick={() => setUserFilter(v)}
                style={{ fontSize: 12, fontWeight: on ? 700 : 600, padding: "6px 11px", borderRadius: 8, cursor: "pointer",
                  background: on ? "oklch(0.65 0.19 285 / 0.16)" : "var(--c-input)", border: `1px solid ${on ? "oklch(0.65 0.19 285 / 0.45)" : "var(--c-bd2)"}`, color: on ? "oklch(0.72 0.16 285)" : "var(--c-t3)" }}>
                {lb} {cnt}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        {isLoading ? (
          <div style={{ padding: 16, fontSize: 12, color: "var(--c-t3)" }}>加载中…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>ID</th><th style={thStyle}>在线 · 今日时长</th><th style={thStyle}>名称 / 邮箱</th><th style={thStyle}>登录方式</th>
                <th style={thStyle}>管理员级别</th><th style={thStyle}>状态</th><th style={thStyle}>最近登录</th><th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pagedUsers.map((u) => {
                const label = u.name || u.email || ("#" + u.id);
                const isSelf = u.id === me?.id;
                return (
                  <tr key={u.id} style={{ borderTop: "1px solid var(--c-bd2)", opacity: u.disabled ? 0.6 : 1 }}>
                    <td style={tdStyle}>{u.id}</td>
                    <td style={tdStyle}>
                      {(() => {
                        const on = onlineSet.has(u.id);
                        const dur = statMap.get(u.id)?.todaySeconds ?? 0;
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {on ? (
                              <span title="在线" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "oklch(0.6 0.18 155)" }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "oklch(0.7 0.18 155)", boxShadow: "0 0 0 3px oklch(0.7 0.18 155 / 0.25)" }} />在线
                              </span>
                            ) : (
                              <span title="离线" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--c-t4)" }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-t4)", opacity: 0.5 }} />离线
                              </span>
                            )}
                            <span title="今日累计在线时长" style={{ fontSize: 10.5, color: "var(--c-t4)", fontVariantNumeric: "tabular-nums" }}>
                              今日 {dur > 0 ? fmtDur(dur) : "—"}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{u.name || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--c-t3)" }}>{u.email || u.openId}</div>
                    </td>
                    <td style={tdStyle}>{u.loginMethod || "—"}</td>
                    <td style={tdStyle}>
                      {isSuper && !isSelf ? (
                        <select
                          value={u.adminLevel ?? 0}
                          onChange={(e) => setLevelMut.mutate({ userId: u.id, level: Number(e.target.value) })}
                          disabled={setLevelMut.isPending}
                          style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer" }}
                        >
                          {ADMIN_LEVELS.filter(([lv]) => lv <= (me?.adminLevel ?? 0)).map(([lv, lb]) => <option key={lv} value={lv}>{lb}</option>)}
                        </select>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
                          background: (u.adminLevel ?? 0) >= 1 ? "oklch(0.65 0.19 310 / 0.15)" : "var(--c-bd1)",
                          color: (u.adminLevel ?? 0) >= 1 ? "oklch(0.65 0.19 310)" : "var(--c-t3)" }}>
                          {adminLevelLabel(u.adminLevel ?? 0)}{isSelf && (u.adminLevel ?? 0) >= 1 ? "（你）" : ""}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {u.disabled ? (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "oklch(0.62 0.2 25 / 0.15)", color: "oklch(0.65 0.2 25)" }}>已冻结</span>
                      ) : u.approved === false ? (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "oklch(0.7 0.17 60 / 0.16)", color: "oklch(0.68 0.17 60)" }}>待审批</span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "oklch(0.72 0.18 155 / 0.15)", color: "oklch(0.6 0.18 155)" }}>正常</span>
                      )}
                    </td>
                    <td style={tdStyle}>{u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleString() : "—"}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {u.approved === false && (
                          <>
                            <button onClick={() => onSetApproved(u.id, true, label)} disabled={!canFreeze} style={{ ...btnSecondary(!canFreeze), color: !canFreeze ? "var(--c-t4)" : "oklch(0.6 0.18 155)", borderColor: !canFreeze ? undefined : "oklch(0.6 0.18 155 / 0.4)" }} title={!canFreeze ? "需「运营」及以上权限" : "批准该用户，允许登录"}>批准</button>
                            <button onClick={() => onSetApproved(u.id, false, label)} disabled={!canFreeze} style={btnSecondary(!canFreeze)} title={!canFreeze ? "需「运营」及以上权限" : "驳回该用户的注册"}>驳回</button>
                          </>
                        )}
                        <button onClick={() => onReset(u.id, label)} disabled={!u.hasPassword || !canManage} style={btnSecondary(!u.hasPassword || !canManage)} title={!canManage ? "需「管理员」及以上权限" : (u.hasPassword ? "重置该用户密码" : "非邮箱密码账号，无法重置密码")}>重置密码</button>
                        <button onClick={() => onToggleDisabled(u.id, !u.disabled, label)} disabled={isSelf || !canFreeze} style={btnSecondary(isSelf || !canFreeze)} title={!canFreeze ? "需「运营」及以上权限" : undefined}>{u.disabled ? "解冻" : "冻结"}</button>
                        <button onClick={() => onDelete(u.id, label)} disabled={isSelf || !canManage} style={{ ...btnSecondary(isSelf || !canManage), color: (isSelf || !canManage) ? "var(--c-t4)" : "oklch(0.65 0.2 25)" }} title={!canManage ? "需「管理员」及以上权限" : undefined}>删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "var(--c-t3)", padding: "20px 0" }}>{(users?.length ?? 0) === 0 ? "暂无用户" : "无匹配用户，试试调整搜索或筛选"}</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页 */}
      {!isLoading && filteredUsers.length > USERS_PER_PAGE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 12, color: "var(--c-t3)" }}>
          <button onClick={() => setUserPage((p) => Math.max(0, p - 1))} disabled={clampedUserPage === 0} style={btnSecondary(clampedUserPage === 0)}>‹ 上一页</button>
          <span>第 {clampedUserPage + 1} / {totalUserPages} 页 · 共 {filteredUsers.length} 人</span>
          <button onClick={() => setUserPage((p) => Math.min(totalUserPages - 1, p + 1))} disabled={clampedUserPage >= totalUserPages - 1} style={btnSecondary(clampedUserPage >= totalUserPages - 1)}>下一页 ›</button>
        </div>
      )}
    </div>
  );
}

// ── Whitelist Panel ───────────────────────────────────────────────────────────

// ── Storage Panel ─────────────────────────────────────────────────────────────

function AuthPanel() {
  const q = trpc.admin.auth.getSettings.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.admin.auth.setSettings.useMutation({
    onSuccess: () => { utils.admin.auth.getSettings.invalidate(); toast.success("已保存"); },
    onError: (e) => toast.error(e.message),
  });
  const importTunnel = trpc.admin.auth.importFromTunnel.useMutation({
    onSuccess: (r) => { utils.admin.auth.getSettings.invalidate(); toast.success(r.hasPass ? "已读取公网隧道的 SMTP 配置（含密码）" : "已读取公网隧道的 SMTP 配置（隧道未设密码）"); },
    onError: (e) => toast.error(e.message),
  });
  const testEmail = trpc.admin.auth.testEmail.useMutation({
    onSuccess: (r) => toast.success(`测试邮件已发送到 ${r.to}，请查收`),
    onError: (e) => toast.error("测试邮件发送失败：" + e.message),
  });
  type AuthForm = { emailVerificationEnabled: boolean; registrationApprovalEnabled: boolean; smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string; smtpPass: string; smtpFrom: string; smtpPassSet: boolean };
  const [form, setForm] = useState<AuthForm | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setForm({
      emailVerificationEnabled: q.data.emailVerificationEnabled,
      registrationApprovalEnabled: (q.data as { registrationApprovalEnabled?: boolean }).registrationApprovalEnabled ?? false,
      smtpHost: q.data.smtpHost,
      smtpPort: q.data.smtpPort, smtpSecure: q.data.smtpSecure, smtpUser: q.data.smtpUser,
      smtpPass: "", smtpFrom: q.data.smtpFrom, smtpPassSet: (q.data as { smtpPassSet?: boolean }).smtpPassSet ?? false,
    });
  }, [q.data]);

  if (!form) return <div className="text-sm" style={{ color: "var(--c-t3)" }}>加载中…</div>;
  const set = (patch: Partial<AuthForm>) => setForm((f) => f ? { ...f, ...patch } : f);
  const onSave = () => {
    const payload: Record<string, unknown> = {
      emailVerificationEnabled: form.emailVerificationEnabled, registrationApprovalEnabled: form.registrationApprovalEnabled,
      smtpHost: form.smtpHost.trim(),
      smtpPort: form.smtpPort, smtpSecure: form.smtpSecure, smtpUser: form.smtpUser.trim(), smtpFrom: form.smtpFrom.trim(),
    };
    if (form.smtpPass) payload.smtpPass = form.smtpPass; // empty = leave unchanged
    save.mutate(payload);
  };
  const field: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", fontSize: 13, outline: "none" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 500, color: "var(--c-t2)", marginBottom: 5 };

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--c-t1)" }}>注册邮箱验证</h2>
        <p className="text-xs" style={{ color: "var(--c-t3)", marginTop: 4, lineHeight: 1.6 }}>
          开启后，新用户邮箱注册时会收到 6 位验证码，验证通过才能登录。需配置可用的 SMTP 邮件服务。
          关闭则恢复为注册即登录（不影响已注册的账号）。
        </p>
      </div>

      {/* master toggle */}
      <button onClick={() => set({ emailVerificationEnabled: !form.emailVerificationEnabled })}
        className="nodrag flex items-center justify-between" style={{ ...field, cursor: "pointer", padding: "12px 14px" }}>
        <span style={{ fontWeight: 600, color: "var(--c-t1)" }}>启用注册邮箱验证</span>
        {form.emailVerificationEnabled ? <ToggleRight className="w-7 h-7" style={{ color: "oklch(0.7 0.18 145)" }} /> : <ToggleLeft className="w-7 h-7" style={{ color: "var(--c-t4)" }} />}
      </button>

      {/* 注册审批制度 */}
      <div style={{ borderTop: "1px solid var(--c-bd2)", paddingTop: 16 }}>
        <h2 className="text-base font-semibold" style={{ color: "var(--c-t1)" }}>注册需管理员审批</h2>
        <p className="text-xs" style={{ color: "var(--c-t3)", marginTop: 4, lineHeight: 1.6 }}>
          开启后，所有新注册用户（邮箱 / 第三方登录）默认为「待审批」，须管理员在「用户管理」中批准后方可登录；
          待审批用户即使已登录也无法访问任何功能。管理员账号不受影响；关闭后自动恢复正常（不影响已批准的账号）。
        </p>
      </div>
      <button onClick={() => set({ registrationApprovalEnabled: !form.registrationApprovalEnabled })}
        className="nodrag flex items-center justify-between" style={{ ...field, cursor: "pointer", padding: "12px 14px" }}>
        <span style={{ fontWeight: 600, color: "var(--c-t1)" }}>启用注册审批</span>
        {form.registrationApprovalEnabled ? <ToggleRight className="w-7 h-7" style={{ color: "oklch(0.7 0.18 145)" }} /> : <ToggleLeft className="w-7 h-7" style={{ color: "var(--c-t4)" }} />}
      </button>

      {/* SMTP config */}
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t2)" }}>SMTP 邮件服务</span>
        <button onClick={() => importTunnel.mutate()} disabled={importTunnel.isPending}
          className="nodrag flex items-center gap-1.5" title="把「公网隧道」页配置的 SMTP 账号（含密码）复制到这里，两处共用一套"
          style={{ fontSize: 12, fontWeight: 600, color: "oklch(0.74 0.16 285)", background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.35)", borderRadius: 8, padding: "6px 11px", cursor: importTunnel.isPending ? "wait" : "pointer" }}>
          {importTunnel.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe2 className="w-3.5 h-3.5" />}
          读取公网隧道的 SMTP
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>SMTP 服务器</label>
          <input style={field} value={form.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} placeholder="smtp.example.com" />
        </div>
        <div>
          <label style={lbl}>端口</label>
          <input style={field} type="number" value={form.smtpPort} onChange={(e) => set({ smtpPort: Number(e.target.value) || 587 })} placeholder="587" />
        </div>
        <div>
          <label style={lbl}>加密方式</label>
          <button onClick={() => set({ smtpSecure: !form.smtpSecure })} className="nodrag flex items-center justify-between" style={{ ...field, cursor: "pointer" }}>
            <span style={{ color: "var(--c-t2)" }}>{form.smtpSecure ? "SSL (465)" : "STARTTLS (587/25)"}</span>
            {form.smtpSecure ? <ToggleRight className="w-6 h-6" style={{ color: "oklch(0.7 0.18 145)" }} /> : <ToggleLeft className="w-6 h-6" style={{ color: "var(--c-t4)" }} />}
          </button>
        </div>
        <div>
          <label style={lbl}>用户名</label>
          <input style={field} value={form.smtpUser} onChange={(e) => set({ smtpUser: e.target.value })} placeholder="发信账号" autoComplete="off" />
        </div>
        <div>
          <label style={lbl}>密码 {form.smtpPassSet && <span style={{ color: "oklch(0.7 0.18 145)" }}>· 已设置</span>}</label>
          <input style={field} type="password" value={form.smtpPass} onChange={(e) => set({ smtpPass: e.target.value })} placeholder={form.smtpPassSet ? "（留空则不修改）" : "发信密码 / 授权码"} autoComplete="new-password" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>发件人地址（From）</label>
          <input style={field} value={form.smtpFrom} onChange={(e) => set({ smtpFrom: e.target.value })} placeholder="noreply@example.com（留空则用用户名）" />
        </div>
      </div>

      {form.emailVerificationEnabled && !form.smtpHost.trim() && (
        <div style={{ fontSize: 12, color: "oklch(0.7 0.17 60)" }}>⚠ 已启用验证但未配置 SMTP，验证码将无法发送——请先填写 SMTP 服务器。</div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={onSave} disabled={save.isPending}
          className="nodrag" style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "oklch(0.58 0.22 285 / 0.9)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: save.isPending ? "wait" : "pointer" }}>
          {save.isPending ? "保存中…" : "保存设置"}
        </button>
        {/* 发送测试邮件到当前管理员，验证 SMTP 是否可用（与存储连通性测试对齐） */}
        <button onClick={() => testEmail.mutate()} disabled={testEmail.isPending || !form.smtpHost.trim()}
          className="nodrag" title={!form.smtpHost.trim() ? "请先填写并保存 SMTP 服务器" : "发送一封测试邮件到当前管理员邮箱"}
          style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--c-bd2)", background: "transparent", color: (testEmail.isPending || !form.smtpHost.trim()) ? "var(--c-t4)" : "var(--c-t2)", fontWeight: 600, fontSize: 13, cursor: (testEmail.isPending || !form.smtpHost.trim()) ? "not-allowed" : "pointer" }}>
          {testEmail.isPending ? "发送中…" : "✉ 发送测试邮件"}
        </button>
      </div>
    </div>
  );
}

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

  // 级别门控（用页内 LevelGate 包裹实现）：存储设置/连通性测试=管理员(L3+)；
  // 配置「导出/导入」（跨部署迁移、批量覆盖）=超管(L4)。

  // Admin config export/import: the storage-settings panel + admin-managed global
  // ComfyUI servers and per-server GPU pins, as a single JSON file (backup /
  // migrate between deployments).
  const setGlobalServersMut = trpc.comfyui.setGlobalServers.useMutation();
  const setGlobalGpuMut = trpc.comfyui.setGlobalGpuIndex.useMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ioBusy, setIoBusy] = useState(false);

  const STORAGE_KEYS = [
    "persistAudio", "persistVideo", "persistImage", "presignTtlSec", "poyoUploadFallback", "uploadStagingProvider",
    "minioOnly", "preferUpstreamRefSource", "downloadAuthEnabled", "downloadAuthBypassLevel", "forceStorageRelay",
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
      {/* Config export / import — 超管(L4)专属：跨部署迁移 / 批量覆盖配置 */}
      <LevelGate need={4} tab="storage" label="配置「导出 / 导入」仅「超级管理员」(L4) 可用">
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
      </LevelGate>
      {/* 存储设置 / 连通性测试 — 管理员(L3+)可改，查看员/运营只读 */}
      <LevelGate need={3} tab="storage" innerStyle={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          {/* #234 通用暂存通道：关闭 / Poyo / Kie 按钮切换。空值=老部署未设置，按旧
              poyoUploadFallback 布尔显示；点任一按钮即写显式值（并同步旧布尔，保证降级兼容）。 */}
          {(() => {
            const explicit = (settings as { uploadStagingProvider?: string }).uploadStagingProvider ?? "";
            const chosen = explicit === "poyo" || explicit === "kie" || explicit === "off"
              ? explicit
              : settings.poyoUploadFallback ? "poyo" : "off";
            const active = (reach.data as { stagingProvider?: string } | undefined)?.stagingProvider ?? (poyoStagingActive ? "poyo" : "off");
            const pick = (v: "off" | "poyo" | "kie") =>
              setMut.mutate({ uploadStagingProvider: v, poyoUploadFallback: v === "poyo" });
            const status = chosen === "off"
              ? "已关闭（不影响原有存储逻辑）"
              : active === chosen
                ? `🟢 已生效：参考图/视频会经 ${chosen === "poyo" ? "Poyo" : "Kie"} 暂存换取公网链接（生成时后端打印 [storage] 暂存日志，系统日志可查）`
                : `⚠️ 已选择 ${chosen === "poyo" ? "Poyo" : "Kie"}，但未检测到对应 API Key（${chosen === "poyo" ? "POYO_API_KEY" : "KIE_API_KEY"}）→ 暂不生效，请在服务端配置后重启`;
            return (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
                padding: "14px 18px", background: "var(--c-surface, rgba(255,255,255,0.03))",
                border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))", borderRadius: 10,
              }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--c-t1, #f0f0f4)" }}>暂存通道（参考图/视频公网中转）</div>
                  <div style={{ fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.4))", marginTop: 3, whiteSpace: "pre-line", lineHeight: 1.6 }}>
                    {"附加功能·默认关闭：当 MinIO/S3 未暴露公网（未设 S3_PUBLIC_ENDPOINT）时，把参考图/视频经所选平台流式上传换取公网 URL 供 AI 模型读取。关闭后完全不影响原有存储逻辑。仅临时中转参考素材，不替代本地持久化存储。\n" +
                      "· Poyo（需 POYO_API_KEY）：图 JPEG/PNG/GIF/WebP 存约 72h；视频 MP4/WebM/MOV/AVI/MKV ≤100MB 存约 24h；限流 5 次/分（已自动排队错峰 + 同文件 12h 复用缓存）。\n" +
                      "· Kie（需 KIE_API_KEY）：通用文件存储，≤100MB，存 24h，免费；官方无上传限流条款 → 全并发直发（429 才自适应退避重试）+ 复用缓存。"}
                  </div>
                  <div style={{ fontSize: 11, color: chosen !== "off" && active === chosen ? "oklch(0.7 0.18 145)" : chosen === "off" ? "var(--c-t3)" : "oklch(0.72 0.16 60)", marginTop: 4, fontWeight: 600 }}>
                    状态：{status}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {([["off", "关闭"], ["poyo", "Poyo"], ["kie", "Kie"]] as const).map(([v, label]) => (
                    <button key={v} onClick={() => pick(v)} disabled={setMut.isPending}
                      style={{
                        padding: "6px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: setMut.isPending ? "wait" : "pointer",
                        background: chosen === v ? "oklch(0.55 0.16 265 / 0.25)" : "var(--c-surface)",
                        border: `1px solid ${chosen === v ? "oklch(0.62 0.18 265 / 0.6)" : "var(--c-bd2)"}`,
                        color: chosen === v ? "var(--c-t1)" : "var(--c-t2)",
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-base)", opacity: settings.downloadAuthEnabled ? 1 : 0.55 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t1)" }}>受门控的级别范围</div>
              <div style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.5, marginTop: 2 }}>
                管理级别 ≥ 所选值的用户免门控，低于此值的用户受门控（需授权）。仅在「严格下载授权」开启时生效。
              </div>
            </div>
            <select
              value={settings.downloadAuthBypassLevel ?? 1}
              disabled={setMut.isPending || !settings.downloadAuthEnabled}
              onChange={(e) => setMut.mutate({ downloadAuthBypassLevel: Number(e.target.value) })}
              style={{ flexShrink: 0, padding: "6px 8px", fontSize: 12, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 7, cursor: "pointer" }}
            >
              <option value={1}>仅普通成员受控（默认）</option>
              <option value={2}>普通成员 + L1 管理员受控</option>
              <option value={3}>普通成员 + L1/L2 受控</option>
              <option value={4}>普通成员 + L1/L2/L3 受控</option>
              <option value={5}>所有人（含最高管理员）受控</option>
            </select>
          </div>
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
      </LevelGate>
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
  {
    key: "transcribe",
    label: "字幕转录（STT）模型",
    hint: "用于 字幕/动态字幕/智能剪辑/语音输入兜底 的转录（按模型 provider 路由：Groq→GROQ_API_KEY、自建→转写端点、Forge→内置）。配置了自建端点后「自建 · …」也会出现在此可单独启停",
    accent: "oklch(0.65 0.19 310)",
    models: TRANSCRIBE_MODELS.map((m) => ({ value: m.value, label: m.label, group: m.group })),
  },
  {
    key: "chat",
    label: "聊天 AI 模型",
    hint: "用于「聊天」里内建 AI 助手的对话（独立于 LLM 节点的开关，单独控制）",
    accent: "oklch(0.70 0.18 200)",
    // 键加 "chat:" 前缀，使聊天 AI 的模型可见性与 LLM 节点分组互不影响。
    models: LLM_MODELS.filter((m) => !m.hidden).map((m) => ({ value: "chat:" + m.id, label: m.label, group: m.provider })),
  },
  {
    key: "editor",
    label: "剪辑器 AI 模型",
    hint: "用于视频剪辑器里的 AI 生成 SVG 形状（文字描述 → 矢量图形）",
    accent: "oklch(0.70 0.18 250)",
    // "editor:" 前缀，单独控制剪辑器可用模型（不影响 LLM 节点/聊天）。
    models: LLM_MODELS.filter((m) => !m.hidden).map((m) => ({ value: "editor:" + m.id, label: m.label, group: m.provider })),
  },
  {
    // #152 音频工具（人声分离/翻唱/续写/写歌词）——音频节点「工具」类别可用性开关。
    // value 即工具 id，与音频节点选择器/useDisabledModels 同键（关闭即从下拉隐藏）。
    key: "audio_tool",
    label: "音频工具",
    hint: "用于 音频 节点「工具」类别：人声分离 / 翻唱 / 续写 / 写歌词（Poyo）",
    accent: "oklch(0.70 0.16 150)",
    // 与 AudioNode 的 AUDIO_TOOL_MODELS 同键（关闭即从「工具」下拉隐藏，useDisabledModels 过滤）。
    models: [
      { value: "sep_vocals", label: "人声分离", group: "工具" },
      { value: "cover", label: "翻唱 / 转曲风", group: "工具" },
      { value: "extend", label: "音频续写", group: "工具" },
      { value: "lyrics", label: "写歌词", group: "工具" },
    ],
  },
];


// ── #203 模型技能库：独立的按模型「提示词技法」库（DB 覆盖内置种子，可随时维护）。
// 本批只建库不接智能体；未来各智能体（画布助手/扩写工具等）按需读取，另行规划。
const SKILL_KINDS = ["image", "video", "audio", "music", "llm", "other"] as const;
function ModelSkillsPanel() {
  const utils = trpc.useUtils();
  const listQ = trpc.admin.modelSkills.list.useQuery();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<null | { modelId: string; kind: string; tips: string; source: string; enabled: boolean; isNew: boolean; origin: string }>(null);
  const upsertMut = trpc.admin.modelSkills.upsert.useMutation({
    onSuccess: () => { toast.success("技能已保存"); void utils.admin.modelSkills.list.invalidate(); setEditing(null); },
    onError: (e) => toast.error("保存失败：" + e.message),
  });
  const removeMut = trpc.admin.modelSkills.remove.useMutation({
    onSuccess: () => { toast.success("已移除自定义内容（种子模型回退内置版本）"); void utils.admin.modelSkills.list.invalidate(); },
    onError: (e) => toast.error("删除失败：" + e.message),
  });
  // ── #224 批1 自动更新：本地官方参数文档提炼 → 草稿区 → 人工审核入库；提炼 LLM 可选 ──
  const draftsQ = trpc.admin.modelSkills.listDrafts.useQuery();
  const [draftTarget, setDraftTarget] = useState("");
  const [draftLlm, setDraftLlm] = useState("");
  const autoDraftMut = trpc.admin.modelSkills.autoDraft.useMutation({
    onSuccess: (r) => {
      const ok = r.results.filter((x) => x.ok).length;
      if (ok) toast.success(`已生成 ${ok} 条技法草稿，请在下方审核入库`);
      r.results.filter((x) => !x.ok).forEach((f) => toast.error(`${f.modelId}：${f.error}`));
      void utils.admin.modelSkills.listDrafts.invalidate();
    },
    onError: (e) => toast.error("提炼失败：" + e.message),
  });
  const [draftUrl, setDraftUrl] = useState("");
  const autoDraftUrlMut = trpc.admin.modelSkills.autoDraftFromUrl.useMutation({
    onSuccess: () => { toast.success("已从文档页提炼技法草稿，请在下方审核入库"); setDraftUrl(""); void utils.admin.modelSkills.listDrafts.invalidate(); },
    onError: (e) => toast.error("联网提炼失败：" + e.message),
  });
  const applyDraftMut = trpc.admin.modelSkills.applyDraft.useMutation({
    onSuccess: () => { toast.success("草稿已审核入库（技能立即生效）"); void utils.admin.modelSkills.list.invalidate(); void utils.admin.modelSkills.listDrafts.invalidate(); },
    onError: (e) => toast.error("入库失败：" + e.message),
  });
  const dismissDraftMut = trpc.admin.modelSkills.dismissDraft.useMutation({
    onSuccess: () => { toast.success("草稿已丢弃"); void utils.admin.modelSkills.listDrafts.invalidate(); },
    onError: (e) => toast.error("丢弃失败：" + e.message),
  });
  const skillIds = new Set((listQ.data ?? []).filter((r) => r.enabled && r.tips.trim()).map((r) => r.modelId));
  const missingIds = [...IMAGE_MODELS.map((m) => m.value), ...VIDEO_MODELS.filter((m) => m.value !== "mock").map((m) => m.value)]
    .filter((v) => !skillIds.has(v));
  const rows = (listQ.data ?? []).filter((r) => {
    const k = q.trim().toLowerCase();
    return !k || r.modelId.toLowerCase().includes(k) || r.tips.toLowerCase().includes(k) || r.kind.includes(k);
  });
  const originBadge = (o: string) =>
    o === "builtin" ? { label: "内置", color: "var(--c-t4)" }
    : o === "overridden" ? { label: "已覆盖", color: "oklch(0.72 0.16 60)" }
    : { label: "自定义", color: "oklch(0.72 0.2 285)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--c-t1)", margin: 0 }}>模型技能库</h3>
        <span style={{ fontSize: 11.5, color: "var(--c-t4)" }}>
          按模型维护「提示词技法」等技能文本（内置种子依官方文档整理；改动存库覆盖种子、删除即回退）。当前为独立库，各智能体的调用接入另行规划。
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索模型 id / 技法内容…"
            style={{ width: 220, padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t1)", outline: "none" }} />
          <button onClick={() => setEditing({ modelId: "", kind: "video", tips: "", source: "", enabled: true, isNew: true, origin: "custom" })}
            style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid var(--c-bd2)", background: "var(--c-elevated)", color: "var(--c-t1)", cursor: "pointer" }}>
            + 新增模型技能
          </button>
        </div>
      </div>
      {/* ── #224 批1：自动更新（本地文档提炼 → 草稿区 → 人工审核入库）── */}
      <div data-testid="skill-auto-update" style={{ padding: "10px 12px", borderRadius: 10, border: "1px dashed var(--c-bd2)", background: "var(--c-surface)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--c-t1)" }}>自动更新（本地文档提炼）</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>
            从系统内已核对官方文档的模型参数表提炼「提示词技法」→ 生成草稿 → 人工审核后才入库生效；不联网（联网搜索为批2，待网关能力验证）。
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select value={draftTarget} onChange={(e) => setDraftTarget(e.target.value)}
            style={{ ...inputStyle, width: 240, padding: "5px 8px", fontSize: 11.5 }}>
            <option value="">选择目标模型…</option>
            <optgroup label="图像模型">
              {IMAGE_MODELS.map((m) => <option key={m.value} value={m.value}>{m.value}{skillIds.has(m.value) ? "（已有技能）" : ""}</option>)}
            </optgroup>
            <optgroup label="视频模型">
              {VIDEO_MODELS.filter((m) => m.value !== "mock").map((m) => <option key={m.value} value={m.value}>{m.value}{skillIds.has(m.value) ? "（已有技能）" : ""}</option>)}
            </optgroup>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-t3)" }}>提炼模型
            <select value={draftLlm} onChange={(e) => setDraftLlm(e.target.value)}
              style={{ ...inputStyle, width: 200, padding: "5px 8px", fontSize: 11.5 }}>
              <option value="">系统默认 LLM</option>
              {LLM_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <button disabled={!draftTarget || autoDraftMut.isPending}
            onClick={() => autoDraftMut.mutate({ modelIds: [draftTarget], llmModel: draftLlm || undefined })}
            style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 700, borderRadius: 8, border: "1px solid oklch(0.72 0.2 285 / 0.5)", background: draftTarget ? "oklch(0.72 0.2 285 / 0.14)" : "var(--c-surface)", color: draftTarget ? "oklch(0.76 0.18 285)" : "var(--c-t4)", cursor: draftTarget && !autoDraftMut.isPending ? "pointer" : "not-allowed" }}>
            {autoDraftMut.isPending ? "提炼中…" : "提炼草稿"}
          </button>
          <button disabled={missingIds.length === 0 || autoDraftMut.isPending}
            title={missingIds.length ? `缺技能模型（${missingIds.length} 个）：${missingIds.slice(0, 8).join("、")}${missingIds.length > 8 ? " …" : ""}` : "全部图/视频模型均已有技能"}
            onClick={() => autoDraftMut.mutate({ modelIds: missingIds.slice(0, 8), llmModel: draftLlm || undefined })}
            style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 8, border: "1px solid var(--c-bd2)", background: "transparent", color: missingIds.length ? "var(--c-t2)" : "var(--c-t4)", cursor: missingIds.length && !autoDraftMut.isPending ? "pointer" : "not-allowed" }}>
            批量提炼缺技能模型（{Math.min(8, missingIds.length)}）
          </button>
        </div>
        {/* #224 批2：联网提炼——服务端抓取指定官方文档页正文（SSRF 防护）→ LLM 提炼 → 草稿区 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--c-t3)", flexShrink: 0 }}>联网提炼</span>
          <input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} data-testid="skill-web-url"
            placeholder="粘贴该模型的官方文档/模型页链接（https://…），服务端抓取正文后提炼"
            style={{ ...inputStyle, flex: 1, minWidth: 260, padding: "5px 8px", fontSize: 11.5 }} />
          <button disabled={!draftTarget || !/^https?:\/\//.test(draftUrl.trim()) || autoDraftUrlMut.isPending}
            title={!draftTarget ? "先在上方选择目标模型" : "抓取该链接的文档正文 → 用所选提炼模型生成技法草稿（只收录文档明确写到的内容，无关页面会被拒绝）"}
            onClick={() => {
              const kind = IMAGE_MODELS.some((m) => m.value === draftTarget) ? "image" : "video";
              autoDraftUrlMut.mutate({ modelId: draftTarget, kind, url: draftUrl.trim(), llmModel: draftLlm || undefined });
            }}
            style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 700, borderRadius: 8, flexShrink: 0, border: "1px solid oklch(0.7 0.15 200 / 0.5)", background: draftTarget && /^https?:\/\//.test(draftUrl.trim()) ? "oklch(0.7 0.15 200 / 0.14)" : "var(--c-surface)", color: draftTarget && /^https?:\/\//.test(draftUrl.trim()) ? "oklch(0.76 0.13 200)" : "var(--c-t4)", cursor: draftTarget && /^https?:\/\//.test(draftUrl.trim()) && !autoDraftUrlMut.isPending ? "pointer" : "not-allowed" }}>
            {autoDraftUrlMut.isPending ? "抓取提炼中…" : "联网提炼草稿"}
          </button>
        </div>
        {(draftsQ.data?.length ?? 0) > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "oklch(0.72 0.16 60)" }}>待审核草稿（{draftsQ.data!.length}）——入库前请核对内容，入库即生效</div>
            {draftsQ.data!.map((d) => (
              <div key={d.modelId} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 11px", borderRadius: 9, border: "1px solid oklch(0.72 0.16 60 / 0.35)", background: "oklch(0.72 0.16 60 / 0.05)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--c-t1)" }}>{d.modelId}</span>
                    <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}>{d.kind}</span>
                    <span style={{ fontSize: 10, color: d.currentTips ? "oklch(0.72 0.16 60)" : "oklch(0.7 0.17 150)" }}>
                      {d.currentTips ? `入库将覆盖现有技能（${d.currentOrigin === "builtin" ? "内置种子" : "自定义"}）` : "新增技能"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--c-t2)", marginTop: 4, whiteSpace: "pre-wrap", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }} title={d.tips}>{d.tips}</div>
                  {d.source && <div style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 3 }}>{d.source}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => applyDraftMut.mutate({ modelId: d.modelId })} disabled={applyDraftMut.isPending}
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "1px solid oklch(0.7 0.17 150 / 0.5)", background: "oklch(0.7 0.17 150 / 0.12)", color: "oklch(0.75 0.15 150)", cursor: "pointer" }}>审核入库</button>
                  <button onClick={() => dismissDraftMut.mutate({ modelId: d.modelId })} disabled={dismissDraftMut.isPending}
                    style={{ padding: "4px 12px", fontSize: 11, borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer" }}>丢弃</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {listQ.isLoading && <div style={{ fontSize: 12, color: "var(--c-t4)" }}>加载中…</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => {
          const b = originBadge(r.origin);
          return (
            <div key={r.modelId} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--c-bd1)", background: "var(--c-surface)", opacity: r.enabled ? 1 : 0.55 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="font-mono" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--c-t1)" }}>{r.modelId}</span>
                  <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}>{r.kind}</span>
                  <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, border: `1px solid ${b.color}`, color: b.color }}>{b.label}</span>
                  {!r.enabled && <span style={{ fontSize: 10, color: "oklch(0.62 0.2 25)" }}>已停用</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--c-t3)", marginTop: 4, whiteSpace: "pre-wrap", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }} title={r.tips}>{r.tips}</div>
                {r.source && <div style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 3 }}>来源：{r.source}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => setEditing({ modelId: r.modelId, kind: r.kind, tips: r.tips, source: r.source ?? "", enabled: r.enabled, isNew: false, origin: r.origin })}
                  style={{ padding: "4px 10px", fontSize: 11, borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer" }}>编辑</button>
                <button
                  onClick={() => upsertMut.mutate({ modelId: r.modelId, kind: r.kind as typeof SKILL_KINDS[number], tips: r.tips, source: r.source ?? undefined, enabled: !r.enabled })}
                  title={r.enabled ? "停用（调用方将取不到该模型技能）" : "启用"}
                  style={{ padding: "4px 10px", fontSize: 11, borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: r.enabled ? "var(--c-t3)" : "oklch(0.7 0.17 150)", cursor: "pointer" }}>
                  {r.enabled ? "停用" : "启用"}
                </button>
                {r.origin !== "builtin" && (
                  <button onClick={async () => { if (await confirmDialog({ title: `移除「${r.modelId}」的自定义内容？`, message: r.origin === "overridden" ? "该模型将回退到内置种子版本。" : "自定义模型技能将被彻底删除。", danger: true })) removeMut.mutate({ modelId: r.modelId }); }}
                    style={{ padding: "4px 10px", fontSize: 11, borderRadius: 7, border: "1px solid oklch(0.62 0.2 25 / 0.4)", background: "transparent", color: "oklch(0.68 0.18 25)", cursor: "pointer" }}>
                    {r.origin === "overridden" ? "回退内置" : "删除"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!listQ.isLoading && rows.length === 0 && <div style={{ fontSize: 12, color: "var(--c-t4)", padding: "12px 0" }}>无匹配条目</div>}
      </div>
      {editing && createPortal(
        // 必须 portal 到 body：tab 内容外层 <div className="animate-fade-up"> 的动画 transform
        // 会劫持 fixed 的包含块——弹窗看似 fixed 实则跟着列表滚动、滚轮一滚就"消失"（同素材面板旧坑）。
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.55)" }} onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 92vw)", maxHeight: "84vh", overflowY: "auto", padding: 18, borderRadius: 14, background: "var(--c-base)", border: "1px solid var(--c-bd2)", boxShadow: "0 24px 60px oklch(0 0 0 / 0.5)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)" }}>{editing.isNew ? "新增模型技能" : `编辑：${editing.modelId}`}</div>
            {editing.isNew && (
              <input value={editing.modelId} onChange={(e) => setEditing({ ...editing, modelId: e.target.value })} placeholder="模型 id（与系统内 wire id 一致，如 kie_grok_i2v / suno-v5）"
                style={{ padding: "7px 10px", fontSize: 12.5, borderRadius: 8, border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t1)", outline: "none" }} />
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11.5, color: "var(--c-t3)" }}>类别</span>
              {SKILL_KINDS.map((k) => (
                <button key={k} onClick={() => setEditing({ ...editing, kind: k })}
                  style={{ padding: "3px 10px", fontSize: 11, borderRadius: 99, border: `1px solid ${editing.kind === k ? "oklch(0.72 0.2 285)" : "var(--c-bd2)"}`, background: editing.kind === k ? "oklch(0.72 0.2 285 / 0.15)" : "transparent", color: editing.kind === k ? "oklch(0.75 0.18 285)" : "var(--c-t3)", cursor: "pointer" }}>{k}</button>
              ))}
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--c-t2)", cursor: "pointer" }}>
                <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} /> 启用
              </label>
            </div>
            <div style={{ fontSize: 11, color: "var(--c-t4)" }}>技能正文<span style={{ color: "var(--c-t3)" }}>（必填——注入给智能体的提示词技法本体，一行一条）</span></div>
            <textarea value={editing.tips} onChange={(e) => setEditing({ ...editing, tips: e.target.value })} rows={8}
              placeholder="技能正文（提示词技法等，写给「为该模型撰写提示词的人/LLM」看；一行一条更清晰）"
              style={{ padding: "9px 11px", fontSize: 12.5, lineHeight: 1.7, borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t1)", outline: "none", resize: "vertical", fontFamily: "inherit", marginTop: -4 }} />
            <div style={{ fontSize: 11, color: "var(--c-t4)" }}>来源备注<span style={{ color: "var(--c-t3)" }}>（选填——只做管理溯源，不会注入给智能体）</span></div>
            <input value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })} placeholder="来源备注（官方文档位置/链接，便于日后核对，选填）"
              style={{ padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t2)", outline: "none", marginTop: -4 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setEditing(null)} style={{ padding: "7px 14px", fontSize: 12.5, borderRadius: 8, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer" }}>取消</button>
              <button
                disabled={upsertMut.isPending || !editing.modelId.trim() || !editing.tips.trim()}
                onClick={() => upsertMut.mutate({ modelId: editing.modelId.trim(), kind: editing.kind as typeof SKILL_KINDS[number], tips: editing.tips.trim(), source: editing.source.trim() || undefined, enabled: editing.enabled })}
                style={{ padding: "7px 16px", fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: "none", background: "oklch(0.72 0.2 285)", color: "#fff", cursor: "pointer", opacity: upsertMut.isPending || !editing.modelId.trim() || !editing.tips.trim() ? 0.5 : 1 }}>
                {upsertMut.isPending ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── 「模型」页二级卡片壳：内容太多，拆成 使能开关 / 默认模型 / 端点与自建 / 技能库 四个
//    二级卡片按需渲染（记住上次停留的卡片）。
const MODELS_SUBTABS = [
  { key: "toggles", label: "使能开关", hint: "各节点模型下拉的显示/隐藏" },
  { key: "defaults", label: "默认模型", hint: "按槽位指定全站默认模型" },
  { key: "endpoints", label: "端点与自建", hint: "自建 LLM / 转写 / VoxCPM / 桥接 MCP" },
  { key: "skills", label: "技能库", hint: "按模型维护提示词技法" },
] as const;
type ModelsSubTab = (typeof MODELS_SUBTABS)[number]["key"];

function ModelsHubPanel() {
  const [sub, setSub] = useState<ModelsSubTab>(() => {
    const v = localStorage.getItem("admin:models-subtab:v1");
    return MODELS_SUBTABS.some((t) => t.key === v) ? (v as ModelsSubTab) : "toggles";
  });
  const switchTo = (k: ModelsSubTab) => {
    setSub(k);
    try { localStorage.setItem("admin:models-subtab:v1", k); } catch { /* 隐私模式等存不了就算了 */ }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        {MODELS_SUBTABS.map((t) => {
          const active = sub === t.key;
          return (
            <button key={t.key} onClick={() => switchTo(t.key)} style={{
              textAlign: "left", padding: "10px 14px", borderRadius: 12, cursor: "pointer",
              border: `1px solid ${active ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 55%, transparent)" : "var(--c-bd1)"}`,
              background: active ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 12%, var(--c-surface))" : "var(--c-surface)",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: active ? "var(--c-t1)" : "var(--c-t2)" }}>{t.label}</div>
              <div style={{ fontSize: 10.5, color: "var(--c-t4)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.hint}</div>
            </button>
          );
        })}
      </div>
      {sub === "toggles" && <ModelsPanel />}
      {sub === "defaults" && <SystemDefaultModelsSection />}
      {sub === "endpoints" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 自建 LLM 配置（粘贴 curl 登记 OpenAI 兼容端点） */}
          <SelfHostedLlmSection />
          {/* 语音/转写端点配置（whisper：自建/Forge/OpenAI，作用于语音输入兜底 + 字幕/智能剪辑转写） */}
          <TranscribeEndpointSection />
          {/* 本地 VoxCPM（Gradio TTS）全站默认地址：音频节点未填地址时的兜底（DB 优先 + env 兜底） */}
          <VoxcpmEndpointSection />
          {/* 桥接 MCP 配置（贴 mcpServers JSON → 保存即生效，让本机 Claude 桥接能调 ComfyUI 等 MCP） */}
          <BridgeMcpSection />
        </div>
      )}
      {sub === "skills" && <ModelSkillsPanel />}
    </div>
  );
}

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

  // 把管理员配置的自建 LLM 动态注入到「对话/推理 LLM」「聊天 AI」「剪辑器 AI」三类网格里
  // （图像/视频/转录不适用）。各类用各自的 value 前缀，与对应节点的门控键一致：
  // llm=裸 id（AI对话/脚本/Agent）、chat:=聊天助手、editor:=剪辑器。这样自建模型在模型管理里
  // 可见、可单独启用/禁用，与内置模型行为一致。
  const selfHosted = useSelfHostedLlmModels();
  // 自建转写端点（provider 路由后置顶其 model）——与画布/后台转写选择器 useTranscribeModels 同源同键，
  // 让后台「字幕转录(STT)」使能开关也能列出/单独启停自建模型（此前只列静态 Groq+Forge，自建缺席）。
  const transcribeProviders = trpc.config.transcribeProviders.useQuery(undefined, { staleTime: 60_000 });
  const categories = useMemo(() => {
    const prefixByCat: Record<string, string> = { llm: "", chat: "chat:", editor: "editor:" };
    const tp = transcribeProviders.data;
    const selfTranscribe = tp?.self.configured && tp.self.model.trim() ? tp.self.model.trim() : "";
    let cats = MODEL_CATEGORIES;
    // 1) 自建 LLM 注入「对话/推理」「聊天 AI」「剪辑器 AI」（各用 value 前缀，与门控键一致）。
    if (selfHosted.length) {
      cats = cats.map((cat) => {
        const prefix = prefixByCat[cat.key];
        if (prefix === undefined) return cat;
        const injected: ModelCatItem[] = selfHosted
          .filter((s) => !cat.models.some((m) => m.value === prefix + s.id))
          .map((s) => ({ value: prefix + s.id, label: s.label, group: "SelfHosted" }));
        return injected.length ? { ...cat, models: [...injected, ...cat.models] } : cat;
      });
    }
    // 2) 自建转写模型注入「字幕转录(STT)」——value=裸 model id，与 useTranscribeModels/disabledModels 同键。
    if (selfTranscribe) {
      cats = cats.map((cat) => {
        if (cat.key !== "transcribe" || cat.models.some((m) => m.value === selfTranscribe)) return cat;
        return { ...cat, models: [{ value: selfTranscribe, label: `自建 · ${selfTranscribe}`, group: "SelfHosted" }, ...cat.models] };
      });
    }
    return cats;
  }, [selfHosted, transcribeProviders.data]);
  const allValues = useMemo(() => categories.flatMap((c) => c.models.map((m) => m.value)), [categories]);
  const enabledCount = allValues.filter((v) => !disabled.has(v)).length;

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
        修改即时保存、对所有用户生效（约 30 秒内）。当前已启用 <strong style={{ color: "var(--c-t1)" }}>{enabledCount}</strong> / {allValues.length} 个模型。
        {query.isLoading && <span style={{ color: "var(--c-t3)" }}>（加载中…）</span>}
      </div>

      {categories.map((cat) => {
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
  // 运行进程版本 vs 磁盘 HEAD：stale=磁盘已更新但进程没重启，需重启才生效（自愈加固）。
  const rvdQuery = trpc.admin.update.runningVsDisk.useQuery(undefined, { refetchOnWindowFocus: true, refetchInterval: 60_000 });
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
  const canEdit = useMyLevel() >= useEffOperate("system", 4); // 检查更新 / 立即更新 / 重启服务 = 超管(L4) 独占
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

            {/* 陈旧态告警：磁盘已比运行进程新（之前拉了代码没重启）→ 提示重启才生效 */}
            {rvdQuery.data?.stale && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 12px", borderRadius: 8, fontSize: 12.5, lineHeight: 1.55, background: "oklch(0.70 0.16 60 / 0.10)", border: "1px solid oklch(0.70 0.16 60 / 0.35)", color: "oklch(0.80 0.15 60)" }}>
                <RotateCw style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} />
                <span>
                  磁盘代码已更新，但<b>运行中的进程仍是旧版</b>——之前拉取后未重启。
                  运行 <code style={{ background: "var(--c-surface)", padding: "0 5px", borderRadius: 4 }}>{rvdQuery.data.running.slice(0, 7)}</code> ·
                  磁盘 <code style={{ background: "var(--c-surface)", padding: "0 5px", borderRadius: 4 }}>{rvdQuery.data.disk.slice(0, 7)}</code>。
                  点「重启服务」或「立即更新」即可加载新版本。
                </span>
              </div>
            )}

            {/* 操作按钮 */}
            {!canEdit && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 500, background: "oklch(0.70 0.14 65 / 0.10)", border: "1px solid oklch(0.70 0.14 65 / 0.30)", color: "oklch(0.82 0.13 65)" }}>
                <Shield style={{ width: 14, height: 14, flexShrink: 0 }} />
                只读模式 · 检查更新 / 立即更新 / 重启服务仅「超级管理员」(L4) 可操作
              </div>
            )}
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => checkMut.mutate()}
                disabled={checkMut.isPending || running || !canEdit}
                style={btnSecondary(checkMut.isPending || running || !canEdit)}
              >
                {checkMut.isPending
                  ? <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />
                  : <RefreshCw style={{ width: 12, height: 12 }} />}
                检查更新
              </button>

              <button
                onClick={handleRun}
                disabled={running || !canEdit}
                style={btnPrimary(running || !canEdit)}
              >
                {running
                  ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                  : <RotateCw style={{ width: 13, height: 13 }} />}
                {running ? "更新中…" : "立即更新"}
              </button>

              <button
                onClick={handleRestart}
                disabled={running || restartMut.isPending || !canEdit}
                style={btnSecondary(running || restartMut.isPending || !canEdit)}
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

      {/* #75 全量配置导入/导出（站长 L5，服务端 ownerProc 硬门控） */}
      <ConfigBackupSection />
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

// 内嵌报告页：把自包含的静态汇报 HTML 以 iframe 形式嵌入后台「单独页面」。
function ReportFrame({ src, title, desc }: { src: string; title: string; desc: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 800 }}>{title}</h2>
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", marginTop: 4, maxWidth: 760, lineHeight: 1.6 }}>{desc}</p>
        </div>
        <a href={src} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "inherit" }}>
          <ExternalLink style={{ width: 14, height: 14 }} /> 在新标签打开
        </a>
      </div>
      <iframe src={src} title={title}
        style={{ width: "100%", height: "calc(100vh - 232px)", minHeight: 560, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, background: "#fff", display: "block" }} />
    </div>
  );
}

function WhitelistPanel() {
  const canSettings = (useAuth().user?.adminLevel ?? 0) >= useEffOperate("whitelist", 3); // 旁路/启用开关=管理员 L3+（白名单条目增删=运营 L2，由标签页门控）
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
          disabled={setEnabledMut.isPending || !canSettings}
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
          disabled={setComfyuiBypassMut.isPending || !canSettings}
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
          disabled={setLlmBypassMut.isPending || !canSettings}
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

      {/* 白名单条目「添加 / 删除」= 运营(L2+)；查看员(L1) 只读 */}
      <LevelGate need={2} tab="whitelist" label="白名单条目「添加 / 删除」需「运营」(L2) 及以上权限">
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
      </LevelGate>
    </>
  );
}

// ── Logs Panel ────────────────────────────────────────────────────────────────

type AuditAction = "login_email" | "login_oauth" | "image_gen" | "video_gen" | "audio_music" | "audio_dubbing" | "subtitle_transcribe" | "superagent_comfy_build" | "superagent_code_task" | "kie_gen";

function LogsPanel() {
  const canClear = (useAuth().user?.adminLevel ?? 0) >= useEffOperate("logs", 2); // 清空日志=运营 L2+
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

  // 导出 CSV：按当前筛选条件分页拉全量（1000/页，上限 2 万条），带 BOM 供 Excel 直开。
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all: NonNullable<typeof logsQuery.data>["rows"] = [];
      const PAGE = 1000, CAP = 20000;
      for (let off = 0; ; off += PAGE) {
        const d = await utils.admin.logs.list.fetch({ limit: PAGE, offset: off, action: actionFilter || undefined, user: userFilter || undefined });
        all.push(...d.rows);
        if (d.rows.length < PAGE || all.length >= Math.min(d.total, CAP)) break;
      }
      // 防 CSV 公式注入：用户可控内容（提示词等）以 =+-@ 开头时加 ' 前缀，避免 Excel 当公式执行。
      const esc = (v: unknown) => {
        let s = v == null ? "" : String(v);
        if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["时间", "用户ID", "用户名", "邮箱", "IP", "国家", "城市", "设备指纹", "会话指纹", "UA", "操作类型", "是否成功", "预估点数", "详情JSON"];
      const lines = all.map((r) => {
        const d = r.detail as Record<string, unknown> | null;
        const rr = r as typeof r & { deviceFp?: string | null; sessionFp?: string | null; userAgent?: string | null };
        return [
          new Date(r.createdAt).toLocaleString("zh-CN"),
          r.userId ?? "", r.userName ?? "", r.userEmail ?? "", r.ip,
          r.country ?? "", r.city ?? "",
          rr.deviceFp ?? "", rr.sessionFp ?? "", rr.userAgent ?? "",
          ACTION_LABELS[r.action] ?? r.action,
          typeof d?.success === "boolean" ? (d.success ? "成功" : "失败") : "",
          d?.estimatedCost ?? "",
          d ? JSON.stringify(d) : "",
        ].map(esc).join(",");
      });
      downloadTextFile(
        `操作日志-${new Date().toISOString().slice(0, 10)}.csv`,
        "\uFEFF" + [header.join(","), ...lines].join("\n"),
        "text/csv;charset=utf-8",
      );
      toast.success(`已导出 ${all.length} 条日志`);
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

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
          <button onClick={() => void exportCsv()} disabled={exporting} style={iconBtn} title="按当前筛选导出全部日志为 CSV（Excel 可直接打开）">
            {exporting ? <Loader2 className="animate-spin" style={{ width: "14px", height: "14px" }} /> : <Download style={{ width: "14px", height: "14px" }} />}
          </button>
          <button
            onClick={() => { if (confirm("确定清空全部日志？此操作不可撤销。")) clearMut.mutate(); }}
            disabled={clearMut.isPending || !canClear}
            style={{ ...iconBtn, color: "#f87171", borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)", opacity: canClear ? 1 : 0.4, cursor: canClear ? "pointer" : "not-allowed" }}
            title={canClear ? "清空日志" : "需「运营」及以上权限"}
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
                {["时间", "用户", "IP 地址", "设备指纹", "地区", "操作类型", "详情"].map((h) => (
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
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "11px", color: "var(--c-t2, rgba(255,255,255,0.5))" }}
                      title={`设备指纹：${log.deviceFp ?? "—"}\n会话指纹：${log.sessionFp ?? "—"}\nUA：${log.userAgent ?? "—"}`}>
                      {log.deviceFp ? String(log.deviceFp).slice(0, 10) : "—"}
                      {log.sessionFp && <div style={{ fontSize: "10px", color: "var(--c-t2, rgba(255,255,255,0.3))" }}>会话 {String(log.sessionFp).slice(0, 8)}</div>}
                    </td>
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
  // 生成成败 + 预估点数放最前（计费审计的核心字段）。
  if (typeof detail.success === "boolean") parts.push(detail.success ? "✓ 成功" : "✗ 失败");
  if (detail.estimatedCost) parts.push(`预估 ${detail.estimatedCost}`);
  if (detail.phase === "result") parts.push("生成结果");
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
  if (detail.error) parts.push(`错误：${String(detail.error).slice(0, 60)}`);
  if (parts.length === 0) return <span>{JSON.stringify(detail).slice(0, 80)}</span>;
  return <span title={parts.join(" | ")}>{parts.slice(0, 3).join(" | ")}{parts.length > 3 ? " …" : ""}</span>;
}

// ── ComfyUI usage logs (per-user / per-server, detailed) ─────────────────────
function ComfyUsageLogsPanel() {
  const canClear = (useAuth().user?.adminLevel ?? 0) >= useEffOperate("comfyLogs", 2); // 清空=运营 L2+
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

  // 导出 CSV：按当前筛选条件分页拉全量（1000/页，上限 2 万条），带 BOM 供 Excel 直开。
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all: Array<Record<string, unknown>> = [];
      const PAGE = 1000, CAP = 20000;
      for (let off = 0; ; off += PAGE) {
        const d = await utils.admin.comfyLogs.list.fetch({ limit: PAGE, offset: off, status: statusFilter || undefined, host: hostFilter || undefined, sinceMs });
        all.push(...(d.rows as Array<Record<string, unknown>>));
        if (d.rows.length < PAGE || all.length >= Math.min(d.total, CAP)) break;
      }
      // 防 CSV 公式注入：用户可控内容（提示词等）以 =+-@ 开头时加 ' 前缀，避免 Excel 当公式执行。
      const esc = (v: unknown) => {
        let s = v == null ? "" : String(v);
        if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["时间", "用户ID", "用户名", "邮箱", "IP", "操作", "服务器", "模型", "状态", "耗时(秒)", "结果数", "错误", "详情JSON"];
      const lines = all.map((r) => [
        new Date(r.createdAt as string).toLocaleString("zh-CN"),
        r.userId ?? "", r.userName ?? "", r.userEmail ?? "", r.ip ?? "",
        r.action ?? "", r.host ?? "", r.model ?? "",
        r.status === "success" ? "成功" : "失败",
        r.durationMs != null ? (Number(r.durationMs) / 1000).toFixed(1) : "",
        r.resultCount ?? "",
        r.errorMessage ?? "",
        r.detail ? JSON.stringify(r.detail) : "",
      ].map(esc).join(","));
      downloadTextFile(
        `ComfyUI日志-${new Date().toISOString().slice(0, 10)}.csv`,
        "\uFEFF" + [header.join(","), ...lines].join("\n"),
        "text/csv;charset=utf-8",
      );
      toast.success(`已导出 ${all.length} 条日志`);
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

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
          <button onClick={() => void exportCsv()} disabled={exporting} style={iconBtn} title="按当前筛选导出全部日志为 CSV（Excel 可直接打开）">
            {exporting ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <Download style={{ width: 14, height: 14 }} />}
          </button>
          <button onClick={() => { if (confirm("确定清空全部 ComfyUI 使用日志？")) clearMut.mutate(); }} disabled={clearMut.isPending || !canClear} style={{ ...iconBtn, color: "#f87171", borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)", opacity: canClear ? 1 : 0.4, cursor: canClear ? "pointer" : "not-allowed" }} title={canClear ? "清空" : "需「运营」及以上权限"}><Trash2 style={{ width: 14, height: 14 }} /></button>
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




// ── 权限管理（站长 L5 独占）────────────────────────────────────────────────────
// 配置各后台页面的最低可见/可查级别。日志三页 + 聊天管理默认 L4；服务端对这些页面的
// 接口按同一矩阵强制（改矩阵 30 秒内全局生效）。「权限管理」页自身恒 L5 不可下放。
// ── #238 文件暂存：上传 → Poyo/Kie 暂存 → 公网直链一键复制 ──────────────────
// 面板任意管理员可见（矩阵 view）；上传写操作静态地板 L2 运营 + 矩阵 operate 取严。
// 链接为公网可访问的临时直链（Poyo 图~72h/视频24h；Kie 24h 自动删除）——UI 明示勿传敏感文件。
const STAGING_PROVIDERS: {
  id: "poyo" | "kie"; name: string; hue: number;
  limits: string[];
}[] = [
  {
    id: "poyo", name: "Poyo", hue: 210,
    limits: [
      "类型：图片 JPEG/PNG/GIF/WebP；视频 MP4/WebM/MOV/AVI/MKV（其它类型不支持）",
      "大小：视频 ≤100MB（图片官方未标上限）",
      "频率：5 次/分/Key（超出服务端自动排队错峰）",
      "保存：图片约 72 小时 / 视频约 24 小时后自动删除",
    ],
  },
  {
    id: "kie", name: "Kie", hue: 85,
    limits: [
      "类型：任意文件类型（图 / 视频 / 音频 / 文档均可）",
      "大小：单文件 ≤100MB",
      "频率：官方无频率条款（全并发直发，真 429 自动退避重试）",
      "保存：24 小时后自动删除；上传免费",
    ],
  },
];
// #239 原生二进制直传（/api/admin/staging-upload，json 中间件之前注册的 Express 路由）：
// 不经 base64/JSON 限额，单文件上限直接对齐两家服务商的 100MB。
const STAGING_MAX_BYTES = 100 * 1024 * 1024;
const fmtBytes = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

function StagingPanel() {
  const { user } = useAuth();
  const myLevel = user?.adminLevel ?? 0;
  const effOp = useEffOperate("staging", 2); // 静态地板 L2（运营）+ 矩阵 operate 取严
  const canUpload = myLevel >= effOp;
  const infoQ = trpc.admin.staging.info.useQuery();
  const [provider, setProvider] = useState<"poyo" | "kie" | null>(null);
  const [busyName, setBusyName] = useState("");
  const [results, setResults] = useState<{ url: string; name: string; bytes: number; provider: string; at: number }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasKey = (p: "poyo" | "kie") => (p === "poyo" ? !!infoQ.data?.hasPoyoKey : !!infoQ.data?.hasKieKey);
  // 默认选中：参考图暂存通道当前生效的 provider；无则选有 Key 的一个。
  const chosen: "poyo" | "kie" | null = provider
    ?? (infoQ.data ? (infoQ.data.activeProvider === "poyo" || infoQ.data.activeProvider === "kie"
      ? infoQ.data.activeProvider
      : infoQ.data.hasKieKey ? "kie" : infoQ.data.hasPoyoKey ? "poyo" : null) : null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !chosen) return;
    if (!canUpload) { toast.error(`上传需 L${effOp} 及以上权限（当前 L${myLevel}）`); return; }
    for (const f of Array.from(files)) {
      if (f.size > STAGING_MAX_BYTES) { toast.error(`「${f.name}」超过 100MB 上限（两家服务商单文件上限均为 100MB）`); continue; }
      setBusyName(f.name);
      try {
        // #239 原生二进制直传：fetch body 直接传 File（不经 base64/JSON），上限 100MB。
        const resp = await fetch(
          `/api/admin/staging-upload?provider=${chosen}&fileName=${encodeURIComponent(f.name)}`,
          { method: "POST", body: f, headers: { "content-type": f.type || "application/octet-stream" }, credentials: "include" },
        );
        const out = await resp.json().catch(() => null) as { ok?: boolean; url?: string; error?: string } | null;
        if (!resp.ok || !out?.ok || !out.url) throw new Error(out?.error || `HTTP ${resp.status}`);
        setResults((p) => [{ url: out.url!, name: f.name, bytes: f.size, provider: chosen, at: Date.now() }, ...p].slice(0, 50));
        toast.success(`「${f.name}」已暂存到 ${chosen === "poyo" ? "Poyo" : "Kie"}，链接已生成`);
      } catch (err) {
        toast.error(`「${f.name}」暂存失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyName("");
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const copyUrl = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("链接已复制"); }
    catch {
      // clipboard API 不可用（非 https 等）：回退 execCommand
      const ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast.success("链接已复制"); } catch { toast.error("复制失败，请手动选择复制"); }
      ta.remove();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <UploadCloud style={{ width: 16, height: 16, color: "oklch(0.72 0.15 175)" }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1)" }}>文件暂存 · 换取公网直链</h3>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--c-t3)", lineHeight: 1.6 }}>
          上传文件暂存到 Poyo / Kie 存储，返回<b>公网可直接访问的临时链接</b>（一键复制，可喂给 AI 模型或临时外发）。
          原生二进制直传，单文件 ≤100MB（对齐两家服务商上限）。
          <b style={{ color: "oklch(0.72 0.17 60)" }}>链接公开可访问且不可提前撤销，请勿上传敏感文件。</b>
          {" "}上传需 <b>L{effOp}</b> 及以上（当前 L{myLevel}{canUpload ? "，可上传" : "，仅可查看"}）；每次上传记入操作日志。
        </p>
        {/* provider 选择卡（含限制说明与 Key 状态） */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, marginBottom: 12 }}>
          {STAGING_PROVIDERS.map((p) => {
            const on = chosen === p.id;
            const keyed = hasKey(p.id);
            return (
              <button key={p.id} onClick={() => setProvider(p.id)} disabled={!keyed}
                style={{
                  textAlign: "left", padding: "10px 13px", borderRadius: 10, cursor: keyed ? "pointer" : "not-allowed",
                  border: `1px solid ${on ? `oklch(0.68 0.18 ${p.hue} / 0.55)` : "var(--c-bd1, rgba(255,255,255,0.07))"}`,
                  background: on ? `oklch(0.68 0.18 ${p.hue} / 0.10)` : "var(--c-surface, rgba(255,255,255,0.03))",
                  opacity: keyed ? 1 : 0.55,
                }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: on ? `oklch(0.78 0.15 ${p.hue})` : "var(--c-t1)" }}>
                    {on ? "● " : "○ "}{p.name} 暂存
                    {infoQ.data?.activeProvider === p.id && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--c-t4)" }}>（参考图暂存当前通道）</span>}
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: keyed ? "oklch(0.72 0.17 150)" : "oklch(0.7 0.19 25)" }}>
                    {keyed ? "Key 已配置" : "未配置 Key"}
                  </span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.7, color: "var(--c-t3)" }}>
                  {p.limits.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </button>
            );
          })}
        </div>
        {/* 上传按钮 */}
        <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => onFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={!chosen || !!busyName || !canUpload}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 20px", borderRadius: 9, fontSize: 13, fontWeight: 700,
            border: "1px solid oklch(0.68 0.15 175 / 0.5)",
            background: (!chosen || !canUpload) ? "var(--c-surface)" : "oklch(0.68 0.15 175 / 0.14)",
            color: (!chosen || !canUpload) ? "var(--c-t4)" : "oklch(0.78 0.13 175)",
            cursor: (!chosen || !!busyName || !canUpload) ? "not-allowed" : "pointer",
          }}>
          {busyName ? <><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> 上传中：{busyName}</>
            : <><Upload style={{ width: 14, height: 14 }} /> 选择文件上传{chosen ? `到 ${chosen === "poyo" ? "Poyo" : "Kie"}` : ""}（可多选）</>}
        </button>
        {!canUpload && <span style={{ marginLeft: 10, fontSize: 11.5, color: "oklch(0.72 0.17 60)" }}>只读模式 · 上传需 L{effOp} 及以上权限</span>}
      </div>

      {/* 结果列表（本次会话内，最多留 50 条） */}
      {results.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600, color: "var(--c-t1)" }}>已暂存链接（本次会话 · {results.length} 条）</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {results.map((r) => (
              <div key={r.url + r.at} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--c-bd1, rgba(255,255,255,0.07))", background: "var(--c-surface, rgba(255,255,255,0.03))" }}>
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: r.provider === "poyo" ? "oklch(0.68 0.18 210 / 0.18)" : "oklch(0.68 0.18 85 / 0.18)", color: r.provider === "poyo" ? "oklch(0.78 0.14 210)" : "oklch(0.78 0.14 85)" }}>
                  {r.provider === "poyo" ? "Poyo" : "Kie"}
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, color: "var(--c-t2)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</span>
                <span style={{ flexShrink: 0, fontSize: 10.5, color: "var(--c-t4)" }}>{fmtBytes(r.bytes)}</span>
                <a href={r.url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.url}>{r.url}</a>
                <button onClick={() => copyUrl(r.url)} data-testid="staging-copy-btn"
                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, border: "1px solid oklch(0.68 0.15 175 / 0.45)", background: "oklch(0.68 0.15 175 / 0.12)", color: "oklch(0.78 0.13 175)", cursor: "pointer" }}>
                  <Copy style={{ width: 12, height: 12 }} /> 复制
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PermsPanel() {
  const utils = trpc.useUtils();
  const q = trpc.admin.perms.get.useQuery();
  const mu = trpc.admin.perms.set.useMutation({
    onSuccess: () => { utils.admin.perms.get.invalidate(); toast.success("权限矩阵已保存（30 秒内全局生效）"); setDirty({}); },
    onError: (e) => toast.error("保存失败：" + e.message),
  });
  const [dirty, setDirty] = useState<Record<string, TabAccess>>({});
  const access = q.data?.access;
  if (!access) return <div style={cardStyle}><p style={{ color: "var(--c-t3)", fontSize: 13, margin: 0 }}>加载中…</p></div>;
  const base = (tab: string): TabAccess => access[tab] ?? DEFAULT_TAB_ACCESS[tab] ?? { view: 1, operate: 1 };
  const cur = (tab: string): TabAccess => dirty[tab] ?? base(tab);
  const tabLabel = (tab: string) => TAB_DEFS.find(([t]) => t === tab)?.[1] ?? tab;
  const isDirty = (tab: string) => { const c = cur(tab), b = base(tab); return c.view !== b.view || c.operate !== b.operate; };
  const changed = EDITABLE_TAB_KEYS.some(isDirty);
  // 改 view：不得高于 operate（否则联动抬高 operate）；改 operate：不得低于 view（否则联动压低 view）。
  const setView = (tab: string, v: number) => setDirty((d) => { const c = cur(tab); return { ...d, [tab]: { view: v, operate: Math.max(v, c.operate) } }; });
  const setOperate = (tab: string, o: number) => setDirty((d) => { const c = cur(tab); return { ...d, [tab]: { view: Math.min(o, c.view), operate: o } }; });
  const save = () => {
    const merged: Record<string, TabAccess> = {};
    for (const k of EDITABLE_TAB_KEYS) merged[k] = cur(k);
    mu.mutate({ access: merged });
  };
  const groups: [string, string[]][] = [
    ["日志与审计", ["logs", "comfyLogs", "llmLogs"]],
    ["聊天与用户", ["chat", "users", "auth", "whitelist", "downloads"]],
    ["资源与模型", ["assets", "storage", "staging", "models", "kie"]],
    ["ComfyUI", ["comfyServers", "comfyStress", "comfyOps"]],
    ["系统", ["tunnel", "system", "config", "report", "intro"]],
  ];
  const levelOpts = ADMIN_LEVEL_LABELS.filter(([lv]) => lv >= 1);
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Shield style={{ width: 16, height: 16, color: "oklch(0.72 0.19 25)" }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1)" }}>权限管理（站长）</h3>
        </div>
        <button onClick={save} disabled={!changed || mu.isPending}
          style={{ padding: "8px 18px", borderRadius: 9, border: "1px solid oklch(0.72 0.19 25 / 0.5)", background: changed ? "oklch(0.72 0.19 25 / 0.14)" : "var(--c-surface)", color: changed ? "oklch(0.75 0.17 25)" : "var(--c-t4)", fontWeight: 700, fontSize: 13, cursor: changed ? "pointer" : "not-allowed" }}>
          {mu.isPending ? "保存中…" : "保存权限矩阵"}
        </button>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--c-t3)", lineHeight: 1.6 }}>
        为每个后台页面分别设置<b>可见级</b>（达到即可进入查看，门控读接口）与<b>可操作级</b>（达到才能写操作，门控写接口）。
        级别 1=查看员 · 2=运营 · 3=管理员 · 4=超级管理员 · 5=站长。把「可见级」设得比「可操作级」低，即让该区间的管理员<b>可见但只读</b>。
        服务端对所有后台接口按此矩阵强制（读→可见级、写→可操作级），非仅前端隐藏。
        注意：敏感写操作（改密/封禁/删数据/管理员管理/系统更新等）另有各自的<b>固定安全地板</b>，矩阵只在其上进一步收紧、不会把它们降级。
        「权限管理」页自身恒为站长专属，不可下放。
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {groups.map(([g, tabs]) => (
          <div key={g}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>{g}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
              {tabs.map((tab) => {
                const c = cur(tab);
                return (
                <div key={tab} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 11px", borderRadius: 9, border: `1px solid ${isDirty(tab) ? "oklch(0.72 0.19 25 / 0.55)" : "var(--c-bd1, rgba(255,255,255,0.07))"}`, background: "var(--c-surface, rgba(255,255,255,0.03))" }}>
                  <span style={{ fontSize: 13, color: "var(--c-t1)", flexShrink: 0 }}>{tabLabel(tab)}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--c-t3)" }}>可见
                      <select value={c.view} onChange={(e) => setView(tab, Number(e.target.value))}
                        style={{ ...inputStyle, width: "auto", padding: "3px 5px", fontSize: 11.5 }}>
                        {levelOpts.map(([lv, lb]) => <option key={lv} value={lv}>L{lv} {lb}</option>)}
                      </select>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--c-t3)" }}>可操作
                      <select value={c.operate} onChange={(e) => setOperate(tab, Number(e.target.value))}
                        style={{ ...inputStyle, width: "auto", padding: "3px 5px", fontSize: 11.5 }}>
                        {levelOpts.map(([lv, lb]) => <option key={lv} value={lv}>L{lv} {lb}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── 日志加密打包邮送设置 ────────────────────────────────────────────────────────
// 三类行为日志（操作/LLM/ComfyUI）按配置定时打包成 AES-256 加密 zip，经「注册认证」页
// 的 SMTP 发送到多个收件邮箱。调度粒度：每 N 小时 / 每日 / 每周 / 每月（服务端 5 分钟 tick）。
function LogEmailCard() {
  const utils = trpc.useUtils();
  const q = trpc.admin.logEmail.getSettings.useQuery();
  const mu = trpc.admin.logEmail.setSettings.useMutation({
    onSuccess: () => { utils.admin.logEmail.getSettings.invalidate(); toast.success("已保存"); },
    onError: (e) => toast.error("保存失败：" + e.message),
  });
  const sendMut = trpc.admin.logEmail.sendNow.useMutation({
    onSuccess: (r) => { r.ok ? toast.success(r.message) : toast.error(r.message); utils.admin.logEmail.getSettings.invalidate(); },
    onError: (e) => toast.error("发送失败：" + e.message),
  });
  const [recipients, setRecipients] = useState<string | null>(null);
  const [pwd, setPwd] = useState("");
  const canOp = useMyLevel() >= useEffOperate("logs", 3); // 邮送设置/立即发送=管理员 L3+（logEmail 在「操作日志」页）
  // ↑ hooks 必须在任何条件早退之前调用（否则加载态→数据态 hook 数量变化，React 报错）。
  const s = q.data;
  if (!s) return <div style={cardStyle}><p style={{ color: "var(--c-t3)", fontSize: 13, margin: 0 }}>日志邮送设置加载中…</p></div>;
  const set = (patch: Record<string, unknown>) => mu.mutate(patch);
  const rowLabel: React.CSSProperties = { fontSize: 12.5, color: "var(--c-t2)", minWidth: 76, flexShrink: 0 };
  const numSel = (value: number, onChange: (v: number) => void, opts: number[], suffix: string) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12 }}>
      {opts.map((v) => <option key={v} value={v}>{v}{suffix}</option>)}
    </select>
  );
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MailCheck style={{ width: 16, height: 16, color: "oklch(0.7 0.17 160)" }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1)" }}>日志加密打包邮送</h3>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: s.enabled ? "#4ade80" : "var(--c-t3)", cursor: "pointer" }}>
            <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} disabled={!canOp} />
            {s.enabled ? "定时发送已启用" : "定时发送已停用"}
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {s.lastResult && <span style={{ fontSize: 11.5, color: s.lastResult.startsWith("✓") ? "var(--c-t3)" : "#f87171", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${s.lastResult}${s.lastSentAt ? ` · ${new Date(s.lastSentAt).toLocaleString("zh-CN")}` : ""}`}>
            上次：{s.lastResult}{s.lastSentAt ? ` · ${new Date(s.lastSentAt).toLocaleString("zh-CN", { hour12: false })}` : ""}
          </span>}
          <button onClick={() => sendMut.mutate()} disabled={sendMut.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 9, border: "1px solid oklch(0.7 0.17 160 / 0.5)", background: "oklch(0.7 0.17 160 / 0.12)", color: "oklch(0.75 0.15 160)", fontWeight: 600, fontSize: 12.5, cursor: "pointer", opacity: sendMut.isPending ? 0.6 : 1 }}>
            {sendMut.isPending ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : <Send style={{ width: 13, height: 13 }} />} 立即打包发送
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <span style={{ ...rowLabel, paddingTop: 7 }}>接收邮箱</span>
          <textarea
            value={recipients ?? s.recipients ?? ""}
            onChange={(e) => setRecipients(e.target.value)}
            onBlur={() => { if (recipients != null && recipients !== (s.recipients ?? "")) set({ recipients }); }}
            placeholder="多个邮箱用逗号 / 换行分隔，如：ops@a.com, boss@b.com"
            rows={2}
            style={{ ...inputStyle, flex: 1, minWidth: 260, resize: "vertical", fontFamily: "inherit", fontSize: 12.5 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={rowLabel}>压缩密码</span>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)}
            placeholder={s.zipPasswordSet ? "已设置（输入新密码可更换）" : "未设置（zip 将不加密，不建议）"}
            style={{ ...inputStyle, width: 240, fontSize: 12.5 }} />
          <button onClick={() => { set({ zipPassword: pwd }); setPwd(""); }} disabled={mu.isPending}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", background: "var(--c-surface, rgba(255,255,255,0.04))", color: "var(--c-t1)", fontSize: 12, cursor: "pointer" }}>
            {pwd ? "保存密码" : "清除密码"}
          </button>
          <span style={{ fontSize: 11, color: "var(--c-t4)" }}>AES-256 加密，收件人用 7-Zip / WinRAR 输入密码解压</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={rowLabel}>日志内容</span>
          {([["includeAudit", "操作日志"], ["includeLlm", "LLM 日志"], ["includeComfy", "ComfyUI 日志"]] as const).map(([k, l]) => (
            <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--c-t1)", cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(s[k])} onChange={(e) => set({ [k]: e.target.checked })} /> {l}
            </label>
          ))}
          <span style={{ width: 1, height: 14, background: "var(--c-bd1, rgba(255,255,255,0.08))" }} />
          <span style={{ fontSize: 12.5, color: "var(--c-t2)" }}>范围</span>
          <select value={s.rangeDays} onChange={(e) => set({ rangeDays: Number(e.target.value) })} style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12 }}>
            {[[0, "全部历史"], [1, "最近 1 天"], [7, "最近 7 天"], [30, "最近 30 天"], [90, "最近 90 天"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={rowLabel}>发送周期</span>
          <select value={s.scheduleMode} onChange={(e) => set({ scheduleMode: e.target.value })} style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12 }}>
            <option value="hours">按间隔（每 N 小时）</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
          </select>
          {s.scheduleMode === "hours" && <>每 {numSel(s.intervalHours, (v) => set({ intervalHours: v }), [1, 2, 4, 6, 8, 12, 24, 48, 72, 168], " 小时")} 发送一次</>}
          {s.scheduleMode !== "hours" && <>
            {s.scheduleMode === "weekly" && <>周{numSel(s.sendWeekday, (v) => set({ sendWeekday: v }), [0, 1, 2, 3, 4, 5, 6], "")}</>}
            {s.scheduleMode === "monthly" && <>每月 {numSel(s.sendMonthday, (v) => set({ sendMonthday: v }), Array.from({ length: 28 }, (_, i) => i + 1), " 日")}</>}
            {numSel(s.sendHour, (v) => set({ sendHour: v }), Array.from({ length: 24 }, (_, i) => i), " 点")} 发送
          </>}
          <span style={{ fontSize: 11, color: "var(--c-t4)" }}>用「注册认证」页配置的 SMTP 发信；周几：0=周日 1=周一 …</span>
        </div>
      </div>
    </div>
  );
}

// ── LLM 调用日志 ───────────────────────────────────────────────────────────────
// 统一埋点在 invokeLLMWithKie（所有 LLM 入口收敛于此，无遗漏）；scene=tRPC 接口路径。
// 常见场景路径 → 中文标签（未列出的显示原路径，不影响筛选）。
const LLM_SCENE_LABELS: Record<string, string> = {
  "agent.chat": "画布助手", "agent.submitChat": "画布助手(后台)",
  "chat.sendToAssistant": "聊天室 AI 助手",
  "aiChat.sendMessage": "AI 对话节点", "aiChat.send": "AI 对话节点",
  "scripts.generate": "脚本生成", "scripts.generateFullScript": "整片脚本",
  "scripts.generateStoryboards": "分镜生成", "scripts.refineScene": "场景润色",
  "scripts.refineShotContinuity": "镜头衔接优化", "scripts.reviewScript": "剧本审阅",
  "scripts.generateLogline": "一句话梗概", "scripts.generateBeatSheet": "节拍表",
  "scripts.generateEpisodeOutline": "分集大纲", "scripts.scriptCoverage": "剧本评估",
  "scripts.applyScriptFix": "剧本修订", "scripts.extractDialogue": "台词提取",
  "prompts.enhance": "提示词增强", "prompts.translate": "提示词翻译",
  "characters.checkCharacterConsistency": "角色一致性检查", "characters.analyzeCharacterFromImages": "看图识角色",
  "canvas.generateVariants": "变体生成", "canvas.refineConversation": "对话润色",
  "canvas.applyStyleTransfer": "风格迁移", "canvas.generateMoodBoard": "情绪板",
  "smartCut.smartCut": "智能剪辑", "comfy.analyzeWorkflowAI": "工作流 AI 分析",
  "editor.aiSubtitle": "剪辑器 AI", "superAgent.run": "工程智能体",
};
const LLM_ROUTE_LABELS: Record<string, string> = { kie: "kie", custom: "自定义", self_hosted: "自建", bridge: "本机桥接", platform: "平台" };

function LlmLogsPanel() {
  const canClear = (useAuth().user?.adminLevel ?? 0) >= useEffOperate("llmLogs", 2); // 清空=运营 L2+
  const [offset, setOffset] = useState(0);
  const [rangeDays, setRangeDays] = useState("7");
  const [statusFilter, setStatusFilter] = useState<"" | "success" | "error">("");
  const [sceneFilter, setSceneFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [userFilter, setUserFilter] = useState<number | null>(null);
  const [kw, setKw] = useState("");
  const [kwApplied, setKwApplied] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const LIMIT = 50;
  const sinceMs = useMemo(() => (rangeDays === "0" ? undefined : Date.now() - Number(rangeDays) * 86400000), [rangeDays]);
  // 关键词防抖：停止输入 400ms 后生效，避免每敲一键打一次全文 LIKE。
  useEffect(() => { const t = setTimeout(() => { setKwApplied(kw.trim()); setOffset(0); }, 400); return () => clearTimeout(t); }, [kw]);

  const summaryQ = trpc.admin.llmLogs.summary.useQuery({ sinceMs });
  const listQ = trpc.admin.llmLogs.list.useQuery(
    {
      limit: LIMIT, offset, sinceMs,
      status: statusFilter || undefined, scene: sceneFilter || undefined, model: modelFilter || undefined,
      route: routeFilter || undefined, userId: userFilter ?? undefined, q: kwApplied || undefined,
    },
    { keepPreviousData: true } as object,
  );
  const detailQ = trpc.admin.llmLogs.detail.useQuery({ id: detailId ?? 0 }, { enabled: detailId != null });
  const clearMut = trpc.admin.llmLogs.clear.useMutation({
    onSuccess: () => { utils.admin.llmLogs.list.invalidate(); utils.admin.llmLogs.summary.invalidate(); setOffset(0); toast.success("已清空 LLM 日志"); },
    onError: (e) => toast.error("清空失败：" + e.message),
  });

  // 导出 CSV：按当前筛选分页拉全量（1000/页，上限 2 万条），防公式注入 + BOM。
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all: Array<Record<string, unknown>> = [];
      const PAGE = 1000, CAP = 20000;
      for (let off = 0; ; off += PAGE) {
        const d = await utils.admin.llmLogs.list.fetch({
          limit: PAGE, offset: off, sinceMs,
          status: statusFilter || undefined, scene: sceneFilter || undefined, model: modelFilter || undefined,
          route: routeFilter || undefined, userId: userFilter ?? undefined, q: kwApplied || undefined,
        });
        all.push(...(d.rows as Array<Record<string, unknown>>));
        if (d.rows.length < PAGE || all.length >= Math.min(d.total, CAP)) break;
      }
      const esc = (v: unknown) => {
        let s = v == null ? "" : String(v);
        if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["时间", "用户ID", "用户名", "IP", "设备指纹", "会话指纹", "UA", "场景", "模型", "路由", "状态", "耗时(秒)", "prompt字数", "回复字数", "prompt预览", "回复预览", "错误"];
      const lines = all.map((r) => [
        new Date(r.createdAt as string).toLocaleString("zh-CN"),
        r.userId ?? "", r.userName ?? "",
        r.ip ?? "", r.deviceFp ?? "", r.sessionFp ?? "", r.userAgent ?? "",
        LLM_SCENE_LABELS[String(r.scene)] ?? r.scene ?? "", r.model ?? "", LLM_ROUTE_LABELS[String(r.route)] ?? r.route ?? "",
        r.status === "success" ? "成功" : "失败",
        r.durationMs != null ? (Number(r.durationMs) / 1000).toFixed(1) : "",
        r.promptChars ?? "", r.replyChars ?? "",
        r.promptPreview ?? "", r.replyPreview ?? "", r.errorMessage ?? "",
      ].map(esc).join(","));
      downloadTextFile(`LLM日志-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + [header.join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
      toast.success(`已导出 ${all.length} 条日志`);
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const s = summaryQ.data;
  const rows = (listQ.data?.rows ?? []) as Array<Record<string, unknown>>;
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const errRate = s && s.totals.calls > 0 ? Math.round((s.totals.errors / s.totals.calls) * 100) : 0;
  const sceneLabel = (v: unknown) => LLM_SCENE_LABELS[String(v)] ?? String(v ?? "");

  const stat = (label: string, value: string, color = "var(--c-t1)") => (
    <div style={{ flex: 1, minWidth: 110, padding: "10px 12px", borderRadius: 8, background: "var(--c-surface, rgba(255,255,255,0.03))", border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))" }}>
      <div style={{ fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.45))" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
  const miniTable = (title: string, header: string, items: Array<{ key: string; label: string; calls: number; errors: number; avgMs: number; onClick?: () => void; active?: boolean }>) => (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 6 }}>{title}<span style={{ fontWeight: 400, color: "var(--c-t4)", marginLeft: 6 }}>点击行即筛选</span></div>
      <div style={{ border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--c-surface, rgba(255,255,255,0.03))" }}>
            {[header, "调用", "失败", "均时"].map((h) => <th key={h} style={{ padding: "5px 8px", textAlign: "left", color: "var(--c-t3)", fontWeight: 500 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={4} style={{ padding: 10, color: "var(--c-t4)", textAlign: "center" }}>暂无</td></tr> :
              items.slice(0, 8).map((it) => (
                <tr key={it.key} onClick={it.onClick} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", cursor: it.onClick ? "pointer" : "default", background: it.active ? "rgba(139,92,246,0.10)" : undefined }}>
                  <td style={{ padding: "5px 8px", color: "var(--c-t1)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.label}>{it.label}</td>
                  <td style={{ padding: "5px 8px", color: "var(--c-t2)" }}>{it.calls}</td>
                  <td style={{ padding: "5px 8px", color: it.errors > 0 ? "#f87171" : "var(--c-t3)" }}>{it.errors}</td>
                  <td style={{ padding: "5px 8px", color: "var(--c-t3)" }}>{(it.avgMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const detail = detailQ.data as Record<string, unknown> | null | undefined;
  const pre = (label: string, text: string) => (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t2)" }}>{label}</span>
        <button onClick={() => { void navigator.clipboard.writeText(text).then(() => toast.success("已复制")); }} style={{ ...iconBtn, width: 22, height: 22 }} title="复制"><ClipboardList style={{ width: 12, height: 12 }} /></button>
      </div>
      <pre style={{ margin: 0, padding: 10, borderRadius: 8, background: "var(--c-surface, rgba(255,255,255,0.03))", border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))", fontSize: 12, lineHeight: 1.55, color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto" }}>{text || "（空）"}</pre>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrainCircuit style={{ width: 16, height: 16, color: "oklch(0.72 0.2 310)" }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>LLM 调用日志
            {total > 0 && <span style={{ fontWeight: 400, color: "var(--c-t2)", fontSize: 13, marginLeft: 8 }}>（共 {total} 条）</span>}</h3>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <Search style={{ width: 13, height: 13, position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--c-t4)" }} />
            <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜 prompt / 回复 / 错误 / 用户名" style={{ ...inputStyle, width: 220, padding: "6px 10px 6px 26px", fontSize: 12 }} />
          </div>
          <select value={rangeDays} onChange={(e) => { setRangeDays(e.target.value); setOffset(0); }} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12 }}>
            {[["1", "近 24 小时"], ["7", "近 7 天"], ["30", "近 30 天"], ["0", "全部"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as "" | "success" | "error"); setOffset(0); }} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12 }}>
            <option value="">全部状态</option><option value="success">成功</option><option value="error">失败</option>
          </select>
          <select value={sceneFilter} onChange={(e) => { setSceneFilter(e.target.value); setOffset(0); }} style={{ ...inputStyle, width: "auto", maxWidth: 170, padding: "6px 10px", fontSize: 12 }}>
            <option value="">全部场景</option>
            {(s?.byScene ?? []).map((it) => <option key={it.scene} value={it.scene}>{sceneLabel(it.scene)}（{it.calls}）</option>)}
          </select>
          <select value={modelFilter} onChange={(e) => { setModelFilter(e.target.value); setOffset(0); }} style={{ ...inputStyle, width: "auto", maxWidth: 160, padding: "6px 10px", fontSize: 12 }}>
            <option value="">全部模型</option>
            {(s?.byModel ?? []).map((it) => <option key={it.model ?? "-"} value={it.model ?? ""}>{it.model ?? "(默认)"}（{it.calls}）</option>)}
          </select>
          <select value={routeFilter} onChange={(e) => { setRouteFilter(e.target.value); setOffset(0); }} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12 }}>
            <option value="">全部路由</option>
            {Object.entries(LLM_ROUTE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {userFilter != null && <button onClick={() => { setUserFilter(null); setOffset(0); }} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12, cursor: "pointer" }} title="清除用户筛选">用户 #{userFilter} ✕</button>}
          <button onClick={() => { listQ.refetch(); summaryQ.refetch(); }} style={iconBtn} title="刷新"><RefreshCw style={{ width: 14, height: 14 }} /></button>
          <button onClick={() => void exportCsv()} disabled={exporting} style={iconBtn} title="按当前筛选导出全部日志为 CSV">
            {exporting ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <Download style={{ width: 14, height: 14 }} />}
          </button>
          {canClear && (
            <button onClick={() => { if (confirm("确定清空全部 LLM 调用日志？此操作不可恢复。")) clearMut.mutate(); }} disabled={clearMut.isPending} style={iconBtn} title="清空全部日志（运营 L2+）">
              <Trash2 style={{ width: 14, height: 14, color: "#f87171" }} />
            </button>
          )}
        </div>
      </div>

      {/* 统计卡 + Top 榜 */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {stat("调用总数", String(s?.totals.calls ?? "—"))}
        {stat("失败", String(s?.totals.errors ?? "—"), (s?.totals.errors ?? 0) > 0 ? "#f87171" : "var(--c-t1)")}
        {stat("失败率", s ? `${errRate}%` : "—", errRate > 10 ? "#f87171" : "var(--c-t1)")}
        {stat("平均耗时", s ? `${((s.totals.avgMs ?? 0) / 1000).toFixed(1)}s` : "—")}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        {miniTable("按场景", "场景", (s?.byScene ?? []).map((it) => ({ key: it.scene, label: sceneLabel(it.scene), calls: it.calls, errors: it.errors, avgMs: it.avgMs, active: sceneFilter === it.scene, onClick: () => { setSceneFilter(sceneFilter === it.scene ? "" : it.scene); setOffset(0); } })))}
        {miniTable("按模型", "模型", (s?.byModel ?? []).map((it) => ({ key: it.model ?? "-", label: it.model ?? "(默认)", calls: it.calls, errors: it.errors, avgMs: it.avgMs, active: modelFilter === (it.model ?? ""), onClick: () => { setModelFilter(modelFilter === (it.model ?? "") ? "" : (it.model ?? "")); setOffset(0); } })))}
        {miniTable("按用户", "用户", (s?.byUser ?? []).map((it) => ({ key: String(it.userId ?? "-"), label: `${it.userName ?? "?"} #${it.userId ?? "-"}`, calls: it.calls, errors: it.errors, avgMs: it.avgMs, active: userFilter === it.userId, onClick: () => { setUserFilter(userFilter === it.userId ? null : it.userId); setOffset(0); } })))}
      </div>

      {/* 明细列表 */}
      <div style={{ border: "1px solid var(--c-bd1, rgba(255,255,255,0.06))", borderRadius: 8, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
          <thead><tr style={{ background: "var(--c-surface, rgba(255,255,255,0.03))" }}>
            {["时间", "用户", "IP", "场景", "模型", "路由", "状态", "耗时", "prompt 预览（点行看全文）"].map((h) => <th key={h} style={{ padding: "6px 9px", textAlign: "left", color: "var(--c-t3)", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {listQ.isLoading ? <tr><td colSpan={9} style={{ padding: 18, color: "var(--c-t4)", textAlign: "center" }}>加载中…</td></tr> :
              rows.length === 0 ? <tr><td colSpan={9} style={{ padding: 18, color: "var(--c-t4)", textAlign: "center" }}>暂无日志</td></tr> :
              rows.map((r) => (
                <tr key={String(r.id)} onClick={() => setDetailId(Number(r.id))} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
                  <td style={{ padding: "6px 9px", color: "var(--c-t3)", whiteSpace: "nowrap" }}>{new Date(String(r.createdAt)).toLocaleString("zh-CN", { hour12: false })}</td>
                  <td style={{ padding: "6px 9px", color: "var(--c-t2)", whiteSpace: "nowrap", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" }} title={`${r.userName ?? ""} #${r.userId ?? ""}`}>{String(r.userName ?? "?")}</td>
                  <td style={{ padding: "6px 9px", color: "var(--c-t3)", whiteSpace: "nowrap", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }} title={`IP ${String(r.ip ?? "")}\n设备 ${String(r.deviceFp ?? "-")}\n会话 ${String(r.sessionFp ?? "-")}\n${String(r.userAgent ?? "")}`}>{String(r.ip ?? "")}</td>
                  <td style={{ padding: "6px 9px", color: "var(--c-t1)", whiteSpace: "nowrap" }} title={String(r.scene)}>{sceneLabel(r.scene)}</td>
                  <td style={{ padding: "6px 9px", color: "var(--c-t2)", whiteSpace: "nowrap", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }} title={String(r.model ?? "")}>{String(r.model ?? "")}</td>
                  <td style={{ padding: "6px 9px", color: "var(--c-t3)", whiteSpace: "nowrap" }}>{LLM_ROUTE_LABELS[String(r.route)] ?? String(r.route)}</td>
                  <td style={{ padding: "6px 9px", whiteSpace: "nowrap", color: r.status === "success" ? "#4ade80" : "#f87171" }}>{r.status === "success" ? "成功" : "失败"}</td>
                  <td style={{ padding: "6px 9px", color: "var(--c-t3)", whiteSpace: "nowrap" }}>{r.durationMs != null ? `${(Number(r.durationMs) / 1000).toFixed(1)}s` : ""}</td>
                  <td style={{ padding: "6px 9px", color: "var(--c-t3)", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={String(r.promptPreview ?? "")}>
                    {r.status === "error" ? <span style={{ color: "#f87171" }}>{String(r.errorMessage ?? "")}</span> : String(r.promptPreview ?? "")}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
          <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} style={paginBtn}>上一页</button>
          <span style={{ fontSize: 13, color: "var(--c-t2)" }}>{currentPage} / {totalPages}</span>
          <button onClick={() => setOffset(offset + LIMIT)} disabled={currentPage >= totalPages} style={paginBtn}>下一页</button>
        </div>
      )}

      {/* 详情弹层：完整 prompt / 回复 / 错误 */}
      {detailId != null && createPortal(
        <div onClick={() => setDetailId(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 96vw)", maxHeight: "88vh", overflowY: "auto", background: "var(--c-elevated, #1b1b22)", border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", borderRadius: 14, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <b style={{ fontSize: 15, color: "var(--c-t1)" }}>调用详情 #{detailId}</b>
              <button onClick={() => setDetailId(null)} style={iconBtn} aria-label="关闭"><X style={{ width: 15, height: 15 }} /></button>
            </div>
            {!detail ? <p style={{ color: "var(--c-t3)", fontSize: 13 }}>加载中…</p> : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--c-t2)", marginBottom: 4 }}>
                  <span>{new Date(String(detail.createdAt)).toLocaleString("zh-CN", { hour12: false })}</span>
                  <span>用户：{String(detail.userName ?? "?")} #{String(detail.userId ?? "-")}</span>
                  <span>场景：{sceneLabel(detail.scene)}（{String(detail.scene)}）</span>
                  <span>模型：{String(detail.model ?? "")}</span>
                  <span>路由：{LLM_ROUTE_LABELS[String(detail.route)] ?? String(detail.route)}</span>
                  <span style={{ color: detail.status === "success" ? "#4ade80" : "#f87171" }}>{detail.status === "success" ? "成功" : "失败"}</span>
                  <span>耗时 {detail.durationMs != null ? `${(Number(detail.durationMs) / 1000).toFixed(1)}s` : "?"}</span>
                  <span>prompt {String(detail.promptChars ?? 0)} 字 · 回复 {String(detail.replyChars ?? 0)} 字</span>
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--c-t3)", marginBottom: 4 }}>
                  <span>IP：{String(detail.ip ?? "-")}</span>
                  <span>设备指纹：{String(detail.deviceFp ?? "-")}</span>
                  <span>会话指纹：{String(detail.sessionFp ?? "-")}</span>
                  <span style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={String(detail.userAgent ?? "")}>UA：{String(detail.userAgent ?? "-")}</span>
                </div>
                {detail.status !== "success" && !!detail.errorMessage && pre("错误信息", String(detail.errorMessage))}
                {pre("Prompt（完整上下文，多模态部分以占位符表示）", String(detail.promptText ?? ""))}
                {detail.status === "success" && pre("回复", String(detail.replyText ?? ""))}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Chat administration ────────────────────────────────────────────────────────

function ChatAdminPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ChatBroadcastPanel />
      <ChatSettingsPanel />
      <ChatConversationsPanel />
      <ChatMessageSearchPanel />
      <ChatFilesPanel />
      <ChatBansPanel />
    </div>
  );
}

// 管理员广播：整合进聊天的「广播频道」。此处提供后台入口——打开广播编辑器（多选收件人：
// 全体 / 用户 / 房间群组），下发到各自「系统公告」房 + 触发通知（声音/桌面/横幅/红点，画布上也能收）。
function ChatBroadcastPanel() {
  const [open, setOpen] = useState(false);
  const canBroadcast = useMyLevel() >= 3; // 广播 = 管理员(L3+)
  return (
    <div style={chatCard}>
      <h3 style={chatCardTitle}>📢 广播频道</h3>
      <p style={{ ...chatDim, margin: "0 0 10px" }}>广播已整合进聊天——管理员在聊天里有一个专属「广播频道」，也可从这里发起。可复选接收对象（<b>全体用户 / 指定成员 / 房间群组</b>），下发到各自的「系统公告」聊天房并实时提醒（声音 / 桌面通知 / 横幅 / 未读红点），用户在画布上聊天窗关着也能收到，历史可在广播频道回查。</p>
      <LevelGate need={3} label="广播需「管理员」(L3) 及以上权限">
        <button onClick={() => setOpen(true)} disabled={!canBroadcast} style={{ ...chatPrimarySm, opacity: canBroadcast ? 1 : 0.5 }}>
          发起广播…
        </button>
      </LevelGate>
      {open && <BroadcastComposer onClose={() => setOpen(false)} />}
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
        <LevelGate need={3} tab="chat" label="聊天设置修改需「管理员」(L3) 及以上权限">
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
        </LevelGate>
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
      {/* 删除会话 = 管理员(L3+)；查看员/运营只读（筛选保持可用） */}
      <LevelGate need={3} tab="chat" label="删除会话需「管理员」(L3) 及以上权限">
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
      </LevelGate>
      {q.data?.rows.length === 0 && <p style={chatDim}>暂无会话</p>}
    </div>
  );
}

function ChatMessageSearchPanel() {
  const [keyword, setKeyword] = useState("");
  const [convId, setConvId] = useState("");
  const [userId, setUserId] = useState("");
  const [submitted, setSubmitted] = useState<{ keyword?: string; conversationId?: number; userId?: number } | null>(null);
  const [page, setPage] = useState(0);
  const PAGE = 50;
  const q = trpc.admin.chat.searchMessages.useQuery(
    { ...submitted, limit: PAGE, offset: page * PAGE },
    { enabled: submitted !== null },
  );
  const runSearch = () => { setPage(0); setSubmitted({ keyword: keyword || undefined, conversationId: convId ? Number(convId) : undefined, userId: userId ? Number(userId) : undefined }); };
  const rowCount = q.data?.rows.length ?? 0;
  const hasMore = rowCount === PAGE; // 满页 → 可能还有下一页
  return (
    <div style={chatCard}>
      <h3 style={chatCardTitle}>消息检索（仅服务器模式可见明文）</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input placeholder="关键词" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={chatInput} />
        <input placeholder="会话ID" value={convId} onChange={(e) => setConvId(e.target.value)} style={{ ...chatInput, width: 100 }} />
        <input placeholder="用户ID" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ ...chatInput, width: 100 }} />
        <button onClick={runSearch} disabled={q.isFetching} style={{ ...chatPrimarySm, opacity: q.isFetching ? 0.6 : 1 }}>{q.isFetching ? "搜索中…" : "搜索"}</button>
      </div>
      {q.isFetching && submitted && <p style={chatDim}>搜索中…</p>}
      {q.data?.encrypted && <p style={chatDim}>🔒 该会话为端到端加密，服务器无内容，仅可见元数据。</p>}
      {q.data && !q.data.encrypted && rowCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, fontSize: 11.5, color: "var(--c-t3)" }}>
          <span>第 {page + 1} 页 · 本页 {rowCount} 条{hasMore ? "（可能有更多）" : ""}</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || q.isFetching} style={paginBtn}>‹ 上一页</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={!hasMore || q.isFetching} style={paginBtn}>下一页 ›</button>
          </span>
        </div>
      )}
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

// 聊天附件/媒体浏览：列出用户在聊天里上传的全部文件（图片缩略图可点开预览、视频内联、
// 其它给下载链接），可按会话 ID 过滤。走 /manus-storage 门控代理，与聊天内一致。
function ChatFilesPanel() {
  const [convId, setConvId] = useState("");
  const [applied, setApplied] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const PAGE = 40;
  const q = trpc.admin.chat.listFiles.useQuery({ conversationId: applied, limit: PAGE, offset: page * PAGE });
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const fmtSize = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${(n / 1024).toFixed(0)}KB` : `${n}B`;
  return (
    <div style={chatCard}>
      <h3 style={chatCardTitle}>附件 / 媒体浏览{total > 0 && <span style={{ fontWeight: 400, color: "var(--c-t3)", fontSize: 12, marginLeft: 8 }}>（共 {total} 个）</span>}</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="会话ID（留空=全部）" value={convId} onChange={(e) => setConvId(e.target.value.replace(/[^\d]/g, ""))} style={{ ...chatInput, width: 150 }} />
        <button onClick={() => { setPage(0); setApplied(convId ? Number(convId) : undefined); }} style={chatPrimarySm}>筛选</button>
        <button onClick={() => q.refetch()} style={{ ...chatPrimarySm, background: "var(--c-surface, rgba(255,255,255,0.05))", color: "var(--c-t2)" }}>刷新</button>
        <span style={{ fontSize: 11, color: "var(--c-t4)" }}>点击图片放大预览；视频/其它文件走门控下载</span>
      </div>
      {q.isLoading ? <p style={chatDim}>加载中…</p> : rows.length === 0 ? <p style={chatDim}>无附件</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {rows.map((f) => (
            <div key={f.id} style={{ border: "1px solid var(--c-bd1, rgba(255,255,255,0.07))", borderRadius: 8, overflow: "hidden", background: "var(--c-surface, rgba(255,255,255,0.03))" }}>
              <div style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.2)", overflow: "hidden" }}>
                {f.kind === "image" ? (
                  <img src={f.url} alt={f.name} onClick={() => setPreview(f.url)} draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover", cursor: "zoom-in", WebkitTouchCallout: "none", userSelect: "none" }} />
                ) : f.kind === "video" ? (
                  <video src={f.url} controls controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu={(e) => e.preventDefault()} style={{ maxWidth: "100%", maxHeight: "100%" }} />
                ) : (
                  <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 28 }} title="下载">📄</a>
                )}
              </div>
              <div style={{ padding: "6px 8px" }}>
                <div style={{ fontSize: 11.5, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.name}>{f.name}</div>
                <div style={{ fontSize: 10.5, color: "var(--c-t4)", marginTop: 2 }}>会话#{f.conversationId} · 上传者#{f.uploaderId} · {fmtSize(f.size)}</div>
                <div style={{ fontSize: 10, color: "var(--c-t4)" }}>{new Date(f.createdAt).toLocaleString("zh-CN", { hour12: false })}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12, fontSize: 11.5, color: "var(--c-t3)", alignItems: "center" }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={paginBtn}>‹ 上一页</button>
          <span>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={paginBtn}>下一页 ›</button>
        </div>
      )}
      {preview && createPortal(
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}>
          <img src={preview} alt="" onContextMenu={(e) => e.preventDefault()} draggable={false} style={{ maxWidth: "95vw", maxHeight: "92vh", objectFit: "contain", WebkitTouchCallout: "none", userSelect: "none" }} />
        </div>,
        document.body,
      )}
    </div>
  );
}

function ChatBansPanel() {
  const canBan = (useAuth().user?.adminLevel ?? 0) >= useEffOperate("chat", 3); // 封禁/解封=管理员 L3+
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
        <button onClick={() => { if (userId) banMu.mutate({ userId: Number(userId), scope: "global" }); }} disabled={!canBan} style={{ ...chatDanger, opacity: canBan ? 1 : 0.4, cursor: canBan ? "pointer" : "not-allowed" }} title={canBan ? undefined : "需「管理员」及以上权限"}>全局封禁</button>
      </div>
      <table style={chatTable}>
        <thead><tr><ChatTh>用户</ChatTh><ChatTh>范围</ChatTh><ChatTh>原因</ChatTh><ChatTh>操作</ChatTh></tr></thead>
        <tbody>
          {q.data?.map((b) => (
            <tr key={b.id}>
              <ChatTd>{b.userName} (#{b.userId})</ChatTd>
              <ChatTd>{b.scope === "global" ? "全局" : `会话#${b.conversationId}`}</ChatTd>
              <ChatTd>{b.reason ?? "—"}</ChatTd>
              <ChatTd><button onClick={() => unbanMu.mutate({ id: b.id })} disabled={!canBan} style={{ ...paginBtn, opacity: canBan ? 1 : 0.4, cursor: canBan ? "pointer" : "not-allowed" }} title={canBan ? undefined : "需「管理员」及以上权限"}>解封</button></ChatTd>
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

// ── #116 教程截图总表：枚举全部 slug，集中查看/更换/恢复默认 ──────────────────
// 与教程页图上悬停的「更换/恢复默认」同一套端点；此处一屏总览所有截图的
// 来源（自定义/默认/缺失）与更换时间，不必逐章翻教程找图。

function TutorialImagesPanel() {
  const utils = trpc.useUtils();
  const imagesQ = trpc.system.tutorialImages.useQuery();
  const uploadMut = trpc.upload.uploadImage.useMutation();
  const setMut = trpc.system.setTutorialImage.useMutation({
    onSuccess: () => { void utils.system.tutorialImages.invalidate(); toast.success("截图已更换"); },
    onError: (e) => toast.error("更换失败：" + e.message),
  });
  const resetMut = trpc.system.resetTutorialImage.useMutation({
    onSuccess: () => { void utils.system.tutorialImages.invalidate(); toast.success("已恢复默认截图"); },
    onError: (e) => toast.error("恢复失败：" + e.message),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingSlugRef = useRef<string | null>(null);
  // 默认图探测失败（构建产物缺图）的 slug——标「缺失」提醒管理员补图。
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const rows = useMemo(() => allTutorialImageSlugs(), []);
  const overrides = imagesQ.data?.images ?? {};
  const updatedAtMap = imagesQ.data?.updatedAt ?? {};
  const busy = uploadMut.isPending || setMut.isPending || resetMut.isPending;
  const customCount = rows.filter((r) => overrides[r.slug]).length;

  const pickFor = (slug: string) => { pendingSlugRef.current = slug; fileRef.current?.click(); };
  const onFile = async (f: File | undefined) => {
    const slug = pendingSlugRef.current;
    pendingSlugRef.current = null;
    if (!f || !slug) return;
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("读取文件失败"));
        r.readAsDataURL(f);
      });
      const up = await uploadMut.mutateAsync({ base64, mimeType: f.type || "image/png", filename: `tutorial-${slug}.png` });
      await setMut.mutateAsync({ slug, url: up.url });
    } catch (e) {
      toast.error("上传失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };
  const fmtTime = (t: string | null | undefined) =>
    t ? new Date(t).toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div style={{ ...cardStyle }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: "var(--c-t1)" }}>教程截图总表</h3>
        <span style={{ fontSize: 12, color: "var(--c-t4)" }}>
          共 {rows.length} 张 · 自定义 {customCount} · 默认 {rows.length - customCount}{missing.size > 0 ? ` · 缺失 ${missing.size}` : ""}
        </span>
        <button onClick={() => window.open("/tutorial", "_blank")}
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "var(--c-surface)", color: "var(--c-t2)", border: "1px solid var(--c-bd2)", cursor: "pointer" }}>
          <ExternalLink size={12} /> 打开教程中心
        </button>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--c-t4)", lineHeight: 1.6 }}>
        教程正文只引用 slug；这里替换后立即对所有用户生效（教程页图上悬停也可直接更换）。「恢复默认」删除自定义图、回退到内置默认截图。
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--c-t4)", textAlign: "left" }}>
              {["预览", "章节", "说明", "slug", "来源", "更换时间", "操作"].map((h) => (
                <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid var(--c-bd2)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const custom = overrides[r.slug];
              const src = custom ?? `/tutorial/${r.slug}.png`;
              const isMissing = !custom && missing.has(r.slug);
              return (
                <tr key={r.slug} style={{ borderBottom: "1px solid var(--c-bd1)" }}>
                  <td style={{ padding: "8px 10px" }}>
                    {isMissing ? (
                      <div style={{ width: 120, height: 68, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: "var(--c-input)", border: "1px dashed var(--c-bd3)", color: "var(--c-t4)", fontSize: 11 }}>无图</div>
                    ) : (
                      <img key={src} src={src} alt={r.caption} loading="lazy" draggable={false}
                        onError={() => setMissing((prev) => new Set(prev).add(r.slug))}
                        onClick={() => window.open(src, "_blank")}
                        style={{ width: 120, height: 68, objectFit: "cover", borderRadius: 8, border: "1px solid var(--c-bd2)", cursor: "zoom-in", display: "block" }} />
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "var(--c-t3)" }}>{r.chapter}</td>
                  <td style={{ padding: "8px 10px", color: "var(--c-t2)", minWidth: 160 }}>{r.caption}</td>
                  <td style={{ padding: "8px 10px" }}><code style={{ fontFamily: "monospace", fontSize: 11, color: "var(--c-t3)" }}>{r.slug}</code></td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      background: custom ? "oklch(0.65 0.2 160 / 0.15)" : isMissing ? "oklch(0.6 0.2 25 / 0.15)" : "var(--c-surface)",
                      color: custom ? "oklch(0.75 0.17 160)" : isMissing ? "#f87171" : "var(--c-t3)",
                      border: `1px solid ${custom ? "oklch(0.65 0.2 160 / 0.3)" : isMissing ? "oklch(0.6 0.2 25 / 0.3)" : "var(--c-bd2)"}` }}>
                      {custom ? "自定义" : isMissing ? "缺失" : "默认"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "var(--c-t4)", fontVariantNumeric: "tabular-nums" }}>{custom ? fmtTime(updatedAtMap[r.slug]) : "—"}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => pickFor(r.slug)} disabled={busy} title="上传一张新截图替换（立即对所有用户生效）"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "var(--c-surface)", color: "var(--c-t2)", border: "1px solid var(--c-bd2)", cursor: busy ? "wait" : "pointer" }}>
                        {busy && pendingSlugRef.current === r.slug ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} 更换
                      </button>
                      {custom && (
                        <button onClick={() => resetMut.mutate({ slug: r.slug })} disabled={busy} title="删除自定义截图，恢复内置默认图"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "var(--c-surface)", color: "var(--c-t3)", border: "1px solid var(--c-bd2)", cursor: busy ? "wait" : "pointer" }}>
                          <RotateCcw size={11} /> 恢复默认
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

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
          description={
            "开启：通过白名单的非管理员用户可使用主 env key（KIE_API_KEY）跑 kie。\n关闭：仅有管理员分配 key、或自填临时 key 的用户能用。管理员始终可用。\n" +
            "【门控范围说明】本开关只门控「白名单用户用公用 key 花钱生成」这一条路径，其它一概不受影响：\n" +
            "· 用户自填的临时 key / 管理员分配的专属 key —— 各花各的额度，不经过本开关；\n" +
            "· 存储页的「暂存通道 · Kie」（参考图公网中转）—— 系统级调用且官方上传免费，不扣积分、不受本开关限制；\n" +
            "· 管理员 —— 始终可用公用 key。"
          }
          enabled={kieEnabled}
          disabled={setKieEnabled.isPending}
          onClick={() => setKieEnabled.mutate({ kieEnabled: !kieEnabled })}
          statusOn="已开启（白名单用户可用公用 key 生成；临时/分配 key 与 Kie 暂存不受本开关影响）"
          statusOff="已关闭（普通用户仅分配/临时 key 可生成；临时/分配 key 与 Kie 暂存不受本开关影响）"
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
  borderRadius: "14px", padding: "24px",
  boxShadow: "0 1px 2px oklch(0 0 0 / 0.16), 0 8px 28px oklch(0 0 0 / 0.10)",
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
  const canDecide = useMyLevel() >= useEffOperate("downloads", 2); // 批准/拒绝/授权/撤销 = 运营(L2+)；查看员(L1) 只读
  // 折进 busy：级别不足时所有审批/授权/撤销按钮一并禁用（查证文件/预览仍可用）。
  const busy = decideMut.isPending || revokeMut.isPending || grantMut.isPending || !canDecide;

  const chip = (active: boolean): React.CSSProperties => ({
    fontSize: 12, padding: "4px 11px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "oklch(0.72 0.2 285)" : "var(--c-bd2)"}`,
    background: active ? "oklch(0.72 0.2 285 / 0.15)" : "transparent",
    color: active ? "oklch(0.78 0.16 285)" : "var(--c-t2, rgba(255,255,255,0.55))",
  });
  const statusColor = (s: string) => s === "pending" ? "oklch(0.8 0.16 85)" : s === "active" ? "oklch(0.72 0.18 155)" : s === "denied" ? "oklch(0.7 0.18 25)" : "var(--c-t3,rgba(255,255,255,0.4))";
  const statusLabel = (s: string) => ({ pending: "待审批", active: "已授权", revoked: "已撤销", denied: "已拒绝" } as Record<string, string>)[s] ?? s;
  const btn = (color: string, bg = "transparent"): React.CSSProperties => ({ fontSize: 12, padding: "5px 11px", borderRadius: 7, border: `1px solid ${color}`, background: bg, color, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12.5, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.6 }}>
        在「存储设置 → 严格下载授权」开启后，非管理员下载原文件须持「一次性授权」。可在此审批用户申请、查证文件，或主动按文件/整个项目授权。每张授权对每个文件仅可成功下载一次。
      </div>
      {!canDecide && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 500, background: "oklch(0.70 0.14 65 / 0.10)", border: "1px solid oklch(0.70 0.14 65 / 0.30)", color: "oklch(0.82 0.13 65)" }}>
          <Shield style={{ width: 14, height: 14, flexShrink: 0 }} />
          只读模式 · 审批 / 授权 / 撤销需「运营」(L2) 及以上权限（查证文件、预览仍可用）
        </div>
      )}

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
          const canGrant = !!u && grantProjectSel.size > 0 && !grantMut.isPending && canDecide;
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
type AdminAsset = { id: number; name: string; type: string; url: string; userId: number; source: string | null; provider: string | null; model: string | null; thumbnailUrl?: string | null };
function AdminAssetLightbox({ asset, onClose }: { asset: AdminAsset; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  // 必须 portal 到 body：素材面板外层 <div className="animate-fade-up"> 动画结束停在
  // transform: translateY(0)，非 none 的 transform 会成为 position:fixed 的包含块，
  // 导致本弹层的 inset:0 相对那个「很高的 300 项网格面板」而非视口，居中的卡片落到
  // 视口下方数千 px 处、看不见（只剩模糊背景）。portal 到 body 即回归真正的视口固定。
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 2147483300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "oklch(0 0 0 / 0.8)", backdropFilter: "blur(8px)" }}
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
    </div>,
    document.body,
  );
}

// ── Assets Panel (admin cross-user media library) ─────────────────────────────
function AssetsAdminPanel() {
  const [userId, setUserId] = useState<string>("");
  const [type, setType] = useState<"" | "image" | "video" | "audio" | "other">("");
  const [source, setSource] = useState<"" | "upload" | "generated" | "external">("");
  const [q, setQ] = useState("");
  const utils = trpc.useUtils();
  const canEdit = useMyLevel() >= useEffOperate("assets", 3); // 删除/彻底删除/回填 = 管理员(L3+)；查看员/运营只读（筛选/预览仍可用）
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
      {!canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 500, background: "oklch(0.70 0.14 65 / 0.10)", border: "1px solid oklch(0.70 0.14 65 / 0.30)", color: "oklch(0.82 0.13 65)" }}>
          <Shield style={{ width: 14, height: 14, flexShrink: 0 }} />
          只读模式 · 删除 / 彻底删除 / 回填需「管理员」(L3) 及以上权限（浏览、筛选、预览仍可用）
        </div>
      )}
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
          disabled={bfRunning || !canEdit}
          title={canEdit ? undefined : "需「管理员」(L3) 及以上权限"}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "7px 14px", fontSize: 12.5, fontWeight: 600,
            background: bfRunning ? "var(--c-input, rgba(255,255,255,0.06))" : "oklch(0.62 0.18 60 / 0.85)",
            border: "1px solid oklch(0.68 0.18 60 / 0.4)", borderRadius: 8,
            color: bfRunning ? "var(--c-t3, rgba(255,255,255,0.4))" : "#1a1205",
            cursor: bfRunning || !canEdit ? "not-allowed" : "pointer", flexShrink: 0, opacity: canEdit ? 1 : 0.45,
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
            <button onClick={handleBulkDelete} disabled={deleteMut.isPending || !canEdit} title={canEdit ? undefined : "需「管理员」(L3) 及以上权限"}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "5px 11px", borderRadius: 7, border: "1px solid oklch(0.6 0.16 25 / 0.4)", background: "transparent", color: "oklch(0.78 0.16 25)", cursor: deleteMut.isPending || !canEdit ? "not-allowed" : "pointer", opacity: canEdit ? 1 : 0.45 }}>
              {deleteMut.isPending ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : <Trash2 style={{ width: 13, height: 13 }} />} 删除选中（隐藏）
            </button>
            <button onClick={handleHardDelete} disabled={hardDeleteMut.isPending || !canEdit} title={canEdit ? "物理删除 MinIO 文件 + 数据库记录，不可恢复（仅管理员）" : "需「管理员」(L3) 及以上权限"}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "5px 11px", borderRadius: 7, border: "1px solid oklch(0.6 0.2 25 / 0.7)", background: "oklch(0.6 0.2 25 / 0.12)", color: "oklch(0.82 0.2 25)", fontWeight: 600, cursor: hardDeleteMut.isPending || !canEdit ? "not-allowed" : "pointer", opacity: canEdit ? 1 : 0.45 }}>
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
                <img src={a.url} alt={a.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : a.type === "video" ? (
                <>
                  {/* 静态缩略图代替 <video preload>：逐卡解码器素材多时超出 Chromium 上限会卡死整页 */}
                  {a.thumbnailUrl ? (
                    <img src={a.thumbnailUrl} alt={a.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: "rgba(0,0,0,0.35)" }} />
                  )}
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
      {/* #R5-8 空态：与本页其它面板一致的居中虚线框，替代此前的一片空白 */}
      {!isFetching && list.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 12px", border: "1px dashed var(--c-bd2)", borderRadius: 12, color: "var(--c-t3)" }}>
          <ImageIcon style={{ width: 26, height: 26, opacity: 0.45, margin: "0 auto 8px" }} />
          <div style={{ fontSize: 13 }}>暂无匹配素材</div>
          <div style={{ fontSize: 11.5, color: "var(--c-t4)", marginTop: 3 }}>调整筛选条件，或等用户上传 / 生成</div>
        </div>
      )}
      {preview && <AdminAssetLightbox asset={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
