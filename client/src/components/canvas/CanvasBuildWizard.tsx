import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { X, ChevronRight, ChevronLeft, Wand2, CheckCircle2, Film, Image as ImageIcon, Video, Music } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { applyAgentOperations } from "@/lib/agentApply";
import { buildWizardOps, groupCreatedByFunction, WIZARD_DEFAULT, type WizardChoices, type WizardGoal, type WizardSource } from "@/lib/wizardPlan";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/models";
import { trpc } from "@/lib/trpc";
import type { NodeType } from "../../../../shared/types";

// ── 新建画布「建立向导」(#159)：分步选择 → 自动建节点链 + 按功能分区自动群组化 ────────
// 纯 UI；规划逻辑全在 wizardPlan.ts（可单测）。完成时 buildWizardOps→applyAgentOperations
// 落地节点（与助手/配方同一条应用管线，可撤销可协作同步），再按功能组 groupSelected 成组。

const ACCENT = "oklch(0.70 0.20 310)"; // 品牌紫
const A = (a: number) => `oklch(0.70 0.20 310 / ${a})`;

type Step = "goal" | "shots" | "source" | "extras" | "confirm";
const STEPS: { id: Step; label: string }[] = [
  { id: "goal", label: "目标" },
  { id: "shots", label: "画面" },
  { id: "source", label: "来源" },
  { id: "extras", label: "增强" },
  { id: "confirm", label: "确认" },
];

const GOALS: { id: WizardGoal; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: "film", label: "完整短片", desc: "剧本→分镜→生图→图生视频→合成成片", icon: <Film size={18} /> },
  { id: "video", label: "只出视频", desc: "剧本→分镜→逐镜生成视频", icon: <Video size={18} /> },
  { id: "images", label: "只出图", desc: "批量关键帧/概念图", icon: <ImageIcon size={18} /> },
  { id: "audio", label: "音频", desc: "配乐 / 旁白配音", icon: <Music size={18} /> },
];

const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "21:9", ""];

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {STEPS.map((s, i) => {
        const done = i < idx, active = i === idx;
        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%", flexShrink: 0, fontSize: 10, fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: done || active ? ACCENT : "var(--c-bd1)", color: done || active ? "#fff" : "var(--c-t3)",
            }}>{done ? <CheckCircle2 style={{ width: 12, height: 12 }} /> : i + 1}</span>
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? "var(--c-t1)" : "var(--c-t4)", whiteSpace: "nowrap" }}>{s.label}</span>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: done ? ACCENT : "var(--c-bd1)", margin: "0 4px" }} />}
          </div>
        );
      })}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%", fontSize: 12.5, padding: "8px 10px", borderRadius: 8,
  background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none",
};

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", padding: "7px 0" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2, accentColor: ACCENT }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, color: "var(--c-t1)", fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 11, color: "var(--c-t4)" }}>{hint}</span>}
      </span>
    </label>
  );
}

