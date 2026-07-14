// AI 客户端「代码模式」（对齐 GPT Canvas / Claude Artifacts）的纯逻辑：
// - 把一条消息按 ``` 代码围栏拆成「文本/代码」段，供消息区分块渲染（代码块高亮/复制）。
// - 从对话里提取「最新代码工件」，供右侧工件面板展示/复制/下载/预览/落成节点。
// 纯函数便于单测；不含任何 React/DOM。

export interface MsgSegment {
  type: "text" | "code";
  lang?: string;   // 代码段的语言标注（```后面的词，可空）
  content: string;
}

// 语言 → 文件扩展名（下载/落成脚本用）。未知语言回退 txt。
const LANG_EXT: Record<string, string> = {
  js: "js", javascript: "js", jsx: "jsx", ts: "ts", typescript: "ts", tsx: "tsx",
  py: "py", python: "py", rb: "rb", ruby: "rb", go: "go", rust: "rs", rs: "rs",
  java: "java", kotlin: "kt", swift: "swift", c: "c", cpp: "cpp", "c++": "cpp", cs: "cs",
  php: "php", sh: "sh", bash: "sh", zsh: "sh", shell: "sh",
  html: "html", xml: "xml", css: "css", scss: "scss",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml", sql: "sql", md: "md", markdown: "md",
};

const norm = (lang?: string) => (lang ?? "").trim().toLowerCase();

/** 该语言是否可在沙箱 iframe 里实时预览（前端可自渲染的）。 */
export function isPreviewableLang(lang?: string): boolean {
  const l = norm(lang);
  return l === "html" || l === "htm" || l === "svg";
}

/** 语言 → 扩展名。 */
export function extForLang(lang?: string): string {
  return LANG_EXT[norm(lang)] ?? "txt";
}

/** 依语言与序号猜一个文件名（下载/落成脚本节点用）。 */
export function guessFilename(lang: string | undefined, index = 0): string {
  const ext = extForLang(lang);
  const base = index > 0 ? `code-${index + 1}` : "code";
  return `${base}.${ext}`;
}

/** 把一条消息按 ``` 围栏拆成文本/代码段。无围栏 → 单个文本段。空内容 → []。 */
export function parseMessageSegments(content: string): MsgSegment[] {
  const text = content ?? "";
  if (!text) return [];
  const segments: MsgSegment[] = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) {
      const pre = text.slice(last, m.index);
      if (pre.trim()) segments.push({ type: "text", content: pre });
    }
    segments.push({ type: "code", lang: m[1].trim() || undefined, content: m[2].replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < text.length) {
    const tail = text.slice(last);
    if (tail.trim()) segments.push({ type: "text", content: tail });
  }
  // 全空白（只有围栏空段）时也至少回一个文本段，避免渲染空洞。
  return segments.length ? segments : [{ type: "text", content: text }];
}

export interface CodeArtifact {
  lang?: string;
  content: string;
  filename: string;
  previewable: boolean;
}

type MiniMsg = { role: string; content: string };

/** 从对话里取「最新的代码工件」：从最后一条 assistant 消息往前找，取其中最后一个代码段。
 *  无代码段 → null。供右侧工件面板默认展示最近产出的代码。 */
export function latestCodeArtifactFrom(messages: MiniMsg[]): CodeArtifact | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const codes = parseMessageSegments(msg.content).filter((s) => s.type === "code");
    if (codes.length === 0) continue;
    const c = codes[codes.length - 1];
    return { lang: c.lang, content: c.content, filename: guessFilename(c.lang), previewable: isPreviewableLang(c.lang) };
  }
  return null;
}

/** 代码模式的系统提示：要求把可运行/完整的代码放进 ``` 围栏（便于工件面板提取）。 */
export const CODE_MODE_SYSTEM_PROMPT =
  "你是资深软件工程师助手。请用清晰、可运行、完整的代码回答，"
  + "所有代码务必包裹在带语言标注的 Markdown 代码围栏里（如 ```ts、```python、```html），"
  + "每个文件/片段单独一个围栏；围栏外用简洁中文解释思路与用法。若是前端/HTML，尽量给出可独立预览的完整单文件。";
