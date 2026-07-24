// #334 即梦实测积分自学习计价库——共享纯逻辑（客户端显示 + 服务端记录/核算/风控共用单一源）。
// 即梦 CLI 每次生成成功回显 credit_count（真实积分消耗）。按 signature 聚合：
//   signature = provider|model_version|video_resolution|duration
// 用过一次即得真实计价；显示、核算、风控都读同一张表（DB 持久化，见 drizzle jimeng_price_stats）。

export interface JimengPriceEntry {
  signature: string;
  provider: string;
  modelVersion: string;
  resolution: string;
  duration: number;
  lastCredit: number;   // 最近一次消耗（用于显示）
  minCredit: number;
  maxCredit: number;
  sampleCount: number;  // 样本数（越多越可信）
  updatedAt: number;    // ms
}

/** 计价签名：provider + 影响价格的参数（模型版本/分辨率/时长）。缺省值归一，保证同组合同签名。
 *  #337 兼容生图：分辨率取 video_resolution（视频）或 resolution_type（生图）；生图另按
 *  generate_num 追加 `|nN` 段（同分辨率不同张数价不同）。视频参数无 generate_num → 段不追加，
 *  签名格式与原来逐字节一致（现有 video 计价与测试不受影响）。 */
export function jimengPriceSignature(provider: string, params?: Record<string, unknown> | null): string {
  const mv = String((params?.model_version ?? "") || "");
  const res = String((params?.video_resolution ?? params?.resolution_type ?? "") || "");
  const durRaw = Number(params?.duration);
  const dur = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : 0;
  const gnRaw = Number(params?.generate_num);
  const gn = Number.isFinite(gnRaw) && gnRaw > 0 ? Math.round(gnRaw) : 0;
  const base = `${provider}|${mv}|${res}|${dur}`;
  return gn > 0 ? `${base}|n${gn}` : base;
}
