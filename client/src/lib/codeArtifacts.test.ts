import { describe, it, expect } from "vitest";
import {
  parseMessageSegments, latestCodeArtifactFrom, isPreviewableLang, extForLang, guessFilename,
} from "./codeArtifacts";

describe("parseMessageSegments", () => {
  it("纯文本 → 单个文本段", () => {
    expect(parseMessageSegments("你好世界")).toEqual([{ type: "text", content: "你好世界" }]);
  });
  it("拆出代码围栏（带语言标注）", () => {
    const segs = parseMessageSegments("看这段：\n```ts\nconst a = 1;\n```\n完成");
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ type: "text" });
    expect(segs[1]).toMatchObject({ type: "code", lang: "ts", content: "const a = 1;" });
    expect(segs[2]).toMatchObject({ type: "text", content: "\n完成" });
  });
  it("无语言标注的围栏 lang 为 undefined", () => {
    const segs = parseMessageSegments("```\nplain\n```");
    expect(segs).toEqual([{ type: "code", lang: undefined, content: "plain" }]);
  });
  it("多个代码块", () => {
    const segs = parseMessageSegments("```js\na\n```\n中间\n```py\nb\n```");
    const codes = segs.filter((s) => s.type === "code");
    expect(codes.map((c) => c.lang)).toEqual(["js", "py"]);
    expect(codes.map((c) => c.content)).toEqual(["a", "b"]);
  });
  it("空内容 → 空数组", () => {
    expect(parseMessageSegments("")).toEqual([]);
  });
  it("同内容重复调用命中缓存（引用稳定，避免整列重渲染时重复解析）", () => {
    const s = "解释\n```ts\nconst a = 1;\n```\n收尾";
    const a = parseMessageSegments(s);
    const b = parseMessageSegments(s);
    expect(b).toBe(a); // 同一引用 = 缓存命中
    expect(a).toHaveLength(3);
  });
});

describe("isPreviewableLang / extForLang / guessFilename", () => {
  it("HTML/SVG 可预览，其它不可", () => {
    expect(isPreviewableLang("html")).toBe(true);
    expect(isPreviewableLang("svg")).toBe(true);
    expect(isPreviewableLang("ts")).toBe(false);
    expect(isPreviewableLang(undefined)).toBe(false);
  });
  it("语言→扩展名，未知回退 txt", () => {
    expect(extForLang("python")).toBe("py");
    expect(extForLang("typescript")).toBe("ts");
    expect(extForLang("bash")).toBe("sh");
    expect(extForLang("wat")).toBe("txt");
    expect(extForLang(undefined)).toBe("txt");
  });
  it("猜文件名带序号", () => {
    expect(guessFilename("py")).toBe("code.py");
    expect(guessFilename("html", 1)).toBe("code-2.html");
  });
});

describe("latestCodeArtifactFrom", () => {
  it("取最后一条 assistant 的最后一个代码块", () => {
    const msgs = [
      { role: "user", content: "写点代码" },
      { role: "assistant", content: "```js\nold\n```" },
      { role: "user", content: "再写" },
      { role: "assistant", content: "解释\n```html\n<b>hi</b>\n```\n再来\n```css\nb{}\n```" },
    ];
    const art = latestCodeArtifactFrom(msgs);
    expect(art).toMatchObject({ lang: "css", content: "b{}", filename: "code.css", previewable: false });
  });
  it("最后一条 assistant 无代码 → 往前找", () => {
    const msgs = [
      { role: "assistant", content: "```py\nx=1\n```" },
      { role: "assistant", content: "没有代码的纯文字" },
    ];
    expect(latestCodeArtifactFrom(msgs)?.content).toBe("x=1");
  });
  it("无任何代码 → null", () => {
    expect(latestCodeArtifactFrom([{ role: "assistant", content: "纯聊天" }])).toBeNull();
  });
  it("HTML 工件标记为可预览", () => {
    const art = latestCodeArtifactFrom([{ role: "assistant", content: "```html\n<h1>x</h1>\n```" }]);
    expect(art?.previewable).toBe(true);
  });
});
