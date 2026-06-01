// ComfyUI 压力测试面板（管理后台）。
//
// 通过 trpc.comfyStress.* 驱动后端的后台压测任务：start 立即返回 jobId，
// 这里用 list 查询 + refetchInterval 轮询实时进度（后端也会经 Socket.IO 推送，
// 轮询作为可靠兜底）。
//
// 支持多地址：可同时压测多台 ComfyUI 服务器，请求按轮询打散到各机器；
// 结果按服务器分桶展示，并用 recharts 画出吞吐/延迟的实时曲线。

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../../server/routers";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

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

// 每服务器曲线/卡片配色。
const SERVER_COLORS = ["#38bdf8", "#a78bfa", "#f472b6", "#fbbf24", "#34d399", "#fb7185", "#60a5fa", "#c084fc"];
const OVERALL_COLOR = "#e2e8f0";

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function shortUrl(u: string): string {
  try { return new URL(u).host; } catch { return u.replace(/^https?:\/\//, "").slice(0, 30); }
}

const PLACEHOLDER_HINT = `粘贴 ComfyUI 导出的「API 格式」工作流 JSON。
（ComfyUI 设置开启 Dev mode → 菜单 Save (API Format)）
压测会自动随机化每次的 seed/noise_seed 以绕过结果缓存。`;

export function ComfyStressPanel() {
  // 多地址：以列表维护，至少保留一行（空行表示回退到 COMFYUI_BASE_URL）。
  const [baseUrls, setBaseUrls] = useState<string[]>([""]);
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
  const stopMut = trpc.comfyStress.stop.useMutation();

  const jobs = listQuery.data ?? [];
  const hasRunning = jobs.some((j) => j.status === "running");

  function setUrlAt(i: number, v: string) {
    setBaseUrls((arr) => arr.map((u, idx) => (idx === i ? v : u)));
  }
  function addUrl() {
    setBaseUrls((arr) => (arr.length >= 16 ? arr : [...arr, ""]));
  }
  function removeUrl(i: number) {
    setBaseUrls((arr) => (arr.length <= 1 ? arr : arr.filter((_, idx) => idx !== i)));
  }

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
    const urls = baseUrls.map((u) => u.trim()).filter((u) => u.length > 0);
    try {
      await startMut.mutateAsync({
        customBaseUrls: urls.length > 0 ? urls : undefined,
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

  async function onStop(id: string) {
    try {
      await stopMut.mutateAsync({ id });
      toast.success("已立即停止（在途请求已中断）");
      void listQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "停止失败");
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
        重复并发执行同一个工作流，测量 ComfyUI 服务器的吞吐与延迟。支持多地址（请求按轮询打散到各机器，结果按服务器分别统计）。⚠️ 压测会真实消耗目标 GPU 资源，请勿对生产服务器高并发压测。
      </p>

      {/* 配置表单 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>ComfyUI 地址（可添加多个；全部留空则使用服务器配置的 COMFYUI_BASE_URL）</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {baseUrls.map((u, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: C.sub, width: 18, textAlign: "right" }}>{i + 1}</span>
                <input
                  style={inputStyle}
                  placeholder="http://127.0.0.1:8188"
                  value={u}
                  onChange={(e) => setUrlAt(i, e.target.value)}
                />
                <button
                  onClick={() => removeUrl(i)}
                  disabled={baseUrls.length <= 1}
                  title="移除此地址"
                  style={{
                    flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`,
                    background: "transparent", color: C.sub, cursor: baseUrls.length <= 1 ? "not-allowed" : "pointer",
                    opacity: baseUrls.length <= 1 ? 0.4 : 1, fontSize: 16, lineHeight: 1,
                  }}
                >
                  −
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addUrl}
            disabled={baseUrls.length >= 16}
            style={{
              marginTop: 8, padding: "6px 12px", borderRadius: 8, border: `1px dashed ${C.border}`,
              background: "transparent", color: C.blue, cursor: baseUrls.length >= 16 ? "not-allowed" : "pointer",
              fontSize: 13, opacity: baseUrls.length >= 16 ? 0.5 : 1,
            }}
          >
            + 添加地址
          </button>
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
          const multi = (j.baseUrls?.length ?? 0) > 1;
          return (
            <div key={j.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: statusColor, padding: "2px 8px", borderRadius: 6 }}>
                    {statusLabel}
                  </span>
                  <span style={{ fontSize: 13, color: C.sub }}>
                    {j.mode === "lean" ? "精简" : "完整"} · 并发 {j.concurrency} · 共 {j.total} · {j.baseUrls?.length ?? 1} 台
                  </span>
                </div>
                {j.status === "running" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => onCancel(j.id)}
                      title="不再派发新请求，已在途的请求会先跑完"
                      style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.sub, cursor: "pointer", fontSize: 13 }}
                    >
                      取消
                    </button>
                    <button
                      onClick={() => onStop(j.id)}
                      title="立即中断所有在途的 ComfyUI 请求，不等其完成"
                      style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: C.red, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                    >
                      立即停止
                    </button>
                  </div>
                )}
              </div>

              {/* 进度条 */}
              <div style={{ height: 6, background: C.inputBg, borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: statusColor, transition: "width 0.3s" }} />
              </div>

              {/* 整体指标 */}
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

              {/* 实时曲线 */}
              <StressCharts job={j} multi={multi} />

              {/* 每服务器状态 */}
              {(j.servers?.length ?? 0) > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, color: C.sub, marginBottom: 8 }}>各服务器状态</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                    {j.servers.map((s, i) => (
                      <div key={s.baseUrl} style={{ background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: SERVER_COLORS[i % SERVER_COLORS.length], flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.baseUrl}>
                            {shortUrl(s.baseUrl)}
                          </span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, fontSize: 12 }}>
                          <Stat label="成功 / 失败" value={`${s.succeeded} / ${s.failed}`} valueColor={s.failed > 0 ? C.red : undefined} small />
                          <Stat label="在途" value={String(s.inFlight)} small />
                          <Stat label="吞吐" value={`${s.throughputPerSec}/s`} small />
                          <Stat label="avg" value={fmtMs(s.avgMs)} small />
                          <Stat label="p95" value={fmtMs(s.p95Ms)} small />
                          <Stat label="max" value={fmtMs(s.maxMs)} small />
                        </div>
                        {s.lastError && (
                          <div style={{ marginTop: 8, fontSize: 11, color: C.red, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.lastError}>
                            最近错误：{s.lastError}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

type JobView = inferRouterOutputs<AppRouter>["comfyStress"]["list"][number];

// 吞吐 + 延迟随时间变化的实时曲线。整体一条线，多地址时每服务器各一条。
function StressCharts({ job, multi }: { job: JobView; multi: boolean }) {
  const ts = job.timeSeries ?? [];
  if (ts.length < 2) {
    return (
      <div style={{ marginTop: 14, fontSize: 12, color: C.sub }}>
        曲线将在采样到至少 2 个数据点后显示…
      </div>
    );
  }

  const tput = ts.map((s) => {
    const o: Record<string, number> = { t: Math.round(s.t / 1000), 总体: s.throughputPerSec };
    s.perServer.forEach((ps) => { o[ps.baseUrl] = ps.throughputPerSec; });
    return o;
  });
  const lat = ts.map((s) => {
    const o: Record<string, number | null> = { t: Math.round(s.t / 1000), 总体: s.avgMs };
    s.perServer.forEach((ps) => { o[ps.baseUrl] = ps.avgMs; });
    return o;
  });

  const serverSeries = multi
    ? job.baseUrls.map((url, i) => ({ key: url, name: shortUrl(url), color: SERVER_COLORS[i % SERVER_COLORS.length] }))
    : [];

  return (
    <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
      <ChartBox title="吞吐（次/秒）" data={tput} series={serverSeries} yUnit="/s" />
      <ChartBox title="平均延迟（ms）" data={lat} series={serverSeries} yUnit="ms" />
    </div>
  );
}

function ChartBox({
  title, data, series, yUnit,
}: {
  title: string;
  data: Record<string, number | null>[];
  series: { key: string; name: string; color: string }[];
  yUnit: string;
}) {
  return (
    <div style={{ background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 12px 4px" }}>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 8 }}>{title}</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="t" tick={{ fontSize: 10, fill: C.sub }} stroke={C.border} unit="s" />
          <YAxis tick={{ fontSize: 10, fill: C.sub }} stroke={C.border} width={44} unit={yUnit} />
          <Tooltip
            contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: C.sub }}
            labelFormatter={(v) => `${v}s`}
          />
          {(series.length > 0) && <Legend wrapperStyle={{ fontSize: 11 }} />}
          <Line type="monotone" dataKey="总体" stroke={OVERALL_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, valueColor, small }: { label: string; value: string; valueColor?: string; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.sub, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: small ? 13 : 15, fontWeight: 600, color: valueColor ?? C.text }}>{value}</div>
    </div>
  );
}
