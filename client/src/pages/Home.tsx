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
} from "lucide-react";

// ── Animated background grid ─────────────────────────────────────────────────
function GridBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {/* Dot grid */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.035]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="dot-grid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="white" />
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
          background: "linear-gradient(to top, var(--color-background), transparent)",
        }}
      />
    </div>
  );
}

// ── Feature pill ─────────────────────────────────────────────────────────────
function FeaturePill({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/8 bg-white/4 text-xs text-white/50 font-medium">
      <Icon className="w-3 h-3 text-white/40" />
      {label}
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
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
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
      className="group relative flex flex-col rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.055] hover:border-white/14 transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={() => !menuOpen && !renaming && onOpen()}
      style={{
        boxShadow: "0 1px 2px oklch(0 0 0 / 0.4), 0 4px 16px oklch(0 0 0 / 0.2)",
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
          <div className="absolute top-4 left-6 w-16 h-8 rounded-md border border-white/20 bg-white/5" />
          <div className="absolute top-8 left-28 w-20 h-8 rounded-md border border-white/20 bg-white/5" />
          <div className="absolute top-16 left-12 w-24 h-8 rounded-md border border-white/20 bg-white/5" />
          <svg className="absolute inset-0 w-full h-full" style={{ overflow: "visible" }}>
            <line x1="88" y1="28" x2="112" y2="32" stroke="white" strokeWidth="1" strokeDasharray="3 2" opacity="0.3" />
            <line x1="148" y1="36" x2="120" y2="52" stroke="white" strokeWidth="1" strokeDasharray="3 2" opacity="0.3" />
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
        <div className="absolute inset-0 bg-white/[0.02] opacity-0 group-hover:opacity-100 transition-opacity" />
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
              className="flex-1 bg-white/8 border border-white/16 rounded-md px-2 py-1 text-sm text-white outline-none focus:border-brand"
              style={{ borderColor: "oklch(0.68 0.22 285 / 0.5)" }}
              autoFocus
            />
            <button
              onClick={() => { onRename(renameVal); setRenaming(false); }}
              className="p-1 rounded hover:bg-white/10 text-green-400"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setRenaming(false)}
              className="p-1 rounded hover:bg-white/10 text-white/40"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <h3 className="text-sm font-semibold text-white/90 truncate leading-snug">
            {project.name}
          </h3>
        )}
        <div className="flex items-center gap-1 text-xs text-white/30">
          <Clock className="w-3 h-3" />
          <span>{timeAgo(project.updatedAt)}</span>
        </div>
      </div>

      {/* Menu button */}
      <div
        ref={menuRef}
        className="absolute top-3 right-3"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10 text-white/50 hover:text-white"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {menuOpen && (
          <div
            className="absolute top-8 right-0 w-40 rounded-xl border border-white/10 overflow-hidden z-50 animate-scale-in"
            style={{
              background: "var(--c-surface)",
              boxShadow: "0 8px 32px oklch(0 0 0 / 0.6), 0 0 0 1px oklch(0.22 0.008 260 / 0.5)",
            }}
          >
            <button
              onClick={() => { setRenaming(true); setMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/70 hover:text-white hover:bg-white/6 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              重命名
            </button>
            <div className="h-px bg-white/8 mx-2" />
            <button
              onClick={() => { onDelete(); setMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400/80 hover:text-red-400 hover:bg-red-400/8 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除项目
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── New project card ──────────────────────────────────────────────────────────
function NewProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center justify-center rounded-xl border border-dashed border-white/12 hover:border-white/24 bg-transparent hover:bg-white/[0.025] transition-all duration-200 h-full min-h-[220px]"
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
      <span className="text-sm font-medium text-white/40 group-hover:text-white/60 transition-colors">
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
            <span className="text-sm font-semibold text-white/90 tracking-tight">
              AI Video Canvas
            </span>
          </div>

          <a
            href={getLoginUrl()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white/90 hover:text-white transition-all duration-150 border border-white/10 hover:border-white/20 hover:bg-white/5"
          >
            登录
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </nav>

        {/* Hero */}
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center" style={{ paddingTop: "6vh", paddingBottom: "12vh" }}>
          {/* Badge */}
          <div className="mb-8 animate-fade-in">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{
                background: "oklch(0.68 0.22 285 / 0.12)",
                border: "1px solid oklch(0.68 0.22 285 / 0.30)",
                color: "oklch(0.80 0.15 285)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "oklch(0.68 0.22 285)", boxShadow: "0 0 6px oklch(0.68 0.22 285)" }}
              />
              AI-Powered Visual Workflow
            </span>
          </div>

          {/* Headline */}
          <h1
            className="text-display text-gradient mb-6 animate-slide-up"
            style={{ animationDelay: "60ms" }}
          >
            无限画布
            <br />
            影视创作工作流
          </h1>

          {/* Sub */}
          <p
            className="max-w-lg text-base text-white/40 leading-relaxed mb-10 animate-slide-up"
            style={{ animationDelay: "120ms" }}
          >
            在无限画布上编排脚本、分镜、提示词与视频生成任务。
            <br />
            连接 AI 大模型，实现从创意到成片的全流程可视化协作。
          </p>

          {/* CTA */}
          <div
            className="flex items-center gap-3 animate-slide-up"
            style={{ animationDelay: "180ms" }}
          >
            <a
              href={getLoginUrl()}
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200"
              style={{
                background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                boxShadow: "0 0 0 1px oklch(0.68 0.22 285 / 0.4), 0 4px 24px oklch(0.68 0.22 285 / 0.3)",
              }}
            >
              开始创作
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* Feature pills */}
          <div
            className="flex flex-wrap items-center justify-center gap-2 mt-12 animate-fade-in"
            style={{ animationDelay: "280ms" }}
          >
            <FeaturePill icon={Layers} label="节点式工作流" />
            <FeaturePill icon={Wand2} label="AI 图像生成" />
            <FeaturePill icon={Film} label="视频任务对接" />
            <FeaturePill icon={Users} label="多人实时协作" />
            <FeaturePill icon={Zap} label="大模型对话" />
          </div>
        </main>

        {/* Feature cards row */}
        <div
          className="relative z-10 px-8 pb-16 animate-fade-in"
          style={{ animationDelay: "320ms" }}
        >
          <div className="grid grid-cols-4 gap-3 max-w-4xl mx-auto">
            {[
              { icon: Layers, title: "节点式工作流", desc: "脚本、分镜、提示词节点自由编排，可视化连线" },
              { icon: Wand2, title: "AI 创作助手", desc: "内嵌大模型对话，扩写脚本、生成提示词、分镜图像一键生成" },
              { icon: Film, title: "视频生成任务", desc: "对接 Higgsfield、Poyo 等主流 AI 视频 API，任务状态实时追踪" },
              { icon: Users, title: "多人实时协作", desc: "多用户同时编辑，节点变更时同步，协作者光标可见" },
            ].map((f) => (
              <div
                key={f.title}
                className="p-4 rounded-xl border border-white/6 bg-white/[0.025]"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                  style={{
                    background: "oklch(0.68 0.22 285 / 0.12)",
                    border: "1px solid oklch(0.68 0.22 285 / 0.20)",
                  }}
                >
                  <f.icon className="w-4 h-4" style={{ color: "oklch(0.75 0.18 285)" }} />
                </div>
                <h3 className="text-sm font-semibold text-white/80 mb-1">{f.title}</h3>
                <p className="text-xs text-white/35 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Authenticated dashboard ──────────────────────────────────────────────
  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden">
      <GridBackground />

      {/* Nav */}
      <nav
        className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/6"
        style={{ background: "oklch(0.07 0.005 260 / 0.95)", backdropFilter: "blur(20px)" }}
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
          <span className="text-sm font-semibold text-white/90 tracking-tight">
            AI Video Canvas
          </span>
        </div>

        {/* User */}
        {user && (
          <div className="flex items-center gap-2.5">
            {user.role === "admin" && (
              <a
                href="/admin"
                className="text-xs text-white/40 hover:text-white/70 transition-colors px-2 py-1 rounded-md hover:bg-white/5"
              >
                管理后台
              </a>
            )}
            <span className="text-xs text-white/40">{user.name ?? user.email}</span>
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
              <h1 className="text-xl font-semibold text-white/90 tracking-tight">
                我的项目
              </h1>
              <p className="text-xs text-white/35 mt-0.5">
                {projects?.length ?? 0} 个项目
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
                  className="rounded-xl border border-white/6 bg-white/[0.025] h-[220px] animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              <NewProjectCard onClick={handleCreate} />
              {(projects ?? []).map((project: { id: number; name: string; description?: string | null; updatedAt: Date }) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => navigate(`/canvas/${project.id}`)}
                  onDelete={() => deleteProject.mutate({ id: project.id })}
                  onRename={(name) => updateProject.mutate({ id: project.id, name })}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && (projects ?? []).length === 0 && (
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
              <h3 className="text-base font-semibold text-white/70 mb-2">还没有项目</h3>
              <p className="text-sm text-white/30 mb-6">创建你的第一个 AI 视频创作工作流</p>
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
        </div>
      </main>
    </div>
  );
}
