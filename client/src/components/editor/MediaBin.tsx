import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FileVideo, FileAudio, FileImage, Search, Type as TypeIcon, Captions, Plus, Music, RefreshCw, Upload, Square, Scissors, LayoutGrid, GalleryVertical, List } from "lucide-react";
import { usePersistentState } from "@/hooks/usePersistentState";
import { MediaPreview, type PreviewAsset } from "./MediaPreview";
import { MusicGen } from "./MusicGen";
import { AutoCompose } from "./AutoCompose";
import { EC } from "./theme";
import { useEditorStore, kindFromAssetType, trackEnd, clipDuration } from "./editorStore";
import { probeMediaDuration } from "./theme";
import { parseSrt } from "@shared/srt";

type TypeFilter = "" | "image" | "video" | "audio";

/** The asset payload carried via drag-and-drop into the timeline. */
export interface MediaDragPayload {
  assetId?: number;
  url: string;
  name: string;
  kind: "video" | "image" | "audio";
}
export const MEDIA_DND_MIME = "application/x-editor-media";

type BinView = "grid" | "large" | "list";

export function MediaBin({ width = 252 }: { width?: number } = {}) {
  const [type, setType] = useState<TypeFilter>("");
  const [q, setQ] = useState("");
  // 素材库视图：网格（小图标）/ 超大图标 / 详细信息列表，持久化。
  const [view, setView] = usePersistentState<BinView>("ui:editor:mediabin-view:v1", "grid", {
    validate: (p) => (p === "grid" || p === "large" || p === "list" ? p : null),
  });
  const [preview, setPreview] = useState<PreviewAsset | null>(null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false); // D1 AI 一键成片弹窗
  // Refetch when the window/tab regains focus and when the bin is shown again,
  // so assets uploaded or generated elsewhere appear without a full page reload.
  // A manual 刷新 button is also provided for an explicit refresh.
  const listQuery = trpc.assets.list.useQuery(
    { allProjects: true, type: type || undefined, q: q.trim() || undefined },
    { refetchOnWindowFocus: true, refetchOnMount: "always" },
  );
  const assets = (listQuery.data ?? []).filter((a) => a.type !== "other");

  const addClip = useEditorStore((s) => s.addClip);
  const applyDoc = useEditorStore((s) => s.applyDoc);
  const transcribeMut = trpc.subtitle.transcribe.useMutation();
  const aiCutMut = trpc.editor.aiCut.useMutation();
  const [aiCutting, setAiCutting] = useState(false);
  const [aiAggr, setAiAggr] = useState<"low" | "medium" | "high">("medium");
  const [aiSubs, setAiSubs] = useState(true);
  const srtRef = useRef<HTMLInputElement>(null);

  // AI 智能剪辑（video-use 移植）：转写时间轴上第一个视频 → LLM 判定保留区间 →
  // 用返回的新 EditorDoc 整档替换（可撤销）。字幕/激进度可选。
  async function aiSmartCut() {
    const doc = useEditorStore.getState().doc;
    if (!doc) return;
    let src: { assetId?: number; assetUrl?: string } | undefined;
    for (const t of doc.tracks) for (const c of t.clips) if (c.kind === "video" && c.assetUrl) { src = c; break; }
    if (!src?.assetUrl) { toast.error("先在时间轴添加一个视频片段再智能剪辑"); return; }
    const abs = new URL(src.assetUrl, location.origin).href;
    setAiCutting(true);
    toast.info("正在转写并智能剪辑…较长视频需数十秒");
    try {
      const durationSec = await probeMediaDuration(abs, "video");
      const r = await aiCutMut.mutateAsync({
        assetUrl: abs, assetId: src.assetId, durationSec: Math.max(0.5, durationSec),
        width: doc.width, height: doc.height, fps: doc.fps,
        aggressiveness: aiAggr, subtitles: aiSubs,
      });
      applyDoc(r.doc);
      const s = r.stats;
      toast.success(`已智能剪辑：保留 ${s.keptSec}s、删除 ${s.removedSec}s，共 ${s.clips} 段${s.subtitles ? `、${s.subtitles} 条字幕` : ""}（可撤销）`);
    } catch (e) {
      toast.error("智能剪辑失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAiCutting(false);
    }
  }

  // AI auto-subtitle: transcribe the first video/audio clip with Whisper and lay
  // the result onto the text track as timed text clips.
  function autoSubtitle() {
    const doc = useEditorStore.getState().doc;
    if (!doc) return;
    let src: { assetUrl?: string; start: number } | undefined;
    for (const t of doc.tracks) for (const c of t.clips) if ((c.kind === "video" || c.kind === "audio") && c.assetUrl) { src = c; break; }
    if (!src?.assetUrl) { toast.error("先在时间轴添加一个视频或音频片段"); return; }
    const textTrack = doc.tracks.find((t) => t.type === "text");
    if (!textTrack) { toast.error("没有文字轨道"); return; }
    const abs = new URL(src.assetUrl, location.origin).href;
    toast.info("正在用 AI 转写字幕…");
    transcribeMut.mutate({ audioUrl: abs }, {
      onSuccess: ({ entries }) => {
        entries.forEach((e) => addClip(textTrack.id, {
          kind: "text", start: src!.start + e.start, trimIn: 0, trimOut: Math.max(0.3, e.end - e.start),
          text: { content: e.text, size: 48, color: "#ffffff", motionStyle: "none" },
        }));
        toast.success(`已生成 ${entries.length} 条字幕`);
      },
      onError: (e) => toast.error("转写失败：" + e.message),
    });
  }

  // Import an .srt / .vtt file: parse cues and lay them on the text track as
  // timed text clips (offset from the timeline origin).
  function importSrt(file: File) {
    file.text().then((txt) => {
      const cues = parseSrt(txt);
      if (cues.length === 0) { toast.error("未解析到字幕（请检查 SRT/VTT 格式）"); return; }
      const doc = useEditorStore.getState().doc;
      if (!doc) return;
      const textTrack = doc.tracks.find((t) => t.type === "text") ?? doc.tracks[0];
      cues.forEach((c) => addClip(textTrack.id, {
        kind: "text", start: c.start, trimIn: 0, trimOut: Math.max(0.3, c.end - c.start),
        text: { content: c.text, size: 48, color: "#ffffff", motionStyle: "none" },
      }));
      toast.success(`已导入 ${cues.length} 条字幕`);
    }).catch(() => toast.error("读取文件失败"));
  }

  // Click-to-add: append the asset to the matching track at its end.
  async function quickAdd(a: { id: number; url: string; name: string; type: string }) {
    const doc = useEditorStore.getState().doc;
    if (!doc) return;
    const kind = kindFromAssetType(a.type);
    const trackType = kind === "audio" ? "audio" : "video";
    const track = doc.tracks.find((t) => t.type === trackType) ?? doc.tracks[0];
    let dur = 5;
    if (kind === "video" || kind === "audio") dur = await probeMediaDuration(a.url, kind);
    // insert at the playhead (not appended to the track's end)
    const start = Math.max(0, useEditorStore.getState().playhead);
    addClip(track.id, { kind, assetId: a.id, assetUrl: a.url, start, trimIn: 0, trimOut: dur });
  }

  return (
    <aside style={{ width, flexShrink: 0, borderRight: `1px solid ${EC.border}`, display: "flex", flexDirection: "column", minHeight: 0, background: EC.surface }}>
      <div style={{ padding: 10, borderBottom: `1px solid ${EC.border}` }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: EC.t4 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索素材…"
              style={{ width: "100%", padding: "6px 8px 6px 26px", fontSize: 12, borderRadius: 7, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none" }} />
          </div>
          <button
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
            title="刷新素材库"
            style={{ flexShrink: 0, width: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 7, border: `1px solid ${EC.border}`, background: EC.elevated, color: listQuery.isFetching ? EC.accent : EC.t3, cursor: listQuery.isFetching ? "default" : "pointer" }}
          ><RefreshCw size={14} className={listQuery.isFetching ? "animate-spin" : undefined} /></button>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {([["", "全部"], ["video", "视频"], ["image", "图片"], ["audio", "音频"]] as [TypeFilter, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setType(v)} style={{
              flex: 1, padding: "4px 0", fontSize: 11, borderRadius: 6, cursor: "pointer",
              border: `1px solid ${type === v ? EC.accent : EC.border}`,
              background: type === v ? EC.accentSoft : "transparent", color: type === v ? EC.accent : EC.t3,
            }}>{label}</button>
          ))}
          {/* 视图切换：网格 / 超大图标 / 详细信息 */}
          <span style={{ width: 1, alignSelf: "stretch", background: EC.border, margin: "0 2px" }} />
          {([["grid", LayoutGrid, "网格视图"], ["large", GalleryVertical, "超大图标"], ["list", List, "详细信息列表"]] as [BinView, typeof LayoutGrid, string][]).map(([v, Ic, tip]) => (
            <button key={v} onClick={() => setView(v)} title={tip} style={{
              flexShrink: 0, width: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: "4px 0", borderRadius: 6, cursor: "pointer",
              border: `1px solid ${view === v ? EC.accent : EC.border}`,
              background: view === v ? EC.accentSoft : "transparent", color: view === v ? EC.accent : EC.t3,
            }}><Ic size={13} /></button>
          ))}
        </div>
      </div>

      {/* gridAutoRows:max-content is REQUIRED: the cards use overflow:hidden, which
          lets a grid compress their auto rows below content when the list overflows
          (many assets) — collapsing thumbnails into thin strips. Pinning rows to
          content size keeps every thumbnail full-height and the list scrolls.
          视图：grid=两列小图标 / large=单列超大图标 / list=详细信息列表（缩略图+名称+类型+来源+日期）。 */}
      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "grid", gridTemplateColumns: view === "grid" ? "1fr 1fr" : "1fr", gridAutoRows: "max-content", gap: 6, alignContent: "start" }}>
        {listQuery.isLoading && Array.from({ length: 6 }).map((_, i) => (
          <div key={`sk-${i}`} className="animate-pulse" aria-hidden="true" style={{ height: view === "list" ? 44 : view === "large" ? 170 : 92, borderRadius: 8, border: `1px solid ${EC.border}`, background: EC.elevated }} />
        ))}
        {!listQuery.isLoading && assets.length === 0 && <div style={{ gridColumn: "1/-1", fontSize: 12, color: EC.t4, padding: "20px 0", textAlign: "center" }}>暂无素材<br/>可在素材库上传或生成</div>}
        {assets.map((a) => {
          const kind = kindFromAssetType(a.type) as "video" | "image" | "audio";
          const Icon = kind === "video" ? FileVideo : kind === "audio" ? FileAudio : FileImage;
          const payload: MediaDragPayload = { assetId: a.id, url: a.url, name: a.name, kind };
          const kindLabel = kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片";
          const meta = a as unknown as { source?: string; provider?: string; model?: string; createdAt?: string | Date };
          const srcLabel = meta.source === "upload" ? "上传" : meta.source === "generated" ? (meta.model || meta.provider || "生成") : meta.source === "external" ? "外部" : "";
          const dateLabel = meta.createdAt ? new Date(meta.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
          const common = {
            className: "editor-media-card",
            draggable: true,
            onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(MEDIA_DND_MIME, JSON.stringify(payload)); e.dataTransfer.effectAllowed = "copy" as const; },
            onClick: () => setPreview({ id: a.id, url: a.url, name: a.name, kind }),
            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
            title: `${a.name}${srcLabel ? ` · ${srcLabel}` : ""}${dateLabel ? ` · ${dateLabel}` : ""}（点击放大预览 · 拖拽或＋加入时间轴）`,
          };
          const addBtn = (size = 22) => (
            <button
              className="editor-media-add"
              title="加入时间轴"
              onClick={(e) => { e.stopPropagation(); quickAdd(a); }}
              style={{ position: "absolute", top: 4, right: 4, zIndex: 2, width: size, height: size, borderRadius: 6, border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", background: EC.accent, color: "#fff", cursor: "pointer", opacity: 0, transition: "opacity 120ms" }}
            ><Plus size={size - 8} /></button>
          );
          // 详细信息列表：小缩略图 + 名称 + 类型/来源/日期 两行
          if (view === "list") {
            return (
              <div key={a.id} {...common}
                style={{ position: "relative", cursor: "zoom-in", borderRadius: 8, overflow: "hidden", border: `1px solid ${EC.border}`, background: EC.elevated, display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}>
                {addBtn(20)}
                <div style={{ width: 52, height: 36, flexShrink: 0, borderRadius: 5, overflow: "hidden", backgroundColor: "var(--c-canvas, #0c0c10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {kind === "image" ? (
                    <div style={{ width: "100%", height: "100%", backgroundImage: `url("${a.url}")`, backgroundSize: "cover", backgroundPosition: "center" }} />
                  ) : kind === "video" ? (
                    <video src={a.url} muted preload="metadata" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Icon size={16} style={{ color: EC.t3 }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 11, color: EC.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                  <span style={{ fontSize: 9.5, color: EC.t4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {kindLabel}{srcLabel ? ` · ${srcLabel}` : ""}{dateLabel ? ` · ${dateLabel}` : ""}
                  </span>
                </div>
              </div>
            );
          }
          // 网格（92px）/ 超大图标（170px）
          const thumbH = view === "large" ? 170 : 92;
          return (
            <div key={a.id} {...common}
              style={{ position: "relative", cursor: "zoom-in", borderRadius: 8, overflow: "hidden", border: `1px solid ${EC.border}`, background: EC.elevated }}>
              {addBtn(view === "large" ? 26 : 22)}
              {/* Each media gets its OWN explicit pixel height — never a % height
                  inside a flex box — so the thumbnail box can't collapse even in
                  WebViews that mishandle aspect-ratio / percentage heights. */}
              {kind === "image" ? (
                <div style={{ height: thumbH, minHeight: thumbH, backgroundImage: `url("${a.url}")`, backgroundSize: view === "large" ? "contain" : "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center", backgroundColor: "var(--c-canvas, #0c0c10)" }} />
              ) : kind === "video" ? (
                <video src={a.url} muted preload="metadata" style={{ display: "block", width: "100%", height: thumbH, minHeight: thumbH, objectFit: view === "large" ? "contain" : "cover", backgroundColor: "var(--c-canvas, #0c0c10)" }} />
              ) : (
                <div style={{ height: thumbH, minHeight: thumbH, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--c-canvas, #0c0c10)" }}>
                  <Icon size={view === "large" ? 38 : 22} style={{ color: EC.t3 }} />
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 5px" }}>
                <Icon size={10} style={{ color: EC.t4, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: EC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                {view === "large" && (srcLabel || dateLabel) && (
                  <span style={{ marginLeft: "auto", fontSize: 9.5, color: EC.t4, flexShrink: 0 }}>{[kindLabel, srcLabel, dateLabel].filter(Boolean).join(" · ")}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${EC.border}`, padding: 8 }}>
        <button
          onClick={() => {
            const doc = useEditorStore.getState().doc; if (!doc) return;
            const track = doc.tracks.find((t) => t.type === "text") ?? doc.tracks[0];
            const start = trackEnd(doc, track.id);
            addClip(track.id, { kind: "text", start, trimIn: 0, trimOut: 3, text: { content: "点击编辑文字", size: 48, color: "#ffffff" } });
          }}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", fontSize: 12, borderRadius: 7, border: `1px dashed ${EC.border}`, background: "transparent", color: EC.t2, cursor: "pointer" }}
        ><TypeIcon size={13} /> 添加文字</button>
        <button
          onClick={() => {
            const st = useEditorStore.getState();
            let track = st.doc?.tracks.find((t) => t.type === "attachment");
            if (!track) { st.addTrack("attachment"); track = useEditorStore.getState().doc?.tracks.find((t) => t.type === "attachment"); }
            const doc2 = useEditorStore.getState().doc; if (!doc2 || !track) return;
            const start = trackEnd(doc2, track.id);
            addClip(track.id, { kind: "shape", start, trimIn: 0, trimOut: 3, transform: { x: 0.3, y: 0.35 }, shape: { type: "star", color: "#FFD400", fill: true, fillType: "solid", opacity: 1, w: 0.3, h: 0.3 } });
          }}
          style={{ width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", fontSize: 12, borderRadius: 7, border: `1px dashed ${EC.border}`, background: "transparent", color: EC.t2, cursor: "pointer" }}
        ><Square size={13} /> 添加形状 / SVG</button>
        {/* D1 AI 一键成片：选素材 → LLM 出剪辑决策（排序/截取/转场/标题/配乐）→ 整档替换（可撤销）。 */}
        <button
          onClick={() => setComposeOpen(true)}
          style={{ width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", fontSize: 12, fontWeight: 600, borderRadius: 7, border: `1px solid ${EC.accent}`, background: EC.accentSoft, color: EC.accent, cursor: "pointer" }}
        ><Scissors size={13} /> AI 一键成片</button>
        {/* AI 智能剪辑：转写 → LLM 去口头禅/停顿 → 整档替换（可撤销）。附激进度 + 逐词字幕开关。 */}
        <button
          disabled={aiCutting}
          onClick={aiSmartCut}
          style={{ width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", fontSize: 12, fontWeight: 600, borderRadius: 7, border: `1px solid ${EC.accent}`, background: EC.accentSoft, color: EC.accent, cursor: aiCutting ? "default" : "pointer" }}
        ><Scissors size={13} /> {aiCutting ? "智能剪辑中…" : "AI 智能剪辑"}</button>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, color: EC.t3 }}>
          <span>力度</span>
          {(["low", "medium", "high"] as const).map((lv) => (
            <button key={lv} onClick={() => setAiAggr(lv)} disabled={aiCutting}
              style={{ flex: 1, padding: "3px 0", borderRadius: 6, fontSize: 11, cursor: "pointer", border: `1px solid ${aiAggr === lv ? EC.accent : EC.border}`, background: aiAggr === lv ? EC.accentSoft : "transparent", color: aiAggr === lv ? EC.accent : EC.t3 }}
            >{lv === "low" ? "轻" : lv === "medium" ? "中" : "狠"}</button>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={aiSubs} onChange={(e) => setAiSubs(e.target.checked)} disabled={aiCutting} /> 字幕
          </label>
        </div>
        <button
          disabled={transcribeMut.isPending}
          onClick={autoSubtitle}
          style={{ width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", fontSize: 12, borderRadius: 7, border: `1px dashed ${EC.border}`, background: "transparent", color: transcribeMut.isPending ? EC.t4 : EC.t2, cursor: transcribeMut.isPending ? "default" : "pointer" }}
        ><Captions size={13} /> {transcribeMut.isPending ? "转写中…" : "AI 自动字幕"}</button>
        <button
          onClick={() => srtRef.current?.click()}
          style={{ width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", fontSize: 12, borderRadius: 7, border: `1px dashed ${EC.border}`, background: "transparent", color: EC.t2, cursor: "pointer" }}
        ><Upload size={13} /> 导入 SRT 字幕</button>
        <input
          ref={srtRef} type="file" accept=".srt,.vtt,text/plain" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importSrt(f); e.target.value = ""; }}
        />
        <button
          onClick={() => setMusicOpen(true)}
          style={{ width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", fontSize: 12, borderRadius: 7, border: `1px solid ${EC.accent}`, background: EC.accentSoft, color: EC.accent, cursor: "pointer" }}
        ><Music size={13} /> AI 配乐</button>
      </div>

      {preview && <MediaPreview asset={preview} onClose={() => setPreview(null)} />}
      {musicOpen && <MusicGen onClose={() => setMusicOpen(false)} />}
      {composeOpen && <AutoCompose assets={assets} onClose={() => setComposeOpen(false)} />}
    </aside>
  );
}

export { clipDuration };
