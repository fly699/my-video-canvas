import { Trash2, Mic, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EC, probeMediaDuration } from "./theme";
import { useEditorStore } from "./editorStore";
import { usePersistentState } from "@/hooks/usePersistentState";
import type { Clip } from "@shared/editorTypes";

// TTS models available for AI 配音 (mirror audioGen.generateDubbing).
const TTS_MODELS: [string, string][] = [
  ["openai_tts_real", "OpenAI 标准"],
  ["openai_tts_hd_real", "OpenAI 高清"],
  ["openai_gpt4o_mini_tts", "GPT-4o mini"],
  ["elevenlabs-v3-tts", "ElevenLabs V3"],
];
// Voices vary by provider (mirror AudioNode); value === wire name.
const OPENAI_VOICES: [string, string][] = [
  ["alloy", "Alloy · 中性"], ["echo", "Echo · 男声"], ["fable", "Fable · 英式"],
  ["onyx", "Onyx · 低沉"], ["nova", "Nova · 女声"], ["shimmer", "Shimmer · 柔和"],
];
const ELEVENLABS_VOICES: [string, string][] = [
  ["Rachel", "Rachel · 女声"], ["Aria", "Aria · 女声"], ["Sarah", "Sarah · 女声"], ["Charlotte", "Charlotte · 女声"],
  ["River", "River · 中性"], ["Roger", "Roger · 男声"], ["George", "George · 男声"], ["Brian", "Brian · 男声"], ["Daniel", "Daniel · 男声"],
];
const voicesForModel = (m: string): [string, string][] => (m === "elevenlabs-v3-tts" || m === "elevenlabs_v3" ? ELEVENLABS_VOICES : OPENAI_VOICES);
// Fonts — the render host (Windows) ships these CJK families, so export matches preview.
const FONTS: [string, string][] = [
  ["", "默认"], ["Microsoft YaHei", "微软雅黑"], ["SimHei", "黑体"], ["SimSun", "宋体"],
  ["KaiTi", "楷体"], ["FangSong", "仿宋"], ["Arial", "Arial"], ["Times New Roman", "Times"],
];
const FILTERS: [string, string][] = [["", "无"], ["cinematic", "电影感"], ["teal_orange", "青橙大片"], ["gold", "金色暖阳"], ["moody", "暗调电影"], ["cyberpunk", "赛博朋克"], ["vivid", "鲜艳"], ["faded", "褪色胶片"], ["vintage", "复古"], ["sepia", "棕褐"], ["warm", "暖色"], ["cool", "冷色"], ["noir", "黑白高反差"], ["bw", "黑白"]];
const TRANSITIONS: [string, string][] = [
  ["none", "无"],
  ["fade", "淡入淡出"], ["fadeblack", "淡入黑场"], ["fadewhite", "淡入白场"],
  ["dissolve", "叠化"], ["fadegrays", "灰度淡化"], ["hblur", "模糊过渡"],
  ["wipeleft", "擦除 ←"], ["wiperight", "擦除 →"], ["wipeup", "擦除 ↑"], ["wipedown", "擦除 ↓"],
  ["slideleft", "滑动 ←"], ["slideright", "滑动 →"], ["slideup", "滑动 ↑"], ["slidedown", "滑动 ↓"],
  ["smoothleft", "平滑滑动 ←"], ["smoothright", "平滑滑动 →"],
  ["circleopen", "圆形展开"], ["circleclose", "圆形收拢"], ["circlecrop", "圆形裁切"], ["rectcrop", "矩形裁切"],
  ["radial", "径向擦除"], ["pixelize", "像素化"], ["zoomin", "缩放进入"],
  ["diagtl", "对角 ↖"], ["diagbr", "对角 ↘"], ["hlslice", "切片"], ["squeezeh", "水平挤压"], ["squeezev", "垂直挤压"],
];
const MOTIONS: [string, string][] = [["none", "无"], ["fade", "淡入"], ["slideup", "上滑入"], ["slidedown", "下滑入"], ["pop", "弹入"], ["typewriter", "打字机"], ["roll", "滚动"], ["credits", "片尾滚动"], ["karaoke", "卡拉OK"], ["bounce", "弹跳"]];
// 关键帧补间曲线（作用于整段动画）：线性=匀速；缓入=慢起加速；缓出=快起减速；缓入缓出=两端平滑 S 曲线。
const EASE_OPTIONS: [string, string][] = [["linear", "线性（匀速）"], ["in", "缓入"], ["out", "缓出"], ["inout", "缓入缓出"]];
// 音频淡变曲线（afade curve）：线性听感生硬；正弦/对数/指数更自然。仅影响声音，画面 fade 仍线性。
const FADE_CURVES: [string, string][] = [["tri", "线性"], ["qsin", "平滑（正弦）"], ["log", "对数（先快后慢）"], ["exp", "指数（先慢后快）"]];

// 字幕样式预设库 — 一键套用成套文字样式（仅样式，不改文字内容）。每个预设显式写全
// 描边/投影/背景框的开关，避免和上一套样式叠加出意外效果。
type TextStyle = Partial<NonNullable<Clip["text"]>>;
const TEXT_PRESETS: { id: string; label: string; style: TextStyle }[] = [
  { id: "variety",  label: "综艺花字", style: { size: 72, color: "#FFE600", bold: true,  italic: false, strokeWidth: 9,  strokeColor: "#000000", shadow: true,  shadowColor: "#000000", bgColor: undefined, font: "SimHei" } },
  { id: "cinema",   label: "电影字幕", style: { size: 40, color: "#FFFFFF", bold: false, italic: false, strokeWidth: 2,  strokeColor: "#000000", shadow: true,  shadowColor: "#000000", bgColor: undefined, font: "" } },
  { id: "minimal",  label: "极简",     style: { size: 42, color: "#FFFFFF", bold: false, italic: false, strokeWidth: 0,  shadow: false, bgColor: undefined, font: "" } },
  { id: "neon",     label: "霓虹",     style: { size: 56, color: "#00F0FF", bold: true,  italic: false, strokeWidth: 3,  strokeColor: "#0050FF", shadow: true,  shadowColor: "#00C8FF", bgColor: undefined, font: "SimHei" } },
  { id: "pop",      label: "卡通描边", style: { size: 64, color: "#FFFFFF", bold: true,  italic: false, strokeWidth: 11, strokeColor: "#FF2D55", shadow: false, bgColor: undefined, font: "SimHei" } },
  { id: "bar",      label: "字幕条",   style: { size: 38, color: "#FFFFFF", bold: false, italic: false, strokeWidth: 0,  shadow: false, bgColor: "#000000", font: "" } },
];

