// #224 批2 联网提炼：URL SSRF 防护 + HTML→纯文本 提纯（纯函数单测）
import { describe, it, expect } from "vitest";
import { isForbiddenHost, assertPublicDocUrl, htmlToText } from "./_core/webDocFetch";

describe("isForbiddenHost（SSRF 防护）", () => {
  it("拦截回环/私网/链路本地/元数据/保留段", () => {
    for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.1.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "foo.local", "api.internal"]) {
      expect(isForbiddenHost(h), h).toBe(true);
    }
  });
  it("放行公网域名与公网 IP", () => {
    for (const h of ["docs.kie.ai", "poyo.ai", "8.8.8.8", "172.15.0.1", "172.32.0.1", "example.com"]) {
      expect(isForbiddenHost(h), h).toBe(false);
    }
  });
});

describe("assertPublicDocUrl", () => {
  it("合法 https 公网 URL 通过", () => {
    expect(assertPublicDocUrl("https://docs.kie.ai/models/grok").hostname).toBe("docs.kie.ai");
  });
  it("非法协议/内网/带凭证/非标端口 → 抛错", () => {
    expect(() => assertPublicDocUrl("ftp://example.com/a")).toThrow();
    expect(() => assertPublicDocUrl("https://127.0.0.1/doc")).toThrow();
    expect(() => assertPublicDocUrl("https://user:pw@example.com/")).toThrow();
    expect(() => assertPublicDocUrl("https://example.com:8080/doc")).toThrow();
    expect(() => assertPublicDocUrl("not-a-url")).toThrow();
  });
});

describe("htmlToText", () => {
  it("去 script/style/标签、实体反转、块级断行", () => {
    const html = `<html><head><style>.a{color:red}</style><script>alert(1)</script></head>
<body><h1>Grok 模型</h1><p>duration 取值 &lt;= 30&nbsp;s &amp; aspect_ratio 支持 &quot;16:9&quot;</p><div>第二段</div></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("Grok 模型");
    expect(t).toContain('duration 取值 <= 30 s & aspect_ratio 支持 "16:9"');
    expect(t).toContain("第二段");
    expect(t).not.toContain("alert(1)");
    expect(t).not.toContain("color:red");
    expect(t).not.toContain("<p>");
  });
});

// #224 批2b：kie Web Search 支持集合（只收官方文档声明的模型，不按同族猜测）
import { kieWebSearchSupported, KIE_WEB_SEARCH_TOOLS } from "./_core/kieLLM";

describe("kieWebSearchSupported / tools 契约", () => {
  it("gpt-5.2（kie）支持；未声明的模型与非 kie 模型不支持", () => {
    expect(kieWebSearchSupported("kie_gpt_5_2")).toBe(true);
    expect(kieWebSearchSupported("kie_gemini_3_pro")).toBe(false); // 文档未声明，不猜
    expect(kieWebSearchSupported("kie_gpt_52_codex")).toBe(false); // responses 格式，契约不适用
    expect(kieWebSearchSupported("gpt-5.2")).toBe(false);          // 非 kie 系统 id
    expect(kieWebSearchSupported(undefined)).toBe(false);
  });
  it("tools 参数与官方文档逐字段一致", () => {
    expect(KIE_WEB_SEARCH_TOOLS).toEqual([{ type: "function", function: { name: "web_search" } }]);
  });
});

// #224 批2c：多渠道搜索——DDG 结果解析纯函数 + 原生联网模型清单
import { parseDuckDuckGoHtml } from "./_core/webSearchChannels";
import { NATIVE_WEB_SEARCH_LLMS } from "../shared/webSearchModels";

describe("parseDuckDuckGoHtml", () => {
  const html = `
<div class="result results_links"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.kie.ai%2Fgrok&rut=x">Grok 官方文档 <b>提示词</b></a>
<a class="result__snippet" href="#">官方 prompt guide，包含参数说明。</a></div>
<div class="result"><a class="result__a" href="https://blog.example.com/tips">Grok tips</a></div>
<div class="result"><a class="result__a" href="javascript:void(0)">坏链接</a></div>`;
  it("解析标题/摘要，还原 uddg 重定向为真实 URL，跳过非 http 链接", () => {
    const out = parseDuckDuckGoHtml(html);
    expect(out).toContain("Grok 官方文档 提示词");
    expect(out).toContain("https://docs.kie.ai/grok");
    expect(out).toContain("官方 prompt guide");
    expect(out).toContain("https://blog.example.com/tips");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("uddg=");
  });
  it("maxResults 截断", () => {
    expect(parseDuckDuckGoHtml(html, 1).split("\n- ").length).toBe(1); // 只留第一条
  });
  it("无结果页返回空串", () => {
    expect(parseDuckDuckGoHtml("<html><body>no results</body></html>")).toBe("");
  });
});

describe("原生联网模型清单（shared 单一事实源）", () => {
  it("含官方声明的 GPT-5.2 与 GPT-5.4，且 kieWebSearchSupported 一致", () => {
    expect(NATIVE_WEB_SEARCH_LLMS).toContain("kie_gpt_5_2");
    expect(NATIVE_WEB_SEARCH_LLMS).toContain("kie_gpt_5_4");
    expect(kieWebSearchSupported("kie_gpt_5_4")).toBe(true);
  });
});
