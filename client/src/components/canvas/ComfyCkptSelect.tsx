import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { loadComfyCkpt, saveComfyCkpt, loadComfyBase, saveComfyBase } from "../../lib/comfyLocalRoute";
import { useComfyServersStore } from "../../hooks/useComfyServersStore";
import { ComfyServerUrlField } from "./nodes/ComfyServerUrlField";

// #77 / 本地 ComfyUI（自建算力）配置：地址 + checkpoint（各自建入口共用：角色三视图 /
// 工具箱宫格·画面推演 / 打光·多角度编辑器）。
// 地址栏复用与专用 ComfyUI 节点同一个「全能」组件 ComfyServerUrlField——已保存服务器列表
// （全局注册表 useComfyServersStore，跨节点共享，你在 ComfyUI 节点里存过的地址这里也能选）、
// ＋保存 / 加载监视器全部地址 / 在线状态体检 / 清理失效 / 刷新模型列表，一应俱全。
// 地址与 checkpoint 均全局记忆（localStorage）；地址留空走服务端全局默认。
// 注意：处于 transform: scale 容器时原生 <select> 会点不准——本组件只用于未缩放容器。
export function ComfyCkptSelect({ enabled, width = 170 }: { enabled: boolean; width?: number }) {
  const [ckpt, setCkpt] = useState(loadComfyCkpt);
  const [base, setBase] = useState(loadComfyBase);
  const utils = trpc.useUtils();
  const servers = useComfyServersStore((s) => s.servers);
  const addServer = useComfyServersStore((s) => s.add);
  const removeServer = useComfyServersStore((s) => s.remove);
  const trimmed = base.trim() || undefined;
  // 查询键含地址：改地址 → 自动重取；enabled 时才发请求。
  const q = trpc.comfyui.fetchModels.useQuery({ customBaseUrl: trimmed }, { enabled, staleTime: 30_000, retry: false });
  const list = q.data?.ckpts ?? [];
  if (!enabled) return null;

  // ComfyServerUrlField 的 serverUrls 用全局注册表本身承载：加载监视器/清理失效等写回也落回注册表。
  const onChangeServerUrls = (next: string[]) => {
    const nextSet = new Set(next), curSet = new Set(servers);
    next.forEach((u) => { if (!curSet.has(u)) addServer(u); });
    servers.forEach((u) => { if (!nextSet.has(u)) removeServer(u); });
  };
  const fieldBase: React.CSSProperties = { flex: 1, minWidth: 0, padding: "5px 8px", fontSize: 11.5, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none" };

  return (
    <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", minWidth: 240 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", display: "flex", alignItems: "center", gap: 4 }}>
        ComfyUI 地址（留空用全局默认）
      </div>
      <ComfyServerUrlField
        id="comfy-local-selfhosted"
        value={base}
        onChange={(v) => { setBase(v); saveComfyBase(v); }}
        serverUrls={servers}
        onChangeServerUrls={onChangeServerUrls}
        isFetching={q.isFetching}
        onRefresh={() => utils.comfyui.fetchModels.invalidate()}
        accent="oklch(0.7 0.17 195)"
        borderAccent="oklch(0.7 0.17 195 / 0.6)"
        borderDefault="var(--c-bd2)"
        fieldBase={fieldBase}
      />
      <select
        className="nodrag"
        value={ckpt}
        onChange={(e) => { setCkpt(e.target.value); saveComfyCkpt(e.target.value); }}
        title="本地 ComfyUI checkpoint（全局记忆，各自建入口共用）"
        style={{ width, maxWidth: "100%", padding: "5px 8px", fontSize: 11.5, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none" }}
      >
        <option value="">{q.isFetching ? "加载模型列表…" : list.length === 0 ? "未获取到 checkpoint（检查 ComfyUI 地址/服务器）" : "选择 checkpoint…"}</option>
        {ckpt && !list.includes(ckpt) && <option value={ckpt}>{ckpt}（已保存）</option>}
        {list.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
}
