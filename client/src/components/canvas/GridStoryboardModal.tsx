import { useState, useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { X, Grid2x2, Loader2, Sparkles, Scissors, Clapperboard } from "lucide-react";
import { GRID_PRESETS, getGridPreset, gridCellCount, buildGridPrompt } from "../../../../shared/grid";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS, type ModelPickerOption } from "./ModelPicker";

const ACCENT = "oklch(0.65 0.20 160)"; // storyboard 绿
const accentA = (a: number) => `oklch(0.65 0.20 160 / ${a})`;

// 网格分镜起稿：生成（或粘贴）一张 N 宫格大图 → 切分为 N 张 → 各落成一个分镜节点。
// 用与图像生成节点同一套完整模型列表（含分组/搜索/点数），而不是写死的少量几个。
const GRID_MODEL_OPTIONS: ModelPickerOption[] = [
  { value: "", label: "默认生图模型（服务端推荐）", group: "默认", family: "默认" },
  ...IMAGE_MODEL_PICKER_OPTIONS,
];

export function GridStoryboardModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const { addStoryboardGridNodes } = useCanvasStore();
  const reactFlow = useReactFlow();

  const [presetId, setPresetId] = useState(GRID_PRESETS[0].id);
  const [mode, setMode] = useState<"generate" | "existing" | "video">("generate");
  const [subject, setSubject] = useState("");
  const [model, setModel] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [frameCount, setFrameCount] = useState(9);
  const [phase, setPhase] = useState<"idle" | "generating" | "slicing">("idle");

  const preset = getGridPreset(presetId) ?? GRID_PRESETS[0];
  const cells = gridCellCount(preset);

  const genMutation = trpc.imageGen.generate.useMutation();
  const sliceMutation = trpc.imageGrid.slice.useMutation();
  const fromVideoMutation = trpc.imageGrid.fromVideo.useMutation();

  const busy = phase !== "idle";

  // #R6-8 生成中不允许关闭（背景点击/X/Esc）以免丢进度；空闲时正常关。
  const safeClose = () => { if (busy) { toast.info("生成中，请稍候…"); return; } onClose(); };
  const subjectRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => subjectRef.current?.focus(), 40); // 打开即聚焦主题描述
    // capture 相位：确保 Esc 在焦点位于弹窗输入框内时也能关闭（画布全局 keydown 在 isEditing 时会提前返回，
    // 冒泡相位会被其抢先/干扰，capture 先于元素级处理触发，最稳妥）。
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); safeClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey, true); };
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const centerPos = () => {
    // Place the grid near the current viewport center, in flow coordinates.
    const p = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
    return { x: p.x - 200, y: p.y - 260 };
  };

  const handleRun = async () => {
    if (busy) return;
    try {
      // ── Video → storyboard: extract N evenly-spaced frames, one per node ──
      if (mode === "video") {
        const vurl = videoUrl.trim();
        if (!vurl) { toast.error("请填写视频 URL"); return; }
        setPhase("slicing");
        const r = await fromVideoMutation.mutateAsync({ videoUrl: vurl, count: frameCount, projectId });
        if (!r.frames.length) { toast.error("抽帧失败：未产生关键帧"); setPhase("idle"); return; }
        const cols = Math.min(frameCount, 6);
        const rows = Math.ceil(r.frames.length / cols);
        const ids = addStoryboardGridNodes(r.frames.map((f) => f.url), {
          rows, cols, sourcePosition: centerPos(), titlePrefix: "分镜",
        });
        toast.success(`已从视频生成 ${ids.length} 个分镜`);
        setPhase("idle");
        onClose();
        return;
      }

      let gridUrl = imageUrl.trim();
      if (mode === "generate") {
        if (!subject.trim()) { toast.error("请填写主题/场景描述"); return; }
        setPhase("generating");
        const prompt = buildGridPrompt(subject, preset);
        const res = await genMutation.mutateAsync({
          prompt,
          model: model ? (model as never) : undefined,
          // 让各模型族都拿到整张表的比例（kie/Poyo/V2·HF 读不同字段）。
          aspectRatio: preset.sheetAspect,
          poyoAspectRatio: preset.sheetAspect,
          reveAspectRatio: preset.sheetAspect,
          projectId,
        });
        gridUrl = res.urls?.[0] || res.url || "";
        if (!gridUrl) { toast.error("网格图生成失败：未返回图像"); setPhase("idle"); return; }
      } else {
        if (!gridUrl) { toast.error("请填写网格图 URL"); return; }
      }

      setPhase("slicing");
      const sliced = await sliceMutation.mutateAsync({
        imageUrl: gridUrl,
        rows: preset.rows,
        cols: preset.cols,
        projectId,
      });
      if (!sliced.urls.length) { toast.error("切分失败：未产生子图"); setPhase("idle"); return; }

      const ids = addStoryboardGridNodes(sliced.urls, {
        rows: sliced.rows,
        cols: sliced.cols,
        sourcePosition: centerPos(),
        titlePrefix: preset.label,
        promptText: subject.trim() || undefined,
        aspectRatio: preset.sheetAspect,
      });
      toast.success(`已生成 ${ids.length} 个分镜（${preset.label}）`);
      setPhase("idle");
      onClose();
    } catch (err) {
      setPhase("idle");
      toast.error("网格分镜失败：" + (err instanceof Error ? err.message : String(err)));
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 12.5, background: "var(--c-input)",
    border: "1px solid var(--c-bd2)", borderRadius: 8, color: "var(--c-t1)", outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
    color: "var(--c-t4)", display: "block", marginBottom: 5,
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.45)" }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); safeClose(); } }}
      onClick={safeClose}>
      <div className="flex flex-col gap-3.5" onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto", background: "var(--c-surface)", border: `1px solid ${accentA(0.35)}`, borderRadius: 14, padding: 18, boxShadow: "0 20px 60px oklch(0 0 0 / 0.4)" }}>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2" style={{ color: ACCENT }}>
            <Grid2x2 style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 14, fontWeight: 700 }}>网格分镜起稿</span>
          </div>
          <button onClick={safeClose} className="nodrag" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-t4)" }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Preset (grid modes only) */}
        {mode !== "video" && <div>
          <label style={labelStyle}>网格类型</label>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {GRID_PRESETS.map((p) => {
              const active = p.id === presetId;
              return (
                <button key={p.id} onClick={() => setPresetId(p.id)} disabled={busy}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
                    padding: "7px 9px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer",
                    background: active ? accentA(0.14) : "var(--c-input)",
                    border: active ? `1.5px solid ${accentA(0.5)}` : "1px solid var(--c-bd1)",
                    color: active ? ACCENT : "var(--c-t3)",
                  }}>
                  <span style={{ fontSize: 11.5, fontWeight: active ? 600 : 500 }}>{p.label}</span>
                  <span style={{ fontSize: 9, color: "var(--c-t4)" }}>{p.rows}×{p.cols} = {p.rows * p.cols} 格 · {p.sheetAspect}</span>
                </button>
              );
            })}
          </div>
        </div>}

        {/* Source mode */}
        <div>
          <label style={labelStyle}>来源</label>
          <div className="flex gap-1.5">
            {([["generate", "AI 生成", Sparkles], ["existing", "已有网格图", Scissors], ["video", "视频转分镜", Clapperboard]] as const).map(([val, lbl, Icon]) => {
              const active = mode === val;
              return (
                <button key={val} onClick={() => setMode(val)} disabled={busy}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: active ? accentA(0.14) : "var(--c-input)", border: active ? `1.5px solid ${accentA(0.5)}` : "1px solid var(--c-bd1)", color: active ? ACCENT : "var(--c-t4)", cursor: busy ? "not-allowed" : "pointer" }}>
                  <Icon style={{ width: 12, height: 12 }} /> {lbl}
                </button>
              );
            })}
          </div>
        </div>

        {mode === "generate" && (
          <>
            <div>
              <label style={labelStyle}>主题 / 场景描述</label>
              <textarea ref={subjectRef} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} rows={3}
                placeholder={preset.id === "turnaround" ? "如：赛博朋克女侦探，银色短发，黑色风衣" : "如：雨夜，侦探在霓虹小巷追逐嫌疑人"}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
            </div>
            <div>
              <label style={labelStyle}>生图模型</label>
              <ModelPicker value={model} onChange={setModel} options={GRID_MODEL_OPTIONS} disabled={busy} minWidth={300} accent="oklch(0.62 0.17 150)" />
            </div>
          </>
        )}
        {mode === "existing" && (
          <div>
            <label style={labelStyle}>网格图 URL</label>
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} disabled={busy} placeholder="https://..." style={inputStyle} />
            <p style={{ fontSize: 9.5, color: "var(--c-t4)", margin: "5px 0 0", lineHeight: 1.5 }}>
              把一张已排好的 {preset.rows}×{preset.cols} 网格大图 URL 贴这里，按行优先切成 {cells} 张分镜。
            </p>
          </div>
        )}
        {mode === "video" && (
          <>
            <div>
              <label style={labelStyle}>视频 URL</label>
              <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} disabled={busy} placeholder="https://...mp4" style={inputStyle} />
            </div>
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>抽帧数量（分镜数）</label>
                <span style={{ fontSize: 11, color: "var(--c-t3)" }}>{frameCount}</span>
              </div>
              <input type="range" min={3} max={24} step={1} value={frameCount} disabled={busy}
                onChange={(e) => setFrameCount(Number(e.target.value))} style={{ width: "100%", accentColor: ACCENT }} />
              <p style={{ fontSize: 9.5, color: "var(--c-t4)", margin: "5px 0 0", lineHeight: 1.5 }}>
                按时间等距抽 {frameCount} 帧，每帧落成一个分镜关键帧（可再「AI 扩写提示词」补镜头描述）。
              </p>
            </div>
          </>
        )}

        <button onClick={handleRun} disabled={busy}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-[13px] font-semibold"
          style={{ background: busy ? "var(--c-input)" : accentA(0.16), border: `1px solid ${accentA(0.5)}`, color: busy ? "var(--c-t4)" : ACCENT, cursor: busy ? "not-allowed" : "pointer" }}>
          {busy ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Grid2x2 style={{ width: 14, height: 14 }} />}
          {phase === "generating" ? "生成网格图中…" : phase === "slicing" ? (mode === "video" ? "抽帧并生成分镜中…" : "切分并生成分镜中…") : (mode === "video" ? `从视频生成 ${frameCount} 个分镜` : `生成 ${cells} 个分镜`)}
        </button>
        <p style={{ fontSize: 9.5, color: "var(--c-t4)", margin: 0, lineHeight: 1.5 }}>
          生成后每格落成一个分镜节点（带关键帧图，可在镜头表批量生视频/配音/装配成片）。
        </p>
      </div>
    </div>
  );
}
