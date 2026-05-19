import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  Film,
  Plus,
  Sparkles,
  Layers,
  Cpu,
  Users,
  ArrowRight,
  FolderOpen,
  Trash2,
  Clock,
  LogIn,
} from "lucide-react";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { data: projects, refetch } = trpc.projects.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      toast.success("项目已创建");
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      navigate(`/canvas/${project.id}`);
    },
    onError: () => toast.error("创建失败，请重试"),
  });

  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("项目已删除");
      refetch();
    },
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), description: newDesc.trim() || undefined });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ── */}
      <header className="fixed top-0 left-0 right-0 z-50 h-14 glass border-b border-border/50 flex items-center px-6 gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Film className="w-4 h-4 text-white" />
          </div>
          <span className="font-serif font-semibold text-base tracking-wide text-gradient">
            AI Video Canvas
          </span>
        </div>
        <div className="flex-1" />
        {isAuthenticated ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
                {user?.name?.[0]?.toUpperCase() ?? "U"}
              </div>
              <span className="text-sm text-muted-foreground">{user?.name}</span>
            </div>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-1.5 bg-primary hover:bg-primary/90"
            >
              <Plus className="w-3.5 h-3.5" />
              新建项目
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={() => (window.location.href = getLoginUrl())}
            className="gap-1.5"
          >
            <LogIn className="w-3.5 h-3.5" />
            登录
          </Button>
        )}
      </header>

      <main className="pt-14">
        {!isAuthenticated ? (
          /* ── Landing ── */
          <div className="min-h-[calc(100vh-56px)] flex flex-col">
            {/* Hero */}
            <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center relative overflow-hidden">
              <div className="absolute inset-0 canvas-grid opacity-30 pointer-events-none" />
              <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 max-w-3xl mx-auto animate-fade-in">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs text-muted-foreground mb-8">
                  <Sparkles className="w-3 h-3 text-primary" />
                  AI-Powered Visual Workflow for Filmmakers
                </div>
                <h1 className="font-serif text-5xl md:text-6xl font-bold leading-tight mb-6">
                  <span className="text-gradient">无限画布</span>
                  <br />
                  <span className="text-foreground/90">影视创作工作流</span>
                </h1>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
                  在无限画布上编排脚本、分镜、提示词与视频生成任务。
                  连接 AI 大模型，实现从创意到成片的全流程可视化协作。
                </p>
                <Button
                  size="lg"
                  onClick={() => (window.location.href = getLoginUrl())}
                  className="gap-2 bg-primary hover:bg-primary/90 glow-primary px-8 h-12 text-base"
                >
                  开始创作
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </section>

            {/* Features */}
            <section className="py-20 px-6 border-t border-border/30">
              <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  {
                    icon: Layers,
                    color: "text-[oklch(0.62_0.18_240)]",
                    bg: "bg-[oklch(0.62_0.18_240/0.1)]",
                    title: "节点式工作流",
                    desc: "脚本、分镜、提示词、素材节点自由编排，可视化连线",
                  },
                  {
                    icon: Sparkles,
                    color: "text-[oklch(0.68_0.22_300)]",
                    bg: "bg-[oklch(0.68_0.22_300/0.1)]",
                    title: "AI 创作助手",
                    desc: "内嵌大模型对话，扩写脚本、生成提示词、分镜图像一键生成",
                  },
                  {
                    icon: Film,
                    color: "text-[oklch(0.62_0.20_25)]",
                    bg: "bg-[oklch(0.62_0.20_25/0.1)]",
                    title: "视频生成任务",
                    desc: "对接 Runway、Kling 等主流 API，任务状态实时追踪",
                  },
                  {
                    icon: Users,
                    color: "text-[oklch(0.70_0.18_200)]",
                    bg: "bg-[oklch(0.70_0.18_200/0.1)]",
                    title: "多人实时协作",
                    desc: "多用户同时编辑，节点变更实时同步，协作者光标可见",
                  },
                ].map(({ icon: Icon, color, bg, title, desc }) => (
                  <div key={title} className="glass rounded-xl p-6 animate-scale-in">
                    <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center mb-4`}>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    <h3 className="font-medium text-foreground mb-2">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          /* ── Dashboard ── */
          <div className="max-w-6xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="font-serif text-2xl font-semibold text-foreground">我的项目</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {projects?.length ?? 0} 个画布项目
                </p>
              </div>
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5 bg-primary hover:bg-primary/90">
                <Plus className="w-4 h-4" />
                新建项目
              </Button>
            </div>

            {!projects || projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <FolderOpen className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground mb-4">还没有项目，创建第一个画布吧</p>
                <Button onClick={() => setCreateOpen(true)} variant="outline" className="gap-1.5">
                  <Plus className="w-4 h-4" />
                  新建项目
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="group glass rounded-xl overflow-hidden cursor-pointer hover:border-primary/40 transition-all duration-200 hover:node-shadow"
                    onClick={() => navigate(`/canvas/${project.id}`)}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-video bg-muted relative overflow-hidden">
                      {project.thumbnail ? (
                        <img src={project.thumbnail} alt={project.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full canvas-grid flex items-center justify-center">
                          <Film className="w-8 h-8 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-xs font-medium">
                          <ArrowRight className="w-3 h-3" />
                          打开画布
                        </div>
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm text-foreground truncate">{project.name}</h3>
                          {project.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {project.description}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("确认删除此项目？")) {
                              deleteMutation.mutate({ id: project.id });
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 hover:text-destructive transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass border-border/60 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">新建画布项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">项目名称 *</label>
              <Input
                placeholder="我的影视项目"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="bg-input/50"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">项目描述（可选）</label>
              <Input
                placeholder="简短描述这个项目..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="bg-input/50"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createMutation.isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {createMutation.isPending ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
