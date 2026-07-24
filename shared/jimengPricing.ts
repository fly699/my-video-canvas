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

/** 计价签名：provider + 影响价格的参数（模型版本/分辨率/时长）。缺省值归一，保证同组合同签名。 */
export function jimengPriceSignature(provider: string, params?: Record<string, unknown> | null): string {
  const mv = String((params?.model_version ?? "") || "");
  const res = String((params?.video_resolution ?? "") || "");
  const durRaw = Number(params?.duration);
  const dur = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : 0;
  return `${provider}|${mv}|${res}|${dur}`;
}
