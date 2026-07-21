// #312 流式回显实时排版：不完整规划 JSON → 可读草稿行（纯展示层，抽不出即回退原文）。
import { describe, it, expect } from "vitest";
import { formatStreamPreview } from "./streamPreviewFormat";

describe("#312 formatStreamPreview", () => {
  it("普通文本（快问快答）原样直出，不做任何加工", () => {
    const t = "你好！我可以帮你把创意编排成完整视频链路。";
    expect(formatStreamPreview(t)).toBe(t);
  });

  it("规划 JSON：reply + 已成形操作抽成编号清单（含节点类型/标题中文化）", () => {
    const raw = `{"reply":"已为你规划 2 镜短片。","operations":[{"op":"create","tempId":"shot1","nodeType":"storyboard","title":"镜头1 日出","payload":{}},{"op":"create","tempId":"v1","nodeType":"video_task","title":"镜头1 视频"},{"op":"connect","sourceRef":"shot1","targetRef":"v1"}]}`;
    const out = formatStreamPreview(raw);
    expect(out).toContain("💬 已为你规划 2 镜短片。");
    expect(out).toContain("1. 新建 分镜「镜头1 日出」");
    expect(out).toContain("2. 新建 视频「镜头1 视频」");
    expect(out).toContain("3. 连线 shot1 → v1");
  });

  it("未闭合流：reply 字符串生成到一半也取已流出部分；未闭合 title 不显示乱串", () => {
    const raw = `{"reply":"正在构思一个温柔的故事，主角`;
    expect(formatStreamPreview(raw)).toBe("💬 正在构思一个温柔的故事，主角");
    const raw2 = `{"reply":"好。","operations":[{"op":"create","nodeType":"note","title":"今天完`;
    const out2 = formatStreamPreview(raw2);
    expect(out2).toContain("1. 新建 便签");
    expect(out2).not.toContain("今天完"); // 未闭合 title 不取
  });

  it("canvas 操作显示 action；JSON 刚开头无可抽结构 → 回退原文", () => {
    const raw = `{"reply":"","operations":[{"op":"canvas","action":"arrange"}]}`;
    expect(formatStreamPreview(raw)).toContain("1. 画布操作：arrange");
    const head = `{"opera`;
    expect(formatStreamPreview(head)).toBe(head); // 不含标志键 → 原样
    const head2 = `{"operations":[`;
    expect(formatStreamPreview(head2)).toBe(head2); // 含键但零成形内容 → 原样兜底
  });

  it("转义处理：reply 里的 \\n / \\\" 展开为可读文本", () => {
    const raw = `{"reply":"第一行\\n他说：\\"走\\"。"}`;
    expect(formatStreamPreview(raw)).toBe('💬 第一行 他说："走"。');
  });
});
