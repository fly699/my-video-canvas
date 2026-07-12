// 桥接「临时工作区」：让本机 Claude 桥接能把生成文件写进一个【范围锁死】的临时文件夹，
// 调用结束后由服务端收集 → 上传存储 → 以链接形式附回聊天回复 → 目录即焚。
//
// 安全设计（不动 claudeBridge 的 Write/Edit/Bash 危险清单护栏）：
//   1. 写权限只经由 filesystem MCP 服务器授予，其根目录 = 本次调用专属子目录
//      （@modelcontextprotocol/server-filesystem 在服务器进程侧强制目录白名单，越界即拒）；
//   2. 每次调用独立 ws-* 子目录：并发调用互不可见、收集范围精确、无跨会话残留；
//   3. 收集时 lstat 跳过符号链接（防把工作区外的文件“链”进来偷渡上传）、层深/数量/单文件/
//      总量四重限额、扩展名白名单（无 svg/html/可执行——防存储侧被动 XSS 与投毒下载）；
//   4. 清理带双重守卫：目标必须位于工作区根内且目录名以 ws- 开头，否则拒删；
//   5. 默认关闭：管理后台「桥接 MCP 配置」显式开启才生效，关闭时桥接行为与现在完全一致。
import { mkdirSync, rmSync, readdirSync, lstatSync, readdirSync as _rd } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename, extname } from "node:path";

// ── 限额（collectWorkspaceFiles 可注入覆盖，便于单测；生产用默认值） ──────────────
export const WS_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,   // 单文件 20MB
  maxTotalBytes: 100 * 1024 * 1024, // 单次调用总量 100MB
  maxFiles: 12,                     // 单次调用最多回传 12 个文件
  maxDepth: 3,                      // 目录层深上限
} as const;

/** 扩展名白名单 → Content-Type。刻意排除 svg/js/可执行等（存储直出场景防被动 XSS / 投毒）；
 *  html/htm 特例放行但降为 text/plain 交付（见下方注释）。 */
export const WS_CONTENT_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", json: "application/json",
  // HTML 放行但以纯文本 Content-Type 回传：存储与应用同源直出，若按 text/html 服务，
  // 模型产出的 <script> 会以站点身份执行（存储型 XSS）。text/plain 下浏览器只显示源码，
  // 用户下载后本地打开即是完整网页——交付能力保留、同源执行风险归零。
  html: "text/plain; charset=utf-8", htm: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8", srt: "text/plain; charset=utf-8", vtt: "text/vtt; charset=utf-8",
  pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav",
  mp4: "video/mp4", webm: "video/webm",
};

/** 工作区根目录（env 可覆盖；默认放系统临时目录下的专用文件夹）。 */
export function bridgeWorkspaceRoot(): string {
  const v = process.env.BRIDGE_WORKSPACE_DIR?.trim();
  return v || join(tmpdir(), "avc-bridge-workspace");
}

