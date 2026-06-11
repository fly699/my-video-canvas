// ComfyUI 压力测试面板（管理后台）。
//
// 通过 trpc.comfyStress.* 驱动后端的后台压测任务：start 立即返回 jobId，
// 这里用 list 查询 + refetchInterval 轮询实时进度（后端也会经 Socket.IO 推送，
// 轮询作为可靠兜底）。
//
// 支持多地址：可同时压测多台 ComfyUI 服务器，请求按轮询打散到各机器；
// 结果按服务器分桶展示，并用 recharts 画出吞吐/延迟的实时曲线。

import { useRef, useState } from "react";
import { usePersistentState } from "@/hooks/usePersistentState";
import { useComfyServersStore } from "@/hooks/useComfyServersStore";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../../server/routers";
import { toast } from "sonner";
import { downloadTextFile } from "@/lib/download";
import { ComfyServerStatusIndicator } from "@/components/canvas/ComfyServerStatusIndicator";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// 主题化配色：跟随全局主题变量（深浅主题均协调），语义色保留品牌 oklch。
const C = {
  card: "var(--c-surface)",
  border: "var(--c-bd2)",
  text: "var(--c-t1)",
  sub: "var(--c-t3)",
  blue: "oklch(0.62 0.18 255)",
  red: "oklch(0.63 0.21 25)",
  green: "oklch(0.65 0.18 150)",
  amber: "oklch(0.74 0.15 80)",
  violet: "oklch(0.68 0.20 285)",
  inputBg: "var(--c-input)",
};

