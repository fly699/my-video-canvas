import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  X, Loader2, Upload, ServerCog, ShieldCheck, ShieldAlert,
  CheckCircle2, AlertTriangle, ChevronRight, ChevronLeft, FileJson, Wand2, PackageX, Sparkles, Copy, Save,
} from "lucide-react";
import { detectWorkflowFormat, extractComfyWorkflowsFromPng, suggestBestMatch } from "@/lib/comfyWorkflowImport";
import { useComfyServersStore } from "@/hooks/useComfyServersStore";

// ── ComfyUI 工作流「专业导入向导」──────────────────────────────────────────────
// 解决「导入即报错、反复调参」的痛点：分步引导 + 用目标服务器 /object_info 做导入前预检，
// 把「缺自定义节点 / ckpt·lora·sampler 等枚举值在服务器上不存在 / 必填缺失」一次性查出来，
// 提供下拉一键重映射到服务器上真实存在的选项，校验通过后才落到节点——一次跑通。
//
// 向导只负责产出「干净、已校验、格式正确」的工作流 + 分析结果，交回节点既有的参数绑定 UI。

type AnalyzeResult = Awaited<ReturnType<ReturnType<typeof trpc.comfyui.analyzeWorkflow.useMutation>["mutateAsync"]>>;
type ValidateResult = Awaited<ReturnType<ReturnType<typeof trpc.comfyui.validateWorkflow.useMutation>["mutateAsync"]>>;

export interface ImportWizardResult {
  workflowJson: string;           // 已应用重映射、API 格式
  customBaseUrl?: string;         // 用户选定的服务器（写回节点）
  analyze: AnalyzeResult;
}

type Step = "load" | "server" | "validate";
const STEPS: { id: Step; label: string }[] = [
  { id: "load", label: "载入工作流" },
  { id: "server", label: "选择服务器" },
  { id: "validate", label: "预检 · 导入" },
];

const ACCENT = "oklch(0.7 0.17 195)"; // ComfyUI 青
const A = (a: number) => `oklch(0.7 0.17 195 / ${a})`;

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center" style={{ gap: 4 }}>
      {STEPS.map((s, i) => {
        const done = i < idx, active = i === idx;
        return (
          <div key={s.id} className="flex items-center" style={{ gap: 4, flex: 1 }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%", flexShrink: 0, fontSize: 10, fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: done || active ? ACCENT : "var(--c-bd1)", color: done || active ? "#06202a" : "var(--c-t3)",
            }}>{done ? <CheckCircle2 style={{ width: 12, height: 12 }} /> : i + 1}</span>
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? "var(--c-t1)" : "var(--c-t4)", whiteSpace: "nowrap" }}>{s.label}</span>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: done ? ACCENT : "var(--c-bd1)", margin: "0 4px" }} />}
          </div>
        );
      })}
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  width: "100%", fontSize: 11.5, lineHeight: 1.5, padding: "9px 11px", borderRadius: 9,
  background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)",
  outline: "none", resize: "vertical", fontFamily: "ui-monospace, monospace",
};