export function PropertiesPanel({ width = 250 }: { width?: number } = {}) {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const doc = useEditorStore((s) => s.doc);
  const update = useEditorStore((s) => s.updateClip);
  const remove = useEditorStore((s) => s.removeClip);
  const addClip = useEditorStore((s) => s.addClip);
  const playhead = useEditorStore((s) => s.playhead);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);
  const clearKeyframes = useEditorStore((s) => s.clearKeyframes);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const removeSelected = useEditorStore((s) => s.removeSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const copySelected = useEditorStore((s) => s.copySelected);
  const closeGapsSelected = useEditorStore((s) => s.closeGapsSelected);
  const alignSelectedStartTo = useEditorStore((s) => s.alignSelectedStartTo);
  const updateSelected = useEditorStore((s) => s.updateSelected);
  const dubMut = trpc.audioGen.generateDubbing.useMutation();
  const [ttsModel, setTtsModel] = usePersistentState<string>(
    "ui:editor:tts-model:v1", "openai_tts_real",
    { validate: (p) => (typeof p === "string" && TTS_MODELS.some(([v]) => v === p) ? p : null) },
  );
  const [ttsVoice, setTtsVoice] = usePersistentState<string>(
    "ui:editor:tts-voice:v1", "alloy",
    { validate: (p) => (typeof p === "string" && p ? p : null) },
  );
  // when the model changes, reset the voice if it isn't valid for the new provider
  const pickModel = (m: string) => {
    setTtsModel(m);
    const allowed = voicesForModel(m).map(([v]) => v);
    if (!allowed.includes(ttsVoice)) setTtsVoice(allowed[0]);
  };

  // AI dubbing: synthesize speech from the text clip and drop it on the audio track.
  async function aiDub(text: string, start: number) {
    if (!text.trim()) { toast.error("文字为空"); return; }
    const d = useEditorStore.getState().doc;
    const audioTrack = d?.tracks.find((t) => t.type === "audio");
    if (!audioTrack) { toast.error("没有音频轨道"); return; }
    toast.info("正在生成 AI 配音…");
    try {
      const r = await dubMut.mutateAsync({ model: ttsModel as Parameters<typeof dubMut.mutateAsync>[0]["model"], voice: ttsVoice || undefined, text });
      const dur = await probeMediaDuration(r.url, "audio");
      addClip(audioTrack.id, { kind: "audio", assetUrl: r.url, start, trimIn: 0, trimOut: dur, volume: 1 });
      toast.success("已生成配音并加入音频轨");
    } catch (e) { toast.error("配音失败：" + (e instanceof Error ? e.message : "")); }
  }

  // Multi-selection → a compact bulk-action panel instead of single-clip props.
  if (selectedClipIds.length > 1) {
    const n = selectedClipIds.length;
    const mBtn: React.CSSProperties = { width: "100%", padding: "8px 0", fontSize: 12, borderRadius: 7, cursor: "pointer", border: `1px solid ${EC.border}`, background: "transparent", color: EC.t1 };
    // seed the bulk sliders from the primary (last-selected) clip
    let primary: Clip | null = null;
    if (doc) for (const t of doc.tracks) { const c = t.clips.find((x) => x.id === selectedClipId); if (c) { primary = c; break; } }
    const pv = primary ?? ({} as Clip);
    return (
      <aside style={{ ...panel, width }}>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: EC.t1 }}>已选 {n} 个片段</div>
          <div style={{ fontSize: 11, color: EC.t4, lineHeight: 1.5 }}>在时间轴上拖动可整体移动；下列操作作用于全部选中片段。Shift/Ctrl 点击可加选/减选，空白处拖拽框选。</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...mBtn, flex: 1 }} title="把所选片段在各自轨道上首尾相接，闭合中间的空隙" onClick={() => closeGapsSelected()}>紧排</button>
            <button style={{ ...mBtn, flex: 1 }} title="整体平移，使最早的选中片段对齐到播放头" onClick={() => alignSelectedStartTo(useEditorStore.getState().playhead)}>对齐到播放头</button>
          </div>

          <Section title="批量调整（应用到全部选中）">
            <Slider label={`速度 ${(pv.speed ?? 1).toFixed(2)}x`} min={0.25} max={4} step={0.05} value={pv.speed ?? 1} onChange={(v) => updateSelected({ speed: v })} />
            <Slider label={`音量 ${Math.round((pv.volume ?? 1) * 100)}%`} min={0} max={2} step={0.05} value={pv.volume ?? 1} onChange={(v) => updateSelected({ volume: v })} />
            <Slider label={`不透明度 ${Math.round((pv.transform?.opacity ?? 1) * 100)}%`} min={0} max={1} step={0.01} value={pv.transform?.opacity ?? 1} onChange={(v) => updateSelected({ transform: { opacity: v } })} />
            <Slider label={`淡入 ${(pv.fadeIn ?? 0).toFixed(1)}s`} min={0} max={5} step={0.1} value={pv.fadeIn ?? 0} onChange={(v) => updateSelected({ fadeIn: v })} />
            <Slider label={`淡出 ${(pv.fadeOut ?? 0).toFixed(1)}s`} min={0} max={5} step={0.1} value={pv.fadeOut ?? 0} onChange={(v) => updateSelected({ fadeOut: v })} />
            <Row label="淡变曲线"><Select value={pv.fadeCurve ?? "tri"} options={FADE_CURVES} onChange={(v) => updateSelected({ fadeCurve: v as NonNullable<Clip["fadeCurve"]> })} /></Row>
            <div style={{ fontSize: 11, color: EC.t3, marginTop: 2 }}>适配方式</div>
            <div style={{ display: "flex", gap: 4 }}>
              {([["contain", "适应"], ["cover", "填充"], ["stretch", "拉伸"], ["blur", "模糊"], ["none", "原始1:1"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => updateSelected({ fit: v, transform: undefined, keyframes: undefined })}
                  style={{ flex: 1, padding: "5px 0", fontSize: 11, borderRadius: 6, cursor: "pointer", border: `1px solid ${(pv.fit ?? "contain") === v ? EC.accent : EC.border}`, background: (pv.fit ?? "contain") === v ? EC.accentSoft : "transparent", color: (pv.fit ?? "contain") === v ? EC.accent : EC.t2 }}>{label}</button>
              ))}
            </div>
          </Section>

          <button style={mBtn} onClick={() => duplicateSelected()}>原地复制全部（Ctrl+D）</button>
          <button style={mBtn} onClick={() => copySelected()}>拷贝到剪贴板（Ctrl+C）</button>
          <button style={{ ...mBtn, color: "oklch(0.65 0.2 25)", borderColor: "oklch(0.65 0.2 25 / 0.5)" }} onClick={() => removeSelected()}>删除全部（Del）</button>
        </div>
      </aside>
    );
  }

  let clip: Clip | null = null;
  let clipTrackType: string | null = null;
  if (doc && selectedClipId) {
    for (const t of doc.tracks) { const c = t.clips.find((x) => x.id === selectedClipId); if (c) { clip = c; clipTrackType = t.type; break; } }
  }

  if (!clip) {
    return <aside style={{ ...panel, width }}><div style={{ padding: 14, fontSize: 12, color: EC.t4 }}>选中一个片段以编辑属性</div></aside>;
  }
  const c = clip;
  const isVisual = c.kind === "video" || c.kind === "image" || c.kind === "text";
  const isMedia = c.kind === "video" || c.kind === "audio";
  const eff = c.effects ?? {};
  const tf = c.transform ?? {};

  const setEff = (k: keyof NonNullable<Clip["effects"]>, v: number | string | undefined) => update(c.id, { effects: { ...eff, [k]: v } });
  const setTf = (k: keyof NonNullable<Clip["transform"]>, v: number) => update(c.id, { transform: { ...tf, [k]: v } });
  const txt = c.text;
  const setText = (patch: Partial<NonNullable<Clip["text"]>>) => update(c.id, { text: { ...txt, content: txt?.content ?? "", ...patch } });
  const setShape = (patch: Partial<NonNullable<Clip["shape"]>>) => update(c.id, { shape: { type: "rect", ...(c.shape ?? {}), ...patch } as NonNullable<Clip["shape"]> });
  // Center on an axis using the actually-rendered box size (falls back to an
  // estimate when the clip isn't visible at the current playhead).
  const centerAxis = (axis: "x" | "y") => {
    const box = document.querySelector(`[data-clip-box="${c.id}"]`) as HTMLElement | null;
    const stage = box?.offsetParent as HTMLElement | null;
    // Only positioned (PiP) clips have a box to center. A full-frame clip (no
    // transform) is already centered by object-fit — don't fabricate a transform
    // that would shrink it into a small floating box.
    if (!box || !stage?.offsetWidth || !stage.offsetHeight) return;
    if (axis === "x") setTf("x", Math.max(0, (1 - box.offsetWidth / stage.offsetWidth) / 2));
    else setTf("y", Math.max(0, (1 - box.offsetHeight / stage.offsetHeight) / 2));
  };

  return (
    <aside style={{ ...panel, width }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${EC.border}` }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: EC.t1, flex: 1 }}>{labelKind(c.kind)} 属性</span>
        <button onClick={() => remove(c.id)} title="删除片段" style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 7, border: `1px solid ${EC.border}`, background: "transparent", color: "oklch(0.62 0.20 25)", cursor: "pointer" }}><Trash2 size={14} /></button>
      </div>

      <div style={{ overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
        {c.kind === "text" && (
          <Section title="文字">
            <textarea value={txt?.content ?? ""} onChange={(e) => setText({ content: e.target.value })}
              rows={2} style={{ ...input, resize: "vertical" }} placeholder="输入文字…" />
            {/* 样式预设库：一键套用成套字幕样式 */}
            <div>
              <div style={{ fontSize: 10.5, color: EC.t4, marginBottom: 4 }}>样式预设</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TEXT_PRESETS.map((p) => (
                  <button key={p.id} onClick={() => setText(p.style)} title={`一键套用「${p.label}」样式`}
                    style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, cursor: "pointer", border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2 }}>{p.label}</button>
                ))}
              </div>
            </div>
            <Row label="字号"><input type="number" value={txt?.size ?? 48} onChange={(e) => setText({ size: Number(e.target.value) })} style={input} /></Row>
            <Row label="字体"><Select value={txt?.font ?? ""} options={FONTS} onChange={(v) => setText({ font: v || undefined })} /></Row>
            {/* style row: bold / italic / alignment */}
            <div style={{ display: "flex", gap: 6 }}>
              <Toggle on={!!txt?.bold} onClick={() => setText({ bold: !txt?.bold })} title="粗体"><b>B</b></Toggle>
              <Toggle on={!!txt?.italic} onClick={() => setText({ italic: !txt?.italic })} title="斜体"><i>I</i></Toggle>
              <Toggle on={(txt?.align ?? "center") === "left"} onClick={() => setText({ align: "left" })} title="左对齐"><AlignLeft size={13} /></Toggle>
              <Toggle on={(txt?.align ?? "center") === "center"} onClick={() => setText({ align: "center" })} title="居中"><AlignCenter size={13} /></Toggle>
              <Toggle on={(txt?.align ?? "center") === "right"} onClick={() => setText({ align: "right" })} title="右对齐"><AlignRight size={13} /></Toggle>
              <Toggle on={!!txt?.vertical} onClick={() => setText({ vertical: !txt?.vertical })} title="竖排（逐字纵向排列）"><span style={{ fontSize: 11, lineHeight: 1 }}>竖</span></Toggle>
            </div>
            <Row label="颜色"><ColorAlpha value={txt?.color} fallback="#ffffff" onChange={(v) => setText({ color: v })} /></Row>
            {/* 描边：粗细默认 2（配合预览 paint-order 外描边，更细更接近导出）；色+不透明度独立一行 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle on={(txt?.strokeWidth ?? 0) > 0} onClick={() => setText({ strokeWidth: (txt?.strokeWidth ?? 0) > 0 ? 0 : 2, strokeColor: txt?.strokeColor ?? "#000000" })} title="描边" wide>描边</Toggle>
              {(txt?.strokeWidth ?? 0) > 0 && (
                <input type="number" min={0} max={12} step={0.5} value={txt?.strokeWidth ?? 2} onChange={(e) => setText({ strokeWidth: Number(e.target.value) })} style={{ ...input, width: 56 }} title="描边粗细 (px)" />
              )}
            </div>
            {(txt?.strokeWidth ?? 0) > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 2 }}>
                <span style={{ fontSize: 11, color: EC.t3, width: 44, flexShrink: 0 }}>描边色</span>
                <ColorAlpha value={txt?.strokeColor} fallback="#000000" onChange={(v) => setText({ strokeColor: v })} />
              </div>
            )}
            {/* 投影 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle on={!!txt?.shadow} onClick={() => setText({ shadow: !txt?.shadow, shadowColor: txt?.shadowColor ?? "#000000" })} title="投影" wide>投影</Toggle>
            </div>
            {txt?.shadow && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 2 }}>
                <span style={{ fontSize: 11, color: EC.t3, width: 44, flexShrink: 0 }}>投影色</span>
                <ColorAlpha value={txt?.shadowColor} fallback="#000000" onChange={(v) => setText({ shadowColor: v })} />
              </div>
            )}
            {/* 背景框 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle on={!!txt?.bgColor} onClick={() => setText({ bgColor: txt?.bgColor ? undefined : "#00000080" })} title="背景框" wide>背景框</Toggle>
            </div>
            {txt?.bgColor && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 2 }}>
                <span style={{ fontSize: 11, color: EC.t3, width: 44, flexShrink: 0 }}>背景色</span>
                <ColorAlpha value={txt?.bgColor} fallback="#000000" onChange={(v) => setText({ bgColor: v })} />
              </div>
            )}
            <Row label="动效"><Select value={txt?.motionStyle ?? "none"} options={MOTIONS} onChange={(v) => setText({ motionStyle: v as NonNullable<Clip["text"]>["motionStyle"] })} /></Row>
            {txt?.motionStyle === "typewriter" && (
              <Slider label={`打字速度 ${txt?.typewriterCps ?? 16} 字/秒`} min={4} max={40} step={1} value={txt?.typewriterCps ?? 16} onChange={(v) => setText({ typewriterCps: v })} />
            )}
            <Row label="配音模型"><Select value={ttsModel} options={TTS_MODELS} onChange={pickModel} /></Row>
            <Row label="发音人"><Select value={ttsVoice} options={voicesForModel(ttsModel)} onChange={setTtsVoice} /></Row>
            <button
              disabled={dubMut.isPending}
              onClick={() => aiDub(c.text?.content ?? "", c.start)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", fontSize: 12, borderRadius: 7, border: `1px solid ${EC.accent}`, background: EC.accentSoft, color: EC.accent, cursor: dubMut.isPending ? "default" : "pointer" }}
            ><Mic size={13} /> {dubMut.isPending ? "生成中…" : "AI 配音（朗读这段文字）"}</button>
          </Section>
        )}

        {c.kind === "shape" && (
          <Section title="形状（矩形）">
            <div style={{ fontSize: 11, color: EC.t3, marginBottom: 4 }}>高亮框 / 打码块 / 色块 / 分隔条。拖动可移动位置，下面调样式与大小。</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle on={!!c.shape?.fill} onClick={() => setShape({ fill: !c.shape?.fill })} title="填充 / 描边" wide>{c.shape?.fill ? "填充" : "描边"}</Toggle>
              <span style={{ fontSize: 11, color: EC.t2 }}>颜色</span>
              <input type="color" value={c.shape?.color ?? "#FFD400"} onChange={(e) => setShape({ color: e.target.value })} style={{ ...input, width: 40, height: 30, padding: 2 }} />
            </div>
            {!c.shape?.fill && <Slider label={`描边粗细 ${c.shape?.lineWidth ?? 6}px`} min={1} max={40} step={1} value={c.shape?.lineWidth ?? 6} onChange={(v) => setShape({ lineWidth: v })} />}
            <Slider label={`不透明度 ${Math.round((c.shape?.opacity ?? 1) * 100)}%`} min={0} max={1} step={0.01} value={c.shape?.opacity ?? 1} onChange={(v) => setShape({ opacity: v })} />
            <Slider label={`宽 ${Math.round((c.shape?.w ?? 0.3) * 100)}%`} min={0.05} max={1} step={0.01} value={c.shape?.w ?? 0.3} onChange={(v) => setShape({ w: v })} />
            <Slider label={`高 ${Math.round((c.shape?.h ?? 0.2) * 100)}%`} min={0.05} max={1} step={0.01} value={c.shape?.h ?? 0.2} onChange={(v) => setShape({ h: v })} />
          </Section>
        )}

        {isMedia && (
          <Section title="播放">
            <Slider label={`速度 ${(c.speed ?? 1).toFixed(2)}x`} min={0.25} max={4} step={0.05} value={c.speed ?? 1} onChange={(v) => update(c.id, { speed: v })} />
            <Slider label={`音量 ${Math.round((c.volume ?? 1) * 100)}%`} min={0} max={2} step={0.05} value={c.volume ?? 1} onChange={(v) => update(c.id, { volume: v })} />
            <Slider label={`淡入 ${(c.fadeIn ?? 0).toFixed(1)}s`} min={0} max={5} step={0.1} value={c.fadeIn ?? 0} onChange={(v) => update(c.id, { fadeIn: v })} />
            <Slider label={`淡出 ${(c.fadeOut ?? 0).toFixed(1)}s`} min={0} max={5} step={0.1} value={c.fadeOut ?? 0} onChange={(v) => update(c.id, { fadeOut: v })} />
            {((c.fadeIn ?? 0) > 0 || (c.fadeOut ?? 0) > 0) && (
              <Row label="淡变曲线"><Select value={c.fadeCurve ?? "tri"} options={FADE_CURVES} onChange={(v) => update(c.id, { fadeCurve: v as NonNullable<Clip["fadeCurve"]> })} /></Row>
            )}
            {c.kind === "audio" && (
              <button
                onClick={() => update(c.id, { ducking: !c.ducking })}
                title="背景音乐：导出时遇到人声/其它音频自动压低音量（侧链压缩）"
                style={{ width: "100%", marginTop: 2, padding: "7px 0", fontSize: 11.5, borderRadius: 7, cursor: "pointer", border: `1px solid ${c.ducking ? EC.accent : EC.border}`, background: c.ducking ? EC.accentSoft : "transparent", color: c.ducking ? EC.accent : EC.t2 }}
              >{c.ducking ? "✓ 背景乐自动闪避（遇人声压低）" : "设为背景乐（遇人声自动闪避）"}</button>
            )}
            {c.kind === "audio" && (
              <button
                onClick={() => update(c.id, { denoise: !c.denoise })}
                title="降噪：对该音频做 FFT 降噪，清理底噪/嗡声/电流声（导出时生效）"
                style={{ width: "100%", marginTop: 2, padding: "7px 0", fontSize: 11.5, borderRadius: 7, cursor: "pointer", border: `1px solid ${c.denoise ? EC.accent : EC.border}`, background: c.denoise ? EC.accentSoft : "transparent", color: c.denoise ? EC.accent : EC.t2 }}
              >{c.denoise ? "✓ 降噪已开启" : "降噪（清理底噪）"}</button>
            )}
            {c.kind !== "audio" && <button
              onClick={() => update(c.id, { reverse: !c.reverse })}
              title="倒放：本片段逆序播放（导出时生效；预览为正放近似）"
              style={{ width: "100%", marginTop: 2, padding: "7px 0", fontSize: 11.5, borderRadius: 7, cursor: "pointer", border: `1px solid ${c.reverse ? EC.accent : EC.border}`, background: c.reverse ? EC.accentSoft : "transparent", color: c.reverse ? EC.accent : EC.t2 }}
            >{c.reverse ? "✓ 倒放已开启" : "倒放（逆序播放）"}</button>}
          </Section>
        )}

        {(c.kind === "video" || c.kind === "image") && clipTrackType === "video" && (
          <Section title="画面适配">
            <div style={{ display: "flex", gap: 6 }}>
              {([["contain", "适应"], ["cover", "填充"], ["stretch", "拉伸"], ["blur", "模糊"], ["none", "原始1:1"]] as const).map(([v, label]) => {
                const active = (c.fit ?? "contain") === v;
                return (
                  // 适配=整屏：清掉手动位置/缩放/旋转与关键帧，让 fit 真正作用于画面
                  <button key={v} onClick={() => update(c.id, { fit: v, transform: undefined, keyframes: undefined })}
                    title={v === "contain" ? "完整显示，留黑边" : v === "cover" ? "铺满画面，裁掉溢出" : v === "stretch" ? "拉伸铺满（可能变形）" : "模糊填充：原画完整居中，模糊放大的同画面铺满背景（消除黑边）"}
                    style={{ flex: 1, padding: "7px 0", fontSize: 11.5, borderRadius: 7, cursor: "pointer", border: `1px solid ${active ? EC.accent : EC.border}`, background: active ? EC.accentSoft : "transparent", color: active ? EC.accent : EC.t2 }}>{label}</button>
                );
              })}
            </div>
            <div style={{ fontSize: 10.5, color: EC.t4 }}>适应=留黑边 · 填充=铺满裁切 · 拉伸=变形铺满 · 模糊=模糊背景填黑边 · 原始=源生像素 1:1 居中（针对主轨整屏画面）</div>
          </Section>
        )}

        {(c.kind === "video" || c.kind === "image") && (
          <Section title="镜像 / 翻转">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Toggle on={!!c.flipH} onClick={() => update(c.id, { flipH: !c.flipH })} title="水平镜像（左右翻转）" wide>↔ 水平镜像</Toggle>
              <Toggle on={!!c.flipV} onClick={() => update(c.id, { flipV: !c.flipV })} title="垂直翻转（上下翻转）" wide>↕ 垂直翻转</Toggle>
            </div>
          </Section>
        )}

        {(c.kind === "video" || c.kind === "image") && clipTrackType === "overlay" && (
          <Section title="绿幕抠像">
            <button
              onClick={() => update(c.id, { chromaKey: c.chromaKey ? undefined : { color: "#00D000", similarity: 0.3, blend: 0.1 } })}
              title="把指定颜色（绿幕/蓝幕）抠成透明，与下层画面合成（导出时生效；预览暂显示原始绿幕）"
              style={{ width: "100%", padding: "7px 0", fontSize: 11.5, borderRadius: 7, cursor: "pointer", border: `1px solid ${c.chromaKey ? EC.accent : EC.border}`, background: c.chromaKey ? EC.accentSoft : "transparent", color: c.chromaKey ? EC.accent : EC.t2 }}
            >{c.chromaKey ? "✓ 绿幕抠像已开启" : "开启绿幕抠像"}</button>
            {c.chromaKey && (() => {
              const ck = c.chromaKey!;
              const setCk = (p: Partial<typeof ck>) => update(c.id, { chromaKey: { ...ck, ...p } });
              return (
                <>
                  <Row label="抠除色">
                    <input type="color" value={ck.color ?? "#00D000"} onChange={(e) => setCk({ color: e.target.value })} style={{ ...input, width: 34, height: 30, padding: 2 }} />
                    <button onClick={() => setCk({ color: "#00D000" })} style={{ marginLeft: 6, padding: "4px 8px", fontSize: 11, borderRadius: 6, cursor: "pointer", border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2 }}>绿</button>
                    <button onClick={() => setCk({ color: "#0047FF" })} style={{ marginLeft: 4, padding: "4px 8px", fontSize: 11, borderRadius: 6, cursor: "pointer", border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2 }}>蓝</button>
                  </Row>
                  <Slider label={`容差 ${(ck.similarity ?? 0.3).toFixed(2)}`} min={0.01} max={1} step={0.01} value={ck.similarity ?? 0.3} onChange={(v) => setCk({ similarity: v })} />
                  <Slider label={`边缘羽化 ${(ck.blend ?? 0.1).toFixed(2)}`} min={0} max={1} step={0.01} value={ck.blend ?? 0.1} onChange={(v) => setCk({ blend: v })} />
                  <div style={{ fontSize: 10.5, color: EC.t4, lineHeight: 1.5 }}>容差越大抠得越多（抠不干净就调大）；羽化让边缘更柔和。导出时抠除，预览暂显示原始画面。</div>
                </>
              );
            })()}
          </Section>
        )}

        {(c.kind === "video" || c.kind === "image") && clipTrackType === "overlay" && (
          <Section title="形状蒙版">
            <div style={{ display: "flex", gap: 6 }}>
              {([["", "无"], ["rect", "矩形"], ["ellipse", "椭圆"]] as [string, string][]).map(([v, l]) => {
                const active = (c.mask?.type ?? "") === v;
                return (
                  <button key={v || "none"} onClick={() => update(c.id, { mask: v === "" ? undefined : { type: v as "rect" | "ellipse", x: c.mask?.x ?? 0.2, y: c.mask?.y ?? 0.2, w: c.mask?.w ?? 0.6, h: c.mask?.h ?? 0.6, feather: c.mask?.feather, invert: c.mask?.invert } })}
                    style={{ flex: 1, padding: "6px 0", fontSize: 11, borderRadius: 6, cursor: "pointer", border: `1px solid ${active ? EC.accent : EC.border}`, background: active ? EC.accentSoft : "transparent", color: active ? EC.accent : EC.t2 }}>{l}</button>
                );
              })}
            </div>
            {c.mask && (() => {
              const mask = c.mask!;
              const setMask = (p: Partial<typeof mask>) => update(c.id, { mask: { ...mask, ...p } });
              return (
                <>
                  <Slider label={`X ${Math.round(mask.x * 100)}%`} min={-0.2} max={1} step={0.01} value={mask.x} onChange={(v) => setMask({ x: v })} />
                  <Slider label={`Y ${Math.round(mask.y * 100)}%`} min={-0.2} max={1} step={0.01} value={mask.y} onChange={(v) => setMask({ y: v })} />
                  <Slider label={`宽 ${Math.round(mask.w * 100)}%`} min={0.05} max={1.2} step={0.01} value={mask.w} onChange={(v) => setMask({ w: v })} />
                  <Slider label={`高 ${Math.round(mask.h * 100)}%`} min={0.05} max={1.2} step={0.01} value={mask.h} onChange={(v) => setMask({ h: v })} />
                  <Slider label={`羽化 ${Math.round((mask.feather ?? 0) * 100)}%`} min={0} max={1} step={0.02} value={mask.feather ?? 0} onChange={(v) => setMask({ feather: v || undefined })} />
                  <Toggle on={!!mask.invert} onClick={() => setMask({ invert: !mask.invert })} title="反转：保留形状外、挖空形状内"><span style={{ fontSize: 11 }}>反转蒙版</span></Toggle>
                  <div style={{ fontSize: 10.5, color: EC.t4, lineHeight: 1.5 }}>只显示形状内（或反转后形状外）的画面。羽化让边缘柔和过渡。仅叠加层/画中画生效。</div>
                </>
              );
            })()}
          </Section>
        )}

        {isVisual && c.kind !== "text" && (
          <Section title="调色 / 滤镜">
            <Slider label={`亮度 ${(eff.brightness ?? 0).toFixed(2)}`} min={-1} max={1} step={0.02} value={eff.brightness ?? 0} onChange={(v) => setEff("brightness", v)} />
            <Slider label={`对比度 ${(eff.contrast ?? 1).toFixed(2)}`} min={0} max={2} step={0.02} value={eff.contrast ?? 1} onChange={(v) => setEff("contrast", v)} />
            <Slider label={`饱和度 ${(eff.saturation ?? 1).toFixed(2)}`} min={0} max={3} step={0.02} value={eff.saturation ?? 1} onChange={(v) => setEff("saturation", v)} />
            <Row label="滤镜"><Select value={eff.filter ?? ""} options={FILTERS} onChange={(v) => setEff("filter", v || undefined)} /></Row>
            <Slider label={`暗角 ${Math.round((eff.vignette ?? 0) * 100)}%`} min={0} max={1} step={0.02} value={eff.vignette ?? 0} onChange={(v) => setEff("vignette", v || undefined)} />
            <Slider label={`锐化 ${Math.round((eff.sharpen ?? 0) * 100)}%`} min={0} max={1} step={0.02} value={eff.sharpen ?? 0} onChange={(v) => setEff("sharpen", v || undefined)} />
          </Section>
        )}

        {isVisual && (
          <Section title="位置 / 大小">
            <div style={{ display: "flex", gap: 6, marginBottom: 2 }}>
              {clipTrackType === "video" && (c.kind === "video" || c.kind === "image") && (
                <button onClick={() => update(c.id, { fit: "cover", transform: undefined, keyframes: undefined })} title="自动缩放铺满画框、消除黑边（按比例裁切溢出；预览与导出一致）" style={{ ...alignBtn, color: EC.accent, borderColor: EC.accent }}>填满</button>
              )}
              <button onClick={() => centerAxis("x")} title="水平居中（画中画时居中框）" style={alignBtn}>水平居中</button>
              <button onClick={() => centerAxis("y")} title="垂直居中（画中画时居中框）" style={alignBtn}>垂直居中</button>
              <button onClick={() => update(c.id, { transform: undefined, keyframes: undefined })} title="复位为整屏居中（清除手动位置/缩放/旋转）" style={alignBtn}>居中</button>
              <button onClick={() => update(c.id, { transform: undefined })} title="清除位置/缩放/旋转" style={alignBtn}>重置</button>
            </div>
            <NumSlider label="缩放" value={tf.scale ?? 1} min={0.05} max={3} step={0.01} disp={(v) => Math.round(v * 100)} parse={(s) => s / 100} suffix="%" onChange={(v) => setTf("scale", v)} />
            <NumSlider label="X" value={tf.x ?? 0} min={-0.5} max={1} step={0.005} disp={(v) => Math.round(v * 100)} parse={(s) => s / 100} suffix="%" onChange={(v) => setTf("x", v)} />
            <NumSlider label="Y" value={tf.y ?? 0} min={-0.5} max={1} step={0.005} disp={(v) => Math.round(v * 100)} parse={(s) => s / 100} suffix="%" onChange={(v) => setTf("y", v)} />
            <NumSlider label="旋转" value={tf.rotation ?? 0} min={-180} max={180} step={1} disp={(v) => Math.round(v)} parse={(s) => s} suffix="°" onChange={(v) => setTf("rotation", v)} />
            <NumSlider label="不透明度" value={tf.opacity ?? 1} min={0} max={1} step={0.01} disp={(v) => Math.round(v * 100)} parse={(s) => s / 100} suffix="%" onChange={(v) => setTf("opacity", v)} />
            {clipTrackType === "video" && (
              <div style={{ fontSize: 10.5, color: EC.t4, lineHeight: 1.5 }}>主轨：先「填满」消黑，再用<b>缩放</b>放大局部、<b>X/Y</b>平移取景（裁切到画框，导出一致）。缩放&lt;1 不生效——要画中画/缩小浮窗请放到「叠加」轨。</div>
            )}
          </Section>
        )}

        {isVisual && (
          <Section title="关键帧动画">
            <div style={{ fontSize: 11, color: EC.t3, marginBottom: 6, lineHeight: 1.5 }}>
              在播放头处记录当前「位置 / 缩放 / 旋转 / 不透明度」为关键帧；多个关键帧之间自动补间，预览实时演示。{clipTrackType === "video"
                ? <>导出：<b>缩放 / 平移（Ken-Burns）+ 旋转 + 缓动曲线已支持</b>；不透明度关键帧仅预览。</>
                : <>导出：<b>位置（移动）+ 缩放（PiP 推拉）+ 缓动曲线已支持</b>；旋转 / 不透明度关键帧仅预览。</>}
            </div>
            <button
              onClick={() => {
                const t = +(playhead - c.start).toFixed(3);
                const dur = (c.trimOut - c.trimIn) / (c.speed ?? 1);
                if (t < -0.001 || t > dur + 0.001) { toast.error("请先把播放头移到该片段时间范围内"); return; }
                addKeyframe(c.id, Math.max(0, t));
                toast.success("已在播放头添加关键帧");
              }}
              style={{ ...alignBtn, width: "100%" }}
            >＋ 在播放头添加关键帧</button>
            {(c.keyframes ?? []).length >= 2 && (
              <Row label="缓动曲线">
                <Select
                  value={c.keyframes?.find((k) => k.ease)?.ease ?? "linear"}
                  options={EASE_OPTIONS}
                  onChange={(v) => update(c.id, { keyframes: (c.keyframes ?? []).map((k) => ({ ...k, ease: v === "linear" ? undefined : (v as NonNullable<Clip["keyframes"]>[number]["ease"]) })) })}
                />
              </Row>
            )}
            {(c.keyframes ?? []).length > 0 && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
                  {[...(c.keyframes ?? [])].sort((a, b) => a.t - b.t).map((k) => (
                    <div key={k.t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: EC.t2, padding: "3px 6px", borderRadius: 6, background: "var(--c-elevated)" }}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @ {k.t.toFixed(2)}s · {Math.round((k.scale ?? 1) * 100)}% · α{Math.round((k.opacity ?? 1) * 100)} · {Math.round(k.rotation ?? 0)}°
                      </span>
                      <button onClick={() => setPlayhead(c.start + k.t)} title="跳到此关键帧" style={alignBtn}>定位</button>
                      <button onClick={() => removeKeyframe(c.id, k.t)} title="删除关键帧" style={{ ...alignBtn, padding: "2px 6px" }}><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
                <button onClick={() => clearKeyframes(c.id)} style={{ ...alignBtn, width: "100%", marginTop: 4 }}>清除全部关键帧</button>
              </>
            )}
          </Section>
        )}

        <Section title="入场转场">
          <Row label="类型"><Select value={c.transitionIn?.type ?? "none"} options={TRANSITIONS} onChange={(v) => update(c.id, { transitionIn: { type: v as never, duration: c.transitionIn?.duration ?? 0.5 } })} /></Row>
          {c.transitionIn && c.transitionIn.type !== "none" && (
            <Slider label={`时长 ${c.transitionIn.duration.toFixed(1)}s`} min={0.1} max={2} step={0.1} value={c.transitionIn.duration} onChange={(v) => update(c.id, { transitionIn: { type: c.transitionIn!.type, duration: v } })} />
          )}
          <div style={{ fontSize: 10.5, color: EC.t4, lineHeight: 1.5 }}>与<b>前一个主轨片段</b>交叉转场（cross-dissolve）。预览在转场区间叠化演示；导出由 ffmpeg xfade 精确合成。</div>
        </Section>
      </div>
    </aside>
  );
}

function labelKind(k: string) { return k === "video" ? "视频" : k === "audio" ? "音频" : k === "image" ? "图片" : "文字"; }

function Toggle({ on, onClick, title, wide, children }: { on: boolean; onClick: () => void; title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{
      height: 30, minWidth: wide ? 56 : 30, padding: wide ? "0 10px" : 0, flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
      fontSize: 12, borderRadius: 7, cursor: "pointer",
      border: `1px solid ${on ? EC.accent : EC.border}`, background: on ? EC.accentSoft : "transparent", color: on ? EC.accent : EC.t2,
    }}>{children}</button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: EC.t3, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 11, color: EC.t3, width: 52, flexShrink: 0 }}>{label}</span><div style={{ flex: 1 }}>{children}</div></div>;
}
function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: EC.t2, marginBottom: 3 }}>{label}</div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: EC.accent }} />
    </div>
  );
}
/** Slider + precise numeric input (剪映-style). `disp`/`parse` map raw↔displayed. */
function NumSlider({ label, value, min, max, step, suffix, disp, parse, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string;
  disp: (v: number) => number; parse: (display: number) => number; onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: EC.t2, flex: 1 }}>{label}</span>
        <input type="number" value={disp(value)} onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) onChange(clamp(parse(n))); }}
          style={{ width: 56, padding: "2px 6px", fontSize: 11, textAlign: "right", borderRadius: 6, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none" }} />
        {suffix && <span style={{ fontSize: 10, color: EC.t4, width: 14, textAlign: "right" }}>{suffix}</span>}
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: EC.accent }} />
    </div>
  );
}
const alignBtn: React.CSSProperties = { flex: 1, padding: "5px 0", fontSize: 11, borderRadius: 6, cursor: "pointer", border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2 };
function Select({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, cursor: "pointer" }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const panel: React.CSSProperties = { width: 250, flexShrink: 0, borderLeft: `1px solid ${EC.border}`, display: "flex", flexDirection: "column", minHeight: 0, background: EC.surface };
const input: React.CSSProperties = { width: "100%", padding: "5px 7px", fontSize: 12, borderRadius: 6, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, outline: "none" };

// 颜色字符串 ↔ {纯色 #RRGGBB, 不透明度 0..1}。支持 8 位十六进制(#RRGGBBAA)读写；
// 完全不透明时回写 6 位 #RRGGBB（向后兼容、不污染老数据）。
function splitColor(v: string | undefined, fallback: string): { rgb: string; a: number } {
  const hex = (v ?? fallback).trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return { rgb: "#" + hex.slice(0, 6), a: parseInt(hex.slice(6, 8), 16) / 255 };
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return { rgb: "#" + hex, a: 1 };
  if (/^[0-9a-fA-F]{3}$/.test(hex)) return { rgb: "#" + hex.split("").map((c) => c + c).join(""), a: 1 };
  return { rgb: fallback, a: 1 };
}
function joinColor(rgb: string, a: number): string {
  const clamped = Math.max(0, Math.min(1, a));
  if (clamped >= 1) return rgb;
  return rgb + Math.round(clamped * 255).toString(16).padStart(2, "0");
}

/** 颜色 + 不透明度控件：色板选 RGB，滑杆调透明度，回写为 #RRGGBB / #RRGGBBAA。 */
function ColorAlpha({ value, fallback, onChange, compact }: { value?: string; fallback: string; onChange: (v: string) => void; compact?: boolean }) {
  const { rgb, a } = splitColor(value, fallback);
  const pct = Math.round(a * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: compact ? undefined : 1 }}>
      <input type="color" value={rgb} onChange={(e) => onChange(joinColor(e.target.value, a))} style={{ ...input, width: 34, height: 30, padding: 2, flexShrink: 0 }} />
      <input type="range" min={0} max={100} value={pct} onChange={(e) => onChange(joinColor(rgb, Number(e.target.value) / 100))} title={`不透明度 ${pct}%`} style={{ flex: 1, minWidth: 44, accentColor: EC.accent }} />
      <span style={{ fontSize: 10.5, color: EC.t2, width: 30, textAlign: "right", flexShrink: 0 }}>{pct}%</span>
    </div>
  );
}
