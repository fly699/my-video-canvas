// 部署「配置体检」：把散落在 .env / 数据库 / CLI·凭证文件 三处的全部部署配置汇总成
// 一张逐项清单（已配 / 缺失 / 风险 / 未启用），供管理后台一键核对——新部署照单补齐，
// 免得踩「桥接 Key 不一致 401」「ANTHROPIC_API_KEY 顶掉订阅」「ffmpeg 没装导出全挂」
// 这类真机翻过的坑。只回传布尔状态与说明文案，绝不回传任何密钥值。
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV } from "./env";
import * as db from "../db";
import { resolveClaudeBin, resolveClaudeSpawn } from "./superAgent/claudeProcess";
import { getSuperAgentConfig } from "./superAgent/config";
import { resolveCodexBin, resolveCodexSpawn } from "./codexBridge";
import { mcpServerNames } from "./claudeBridge";

export type CheckStatus = "ok" | "warn" | "missing" | "off";
export interface CheckItem {
  id: string;
  group: string;
  label: string;
  status: CheckStatus;
  /** 现状说明（给人看的中文一句话）。 */
  detail: string;
  /** 怎么修（.env 变量名 / 后台页签 / 命令）。仅 warn/missing 需要。 */
  fix?: string;
}

/** 体检输入快照：纯数据，便于单测覆盖各种组合。绝不含密钥明文。 */
export interface ChecklistInput {
  isProduction: boolean;
  devBypass: boolean;
  jwtSecretSet: boolean;
  databaseUrlSet: boolean;
  oauthUrlSet: boolean;
  ownerEmailFromEnv: boolean;
  ownerEmail: string;
  s3: { endpoint: boolean; bucket: boolean; accessKey: boolean; secretKey: boolean; publicEndpoint: boolean };
  forgeConfigured: boolean;
  keys: {
    kie: boolean; kieSecret: boolean; poyo: boolean; openai: boolean; anthropic: boolean;
    higgsKey: boolean; higgsSecret: boolean; comfyBase: boolean; comfyCloudKey: boolean;
    sshSecret: boolean; googleId: boolean; googleSecret: boolean;
  };
  bridge: { keySet: boolean; keyValue: string; claudeTokenSet: boolean; codexApiKeySet: boolean;
    skillsOn: boolean; mcpConfigRaw: string; mcpConfigOk: boolean; mcpServerNames: string[] };
  superAgent: { enabled: boolean; allowBash: boolean; permissionCmdSet: boolean; autoInstall: boolean };
  probes: { ffmpeg: boolean; claudeCli: boolean; codexCli: boolean; codexAuthJson: boolean };
  dbConf: {
    smtpHostSet: boolean; emailVerificationEnabled: boolean;
    tunnelEnabled: boolean; tunnelTokenSet: boolean; tunnelPreferQuick: boolean;
    selfHosted: { url: string; apiKey: string; modelIds: string[] };
  };
}

