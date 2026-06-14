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
const FILTERS: [string, string][] = [["", "无"], ["cinematic", "电影感"], ["vintage", "复古"], ["warm", "暖色"], ["cool", "冷色"], ["bw", "黑白"]];
const TRANSITIONS: [string, string][] = [["none", "无"], ["fade", "淡入淡出"], ["dissolve", "叠化"], ["slide", "滑动"], ["wipe", "擦除"]];
const MOTIONS: [string, string][] = [["none", "无"], ["fade", "淡入"], ["roll", "滚动"], ["karaoke", "卡拉OK"], ["bounce", "弹跳"]];

export function PropertiesPanel() {
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
    return (
      <aside style={panel}>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: EC.t1 }}>已选 {n} 个片段</div>
          <div style={{ fontSize: 11, color: EC.t4, lineHeight: 1.5 }}>在时间轴上拖动可整体移动；下列操作作用于全部选中片段。Shift/Ctrl 点击可加选/减选，空白处拖拽框选。</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...mBtn, flex: 1 }} title="把所选片段在各自轨道上首尾相接，闭合中间的空隙" onClick={() => closeGapsSelected()}>紧排</button>
            <button style={{ ...mBtn, flex: 1 }} title="整体平移，使最早的选中片段对齐到播放头" onClick={() => alignSelectedStartTo(useEditorStore.getState().playhead)}>对齐到播放头</button>
          </div>
          <button style={mBtn} onClick={() => duplicateSelected()}>原地复制全部（Ctrl+D）</button>
          <button style={mBtn} onClick={() => copySelected()}>拷贝到剪贴板（Ctrl+C）</button>
          <button style={{ ...mBtn, color: "oklch(0.65 0.2 25)", borderColor: "oklch(0.65 0.2 25 / 0.5)" }} onClick={() => removeSelected()}>删除全部（Del）</button>
        </div>
      </aside>
    );
  }

  let clip: Clip | null = null;
  if (doc && selectedClipId) {
    for (const t of doc.tracks) { const c = t.clips.find((x) => x.id === selectedClipId); if (c) { clip = c; break; } }
  }

  if (!clip) {
    return <aside style={panel}><div style={{ padding: 14, fontSize: 12, color: EC.t4 }}>选中一个片段以编辑属性</div></aside>;
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
  // Center on an axis using the actually-rendered box size (falls back to an
  // estimate when the clip isn't visible at the current playhead).
  const centerAxis = (axis: "x" | "y") => {
    const box = document.querySelector(`[data-clip-box="${c.id}"]`) as HTMLElement | null;
    const stage = box?.offsetParent as HTMLElement | null;
    if (box && stage?.offsetWidth && stage.offsetHeight) {
      if (axis === "x") setTf("x", Math.max(0, (1 - box.offsetWidth / stage.offsetWidth) / 2));
      else setTf("y", Math.max(0, (1 - box.offsetHeight / stage.offsetHeight) / 2));
    } else if (axis === "x") setTf("x", Math.max(0, (1 - (tf.scale ?? 1)) / 2));
    else setTf("y", 0.4);
  };

  return (
    <aside style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${EC.border}` }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: EC.t1, flex: 1 }}>{labelKind(c.kind)} 属性</span>
        <button onClick={() => remove(c.id)} title="删除片段" style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 7, border: `1px solid ${EC.border}`, background: "transparent", color: "oklch(0.62 0.20 25)", cursor: "pointer" }}><Trash2 size={14} /></button>
      </div>

      <div style={{ overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
        {c.kind === "text" && (
          <Section title="文字">
            <textarea value={txt?.content ?? ""} onChange={(e) => setText({ content: e.target.value })}
              rows={2} style={{ ...input, resize: "vertical" }} placeholder="输入文字…" />
            <Row label="字号"><input type="number" value={txt?.size ?? 48} onChange={(e) => setText({ size: Number(e.target.value) })} style={input} /></Row>
            <Row label="字体"><Select value={txt?.font ?? ""} options={FONTS} onChange={(v) => setText({ font: v || undefined })} /></Row>
            {/* style row: bold / italic / alignment */}
            <div style={{ display: "flex", gap: 6 }}>
              <Toggle on={!!txt?.bold} onClick={() => setText({ bold: !txt?.bold })} title="粗体"><b>B</b></Toggle>
              <Toggle on={!!txt?.italic} onClick={() => setText({ italic: !txt?.italic })} title="斜体"><i>I</i></Toggle>
              <Toggle on={(txt?.align ?? "center") === "left"} onClick={() => setText({ align: "left" })} title="左对齐"><AlignLeft size={13} /></Toggle>
              <Toggle on={(txt?.align ?? "center") === "center"} onClick={() => setText({ align: "center" })} title="居中"><AlignCenter size={13} /></Toggle>
              <Toggle on={(txt?.align ?? "center") === "right"} onClick={() => setText({ align: "right" })} title="右对齐"><AlignRight size={13} /></Toggle>
            </div>
            <Row label="颜色"><input type="color" value={txt?.color ?? "#ffffff"} onChange={(e) => setText({ color: e.target.value })} style={{ ...input, height: 30, padding: 2 }} /></Row>
            {/* 描边 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle on={(txt?.strokeWidth ?? 0) > 0} onClick={() => setText({ strokeWidth: (txt?.strokeWidth ?? 0) > 0 ? 0 : 4, strokeColor: txt?.strokeColor ?? "#000000" })} title="描边" wide>描边</Toggle>
              {(txt?.strokeWidth ?? 0) > 0 && <>
                <input type="number" min={0} max={40} value={txt?.strokeWidth ?? 4} onChange={(e) => setText({ strokeWidth: Number(e.target.value) })} style={{ ...input, width: 54 }} />
                <input type="color" value={txt?.strokeColor ?? "#000000"} onChange={(e) => setText({ strokeColor: e.target.value })} style={{ ...input, width: 34, height: 30, padding: 2 }} />
              </>}
            </div>
            {/* 投影 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle on={!!txt?.shadow} onClick={() => setText({ shadow: !txt?.shadow, shadowColor: txt?.shadowColor ?? "#000000" })} title="投影" wide>投影</Toggle>
              {txt?.shadow && <input type="color" value={txt?.shadowColor ?? "#000000"} onChange={(e) => setText({ shadowColor: e.target.value })} style={{ ...input, width: 34, height: 30, padding: 2 }} />}
            </div>
            {/* 背景框 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle on={!!txt?.bgColor} onClick={() => setText({ bgColor: txt?.bgColor ? undefined : "#000000" })} title="背景框" wide>背景框</Toggle>
              {txt?.bgColor && <input type="color" value={txt?.bgColor ?? "#000000"} onChange={(e) => setText({ bgColor: e.target.value })} style={{ ...input, width: 34, height: 30, padding: 2 }} />}
            </div>
            <Row label="动效"><Select value={txt?.motionStyle ?? "none"} options={MOTIONS} onChange={(v) => setText({ motionStyle: v as NonNullable<Clip["text"]>["motionStyle"] })} /></Row>
            <Row label="配音模型"><Select value={ttsModel} options={TTS_MODELS} onChange={pickModel} /></Row>
            <Row label="发音人"><Select value={ttsVoice} options={voicesForModel(ttsModel)} onChange={setTtsVoice} /></Row>
            <button
              disabled={dubMut.isPending}
              onClick={() => aiDub(c.text?.content ?? "", c.start)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", fontSize: 12, borderRadius: 7, border: `1px solid ${EC.accent}`, background: EC.accentSoft, color: EC.accent, cursor: dubMut.isPending ? "default" : "pointer" }}
            ><Mic size={13} /> {dubMut.isPending ? "生成中…" : "AI 配音（朗读这段文字）"}</button>
          </Section>
        )}

        {isMedia && (
          <Section title="播放">
            <Slider label={`速度 ${(c.speed ?? 1).toFixed(2)}x`} min={0.25} max={4} step={0.05} value={c.speed ?? 1} onChange={(v) => update(c.id, { speed: v })} />
            <Slider label={`音量 ${Math.round((c.volume ?? 1) * 100)}%`} min={0} max={2} step={0.05} value={c.volume ?? 1} onChange={(v) => update(c.id, { volume: v })} />
            <Slider label={`淡入 ${(c.fadeIn ?? 0).toFixed(1)}s`} min={0} max={5} step={0.1} value={c.fadeIn ?? 0} onChange={(v) => update(c.id, { fadeIn: v })} />
            <Slider label={`淡出 ${(c.fadeOut ?? 0).toFixed(1)}s`} min={0} max={5} step={0.1} value={c.fadeOut ?? 0} onChange={(v) => update(c.id, { fadeOut: v })} />
            <button
              onClick={() => update(c.id, { reverse: !c.reverse })}
              title="倒放：本片段逆序播放（导出时生效；预览为正放近似）"
              style={{ width: "100%", marginTop: 2, padding: "7px 0", fontSize: 11.5, borderRadius: 7, cursor: "pointer", border: `1px solid ${c.reverse ? EC.accent : EC.border}`, background: c.reverse ? EC.accentSoft : "transparent", color: c.reverse ? EC.accent : EC.t2 }}
            >{c.reverse ? "✓ 倒放已开启" : "倒放（逆序播放）"}</button>
          </Section>
        )}

        {(c.kind === "video" || c.kind === "image") && (
          <Section title="画面适配">
            <div style={{ display: "flex", gap: 6 }}>
              {([["contain", "适应"], ["cover", "填充"], ["stretch", "拉伸"], ["blur", "模糊"]] as const).map(([v, label]) => {
                const active = (c.fit ?? "contain") === v;
                return (
                  <button key={v} onClick={() => update(c.id, { fit: v })}
                    title={v === "contain" ? "完整显示，留黑边" : v === "cover" ? "铺满画面，裁掉溢出" : v === "stretch" ? "拉伸铺满（可能变形）" : "模糊填充：原画完整居中，模糊放大的同画面铺满背景（消除黑边）"}
                    style={{ flex: 1, padding: "7px 0", fontSize: 11.5, borderRadius: 7, cursor: "pointer", border: `1px solid ${active ? EC.accent : EC.border}`, background: active ? EC.accentSoft : "transparent", color: active ? EC.accent : EC.t2 }}>{label}</button>
                );
              })}
            </div>
            <div style={{ fontSize: 10.5, color: EC.t4 }}>适应=留黑边 · 填充=铺满裁切 · 拉伸=变形铺满 · 模糊=模糊背景填黑边（针对主轨整屏画面）</div>
          </Section>
        )}

        {isVisual && c.kind !== "text" && (
          <Section title="调色 / 滤镜">
            <Slider label={`亮度 ${(eff.brightness ?? 0).toFixed(2)}`} min={-1} max={1} step={0.02} value={eff.brightness ?? 0} onChange={(v) => setEff("brightness", v)} />
            <Slider label={`对比度 ${(eff.contrast ?? 1).toFixed(2)}`} min={0} max={2} step={0.02} value={eff.contrast ?? 1} onChange={(v) => setEff("contrast", v)} />
            <Slider label={`饱和度 ${(eff.saturation ?? 1).toFixed(2)}`} min={0} max={3} step={0.02} value={eff.saturation ?? 1} onChange={(v) => setEff("saturation", v)} />
            <Row label="滤镜"><Select value={eff.filter ?? ""} options={FILTERS} onChange={(v) => setEff("filter", v || undefined)} /></Row>
          </Section>
        )}

        {isVisual && (
          <Section title="位置 / 大小">
            <div style={{ display: "flex", gap: 6, marginBottom: 2 }}>
              <button onClick={() => centerAxis("x")} title="水平居中" style={alignBtn}>水平居中</button>
              <button onClick={() => centerAxis("y")} title="垂直居中" style={alignBtn}>垂直居中</button>
              <button onClick={() => { centerAxis("x"); centerAxis("y"); }} title="居中" style={alignBtn}>居中</button>
              <button onClick={() => update(c.id, { transform: undefined })} title="清除位置/缩放/旋转" style={alignBtn}>重置</button>
            </div>
            <NumSlider label="缩放" value={tf.scale ?? 1} min={0.05} max={3} step={0.01} disp={(v) => Math.round(v * 100)} parse={(s) => s / 100} suffix="%" onChange={(v) => setTf("scale", v)} />
            <NumSlider label="X" value={tf.x ?? 0} min={-0.5} max={1} step={0.005} disp={(v) => Math.round(v * 100)} parse={(s) => s / 100} suffix="%" onChange={(v) => setTf("x", v)} />
            <NumSlider label="Y" value={tf.y ?? 0} min={-0.5} max={1} step={0.005} disp={(v) => Math.round(v * 100)} parse={(s) => s / 100} suffix="%" onChange={(v) => setTf("y", v)} />
            <NumSlider label="旋转" value={tf.rotation ?? 0} min={-180} max={180} step={1} disp={(v) => Math.round(v)} parse={(s) => s} suffix="°" onChange={(v) => setTf("rotation", v)} />
            <NumSlider label="不透明度" value={tf.opacity ?? 1} min={0} max={1} step={0.01} disp={(v) => Math.round(v * 100)} parse={(s) => s / 100} suffix="%" onChange={(v) => setTf("opacity", v)} />
          </Section>
        )}

        {isVisual && (
          <Section title="关键帧动画">
            <div style={{ fontSize: 11, color: EC.t3, marginBottom: 6, lineHeight: 1.5 }}>
              在播放头处记录当前「位置 / 缩放 / 旋转 / 不透明度」为关键帧；多个关键帧之间自动补间。预览实时演示。
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
