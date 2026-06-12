// 依赖卫生回归测试：React Flow 只允许新代 @xyflow/react（v12）。
//
// 事故复盘（2026-06，#434）：RunStatusBar 误从旧代包 "reactflow"(v11) 引入 useReactFlow，
// v11 hook 找不到 v12 provider context → 画布整页崩溃。当时新旧两代同时声明在 package.json，
// 编辑器对两个包都给自动补全，tsc/build 全过、仅运行时炸。旧包已卸载；本测试锁死两件事：
//   1) 源码任何文件不得从 "reactflow" / "react-flow-renderer" / "@reactflow/*" 引入；
//   2) package.json 不得再次声明这些旧代包。
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..", ".."); // client/src/lib → 仓库根
const SRC_DIRS = [join(ROOT, "client", "src"), join(ROOT, "server"), join(ROOT, "shared")];
const LEGACY = /from\s+["'](reactflow|react-flow-renderer|@reactflow\/[\w-]+)["']|require\(\s*["'](reactflow|react-flow-renderer|@reactflow\/[\w-]+)["']\s*\)/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) yield p;
  }
}

describe("依赖卫生：React Flow 用新弃旧", () => {
  it("源码不得从旧代 reactflow / react-flow-renderer / @reactflow/* 引入", () => {
    const offenders: string[] = [];
    for (const dir of SRC_DIRS) {
      for (const file of walk(dir)) {
        if (file.endsWith("legacyImports.test.ts")) continue; // 本文件含示例字符串
        if (LEGACY.test(readFileSync(file, "utf8"))) offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders, `以下文件引用了旧代 React Flow 包（应从 "@xyflow/react" 引入）：\n${offenders.join("\n")}`).toEqual([]);
  });
  it("package.json 不得声明旧代 React Flow 包", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const legacy of ["reactflow", "react-flow-renderer"]) {
      expect(all[legacy], `package.json 不应再声明旧代包 ${legacy}（用 @xyflow/react）`).toBeUndefined();
    }
  });
});