/** 纯函数：快照 → 体检清单。 */
export function evaluateChecklist(s: ChecklistInput): CheckItem[] {
  const items: CheckItem[] = [];
  const add = (i: CheckItem) => items.push(i);

  // ── 核心 ──
  if (s.devBypass) {
    add({ id: "core.mode", group: "核心", label: "运行模式", status: "warn", detail: "开发内存模式（NODE_ENV≠production 且未设 DATABASE_URL/OAUTH_SERVER_URL），数据不落库、重启即丢", fix: "生产部署请在 .env 设 NODE_ENV=production 与 DATABASE_URL" });
  } else if (!s.isProduction) {
    add({ id: "core.mode", group: "核心", label: "运行模式", status: "warn", detail: "NODE_ENV 不是 production", fix: ".env 设 NODE_ENV=production" });
  } else {
    add({ id: "core.mode", group: "核心", label: "运行模式", status: "ok", detail: "生产模式" });
  }
  add(s.jwtSecretSet
    ? { id: "core.jwt", group: "核心", label: "JWT_SECRET 会话密钥", status: "ok", detail: "已设置" }
    : { id: "core.jwt", group: "核心", label: "JWT_SECRET 会话密钥", status: s.isProduction ? "missing" : "warn", detail: s.isProduction ? "未设置——生产环境会拒绝启动" : "未设置（开发用内置回退，生产必须设）", fix: ".env 设 JWT_SECRET=随机 32+ 字符" });
  add(s.databaseUrlSet
    ? { id: "core.db", group: "核心", label: "DATABASE_URL 数据库", status: "ok", detail: "已配置" }
    : { id: "core.db", group: "核心", label: "DATABASE_URL 数据库", status: s.devBypass ? "warn" : "missing", detail: "未配置" + (s.devBypass ? "（当前靠内存 dev 模式兜底）" : "——所有数据无处存"), fix: ".env 设 DATABASE_URL=mysql://用户:密码@主机:3306/库名（deploy.bat 一键部署会自动生成）" });
  add(s.ownerEmailFromEnv
    ? { id: "core.owner", group: "核心", label: "OWNER_EMAIL 管理员邮箱", status: "ok", detail: `已设置（${s.ownerEmail}）——用该邮箱注册即为超级管理员` }
    : { id: "core.owner", group: "核心", label: "OWNER_EMAIL 管理员邮箱", status: "warn", detail: `未在 .env 设置，回退到内置默认（${s.ownerEmail}）——第三方部署务必改成自己的邮箱`, fix: ".env 设 OWNER_EMAIL=你的邮箱" });

  // ── 对象存储 ──
  const s3Parts = [s.s3.endpoint, s.s3.bucket, s.s3.accessKey, s.s3.secretKey];
  const s3Full = s3Parts.every(Boolean);
  const s3None = s3Parts.every((v) => !v);
  if (s3Full) {
    add({ id: "storage.s3", group: "对象存储", label: "S3/MinIO", status: "ok", detail: "S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY 齐备" });
  } else if (!s3None) {
    const missing = [!s.s3.endpoint && "S3_ENDPOINT", !s.s3.bucket && "S3_BUCKET", !s.s3.accessKey && "S3_ACCESS_KEY", !s.s3.secretKey && "S3_SECRET_KEY"].filter(Boolean).join("、");
    add({ id: "storage.s3", group: "对象存储", label: "S3/MinIO", status: "warn", detail: `配置不完整，缺 ${missing}——四项必须齐备才生效`, fix: "补齐 .env 的 S3_* 四项；或跑 deploy\\setup-minio.bat 一键自建 MinIO" });
  } else if (s.forgeConfigured) {
    add({ id: "storage.s3", group: "对象存储", label: "S3/MinIO", status: "ok", detail: "未配 S3，走内置 Forge 网关存储" });
  } else {
    add({ id: "storage.s3", group: "对象存储", label: "S3/MinIO", status: "missing", detail: "S3 与 Forge 网关都未配置——成片/素材没有地方存，导出与素材库不可用", fix: "跑 deploy\\setup-minio.bat 一键自建 MinIO（自动写 .env），或手动填 S3_* / BUILT_IN_FORGE_*" });
  }
  add({ id: "storage.public", group: "对象存储", label: "S3_PUBLIC_ENDPOINT 直连地址", status: s.s3.publicEndpoint ? "ok" : "off", detail: s.s3.publicEndpoint ? "已设置，浏览器直连存储" : "未设置——下载/上传经应用服务器中转（一般无需设置）" });

  // ── AI 平台密钥 ──
  const key = (id: string, label: string, set: boolean, offDetail: string) =>
    add(set ? { id, group: "AI 平台密钥", label, status: "ok", detail: "已设置" } : { id, group: "AI 平台密钥", label, status: "off", detail: offDetail });
  key("keys.kie", "KIE_API_KEY（kie.ai 公用）", s.keys.kie, "未设置——kie 系模型不可用（也可只用后台分发子密钥）");
  add(s.keys.kieSecret
    ? { id: "keys.kieSecret", group: "AI 平台密钥", label: "KIE_KEY_SECRET（分发密钥加密盐）", status: "ok", detail: "已设置" }
    : { id: "keys.kieSecret", group: "AI 平台密钥", label: "KIE_KEY_SECRET（分发密钥加密盐）", status: "off", detail: "未设置——后台「kie.ai 密钥」的子密钥分发功能不可用", fix: "要用分发功能就在 .env 设 KIE_KEY_SECRET=随机 32+ 字符" });
  key("keys.poyo", "POYO_API_KEY", s.keys.poyo, "未设置——Poyo 系模型不可用");
  key("keys.openai", "OPENAI_API_KEY", s.keys.openai, "未设置——配音 TTS 与「自定义 OpenAI 模型」不可用");
  key("keys.anthropic", "ANTHROPIC_API_KEY", s.keys.anthropic, "未设置——「自定义 Anthropic 模型」需前端用户自带 key");
  if (s.keys.higgsKey !== s.keys.higgsSecret) {
    add({ id: "keys.higgs", group: "AI 平台密钥", label: "HIGGSFIELD_API_KEY/SECRET", status: "warn", detail: "只设置了其中一个——KEY 与 SECRET 必须成对", fix: "补齐另一项，或两个都删掉" });
  } else {
    key("keys.higgs", "HIGGSFIELD_API_KEY/SECRET", s.keys.higgsKey, "未设置——Higgsfield 模型不可用");
  }
  key("keys.comfyBase", "COMFYUI_BASE_URL（本地/自建）", s.keys.comfyBase, "未设置（也可在后台运维中心注册 ComfyUI 服务器）");
  key("keys.comfyCloud", "COMFYUI_CLOUD_API_KEY（官方云）", s.keys.comfyCloudKey, "未设置——节点的 ComfyUI 云端开关显示「未配置」");
  add(s.keys.sshSecret
    ? { id: "keys.ssh", group: "AI 平台密钥", label: "SSH_KEY_SECRET（运维 SSH 加密盐）", status: "ok", detail: "已设置" }
    : { id: "keys.ssh", group: "AI 平台密钥", label: "SSH_KEY_SECRET（运维 SSH 加密盐）", status: "off", detail: "未设置——ComfyUI 运维中心不能添加 SSH 服务器", fix: "要用 SSH 运维就在 .env 设 SSH_KEY_SECRET=随机 32+ 字符" });

  // ── 登录认证 ──
  add({ id: "auth.oauth", group: "登录认证", label: "平台 OAuth", status: s.oauthUrlSet ? "ok" : "off", detail: s.oauthUrlSet ? "已配置 OAUTH_SERVER_URL" : "未配置——用邮箱注册登录（无碍）" });
  if (s.keys.googleId !== s.keys.googleSecret) {
    add({ id: "auth.google", group: "登录认证", label: "Google 登录", status: "warn", detail: "GOOGLE_CLIENT_ID/SECRET 只设置了一个——两个都设才启用", fix: "补齐另一项" });
  } else {
    add({ id: "auth.google", group: "登录认证", label: "Google 登录", status: s.keys.googleId ? "ok" : "off", detail: s.keys.googleId ? "已启用" : "未启用（可选）" });
  }
  if (s.dbConf.emailVerificationEnabled && !s.dbConf.smtpHostSet) {
    add({ id: "auth.smtp", group: "登录认证", label: "SMTP 邮件（注册验证码）", status: "warn", detail: "已开启注册邮箱验证但 SMTP 未配置——用户收不到验证码", fix: "后台「注册认证」页签配置 SMTP（或点「读取公网隧道的 SMTP」一键导入）" });
  } else {
    add({ id: "auth.smtp", group: "登录认证", label: "SMTP 邮件（注册验证码）", status: s.dbConf.smtpHostSet ? "ok" : "off", detail: s.dbConf.smtpHostSet ? "已配置（存数据库）" : "未配置——注册验证/邮件通知不可用（后台「注册认证」页签配置）" });
  }

  // ── 订阅桥接（本机 Claude / GPT）──
  if (!s.bridge.keySet) {
    add({ id: "bridge.key", group: "订阅桥接", label: "本机 Claude/GPT 桥接", status: "off", detail: "未启用（可选功能：设 CLAUDE_LOCAL_BRIDGE_KEY 后开启，用订阅额度跑画布 AI，详见 docs/本机claude桥接.md）" });
  } else {
    add({ id: "bridge.key", group: "订阅桥接", label: "CLAUDE_LOCAL_BRIDGE_KEY 桥接口令", status: "ok", detail: "已设置，桥接端点已启用" });
    const sh = s.dbConf.selfHosted;
    const bridgeUrlConfigured = /\/api\/claude-bridge/i.test(sh.url);
    if (!bridgeUrlConfigured) {
      add({ id: "bridge.selfHosted", group: "订阅桥接", label: "后台自建 LLM 对接", status: "warn", detail: "后台「自建 LLM」还没指向本机桥接", fix: "后台 模型管理›自建 LLM → 点「一键填入本机 Claude/GPT」→ API Key 填与 CLAUDE_LOCAL_BRIDGE_KEY 相同的值 → 保存" });
    } else if (sh.apiKey !== s.bridge.keyValue) {
      add({ id: "bridge.selfHosted", group: "订阅桥接", label: "后台自建 LLM 对接", status: "warn", detail: "后台自建 LLM 的 API Key 与服务端 CLAUDE_LOCAL_BRIDGE_KEY 不一致——桥接请求会 401", fix: "后台 模型管理›自建 LLM 的 API Key 改成与 .env 的 CLAUDE_LOCAL_BRIDGE_KEY 完全一致" });
    } else {
      add({ id: "bridge.selfHosted", group: "订阅桥接", label: "后台自建 LLM 对接", status: "ok", detail: `地址与 Key 均已对上（已登记 ${sh.modelIds.length} 个模型条目）` });
    }
    const hasClaudeLocal = sh.modelIds.some((m) => m.toLowerCase().startsWith("claude-local"));
    const hasGptLocal = sh.modelIds.some((m) => m.toLowerCase().startsWith("gpt-local"));
    if (hasClaudeLocal || !hasGptLocal) {
      add(s.probes.claudeCli
        ? { id: "bridge.claudeCli", group: "订阅桥接", label: "claude CLI", status: "ok", detail: "服务器可执行 claude" }
        : { id: "bridge.claudeCli", group: "订阅桥接", label: "claude CLI", status: "warn", detail: "服务器上找不到可用的 claude CLI", fix: "npm i -g @anthropic-ai/claude-code 后【重启本服务】；装在非标准路径才需设 CLAUDE_BIN" });
      add(s.bridge.claudeTokenSet
        ? { id: "bridge.claudeToken", group: "订阅桥接", label: "CLAUDE_CODE_OAUTH_TOKEN 订阅授权", status: "ok", detail: "已设置" }
        : { id: "bridge.claudeToken", group: "订阅桥接", label: "CLAUDE_CODE_OAUTH_TOKEN 订阅授权", status: "warn", detail: "未设置——claude CLI 无订阅授权会报认证错误", fix: "在能开浏览器的机器跑 claude setup-token，把 token 写进 .env 的 CLAUDE_CODE_OAUTH_TOKEN" });
      if (s.bridge.claudeTokenSet && s.keys.anthropic) {
        add({ id: "bridge.conflict", group: "订阅桥接", label: "计费冲突", status: "warn", detail: "同时设了 CLAUDE_CODE_OAUTH_TOKEN 与 ANTHROPIC_API_KEY——claude 会优先用 API Key，订阅白搭、变按量计费", fix: "从 .env 删掉 ANTHROPIC_API_KEY（若「自定义 Anthropic 模型」不用它）" });
      }
    }
    if (hasGptLocal) {
      add(s.probes.codexCli
        ? { id: "bridge.codexCli", group: "订阅桥接", label: "codex CLI", status: "ok", detail: "服务器可执行 codex" }
        : { id: "bridge.codexCli", group: "订阅桥接", label: "codex CLI", status: "warn", detail: "已登记 gpt-local 模型但服务器上找不到 codex CLI", fix: "npm i -g @openai/codex 后【重启本服务】；装在非标准路径才需设 CODEX_BIN" });
      add(s.probes.codexAuthJson
        ? { id: "bridge.codexAuth", group: "订阅桥接", label: "~/.codex/auth.json 订阅凭证", status: "ok", detail: "已就位" }
        : { id: "bridge.codexAuth", group: "订阅桥接", label: "~/.codex/auth.json 订阅凭证", status: "warn", detail: "未找到——codex 会静默落到 OPENAI_API_KEY 按量计费或直接报错", fix: "在能开浏览器的机器跑 codex →「Sign in with ChatGPT」，把 ~/.codex/auth.json 拷到服务器同路径" });
    }
    if (s.bridge.codexApiKeySet) {
      add({ id: "bridge.codexApiKey", group: "订阅桥接", label: "CODEX_API_KEY 风险", status: "warn", detail: "设了 CODEX_API_KEY——它优先级高于 ChatGPT 订阅凭证，等于绕过订阅按量计费", fix: "从 .env / 系统环境变量删掉 CODEX_API_KEY" });
    }
    // 桥接「技能 / MCP」增强（默认关闭）
    if (!s.bridge.skillsOn && !s.bridge.mcpConfigRaw) {
      add({ id: "bridge.agentic", group: "订阅桥接", label: "技能 / MCP 增强", status: "off", detail: "未启用（桥接为纯文本问答，最安全）。要让订阅 Claude 调技能/MCP：设 CLAUDE_BRIDGE_SKILLS=1 或 CLAUDE_BRIDGE_MCP_CONFIG，详见 docs/本机claude桥接.md" });
    } else {
      add({ id: "bridge.skills", group: "订阅桥接", label: "桥接技能（Skill）", status: s.bridge.skillsOn ? "ok" : "off", detail: s.bridge.skillsOn ? "已放行 Skill 工具——技能放服务器 ~/.claude/skills/<名>/SKILL.md 即自动可用" : "未放行（可选：CLAUDE_BRIDGE_SKILLS=1）" });
      if (s.bridge.mcpConfigRaw) {
        add(s.bridge.mcpConfigOk
          ? { id: "bridge.mcp", group: "订阅桥接", label: "桥接 MCP", status: "ok", detail: `已挂载 ${s.bridge.mcpServerNames.length} 个 MCP 服务器（${s.bridge.mcpServerNames.join("、") || "—"}）` }
          : { id: "bridge.mcp", group: "订阅桥接", label: "桥接 MCP", status: "warn", detail: "CLAUDE_BRIDGE_MCP_CONFIG 指向的配置读不到或解析不出 mcpServers——桥接会因 --strict-mcp-config 报错", fix: "检查该文件路径存在且是合法 JSON（含 mcpServers 对象）；内联 JSON 需以 { 开头" });
      }
      add({ id: "bridge.agenticRisk", group: "订阅桥接", label: "技能/MCP 安全提示", status: "warn", detail: "桥接已获工具/MCP 能力：这个可能公网可达、只有一把 key 的聊天口不再是纯文本。建议仅内网/受信任部署开启，别接可写文件系统/跑命令的高危 MCP", fix: "如非必要请删掉 CLAUDE_BRIDGE_SKILLS / CLAUDE_BRIDGE_MCP_CONFIG 回到纯文本；重型智能体走「代码任务」通道" });
    }
  }

  // ── 工程智能体 ──
  if (!s.superAgent.enabled) {
    add({ id: "sa.enabled", group: "工程智能体", label: "代码任务", status: "off", detail: "未启用（可选高级功能，默认关闭最安全）", fix: "本页上方「工程智能体权限」区块开启「代码任务」即可（站长 L5 权限，即时生效、无需重启）；或服务端设 SUPER_AGENT_CODE_ENABLED=1。详见 docs/phase2-启用清单.md" });
  } else {
    add({ id: "sa.enabled", group: "工程智能体", label: "代码任务", status: "ok", detail: "已启用（本页「工程智能体权限」开关或 SUPER_AGENT_CODE_ENABLED=1）" });
    if (s.superAgent.allowBash && !s.superAgent.permissionCmdSet) {
      add({ id: "sa.bash", group: "工程智能体", label: "Bash 放行 + 执行前审批", status: "warn", detail: "放行了 Bash 但没配执行前命令审批——危险命令只能靠事后监控", fix: ".env 配 SUPER_AGENT_PERMISSION_CMD=node 与 SUPER_AGENT_PERMISSION_ARGS（指向 dist/permissionMcpServer.cjs）" });
    } else if (s.superAgent.allowBash) {
      add({ id: "sa.bash", group: "工程智能体", label: "Bash 放行 + 执行前审批", status: "ok", detail: "Bash 已放行且配了执行前审批" });
    } else {
      add({ id: "sa.bash", group: "工程智能体", label: "Bash 放行", status: "ok", detail: "未放行 Bash——只读沙箱模式（最安全）" });
    }
    add({ id: "sa.autoInstall", group: "工程智能体", label: "ComfyUI 缺件自动安装", status: s.superAgent.autoInstall ? "ok" : "off", detail: s.superAgent.autoInstall ? "已启用" : "未启用（可选：本页「工程智能体权限」开关，或 SUPER_AGENT_AUTO_INSTALL=1）" });
  }

  // ── 系统依赖 / 隧道 ──
  add(s.probes.ffmpeg
    ? { id: "dep.ffmpeg", group: "系统依赖", label: "ffmpeg", status: "ok", detail: "可执行" }
    : { id: "dep.ffmpeg", group: "系统依赖", label: "ffmpeg", status: "missing", detail: "不可用——视频导出、剪辑/合并/字幕等节点全部不可用", fix: "winget install --id Gyan.FFmpeg -e（或 apt/yum 安装）后重启服务；装在非 PATH 位置则设 FFMPEG_PATH" });
  if (s.dbConf.tunnelEnabled) {
    add(s.dbConf.tunnelTokenSet || s.dbConf.tunnelPreferQuick
      ? { id: "dep.tunnel", group: "系统依赖", label: "公网隧道", status: "ok", detail: "已启用（后台「公网隧道」页签管理）" }
      : { id: "dep.tunnel", group: "系统依赖", label: "公网隧道", status: "warn", detail: "隧道已启用但既没配 token 也没选快速隧道", fix: "后台「公网隧道」页签填 cloudflared token 或勾选快速隧道" });
  } else {
    add({ id: "dep.tunnel", group: "系统依赖", label: "公网隧道", status: "off", detail: "未启用（可选：后台「公网隧道」页签配置 cloudflared）" });
  }

  return items;
}

