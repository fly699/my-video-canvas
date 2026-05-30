import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Plus,
  Film,
  ArrowRight,
  MoreHorizontal,
  Trash2,
  Pencil,
  Check,
  X,
  Layers,
  Wand2,
  Users,
  Zap,
  Clock,
  ChevronRight,
  LogOut,
  Sparkles,
  Video,
  Boxes,
  Bot,
  MessageCircle,
} from "lucide-react";

// ── Animated background grid ─────────────────────────────────────────────────
function GridBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {/* Dot grid */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.6]" xmlns="http://www.w3.org/2000/svg" style={{ color: "var(--c-bd2)" }}>
        <defs>
          <pattern id="dot-grid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />
      </svg>

      {/* Radial gradient vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, oklch(0.68 0.22 285 / 0.08) 0%, transparent 70%)",
        }}
      />

      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-64"
        style={{
          background: "linear-gradient(to top, var(--c-canvas), transparent)",
        }}
      />
    </div>
  );
}

// ── Project card ─────────────────────────────────────────────────────────────
interface Project {
  id: number;
  name: string;
  description?: string | null;
  updatedAt: Date;
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
  onRename,
  readOnly = false,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  readOnly?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(project.name);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const timeAgo = (date: Date) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} 小时前`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days} 天前`;
    return new Date(date).toLocaleDateString("zh-CN");
  };

  return (
    <div
      className="group relative flex flex-col rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={() => !menuOpen && !renaming && onOpen()}
      style={{
        borderColor: "var(--c-bd1)",
        background: "var(--c-surface)",
        boxShadow: "0 1px 2px oklch(0 0 0 / 0.2), 0 4px 16px oklch(0 0 0 / 0.1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--c-surface)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd1)";
      }}
    >
      {/* Thumbnail area */}
      <div
        className="relative h-36 flex items-center justify-center overflow-hidden"
        style={{
          background: "linear-gradient(135deg, var(--c-surface) 0%, var(--c-base) 100%)",
        }}
      >
        {/* Decorative nodes preview */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-4 left-6 w-16 h-8 rounded-md" style={{ border: "1px solid var(--c-bd3)", background: "var(--c-surface)" }} />
          <div className="absolute top-8 left-28 w-20 h-8 rounded-md" style={{ border: "1px solid var(--c-bd3)", background: "var(--c-surface)" }} />
          <div className="absolute top-16 left-12 w-24 h-8 rounded-md" style={{ border: "1px solid var(--c-bd3)", background: "var(--c-surface)" }} />
          <svg className="absolute inset-0 w-full h-full" style={{ overflow: "visible", color: "var(--c-bd3)" }}>
            <line x1="88" y1="28" x2="112" y2="32" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" opacity="0.8" />
            <line x1="148" y1="36" x2="120" y2="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" opacity="0.8" />
          </svg>
        </div>

        {/* Center icon */}
        <div
          className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: "oklch(0.68 0.22 285 / 0.15)",
            border: "1px solid oklch(0.68 0.22 285 / 0.3)",
          }}
        >
          <Film className="w-5 h-5" style={{ color: "oklch(0.68 0.22 285)" }} />
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "var(--c-overlay)" }} />
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1 p-4">
        {renaming ? (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(renameVal);
                  setRenaming(false);
                }
                if (e.key === "Escape") setRenaming(false);
              }}
              className="flex-1 rounded-md px-2 py-1 text-sm outline-none"
              style={{ background: "var(--c-surface)", border: "1px solid oklch(0.68 0.22 285 / 0.5)", color: "var(--c-t1)" }}
              autoFocus
            />
            <button
              onClick={() => { onRename(renameVal); setRenaming(false); }}
              className="p-1 rounded text-green-400"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-overlay)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setRenaming(false)}
              className="p-1 rounded"
              style={{ color: "var(--c-t4)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-overlay)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <h3 className="text-sm font-semibold truncate leading-snug" style={{ color: "var(--c-t1)" }}>
            {project.name}
          </h3>
        )}
        <div className="flex items-center gap-1 text-xs" style={{ color: "var(--c-t4)" }}>
          <Clock className="w-3 h-3" />
          <span>{timeAgo(project.updatedAt)}</span>
        </div>
      </div>

      {/* Menu button */}
      {!readOnly && <div
        ref={menuRef}
        className="absolute top-3 right-3"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="项目操作"
          title="重命名或删除"
          className="w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
          style={{ color: "var(--c-t3)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-overlay)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {menuOpen && (
          <div
            className="absolute top-8 right-0 w-40 rounded-xl overflow-hidden z-50 animate-scale-in"
            style={{
              background: "var(--c-elevated)",
              border: "1px solid var(--c-bd2)",
              boxShadow: "var(--c-node-shadow-hover)",
            }}
          >
            <button
              onClick={() => { setRenaming(true); setMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs transition-colors"
              style={{ color: "var(--c-t2)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
            >
              <Pencil className="w-3.5 h-3.5" />
              重命名
            </button>
            <div className="h-px mx-2" style={{ background: "var(--c-bd1)" }} />
            <button
              onClick={() => { onDelete(); setMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400/80 hover:text-red-400 transition-colors"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.55 0.18 20 / 0.08)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除项目
            </button>
          </div>
        )}
      </div>}
    </div>
  );
}

// ── New project card ──────────────────────────────────────────────────────────
function NewProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center justify-center rounded-xl border border-dashed transition-all duration-200 h-full min-h-[220px]"
      style={{ borderColor: "var(--c-bd2)", background: "transparent" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-all duration-200 group-hover:scale-110"
        style={{
          background: "oklch(0.68 0.22 285 / 0.10)",
          border: "1px solid oklch(0.68 0.22 285 / 0.25)",
        }}
      >
        <Plus className="w-5 h-5" style={{ color: "oklch(0.68 0.22 285)" }} />
      </div>
      <span className="text-sm font-medium transition-colors" style={{ color: "var(--c-t3)" }}>
        新建项目
      </span>
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);

  const { data: projects, refetch } = trpc.projects.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // 管理员：检测是否有新版本（带服务端 15 分钟缓存，每 30 分钟轮询一次）
  const { data: updateInfo } = trpc.admin.update.available.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
    refetchInterval: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const hasUpdate = (updateInfo?.behind ?? 0) > 0;

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (project: { id: number } | null | undefined) => {
      if (project) navigate(`/canvas/${project.id}`);
    },
    onError: () => toast.error("创建项目失败"),
  });

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => { refetch(); toast.success("项目已删除"); },
    onError: () => toast.error("删除失败"),
  });

  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => refetch(),
  });

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createProject.mutateAsync({ name: "未命名项目" });
    } finally {
      setCreating(false);
    }
  };

  // ── Unauthenticated landing ──────────────────────────────────────────────
  if (!loading && !isAuthenticated) {
    return (
      <div className="relative min-h-screen flex flex-col overflow-hidden">
        <GridBackground />

        {/* Nav */}
        <nav className="relative z-10 flex items-center justify-between px-8 py-5">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
              }}
            >
              <Film className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight" style={{ color: "var(--c-t1)" }}>
              AI Video Canvas
            </span>
          </div>

          <a
            href={getLoginUrl()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150"
            style={{ color: "var(--c-t2)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)" }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--c-t1)"; el.style.borderColor = "var(--c-bd3)"; el.style.background = "var(--c-overlay)"; }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--c-t2)"; el.style.borderColor = "var(--c-bd2)"; el.style.background = "transparent"; }}
          >
            登录
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </nav>

        {/* Main landing — Banner / Stats / Feature grid / Showcase */}
        <main className="relative z-10 flex-1 px-6 pb-16">
          <div className="max-w-5xl mx-auto flex flex-col gap-8">

            {/* ── Banner card ────────────────────────────────────────────── */}
            <div
              className="relative rounded-2xl p-6 sm:p-8 animate-fade-in overflow-hidden"
              style={{
                background: "linear-gradient(135deg, oklch(0.10 0.025 285) 0%, oklch(0.07 0.012 285) 100%)",
                border: "1px solid oklch(0.68 0.22 285 / 0.25)",
                boxShadow: "0 0 0 1px oklch(0.68 0.22 285 / 0.10), 0 12px 48px oklch(0.68 0.22 285 / 0.18)",
              }}
            >
              {/* Decorative glow */}
              <div
                className="absolute -top-32 -right-32 w-80 h-80 rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, oklch(0.68 0.22 285 / 0.20) 0%, transparent 70%)" }}
              />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                        boxShadow: "0 4px 16px oklch(0.68 0.22 285 / 0.35)",
                      }}
                    >
                      <Film className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-sm font-bold tracking-tight" style={{ color: "var(--c-t1)" }}>
                      AI Video Canvas
                    </span>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold"
                    style={{
                      background: "oklch(0.68 0.22 285 / 0.15)",
                      border: "1px solid oklch(0.68 0.22 285 / 0.35)",
                      color: "oklch(0.80 0.15 285)",
                    }}
                  >
                    <Sparkles className="w-3 h-3" />
                    v1.0 · 全新发布
                  </span>
                </div>

                <h1
                  className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight"
                  style={{
                    background: "linear-gradient(135deg, oklch(0.95 0 0) 0%, oklch(0.78 0.16 285) 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  无限画布 · 影视创作工作流
                </h1>

                <p className="text-sm leading-relaxed mb-6 max-w-2xl" style={{ color: "var(--c-t3)" }}>
                  在无限画布上编排脚本、分镜、提示词与视频生成任务。
                  支持 23 种专业节点、12+ 主流 AI 模型，集成 ComfyUI 自建服务器，
                  实现从创意到成片的全流程可视化协作。
                </p>

                <div className="flex items-center gap-3 flex-wrap">
                  <a
                    href={getLoginUrl()}
                    className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200"
                    style={{
                      background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                      boxShadow: "0 0 0 1px oklch(0.68 0.22 285 / 0.4), 0 4px 24px oklch(0.68 0.22 285 / 0.3)",
                    }}
                  >
                    <Sparkles className="w-4 h-4" />
                    开始创作
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </a>
                  <a
                    href="#features"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
                    style={{
                      color: "var(--c-t2)",
                      border: "1px solid var(--c-bd2)",
                      background: "var(--c-surface)",
                    }}
                    onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--c-bd3)"; el.style.background = "var(--c-elevated)"; }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--c-bd2)"; el.style.background = "var(--c-surface)"; }}
                  >
                    <Layers className="w-4 h-4" />
                    了解节点系统
                  </a>
                </div>
              </div>
            </div>

            {/* ── Stats row ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in" style={{ animationDelay: "60ms" }}>
              {[
                { value: "23+", label: "专业节点", sub: "Node Types" },
                { value: "12+", label: "AI 模型", sub: "AI Models" },
                { value: "4", label: "视频提供商", sub: "Video Providers" },
                { value: "8", label: "界面主题", sub: "UI Themes" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl p-4 text-center"
                  style={{
                    background: "var(--c-surface)",
                    border: "1px solid var(--c-bd1)",
                  }}
                >
                  <div
                    className="text-2xl font-bold tracking-tight mb-1"
                    style={{ color: "oklch(0.78 0.16 285)" }}
                  >
                    {s.value}
                  </div>
                  <div className="text-xs font-medium mb-0.5" style={{ color: "var(--c-t2)" }}>
                    {s.label}
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--c-t4)" }}>
                    {s.sub}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Feature entries grid ───────────────────────────────────── */}
            <div id="features" className="animate-fade-in" style={{ animationDelay: "120ms" }}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>功能入口</h2>
                <span className="text-[11px]" style={{ color: "var(--c-t4)" }}>Features</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {
                    icon: Layers, color: "oklch(0.68 0.22 285)",
                    title: "节点式工作流",
                    desc: "脚本 / 分镜 / 提示词 / 图像 / 视频 / 剪辑节点可视化连线",
                    badge: null,
                  },
                  {
                    icon: Wand2, color: "oklch(0.72 0.20 330)",
                    title: "AI 图像生成",
                    desc: "Manus Forge · Poyo · Higgsfield Soul / Flux Pro / Seedream / Reve",
                    badge: null,
                  },
                  {
                    icon: Video, color: "oklch(0.62 0.20 25)",
                    title: "AI 视频生成",
                    desc: "Higgsfield DoP · Poyo Seedance / Veo / Kling / Wan / Runway",
                    badge: null,
                  },
                  {
                    icon: Boxes, color: "oklch(0.68 0.20 100)",
                    title: "ComfyUI 自建集成",
                    desc: "接入自建 ComfyUI 服务器，txt2img / img2img / AnimateDiff / SVD",
                    badge: "NEW",
                  },
                  {
                    icon: Bot, color: "oklch(0.70 0.18 200)",
                    title: "大模型对话",
                    desc: "Claude Sonnet 4.6 · Gemini 2.5 Flash · GPT-5.2，写脚本 / 润色 / 审查",
                    badge: null,
                  },
                  {
                    icon: Users, color: "oklch(0.66 0.18 140)",
                    title: "多人实时协作",
                    desc: "多用户同时编辑，节点变更秒同步，协作者光标可见",
                    badge: null,
                  },
                  {
                    icon: MessageCircle, color: "oklch(0.70 0.18 285)",
                    title: "团队聊天 · 桌面应用",
                    desc: "大厅 / 群聊 / 端到端加密私聊，可装为 Chrome 桌面应用，含专属浅色主题",
                    badge: "NEW",
                  },
                ].map((f) => (
                  <div
                    key={f.title}
                    className="relative p-4 rounded-xl transition-all duration-200"
                    style={{
                      background: "var(--c-surface)",
                      border: "1px solid var(--c-bd1)",
                    }}
                    onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = `${f.color}50`; el.style.background = "var(--c-elevated)"; }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--c-bd1)"; el.style.background = "var(--c-surface)"; }}
                  >
                    {f.badge && (
                      <span
                        className="absolute top-3 right-3 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide"
                        style={{
                          background: `${f.color}24`,
                          color: f.color,
                          border: `1px solid ${f.color}45`,
                        }}
                      >
                        {f.badge}
                      </span>
                    )}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                      style={{
                        background: `${f.color}18`,
                        border: `1px solid ${f.color}30`,
                      }}
                    >
                      <f.icon className="w-4 h-4" style={{ color: f.color }} />
                    </div>
                    <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--c-t1)" }}>{f.title}</h3>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--c-t4)" }}>{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Workflow showcase ──────────────────────────────────────── */}
            <div
              className="rounded-xl p-5 animate-fade-in"
              style={{
                background: "var(--c-surface)",
                border: "1px solid var(--c-bd1)",
                animationDelay: "180ms",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4" style={{ color: "oklch(0.68 0.22 285)" }} />
                  <h2 className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>典型工作流</h2>
                </div>
                <span className="text-[11px]" style={{ color: "var(--c-t4)" }}>Workflow Examples</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {[
                  {
                    title: "短视频脚本 → 成片",
                    nodes: ["脚本", "AI生成分镜", "图像生成", "视频任务", "字幕", "合并"],
                    desc: "从一段创意描述到含字幕的完整短视频，全部 AI 自动化",
                  },
                  {
                    title: "图生视频",
                    nodes: ["素材/图像生成", "ComfyUI 图像", "视频任务 (DoP)", "剪辑"],
                    desc: "上传/生成参考图，用 DoP 或 Kling 转视频，自动剪辑",
                  },
                  {
                    title: "智能字幕配音",
                    nodes: ["音频", "智能剪辑", "字幕转录", "动态字幕", "叠加"],
                    desc: "Whisper 语音转录 + AI 删减冗余 + 卡拉OK 风格动态字幕",
                  },
                ].map((w) => (
                  <div
                    key={w.title}
                    className="flex items-center gap-3 p-3 rounded-lg"
                    style={{
                      background: "var(--c-base)",
                      border: "1px solid var(--c-bd1)",
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--c-t1)" }}>{w.title}</div>
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {w.nodes.map((n, i) => (
                          <span key={i} className="inline-flex items-center gap-1">
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{
                                background: "oklch(0.68 0.22 285 / 0.10)",
                                color: "oklch(0.80 0.15 285)",
                                border: "1px solid oklch(0.68 0.22 285 / 0.20)",
                              }}
                            >
                              {n}
                            </span>
                            {i < w.nodes.length - 1 && (
                              <span className="text-[9px]" style={{ color: "var(--c-t4)" }}>→</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <p className="text-[10.5px]" style={{ color: "var(--c-t4)" }}>{w.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Authenticated dashboard ──────────────────────────────────────────────
  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden">
      <GridBackground />

      {/* Nav */}
      <nav
        className="relative z-10 flex items-center justify-between px-6 py-4 border-b"
        style={{ background: "color-mix(in oklch, var(--c-base) 92%, transparent)", backdropFilter: "blur(20px)", borderColor: "var(--c-bd1)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
            }}
          >
            <Film className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight" style={{ color: "var(--c-t1)" }}>
            AI Video Canvas
          </span>
        </div>

        {/* User */}
        {user && (
          <div className="flex items-center gap-2.5">
            <a
              href="/chat"
              className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
              style={{
                color: "oklch(0.78 0.16 285)",
                border: "1px solid oklch(0.68 0.22 285 / 0.35)",
                background: "color-mix(in oklch, oklch(0.68 0.22 285 / 0.12) 60%, transparent)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }}
              onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "oklch(0.68 0.22 285 / 0.6)"; el.style.background = "oklch(0.68 0.22 285 / 0.20)"; el.style.color = "oklch(0.86 0.12 285)"; }}
              onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "oklch(0.68 0.22 285 / 0.35)"; el.style.background = "color-mix(in oklch, oklch(0.68 0.22 285 / 0.12) 60%, transparent)"; el.style.color = "oklch(0.78 0.16 285)"; }}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              聊天
            </a>
            {user.role === "admin" && (
              <a
                href="/admin"
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 relative"
                style={{
                  color: "var(--c-t2)",
                  border: "1px solid var(--c-bd2)",
                  background: "color-mix(in oklch, var(--c-base) 55%, transparent)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                }}
                title={hasUpdate ? `有 ${updateInfo?.behind} 个新版本待更新` : "管理后台"}
                onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--c-t1)"; el.style.borderColor = "var(--c-bd3)"; el.style.background = "var(--c-overlay)"; }}
                onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--c-t2)"; el.style.borderColor = "var(--c-bd2)"; el.style.background = "color-mix(in oklch, var(--c-base) 55%, transparent)"; }}
              >
                管理后台
                {hasUpdate && (
                  <span
                    className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                    style={{ background: "oklch(0.65 0.22 25)", boxShadow: "0 0 0 2px var(--c-base)" }}
                  />
                )}
              </a>
            )}
            <span className="text-xs" style={{ color: "var(--c-t3)" }}>{user.name ?? user.email}</span>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
              style={{
                background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
              }}
            >
              {(user.name ?? user.email ?? "U")[0].toUpperCase()}
            </div>
            <button
              onClick={async () => {
                await logout();
                toast.success("已退出登录");
              }}
              title="退出登录"
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150"
              style={{
                background: "transparent",
                border: "1px solid var(--c-bd2)",
                color: "var(--c-t3)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "oklch(0.55 0.18 20 / 0.12)";
                (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.55 0.18 20 / 0.4)";
                (e.currentTarget as HTMLElement).style.color = "oklch(0.65 0.18 20)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd2)";
                (e.currentTarget as HTMLElement).style.color = "var(--c-t3)";
              }}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main className="relative z-10 flex-1 px-6 py-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--c-t1)" }}>
                我的项目
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--c-t4)" }}>
                {projects?.owned.length ?? 0} 个项目
                {(projects?.shared.length ?? 0) > 0 && (
                  <span style={{ marginLeft: 8 }}>· 协作中 {projects!.shared.length} 个</span>
                )}
              </p>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all duration-150"
              style={{
                background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                boxShadow: "0 0 0 1px oklch(0.68 0.22 285 / 0.3), 0 2px 12px oklch(0.68 0.22 285 / 0.2)",
                opacity: creating ? 0.6 : 1,
              }}
            >
              <Plus className="w-4 h-4" />
              {creating ? "创建中..." : "新建项目"}
            </button>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl h-[220px] animate-pulse"
                  style={{ border: "1px solid var(--c-bd1)", background: "var(--c-surface)" }}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-4">
                <NewProjectCard onClick={handleCreate} />
                {(projects?.owned ?? []).map((project: { id: number; name: string; description?: string | null; updatedAt: Date }) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => navigate(`/canvas/${project.id}`)}
                    onDelete={() => deleteProject.mutate({ id: project.id })}
                    onRename={(name) => updateProject.mutate({ id: project.id, name })}
                  />
                ))}
              </div>
              {(projects?.shared ?? []).length > 0 && (
                <div className="mt-10">
                  <h2 className="text-base font-semibold mb-3" style={{ color: "var(--c-t2)" }}>协作项目</h2>
                  <div className="grid grid-cols-4 gap-4">
                    {projects!.shared.map((project: { id: number; name: string; description?: string | null; updatedAt: Date }) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onOpen={() => navigate(`/canvas/${project.id}`)}
                        onDelete={() => { /* non-owner cannot delete */ }}
                        onRename={() => { /* non-owner rename restricted */ }}
                        readOnly
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Empty state */}
          {!loading && (projects?.owned.length ?? 0) === 0 && (projects?.shared.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{
                  background: "oklch(0.68 0.22 285 / 0.10)",
                  border: "1px solid oklch(0.68 0.22 285 / 0.20)",
                }}
              >
                <Film className="w-7 h-7" style={{ color: "oklch(0.68 0.22 285)" }} />
              </div>
              <h3 className="text-base font-semibold mb-2" style={{ color: "var(--c-t2)" }}>还没有项目</h3>
              <p className="text-sm mb-6" style={{ color: "var(--c-t4)" }}>创建你的第一个 AI 视频创作工作流</p>
              <button
                onClick={handleCreate}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white"
                style={{
                  background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                  boxShadow: "0 0 0 1px oklch(0.68 0.22 285 / 0.3), 0 4px 16px oklch(0.68 0.22 285 / 0.25)",
                }}
              >
                <Plus className="w-4 h-4" />
                新建项目
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Feature overview */}
          <div className="mt-12 pt-8 border-t" style={{ borderColor: "var(--c-bd1)" }}>
            <h2 className="text-base font-semibold mb-1" style={{ color: "var(--c-t1)" }}>
              21 种节点 · 全功能概览
            </h2>
            <p className="text-xs mb-6" style={{ color: "var(--c-t4)" }}>
              连接不同节点构建你的 AI 视频创作流水线
            </p>

            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  title: "创作层",
                  accentColor: "oklch(0.62 0.18 240)",
                  nodes: [
                    { label: "脚本", color: "oklch(0.62 0.18 240)" },
                    { label: "分镜", color: "oklch(0.65 0.20 160)" },
                    { label: "提示词", color: "oklch(0.68 0.22 300)" },
                    { label: "AI对话", color: "oklch(0.70 0.18 200)" },
                    { label: "便签", color: "oklch(0.60 0.10 90)" },
                    { label: "角色/场景", color: "oklch(0.66 0.18 140)" },
                  ],
                },
                {
                  title: "生成层",
                  accentColor: "oklch(0.72 0.20 330)",
                  nodes: [
                    { label: "图像生成", color: "oklch(0.72 0.20 330)" },
                    { label: "视频任务", color: "oklch(0.62 0.20 25)" },
                    { label: "素材", color: "oklch(0.65 0.18 60)" },
                    { label: "音频", color: "oklch(0.68 0.20 340)" },
                    { label: "构图控制", color: "oklch(0.65 0.20 310)" },
                  ],
                },
                {
                  title: "后期层",
                  accentColor: "oklch(0.68 0.20 55)",
                  nodes: [
                    { label: "剪辑", color: "oklch(0.68 0.20 55)" },
                    { label: "合并", color: "oklch(0.62 0.20 270)" },
                    { label: "叠加", color: "oklch(0.65 0.18 30)" },
                    { label: "字幕", color: "oklch(0.65 0.18 170)" },
                    { label: "动态字幕", color: "oklch(0.68 0.20 175)" },
                    { label: "智能剪辑", color: "oklch(0.68 0.22 65)" },
                    { label: "后处理", color: "oklch(0.65 0.18 190)" },
                  ],
                },
                {
                  title: "高级层",
                  accentColor: "oklch(0.65 0.18 350)",
                  nodes: [
                    { label: "声音克隆", color: "oklch(0.65 0.18 350)" },
                    { label: "唇形同步", color: "oklch(0.62 0.20 220)" },
                    { label: "数字人", color: "oklch(0.65 0.20 290)" },
                  ],
                },
              ].map((cat) => (
                <div
                  key={cat.title}
                  style={{
                    border: "1px solid var(--c-bd1)",
                    background: "var(--c-surface)",
                    borderRadius: 12,
                    padding: 20,
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: cat.accentColor,
                        flexShrink: 0,
                      }}
                    />
                    <span className="text-sm font-semibold" style={{ color: "var(--c-t2)" }}>
                      {cat.title}
                    </span>
                    <span className="text-xs" style={{ color: "var(--c-t4)" }}>
                      ({cat.nodes.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {cat.nodes.map((node) => (
                      <span
                        key={node.label}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 99,
                          border: `1px solid ${node.color.replace(")", " / 0.3)")}`,
                          background: node.color.replace(")", " / 0.1)"),
                          color: node.color,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {node.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
