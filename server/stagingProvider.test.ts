import { describe, it, expect } from "vitest";
import { resolveStagingProvider } from "./_core/stagingProvider";

const KEYS_BOTH = { hasPoyoKey: true, hasKieKey: true };

// #234 通用暂存通道解析：显式选择优先，""（老部署）沿用旧布尔语义，缺 Key 回落 off。
describe("resolveStagingProvider", () => {
  it("向后兼容：未设置 + 旧开关开 → poyo（老部署升级后行为不变）", () => {
    expect(resolveStagingProvider({ uploadStagingProvider: "", poyoUploadFallback: true }, KEYS_BOTH)).toBe("poyo");
    expect(resolveStagingProvider({ poyoUploadFallback: true }, KEYS_BOTH)).toBe("poyo");
  });

  it("向后兼容：未设置 + 旧开关关 → off", () => {
    expect(resolveStagingProvider({ uploadStagingProvider: "", poyoUploadFallback: false }, KEYS_BOTH)).toBe("off");
  });

  it("显式选择覆盖旧布尔：kie 生效即便 poyoUploadFallback=true", () => {
    expect(resolveStagingProvider({ uploadStagingProvider: "kie", poyoUploadFallback: true }, KEYS_BOTH)).toBe("kie");
  });

  it("显式 off 覆盖旧布尔：即便 poyoUploadFallback=true 也关闭", () => {
    expect(resolveStagingProvider({ uploadStagingProvider: "off", poyoUploadFallback: true }, KEYS_BOTH)).toBe("off");
  });

  it("Key 守卫：选 poyo 但没配 POYO_API_KEY → off（绝不带病上传）", () => {
    expect(resolveStagingProvider({ uploadStagingProvider: "poyo", poyoUploadFallback: true }, { hasPoyoKey: false, hasKieKey: true })).toBe("off");
  });

  it("Key 守卫：选 kie 但没配 KIE_API_KEY → off", () => {
    expect(resolveStagingProvider({ uploadStagingProvider: "kie", poyoUploadFallback: false }, { hasPoyoKey: true, hasKieKey: false })).toBe("off");
  });

  it("非法值当作未设置（沿用旧布尔语义）", () => {
    expect(resolveStagingProvider({ uploadStagingProvider: "whatever", poyoUploadFallback: true }, KEYS_BOTH)).toBe("poyo");
    expect(resolveStagingProvider({ uploadStagingProvider: "whatever", poyoUploadFallback: false }, KEYS_BOTH)).toBe("off");
  });
});
