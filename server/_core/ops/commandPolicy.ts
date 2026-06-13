// Server-side command safety policy for the ComfyUI ops center. The frontend and
// the LLM are NEVER trusted to classify danger — this module is the single source
// of truth, re-run on the backend before every execution.

// Destructive / irreversible patterns → require an explicit red second
// confirmation (and never eligible for auto-execute). Patterns are deliberately
// broad: false positives just ask for one extra confirmation, false negatives
// would let damage through.
const DANGEROUS_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+(-[a-z]*\s+)*-?[a-z]*[rf]/i, reason: "递归/强制删除文件（rm -rf）" },
  { re: /\bdd\s+.*\bof=\/dev\//i, reason: "dd 直写块设备，可能抹盘" },
  { re: /\bmkfs(\.\w+)?\b/i, reason: "格式化文件系统（mkfs）" },
  { re: />\s*\/dev\/(sd|nvme|vd|hd)/i, reason: "重定向写入块设备" },
  { re: /\b(shutdown|poweroff|halt|reboot|init\s+0|init\s+6)\b/i, reason: "关机/重启主机" },
  { re: /:\(\)\s*\{.*\}\s*;\s*:/, reason: "fork 炸弹" },
  { re: /\bchmod\s+(-R\s+)?0?777\s+\//, reason: "对根目录递归 777 提权" },
  { re: /\bchown\s+-R\b.*\s\//, reason: "对根目录递归改属主" },
  { re: /\bmv\s+.*\s+\/dev\/null\b/i, reason: "把文件移入 /dev/null（丢弃）" },
  { re: /\b(userdel|groupdel|deluser)\b/i, reason: "删除系统用户/组" },
  { re: /\bdocker\s+(system\s+prune|volume\s+prune|rm\s+-f|rmi\s+-f)/i, reason: "Docker 强制清理/删除（可能毁数据卷）" },
  { re: /\b(drop\s+database|truncate\s+table)\b/i, reason: "数据库删库/清表" },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i, reason: "git 硬重置/强清，丢未提交改动" },
  { re: />\s*\/etc\//i, reason: "覆盖写入 /etc 系统配置" },
];

// Read-only / safe command prefixes eligible for auto-execute when trust mode is
// on. This is an allow-LIST of command *shapes*, not a free regex — anything not
// matching here always needs human confirmation. AI-generated commands are never
// passed through this (the caller gates that separately).
const SAFE_PREFIXES: RegExp[] = [
  /^docker\s+(ps|images|stats|logs|inspect|top|version|info)\b/i,
  /^nvidia-smi\b/i,
  /^(df|du|free|uptime|whoami|hostname|uname|date|pwd|id)\b/i,
  /^(ls|cat|head|tail|stat|file|wc|find)\b/i,
  /^(ps|top|htop)\b/i,
  /^(systemctl\s+status|journalctl)\b/i,
  /^(nvcc|python3?\s+--version|pip3?\s+list|node\s+--version)\b/i,
  /^echo\b/i,
];

export interface CommandRisk {
  dangerous: boolean;
  reasons: string[];
  /** True only when the command matches a known-safe read-only shape. */
  autoExecEligible: boolean;
}

/** Classify a single command line. Multi-line scripts: classify each non-empty,
 *  non-comment line and OR the danger / AND the auto-exec eligibility. */
export function classifyCommand(raw: string): CommandRisk {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const reasons = new Set<string>();
  let allSafe = lines.length > 0;
  for (const line of lines) {
    for (const { re, reason } of DANGEROUS_PATTERNS) {
      if (re.test(line)) reasons.add(reason);
    }
    if (!SAFE_PREFIXES.some((re) => re.test(line))) allSafe = false;
  }
  const dangerous = reasons.size > 0;
  return {
    dangerous,
    reasons: Array.from(reasons),
    autoExecEligible: allSafe && !dangerous,
  };
}

/** Decide whether a command may run without a fresh human confirmation.
 *  trustMode + safe shape + not AI-generated. Dangerous always blocks. */
export function mayAutoExecute(raw: string, opts: { trustMode: boolean; aiGenerated: boolean }): boolean {
  if (!opts.trustMode || opts.aiGenerated) return false;
  const risk = classifyCommand(raw);
  return risk.autoExecEligible;
}
