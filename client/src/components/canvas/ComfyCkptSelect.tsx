import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { loadComfyCkpt, saveComfyCkpt, loadComfyBase, saveComfyBase } from "../../lib/comfyLocalRoute";

// #77 / 本地 ComfyUI checkpoint 迷你选择器（选了「本地 ComfyUI（自建算力）」模型的各入口共用：
// 工具箱宫格、角色三视图、打光/多角度编辑器等）。
// 现在自带「ComfyUI 地址」输入：填了就按该地址拉模型列表并用于生成（comfyui.generateImage
// 的 customBaseUrl），留空则用服务端全局默认——无需先在管理后台配全局服务器也能用自己的 ComfyUI。
// 地址与 checkpoint 均为全局记忆（localStorage），各自建入口共享；改地址即自动刷新列表，
// 「刷新」按钮强制重取（checkpoint / LoRA / 采样器 / 节点等整份 fetchModels 结果）。
// 注意：处于 transform: scale 容器时原生 <select> 会点不准（Chromium 已知坑）——
// 本组件只用于 NodeToolbar/固定浮层等**未缩放**容器。
export function ComfyCkptSelect({ enabled, width = 170 }: { enabled: boolean; width?: number }) {
  const [ckpt, setCkpt] = useState(loadComfyCkpt);
  const [base, setBase] = useState(loadComfyBase);
  const utils = trpc.useUtils();
  const trimmed = base.trim() || undefined;
  // 查询键含 customBaseUrl：改地址 → 键变 → 自动重取；enabled 时才发请求。
  const q = trpc.comfyui.fetchModels.useQuery({ customBaseUrl: trimmed }, { enabled, staleTime: 30_000, retry: false });
  const list = q.data?.ckpts ?? [];
  if (!enabled) return null;
  const cellStyle = { padding: "4px 6px", fontSize: 11, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 7, outline: "none" } as const;
  return (
    <span className="nodrag" style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
      <input
        className="nodrag"
        value={base}
        onChange={(e) => { setBase(e.target.value); saveComfyBase(e.target.value); }}
        placeholder="ComfyUI 地址（留空=全局）"
        title="本地 ComfyUI 地址（自建算力各入口共享）。填了就按此地址取模型列表并用于生成；留空则用管理后台/环境变量的全局默认。默认端口 8188。"
        style={{ ...cellStyle, width: 150 }}
      />
      <select
        className="nodrag"
        value={ckpt}
        onChange={(e) => { setCkpt(e.target.value); saveComfyCkpt(e.target.value); }}
        title="本地 ComfyUI checkpoint（全局记忆，各自建入口共用）"
        style={{ ...cellStyle, width }}
      >
        <option value="">{q.isFetching ? "加载模型列表…" : list.length === 0 ? "未获取到 checkpoint（检查 ComfyUI 地址/服务器）" : "选择 checkpoint…"}</option>
        {/* 当前已选值不在列表时也保留可见，避免服务器暂不可达时选择被吞 */}
        {ckpt && !list.includes(ckpt) && <option value={ckpt}>{ckpt}（已保存）</option>}
        {list.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <button
        className="nodrag"
        onClick={() => utils.comfyui.fetchModels.invalidate()}
        disabled={q.isFetching}
        title="刷新模型列表（checkpoint / LoRA / 采样器 / 节点等，全部自建入口一起刷新）"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 7, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: q.isFetching ? "wait" : "pointer", padding: 0 }}
      >
        <RefreshCw size={11} className={q.isFetching ? "animate-spin" : undefined} />
      </button>
    </span>
  );
}