export function ComfyWorkflowImportWizard({ initialServerUrl, knownServers, onCancel, onComplete }: {
  initialServerUrl?: string;
  /** 节点上已保存的服务器地址（payload.serverUrls），并入下拉候选。 */
  knownServers?: string[];
  onCancel: () => void;
  onComplete: (r: ImportWizardResult) => void;
}) {
  const [step, setStep] = useState<Step>("load");

  // ── 载入 ──
  const [rawText, setRawText] = useState("");      // 用户粘贴/文件里的原始 JSON 文本
  const [parsed, setParsed] = useState<unknown>(null);
  const fmt = useMemo(() => (parsed ? detectWorkflowFormat(parsed) : "unknown"), [parsed]);
  // 节点数预览：API 格式 = 顶层键数；UI 格式 = nodes 数组长度。
  const nodeCount = useMemo(() => {
    if (!parsed || typeof parsed !== "object") return 0;
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.nodes)) return o.nodes.length;
    return Object.keys(o).length;
  }, [parsed]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const acceptParsed = (obj: unknown, text: string) => {
    const f = detectWorkflowFormat(obj);
    if (f === "unknown") { toast.error("无法识别为 ComfyUI 工作流（需 API 或 UI 格式 JSON）"); return; }
    setParsed(obj); setRawText(text);
  };
  const onPaste = (v: string) => {
    setRawText(v);
    const t = v.trim();
    if (!t) { setParsed(null); return; }
    try { setParsed(JSON.parse(t)); } catch { setParsed(null); }
  };
  const onFile = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const isPng = /\.png$/i.test(file.name) || file.type === "image/png";
      if (isPng) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { promptApi, workflowUi } = extractComfyWorkflowsFromPng(bytes);
        const obj = promptApi ?? workflowUi;
        if (!obj) { toast.error("该 PNG 未内嵌 ComfyUI 工作流"); return; }
        acceptParsed(obj, JSON.stringify(obj));
        toast.success("已从 PNG 读取工作流");
        return;
      }
      const text = await file.text();
      let obj: unknown;
      try { obj = JSON.parse(text); } catch { toast.error("JSON 解析失败"); return; }
      acceptParsed(obj, text);
    } finally { setImporting(false); }
  }, []);

  // ── 服务器 ──
  const [serverUrl, setServerUrl] = useState(initialServerUrl ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const utils = trpc.useUtils();
  // 已有服务器候选 = 节点保存的 serverUrls ∪ 本机注册表（localStorage）∪ 管理员全局列表，
  // 与 ComfyServerUrlField 同源——选了即填入输入框，仍可手输新地址。
  const localServers = useComfyServersStore((s) => s.servers);
  const globalServersQ = trpc.comfyui.globalServers.useQuery(undefined, { staleTime: 60_000, retry: false });
  const serverOptions = useMemo(() => {
    const merged = [...(knownServers ?? []), ...localServers, ...(globalServersQ.data ?? [])]
      .map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set(merged));
  }, [knownServers, localServers, globalServersQ.data]);
  const addLocalServer = useComfyServersStore((s) => s.add);
  const testServer = useCallback(async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await utils.comfyui.fetchModels.fetch({ customBaseUrl: serverUrl.trim() || undefined });
      setTestResult({ ok: true, msg: `连接成功 · checkpoint ${r.ckpts.length} · LoRA ${r.loras.length} · 采样器 ${r.samplers.length}` });
      // 测试通过的地址记入本机注册表，下次（任何节点/向导）下拉可直接选。
      if (serverUrl.trim()) addLocalServer(serverUrl.trim());
    } catch (e) {
      setTestResult({ ok: false, msg: "连接失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 100) });
    } finally { setTesting(false); }
  }, [utils, serverUrl, addLocalServer]);

  // ── 预检 + 重映射 ──
  const convertMut = trpc.comfyui.convertWorkflow.useMutation();
  const validateMut = trpc.comfyui.validateWorkflow.useMutation();
  const analyzeMut = trpc.comfyui.analyzeWorkflow.useMutation();
  const tplCreateMut = trpc.comfyTemplates.create.useMutation();
  const [apiJson, setApiJson] = useState<string>("");     // 转换后的 API 格式（UI 自动转）
  const [remaps, setRemaps] = useState<Record<string, string>>({}); // `${nodeId}|${field}` → 新值
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [tplName, setTplName] = useState("");   // 另存为共享模板的名称
  const [tplSaved, setTplSaved] = useState(false);

  const applyRemaps = useCallback((json: string, rm: Record<string, string>): string => {
    if (Object.keys(rm).length === 0) return json;
    try {
      const wf = JSON.parse(json) as Record<string, { inputs?: Record<string, unknown> }>;
      for (const key of Object.keys(rm)) {
        const sep = key.indexOf("|");
        const nodeId = key.slice(0, sep), field = key.slice(sep + 1);
        if (wf[nodeId]?.inputs) wf[nodeId].inputs![field] = rm[key];
      }
      return JSON.stringify(wf);
    } catch { return json; }
  }, []);

  // 进入预检步骤：必要时 UI→API 转换，然后 validate。
  const enterValidate = useCallback(async () => {
    setStep("validate");
    setPreparing(true); setValidation(null); setRemaps({});
    try {
      let json = rawText;
      if (fmt === "ui") {
        const r = await convertMut.mutateAsync({ customBaseUrl: serverUrl.trim() || undefined, uiWorkflow: rawText });
        json = r.workflowJson;
        toast.success("已把 UI 工作流转换为可运行的 API 格式");
      }
      setApiJson(json);
      const v = await validateMut.mutateAsync({ customBaseUrl: serverUrl.trim() || undefined, workflowJson: json });
      setValidation(v);
    } catch (e) {
      toast.error("预检失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 160));
      setStep("server"); // 退回，让用户检查格式/服务器
    } finally { setPreparing(false); }
  }, [rawText, fmt, serverUrl, convertMut, validateMut]);

  // 改完重映射后重新预检（用修正后的 JSON）。
  const reValidate = useCallback(async () => {
    setPreparing(true);
    try {
      const corrected = applyRemaps(apiJson, remaps);
      const v = await validateMut.mutateAsync({ customBaseUrl: serverUrl.trim() || undefined, workflowJson: corrected });
      setValidation(v);
      if (v.ok) toast.success("预检通过，可以导入");
    } catch (e) {
      toast.error("重新预检失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 120));
    } finally { setPreparing(false); }
  }, [apiJson, remaps, serverUrl, validateMut, applyRemaps]);

  // 🪄 智能匹配：把每个「服务器上不存在的取值」自动映射到最相近的真实选项。只填未手动
  // 选过的项，已选的不动；命中即写入 remaps，用户再一眼复核即可，免去逐个手选。
  const smartMatchAll = useCallback(() => {
    if (!validation) return;
    let hit = 0;
    setRemaps((prev) => {
      const next = { ...prev };
      for (const iv of validation.invalidEnums) {
        const key = `${iv.nodeId}|${iv.field}`;
        if (next[key]) continue; // 已手动选过，不覆盖
        const sug = suggestBestMatch(iv.current ?? "", iv.options ?? []);
        if (sug) { next[key] = sug.value; hit++; }
      }
      return next;
    });
    if (hit > 0) toast.success(`已智能匹配 ${hit} 项，请复核后重新预检`);
    else toast.message("没有找到足够相近的选项，请手动选择");
  }, [validation]);

  // 另存为「共享节点模板库」：用修正后的工作流 + 分析结果建一个 comfyui_workflow 模板，
  // 全员（含智能体规划）可复用——把「导入→预检通过→沉淀」在向导内一处闭环。
  const saveAsTemplate = useCallback(async () => {
    const name = tplName.trim();
    if (!name) { toast.error("请先填模板名"); return; }
    setPreparing(true);
    try {
      const corrected = applyRemaps(apiJson, remaps);
      const analyze = await analyzeMut.mutateAsync({ customBaseUrl: serverUrl.trim() || undefined, workflowJson: corrected });
      await tplCreateMut.mutateAsync({
        label: name,
        nodeType: "comfyui_workflow",
        payload: {
          workflowJson: corrected,
          paramBindings: analyze.detectedParams,
          outputNodeIds: analyze.outputNodeIds,
          outputNodes: analyze.outputNodes,
          outputType: analyze.outputType === "mixed" ? "auto" : analyze.outputType,
          ...(serverUrl.trim() ? { customBaseUrl: serverUrl.trim() } : {}),
        },
        note: validation?.missingNodes.length ? `需先装节点：${validation.missingNodes.join(", ")}`.slice(0, 200) : undefined,
        useCloud: false,
      });
      setTplSaved(true);
      toast.success(`已存为共享模板「${name}」`);
    } catch (e) {
      toast.error("存模板失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140));
    } finally { setPreparing(false); }
  }, [tplName, apiJson, remaps, serverUrl, analyzeMut, tplCreateMut, validation, applyRemaps]);

  // 完成：用修正后的 JSON 分析参数，交回节点。
  const finish = useCallback(async () => {
    setPreparing(true);
    try {
      const corrected = applyRemaps(apiJson, remaps);
      const analyze = await analyzeMut.mutateAsync({ customBaseUrl: serverUrl.trim() || undefined, workflowJson: corrected });
      onComplete({ workflowJson: corrected, customBaseUrl: serverUrl.trim() || undefined, analyze });
    } catch (e) {
      toast.error("分析参数失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 160));
    } finally { setPreparing(false); }
  }, [apiJson, remaps, serverUrl, analyzeMut, onComplete, applyRemaps]);

  // ESC 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel]);

  const unresolvedInvalid = validation
    ? validation.invalidEnums.filter((iv) => !remaps[`${iv.nodeId}|${iv.field}`]).length
    : 0;
  // 导入按钮文案/配色：通过=绿；有遗留问题=黄（仍允许导入，缺节点需到服务器装后再运行）。
  const importHint = !validation
    ? ""
    : validation.ok
      ? "导入到节点"
      : validation.danglingLinks.length > 0
        ? "结构有悬空连线，仍导入"
        : !validation.objectInfoAvailable
          ? "未预检，仍导入"
          : validation.missingNodes.length > 0
            ? "仍导入（需先装缺失节点）"
            : unresolvedInvalid > 0
              ? `仍有 ${unresolvedInvalid} 项未修，仍导入`
              : "导入到节点";

  // 通过 portal 渲染到 body：节点处于 ReactFlow 的 transform 画布内，position:fixed 会被
  // 变换祖先「劫持」（相对缩放后的画布定位、随缩放放大），portal 到 body 才能真正铺满屏幕。
  return createPortal(
    <div className="nodrag nowheel nopan" style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(3px)" }}
      onMouseDown={onCancel}>
      <div className="animate-scale-in" style={{ width: 640, maxWidth: "94vw", maxHeight: "90vh", display: "flex", flexDirection: "column", background: "var(--c-base)", border: `1px solid ${A(0.4)}`, borderRadius: 16, boxShadow: "0 24px 80px oklch(0 0 0 / 0.5)", overflow: "hidden" }}
        onMouseDown={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${A(0.2)}`, background: A(0.07) }}>
          <Wand2 style={{ width: 16, height: 16, color: ACCENT }} />
          <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--c-t1)", flex: 1 }}>ComfyUI 工作流导入向导</span>
          <button onClick={onCancel} className="nodrag" style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", padding: 2 }}><X style={{ width: 16, height: 16 }} /></button>
        </div>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--c-bd1)" }}><StepBar current={step} /></div>

        {/* 内容 */}
        <div className="nowheel" style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {step === "load" && (
            <div className="flex flex-col gap-3"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}>
              <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6 }}>
                粘贴 ComfyUI 的 <b>API 格式</b> 工作流（菜单 “Save (API Format)” / “Export (API)”），或<b>拖入 / 选择</b> .json / ComfyUI 生成的 .png。
                UI 导出格式会在下一步自动转换。
              </p>
              <textarea rows={9} value={rawText} onChange={(e) => onPaste(e.target.value)} placeholder='粘贴 Workflow JSON，或把 .json / .png 文件拖到此处'
                style={{ ...boxStyle, borderColor: dragOver ? ACCENT : "var(--c-bd2)", background: dragOver ? A(0.07) : "var(--c-input)" }} />
              <div className="flex items-center gap-2">
                <button onClick={() => fileRef.current?.click()} disabled={importing} className="nodrag flex items-center gap-1.5 px-3 py-2 rounded-lg"
                  style={{ fontSize: 11.5, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} 选择文件（.json / .png）
                </button>
                <input ref={fileRef} type="file" accept=".json,.png,image/png,application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
                {parsed != null && (
                  <span className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 600, color: fmt === "unknown" ? "oklch(0.7 0.18 60)" : ACCENT }}>
                    <FileJson className="w-3.5 h-3.5" />
                    {fmt === "api" ? "已识别：API 格式" : fmt === "ui" ? "已识别：UI 格式（将自动转换）" : "格式无法识别"}
                    {fmt !== "unknown" && nodeCount > 0 && <span style={{ color: "var(--c-t4)", fontWeight: 500 }}>· {nodeCount} 个节点</span>}
                  </span>
                )}
              </div>
            </div>
          )}

          {step === "server" && (
            <>
              <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6 }}>
                选择要导入到的 ComfyUI 服务器——向导会用它的 <b>真实节点定义</b> 预检你的工作流（检查自定义节点是否安装、模型/采样器等是否存在）。留空使用默认服务器。
              </p>
              {/* 已有服务器下拉（节点保存 ∪ 本机注册 ∪ 管理员全局列表），选了即填入下方输入框 */}
              {serverOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 10.5, color: "var(--c-t4)", flexShrink: 0 }}>已有服务器</span>
                  <select
                    value={serverOptions.includes(serverUrl.trim()) ? serverUrl.trim() : ""}
                    onChange={(e) => { if (e.target.value) { setServerUrl(e.target.value); setTestResult(null); } }}
                    className="nodrag"
                    style={{ flex: 1, fontSize: 11.5, padding: "7px 9px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }}
                  >
                    <option value="">选择已保存的服务器…（{serverOptions.length} 个）</option>
                    {serverOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-2">
                <ServerCog className="w-4 h-4" style={{ color: "var(--c-t3)", flexShrink: 0 }} />
                <input value={serverUrl} onChange={(e) => { setServerUrl(e.target.value); setTestResult(null); }} placeholder="http://127.0.0.1:8188（留空=默认）"
                  style={{ ...boxStyle, fontFamily: "inherit", padding: "8px 11px" }} />
                <button onClick={testServer} disabled={testing} className="nodrag flex items-center gap-1.5 px-3 py-2 rounded-lg whitespace-nowrap"
                  style={{ fontSize: 11, fontWeight: 600, background: A(0.14), border: `1px solid ${A(0.4)}`, color: ACCENT, cursor: "pointer" }}>
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ServerCog className="w-3.5 h-3.5" />} 测试连接
                </button>
              </div>
              {testResult && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg" style={{ fontSize: 11, lineHeight: 1.5, background: testResult.ok ? "oklch(0.7 0.16 150 / 0.1)" : "oklch(0.62 0.2 25 / 0.1)", border: `1px solid ${testResult.ok ? "oklch(0.7 0.16 150 / 0.35)" : "oklch(0.62 0.2 25 / 0.35)"}`, color: testResult.ok ? "oklch(0.72 0.16 150)" : "oklch(0.64 0.2 25)" }}>
                  {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-px flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />}
                  <span>{testResult.msg}</span>
                </div>
              )}
              <p style={{ fontSize: 10, color: "var(--c-t4)", lineHeight: 1.5 }}>
                提示：未连接服务器也可继续，但无法预检——参数会降级为手填、运行时才发现问题。强烈建议先连上能跑这个工作流的服务器。
              </p>
            </>
          )}

          {step === "validate" && (
            <>
              {preparing && !validation ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3" style={{ color: "var(--c-t3)" }}>
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: ACCENT }} />
                  <span style={{ fontSize: 12 }}>正在用服务器节点定义预检工作流…</span>
                </div>
              ) : validation ? (
                <>
                  {/* 总判定。悬空连线是纯结构问题（不依赖 object_info、服务器离线也能查出），
                      运行必报「node not found」，故优先级最高，先于「服务器不可达」展示。 */}
                  {validation.danglingLinks.length > 0 ? (
                    <Banner tone="warn" icon={<ShieldAlert className="w-4 h-4" />} title="工作流结构有悬空连线（运行必报错）" text={`有 ${validation.danglingLinks.length} 条连线指向图中不存在的节点。多为复制/裁剪工作流时漏带了上游节点，请回 ComfyUI 重新完整导出（Save API Format）再导入。`} />
                  ) : !validation.objectInfoAvailable ? (
                    <Banner tone="warn" icon={<ShieldAlert className="w-4 h-4" />} title="未能预检（服务器不可达）" text="拿不到该服务器的 /object_info，无法核对节点与模型。可返回上一步检查地址，或冒险直接导入（运行时可能报错）。" />
                  ) : validation.ok ? (
                    <Banner tone="ok" icon={<ShieldCheck className="w-4 h-4" />} title="预检通过" text={`${validation.nodeCount} 个节点全部可识别，模型/采样器等取值均在服务器上存在。可以放心导入。`} />
                  ) : (
                    <Banner tone="warn" icon={<ShieldAlert className="w-4 h-4" />} title="预检发现问题（导入前请修正）" text={`缺节点 ${validation.missingNodes.length} · 取值非法 ${validation.invalidEnums.length}（待修 ${unresolvedInvalid}） · 必填缺失 ${validation.missingRequired.length}${validation.danglingLinks.length ? ` · 悬空连线 ${validation.danglingLinks.length}` : ""}`} />
                  )}

                  {/* 悬空连线明细 */}
                  {validation.danglingLinks.length > 0 && (
                    <Section icon={<PackageX className="w-3.5 h-3.5" style={{ color: "oklch(0.64 0.2 25)" }} />} title={`悬空连线（${validation.danglingLinks.length}）`}>
                      <div style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6 }}>
                        {validation.danglingLinks.slice(0, 12).map((d, i) => (
                          <div key={i}>· <b>{d.classType}</b>#{d.nodeId} 的 <code>{d.field}</code> 连到了不存在的节点 #{d.current}</div>
                        ))}
                        {validation.danglingLinks.length > 12 && <div>… 等 {validation.danglingLinks.length} 条</div>}
                      </div>
                    </Section>
                  )}

                  {/* 缺失的自定义节点 */}
                  {validation.missingNodes.length > 0 && (
                    <Section icon={<PackageX className="w-3.5 h-3.5" style={{ color: "oklch(0.64 0.2 25)" }} />} title={`服务器未安装的节点（${validation.missingNodes.length}）`}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                        <p style={{ fontSize: 10, color: "var(--c-t4)", flex: 1 }}>需先在目标 ComfyUI 安装（ComfyUI-Manager → Install Missing Custom Nodes / 运维中心「模型/节点」）。</p>
                        <button onClick={() => { void navigator.clipboard?.writeText(validation.missingNodes.join("\n")).then(() => toast.success("已复制节点名，可粘到 Manager 搜索")); }}
                          className="nodrag flex items-center gap-1 px-2 py-1 rounded-md flex-shrink-0" style={{ fontSize: 10, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
                          <Copy className="w-3 h-3" /> 复制全部
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {validation.missingNodes.map((n) => (
                          <span key={n} style={{ fontSize: 10.5, fontFamily: "ui-monospace, monospace", padding: "2px 7px", borderRadius: 6, background: "oklch(0.62 0.2 25 / 0.12)", border: "1px solid oklch(0.62 0.2 25 / 0.3)", color: "oklch(0.66 0.2 25)" }}>{n}</span>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* 非法枚举/模型 → 下拉重映射（含 🪄 智能匹配） */}
                  {validation.invalidEnums.length > 0 && (
                    <Section icon={<AlertTriangle className="w-3.5 h-3.5" style={{ color: "oklch(0.7 0.18 60)" }} />} title={`服务器上不存在的取值（${validation.invalidEnums.length}）— 选一个替换`}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
                        <p style={{ fontSize: 10, color: "var(--c-t4)" }}>多因路径前缀/大小写/版本后缀对不上。试试智能匹配，再复核。</p>
                        <button onClick={smartMatchAll} className="nodrag flex items-center gap-1 px-2.5 py-1 rounded-md flex-shrink-0"
                          style={{ fontSize: 10.5, fontWeight: 700, background: A(0.16), border: `1px solid ${A(0.45)}`, color: ACCENT, cursor: "pointer" }}>
                          <Sparkles className="w-3 h-3" /> 智能匹配全部
                        </button>
                      </div>
                      <div className="flex flex-col gap-2">
                        {validation.invalidEnums.map((iv) => {
                          const key = `${iv.nodeId}|${iv.field}`;
                          const picked = remaps[key] ?? "";
                          const sug = picked ? null : suggestBestMatch(iv.current ?? "", iv.options ?? []);
                          return (
                            <div key={key} className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: "var(--c-surface)", border: `1px solid ${picked ? "oklch(0.7 0.16 150 / 0.4)" : "var(--c-bd1)"}` }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t1)" }}>
                                  <span style={{ fontFamily: "ui-monospace, monospace" }}>{iv.classType}</span>
                                  <span style={{ color: "var(--c-t4)" }}> #{iv.nodeId} · {iv.field}</span>
                                </div>
                                <div style={{ fontSize: 10, color: "oklch(0.66 0.2 25)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={iv.current}>当前：{iv.current}（不存在）</div>
                                {sug && (
                                  <button onClick={() => setRemaps((m) => ({ ...m, [key]: sug.value }))} className="nodrag flex items-center gap-1" title={`用推荐：${sug.value}`}
                                    style={{ marginTop: 3, fontSize: 9.5, padding: "1px 6px", borderRadius: 5, background: A(0.12), border: `1px solid ${A(0.35)}`, color: ACCENT, cursor: "pointer", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    <Sparkles className="w-2.5 h-2.5 flex-shrink-0" /> 推荐 {sug.value}（{Math.round(sug.score * 100)}%）· 用此
                                  </button>
                                )}
                              </div>
                              <select value={picked} onChange={(e) => setRemaps((m) => ({ ...m, [key]: e.target.value }))}
                                className="nodrag" style={{ flexShrink: 0, maxWidth: 230, fontSize: 11, padding: "5px 7px", borderRadius: 7, background: "var(--c-input)", border: `1px solid ${picked ? "oklch(0.7 0.16 150 / 0.4)" : "var(--c-bd2)"}`, color: "var(--c-t1)", outline: "none" }}>
                                <option value="">选择服务器上的选项…</option>
                                {(iv.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}

                  {/* 必填缺失 */}
                  {validation.missingRequired.length > 0 && (
                    <Section icon={<AlertTriangle className="w-3.5 h-3.5" style={{ color: "oklch(0.7 0.18 60)" }} />} title={`必填输入缺失（${validation.missingRequired.length}）`}>
                      <p style={{ fontSize: 10, color: "var(--c-t4)", marginBottom: 6 }}>这些必填项既没连线也没值，导入后请在节点参数里补齐（或检查工作流是否完整）。</p>
                      <div className="flex flex-wrap gap-1.5">
                        {validation.missingRequired.map((m) => (
                          <span key={`${m.nodeId}|${m.field}`} style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", padding: "2px 7px", borderRadius: 6, background: "oklch(0.7 0.18 60 / 0.12)", border: "1px solid oklch(0.7 0.18 60 / 0.3)", color: "oklch(0.72 0.18 60)" }}>{m.classType}#{m.nodeId}.{m.field}</span>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* 重新预检 */}
                  {validation.objectInfoAvailable && !validation.ok && (
                    <button onClick={reValidate} disabled={preparing} className="nodrag flex items-center justify-center gap-1.5 py-2 rounded-lg"
                      style={{ fontSize: 11.5, fontWeight: 600, background: A(0.14), border: `1px solid ${A(0.4)}`, color: ACCENT, cursor: "pointer" }}>
                      {preparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} 应用修改并重新预检
                    </button>
                  )}

                  {/* 另存为共享模板（可选）：导入的同时沉淀到模板库，全员/智能体可复用 */}
                  <Section icon={<Save className="w-3.5 h-3.5" style={{ color: ACCENT }} />} title="另存为共享模板（可选）">
                    <p style={{ fontSize: 10, color: "var(--c-t4)", marginBottom: 6 }}>存进「ComfyUI 节点模板库（共享）」，全员可一键新建带参节点，智能体规划也能选用。</p>
                    <div className="flex items-center gap-2">
                      <input value={tplName} onChange={(e) => { setTplName(e.target.value); setTplSaved(false); }} placeholder="模板名，如：Flux 文生图（已校验）"
                        className="nodrag" style={{ flex: 1, fontSize: 11.5, padding: "7px 9px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
                      <button onClick={saveAsTemplate} disabled={preparing || !tplName.trim() || tplSaved}
                        className="nodrag flex items-center gap-1.5 px-3 py-2 rounded-lg whitespace-nowrap"
                        style={{ fontSize: 11, fontWeight: 600, cursor: preparing || tplSaved ? "default" : "pointer",
                          background: tplSaved ? "oklch(0.7 0.16 150 / 0.16)" : A(0.14), border: `1px solid ${tplSaved ? "oklch(0.7 0.16 150 / 0.4)" : A(0.4)}`, color: tplSaved ? "oklch(0.72 0.16 150)" : ACCENT }}>
                        {preparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : tplSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                        {tplSaved ? "已保存" : "存为模板"}
                      </button>
                    </div>
                  </Section>
                </>
              ) : null}
            </>
          )}
        </div>

        {/* 底部导航 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--c-bd1)", background: "var(--c-surface)" }}>
          {step !== "load" && (
            <button onClick={() => setStep(step === "validate" ? "server" : "load")} disabled={preparing} className="nodrag flex items-center gap-1 px-3 py-2 rounded-lg"
              style={{ fontSize: 11.5, fontWeight: 600, background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
              <ChevronLeft className="w-3.5 h-3.5" /> 上一步
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step === "load" && (
            <NavNext disabled={!parsed || fmt === "unknown"} onClick={() => setStep("server")} label="下一步：选服务器" />
          )}
          {step === "server" && (
            <NavNext disabled={false} onClick={enterValidate} label="下一步：预检工作流" />
          )}
          {step === "validate" && validation && (
            <button onClick={finish} disabled={preparing}
              className="nodrag flex items-center gap-1.5 px-4 py-2 rounded-lg"
              title={validation.missingNodes.length > 0 ? "可先导入；运行前需在该服务器安装缺失的自定义节点" : undefined}
              style={{ fontSize: 12, fontWeight: 700, cursor: preparing ? "not-allowed" : "pointer",
                background: validation.ok ? "oklch(0.7 0.16 150)" : A(0.2),
                border: `1px solid ${validation.ok ? "oklch(0.7 0.16 150 / 0.5)" : A(0.5)}`,
                color: validation.ok ? "#06250f" : ACCENT }}>
              {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {importHint}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function NavNext({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className="nodrag flex items-center gap-1.5 px-4 py-2 rounded-lg"
      style={{ fontSize: 12, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", background: disabled ? "var(--c-bd1)" : A(0.2), border: `1px solid ${disabled ? "var(--c-bd2)" : A(0.5)}`, color: disabled ? "var(--c-t4)" : ACCENT }}>
      {label} <ChevronRight className="w-3.5 h-3.5" />
    </button>
  );
}

function Banner({ tone, icon, title, text }: { tone: "ok" | "warn"; icon: React.ReactNode; title: string; text: string }) {
  const c = tone === "ok" ? "oklch(0.7 0.16 150)" : "oklch(0.7 0.18 60)";
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: `${c.replace(")", " / 0.1)")}`, border: `1px solid ${c.replace(")", " / 0.35)")}` }}>
      <span style={{ color: c, marginTop: 1, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{title}</div>
        <div style={{ fontSize: 10.5, color: "var(--c-t3)", lineHeight: 1.5, marginTop: 2 }}>{text}</div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: "1px solid var(--c-bd1)", paddingTop: 10 }}>
      <div className="flex items-center gap-1.5" style={{ marginBottom: 7 }}>
        {icon}<span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t1)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
