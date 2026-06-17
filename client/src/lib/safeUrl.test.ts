import { describe, it, expect } from "vitest";
import { isSafeUrl, safeHref } from "./safeUrl";
import { sanitizeTemplatePayload } from "./nodeTemplates";

describe("isSafeUrl / safeHref — href 协议白名单", () => {
  it("放行 http(s) 与同源绝对路径", () => {
    for (const u of ["https://x.com/a.png", "http://h/a", "/manus-storage/k", "/api/x"]) {
      expect(isSafeUrl(u)).toBe(true);
      expect(safeHref(u)).toBe(u);
    }
  });

  it("拦截脚本类协议、协议相对、空值", () => {
    for (const u of ["javascript:alert(1)", " javascript:alert(1)", "JavaScript:x", "data:text/html,<script>", "vbscript:x", "blob:abc", "//evil.com", "", undefined, null]) {
      expect(isSafeUrl(u as string)).toBe(false);
      expect(safeHref(u as string)).toBeUndefined();
    }
  });
});

describe("sanitizeTemplatePayload — 导入时剥离不安全 URL", () => {
  it("丢弃 url/*Url 字段里的脚本协议，保留正常字段", () => {
    const out = sanitizeTemplatePayload({
      url: "javascript:alert(1)",
      ttsTimestampsUrl: "https://ok/a.json",
      outputImageUrl: "data:text/html,x",
      label: "hello",
      title: "javascript:notaurl", // 非 url 键 → 不动
    });
    expect(out.url).toBeUndefined();
    expect(out.outputImageUrl).toBeUndefined();
    expect(out.ttsTimestampsUrl).toBe("https://ok/a.json");
    expect(out.label).toBe("hello");
    expect(out.title).toBe("javascript:notaurl");
  });
});
