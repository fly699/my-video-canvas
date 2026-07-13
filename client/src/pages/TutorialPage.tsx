import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Search, BookOpen, Upload, RotateCcw, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { TUTORIAL_CHAPTERS, type TutorialChapter, type TutorialSection } from "../lib/tutorialContent";

/**
 * #116 可视化交互教程中心（/tutorial）。
 * - 左侧章节树 + 右侧内容；搜索过滤；阅读进度（localStorage，按小节记）。
 * - 截图可替换：正文只引用 slug；加载顺序 = 管理员自定义 URL（system.tutorialImages）
 *   → 内置默认图 /tutorial/<slug>.png → 占位框。管理员在图上直接「更换 / 恢复默认」。
 */

const READ_KEY = "avc:tutorial:read:v1";
function loadRead(): Set<string> {
  try { const a = JSON.parse(localStorage.getItem(READ_KEY) || "[]"); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); }
}

function TutorialImage({ slug, caption, overrides, isAdmin }: {
  slug: string; caption: string; overrides: Record<string, string>; isAdmin: boolean;
}) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [broken, setBroken] = useState(false);
  const uploadMut = trpc.upload.uploadImage.useMutation();
  const setMut = trpc.system.setTutorialImage.useMutation({
    onSuccess: () => { void utils.system.tutorialImages.invalidate(); toast.success("截图已更换"); },
    onError: (e) => toast.error("更换失败：" + e.message),
  });
  const resetMut = trpc.system.resetTutorialImage.useMutation({
    onSuccess: () => { void utils.system.tutorialImages.invalidate(); setBroken(false); toast.success("已恢复默认截图"); },
    onError: (e) => toast.error("恢复失败：" + e.message),
  });
  const custom = overrides[slug];
  const src = custom ?? `/tutorial/${slug}.png`;
  const busy = uploadMut.isPending || setMut.isPending || resetMut.isPending;

  const pickFile = () => fileRef.current?.click();
  const onFile = async (f: File | undefined) => {
    if (!f) return;
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

  return (
    <figure style={{ margin: "14px 0" }}>
      <div className="group/timg" style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid var(--c-bd2)", background: "var(--c-input)" }}>
        {broken && !custom ? (
          <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--c-t4)", fontSize: 12 }}>
            截图待补（{slug}）{isAdmin ? " —— 点右上角「更换」上传一张" : ""}
          </div>
        ) : (
          <img key={src} src={src} alt={caption} loading="lazy" draggable={false}
            onError={() => setBroken(true)}
            style={{ width: "100%", display: "block" }} />
        )}
        {isAdmin && (
          <div className="opacity-0 group-hover/timg:opacity-100" style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6, transition: "opacity 150ms ease" }}>
            <button onClick={pickFile} disabled={busy} title="上传一张新截图替换（立即对所有用户生效）"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 9px", borderRadius: 8, fontSize: 10.5, fontWeight: 700, background: "oklch(0 0 0 / 0.72)", border: "1px solid oklch(1 0 0 / 0.25)", color: "#fff", cursor: "pointer", backdropFilter: "blur(6px)" }}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} 更换
            </button>
            {custom && (
              <button onClick={() => resetMut.mutate({ slug })} disabled={busy} title="删除自定义截图，恢复内置默认图"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 9px", borderRadius: 8, fontSize: 10.5, fontWeight: 700, background: "oklch(0 0 0 / 0.72)", border: "1px solid oklch(1 0 0 / 0.25)", color: "#fff", cursor: "pointer", backdropFilter: "blur(6px)" }}>
                <RotateCcw size={11} /> 恢复默认
              </button>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <figcaption style={{ marginTop: 6, fontSize: 11, color: "var(--c-t4)", textAlign: "center" }}>{caption}{custom ? "（已自定义）" : ""}</figcaption>
    </figure>
  );
}

function Kbd({ k }: { k: string }) {
  return <kbd className="font-mono" style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 6, background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)" }}>{k}</kbd>;
}

