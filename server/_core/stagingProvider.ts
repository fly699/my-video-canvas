// #234 通用暂存通道的「生效 provider」解析——单一决策源（纯函数，便于单测）。
//
// 设置语义（storageSettings.uploadStagingProvider）：
//   "poyo" / "kie" / "off" —— 管理员在后台显式选择的通道；
//   ""（历史默认/未设置）—— 向后兼容：沿用旧布尔 poyoUploadFallback 的语义
//     （true=Poyo、false=关闭），保证升级后老部署行为逐字节不变。
// Key 守卫：选中的通道缺对应 API Key 时一律回落 "off"（与旧门控
// 「poyoUploadFallback && ENV.poyoApiKey」同构），绝不带病上传。
export type StagingProvider = "off" | "poyo" | "kie";

export const STAGING_PROVIDER_LABEL: Record<StagingProvider, string> = {
  off: "关闭",
  poyo: "Poyo",
  kie: "Kie",
};

export function resolveStagingProvider(
  settings: { uploadStagingProvider?: string | null; poyoUploadFallback: boolean },
  keys: { hasPoyoKey: boolean; hasKieKey: boolean },
): StagingProvider {
  const explicit = (settings.uploadStagingProvider ?? "").trim();
  const want: StagingProvider =
    explicit === "poyo" || explicit === "kie" || explicit === "off"
      ? explicit
      : settings.poyoUploadFallback ? "poyo" : "off";
  if (want === "poyo" && !keys.hasPoyoKey) return "off";
  if (want === "kie" && !keys.hasKieKey) return "off";
  return want;
}
