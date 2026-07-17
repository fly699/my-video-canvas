/**
 * 本地 / 自托管 Gradio TTS 接入（VoxCPM2 等）。
 *
 * 适配 Gradio 4/5 的「命名端点」HTTP 协议（与官方 gradio_client 同协议）：
 *   1) POST {base}/upload            —— 上传参考音频(ref_wav)，返回服务器文件路径
 *   2) POST {base}/call/{api}        —— 提交一次调用，返回 { event_id }
 *   3) GET  {base}/call/{api}/{id}   —— SSE 流，读到 event: complete 拿到输出
 * Gradio 5 把上述路由放在 `/gradio_api` 前缀下，Gradio 4 无前缀；首个请求 404
 * 时自动在两种前缀间回退。
 *
 * 由于本地 Gradio 返回的文件 URL 多指向其自身（localhost/局域网），浏览器画布
 * 通常无法直接访问，故这里强制把产物下载下来重新落盘到对象存储，返回稳定 URL
 * （与 openaiTTS.ts 的「强制持久化」同理）。整个调用由后端发起，因此部署后端
 * 的机器必须能访问到该 Gradio 地址。
 */
import { storagePut, storageFetchStream } from "../storage";

export interface SynthesizeGradioTTSOptions {
  baseUrl: string;                 // 例如 http://172.16.0.177:8808
  text: string;                    // 要合成的文本
  refWavUrl: string;               // 参考音频（决定克隆音色），必填
  controlInstruction?: string;     // 可选的音色/风格控制指令
  usePromptText?: boolean;         // 是否使用参考文本
  promptTextValue?: string;        // 参考文本内容
  cfgValue?: number;               // CFG，默认 2
  doNormalize?: boolean;           // 文本规范化
  denoise?: boolean;               // 参考音频降噪
  ditSteps?: number;               // 扩散步数，默认 10
  apiName?: string;                // 端点名，默认 "generate"
}

export interface GradioTTSResult {
  url: string;
  duration?: number;
}

export function normalizeBase(u: string): string {
  let s = (u ?? "").trim().replace(/\/+$/, "");
  if (!s) throw new Error("Gradio 服务地址为空");
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  return s;
}

/** 把 Node 的笼统 "fetch failed" 翻译成可定位根因的中文报错（含底层 code）。 */
export function describeFetchError(err: unknown, what: string, url: string): never {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code;
  const causeMsg = e?.cause?.message ?? e?.message ?? String(err);
  let hint: string;
  if (e?.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
    hint = "连接超时：后端与该地址网络不通（多为不在同一局域网或被防火墙拦截）";
  } else if (code === "ECONNREFUSED") {
    hint = "连接被拒绝：目标端口未在监听。常见原因是 Gradio 仅绑定了 127.0.0.1——请用 server_name=\"0.0.0.0\" 启动，并确认端口与防火墙";
  } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    hint = "域名/主机解析失败：地址写错或 DNS 不可达";
  } else if (code === "ECONNRESET") {
    hint = "连接被重置：可能是 https/http 协议不匹配或反代异常";
  } else {
    hint = "连接失败";
  }
  throw new Error(
    `${what}失败（${hint}${code ? `，${code}` : ""}）。注意：是「部署后端的服务器」去访问该地址、不是浏览器，请确认后端所在机器能访问 ${url}。底层信息：${causeMsg}`,
  );
}

/** 带诊断的 fetch：连接级失败时抛出可定位根因的中文报错。 */
async function gfetch(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    describeFetchError(e, what, url);
  }
}

/** 读取参考音频字节：本地 /manus-storage/ 走存储读取，绝对 URL 直接 fetch。 */
async function fetchRefBytes(urlOrPath: string): Promise<{ buf: Buffer; mime: string; name: string }> {
  if (urlOrPath.startsWith("/manus-storage/")) {
    const key = urlOrPath.slice("/manus-storage/".length);
    const { body, contentType } = await storageFetchStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    const ext = (contentType ?? "").includes("mpeg") || (contentType ?? "").includes("mp3") ? "mp3" : "wav";
    return { buf, mime: contentType ?? "audio/wav", name: `ref.${ext}` };
  }
  const res = await gfetch(urlOrPath, { signal: AbortSignal.timeout(30_000) }, "读取参考音频");
  if (!res.ok) throw new Error(`读取参考音频失败 (${res.status})：${urlOrPath.slice(0, 120)}`);
  const mime = res.headers.get("content-type") ?? "audio/wav";
  const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "wav";
  return { buf: Buffer.from(await res.arrayBuffer()), mime, name: `ref.${ext}` };
}

