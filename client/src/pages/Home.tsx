import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Plus,
  Film,
  KeyRound,
  Clapperboard,
  ArrowRight,
  MoreHorizontal,
  Trash2,
  Pencil,
  Check,
  X,
  Layers,
  Wand2,
  Users,
  User,
  Zap,
  Clock,
  ChevronRight,
  LogOut,
  Sparkles,
  Video,
  Boxes,
  Bot,
  MessageCircle,
  Music,
  Wallet,
  RefreshCw,
  Bookmark,
  Palette,
  Upload,
  ScrollText,
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
// The cover is persisted in `thumbnail` as a JSON array of 1–4 image URLs;
// legacy single-URL strings are still accepted.
function parseCovers(thumbnail?: string | null): string[] {
  if (!thumbnail) return [];
  if (thumbnail.startsWith("[")) {
    try {
      const a = JSON.parse(thumbnail);
      return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  }
  return [thumbnail];
}

interface Project {
  id: number;
  name: string;
  description?: string | null;
  updatedAt: Date;
  thumbnail?: string | null;
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
  onRename,
  onRefreshCover,
  refreshingCover = false,
  readOnly = false,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onRefreshCover?: () => void;
  refreshingCover?: boolean;
  readOnly?: boolean;
}) {
  // Cover may be a single image or (4+ available) a 2×2 grid. Upstream temp URLs
  // can expire — on single-cover load failure, auto-swap to another image
  // (bounded to avoid loops) and otherwise fall back to the placeholder.
  const covers = parseCovers(project.thumbnail);
  const isGrid = covers.length >= 4;
  const [coverFailed, setCoverFailed] = useState(false);
  const swapAttempts = useRef(0);
  useEffect(() => { setCoverFailed(false); }, [project.thumbnail]);
  const showCover = covers.length > 0 && !coverFailed;
  const handleCoverError = () => {
    setCoverFailed(true);
    if (onRefreshCover && swapAttempts.current < 3) {
      swapAttempts.current += 1;
      onRefreshCover(); // server prefers stable /manus-storage paths
    }
  };
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

        {/* Auto-filled cover: 2×2 grid when 4+ images, else a single image */}
        {showCover && (isGrid ? (
          <div className="absolute inset-0 z-[5] grid grid-cols-2 grid-rows-2 gap-px">
            {covers.slice(0, 4).map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
              />
            ))}
          </div>
        ) : (
          <img
            src={covers[0]}
            alt=""
            className="absolute inset-0 w-full h-full object-cover z-[5]"
            loading="lazy"
            onError={handleCoverError}
          />
        ))}

        {/* Center icon (placeholder shown only when no cover) */}
        {!showCover && (
          <div
            className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: "oklch(0.68 0.22 285 / 0.15)",
              border: "1px solid oklch(0.68 0.22 285 / 0.3)",
            }}
          >
            <Film className="w-5 h-5" style={{ color: "oklch(0.68 0.22 285)" }} />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity z-[6]" style={{ background: "var(--c-overlay)" }} />

        {/* Refresh cover button (editors only). Top-LEFT so it doesn't cover the
            ⋯ menu (rename/delete) which lives at top-right. */}
        {onRefreshCover && (
          <button
            className="absolute top-2 left-2 z-20 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: "oklch(0 0 0 / 0.55)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer" }}
            title="换一张封面（从项目里的图片中选取）"
            onClick={(e) => { e.stopPropagation(); onRefreshCover(); }}
            disabled={refreshingCover}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingCover ? "animate-spin" : ""}`} />
          </button>
        )}
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

      {/* Menu button (⋯ rename/delete) — z-20 so the thumbnail hover overlay
          never sits above it and steals the click. */}
      {!readOnly && <div
        ref={menuRef}
        className="absolute top-3 right-3 z-20"
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

// ── Library (用户仓库) entry card ─────────────────────────────────────────────
// Mirrors the ProjectCard footprint so it sits cleanly in the grid. The cover is
// a 2×2 collage of the user's most recent images (falls back to an icon).
function LibraryEntryCard({ covers, count, onOpen }: { covers: string[]; count: number; onOpen: () => void }) {
  const accent = "oklch(0.65 0.18 60)"; // 素材库主色（琥珀金）
  const grid = covers.slice(0, 4);
  return (
    <div
      className="group relative flex flex-col rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={onOpen}
      style={{
        borderColor: `${accent.replace(")", " / 0.35)")}`,
        background: "var(--c-surface)",
        boxShadow: "0 1px 2px oklch(0 0 0 / 0.2), 0 4px 16px oklch(0 0 0 / 0.1)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = accent; (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${accent.replace(")", " / 0.35)")}`; (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
    >
      {/* Cover */}
      <div className="relative h-36 flex items-center justify-center overflow-hidden" style={{ background: `${accent.replace(")", " / 0.07)")}` }}>
        {grid.length > 0 ? (
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px">
            {grid.map((url, i) => (
              <img key={i} src={url} alt="" loading="lazy" className="w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
            ))}
            {/* fill empty cells when fewer than 4 images */}
            {Array.from({ length: Math.max(0, 4 - grid.length) }).map((_, i) => (
              <div key={`f${i}`} style={{ background: `${accent.replace(")", " / 0.05)")}` }} />
            ))}
          </div>
        ) : null}
        {/* Tint + icon overlay */}
        <div className="absolute inset-0" style={{ background: grid.length > 0 ? "oklch(0 0 0 / 0.35)" : "transparent" }} />
        <div className="relative z-10 w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${accent.replace(")", " / 0.18)")}`, border: `1px solid ${accent.replace(")", " / 0.4)")}`, backdropFilter: "blur(4px)" }}>
          <Boxes className="w-5 h-5" style={{ color: accent }} />
        </div>
        <span className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide" style={{ background: `${accent.replace(")", " / 0.9)")}`, color: "oklch(0.15 0.02 60)" }}>
          仓库
        </span>
      </div>
      {/* Content */}
      <div className="flex flex-col gap-1 p-4">
        <h3 className="text-sm font-semibold leading-snug flex items-center gap-1.5" style={{ color: "var(--c-t1)" }}>
          素材库
          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" style={{ color: accent }} />
        </h3>
        <div className="flex items-center gap-1 text-xs" style={{ color: "var(--c-t4)" }}>
          <Boxes className="w-3 h-3" />
          <span>{count > 0 ? `${count} 个素材 · 跨项目` : "个人专有仓库"}</span>
        </div>
      </div>
    </div>
  );
}

