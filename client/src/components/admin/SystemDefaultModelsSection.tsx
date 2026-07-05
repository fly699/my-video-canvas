import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Boxes } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { LLM_MODELS, IMAGE_MODELS, VIDEO_MODELS, TRANSCRIBE_MODELS } from "@/lib/models";
import { useSelfHostedLlmModels } from "@/lib/useSelfHostedModels";
import { FACTORY_DEFAULT_MODELS, type ModelSlot } from "@shared/nodeDefaultModels";

type Opt = { value: string; label: string };

/** 管理后台「模型管理 › 系统默认模型」：管理员按槽位（对话/图像/视频/转录）指定系统默认模型。
 *  作用于所有项目——新建节点、聊天 AI 助手在用户未显式选择时使用；解析优先级排在项目级配置之下、
 *  出厂默认之上。留空 = 该槽位用出厂默认。 */
export function SystemDefaultModelsSection() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.getSystemDefaults.useQuery();
  const selfHosted = useSelfHostedLlmModels();

  const [sel, setSel] = useState<Record<ModelSlot, string>>({ llm: "", image: "", video: "", transcribe: "" });
  const serverKey = JSON.stringify(q.data ?? {});
  useEffect(() => {
    const d = (q.data ?? {}) as Partial<Record<ModelSlot, string>>;
    setSel({ llm: d.llm ?? "", image: d.image ?? "", video: d.video ?? "", transcribe: d.transcribe ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const setMut = trpc.admin.models.setSystemDefaults.useMutation({
    onSuccess: () => {
      void utils.admin.models.getSystemDefaults.invalidate();
      void utils.config.systemDefaultModels.invalidate();
      toast.success("已保存系统默认模型（约 30 秒内对所有用户生效）", { duration: 1600 });
    },
    onError: (e) => toast.error(`保存失败：${e.message}`),
  });

  const slots = useMemo(() => {
    const llmOpts: Opt[] = [
      ...selfHosted.map((s) => ({ value: s.id, label: s.label })),
      ...LLM_MODELS.filter((m) => !m.hidden).map((m) => ({ value: m.id, label: m.label })),
    ];
    return [
      { slot: "llm" as ModelSlot, label: "对话 / 推理 LLM", opts: llmOpts, hint: "AI 对话节点、脚本/规划、聊天 AI 助手" },
      { slot: "image" as ModelSlot, label: "图像生成", opts: IMAGE_MODELS.map((m) => ({ value: m.value, label: m.label })), hint: "图像生成节点" },
      { slot: "video" as ModelSlot, label: "视频生成", opts: VIDEO_MODELS.map((m) => ({ value: m.value, label: m.label })), hint: "视频生成节点" },
      { slot: "transcribe" as ModelSlot, label: "语音转录", opts: TRANSCRIBE_MODELS.map((m) => ({ value: m.value, label: m.label })), hint: "字幕节点转录" },
    ];
  }, [selfHosted]);

  // 出厂默认的展示标签（下拉里「跟随出厂默认」一项标注具体是哪个模型）。
  const labelOf = (slot: ModelSlot, value: string): string => {
    const s = slots.find((x) => x.slot === slot);
    return s?.opts.find((o) => o.value === value)?.label ?? value;
  };

  const onPick = (slot: ModelSlot, value: string) => {
    const next = { ...sel, [slot]: value };
    setSel(next);
    // 只提交非空项（空 = 该槽位跟随出厂默认）。
    const payload: Record<string, string> = {};
    for (const k of ["llm", "image", "video", "transcribe"] as ModelSlot[]) if (next[k]) payload[k] = next[k];
    setMut.mutate(payload);
  };

  const box: React.CSSProperties = {
    fontSize: 12, padding: "7px 9px", borderRadius: 8, background: "var(--c-input, var(--c-elevated))",
    border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", width: "100%", cursor: "pointer",
  };

  return (
    <div style={{ border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        <Boxes className="w-4 h-4" style={{ color: "oklch(0.72 0.18 285)" }} /> 系统默认模型
      </div>
      <p style={{ fontSize: 11.5, color: "var(--c-t3)", lineHeight: 1.7, margin: 0 }}>
        按类别指定<strong>全站默认模型</strong>：用户新建节点、或聊天 AI 助手未手动选模型时默认用它。
        优先级 <strong>项目级配置 &gt; 系统默认（此处）&gt; 出厂默认</strong>——留「跟随出厂默认」即不覆盖。
        已选用其它模型的旧节点不受影响。修改即时保存、约 30 秒内对所有用户生效。
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {slots.map(({ slot, label, opts, hint }) => (
          <label key={slot} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t2)" }}>{label}</span>
            <select className="nodrag" value={sel[slot]} onChange={(e) => onPick(slot, e.target.value)} style={box}>
              <option value="">跟随出厂默认（{labelOf(slot, FACTORY_DEFAULT_MODELS[slot])}）</option>
              {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>{hint}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
