import { describe, it, expect } from "vitest";
import { effectiveTabLevels, DEFAULT_TAB_LEVELS, EDITABLE_TAB_KEYS } from "../shared/adminPerms";

describe("管理后台权限矩阵（effectiveTabLevels）", () => {
  it("默认矩阵：日志三页 + 聊天管理 = L4，白名单/下载审批 = L3，权限管理恒 L5", () => {
    const m = effectiveTabLevels(null);
    expect(m.logs).toBe(4);
    expect(m.comfyLogs).toBe(4);
    expect(m.llmLogs).toBe(4);
    expect(m.chat).toBe(4);
    expect(m.whitelist).toBe(3);
    expect(m.downloads).toBe(3);
    expect(m.perms).toBe(5);
  });

  it("覆盖值生效；非法键丢弃；级别钳制 1~5；perms 不可下放", () => {
    const m = effectiveTabLevels({ logs: 5, chat: 2, evilTab: 1, storage: 99, models: 0, perms: 1 });
    expect(m.logs).toBe(5);
    expect(m.chat).toBe(2);
    expect("evilTab" in m).toBe(false);
    expect(m.storage).toBe(DEFAULT_TAB_LEVELS.storage); // 99 越界丢弃
    expect(m.models).toBe(DEFAULT_TAB_LEVELS.models);   // 0 越界丢弃
    expect(m.perms).toBe(5);                            // 恒 5
  });

  it("EDITABLE_TAB_KEYS 覆盖全部 tab（除 perms）", () => {
    expect(EDITABLE_TAB_KEYS).not.toContain("perms");
    expect(EDITABLE_TAB_KEYS.length).toBe(Object.keys(DEFAULT_TAB_LEVELS).length - 1);
  });
});