function SectionView({ chapter, section, overrides, isAdmin, read, onRead }: {
  chapter: TutorialChapter; section: TutorialSection; overrides: Record<string, string>; isAdmin: boolean;
  read: boolean; onRead: () => void;
}) {
  return (
    <section id={`${chapter.id}-${section.id}`} style={{ marginBottom: 30, scrollMarginTop: 70 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: "var(--c-t1)" }}>{section.title}</h3>
        <button onClick={onRead} title={read ? "已读" : "标记已读"}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 20, padding: "0 8px", borderRadius: 10, fontSize: 9.5, fontWeight: 700, cursor: "pointer",
            background: read ? "oklch(0.72 0.18 155 / 0.15)" : "var(--c-surface)", border: `1px solid ${read ? "oklch(0.72 0.18 155 / 0.5)" : "var(--c-bd2)"}`, color: read ? "oklch(0.72 0.18 155)" : "var(--c-t4)" }}>
          <Check size={10} /> {read ? "已读" : "标记已读"}
        </button>
      </div>
      {section.keys && (
        <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          {section.keys.map((combo, i) => (
            <span key={i} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
              {combo.map((k, j) => <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{j > 0 && <span style={{ color: "var(--c-t4)", fontSize: 10 }}>+</span>}<Kbd k={k} /></span>)}
            </span>
          ))}
        </div>
      )}
      {section.paragraphs.map((p, i) => (
        <p key={i} style={{ margin: "0 0 8px", fontSize: 13, lineHeight: 1.85, color: "var(--c-t2)" }}>{p}</p>
      ))}
      {section.bullets && (
        <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          {section.bullets.map((b, i) => <li key={i} style={{ fontSize: 12.5, lineHeight: 1.8, color: "var(--c-t2)" }}>{b}</li>)}
        </ul>
      )}
      {section.image && <TutorialImage slug={section.image.slug} caption={section.image.caption} overrides={overrides} isAdmin={isAdmin} />}
      {section.tip && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: "oklch(0.68 0.16 250 / 0.10)", border: "1px solid oklch(0.68 0.16 250 / 0.30)", fontSize: 12, lineHeight: 1.7, color: "var(--c-t2)" }}>
          💡 {section.tip}
        </div>
      )}
    </section>
  );
}

