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
