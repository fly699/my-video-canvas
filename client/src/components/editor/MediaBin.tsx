import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FileVideo, FileAudio, FileImage, Search, Type as TypeIcon } from "lucide-react";
import { EC } from "./theme";
import { useEditorStore, kindFromAssetType, trackEnd, clipDuration } from "./editorStore";
import { probeMediaDuration } from "./theme";

type TypeFilter = "" | "image" | "video" | "audio";

/** The asset payload carried via drag-and-drop into the timeline. */
export interface MediaDragPayload {
  assetId?: number;
  url: string;
  name: string;
  kind: "video" | "image" | "audio";
}
export const MEDIA_DND_MIME = "application/x-editor-media";

export function MediaBin() {
  const [type, setType] = useState<TypeFilter>("");
  const [q, setQ] = useState("");
  const listQuery = trpc.assets.list.useQuery({ allProjects: true, type: type || undefined, q: q.trim() || undefined });
  const assets = (listQuery.data ?? []).filter((a) => a.type !== "other");

  const addClip = useEditorStore((s) => s.addClip);

  // Click-to-add: append the asset to the matching track at its end.
  async function quickAdd(a: { id: number; url: string; name: string; type: string }) {
    const doc = useEditorStore.getState().doc;
    if (!doc) return;
    const kind = kindFromAssetType(a.type);
    const trackType = kind === "audio" ? "audio" : "video";
    const track = doc.tracks.find((t) => t.type === trackType) ?? doc.tracks[0];
    let dur = 5;
    if (kind === "video" || kind === "audio") dur = await probeMediaDuration(a.url, kind);
    const start = trackEnd(useEditorStore.getState().doc!, track.id);
    addClip(track.id, { kind, assetId: a.id, assetUrl: a.url, start, trimIn: 0, trimOut: dur });
  }

  return (
    <aside style={{ width: 230, flexShrink: 0, borderRight: `1px solid ${EC.border}`, display: "flex", flexDirection: "column", minHeight: 0, background: EC.surface }}>
      <div style={{ padding: 10, borderBottom: `1px solid ${EC.border}` }}>
        <div style={{ position: "relative", marginBottom: 8 }}>
          <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: EC.t4 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索素材…"
            style={{ width: "100%", padding: "6px 8px 6px 26px", fontSize: 12, borderRadius: 7, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {([["", "全部"], ["video", "视频"], ["image", "图片"], ["audio", "音频"]] as [TypeFilter, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setType(v)} style={{
              flex: 1, padding: "4px 0", fontSize: 11, borderRadius: 6, cursor: "pointer",
              border: `1px solid ${type === v ? EC.accent : EC.border}`,
              background: type === v ? EC.accentSoft : "transparent", color: type === v ? EC.accent : EC.t3,
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, alignContent: "start" }}>
        {listQuery.isLoading && <div style={{ gridColumn: "1/-1", fontSize: 12, color: EC.t3 }}>加载中…</div>}
        {!listQuery.isLoading && assets.length === 0 && <div style={{ gridColumn: "1/-1", fontSize: 12, color: EC.t4, padding: "20px 0", textAlign: "center" }}>暂无素材<br/>可在素材库上传或生成</div>}
        {assets.map((a) => {
          const kind = kindFromAssetType(a.type) as "video" | "image" | "audio";
          const Icon = kind === "video" ? FileVideo : kind === "audio" ? FileAudio : FileImage;
          const payload: MediaDragPayload = { assetId: a.id, url: a.url, name: a.name, kind };
          return (
            <div
              key={a.id}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData(MEDIA_DND_MIME, JSON.stringify(payload)); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => quickAdd(a)}
              title={`${a.name}（点击添加 / 拖到时间轴）`}
              style={{ cursor: "grab", borderRadius: 8, overflow: "hidden", border: `1px solid ${EC.border}`, background: EC.elevated }}
            >
              <div style={{ aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-bg, #0c0c10)" }}>
                {kind === "image" ? (
                  <img src={a.url} alt={a.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : kind === "video" ? (
                  <video src={a.url} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <Icon size={22} style={{ color: EC.t3 }} />
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 5px" }}>
                <Icon size={10} style={{ color: EC.t4, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: EC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
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
      </div>
    </aside>
  );
}

export { clipDuration };
