// D1 AI 一键成片弹窗：从素材库多选素材 + 写创作要求 + 选目标时长 → editor.autoCompose
// 让 LLM 出剪辑决策（排序/截取/转场/标题/配乐/调色）→ applyDoc 整档替换时间轴（可撤销）。
// 视频/音频素材提交前在浏览器端 probe 时长（与 aiCut 同做法：浏览器已加载素材、最可靠）。
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Clapperboard, Loader2, FileVideo, FileAudio, FileImage } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EC, probeMediaDuration } from "./theme";
import { useEditorStore, kindFromAssetType } from "./editorStore";

export interface AutoComposeAsset { id: number; url: string; name: string; type: string }

const TARGETS: [number | 0, string][] = [[0, "自动"], [15, "约 15 秒"], [30, "约 30 秒"], [60, "约 1 分钟"], [180, "约 3 分钟"]];

export function AutoCompose({ assets, onClose }: { assets: AutoComposeAsset[]; onClose: () => void }) {
  // 可选素材 = 当前素材库筛选结果；默认勾选前 12 个画面素材 + 全部音频（配乐候选）。
  const usable = useMemo(() => assets.map((a) => ({ ...a, kind: kindFromAssetType(a.type) as "video" | "image" | "audio" })), [assets]);
  const [selected, setSelected] = useState<Set<number>>(() => {
    const s = new Set<number>();
    let visual = 0;
    for (const a of usable) {
      if (a.kind === "audio") { s.add(a.id); continue; }
      if (visual < 12) { s.add(a.id); visual++; }
    }
    return s;
  });
  const [brief, setBrief] = useState("");
  const [targetSec, setTargetSec] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const applyDoc = useEditorStore((s) => s.applyDoc);
  const composeMut = trpc.editor.autoCompose.useMutation();

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function run() {
    const chosen = usable.filter((a) => selected.has(a.id)).slice(0, 40);
    if (!chosen.some((a) => a.kind !== "audio")) { toast.error("至少选择一个视频或图片素材"); return; }
    const doc = useEditorStore.getState().doc;
    if (!doc) return;
    setBusy(true);
    toast.info("AI 正在编排成片方案…");
    try {
      // probe 视频/音频时长（图片无需）；单个失败不阻断，缺时长由服务端保守处理
      const withDur = await Promise.all(chosen.map(async (a) => {
        let durationSec: number | undefined;
        if (a.kind !== "image") {
          try { durationSec = await probeMediaDuration(a.url, a.kind); } catch { /* 缺时长走服务端兜底 */ }
        }
        return { url: a.url, kind: a.kind, name: a.name, durationSec, assetId: a.id };
      }));
      const r = await composeMut.mutateAsync({
        assets: withDur, brief: brief.trim() || undefined,
        targetSec: targetSec || undefined,
        width: doc.width, height: doc.height, fps: doc.fps,
      });
      applyDoc(r.doc);
      toast.success(`已生成成片时间轴：${r.stats.clips} 段画面 · 约 ${Math.round(r.stats.totalSec)}s${r.stats.texts ? ` · ${r.stats.texts} 条文字` : ""}${r.stats.hasBgm ? " · 含背景乐" : ""}（可撤销）`);
      onClose();
    } catch (e) {
      toast.error("一键成片失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.6)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 92vw)", maxHeight: "84vh", display: "flex", flexDirection: "column", borderRadius: 14, background: EC.surface, border: `1px solid ${EC.border}`, boxShadow: "0 24px 64px oklch(0 0 0 / 0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${EC.border}` }}>
          <Clapperboard size={16} style={{ color: EC.accent }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: EC.t1, flex: 1 }}>AI 一键成片</span>
          <button onClick={onClose} style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 7, border: `1px solid ${EC.border}`, background: "transparent", color: EC.t3, cursor: "pointer" }}><X size={14} /></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11.5, color: EC.t3, lineHeight: 1.6 }}>
            选素材 → AI 决定镜头顺序、截取精华、转场、标题与配乐，直接生成整条时间轴（当前时间轴会被替换，<b>可 Ctrl+Z 撤销</b>）。
          </div>
          <div>
            <div style={{ fontSize: 11, color: EC.t4, marginBottom: 6 }}>参与素材（{selected.size} / {usable.length}，音频素材将作为配乐候选）</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {usable.map((a) => {
                const on = selected.has(a.id);
                const Icon = a.kind === "video" ? FileVideo : a.kind === "audio" ? FileAudio : FileImage;
                return (
                  <div key={a.id} onClick={() => toggle(a.id)} title={a.name}
                    style={{ cursor: "pointer", borderRadius: 8, overflow: "hidden", border: `1.5px solid ${on ? EC.accent : EC.border}`, background: on ? EC.accentSoft : EC.elevated, opacity: on ? 1 : 0.72 }}>
                    {a.kind === "image" ? (
                      <div style={{ height: 60, backgroundImage: `url("${a.url}")`, backgroundSize: "cover", backgroundPosition: "center" }} />
                    ) : a.kind === "video" ? (
                      <video src={a.url} muted preload="metadata" style={{ display: "block", width: "100%", height: 60, objectFit: "cover" }} />
                    ) : (
                      <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={18} style={{ color: EC.t3 }} /></div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 5px" }}>
                      <Icon size={9} style={{ color: on ? EC.accent : EC.t4, flexShrink: 0 }} />
                      <span style={{ fontSize: 9.5, color: on ? EC.t1 : EC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                    </div>
                  </div>
                );
              })}
              {usable.length === 0 && <div style={{ gridColumn: "1/-1", fontSize: 12, color: EC.t4, padding: "16px 0", textAlign: "center" }}>素材库为空，先上传或生成素材</div>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: EC.t4, marginBottom: 4 }}>创作要求（可选）</div>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={2}
              placeholder="如：剪成快节奏产品宣传片，开头要吸睛，结尾放品牌名"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12, borderRadius: 8, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none", resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: EC.t4 }}>目标时长</span>
            {TARGETS.map(([v, label]) => (
              <button key={v} onClick={() => setTargetSec(v)}
                style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, cursor: "pointer", border: `1px solid ${targetSec === v ? EC.accent : EC.border}`, background: targetSec === v ? EC.accentSoft : "transparent", color: targetSec === v ? EC.accent : EC.t3 }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: `1px solid ${EC.border}` }}>
          <button onClick={onClose} style={{ padding: "8px 16px", fontSize: 12.5, borderRadius: 8, border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2, cursor: "pointer" }}>取消</button>
          <button disabled={busy || selected.size === 0} onClick={run}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "none", background: EC.accent, color: "#fff", cursor: busy ? "default" : "pointer", opacity: busy || selected.size === 0 ? 0.6 : 1 }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Clapperboard size={14} />} {busy ? "编排中…" : "生成成片时间轴"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
