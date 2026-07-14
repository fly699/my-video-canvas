import { describe, it, expect } from "vitest";
import {
  isNodelessId, makeNodelessId, addSession, removeSession, updateSession, sortSessions,
  type NodelessSession,
} from "./aiClientNodeless";

const S = (id: string, updatedAt: number, title = "会话"): NodelessSession => ({ id, title, updatedAt });

describe("isNodelessId / makeNodelessId", () => {
  it("makeNodelessId 加 sess- 前缀，isNodelessId 据此判定", () => {
    const id = makeNodelessId("abc123");
    expect(id).toBe("sess-abc123");
    expect(isNodelessId(id)).toBe(true);
  });
  it("非 sess- 前缀（画布节点 id）/空值 → false", () => {
    expect(isNodelessId("node_xyz")).toBe(false);
    expect(isNodelessId("")).toBe(false);
    expect(isNodelessId(null)).toBe(false);
    expect(isNodelessId(undefined)).toBe(false);
  });
});

describe("addSession", () => {
  it("新增置顶，且按 id 去重（同 id 覆盖到最前）", () => {
    const list = [S("sess-a", 1), S("sess-b", 2)];
    const r = addSession(list, S("sess-c", 3));
    expect(r.map((x) => x.id)).toEqual(["sess-c", "sess-a", "sess-b"]);
    const r2 = addSession(r, S("sess-a", 9, "改名"));
    expect(r2.map((x) => x.id)).toEqual(["sess-a", "sess-c", "sess-b"]);
    expect(r2[0].title).toBe("改名");
    expect(r2.filter((x) => x.id === "sess-a")).toHaveLength(1);
  });
});

describe("removeSession", () => {
  it("按 id 删除；不存在的 id 原样返回", () => {
    const list = [S("sess-a", 1), S("sess-b", 2)];
    expect(removeSession(list, "sess-a").map((x) => x.id)).toEqual(["sess-b"]);
    expect(removeSession(list, "zzz").map((x) => x.id)).toEqual(["sess-a", "sess-b"]);
  });
});

describe("updateSession", () => {
  it("按 id 合并 patch，仅改中目标、其余不动", () => {
    const list = [S("sess-a", 1, "甲"), S("sess-b", 2, "乙")];
    const r = updateSession(list, "sess-b", { title: "新乙", model: "gpt", updatedAt: 5 });
    expect(r.find((x) => x.id === "sess-b")).toMatchObject({ title: "新乙", model: "gpt", updatedAt: 5 });
    expect(r.find((x) => x.id === "sess-a")).toEqual(S("sess-a", 1, "甲"));
  });
  it("不存在的 id → 原样返回", () => {
    const list = [S("sess-a", 1)];
    expect(updateSession(list, "zzz", { title: "x" })).toEqual(list);
  });
});

describe("sortSessions", () => {
  it("按 updatedAt 降序（最近在前），不改原数组", () => {
    const list = [S("sess-a", 1), S("sess-b", 3), S("sess-c", 2)];
    const r = sortSessions(list);
    expect(r.map((x) => x.id)).toEqual(["sess-b", "sess-c", "sess-a"]);
    expect(list.map((x) => x.id)).toEqual(["sess-a", "sess-b", "sess-c"]); // 原数组不变
  });
});