// 视频剪辑器入口卡片 — 进入综合时间轴剪辑器（独立于画布节点）。
function EditorEntryCard({ onOpen }: { onOpen: () => void }) {
  const accent = "oklch(0.65 0.19 310)"; // 剪辑器主色（品红紫）
  return (
    <div
      className="group relative flex flex-col rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={onOpen}
      style={{
        borderColor: `${accent.replace(")", " / 0.35)")}`,
        background: "var(--c-surface)",
        boxShadow: "0 1px 2px oklch(0 0 0 / 0.2), 0 4px 16px oklch(0 0 0 / 0.1)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = accent; (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${accent.replace(")", " / 0.35)")}`; (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
    >
      <div className="relative h-36 flex items-center justify-center overflow-hidden" style={{ background: `${accent.replace(")", " / 0.07)")}` }}>
        <div className="relative z-10 w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${accent.replace(")", " / 0.18)")}`, border: `1px solid ${accent.replace(")", " / 0.4)")}` }}>
          <Clapperboard className="w-5 h-5" style={{ color: accent }} />
        </div>
        <span className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide" style={{ background: `${accent.replace(")", " / 0.9)")}`, color: "#fff" }}>
          剪辑器
        </span>
      </div>
      <div className="flex flex-col gap-1 p-4">
        <h3 className="text-sm font-semibold leading-snug flex items-center gap-1.5" style={{ color: "var(--c-t1)" }}>
          视频剪辑器
          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" style={{ color: accent }} />
        </h3>
        <div className="flex items-center gap-1 text-xs" style={{ color: "var(--c-t4)" }}>
          <Clapperboard className="w-3 h-3" />
          <span>时间轴剪辑 · 单遍导出</span>
        </div>
      </div>
    </div>
  );
}

