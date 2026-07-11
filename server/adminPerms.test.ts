import { describe, it, expect } from "vitest";
import { effectiveTabAccess, effectiveTabLevels, DEFAULT_TAB_LEVELS, EDITABLE_TAB_KEYS } from "../shared/adminPerms";

describe("管理后台权限矩阵（effectiveTabAccess 二维 view/operate）", () => {
  it("默认矩阵：日志三页 + 聊天管理 view=operate=4，白名单/下载审批 3/3，权限管理恒 5/5", () => {
    const m = effectiveTabAccess(null);
    expect(m.logs).toEqual({ view: 4, operate: 4 });
    expect(m.comfyLogs).toEqual({ view: 4, operate: 4 });
    expect(m.llmLogs).toEqual({ view: 4, operate: 4 });
    expect(m.chat).toEqual({ view: 4, operate: 4 });
    expect(m.whitelist).toEqual({ view: 3, operate: 3 });
    expect(m.downloads).toEqual({ view: 3, operate: 3 });
    expect(m.perms).toEqual({ view: 5, operate: 5 });
  });

  it("二维覆盖生效：可把 view 降到 operate 以下启用只读层", () => {
    const m = effectiveTabAccess({ logs: { view: 2, operate: 4 } });
    expect(m.logs).toEqual({ view: 2, operate: 4 });
  });

  it("不变量 view ≤ operate：view 高于 operate 时被压到 operate", () => {
    const m = effectiveTabAccess({ storage: { view: 5, operate: 2 } });
    expect(m.storage).toEqual({ view: 2, operate: 2 });
  });

  it("兼容旧格式：数字覆盖值 → {view:n, operate:n}", () => {
    const m = effectiveTabAccess({ logs: 5, chat: 2 });
    expect(m.logs).toEqual({ view: 5, operate: 5 });
    expect(m.chat).toEqual({ view: 2, operate: 2 });
  });

  it("非法键丢弃；级别越界回退默认；perms 恒 5/5 不可下放", () => {
    const m = effectiveTabAccess({ evilTab: 1, storage: { view: 99, operate: 0 }, perms: { view: 1, operate: 1 } });
    expect("evilTab" in m).toBe(false);
    expect(m.storage).toEqual({ view: 1, operate: 1 }); // 99/0 越界 → 回退默认 storage=1/1
    expect(m.perms).toEqual({ view: 5, operate: 5 });
  });

  it("兼容导出 effectiveTabLevels 仍返回 view 一维映射", () => {
    const m = effectiveTabLevels({ logs: { view: 2, operate: 4 } });
    expect(m.logs).toBe(2);
    expect(m.perms).toBe(5);
  });

  it("EDITABLE_TAB_KEYS 覆盖全部 tab（除 perms）", () => {
    expect(EDITABLE_TAB_KEYS).not.toContain("perms");
    expect(EDITABLE_TAB_KEYS.length).toBe(Object.keys(DEFAULT_TAB_LEVELS).length - 1);
  });
});
