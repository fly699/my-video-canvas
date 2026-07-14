// 代码任务连接 GitHub（#173）的纯逻辑 + 克隆执行。
// 授权：用户自带 PAT（不落库，随请求透传、用完即弃）。仅支持 github.com。
// 纯函数（解析/构造/脱敏/校验）便于单测；克隆用 execFile（argv 数组，token 只作 URL 参数、
// 不经 shell，杜绝注入），并对所有输出脱敏 token。
import { execFile } from "node:child_process";

export interface GhRepo { owner: string; repo: string }

/** 解析 GitHub 仓库定位：接受 owner/repo、https://github.com/owner/repo(.git)、
 *  git@github.com:owner/repo(.git)。仅 github.com。非法 → null。 */
export function parseGitHubRepo(input: string): GhRepo | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const clean = (owner: string, repo: string): GhRepo | null => {
    const o = owner.trim(), r = repo.trim().replace(/\.git$/i, "");
    // owner/repo 字符集：字母数字、连字符、下划线、点（GitHub 允许）。防路径穿越/注入。
    if (!/^[A-Za-z0-9._-]+$/.test(o) || !/^[A-Za-z0-9._-]+$/.test(r)) return null;
    if (o === "." || o === ".." || r === "." || r === "..") return null;
    return { owner: o, repo: r };
  };
  // https://github.com/owner/repo(.git)
  let m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)/i.exec(s);
  if (m) return clean(m[1], m[2]);
  // git@github.com:owner/repo(.git)
  m = /^git@github\.com:([^/\s]+)\/([^/\s]+)/i.exec(s);
  if (m) return clean(m[1], m[2]);
  // owner/repo（无协议）
  m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(s);
  if (m) return clean(m[1], m[2]);
  return null;
}

/** 构造带 token 的 HTTPS 克隆/推送地址。用户名固定 x-access-token（PAT/GitHub App token 通用）。 */
export function buildAuthedRemote(repo: GhRepo, token: string): string {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo.owner}/${repo.repo}.git`;
}

/** 明文（不带 token）远程地址，供展示。 */
export function publicRemote(repo: GhRepo): string {
  return `https://github.com/${repo.owner}/${repo.repo}`;
}

/** 分支名安全校验：GitHub 合法且无 shell/路径危险字符。 */
export function isValidBranchName(b: string): boolean {
  const s = (b ?? "").trim();
  if (!s || s.length > 200) return false;
  if (/[\s~^:?*[\\]/.test(s)) return false;   // git 非法 + 空白
  if (s.includes("..") || s.startsWith("/") || s.endsWith("/") || s.endsWith(".lock")) return false;
  if (/[;&|`$(){}<>'"]/.test(s)) return false; // shell 元字符兜底
  return true;
}

/** 从文本里抹掉 token（脱敏日志/报错，绝不外泄）。token 空则原样返回。 */
export function redactToken(text: string, token: string | undefined): string {
  if (!token) return text;
  return text.split(token).join("***").split(encodeURIComponent(token)).join("***");
}

export interface CloneResult { ok: boolean; message: string }

/** 把仓库克隆进指定（空）工作目录。token 只作 argv 参数（不经 shell）。所有输出脱敏。
 *  失败返回 ok:false + 脱敏后的原因。60s 超时。 */
export function cloneRepoInto(dir: string, repo: GhRepo, token: string, branch?: string): Promise<CloneResult> {
  const remote = buildAuthedRemote(repo, token);
  const args = ["clone", "--depth", "1"];
  if (branch && isValidBranchName(branch)) args.push("--branch", branch);
  args.push(remote, dir);
  return new Promise((resolve) => {
    execFile("git", args, { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const raw = (stderr || stdout || err.message || "克隆失败").toString();
        resolve({ ok: false, message: redactToken(raw, token).slice(-500) });
      } else {
        resolve({ ok: true, message: `已克隆 ${publicRemote(repo)}${branch ? ` @${branch}` : ""}` });
      }
    });
  });
}
