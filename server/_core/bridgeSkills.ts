// 列出服务器上可用的 Claude 技能（供聊天框「/ 唤起技能」用）。
// 技能位置：CLAUDE_CONFIG_DIR/skills（设了的话）或 ~/.claude/skills，每个技能一个子目录含 SKILL.md，
// 头部 YAML frontmatter 有 name / description。只回 name+description（不回正文），供前端列表 + 提示。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getBridgeMcpConfig } from "./bridgeMcp";

export interface BridgeSkill { name: string; description: string }

/** 解析 SKILL.md 头部 frontmatter 的 name / description（纯函数，轻量，不引 YAML 库）。
 *  取 `---` 到 `---` 之间的 `key: value`；无 frontmatter 时返回空串。 */
export function parseSkillFrontmatter(md: string): { name: string; description: string } {
  const m = /^﻿?---\s*\r?\n([\s\S]*?)\r?\n---/.exec(md ?? "");
  const out = { name: "", description: "" };
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description)\s*:\s*(.*)$/i.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["']|["']$/g, ""); // 去成对引号
    if (kv[1].toLowerCase() === "name") out.name = v;
    else out.description = v;
  }
  return out;
}

/** 技能根目录：CLAUDE_CONFIG_DIR/skills 优先，否则 ~/.claude/skills。 */
export function skillsDir(): string {
  const cfg = process.env.CLAUDE_CONFIG_DIR?.trim();
  return cfg ? join(cfg, "skills") : join(homedir(), ".claude", "skills");
}

/** 扫描技能目录，返回 { enabled, dir, skills }。enabled = 桥接是否放行了 Skill。必须与真正的放行判定
 *  同源——resolveBridgeAgenticArgs 走 getBridgeMcpConfig().skills（DB 优先、env 兜底），故这里也读它，
 *  而非直接读 env；否则「后台 UI 开启技能」时前端技能入口不显示、与桥接实际能力不符。
 *  容错：目录不存在/读失败→空列表，绝不抛。上限 200 个防异常目录拖垮。 */
export function listBridgeSkills(): { enabled: boolean; dir: string; skills: BridgeSkill[] } {
  const enabled = getBridgeMcpConfig().skills;
  const dir = skillsDir();
  const skills: BridgeSkill[] = [];
  try {
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir).slice(0, 200)) {
        const skillMd = join(dir, entry, "SKILL.md");
        try {
          if (!statSync(join(dir, entry)).isDirectory() || !existsSync(skillMd)) continue;
          const fm = parseSkillFrontmatter(readFileSync(skillMd, "utf8"));
          skills.push({ name: fm.name || entry, description: fm.description });
        } catch { /* 单个技能读失败跳过 */ }
      }
    }
  } catch { /* 目录读失败 → 空 */ }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { enabled, dir, skills };
}