// 每服务器曲线/卡片配色。SVG stroke 属性不解析 CSS 变量，图表内部用具体色值
//（中性灰对深浅主题均可读；整体线用品牌紫）。
const SERVER_COLORS = ["#38bdf8", "#a78bfa", "#f472b6", "#fbbf24", "#34d399", "#fb7185", "#60a5fa", "#c084fc"];
const OVERALL_COLOR = "#8b5cf6";
const CHART_GRID = "#94a3b8";

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTime(t: number | string | Date | null): string {
  if (t == null) return "—";
  const d = new Date(t);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(startMs: number, endMs: number | null): string {
  if (!endMs) return "—";
  const s = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function shortUrl(u: string): string {
  try { return new URL(u).host; } catch { return u.replace(/^https?:\/\//, "").slice(0, 30); }
}

// ── 导出 ──────────────────────────────────────────────────────────────────────
function exportJobJson(j: JobView, jobLabel: string) {
  downloadTextFile(`comfy-stress-${jobLabel}.json`, JSON.stringify(j, null, 2), "application/json");
}

function exportJobCsv(j: JobView, jobLabel: string) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push("范围,服务器,完成,成功,失败,吞吐/s,avg_ms,p50_ms,p95_ms,max_ms,提交_ms,执行排队_ms,下载_ms,最近错误");
  const row = (scope: string, url: string, s: { completed: number; succeeded: number; failed: number; throughputPerSec: number; avgMs: number | null; p50Ms: number | null; p95Ms: number | null; maxMs: number | null; avgSubmitMs: number | null; avgWaitMs: number | null; avgDownloadMs: number | null }, lastError?: string | null) =>
    [scope, url, s.completed, s.succeeded, s.failed, s.throughputPerSec, s.avgMs ?? "", s.p50Ms ?? "", s.p95Ms ?? "", s.maxMs ?? "", s.avgSubmitMs ?? "", s.avgWaitMs ?? "", s.avgDownloadMs ?? "", lastError ?? ""].map(esc).join(",");
  lines.push(row("总体", j.baseUrls.join(" | "), j));
  for (const s of j.servers ?? []) lines.push(row("服务器", s.baseUrl, s, s.lastError));
  if ((j.timeSeries?.length ?? 0) > 0) {
    lines.push("");
    lines.push("时间序列_t_s,完成,成功,失败,在途,吞吐/s,avg_ms");
    for (const p of j.timeSeries) lines.push([Math.round(p.t / 1000), p.completed, p.succeeded, p.failed, p.inFlight, p.throughputPerSec, p.avgMs ?? ""].map(esc).join(","));
  }
  if ((j.errorSamples?.length ?? 0) > 0) {
    lines.push("");
    lines.push("错误样本");
    for (const e of j.errorSamples) lines.push(esc(e));
  }
  downloadTextFile(`comfy-stress-${jobLabel}.csv`, "﻿" + lines.join("\n"), "text/csv");
}

// 模板内容 = 整套压测表单。
interface StressTemplateConfig {
  baseUrls: string[];
  source: "json" | "model";
  workflowJson: string;
  model: Record<string, unknown>;
  mode: "lean" | "full";
  concurrency: number;
  total: number;
  randomizeSeed: boolean;
}

const PLACEHOLDER_HINT = `粘贴 ComfyUI 导出的「API 格式」工作流 JSON。
（ComfyUI 设置开启 Dev mode → 菜单 Save (API Format)）
压测会自动随机化每次的 seed/noise_seed 以绕过结果缓存。`;

export function ComfyStressPanel() {
  // 多地址：以列表维护，至少保留一行（空行表示回退到 COMFYUI_BASE_URL）。
  // 配置表单整体持久化到 localStorage，刷新/重启后自动回填（不含拉取到的模型列表）。
  const [baseUrls, setBaseUrls] = usePersistentState<string[]>("comfyStress:baseUrls:v1", [""],
    { validate: (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null) });
  // 压测来源：粘贴工作流 JSON，或选服务器上的一个模型自动构造 txt2img。
  const [source, setSource] = usePersistentState<"json" | "model">("comfyStress:source:v1", "json",
    { validate: (v) => (v === "json" || v === "model" ? v : null) });
  const [workflowJson, setWorkflowJson] = usePersistentState<string>("comfyStress:workflowJson:v1", "",
    { validate: (v) => (typeof v === "string" ? v : null) });
  // 「服务器模型」模式参数。
  const [model, setModel] = usePersistentState<{
    ckpt: string; prompt: string; negPrompt: string;
    steps: number; cfg: number; sampler: string; scheduler: string;
    width: number; height: number; batchSize: number;
    denoise: number; vae?: string; upscaleModel?: string;
    clip?: { clipType: string; name1: string; name2?: string; name3?: string };
    arch?: "sd" | "flux" | "sd3" | "qwen";
    modelSource?: "checkpoint" | "unet";
    unetWeightDtype?: string;
    guidance?: number;
    shift?: number;
  }>("comfyStress:model:v1", {
    ckpt: "", prompt: "", negPrompt: "",
    steps: 20, cfg: 7, sampler: "euler", scheduler: "normal",
    width: 512, height: 512, batchSize: 1, denoise: 1,
  }, { validate: (v) => (v && typeof v === "object" && typeof (v as { ckpt?: unknown }).ckpt === "string" ? v as never : null) });
  const [models, setModels] = useState<{ ckpts: string[]; samplers: string[]; schedulers: string[]; clips: string[]; unets: string[]; vaes: string[]; upscaleModels: string[] } | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [mode, setMode] = usePersistentState<"lean" | "full">("comfyStress:mode:v1", "lean",
    { validate: (v) => (v === "lean" || v === "full" ? v : null) });
  const [concurrency, setConcurrency] = usePersistentState<number>("comfyStress:concurrency:v1", 1,
    { validate: (v) => (typeof v === "number" && v > 0 ? v : null) });
  const [total, setTotal] = usePersistentState<number>("comfyStress:total:v1", 10,
    { validate: (v) => (typeof v === "number" && v > 0 ? v : null) });
  const [randomizeSeed, setRandomizeSeed] = usePersistentState<boolean>("comfyStress:randomizeSeed:v1", true,
    { validate: (v) => (typeof v === "boolean" ? v : null) });

  const utils = trpc.useUtils();
  const listQuery = trpc.comfyStress.list.useQuery(undefined, {
    refetchInterval: 1500,
    refetchOnWindowFocus: false,
  });
  const startMut = trpc.comfyStress.start.useMutation();
  const cancelMut = trpc.comfyStress.cancel.useMutation();
  const stopMut = trpc.comfyStress.stop.useMutation();

  // ── 参数模板（DB 持久化，管理员共享）────────────────────────────────────────
  const templatesQuery = trpc.comfyStress.templates.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveTemplateMut = trpc.comfyStress.templates.save.useMutation({
    onSuccess: () => { utils.comfyStress.templates.list.invalidate(); toast.success("模板已保存"); },
    onError: (e) => toast.error(`保存模板失败：${e.message}`),
  });
  const deleteTemplateMut = trpc.comfyStress.templates.remove.useMutation({
    onSuccess: () => { utils.comfyStress.templates.list.invalidate(); toast.success("模板已删除"); },
    onError: (e) => toast.error(`删除失败：${e.message}`),
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | "">("");
  // 导入专用 mutation：不挂 onSuccess toast，避免批量导入时每条弹一次提示。
  const importTemplateMut = trpc.comfyStress.templates.save.useMutation();
  const importInputRef = useRef<HTMLInputElement>(null);

  // 导出：选中了模板则导出该模板，否则导出全部。文件为带元信息的 JSON，可直接再导入。
  function exportTemplates() {
    const all = templatesQuery.data ?? [];
    if (all.length === 0) { toast.error("还没有模板可导出"); return; }
    const sel = all.find((x) => x.id === selectedTemplateId);
    const items = sel ? [sel] : all;
    const payload = {
      kind: "comfy-stress-templates",
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: items.map((t) => ({ name: t.name, config: t.config })),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`comfy-stress-templates-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json");
    toast.success(sel ? `已导出模板「${sel.name}」` : `已导出全部 ${items.length} 个模板`);
  }

  // 导入：兼容三种形态——本功能的导出文件 / 模板数组 / 单个 {name, config}。
  async function importTemplates(file: File) {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const p = parsed as { templates?: unknown; name?: unknown; config?: unknown } | unknown[];
      const arr: unknown[] | null = Array.isArray(p) ? p
        : Array.isArray((p as { templates?: unknown }).templates) ? (p as { templates: unknown[] }).templates
        : (p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string" && (p as { config?: unknown }).config) ? [p]
        : null;
      if (!arr || arr.length === 0) { toast.error("无法识别的文件格式（应为模板导出 JSON）"); return; }
      let ok = 0, skip = 0;
      for (const raw of arr) {
        const it = raw as { name?: unknown; config?: unknown };
        const name = typeof it.name === "string" ? it.name.trim() : "";
        if (!name || !it.config || typeof it.config !== "object") { skip++; continue; }
        await importTemplateMut.mutateAsync({ name: name.slice(0, 128), config: it.config });
        ok++;
      }
      utils.comfyStress.templates.list.invalidate();
      if (ok > 0) toast.success(`已导入 ${ok} 个模板${skip > 0 ? `，跳过 ${skip} 个无效项` : ""}`);
      else toast.error("文件中没有有效模板");
    } catch (e) {
      toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function currentConfig(): StressTemplateConfig {
    return { baseUrls, source, workflowJson, model: model as unknown as Record<string, unknown>, mode, concurrency, total, randomizeSeed };
  }
  function saveAsTemplate() {
    const name = window.prompt("模板名称：", source === "model" ? (model.ckpt || "压测模板") : "压测模板");
    if (!name?.trim()) return;
    saveTemplateMut.mutate({ name: name.trim(), config: currentConfig() });
  }
  function applyTemplate(cfg: unknown) {
    const c = cfg as Partial<StressTemplateConfig> | null;
    if (!c || typeof c !== "object") { toast.error("模板内容无效"); return; }
    if (Array.isArray(c.baseUrls) && c.baseUrls.every((x) => typeof x === "string")) setBaseUrls(c.baseUrls.length > 0 ? c.baseUrls : [""]);
    if (c.source === "json" || c.source === "model") setSource(c.source);
    if (typeof c.workflowJson === "string") setWorkflowJson(c.workflowJson);
    if (c.model && typeof c.model === "object") setModel((m) => ({ ...m, ...(c.model as Partial<typeof model>) }));
    if (c.mode === "lean" || c.mode === "full") setMode(c.mode);
    if (typeof c.concurrency === "number") setConcurrency(c.concurrency);
    if (typeof c.total === "number") setTotal(c.total);
    if (typeof c.randomizeSeed === "boolean") setRandomizeSeed(c.randomizeSeed);
    toast.success("模板已应用到表单");
  }

  // ── 历史记录（任务结束自动落库）────────────────────────────────────────────
  const historyQuery = trpc.comfyStress.history.list.useQuery({ limit: 50 }, { refetchOnWindowFocus: false, refetchInterval: 15_000 });
  const deleteHistoryMut = trpc.comfyStress.history.remove.useMutation({
    onSuccess: () => utils.comfyStress.history.list.invalidate(),
    onError: (e) => toast.error(`删除失败：${e.message}`),
  });
  const clearHistoryMut = trpc.comfyStress.history.clear.useMutation({
    onSuccess: () => { utils.comfyStress.history.list.invalidate(); toast.success("历史已清空"); },
    onError: (e) => toast.error(`清空失败：${e.message}`),
  });
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);

  const setM = (patch: Partial<typeof model>) => setModel((m) => ({ ...m, ...patch }));

  async function refreshModels() {
    const urls = baseUrls.map((u) => u.trim()).filter((u) => u.length > 0);
    if (urls.length === 0) { toast.error("请先填写至少一个 ComfyUI 地址再刷新模型"); return; }
    setLoadingModels(true);
    try {
      const res = await utils.comfyui.fetchModels.fetch({ customBaseUrls: urls });
      setModels({ ckpts: res.ckpts, samplers: res.samplers, schedulers: res.schedulers, clips: res.clips, unets: res.unets, vaes: res.vaes, upscaleModels: res.upscaleModels });
      if (res.ckpts.length === 0) toast.info("已连接，但未发现 checkpoint 模型");
      else toast.success(`已拉取 ${res.ckpts.length} 个模型`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "拉取模型失败");
    } finally {
      setLoadingModels(false);
    }
  }

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

  // 一键加载「ComfyUI 服务器监视器」配置的全部地址（管理员全局列表 ∪ 本机注册表），
  // 与已填地址合并去重，空行清掉，上限 16（与 addUrl 同口径）。
  const [loadingMonitor, setLoadingMonitor] = useState(false);
  async function loadMonitorServers() {
    setLoadingMonitor(true);
    try {
      const globalList = await utils.comfyui.globalServers.fetch();
      const monitor = Array.from(new Set([...(globalList ?? []), ...useComfyServersStore.getState().servers].map((u) => u.trim()).filter(Boolean)));
      if (monitor.length === 0) { toast.info("服务器监视器中还没有配置地址（画布顶栏服务器图标可添加）"); return; }
      const cur = baseUrls.map((u) => u.trim()).filter(Boolean);
      const merged = Array.from(new Set([...cur, ...monitor])).slice(0, 16);
      const added = merged.length - cur.length;
      setBaseUrls(merged.length > 0 ? merged : [""]);
      toast.success(added > 0 ? `已从服务器监视器加载 ${added} 个地址（共 ${merged.length} 个）` : "监视器中的地址均已在列表中");
    } catch (e) {
      toast.error(`读取服务器监视器列表失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingMonitor(false);
    }
  }

  async function onStart() {
    const urls = baseUrls.map((u) => u.trim()).filter((u) => u.length > 0);
    // 按来源组装压测参数。
    let args: Parameters<typeof startMut.mutateAsync>[0];
    if (source === "model") {
      if (!model.ckpt.trim()) { toast.error("请先选择一个 checkpoint 模型"); return; }
      const clip = model.clip?.name1?.trim()
        ? { clipType: model.clip.clipType, name1: model.clip.name1.trim(), name2: model.clip.name2?.trim() || undefined, name3: model.clip.name3?.trim() || undefined }
        : undefined;
      args = { customBaseUrls: urls.length > 0 ? urls : undefined, model: { ...model, clip }, mode, concurrency, total, randomizeSeed };
    } else {
      if (workflowJson.trim().length < 2) { toast.error("请先粘贴工作流 JSON"); return; }
      try { JSON.parse(workflowJson); } catch { toast.error("工作流 JSON 格式错误，无法解析"); return; }
      args = { customBaseUrls: urls.length > 0 ? urls : undefined, workflowJson, mode, concurrency, total, randomizeSeed };
    }
    try {
      await startMut.mutateAsync(args);
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>ComfyUI 压力测试</h2>
        {/* 复用画布顶栏的服务器监视器（自带弹出面板/固定/拖拽），压测时实时盯 GPU/显存/队列 */}
        <div style={{ display: "flex", alignItems: "center", padding: "2px 6px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.inputBg }} title="服务器监视器（与画布顶栏一致）">
          <ComfyServerStatusIndicator />
        </div>
      </div>
      <p style={{ fontSize: 13, color: C.sub, margin: "0 0 20px" }}>
        重复并发执行同一个工作流，测量 ComfyUI 服务器的吞吐与延迟。支持多地址（请求按轮询打散到各机器，结果按服务器分别统计）。⚠️ 压测会真实消耗目标 GPU 资源，请勿对生产服务器高并发压测。
      </p>

      {/* 配置表单 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
        {/* ── 参数模板（保存整套表单 · 管理员共享 · DB 持久化）─────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 18, paddingBottom: 14, borderBottom: `1px dashed ${C.border}` }}>
          <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>参数模板</span>
          <select
            style={{ ...inputStyle, width: 260, padding: "7px 10px" }}
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">{templatesQuery.error ? "— 模板读取失败（见右侧提示）—" : `— 选择模板（${templatesQuery.data?.length ?? 0} 个）—`}</option>
            {(templatesQuery.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}（{t.createdByEmail ?? "?"} · {fmtTime(t.updatedAt)}）</option>
            ))}
          </select>
          <button
            onClick={() => {
              const t = (templatesQuery.data ?? []).find((x) => x.id === selectedTemplateId);
              if (!t) { toast.error("请先选择一个模板"); return; }
              applyTemplate(t.config);
            }}
            disabled={selectedTemplateId === ""}
            style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.blue}`, background: "transparent", color: C.blue, cursor: selectedTemplateId === "" ? "not-allowed" : "pointer", fontSize: 13, opacity: selectedTemplateId === "" ? 0.5 : 1 }}
          >
            应用
          </button>
          <button
            onClick={() => {
              const t = (templatesQuery.data ?? []).find((x) => x.id === selectedTemplateId);
              if (!t) { toast.error("请先选择一个模板"); return; }
              if (window.confirm(`删除模板「${t.name}」？`)) { deleteTemplateMut.mutate({ id: t.id }); setSelectedTemplateId(""); }
            }}
            disabled={selectedTemplateId === "" || deleteTemplateMut.isPending}
            style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.red, cursor: selectedTemplateId === "" ? "not-allowed" : "pointer", fontSize: 13, opacity: selectedTemplateId === "" ? 0.5 : 1 }}
          >
            删除
          </button>
          <span style={{ flex: 1 }} />
          <button
            onClick={exportTemplates}
            disabled={(templatesQuery.data?.length ?? 0) === 0}
            title={selectedTemplateId === "" ? "导出全部模板为 JSON 文件" : "导出选中的模板为 JSON 文件（不选则导出全部）"}
            style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.blue}`, background: "transparent", color: C.blue, cursor: (templatesQuery.data?.length ?? 0) === 0 ? "not-allowed" : "pointer", fontSize: 13, opacity: (templatesQuery.data?.length ?? 0) === 0 ? 0.5 : 1 }}
          >
            ⇧ 导出{selectedTemplateId === "" ? "全部" : "选中"}
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importTemplateMut.isPending}
            title="从 JSON 文件导入模板（支持本页导出的文件 / 模板数组 / 单个模板对象）"
            style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.violet}`, background: "transparent", color: C.violet, cursor: "pointer", fontSize: 13 }}
          >
            {importTemplateMut.isPending ? "导入中…" : "⇩ 导入"}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importTemplates(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={saveAsTemplate}
            disabled={saveTemplateMut.isPending}
            title="把当前整套表单（地址/来源/工作流/模型参数/模式/并发/次数）存为模板"
            style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.green}`, background: "transparent", color: C.green, cursor: "pointer", fontSize: 13 }}
          >
            {saveTemplateMut.isPending ? "保存中…" : "💾 当前参数存为模板"}
          </button>
          {templatesQuery.error && (
            <div style={{ width: "100%", fontSize: 12, color: C.red }}>
              模板读取失败：{templatesQuery.error.message}（若提示表不存在，请先到「系统更新」执行一次更新以应用数据库迁移）
            </div>
          )}
        </div>

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
          <button
            onClick={loadMonitorServers}
            disabled={loadingMonitor}
            title="加载服务器监视器中的全部地址（画布顶栏服务器面板配置的全局+本机列表）"
            style={{
              marginTop: 8, marginLeft: 8, padding: "6px 12px", borderRadius: 8, border: `1px dashed ${C.border}`,
              background: "transparent", color: C.green, cursor: loadingMonitor ? "wait" : "pointer",
              fontSize: 13, opacity: loadingMonitor ? 0.5 : 1,
            }}
          >
            {loadingMonitor ? "加载中…" : "⇩ 从服务器监视器加载"}
          </button>
        </div>

        {/* 压测来源切换 */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>压测来源</label>
          <div style={{ display: "inline-flex", borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            {([["json", "工作流 JSON"], ["model", "服务器模型"]] as const).map(([val, lbl]) => (
              <button
                key={val}
                onClick={() => setSource(val)}
                style={{
                  padding: "7px 16px", fontSize: 13, border: "none", cursor: "pointer",
                  background: source === val ? C.blue : "transparent",
                  color: source === val ? "#fff" : C.sub, fontWeight: source === val ? 600 : 400,
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {source === "json" ? (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>工作流 JSON（API 格式）</label>
            <textarea
              style={{ ...inputStyle, minHeight: 140, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
              placeholder={PLACEHOLDER_HINT}
              value={workflowJson}
              onChange={(e) => setWorkflowJson(e.target.value)}
            />
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <button
                onClick={refreshModels}
                disabled={loadingModels}
                style={{
                  padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
                  background: "transparent", color: C.blue, cursor: loadingModels ? "wait" : "pointer", fontSize: 13,
                }}
              >
                {loadingModels ? "拉取中…" : "刷新模型"}
              </button>
              <span style={{ fontSize: 12, color: C.sub }}>
                从上方地址（并集）拉取 checkpoint / 采样器 / 调度器。多地址压测使用同一个模型，缺该模型的服务器请求会计为失败。
              </span>
            </div>
            {/* 架构 + 模型加载方式（DiT：Flux/SD3/Qwen） */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>架构</label>
                <select
                  style={inputStyle}
                  value={model.arch ?? "sd"}
                  onChange={(e) => {
                    const v = e.target.value as "sd" | "flux" | "sd3" | "qwen";
                    if (v === "sd") { setM({ arch: undefined, modelSource: undefined }); return; }
                    const patch: Partial<typeof model> = { arch: v, modelSource: "unet" };
                    if (!model.clip?.name1) {
                      if (v === "flux") patch.clip = { clipType: "flux", name1: "", name2: "" };
                      else if (v === "qwen") patch.clip = { clipType: "qwen_image", name1: "" };
                      else patch.clip = { clipType: "", name1: "", name2: "", name3: "" };
                    }
                    setM(patch);
                  }}
                >
                  <option value="sd">经典 SD / SDXL</option>
                  <option value="flux">Flux.1</option>
                  <option value="sd3">SD3 / SD3.5</option>
                  <option value="qwen">Qwen-Image</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>模型加载方式</label>
                <select
                  style={inputStyle}
                  value={model.modelSource ?? ((model.arch ?? "sd") === "sd" ? "checkpoint" : "unet")}
                  onChange={(e) => setM({ modelSource: e.target.value === "unet" ? "unet" : "checkpoint" })}
                >
                  <option value="checkpoint">完整 Checkpoint</option>
                  <option value="unet">单独 UNet / 扩散模型</option>
                </select>
              </div>
              {(model.modelSource ?? ((model.arch ?? "sd") === "sd" ? "checkpoint" : "unet")) === "unet" && (
                <div>
                  <label style={labelStyle}>权重精度</label>
                  <select style={inputStyle} value={model.unetWeightDtype ?? "default"} onChange={(e) => setM({ unetWeightDtype: e.target.value })}>
                    {["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              {model.arch === "flux" && (
                <div>
                  <label style={labelStyle}>Flux Guidance</label>
                  <input type="number" min={0} max={100} step={0.1} style={inputStyle} value={model.guidance ?? 3.5}
                    onChange={(e) => setM({ guidance: Number(e.target.value) || 0 })} />
                </div>
              )}
              {(model.arch === "sd3" || model.arch === "qwen") && (
                <div>
                  <label style={labelStyle}>采样位移 shift</label>
                  <input type="number" min={0} max={100} step={0.1} style={inputStyle} value={model.shift ?? (model.arch === "qwen" ? 3.1 : 3)}
                    onChange={(e) => setM({ shift: Number(e.target.value) || 0 })} />
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <div>
                {(() => { const isUnet = (model.modelSource ?? ((model.arch ?? "sd") === "sd" ? "checkpoint" : "unet")) === "unet"; const list = isUnet ? (models?.unets ?? []) : (models?.ckpts ?? []); return (
                  <>
                    <label style={labelStyle}>{isUnet ? "UNet / 扩散模型 *" : "Checkpoint 模型 *"}</label>
                    {list.length > 0 ? (
                      <select style={inputStyle} value={model.ckpt} onChange={(e) => setM({ ckpt: e.target.value })}>
                        <option value="">— 请选择 —</option>
                        {list.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <input style={inputStyle} placeholder={isUnet ? "先点「刷新模型」，或手填 unet 文件名" : "先点「刷新模型」，或手填 ckpt 文件名"} value={model.ckpt} onChange={(e) => setM({ ckpt: e.target.value })} />
                    )}
                  </>
                ); })()}
              </div>
              <div>
                <label style={labelStyle}>采样器</label>
                {models && models.samplers.length > 0 ? (
                  <select style={inputStyle} value={model.sampler} onChange={(e) => setM({ sampler: e.target.value })}>
                    {models.samplers.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input style={inputStyle} value={model.sampler} onChange={(e) => setM({ sampler: e.target.value })} />
                )}
              </div>
              <div>
                <label style={labelStyle}>调度器</label>
                {models && models.schedulers.length > 0 ? (
                  <select style={inputStyle} value={model.scheduler} onChange={(e) => setM({ scheduler: e.target.value })}>
                    {models.schedulers.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input style={inputStyle} value={model.scheduler} onChange={(e) => setM({ scheduler: e.target.value })} />
                )}
              </div>
              <div>
                <label style={labelStyle}>步数（1–150）</label>
                <input type="number" min={1} max={150} style={inputStyle} value={model.steps}
                  onChange={(e) => setM({ steps: Math.max(1, Math.min(150, Number(e.target.value) || 1)) })} />
              </div>
              <div>
                <label style={labelStyle}>CFG</label>
                <input type="number" min={0} max={50} step={0.5} style={inputStyle} value={model.cfg}
                  onChange={(e) => setM({ cfg: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} />
              </div>
              <div>
                <label style={labelStyle}>宽</label>
                <input type="number" min={64} max={4096} step={8} style={inputStyle} value={model.width}
                  onChange={(e) => setM({ width: Math.max(64, Math.min(4096, Number(e.target.value) || 64)) })} />
              </div>
              <div>
                <label style={labelStyle}>高</label>
                <input type="number" min={64} max={4096} step={8} style={inputStyle} value={model.height}
                  onChange={(e) => setM({ height: Math.max(64, Math.min(4096, Number(e.target.value) || 64)) })} />
              </div>
              <div>
                <label style={labelStyle}>批量（1–8）</label>
                <input type="number" min={1} max={8} style={inputStyle} value={model.batchSize}
                  onChange={(e) => setM({ batchSize: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} />
              </div>
              <div>
                <label style={labelStyle}>Denoise（0–1）</label>
                <input type="number" min={0} max={1} step={0.05} style={inputStyle} value={model.denoise}
                  onChange={(e) => setM({ denoise: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
              </div>
              <div>
                <label style={labelStyle}>VAE（留空用 checkpoint 内置）</label>
                {models && models.vaes.length > 0 ? (
                  <select style={inputStyle} value={model.vae ?? ""} onChange={(e) => setM({ vae: e.target.value || undefined })}>
                    <option value="">— 跟随 checkpoint —</option>
                    {models.vaes.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : (
                  <input style={inputStyle} placeholder="如 ae.safetensors（Flux/Qwen 需填）" value={model.vae ?? ""} onChange={(e) => setM({ vae: e.target.value || undefined })} />
                )}
              </div>
              <div>
                <label style={labelStyle}>放大模型（留空不放大）</label>
                {models && models.upscaleModels.length > 0 ? (
                  <select style={inputStyle} value={model.upscaleModel ?? ""} onChange={(e) => setM({ upscaleModel: e.target.value || undefined })}>
                    <option value="">— 不放大 —</option>
                    {models.upscaleModels.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                ) : (
                  <input style={inputStyle} placeholder="如 4x-UltraSharp.pth" value={model.upscaleModel ?? ""} onChange={(e) => setM({ upscaleModel: e.target.value || undefined })} />
                )}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>正向提示词（可选）</label>
              <input style={inputStyle} placeholder="a photo of a cat" value={model.prompt} onChange={(e) => setM({ prompt: e.target.value })} />
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>负面提示词（可选）</label>
              <input style={inputStyle} value={model.negPrompt} onChange={(e) => setM({ negPrompt: e.target.value })} />
            </div>
            {/* CLIP 来源：checkpoint 不含 CLIP（Flux/SD3/UNet-only）时单独加载，否则报 "clip input is invalid" */}
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>CLIP 来源（Checkpoint 不含 CLIP 时用，如 Flux/SD3）</label>
              <select
                style={inputStyle}
                value={model.clip == null ? "checkpoint" : (model.clip.name3 !== undefined ? "triple" : model.clip.name2 !== undefined ? "dual" : "single")}
                onChange={(e) => {
                  const m = e.target.value;
                  if (m === "checkpoint") setM({ clip: undefined });
                  else if (m === "single") setM({ clip: { clipType: model.clip?.clipType || "stable_diffusion", name1: model.clip?.name1 || "", name2: undefined, name3: undefined } });
                  else if (m === "dual") setM({ clip: { clipType: model.clip?.clipType || "flux", name1: model.clip?.name1 || "", name2: model.clip?.name2 ?? "", name3: undefined } });
                  else setM({ clip: { clipType: "", name1: model.clip?.name1 || "", name2: model.clip?.name2 ?? "", name3: model.clip?.name3 ?? "" } });
                }}
              >
                <option value="checkpoint">跟随 Checkpoint（默认）</option>
                <option value="single">单独 CLIP（CLIPLoader · Qwen 等）</option>
                <option value="dual">双 CLIP（DualCLIPLoader · Flux/SDXL）</option>
                <option value="triple">三 CLIP（TripleCLIPLoader · SD3）</option>
              </select>
              {model.clip != null && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 8 }}>
                  {model.clip.name3 === undefined && (
                    <>
                      <input
                        list="cs-clip-types"
                        style={inputStyle}
                        placeholder={model.clip.name2 !== undefined ? "类型 如 flux / sdxl" : "类型 如 qwen_image / flux"}
                        value={model.clip.clipType}
                        onChange={(e) => setM({ clip: { ...model.clip!, clipType: e.target.value } })}
                      />
                      <datalist id="cs-clip-types">
                        {(model.clip.name2 !== undefined
                          ? ["sdxl", "sd3", "flux", "hunyuan_video", "hidream"]
                          : ["qwen_image", "stable_diffusion", "sd3", "flux", "stable_cascade", "stable_audio", "mochi", "ltxv", "pixart", "cosmos", "lumina2", "wan", "hunyuan_video"]
                        ).map((t) => <option key={t} value={t} />)}
                      </datalist>
                    </>
                  )}
                  {([["name1", "clip_name1"], ["name2", "clip_name2"], ["name3", "clip_name3"]] as const)
                    .filter(([k]) => (model.clip as Record<string, unknown>)[k] !== undefined)
                    .map(([k, label]) => (
                      models && models.clips.length > 0 ? (
                        <select key={k} style={inputStyle} value={(model.clip as Record<string, string>)[k]} onChange={(e) => setM({ clip: { ...model.clip!, [k]: e.target.value } })}>
                          <option value="">— {label} —</option>
                          {models.clips.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <input key={k} style={inputStyle} placeholder={`${label} 文件名`} value={(model.clip as Record<string, string>)[k]} onChange={(e) => setM({ clip: { ...model.clip!, [k]: e.target.value } })} />
                      )
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

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
        {jobs.map((j) => (
          <JobCard key={j.id} j={j} live onCancel={onCancel} onStop={onStop} />
        ))}
      </div>

      {/* ── 历史记录（任务结束自动落库 · 跨重启保留）──────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "28px 0 12px" }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>历史记录</h3>
        <span style={{ fontSize: 12, color: C.sub }}>{historyQuery.data?.length ?? 0} 条 · 任务结束自动保存</span>
        <span style={{ flex: 1 }} />
        {(historyQuery.data?.length ?? 0) > 0 && (
          <button
            onClick={() => { if (window.confirm("清空全部压测历史？此操作不可恢复。")) clearHistoryMut.mutate(); }}
            disabled={clearHistoryMut.isPending}
            style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: "transparent", color: C.red, cursor: "pointer", fontSize: 12 }}
          >
            清空历史
          </button>
        )}
      </div>
      {historyQuery.error ? (
        // 历史查询失败时必须明示，不能伪装成「0 条」——最常见原因是生产库还没跑
        // 0054 迁移（comfy_stress_history 表不存在），任务结束的自动落库也会一并失败。
        <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.6, background: "oklch(0.63 0.21 25 / 0.10)", border: `1px solid oklch(0.63 0.21 25 / 0.35)`, color: C.red }}>
          历史记录读取失败：{historyQuery.error.message}
          <div style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>
            若提示表不存在（comfy_stress_history），说明数据库迁移尚未应用——请到「系统更新」页执行一次更新（会自动跑 db:push），之后压测历史与模板才能持久化。
          </div>
        </div>
      ) : (historyQuery.data?.length ?? 0) === 0 ? (
        <p style={{ fontSize: 13, color: C.sub }}>暂无历史记录——任务结束后会自动保存到这里。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(historyQuery.data ?? []).map((h) => {
            const r = h.result as JobView | null;
            const expanded = expandedHistoryId === h.id;
            const okRate = r && r.completed > 0 ? Math.round((r.succeeded / r.completed) * 100) : null;
            const statusColor = h.status === "completed" ? C.green : h.status === "cancelled" ? C.sub : C.red;
            return (
              <div key={h.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                {/* 摘要行（点击展开详情） */}
                <div
                  onClick={() => setExpandedHistoryId(expanded ? null : h.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", flexWrap: "wrap" }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: statusColor, padding: "2px 8px", borderRadius: 5, flexShrink: 0 }}>
                    {h.status === "completed" ? "已完成" : h.status === "cancelled" ? "已取消" : "失败"}
                  </span>
                  <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600 }}>{fmtTime(h.startedAt)}</span>
                  {r && (
                    <>
                      <span style={{ fontSize: 12, color: C.sub }}>
                        {r.mode === "lean" ? "精简" : "完整"} · 并发 {r.concurrency} · {r.completed}/{r.total} 次 · {r.baseUrls?.length ?? 1} 台
                        {r.meta?.source === "model" ? ` · 模型 ${r.meta.ckpt ?? ""}` : " · 工作流 JSON"}
                      </span>
                      <span style={{ flex: 1 }} />
                      {okRate != null && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: okRate >= 99 ? C.green : okRate >= 90 ? C.amber : C.red }}>成功率 {okRate}%</span>
                      )}
                      <span style={{ fontSize: 12, color: C.sub }}>吞吐 {r.throughputPerSec}/s · avg {fmtMs(r.avgMs)} · p95 {fmtMs(r.p95Ms)}</span>
                    </>
                  )}
                  <span style={{ fontSize: 11, color: C.sub }}>{h.startedByEmail ?? ""}</span>
                  <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    {r && (
                      <>
                        <button onClick={() => exportJobJson(r, `${h.jobId}`)} title="导出完整 JSON（含时间序列）" style={histBtn(C.blue)}>JSON</button>
                        <button onClick={() => exportJobCsv(r, `${h.jobId}`)} title="导出 CSV（汇总+每服务器+时间序列）" style={histBtn(C.green)}>CSV</button>
                      </>
                    )}
                    <button
                      onClick={() => { if (window.confirm("删除这条历史记录？")) deleteHistoryMut.mutate({ id: h.id }); }}
                      title="删除此记录"
                      style={histBtn(C.red)}
                    >
                      删除
                    </button>
                  </div>
                  <span style={{ fontSize: 11, color: C.sub, width: 24, textAlign: "center" }}>{expanded ? "▲" : "▼"}</span>
                </div>
                {/* 展开：完整任务卡（同实时任务渲染，含图表/每服务器/错误样本） */}
                {expanded && r && (
                  <div style={{ borderTop: `1px solid ${C.border}` }}>
                    <JobCard j={r} live={false} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function histBtn(color: string): React.CSSProperties {
  return { padding: "3px 10px", borderRadius: 6, border: `1px solid ${color}`, background: "transparent", color, cursor: "pointer", fontSize: 11, fontWeight: 600 };
}

// ── 任务卡（实时任务与历史详情共用）─────────────────────────────────────────
function JobCard({ j, live, onCancel, onStop }: {
  j: JobView; live: boolean;
  onCancel?: (id: string) => void; onStop?: (id: string) => void;
}) {
  const pct = j.total > 0 ? Math.round((j.completed / j.total) * 100) : 0;
  const statusColor = j.status === "running" ? C.blue
    : j.status === "completed" ? C.green
    : j.status === "cancelled" ? C.sub : C.red;
  const statusLabel = j.status === "running" ? "运行中"
    : j.status === "completed" ? "已完成"
    : j.status === "cancelled" ? "已取消" : "失败";
  const multi = (j.baseUrls?.length ?? 0) > 1;
  const okRate = j.completed > 0 ? Math.round((j.succeeded / j.completed) * 100) : null;
  return (
    <div style={{ background: C.card, border: live ? `1px solid ${C.border}` : "none", borderRadius: live ? 12 : 0, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: statusColor, padding: "2px 8px", borderRadius: 6 }}>
            {statusLabel}
          </span>
          <span style={{ fontSize: 13, color: C.sub }}>
            {j.mode === "lean" ? "精简" : "完整"} · 并发 {j.concurrency} · 共 {j.total} · {j.baseUrls?.length ?? 1} 台
            {j.meta?.source === "model" ? ` · 模型 ${j.meta.ckpt ?? ""}` : j.meta?.source === "json" ? " · 工作流 JSON" : ""}
          </span>
          <span style={{ fontSize: 12, color: C.sub }}>
            {fmtTime(j.startedAt)} 开始 · 用时 {fmtDuration(j.startedAt, j.finishedAt ?? (j.status === "running" ? Date.now() : null))}
            {j.startedByEmail ? ` · ${j.startedByEmail}` : ""}
          </span>
          {okRate != null && j.status !== "running" && (
            <span style={{ fontSize: 12, fontWeight: 700, color: okRate >= 99 ? C.green : okRate >= 90 ? C.amber : C.red }}>
              成功率 {okRate}%
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => exportJobJson(j, j.id)} title="导出完整 JSON（含时间序列）" style={histBtn(C.blue)}>导出 JSON</button>
          <button onClick={() => exportJobCsv(j, j.id)} title="导出 CSV（汇总+每服务器+时间序列）" style={histBtn(C.green)}>导出 CSV</button>
          {live && j.status === "running" && onCancel && onStop && (
            <>
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
            </>
          )}
        </div>
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
                  {s.completed > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: s.failed === 0 ? C.green : C.red }}>
                      {Math.round((s.succeeded / s.completed) * 100)}%
                    </span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, fontSize: 12 }}>
                  <Stat label="成功 / 失败" value={`${s.succeeded} / ${s.failed}`} valueColor={s.failed > 0 ? C.red : undefined} small />
                  <Stat label="在途" value={String(s.inFlight)} small />
                  <Stat label="吞吐" value={`${s.throughputPerSec}/s`} small />
                  <Stat label="avg" value={fmtMs(s.avgMs)} small />
                  <Stat label="p50" value={fmtMs(s.p50Ms)} small />
                  <Stat label="p95" value={fmtMs(s.p95Ms)} small />
                  <Stat label="max" value={fmtMs(s.maxMs)} small />
                  <Stat label="提交" value={fmtMs(s.avgSubmitMs)} small />
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
  // 延迟：avg 主线 + p50/p95 分位虚线（旧历史记录可能没有分位快照，自动缺省）。
  const lat = ts.map((s) => {
    const o: Record<string, number | null> = { t: Math.round(s.t / 1000), avg: s.avgMs, p50: s.p50Ms ?? null, p95: s.p95Ms ?? null };
    s.perServer.forEach((ps) => { o[ps.baseUrl] = ps.avgMs; });
    return o;
  });
  const hasPercentiles = ts.some((s) => s.p50Ms != null || s.p95Ms != null);
  // 进度：累计完成/成功/失败 + 瞬时在途——直观看到收敛速度与排队堆积。
  const prog = ts.map((s) => ({
    t: Math.round(s.t / 1000),
    完成: s.completed, 成功: s.succeeded, 失败: s.failed, 在途: s.inFlight,
  }));
  // 每服务器在途（多机时）：哪台机器堆积一目了然。
  const flight = multi
    ? ts.map((s) => {
        const o: Record<string, number> = { t: Math.round(s.t / 1000) };
        s.perServer.forEach((ps) => { o[ps.baseUrl] = ps.inFlight; });
        return o;
      })
    : [];

  const serverSeries = multi
    ? job.baseUrls.map((url, i) => ({ key: url, name: shortUrl(url), color: SERVER_COLORS[i % SERVER_COLORS.length] }))
    : [];

  return (
    <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
      <ChartBox title="吞吐（次/秒）" data={tput} series={serverSeries} yUnit="/s" overallKey="总体" />
      <ChartBox
        title={hasPercentiles ? "延迟（avg 实线 · p50/p95 虚线）" : "平均延迟"}
        data={lat}
        yUnit="ms"
        overallKey="avg"
        series={[
          ...(hasPercentiles ? [
            { key: "p50", name: "p50", color: "#34d399", dash: "5 4", width: 1.4 },
            { key: "p95", name: "p95", color: "#fbbf24", dash: "5 4", width: 1.4 },
          ] : []),
          ...serverSeries,
        ]}
      />
      <ChartBox
        title="进度与在途"
        data={prog}
        series={[
          { key: "成功", name: "成功", color: "#34d399" },
          { key: "失败", name: "失败", color: "#fb7185" },
          { key: "在途", name: "在途", color: "#fbbf24", dash: "4 3" },
        ]}
        yUnit=""
        overallKey="完成"
      />
      {multi && (
        <ChartBox title="每服务器在途（堆积观察）" data={flight} series={serverSeries} yUnit="" overallKey={null} />
      )}
    </div>
  );
}

// 时间轴刻度：短任务显秒，超过 2 分钟显「m分」。
function fmtAxisSec(v: number): string {
  return v >= 120 ? `${Math.round(v / 60)}m` : `${v}s`;
}

let _gradSeq = 0;

function ChartBox({
  title, data, series, yUnit, overallKey = "总体",
}: {
  title: string;
  data: Record<string, number | null>[];
  series: { key: string; name: string; color: string; dash?: string; width?: number }[];
  yUnit: string;
  /** 主线（渐变面积填充）。传 null 则只画 series 多线（如每服务器在途图）。 */
  overallKey?: string | null;
}) {
  // 渐变 id 需全局唯一（同页多图 + 历史展开多卡）。
  const [gid] = useState(() => `csg-${++_gradSeq}`);
  return (
    <div style={{ background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 12px 4px", boxShadow: "0 1px 2px oklch(0 0 0 / 0.12)" }}>
      <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <ResponsiveContainer width="100%" height={235}>
        <ComposedChart data={data} margin={{ top: 6, right: 14, bottom: 4, left: -4 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={OVERALL_COLOR} stopOpacity={0.30} />
              <stop offset="100%" stopColor={OVERALL_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {/* SVG stroke 属性不解析 CSS 变量——图表内部用具体色值 */}
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} strokeOpacity={0.22} vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 10.5, fill: CHART_GRID }}
            stroke={CHART_GRID} strokeOpacity={0.5}
            tickLine={false}
            tickFormatter={(v) => fmtAxisSec(Number(v))}
            minTickGap={28}
          />
          <YAxis
            tick={{ fontSize: 10.5, fill: CHART_GRID }}
            stroke="transparent"
            width={48} unit={yUnit}
            tickLine={false}
            domain={[0, "auto"]}
          />
          <Tooltip
            contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: C.sub }}
            labelFormatter={(v) => fmtAxisSec(Number(v))}
            itemSorter={(item) => -(typeof item.value === "number" ? item.value : 0)}
          />
          {(series.length > 0) && <Legend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 11 }} />}
          {overallKey != null && (
            <Area
              type="monotone" dataKey={overallKey}
              stroke={OVERALL_COLOR} strokeWidth={2.4}
              fill={`url(#${gid})`}
              dot={false} isAnimationActive={false} connectNulls
            />
          )}
          {series.map((s) => (
            <Line
              key={s.key} type="monotone" dataKey={s.key} name={s.name}
              stroke={s.color} strokeWidth={s.width ?? 1.8} strokeDasharray={s.dash}
              dot={false} isAnimationActive={false} connectNulls
            />
          ))}
        </ComposedChart>
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