export function CanvasBuildWizard({ onClose }: { onClose: () => void }) {
  const reactFlow = useReactFlow();
  const [step, setStep] = useState<Step>("goal");
  const [c, setC] = useState<WizardChoices>(WIZARD_DEFAULT);
  // 选中的 ComfyUI 模版 id（仅驱动下拉显示；对应的干净 payload 存进 choices）。
  const [imgTplId, setImgTplId] = useState("");
  const [vidTplId, setVidTplId] = useState("");
  const set = <K extends keyof WizardChoices>(k: K, v: WizardChoices[K]) => setC((p) => ({ ...p, [k]: v }));

  const ops = useMemo(() => buildWizardOps(c), [c]);
  const createCount = useMemo(() => ops.filter((o) => o.op === "create").length, [ops]);

  // #159 增强：自建来源可选「已保存的 ComfyUI 模版」；仅在选到 comfy 来源时拉取。
  const templatesQuery = trpc.comfyTemplates.list.useQuery(undefined, { enabled: c.source === "comfy", staleTime: 60_000 });
  const comfyImageTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((t) => t.nodeType === "comfyui_image" || t.nodeType === "comfyui_workflow"),
    [templatesQuery.data],
  );
  const comfyVideoTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((t) => t.nodeType === "comfyui_video" || t.nodeType === "comfyui_workflow"),
    [templatesQuery.data],
  );
  const wantVideoModel = c.goal === "film" || c.goal === "video";
  const wantImageModel = c.goal === "images" || ((c.goal === "film" || c.goal === "video") && c.imageFirst);

  const idx = STEPS.findIndex((s) => s.id === step);
  const isLast = step === "confirm";
  // audio 目标无「画面/来源」可选，跳过这两步。
  const visibleSteps = c.goal === "audio" ? STEPS.filter((s) => s.id !== "shots" && s.id !== "source") : STEPS;
  const goNext = () => {
    const vi = visibleSteps.findIndex((s) => s.id === step);
    if (vi < visibleSteps.length - 1) setStep(visibleSteps[vi + 1].id);
  };
  const goPrev = () => {
    const vi = visibleSteps.findIndex((s) => s.id === step);
    if (vi > 0) setStep(visibleSteps[vi - 1].id);
  };

  const finish = () => {
    if (!ops.length) { toast.error("当前选择没有可建的节点"); return; }
    const anchor = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 560, y: window.innerHeight / 2 - 280 });
    const res = applyAgentOperations(ops, anchor, {});
    if (res.created <= 0) { toast.error("建立失败，请重试"); return; }
    // 按功能分区自动群组化：从 store 读回每个新建节点的真实类型再归组。
    const nodes = useCanvasStore.getState().nodes;
    const typeOf = (id: string): NodeType | undefined => nodes.find((n) => n.id === id)?.data.nodeType as NodeType | undefined;
    const groups = groupCreatedByFunction(res.createdIds, typeOf);
    let grouped = 0;
    for (const g of groups) {
      const gid = useCanvasStore.getState().groupSelected(g.ids, g.title);
      if (gid) grouped++;
    }
    toast.success(`向导已搭好 ${res.created} 个节点${grouped > 0 ? `，自动分为 ${grouped} 个功能组` : ""}——填内容后即可逐个生成`);
    setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 400 }), 140);
    onClose();
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="nodrag"
        style={{
          width: "min(560px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column",
          background: "var(--c-surface)", border: "1px solid var(--c-bd2)", borderRadius: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)", overflow: "hidden",
        }}
      >
        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 12px" }}>
          <span style={{ display: "inline-flex", width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 9, background: A(0.14), color: ACCENT }}>
            <Wand2 size={18} />
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: "var(--c-t1)" }}>建立向导</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--c-t4)" }}>分步选择需求，自动搭建节点并按功能分区群组</span>
          </span>
          <button onClick={onClose} style={{ border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer", padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ padding: "0 18px 12px" }}><StepBar current={step} /></div>

        {/* 内容 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 18px 16px" }}>
          {step === "goal" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {GOALS.map((g) => {
                const on = c.goal === g.id;
                return (
                  <button key={g.id} onClick={() => set("goal", g.id)} style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 13px", textAlign: "left", cursor: "pointer",
                    borderRadius: 11, border: `1.5px solid ${on ? ACCENT : "var(--c-bd2)"}`, background: on ? A(0.08) : "var(--c-input)", color: "var(--c-t1)",
                  }}>
                    <span style={{ color: on ? ACCENT : "var(--c-t3)", flexShrink: 0, marginTop: 1 }}>{g.icon}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{g.label}</span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--c-t4)", lineHeight: 1.4 }}>{g.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {step === "shots" && c.goal !== "audio" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label>
                <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 6 }}>画面比例</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {ASPECTS.map((a) => {
                    const on = c.aspect === a;
                    return (
                      <button key={a || "none"} onClick={() => set("aspect", a)} style={{
                        padding: "6px 12px", fontSize: 12, borderRadius: 8, cursor: "pointer",
                        border: `1.5px solid ${on ? ACCENT : "var(--c-bd2)"}`, background: on ? A(0.1) : "var(--c-input)",
                        color: on ? ACCENT : "var(--c-t2)", fontWeight: on ? 700 : 500,
                      }}>{a || "不指定"}</button>
                    );
                  })}
                </div>
              </label>
              <label>
                <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 6 }}>风格（可空）</span>
                <input value={c.style} onChange={(e) => set("style", e.target.value)} placeholder="如：赛博朋克、水墨、皮克斯 3D…" style={fieldStyle} />
              </label>
              <div style={{ display: "flex", gap: 14 }}>
                <label style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 6 }}>{c.goal === "images" ? "张数" : "镜头数"}</span>
                  <input type="number" min={1} max={30} value={c.shots} onChange={(e) => set("shots", Number(e.target.value))} style={fieldStyle} />
                </label>
                {c.goal !== "images" && (
                  <label style={{ flex: 1 }}>
                    <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 6 }}>每镜时长（秒）</span>
                    <input type="number" min={1} max={60} value={c.durationSec} onChange={(e) => set("durationSec", Number(e.target.value))} style={fieldStyle} />
                  </label>
                )}
              </div>
            </div>
          )}

          {step === "source" && c.goal !== "audio" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 6 }}>画面来源</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {([["cloud", "云端模型", "kie/poyo 等，开箱即用"], ["comfy", "自建 ComfyUI", "本地显卡池，需已配置服务器"]] as [WizardSource, string, string][]).map(([v, label, hint]) => {
                    const on = c.source === v;
                    return (
                      <button key={v} onClick={() => set("source", v)} style={{
                        flex: 1, padding: "11px 13px", textAlign: "left", cursor: "pointer", borderRadius: 10,
                        border: `1.5px solid ${on ? ACCENT : "var(--c-bd2)"}`, background: on ? A(0.08) : "var(--c-input)", color: "var(--c-t1)",
                      }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700 }}>{label}</span>
                        <span style={{ display: "block", fontSize: 11, color: "var(--c-t4)" }}>{hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <Toggle checked={c.useStoryboard} onChange={(v) => set("useStoryboard", v)} label="用分镜节点承载每镜" hint="关闭则用提示词节点逐镜承载" />
              {(c.goal === "film" || c.goal === "video") && (
                <Toggle checked={c.imageFirst} onChange={(v) => set("imageFirst", v)} label="先生图再图生视频" hint="更可控的关键帧首帧；关闭则文生视频直出" />
              )}

              {/* #159 增强：云端来源选生图/生视频模型；自建来源选已保存的 ComfyUI 模版。 */}
              {c.source === "cloud" && (wantImageModel || wantVideoModel) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px dashed var(--c-bd1)", paddingTop: 10 }}>
                  {wantImageModel && (
                    <label>
                      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 5 }}>生图模型</span>
                      <select value={c.imageModel ?? ""} onChange={(e) => set("imageModel", e.target.value || undefined)} style={fieldStyle}>
                        <option value="">默认（节点内置）</option>
                        {IMAGE_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}{m.costNote ? ` · ${m.costNote}` : ""}</option>)}
                      </select>
                    </label>
                  )}
                  {wantVideoModel && (
                    <label>
                      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 5 }}>生视频模型</span>
                      <select value={c.videoProvider ?? ""} onChange={(e) => set("videoProvider", e.target.value || undefined)} style={fieldStyle}>
                        <option value="">默认（节点内置）</option>
                        {VIDEO_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}{m.costLabel ? ` · ${m.costLabel}` : ""}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {c.source === "comfy" && (wantImageModel || wantVideoModel) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px dashed var(--c-bd1)", paddingTop: 10 }}>
                  {templatesQuery.isLoading && <span style={{ fontSize: 11.5, color: "var(--c-t4)" }}>正在载入 ComfyUI 模版…</span>}
                  {!templatesQuery.isLoading && (templatesQuery.data?.length ?? 0) === 0 && (
                    <span style={{ fontSize: 11.5, color: "var(--c-t4)" }}>暂无已保存的 ComfyUI 模版（可先在工作流节点里「存为模板」）。将用空白 ComfyUI 节点，稍后手动导入工作流。</span>
                  )}
                  {wantImageModel && comfyImageTemplates.length > 0 && (
                    <label>
                      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 5 }}>生图 ComfyUI 模版</span>
                      <select
                        value={imgTplId}
                        onChange={(e) => {
                          setImgTplId(e.target.value);
                          const t = comfyImageTemplates.find((x) => String(x.id) === e.target.value);
                          set("comfyImagePayload", t ? (t.payload as Record<string, unknown>) : undefined);
                        }}
                        style={fieldStyle}
                      >
                        <option value="">不套用模版（空白节点）</option>
                        {comfyImageTemplates.map((t) => <option key={t.id} value={String(t.id)}>{t.label}</option>)}
                      </select>
                    </label>
                  )}
                  {wantVideoModel && comfyVideoTemplates.length > 0 && (
                    <label>
                      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 5 }}>生视频 ComfyUI 模版</span>
                      <select
                        value={vidTplId}
                        onChange={(e) => {
                          setVidTplId(e.target.value);
                          const t = comfyVideoTemplates.find((x) => String(x.id) === e.target.value);
                          set("comfyVideoPayload", t ? (t.payload as Record<string, unknown>) : undefined);
                        }}
                        style={fieldStyle}
                      >
                        <option value="">不套用模版（空白节点）</option>
                        {comfyVideoTemplates.map((t) => <option key={t.id} value={String(t.id)}>{t.label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {step === "extras" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {c.goal !== "images" && c.goal !== "audio" && <>
                <Toggle checked={c.addMusic} onChange={(v) => set("addMusic", v)} label="配乐" hint="背景音乐节点，接入合成" />
                <Toggle checked={c.addVoice} onChange={(v) => set("addVoice", v)} label="配音（旁白）" hint="TTS 旁白节点" />
                <Toggle checked={c.addSubtitle} onChange={(v) => set("addSubtitle", v)} label="字幕" hint="成片后追加字幕节点" />
                <Toggle checked={c.addMerge} onChange={(v) => set("addMerge", v)} label="合成成片" hint="把各镜末端 + 音频接入合成节点" />
              </>}
              {c.goal === "images" && <div style={{ fontSize: 12.5, color: "var(--c-t4)", padding: "8px 0" }}>「只出图」无需成片/音频增强，直接确认即可。</div>}
              {c.goal === "audio" && <>
                <Toggle checked={c.addVoice} onChange={(v) => set("addVoice", v)} label="旁白配音（TTS）" hint="关闭则生成配乐（音乐）节点" />
              </>}
            </div>
          )}

          {step === "confirm" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, color: "var(--c-t1)", fontWeight: 700 }}>将创建 {createCount} 个节点</div>
              <ul style={{ margin: 0, padding: "10px 14px", listStyle: "none", background: "var(--c-input)", borderRadius: 10, border: "1px solid var(--c-bd2)", fontSize: 12, color: "var(--c-t2)", lineHeight: 1.9 }}>
                <li>· 目标：{GOALS.find((g) => g.id === c.goal)?.label}</li>
                {c.goal !== "audio" && <li>· 比例 {c.aspect || "不指定"} · {c.goal === "images" ? `${c.shots} 张` : `${c.shots} 镜 × ${c.durationSec}s`}{c.style ? ` · 风格「${c.style}」` : ""}</li>}
                {c.goal !== "audio" && <li>· 来源：{c.source === "comfy" ? "自建 ComfyUI" : "云端模型"}{(c.goal === "film" || c.goal === "video") && c.imageFirst ? " · 先生图再图生视频" : ""}</li>}
                {c.goal !== "audio" && c.source === "cloud" && (c.imageModel || c.videoProvider) && (
                  <li>· 模型：{[c.imageModel && `图 ${IMAGE_MODELS.find((m) => m.value === c.imageModel)?.label ?? c.imageModel}`, c.videoProvider && `视频 ${VIDEO_MODELS.find((m) => m.value === c.videoProvider)?.label ?? c.videoProvider}`].filter(Boolean).join(" · ")}</li>
                )}
                {c.goal !== "audio" && c.source === "comfy" && (c.comfyImagePayload || c.comfyVideoPayload) && (
                  <li>· ComfyUI 模版：{[c.comfyImagePayload && "生图", c.comfyVideoPayload && "生视频"].filter(Boolean).join(" · ")}已套用</li>
                )}
                <li>· 增强：{[c.addMusic && "配乐", c.addVoice && "配音", c.addSubtitle && "字幕", c.addMerge && (c.goal !== "images" && c.goal !== "audio") && "合成"].filter(Boolean).join("、") || "无"}</li>
              </ul>
              <div style={{ fontSize: 11.5, color: "var(--c-t4)" }}>完成后将按功能（剧本/分镜/生图/生视频/音频/合成）自动分区群组，方便整体管理。</div>
            </div>
          )}
        </div>

        {/* 底部导航 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--c-bd1)" }}>
          <button onClick={idx === 0 ? onClose : goPrev} style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "8px 14px", fontSize: 12.5, borderRadius: 9,
            border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t2)", cursor: "pointer",
          }}>
            {idx === 0 ? "取消" : <><ChevronLeft size={15} /> 上一步</>}
          </button>
          <div style={{ flex: 1 }} />
          {!isLast ? (
            <button onClick={goNext} style={{
              display: "inline-flex", alignItems: "center", gap: 4, padding: "8px 18px", fontSize: 12.5, fontWeight: 700, borderRadius: 9,
              border: "none", background: ACCENT, color: "#fff", cursor: "pointer",
            }}>
              下一步 <ChevronRight size={15} />
            </button>
          ) : (
            <button onClick={finish} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 20px", fontSize: 12.5, fontWeight: 800, borderRadius: 9,
              border: "none", background: ACCENT, color: "#fff", cursor: "pointer",
            }}>
              <Wand2 size={15} /> 建立
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
