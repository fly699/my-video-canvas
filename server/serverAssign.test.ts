import { describe, it, expect } from "vitest";
import { normalizeServers, assignServersRoundRobin, pickLeastLoaded } from "./_core/superAgent/serverAssign";

describe("normalizeServers", () => {
  it("去尾斜杠 + 去空 + 去重", () => {
    expect(normalizeServers(["http://a:1/", "http://a:1", " http://b:2 ", "", null, undefined]))
      .toEqual(["http://a:1", "http://b:2"]);
  });
});

describe("assignServersRoundRobin", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ op: "create", nodeType: "super_agent", payload: {} as Record<string, unknown> }));
  it("轮询分配到各 super_agent 节点", () => {
    const ops = mk(5);
    const count = assignServersRoundRobin(ops, ["http://a", "http://b"]);
    expect(count).toBe(5);
    expect(ops.map((o) => o.payload.customBaseUrl)).toEqual(["http://a", "http://b", "http://a", "http://b", "http://a"]);
  });
  it("尊重已指定地址的节点，不覆盖", () => {
    const ops = [
      { op: "create", nodeType: "super_agent", payload: { customBaseUrl: "http://fixed" } as Record<string, unknown> },
      { op: "create", nodeType: "super_agent", payload: {} as Record<string, unknown> },
    ];
    const count = assignServersRoundRobin(ops, ["http://a", "http://b"]);
    expect(count).toBe(1);
    expect(ops[0].payload.customBaseUrl).toBe("http://fixed");
    expect(ops[1].payload.customBaseUrl).toBe("http://a");
  });
  it("只动 super_agent create，不碰其它节点/操作", () => {
    const ops = [
      { op: "create", nodeType: "image_gen", payload: {} as Record<string, unknown> },
      { op: "connect", payload: {} as Record<string, unknown> },
      { op: "create", nodeType: "super_agent", payload: {} as Record<string, unknown> },
    ];
    assignServersRoundRobin(ops, ["http://a"]);
    expect(ops[0].payload.customBaseUrl).toBeUndefined();
    expect(ops[2].payload.customBaseUrl).toBe("http://a");
  });
  it("服务器池为空 → 不分配", () => {
    const ops = mk(3);
    expect(assignServersRoundRobin(ops, [])).toBe(0);
    expect(ops.every((o) => o.payload.customBaseUrl === undefined)).toBe(true);
  });
});

describe("pickLeastLoaded", () => {
  it("取在飞负载最少的一台", () => {
    const load = new Map([["http://a", 3], ["http://b", 1], ["http://c", 2]]);
    expect(pickLeastLoaded(["http://a", "http://b", "http://c"], load)).toBe("http://b");
  });
  it("负载相同 → 取靠前者", () => {
    expect(pickLeastLoaded(["http://a", "http://b"], new Map())).toBe("http://a");
  });
  it("池空 → undefined", () => {
    expect(pickLeastLoaded([], new Map())).toBeUndefined();
  });
});