// 平台介绍入口卡片 — 新标签打开单文件功能汇报网页（系统架构 / AI 模型矩阵 / 功能模块 / 特色一览）。
function PlatformIntroCard() {
  const accent = "oklch(0.7 0.16 200)"; // 平台介绍主色（青蓝）
  return (
    <div
      className="group relative flex flex-col rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={() => window.open("/platform-intro.html", "_blank", "noopener")}
      style={{
        borderColor: `${accent.replace(")", " / 0.35)")}`,
        background: "var(--c-surface)",
        boxShadow: "0 1px 2px oklch(0 0 0 / 0.2), 0 4px 16px oklch(0 0 0 / 0.1)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = accent; (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${accent.replace(")", " / 0.35)")}`; (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
    >
      <div className="relative h-36 flex items-center justify-center overflow-hidden" style={{ background: `${accent.replace(")", " / 0.07)")}` }}>
        <div className="relative z-10 w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${accent.replace(")", " / 0.18)")}`, border: `1px solid ${accent.replace(")", " / 0.4)")}` }}>
          <Sparkles className="w-5 h-5" style={{ color: accent }} />
        </div>
        <span className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide" style={{ background: `${accent.replace(")", " / 0.9)")}`, color: "#fff" }}>
          平台介绍
        </span>
      </div>
      <div className="flex flex-col gap-1 p-4">
        <h3 className="text-sm font-semibold leading-snug flex items-center gap-1.5" style={{ color: "var(--c-t1)" }}>
          功能总览
          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" style={{ color: accent }} />
        </h3>
        <div className="flex items-center gap-1 text-xs" style={{ color: "var(--c-t4)" }}>
          <Sparkles className="w-3 h-3" />
          <span>架构 · 模型 · 特色一览</span>
        </div>
      </div>
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
  const [showChangePw, setShowChangePw] = useState(false);
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);

  const { data: projects, refetch } = trpc.projects.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // 用户仓库（素材库）入口：轻量 summary（总数 + 最近图片封面），避免为一个角标拉取全量素材。
  const { data: librarySummary } = trpc.assets.summary.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const libraryCovers = librarySummary?.covers ?? [];

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

  // Auto-fill / refresh a project card cover from any image in the project.
  const [refreshingCover, setRefreshingCover] = useState<number | null>(null);
  const autoFilledRef = useRef<Set<number>>(new Set());
  const pickCover = trpc.projects.pickCover.useMutation();

  const refreshCover = async (projectId: number) => {
    setRefreshingCover(projectId);
    try {
      const res = await pickCover.mutateAsync({ id: projectId });
      if (res.covers.length > 0) await refetch();
      else toast.info("该项目还没有可用作封面的图片");
    } catch {
      /* non-fatal — leave the placeholder */
    } finally {
      setRefreshingCover(null);
    }
  };

  // One-time auto-fill: owned projects without a cover get one picked on load.
  useEffect(() => {
    for (const p of projects?.owned ?? []) {
      if (!p.thumbnail && !autoFilledRef.current.has(p.id)) {
        autoFilledRef.current.add(p.id);
        pickCover.mutateAsync({ id: p.id }).then((res) => { if (res.covers.length > 0) refetch(); }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects?.owned]);

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
      <div className="relative h-screen flex flex-col overflow-hidden">
        <GridBackground />

        {/* Nav */}
        <nav className="relative z-10 flex items-center justify-between px-8 py-5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center">
              <img src="/chat-icon.svg" alt="KingTai" className="w-full h-full object-cover" />
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
        <main className="relative z-10 flex-1 px-6 pb-16 overflow-y-auto">
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
                      className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center"
                      style={{ boxShadow: "0 4px 16px oklch(0.68 0.22 285 / 0.35)" }}
                    >
                      <img src="/chat-icon.svg" alt="KingTai" className="w-full h-full object-cover" />
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
                    icon: Clapperboard, color: "oklch(0.65 0.20 160)",
                    title: "分镜→成片流水线",
                    desc: "镜头表批量：关键帧图 → 生视频（云端/ComfyUI 免费三引擎）→ 配音（多角色分音色）→ 音效 → 一键「按镜头表装配」成片（镜号排序·逐镜转场·音轨对位），字幕零转录对位生成",
                    badge: "NEW",
                  },
                  {
                    icon: Wand2, color: "oklch(0.72 0.20 330)",
                    title: "AI 图像生成",
                    desc: "对齐 Poyo 全量 24 模型：Nano Banana Pro / GPT Image / Flux 2·Kontext / Seedream / Kling / Z-Image，含 Higgsfield Soul·Reve",
                    badge: "NEW",
                  },
                  {
                    icon: Video, color: "oklch(0.62 0.20 25)",
                    title: "AI 视频生成",
                    desc: "扩充至 37 模型：Sora 2 / Veo 3.1 / Kling 2.1~3.0 / Wan / Seedance / Hailuo / Runway / Higgsfield DoP",
                    badge: "NEW",
                  },
                  {
                    icon: Clapperboard, color: "oklch(0.65 0.19 310)",
                    title: "内置综合剪辑器",
                    desc: "多片段时间轴 · 单遍导出高素质成片；转场/特效/模糊填充/倒放/变速、富文本字幕、AI 配乐配音，撤销重做 + 自动保存",
                    badge: "NEW",
                  },
                  {
                    icon: Clapperboard, color: "oklch(0.68 0.20 55)",
                    title: "剪辑节点 · 专业升级",
                    desc: "双向裁剪+精确入出点/自定义倍速/截帧；多音轨混音（音量·延迟·淡入淡出·静音·独奏·语音闪避）、响度标准化+降噪、调色预设、裁剪比例/旋转、输出分辨率·帧率·格式，预览可循环",
                    badge: "NEW",
                  },
                  {
                    icon: User, color: "oklch(0.66 0.18 30)",
                    title: "角色一致性 · 全局角色库",
                    desc: "角色多视角参考图自动锁定身份，贯穿 ComfyUI 图/视频/工作流与 Poyo 图/视频；一键套用整组分镜、多角色优先级、一致性校验；角色存入全局库跨项目复用",
                    badge: "NEW",
                  },
                  {
                    icon: Bot, color: "oklch(0.70 0.18 250)",
                    title: "多智能体编排",
                    desc: "一个画布多个智能体各管各的：归属彩标、规划上下文隔离，一键选中/运行/清空我的节点，互不干扰",
                    badge: "NEW",
                  },
                  {
                    icon: Boxes, color: "oklch(0.68 0.20 100)",
                    title: "分类模型选择器",
                    desc: "图像 / 视频 / 对话统一选择器：按供应商与家族分组、可搜索，每模型标注消耗点数，按预算挑选",
                    badge: "NEW",
                  },
                  {
                    icon: Boxes, color: "oklch(0.68 0.20 100)",
                    title: "ComfyUI 自建集成",
                    desc: "图像（多 LoRA / ControlNet / IPAdapter / Inpaint / 放大）+ 视频（AnimateDiff / Wan / LTX，支持角色 LoRA）、自定义工作流；上游提示词优先/转发、运行后自动清显存、绑定失同步校验、随机/固定种子、批量出图",
                    badge: "NEW",
                  },
                  {
                    icon: Bookmark, color: "oklch(0.65 0.20 140)",
                    title: "ComfyUI 节点模板库",
                    desc: "右键 ComfyUI 节点把全部参数（含提示词/工作流）存为共享模板，全员可调用；按外框颜色分类、可搜索/注释/重命名，点击即新建带参节点",
                    badge: "NEW",
                  },
                  {
                    icon: Music, color: "oklch(0.70 0.18 340)",
                    title: "AI 配乐与配音",
                    desc: "音频节点接入 Suno / MiniMax 音乐与 ElevenLabs V3 文本转语音（TTS），一键生成背景音乐与旁白",
                    badge: "NEW",
                  },
                  {
                    icon: Wallet, color: "oklch(0.72 0.18 155)",
                    title: "Poyo 余额仪表盘",
                    desc: "顶栏实时显示剩余 Poyo 点数，配合模型选择器的点数标注，生成前掌握预算",
                    badge: "NEW",
                  },
                  {
                    icon: Bot, color: "oklch(0.70 0.18 200)",
                    title: "大模型对话",
                    desc: "Gemini 3 Flash · Claude Sonnet 4.5 · Haiku 4.5 · GPT-5.2，写脚本 / 润色 / 审查",
                    badge: null,
                  },
                  {
                    icon: Users, color: "oklch(0.66 0.18 140)",
                    title: "多人实时协作",
                    desc: "多用户同时编辑，节点变更秒同步，协作者光标可见；他人节点按创建者显示专属颜色标识，同项目编辑者共享素材库",
                    badge: "NEW",
                  },
                  {
                    icon: Palette, color: "oklch(0.66 0.20 300)",
                    title: "护眼主题与外观",
                    desc: "共 15 套主题：深色含 ComfyUI 炭灰，浅色新增 晴空 / 鼠尾草 / 暖砂 护眼配色；画布背景默认跟随主题，切换即变",
                    badge: "NEW",
                  },
                  {
                    icon: ScrollText, color: "oklch(0.62 0.18 240)",
                    title: "脚本 → ComfyUI 专业分镜",
                    desc: "目标模型支持 ComfyUI 主流（Qwen-Image / Flux.1 / Wan 2.2 / HunyuanVideo 等）；分镜携带景别 / 焦段 / 灯光 / 调色与反向提示词并写入下游",
                    badge: "NEW",
                  },
                  {
                    icon: Upload, color: "oklch(0.65 0.18 60)",
                    title: "素材库批量上传",
                    desc: "多选 / 拖拽 / 粘贴（Ctrl·⌘V）批量上传，视频点击全屏弹窗预览",
                    badge: "NEW",
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
    <div className="relative h-screen flex flex-col overflow-hidden">
      <GridBackground />

      {/* Nav */}
      <nav
        className="relative z-10 flex items-center justify-between px-6 py-4 border-b"
        style={{ background: "color-mix(in oklch, var(--c-base) 92%, transparent)", backdropFilter: "blur(20px)", borderColor: "var(--c-bd1)" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center">
            <img src="/chat-icon.svg" alt="KingTai" className="w-full h-full object-cover" />
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
              onClick={() => setShowChangePw(true)}
              title="修改密码"
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150"
              style={{ background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}
            >
              <KeyRound className="w-3.5 h-3.5" />
            </button>
            <ChangePasswordDialog open={showChangePw} onClose={() => setShowChangePw(false)} />
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
          {/* 个人仓库入口（独立于项目网格 — 跨项目素材库） */}
          {!loading && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold" style={{ color: "var(--c-t2)" }}>个人仓库</h2>
                <span className="text-[11px]" style={{ color: "var(--c-t4)" }}>跨项目素材</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <LibraryEntryCard
                  covers={libraryCovers}
                  count={librarySummary?.count ?? 0}
                  onOpen={() => navigate("/library")}
                />
                <EditorEntryCard onOpen={() => navigate("/editor")} />
                <PlatformIntroCard />
              </div>
            </div>
          )}

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
                {(projects?.owned ?? []).map((project: { id: number; name: string; description?: string | null; updatedAt: Date; thumbnail?: string | null }) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => navigate(`/canvas/${project.id}`)}
                    onDelete={() => deleteProject.mutate({ id: project.id })}
                    onRename={(name) => updateProject.mutate({ id: project.id, name })}
                    onRefreshCover={() => refreshCover(project.id)}
                    refreshingCover={refreshingCover === project.id}
                  />
                ))}
              </div>
              {(projects?.shared ?? []).length > 0 && (
                <div className="mt-10">
                  <h2 className="text-base font-semibold mb-3" style={{ color: "var(--c-t2)" }}>协作项目</h2>
                  <div className="grid grid-cols-4 gap-4">
                    {projects!.shared.map((project: { id: number; name: string; description?: string | null; updatedAt: Date; thumbnail?: string | null }) => (
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