/** 上传参考音频到 Gradio，返回 { path, prefix }（prefix 供后续 call/GET 复用）。 */
async function uploadRef(
  base: string,
  ref: { buf: Buffer; mime: string; name: string },
): Promise<{ path: string; prefix: string }> {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(ref.buf)], { type: ref.mime }), ref.name);
  for (const prefix of ["/gradio_api", ""]) {
    const res = await gfetch(`${base}${prefix}/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    }, "连接 Gradio 服务（上传参考音频）");
    if (res.status === 404) continue; // 换前缀重试
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Gradio 上传参考音频失败 (${res.status})：${t.slice(0, 200)}`);
    }
    const arr = (await res.json()) as unknown;
    const first = Array.isArray(arr) ? arr[0] : undefined;
    const path = typeof first === "string"
      ? first
      : (first && typeof first === "object"
          ? ((first as Record<string, unknown>).path as string | undefined) ?? ((first as Record<string, unknown>).name as string | undefined)
          : undefined);
    if (!path) throw new Error(`Gradio 上传响应异常，未返回文件路径：${JSON.stringify(arr).slice(0, 200)}`);
    return { path, prefix };
  }
  throw new Error("Gradio 上传端点不存在（/upload 与 /gradio_api/upload 均 404）——请确认地址与 Gradio 版本");
}

/**
 * 提交调用，返回 { event_id, prefix }。无参考音频时不经过 upload 步骤，故这里
 * 自己做 /gradio_api 与无前缀的回退；有参考音频时传 preferredPrefix（上传已探明）
 * 优先尝试，回退仍兜底。
 */
async function submitCall(
  base: string,
  apiName: string,
  data: unknown[],
  preferredPrefix?: string,
): Promise<{ eventId: string; prefix: string }> {
  const order = preferredPrefix !== undefined
    ? [preferredPrefix, preferredPrefix === "/gradio_api" ? "" : "/gradio_api"]
    : ["/gradio_api", ""];
  const prefixes = order.filter((p, i) => order.indexOf(p) === i); // 去重，保序
  for (const prefix of prefixes) {
    const res = await gfetch(`${base}${prefix}/call/${apiName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(20_000),
    }, "提交 Gradio 调用");
    if (res.status === 404) continue; // 换前缀重试
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Gradio 提交失败 (${res.status})：${t.slice(0, 300)}`);
    }
    const j = (await res.json()) as { event_id?: string };
    if (!j.event_id) throw new Error(`Gradio 提交未返回 event_id：${JSON.stringify(j).slice(0, 200)}`);
    return { eventId: j.event_id, prefix };
  }
  throw new Error(`Gradio 端点 "/${apiName}" 不存在（/call 与 /gradio_api/call 均 404）——请确认地址与 Gradio 版本`);
}

