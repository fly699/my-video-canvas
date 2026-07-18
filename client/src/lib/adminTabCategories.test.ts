// #243 分类守卫：每个后台 tab 恰好归属一个分类，且与权限矩阵键集合完全一致——
// 新增 tab 忘记归类 / 重复归类 / 分类里写了不存在的 tab，此测试都会当场失败。
import { describe, it, expect } from "vitest";
import { ADMIN_TAB_CATEGORIES, categoryOfTab } from "./adminTabCategories";
import { DEFAULT_TAB_LEVELS } from "../../../shared/adminPerms";
import { ADMIN_TABS } from "./adminNav";

describe("ADMIN_TAB_CATEGORIES 守卫", () => {
  it("分类并集 = 权限矩阵全部 tab 键，且无重复归类", () => {
    const all = ADMIN_TAB_CATEGORIES.flatMap((c) => c.tabs);
    expect(new Set(all).size, "存在重复归类的 tab").toBe(all.length);
    const expected = Object.keys(DEFAULT_TAB_LEVELS).sort();
    expect([...all].sort()).toEqual(expected);
  });

  it("深链白名单 ADMIN_TABS 与分类并集一致（#238 曾漏 staging 导致 ?tab=staging 失效）", () => {
    const all = ADMIN_TAB_CATEGORIES.flatMap((c) => c.tabs).sort();
    expect([...ADMIN_TABS].sort()).toEqual(all);
  });

  it("categoryOfTab 正确归属", () => {
    expect(categoryOfTab("staging").key).toBe("resource");
    expect(categoryOfTab("perms").key).toBe("access");
    expect(categoryOfTab("tutorialImgs").key).toBe("content");
    expect(categoryOfTab("system").key).toBe("system");
  });

  it("分类 key/label 唯一", () => {
    const keys = ADMIN_TAB_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = ADMIN_TAB_CATEGORIES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