/** 探测一个命令能否跑通（exit 0）。ENOENT/超时/非 0 → false。 */
export function probeCommand(cmd: string, args: string[], shell: boolean, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const fin = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "ignore"], shell });
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } fin(false); }, timeoutMs);
      child.on("error", () => { clearTimeout(t); fin(false); });
      child.on("close", (code) => { clearTimeout(t); fin(code === 0); });
    } catch { fin(false); }
  });
}

/** 汇总运行时快照并出体检报告（含 .env 模板全文，便于前端一键下载/复制）。 */
export async function buildConfigChecklist(): Promise<{ items: CheckItem[]; envExample: string }> {
  const claudeSpawn = resolveClaudeSpawn(resolveClaudeBin(), ["--version"]);
  const codexSpawn = resolveCodexSpawn(resolveCodexBin(), ["--version"]);
  const ffmpegBin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  // DB 读取各自容错：配置体检恰是 DB 异常时最该能打开的页面，任一读失败都不能拖垮整张清单。
  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };
  const [ffmpegOk, claudeOk, codexOk, authSettings, tunnelSettings, selfHosted] = await Promise.all([
    probeCommand(ffmpegBin, ["-version"], false),
    probeCommand(claudeSpawn.cmd, claudeSpawn.args, claudeSpawn.shell),
    probeCommand(codexSpawn.cmd, codexSpawn.args, codexSpawn.shell),
    safe(db.getAuthSettings(), { smtpHost: "", emailVerificationEnabled: false } as Awaited<ReturnType<typeof db.getAuthSettings>>),
    safe(db.getTunnelSettings(), { enabled: false, token: "", preferQuick: false } as Awaited<ReturnType<typeof db.getTunnelSettings>>),
    safe(db.getSelfHostedLlmConfig(), { url: "", apiKey: "", models: [] } as Awaited<ReturnType<typeof db.getSelfHostedLlmConfig>>),
  ]);

  // 桥接 MCP 配置状态：内联 JSON（{ 开头）就地解析；文件路径读出解析。取服务器名 + 是否合法。
  const bridgeMcp = ((): { raw: string; ok: boolean; names: string[] } => {
    const raw = process.env.CLAUDE_BRIDGE_MCP_CONFIG?.trim() || "";
    if (!raw) return { raw: "", ok: false, names: [] };
    let text = raw;
    if (!raw.startsWith("{")) { try { text = readFileSync(raw, "utf8"); } catch { return { raw, ok: false, names: [] }; } }
    const names = mcpServerNames(text);
    return { raw, ok: names.length > 0, names };
  })();

  const saCfg = getSuperAgentConfig(); // 工程智能体权限：后台配置优先、env 兜底
  const input: ChecklistInput = {
    isProduction: ENV.isProduction,
    devBypass: !ENV.isProduction && !ENV.databaseUrl && !ENV.oAuthServerUrl,
    jwtSecretSet: !!process.env.JWT_SECRET,
    databaseUrlSet: !!ENV.databaseUrl,
    oauthUrlSet: !!ENV.oAuthServerUrl,
    ownerEmailFromEnv: !!process.env.OWNER_EMAIL,
    ownerEmail: ENV.ownerEmail,
    s3: { endpoint: !!ENV.s3Endpoint, bucket: !!ENV.s3Bucket, accessKey: !!ENV.s3AccessKey, secretKey: !!ENV.s3SecretKey, publicEndpoint: !!ENV.s3PublicEndpoint },
    forgeConfigured: !!(ENV.forgeApiUrl && ENV.forgeApiKey),
    keys: {
      kie: !!ENV.kieApiKey, kieSecret: !!ENV.kieKeySecret, poyo: !!ENV.poyoApiKey,
      openai: !!ENV.openaiApiKey, anthropic: !!ENV.anthropicApiKey,
      higgsKey: !!ENV.higgsfieldApiKey, higgsSecret: !!ENV.higgsfieldApiSecret,
      comfyBase: !!ENV.comfyuiBaseUrl, comfyCloudKey: !!ENV.comfyuiCloudApiKey,
      sshSecret: !!ENV.sshKeySecret, googleId: !!ENV.googleClientId, googleSecret: !!ENV.googleClientSecret,
    },
    bridge: {
      keySet: !!process.env.CLAUDE_LOCAL_BRIDGE_KEY?.trim(),
      keyValue: process.env.CLAUDE_LOCAL_BRIDGE_KEY?.trim() || "",
      claudeTokenSet: !!process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim(),
      codexApiKeySet: !!process.env.CODEX_API_KEY?.trim(),
      skillsOn: process.env.CLAUDE_BRIDGE_SKILLS === "1",
      mcpConfigRaw: bridgeMcp.raw,
      mcpConfigOk: bridgeMcp.ok,
      mcpServerNames: bridgeMcp.names,
    },
    superAgent: {
      // 后台配置优先、env 兜底（见 superAgent/config.ts）——体检显示的即运行时真实生效值。
      enabled: saCfg.codeEnabled,
      allowBash: saCfg.allowBash,
      permissionCmdSet: !!process.env.SUPER_AGENT_PERMISSION_CMD?.trim(),
      autoInstall: saCfg.autoInstall,
    },
    probes: {
      ffmpeg: ffmpegOk, claudeCli: claudeOk, codexCli: codexOk,
      codexAuthJson: existsSync(join(homedir(), ".codex", "auth.json")),
    },
    dbConf: {
      smtpHostSet: !!authSettings.smtpHost,
      emailVerificationEnabled: !!authSettings.emailVerificationEnabled,
      tunnelEnabled: !!tunnelSettings.enabled,
      tunnelTokenSet: !!tunnelSettings.token?.trim(),
      tunnelPreferQuick: !!tunnelSettings.preferQuick,
      selfHosted: { url: selfHosted.url || "", apiKey: selfHosted.apiKey || "", modelIds: (selfHosted.models || []).map((m) => m.id) },
    },
  };

  let envExample = "";
  try { envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8"); } catch { /* 部署目录没带模板也不影响体检 */ }
  return { items: evaluateChecklist(input), envExample };
}