/** 读取 SSE 结果流，返回 complete 事件里的输出数组。 */
async function readSseResult(base: string, prefix: string, apiName: string, eventId: string): Promise<unknown> {
  const res = await gfetch(`${base}${prefix}/call/${apiName}/${eventId}`, {
    headers: { Accept: "text/event-stream" },
    signal: AbortSignal.timeout(300_000), // 长合成最多等 5 分钟
  }, "读取 Gradio 结果流");
  if (!res.ok || !res.body) throw new Error(`Gradio 结果流获取失败 (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // 保留可能不完整的末行
      for (const raw of lines) {
        const line = raw.replace(/\r$/, "");
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (currentEvent === "complete") {
            try { return JSON.parse(payload); } catch { return payload; }
          }
          if (currentEvent === "error") {
            throw new Error(formatGradioError(payload));
          }
          // generating / heartbeat 等中间事件忽略
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  throw new Error("Gradio 结果流结束但未收到 complete 事件");
}

/**
 * 把 Gradio `error` 事件的 data 整理成可读中文报错：优先取 JSON 里的 `error`
 * 字段，并针对「HuggingFace Hub 拉取模型失败（机器无外网/未缓存）」这类服务端
 * 模型加载问题附上可操作提示——这属于 Gradio 服务自身的部署问题，非本应用。
 */
export function formatGradioError(payload: string): string {
  let msg = payload;
  try {
    const j = JSON.parse(payload) as { error?: unknown };
    if (j && typeof j === "object" && typeof j.error === "string") msg = j.error;
  } catch { /* 非 JSON，保留原文 */ }
  const lower = msg.toLowerCase();
  const isHfModelLoad =
    (lower.includes("hub") || lower.includes("local cache") || lower.includes("huggingface")) &&
    (lower.includes("cache") || lower.includes("connection") || lower.includes("internet") || lower.includes("locate"));
  const isArgCountMismatch = lower.includes("didn't receive enough input values") || lower.includes("did not receive enough input");
  const hint = isHfModelLoad
    ? "（这是 VoxCPM/Gradio 服务自身从 HuggingFace 拉取模型失败：请让该机器能访问 huggingface.co，或预先把模型缓存到本地；国内可设镜像 HF_ENDPOINT=https://hf-mirror.com 后重启服务）"
    : isArgCountMismatch
      ? "（该 Gradio 服务的 generate 接口参数数量与常见版本不同，且其 /info 接口不可用、无法自动适配——请确认服务正常暴露 /gradio_api/info，或反馈该 VoxCPM 版本号以便适配）"
      : "";
  return `Gradio 生成出错：${msg.slice(0, 400)}${hint}`;
}

// ── VoxCPM2 兼容：按服务端 /info 的参数表自适应组装入参（#212）─────────────────
// 新版 VoxCPM 给 /generate 增了参数（needed: 10, got: 9），版本还会继续变。
// 与其硬编每个版本的参数顺序，不如调用前拉取 Gradio 自己的接口描述
// （GET {base}{prefix}/info → named_endpoints["/generate"].parameters），按
// parameter_name/label/组件类型把我们已有的值归位，认不出的新参数用它声明的
// parameter_default。仅在参数数 ≠ 9 时启用（=9 的既有部署保持原固定顺序零回归）。

export interface GradioParamInfo {
  label?: string;
  parameter_name?: string;
  parameter_has_default?: boolean;
  parameter_default?: unknown;
  component?: string;
  python_type?: { type?: string };
}

export interface GradioDataValues {
  text: string;
  controlInstruction: string;
  refData: unknown;
  usePromptText: boolean;
  promptTextValue: string;
  cfgValue: number;
  doNormalize: boolean;
  denoise: boolean;
  ditSteps: number;
}

/** 拉取端点参数表；/info 不可用或无该端点 → null（调用方走旧固定顺序）。 */
async function fetchEndpointParams(base: string, apiName: string, preferredPrefix?: string): Promise<GradioParamInfo[] | null> {
  const order = preferredPrefix !== undefined
    ? [preferredPrefix, preferredPrefix === "/gradio_api" ? "" : "/gradio_api"]
    : ["/gradio_api", ""];
  for (const prefix of order.filter((p, i) => order.indexOf(p) === i)) {
    try {
      const res = await fetch(`${base}${prefix}/info`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { named_endpoints?: Record<string, { parameters?: GradioParamInfo[] }> };
      const ep = j.named_endpoints?.[`/${apiName}`] ?? j.named_endpoints?.[apiName];
      if (ep && Array.isArray(ep.parameters) && ep.parameters.length > 0) return ep.parameters;
    } catch { /* info 拉取失败 → 保持旧行为 */ }
  }
  return null;
}

/**
 * 按参数表组装 data。归位规则（parameter_name 与 label 合并小写匹配）：
 * Audio 组件 → 参考音频；bool → normalize/denoise/prompt 关键词归位，未知取默认；
 * 数值 → cfg/step 关键词归位，未知取默认；文本 → prompt 文本 / control 指令 /
 * 首个未占用的目标文本。无法给目标文本找到落点时返回 null（调用方回退旧顺序）。
 */
export function buildGradioDataFromSchema(params: GradioParamInfo[], vals: GradioDataValues): unknown[] | null {
  let textAssigned = false;
  const data = params.map((p) => {
    const n = `${p.parameter_name ?? ""} ${p.label ?? ""}`.toLowerCase();
    const comp = (p.component ?? "").toLowerCase();
    const pyType = p.python_type?.type ?? "";
    if (comp.includes("audio") || n.includes("wav") || (n.includes("audio") && !comp.includes("text"))) return vals.refData;
    if (comp.includes("checkbox") || pyType === "bool" || typeof p.parameter_default === "boolean") {
      if (n.includes("normal")) return vals.doNormalize;
      if (n.includes("denoi")) return vals.denoise;
      if (n.includes("prompt")) return vals.usePromptText;
      return p.parameter_has_default ? p.parameter_default : false;
    }
    if (comp.includes("slider") || comp.includes("number") || pyType === "float" || pyType === "int" || typeof p.parameter_default === "number") {
      if (n.includes("cfg") || n.includes("guidance")) return vals.cfgValue;
      if (n.includes("step") || n.includes("timestep")) return vals.ditSteps;
      return p.parameter_has_default ? p.parameter_default : 0;
    }
    // 文本类：先 prompt 参考文本，再控制/风格指令，再首个未占用的目标文本。
    if (n.includes("prompt")) return vals.promptTextValue;
    if (n.includes("control") || n.includes("instruct") || n.includes("style") || n.includes("指令")) return vals.controlInstruction;
    if (!textAssigned) { textAssigned = true; return vals.text; }
    return p.parameter_has_default ? p.parameter_default : "";
  });
  if (!textAssigned) return null; // 目标文本没有落点 → 让调用方回退旧固定顺序，别发一个没文本的请求
  return data;
}

/** 从 complete 输出里解析音频文件的可访问 URL。 */
export function resolveAudioUrl(base: string, prefix: string, result: unknown): { url: string; duration?: number } {
  const out = Array.isArray(result) ? result[0] : result;
  let fileUrl: string | undefined;
  let path: string | undefined;
  let duration: number | undefined;
  if (typeof out === "string") {
    fileUrl = out;
  } else if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    if (typeof o.url === "string") fileUrl = o.url;
    if (typeof o.path === "string") path = o.path;
    if (typeof o.duration === "number") duration = o.duration;
  }
  if (!fileUrl && path) fileUrl = `${base}${prefix}/file=${path}`;
  if (!fileUrl) throw new Error("Gradio 生成完成但未返回音频文件");
  if (fileUrl.startsWith("/")) fileUrl = `${base}${fileUrl}`;          // 相对路径补全
  else if (!/^https?:\/\//i.test(fileUrl)) fileUrl = `${base}/${fileUrl}`;
  return { url: fileUrl, duration };
}

export async function synthesizeGradioTTS(opts: SynthesizeGradioTTSOptions): Promise<GradioTTSResult> {
  const base = normalizeBase(opts.baseUrl);
  if (!opts.text?.trim()) throw new Error("配音文本为空");
  const apiName = opts.apiName?.trim() || "generate";

  // 1) 参考音频可选：有就取字节上传、用作克隆音色；没有则传 null，由模型自带/随机音色生成。
  let refData: unknown = null;
  let preferredPrefix: string | undefined;
  if (opts.refWavUrl?.trim()) {
    const ref = await fetchRefBytes(opts.refWavUrl);
    const up = await uploadRef(base, ref);
    refData = { path: up.path, meta: { _type: "gradio.FileData" } };
    preferredPrefix = up.prefix;
  }

  // 2) 构造 data 数组。默认按经典 VoxCPM 9 参固定顺序（与既有部署逐字一致，零回归）；
  //    仅当服务端 /info 显示该端点参数数 ≠ 9（如 VoxCPM2 的 10 参 _generate）时，
  //    改按其参数表自适应组装（#212，否则报 "didn't receive enough input values"）。
  const vals: GradioDataValues = {
    text: opts.text,
    controlInstruction: opts.controlInstruction ?? "",
    refData,
    usePromptText: opts.usePromptText ?? false,
    promptTextValue: opts.promptTextValue ?? "",
    cfgValue: opts.cfgValue ?? 2,
    doNormalize: opts.doNormalize ?? false,
    denoise: opts.denoise ?? false,
    ditSteps: opts.ditSteps ?? 10,
  };
  const legacyData: unknown[] = [
    vals.text, vals.controlInstruction, vals.refData, vals.usePromptText, vals.promptTextValue,
    vals.cfgValue, vals.doNormalize, vals.denoise, vals.ditSteps,
  ];
  let data = legacyData;
  const schemaParams = await fetchEndpointParams(base, apiName, preferredPrefix);
  if (schemaParams && schemaParams.length !== legacyData.length) {
    const adaptive = buildGradioDataFromSchema(schemaParams, vals);
    if (adaptive) data = adaptive;
  }
  const { eventId, prefix } = await submitCall(base, apiName, data, preferredPrefix);

  // 3) 读 SSE 结果并解析音频 URL
  const result = await readSseResult(base, prefix, apiName, eventId);
  const { url: gradioUrl, duration } = resolveAudioUrl(base, prefix, result);

  // 4) 强制下载并重新落盘到对象存储（本地 Gradio URL 浏览器多不可达）
  const audioRes = await gfetch(gradioUrl, { signal: AbortSignal.timeout(120_000) }, "下载 Gradio 生成音频");
  if (!audioRes.ok) throw new Error(`下载 Gradio 生成音频失败 (${audioRes.status})`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  const ct = audioRes.headers.get("content-type") ?? "audio/wav";
  const isMp3 = ct.includes("mpeg") || ct.includes("mp3") || gradioUrl.toLowerCase().endsWith(".mp3");
  const ext = isMp3 ? "mp3" : "wav";
  const mime = isMp3 ? "audio/mpeg" : "audio/wav";
  const { url } = await storagePut(`generated/voxcpm-${Date.now()}.${ext}`, buf, mime);
  return { url, duration };
}
