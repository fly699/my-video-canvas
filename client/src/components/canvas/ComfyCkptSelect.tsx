import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { loadComfyCkpt, saveComfyCkpt } from "../../lib/comfyLocalRoute";

// #77：本地 ComfyUI checkpoint 迷你选择器（选了「本地 ComfyUI」模型的入口共用）。
// 列表来自默认服务器的 fetchModels；选择记忆到全局 localStorage。
// 注意：处于 transform: scale 容器时原生 <select> 会点不准（Chromium 已知坑）——
// 本组件只用于 NodeToolbar/固定浮层等**未缩放**容器。
export function ComfyCkptSelect({ enabled, width = 170 }: { enabled: boolean; width?: number }) {
  const [ckpt, setCkpt] = useState(loadComfyCkpt);
  const q = trpc.comfyui.fetchModels.useQuery({}, { enabled, staleTime: 60_000, retry: false });
  const list = q.data?.ckpts ?? [];
  if (!enabled) return null;
  return (
    <select
      className="nodrag"
      value={ckpt}
      onChange={(e) => { setCkpt(e.target.value); saveComfyCkpt(e.target.value); }}
      title="本地 ComfyUI checkpoint（全局记忆，各自建入口共用）"
      style={{ width, padding: "4px 6px", fontSize: 11, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 7, outline: "none" }}
    >
      <option value="">{q.isLoading ? "加载模型列表…" : list.length === 0 ? "未获取到 checkpoint（检查 ComfyUI 服务器）" : "选择 checkpoint…"}</option>
      {/* 当前已选值不在列表时也保留可见，避免服务器暂不可达时选择被吞 */}
      {ckpt && !list.includes(ckpt) && <option value={ckpt}>{ckpt}（已保存）</option>}
      {list.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}
