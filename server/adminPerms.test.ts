import { describe, it, expect } from "vitest";
import { effectiveTabAccess, effectiveTabLevels, DEFAULT_TAB_LEVELS, EDITABLE_TAB_KEYS, adminTabFromRpcPath } from "../shared/adminPerms";

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

  // #238 文件暂存页：登记入矩阵（任意管理员可见；upload 另有静态地板 L2，矩阵只能收紧）
  it("staging 页已登记入矩阵且 admin.staging.* 正确归属", () => {
    expect(DEFAULT_TAB_LEVELS.staging).toBe(1);
    expect(EDITABLE_TAB_KEYS).toContain("staging");
    expect(adminTabFromRpcPath("admin.staging.upload")).toBe("staging");
    expect(adminTabFromRpcPath("admin.staging.info")).toBe("staging");
  });
});

describe("adminTabFromRpcPath：路径 → 受矩阵约束的 tab", () => {
  it("admin.* 子路由与别名正确归属；豁免端点返回 null", () => {
    expect(adminTabFromRpcPath("admin.logs.list")).toBe("logs");
    expect(adminTabFromRpcPath("admin.logEmail.getSettings")).toBe("logs");   // 别名
    expect(adminTabFromRpcPath("admin.update.available")).toBe("system");     // 别名
    expect(adminTabFromRpcPath("admin.whitelist.listEntries")).toBe("whitelist");
    expect(adminTabFromRpcPath("admin.whitelist.getSettings")).toBeNull();    // 豁免
    expect(adminTabFromRpcPath("admin.chat.broadcast")).toBeNull();           // 豁免
    expect(adminTabFromRpcPath("admin.perms.set")).toBeNull();                // 豁免
  });

  it("命名空间外的后台管理端点也正确归属 tab（否则矩阵漏管、API 可绕过）", () => {
    expect(adminTabFromRpcPath("comfyStress.start")).toBe("comfyStress");
    expect(adminTabFromRpcPath("comfyStress.presets.save")).toBe("comfyStress"); // 嵌套子路由仍前缀匹配
    expect(adminTabFromRpcPath("comfyOps.exec")).toBe("comfyOps");
    expect(adminTabFromRpcPath("comfyui.setGlobalServers")).toBe("comfyServers"); // 精确路径
  });

  it("画布共享 / 用户只读端点不被误纳（避免误伤普通用户）", () => {
    expect(adminTabFromRpcPath("comfyui.serverStatus")).toBeNull();  // protected 只读
    expect(adminTabFromRpcPath("comfyui.globalServers")).toBeNull(); // protected 只读
    expect(adminTabFromRpcPath("comfyui.generate")).toBeNull();      // 用户生成
    expect(adminTabFromRpcPath("canvas.list")).toBeNull();
    expect(adminTabFromRpcPath("chat.getMessages")).toBeNull();      // 非 admin.chat
    expect(adminTabFromRpcPath(null)).toBeNull();
  });
});
