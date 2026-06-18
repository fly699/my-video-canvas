import { describe, it, expect } from "vitest";
import { normalizeSelfHostedLlm } from "./db";

// JSON columns come back parsed on MySQL 8 but as a STRING on MariaDB (JSON=longtext).
// normalizeSelfHostedLlm must accept both, and reject garbage shapes.
describe("normalizeSelfHostedLlm — DB JSON 兼容(对象/字符串/脏值)", () => {
  const cfg = { url: "http://172.16.0.10:8000", apiKey: "k", models: [{ id: "Qwen3.6-35B-A3B-FP8", label: "Qwen" }] };
  it("对象(MySQL) 原样规整", () => {
    expect(normalizeSelfHostedLlm(cfg)).toEqual(cfg);
  });
  it("字符串(MariaDB longtext) 能 parse", () => {
    expect(normalizeSelfHostedLlm(JSON.stringify(cfg))).toEqual(cfg);
  });
  it("null/坏字符串/坏结构 → 空配置", () => {
    expect(normalizeSelfHostedLlm(null)).toEqual({ url: "", apiKey: "", models: [] });
    expect(normalizeSelfHostedLlm("not json")).toEqual({ url: "", apiKey: "", models: [] });
    expect(normalizeSelfHostedLlm({ url: 123, models: "x" })).toEqual({ url: "", apiKey: "", models: [] });
  });
  it("models 内非法项被剔除、label 缺省取 id", () => {
    const r = normalizeSelfHostedLlm({ url: "http://h", models: [{ id: "a" }, { label: "no-id" }, { id: "b", label: "B" }] });
    expect(r.models).toEqual([{ id: "a", label: "a" }, { id: "b", label: "B" }]);
  });
});
