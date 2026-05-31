// ComfyUI 压力测试面板（管理后台）。
//
// 通过 trpc.comfyStress.* 驱动后端的后台压测任务：start 立即返回 jobId，
// 这里用 list 查询 + refetchInterval 轮询实时进度（后端也会经 Socket.IO 推送，
// 轮询作为可靠兜底）。

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const C = {
  card: "#1e293b",
  border: "#334155",
  text: "#e2e8f0",
  sub: "#94a3b8",
  blue: "#2563eb",
  red: "#dc2626",
  green: "#16a34a",
  inputBg: "#0f172a",
};

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const PLACEHOLDER_HINT = `粘贴 ComfyUI 导出的「API 格式」工作流 JSON。
（ComfyUI 设置开启 Dev mode → 菜单 Save (API Format)）
压测会自动随机化每次的 seed/noise_seed 以绕过结果缓存。`;

export function ComfyStressPanel() {
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [workflowJson, setWorkflowJson] = useState("");
  const [mode, setMode] = useState<"lean" | "full">("lean");
  const [concurrency, setConcurrency] = useState(1);
  const [total, setTotal] = useState(10);
  const [randomizeSeed, setRandomizeSeed] = useState(true);

  const listQuery = trpc.comfyStress.list.useQuery(undefined, {
    refetchInterval: 1500,
    refetchOnWindowFocus: false,
  });
  const startMut = trpc.comfyStress.start.useMutation();
  const cancelMut = trpc.comfyStress.cancel.useMutation();

  const jobs = listQuery.data ?? [];
  const hasRunning = jobs.some((j) => j.status === "running");

  async function onStart() {
    if (workflowJson.trim().length < 2) {
      toast.error("请先粘贴工作流 JSON");
      return;
    }
    try {
      JSON.parse(workflowJson);
    } catch {
      toast.error("工作流 JSON 格式错误，无法解析");
      return;
    }
    try {
      await startMut.mutateAsync({
        customBaseUrl: customBaseUrl.trim() || undefined,
        workflowJson,
        mode,
        concurrency,
        total,
        randomizeSeed,
      });
      toast.success("压测任务已启动");
      void listQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "启动失败");
    }
  }

  async function onCancel(id: string) {
    try {
      await cancelMut.mutateAsync({ id });
      toast.success("已请求取消（在途请求会先跑完）");
      void listQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取消失败");
    }
  }

  const labelStyle = { display: "block", fontSize: 13, color: C.sub, marginBottom: 6 } as const;
  const inputStyle = {
    width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.inputBg, color: C.text, fontSize: 14, boxSizing: "border-box" as const,
  };

  return (
    <div style={{ color: C.text }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>ComfyUI 压力测试</h2>
      <p style={{ fontSize: 13, color: C.sub, margin: "0 0 20px" }}>
        重复并发执行同一个工作流，测量 ComfyUI 服务器的吞吐与延迟。⚠️ 压测会真实消耗目标 GPU 资源，请勿对生产服务器高并发压测。
      </p>

      {/* 配置表单 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>ComfyUI 地址（留空使用服务器配置的 COMFYUI_BASE_URL）</label>
          <input
            style={inputStyle}
            placeholder="http://127.0.0.1:8188"
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>工作流 JSON（API 格式）</label>
          <textarea
            style={{ ...inputStyle, minHeight: 140, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
            placeholder={PLACEHOLDER_HINT}
            value={workflowJson}
            onChange={(e) => setWorkflowJson(e.target.value)}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>测试模式</label>
            <select style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value as "lean" | "full")}>
              <option value="lean">精简（只测 ComfyUI：提交+等待完成）</option>
              <option value="full">完整（含 /view 下载 + 回传存储）</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>并发数（1–32）</label>
            <input
              type="number" min={1} max={32} style={inputStyle}
              value={concurrency}
              onChange={(e) => setConcurrency(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <label style={labelStyle}>总执行次数（1–1000）</label>
            <input
              type="number" min={1} max={1000} style={inputStyle}
              value={total}
              onChange={(e) => setTotal(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.sub, marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={randomizeSeed} onChange={(e) => setRandomizeSeed(e.target.checked)} />
          随机化 seed（强烈建议开启——否则 ComfyUI 命中缓存会使结果失真）
        </label>

        <button
          onClick={onStart}
          disabled={startMut.isPending}
          style={{
            padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
            background: C.blue, color: "#fff", fontSize: 14, fontWeight: 600,
            opacity: startMut.isPending ? 0.6 : 1,
          }}
        >
          {startMut.isPending ? "启动中…" : "开始压测"}
        </button>
        {hasRunning && (
          <span style={{ marginLeft: 12, fontSize: 13, color: C.sub }}>已有任务在运行——可同时启动多个</span>
        )}
      </div>

      {/* 任务列表 */}
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px" }}>任务（近 30 分钟）</h3>
      {jobs.length === 0 && <p style={{ fontSize: 13, color: C.sub }}>暂无任务。</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {jobs.map((j) => {
          const pct = j.total > 0 ? Math.round((j.completed / j.total) * 100) : 0;
          const statusColor = j.status === "running" ? C.blue
            : j.status === "completed" ? C.green
            : j.status === "cancelled" ? C.sub : C.red;
          const statusLabel = j.status === "running" ? "运行中"
            : j.status === "completed" ? "已完成"
            : j.status === "cancelled" ? "已取消" : "失败";
          return (
            <div key={j.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: statusColor, padding: "2px 8px", borderRadius: 6 }}>
                    {statusLabel}
                  </span>
                  <span style={{ fontSize: 13, color: C.sub }}>
                    {j.mode === "lean" ? "精简" : "完整"} · 并发 {j.concurrency} · 共 {j.total}
                  </span>
                </div>
                {j.status === "running" && (
                  <button
                    onClick={() => onCancel(j.id)}
                    style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.red}`, background: "transparent", color: C.red, cursor: "pointer", fontSize: 13 }}
                  >
                    取消
                  </button>
                )}
              </div>

              {/* 进度条 */}
              <div style={{ height: 6, background: C.inputBg, borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: statusColor, transition: "width 0.3s" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12, fontSize: 13 }}>
                <Stat label="完成 / 总数" value={`${j.completed} / ${j.total}`} />
                <Stat label="成功 / 失败" value={`${j.succeeded} / ${j.failed}`} valueColor={j.failed > 0 ? C.red : undefined} />
                <Stat label="在途" value={String(j.inFlight)} />
                <Stat label="吞吐" value={`${j.throughputPerSec}/s`} />
                <Stat label="avg" value={fmtMs(j.avgMs)} />
                <Stat label="p50" value={fmtMs(j.p50Ms)} />
                <Stat label="p95" value={fmtMs(j.p95Ms)} />
                <Stat label="max" value={fmtMs(j.maxMs)} />
                <Stat label="提交延迟" value={fmtMs(j.avgSubmitMs)} />
                <Stat label="执行+排队" value={fmtMs(j.avgWaitMs)} />
                {j.mode === "full" && <Stat label="下载/回传" value={fmtMs(j.avgDownloadMs)} />}
              </div>

              {j.errorSamples.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: 13, color: C.red, cursor: "pointer" }}>错误样本（{j.errorSamples.length}）</summary>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: C.sub }}>
                    {j.errorSamples.map((e, i) => <li key={i} style={{ marginBottom: 4 }}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.sub, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: valueColor ?? C.text }}>{value}</div>
    </div>
  );
}