let _seq = 0;
/** 为本次桥接调用创建独立子目录（ws-<时间>-<序号><随机>），返回绝对路径。 */
export function createCallWorkspace(): string {
  const root = bridgeWorkspaceRoot();
  mkdirSync(root, { recursive: true });
  _seq = (_seq + 1) % 10000;
  const dir = join(root, `ws-${Date.now()}-${_seq}${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(dir);
  return dir;
}

/** 清理本次调用的工作区。双重守卫：必须在根内、目录名以 ws- 开头——否则拒删（防路径混入）。 */
export function cleanupCallWorkspace(dir: string): boolean {
  const root = resolve(bridgeWorkspaceRoot());
  const abs = resolve(dir);
  if (!abs.startsWith(root + "/") && abs !== root + "/" + basename(abs)) return false;
  if (!basename(abs).startsWith("ws-")) return false;
  try { rmSync(abs, { recursive: true, force: true }); return true; } catch { return false; }
}

/** 启动清扫：删除上次进程遗留的、超过 24h 的 ws-* 目录（正常路径调用后即焚，这里只兜异常退出）。 */
export function sweepStaleWorkspaces(maxAgeMs = 24 * 3600_000): number {
  const root = bridgeWorkspaceRoot();
  let n = 0;
  try {
    for (const name of readdirSync(root)) {
      if (!name.startsWith("ws-")) continue;
      const ts = Number(/^ws-(\d+)-/.exec(name)?.[1] ?? NaN);
      if (Number.isFinite(ts) && Date.now() - ts > maxAgeMs) {
        if (cleanupCallWorkspace(join(root, name))) n++;
      }
    }
  } catch { /* 根目录不存在 = 无事可扫 */ }
  return n;
}

// ── MCP 配置合并 ────────────────────────────────────────────────────────────────
export const WS_MCP_SERVER_NAME = "avc_ws";

/** 把工作区 filesystem MCP 合并进管理员的内联 MCP JSON（或空配置）。纯函数。
 *  - adminInline 为空/非法 → 只含工作区服务器的配置；
 *  - 管理员已占用同名服务器 → 不覆盖（管理员配置优先），injected=false。
 *  filesystem 服务器命令可用 env BRIDGE_FS_MCP_CMD 覆盖（默认 npx -y @modelcontextprotocol/server-filesystem）。 */
export function mergeWorkspaceMcp(adminInline: string, dir: string): { json: string; serverNames: string[]; injected: boolean } {
  let base: { mcpServers?: Record<string, unknown> } = {};
  if (adminInline.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(adminInline) as { mcpServers?: Record<string, unknown> };
      if (parsed && typeof parsed === "object") base = parsed;
    } catch { /* 非法 → 当空配置 */ }
  }
  const servers: Record<string, unknown> = { ...(base.mcpServers && typeof base.mcpServers === "object" ? base.mcpServers : {}) };
  let injected = false;
  if (!(WS_MCP_SERVER_NAME in servers)) {
    const custom = process.env.BRIDGE_FS_MCP_CMD?.trim();
    const [cmd, ...preArgs] = custom ? custom.split(/\s+/) : ["npx", "-y", "@modelcontextprotocol/server-filesystem"];
    servers[WS_MCP_SERVER_NAME] = { command: cmd, args: [...preArgs, dir] };
    injected = true;
  }
  return { json: JSON.stringify({ ...base, mcpServers: servers }), serverNames: Object.keys(servers), injected };
}

/** 附进提示词的工作区说明（告诉模型唯一可写位置与交付方式）。 */
export function workspacePromptHint(dir: string): string {
  return `【文件工作区】如需交付生成的文件（图片/文本/字幕/数据等），用 ${WS_MCP_SERVER_NAME} 工具把文件写入目录 ${dir}（这是你唯一可写的位置，其它路径均被拒绝）。写入后在回复中说明每个文件的名字和用途即可——系统会自动把这些文件上传并以下载链接附在你的回复后面，请不要自行编造链接。`;
}

// ── 调用后收集 ─────────────────────────────────────────────────────────────────
export interface CollectedFile { name: string; path: string; size: number; contentType: string }
export interface CollectResult { files: CollectedFile[]; skipped: { name: string; reason: string }[] }

/** 递归收集工作区文件：白名单扩展名 + 四重限额 + lstat 跳过符号链接。 */
export function collectWorkspaceFiles(dir: string, limits: typeof WS_LIMITS = WS_LIMITS): CollectResult {
  const files: CollectedFile[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let total = 0;
  const walk = (d: string, depth: number, prefix: string) => {
    let names: string[];
    try { names = _rd(d); } catch { return; }
    for (const name of names) {
      const p = join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) { skipped.push({ name: rel, reason: "符号链接不收集" }); continue; }
      if (st.isDirectory()) {
        if (depth >= limits.maxDepth) { skipped.push({ name: rel, reason: `超出层深上限(${limits.maxDepth})` }); continue; }
        walk(p, depth + 1, rel);
        continue;
      }
      if (!st.isFile()) continue;
      const ext = extname(name).slice(1).toLowerCase();
      const ct = WS_CONTENT_TYPES[ext];
      if (!ct) { skipped.push({ name: rel, reason: `类型 .${ext || "?"} 不在白名单` }); continue; }
      if (st.size > limits.maxFileBytes) { skipped.push({ name: rel, reason: `超过单文件上限 ${Math.round(limits.maxFileBytes / 1048576)}MB` }); continue; }
      if (files.length >= limits.maxFiles) { skipped.push({ name: rel, reason: `超过数量上限 ${limits.maxFiles}` }); continue; }
      if (total + st.size > limits.maxTotalBytes) { skipped.push({ name: rel, reason: `超过总量上限 ${Math.round(limits.maxTotalBytes / 1048576)}MB` }); continue; }
      total += st.size;
      files.push({ name: rel, path: p, size: st.size, contentType: ct });
    }
  };
  walk(dir, 0, "");
  return { files, skipped };
}

/** 存储 key 用的安全文件名（保留扩展名，其余非常规字符归一）。 */
export function safeStorageName(name: string): string {
  const base = basename(name);
  return base.replace(/[^A-Za-z0-9._一-龥-]/g, "_").slice(0, 120) || "file";
}

/** 把上传结果格式化成附在回复末尾的 Markdown 段落。无文件时返回空串。 */
export function formatFilesReply(uploaded: { name: string; url: string }[], skipped: { name: string; reason: string }[]): string {
  if (!uploaded.length && !skipped.length) return "";
  const lines: string[] = ["", "---", "📎 本次生成的文件："];
  for (const f of uploaded) lines.push(`- [${f.name}](${f.url})`);
  for (const s of skipped) lines.push(`- ⚠️ 未收集 ${s.name}（${s.reason}）`);
  if (!uploaded.length) lines[2] = "📎 生成文件收集结果：";
  return lines.join("\n");
}