export default function TutorialPage() {
  const { user } = useAuth();
  const isAdmin = ((user as { role?: string } | null)?.role === "admin");
  const imagesQ = trpc.system.tutorialImages.useQuery(undefined, { staleTime: 30_000, retry: false });
  const overrides = imagesQ.data?.images ?? {};
  const [query, setQuery] = useState("");
  const [activeChapter, setActiveChapter] = useState(TUTORIAL_CHAPTERS[0].id);
  const [read, setRead] = useState<Set<string>>(() => loadRead());

  const markRead = (key: string) => {
    setRead((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(READ_KEY, JSON.stringify(Array.from(next))); } catch { /* quota */ }
      return next;
    });
  };

  const totalSections = useMemo(() => TUTORIAL_CHAPTERS.reduce((n, c) => n + c.sections.length, 0), []);
  const readCount = useMemo(() => {
    let n = 0;
    for (const c of TUTORIAL_CHAPTERS) for (const s of c.sections) if (read.has(`${c.id}/${s.id}`)) n++;
    return n;
  }, [read]);

  // 搜索：命中标题/正文的小节；无搜索词时显示当前章
  const q = query.trim();
  const filtered = useMemo(() => {
    if (!q) return null;
    const hits: { chapter: TutorialChapter; section: TutorialSection }[] = [];
    for (const c of TUTORIAL_CHAPTERS) for (const s of c.sections) {
      const hay = `${c.title} ${s.title} ${s.paragraphs.join(" ")} ${(s.bullets ?? []).join(" ")}`;
      if (hay.includes(q)) hits.push({ chapter: c, section: s });
    }
    return hits;
  }, [q]);

  const chapter = TUTORIAL_CHAPTERS.find((c) => c.id === activeChapter) ?? TUTORIAL_CHAPTERS[0];

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ background: "var(--c-canvas)" }}>
      {/* 顶栏 */}
      <header className="flex items-center flex-shrink-0 gap-3" style={{ height: 46, padding: "0 14px", background: "color-mix(in oklch, var(--c-base) 60%, transparent)", borderBottom: "1px solid var(--c-bd1)", backdropFilter: "blur(16px)" }}>
        <Link href="/" title="返回首页" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, color: "var(--c-t2)" }}>
          <ArrowLeft size={16} />
        </Link>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "var(--c-t1)" }}>
          <BookOpen size={15} /> 详细教程
        </span>
        <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>已读 {readCount}/{totalSections} 节</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, width: "min(320px, 40vw)", height: 30, padding: "0 10px", borderRadius: 10, background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
          <Search size={13} style={{ color: "var(--c-t4)", flexShrink: 0 }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索教程内容…"
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 12, color: "var(--c-t1)" }} />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧章节树 */}
        <nav className="flex-shrink-0 overflow-y-auto" style={{ width: 230, borderRight: "1px solid var(--c-bd1)", padding: "12px 8px", background: "color-mix(in oklch, var(--c-base) 40%, transparent)" }}>
          {TUTORIAL_CHAPTERS.map((c) => {
            const active = !q && c.id === activeChapter;
            const done = c.sections.every((s) => read.has(`${c.id}/${s.id}`));
            return (
              <button key={c.id} onClick={() => { setQuery(""); setActiveChapter(c.id); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 9, marginBottom: 2, textAlign: "left", cursor: "pointer",
                  background: active ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 14%, transparent)" : "transparent",
                  border: `1px solid ${active ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 45%, transparent)" : "transparent"}` }}>
                <span style={{ fontSize: 14 }}>{c.icon}</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? "var(--c-t1)" : "var(--c-t2)" }}>{c.title}</span>
                {done && <Check size={12} style={{ color: "oklch(0.72 0.18 155)" }} />}
              </button>
            );
          })}
        </nav>

        {/* 右侧内容 */}
        <main className="flex-1 overflow-y-auto" style={{ padding: "22px clamp(16px, 5vw, 64px) 60px" }}>
          <div style={{ maxWidth: 780, margin: "0 auto" }}>
            {filtered ? (
              <>
                <p style={{ fontSize: 12, color: "var(--c-t4)", marginBottom: 16 }}>搜索「{q}」：{filtered.length} 个匹配小节</p>
                {filtered.length === 0 && <p style={{ fontSize: 13, color: "var(--c-t3)" }}>没有匹配内容——换个关键词试试，或直接问画布助手。</p>}
                {filtered.map(({ chapter: c, section: s }) => (
                  <div key={`${c.id}/${s.id}`} style={{ marginBottom: 8 }}>
                    <p style={{ fontSize: 10.5, color: "var(--c-t4)", margin: "0 0 4px" }}>{c.icon} {c.title}</p>
                    <SectionView chapter={c} section={s} overrides={overrides} isAdmin={isAdmin}
                      read={read.has(`${c.id}/${s.id}`)} onRead={() => markRead(`${c.id}/${s.id}`)} />
                  </div>
                ))}
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "0 0 4px" }}>
                  <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: "var(--c-t1)" }}>{chapter.icon} {chapter.title}</h2>
                  {/* #116 第四批「亲手试一试」：写入跨标签页标志——画布（已开的标签页经
                      storage 事件立即、未开的下次进入时）从对应导览步启动聚光高亮。 */}
                  {chapter.guideStep && (
                    <button
                      onClick={() => {
                        try { localStorage.setItem("avc:tutorial:tryit", JSON.stringify({ step: chapter.guideStep, at: Date.now() })); } catch { /* restricted */ }
                        toast.success("已发送到画布：切回画布标签页自动开始该功能的导览高亮（未开画布则进入任意项目后自动开始）", { duration: 4000 });
                      }}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 12px", borderRadius: 99, fontSize: 12, fontWeight: 700, background: "color-mix(in oklch, var(--color-brand, oklch(0.62 0.2 285)) 16%, transparent)", color: "var(--c-t1)", border: "1px solid color-mix(in oklch, var(--color-brand, oklch(0.62 0.2 285)) 45%, transparent)", cursor: "pointer" }}
                    >
                      🎯 亲手试一试
                    </button>
                  )}
                </div>
                <p style={{ margin: "0 0 22px", fontSize: 12.5, color: "var(--c-t3)" }}>{chapter.intro}</p>
                {chapter.sections.map((s) => (
                  <SectionView key={s.id} chapter={chapter} section={s} overrides={overrides} isAdmin={isAdmin}
                    read={read.has(`${chapter.id}/${s.id}`)} onRead={() => markRead(`${chapter.id}/${s.id}`)} />
                ))}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
