import { describe, it, expect } from "vitest";
import { normalizeSelfHostedLlm } from "./db";

// JSON columns come back parsed on MySQL 8 but as a STRING on MariaDB (JSON=longtext).
// normalizeSelfHostedLlm must accept both, reject garbage, AND归一化到多服务器 { servers:[...] }：
// 旧单服务器 {url,apiKey,models} 包成单条 server；新 {servers:[...]} 原样规整。
describe("normalizeSelfHostedLlm — 多服务器归一化 + DB JSON 兼容(对象/字符串/脏值)", () => {
  const legacy = { url: "http://172.16.0.10:8000", apiKey: "k", models: [{ id: "Qwen3.6-35B-A3B-FP8", label: "Qwen" }] };
  const wrapped = { servers: [{ url: "http://172.16.0.10:8000", apiKey: "k", models: [{ id: "Qwen3.6-35B-A3B-FP8", label: "Qwen" }] }] };

  it("旧单服务器对象(MySQL) → 包成单条 server", () => {
    expect(normalizeSelfHostedLlm(legacy)).toEqual(wrapped);
  });
  it("旧单服务器字符串(MariaDB longtext) → 能 parse 并包装", () => {
    expect(normalizeSelfHostedLlm(JSON.stringify(legacy))).toEqual(wrapped);
  });
  it("新多服务器形态原样规整（丢弃 url 为空的条目）", () => {
    const multi = { servers: [
      { url: "http://a:8000", apiKey: "k1", models: [{ id: "m1", label: "M1" }] },
      { url: "", apiKey: "x", models: [{ id: "m2", label: "M2" }] }, // url 空 → 丢弃
      { url: "http://b:8000", apiKey: "", models: [{ id: "m3", label: "m3" }] },
    ] };
    expect(normalizeSelfHostedLlm(multi)).toEqual({ servers: [
      { url: "http://a:8000", apiKey: "k1", models: [{ id: "m1", label: "M1" }] },
      { url: "http://b:8000", apiKey: "", models: [{ id: "m3", label: "m3" }] },
    ] });
  });
  it("null/坏字符串/坏结构 → 空 servers", () => {
    expect(normalizeSelfHostedLlm(null)).toEqual({ servers: [] });
    expect(normalizeSelfHostedLlm("not json")).toEqual({ servers: [] });
    expect(normalizeSelfHostedLlm({ url: 123, models: "x" })).toEqual({ servers: [] });
  });
  it("旧形态 models 内非法项被剔除、label 缺省取 id", () => {
    const r = normalizeSelfHostedLlm({ url: "http://h", models: [{ id: "a" }, { label: "no-id" }, { id: "b", label: "B" }] });
    expect(r.servers).toEqual([{ url: "http://h", apiKey: "", models: [{ id: "a", label: "a" }, { id: "b", label: "B" }] }]);
  });
});
