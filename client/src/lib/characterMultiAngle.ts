// #262 角色「一键多视角」结果落地口径（纯函数，单测锁死）。
//
// 血泪背景：多视角原实现无条件把三视图正面切片写成 referenceImageUrl——用户先用
// 「一键定妆照」精心生成的定妆照被直接覆盖丢失（备用视角也被整组替换），且新图与
// 定妆照身份是否一致全凭生成模型脸色。用户拍板的正确语义：
//   「有定妆照时应以定妆照为参考生成多角度，而不是覆盖它」。
//
// 两种口径（以“调用时是否已有主参考图”分流）：
//  1. 已有主参考图（定妆照/上传主图）→ 主图【绝不动】：三视图全部切片进备用视角
//     （新切片排前、原备用保留在后，去重并剔除与主图重复项，截断到上限）。
//     生成请求本身已把主图作为参考图传给模型（云端 edit 管线 / 本地 img2img），
//     此处只管结果归位。
//  2. 无主参考图 → 维持历史行为零回归：正面切片设为主图，其余进备用。
//
// 纯函数：不改入参 payload；返回值是 updateNodeData 的增量 patch。
export function multiAngleResultPatch(
  payload: { referenceImageUrl?: string; additionalImageUrls?: (string | undefined | null)[] },
  slicedUrls: string[],
  maxAdditional: number,
): {
  referenceImageUrl?: string;
  referenceStorageKey?: undefined;
  additionalImageUrls: string[];
} {
  const oldMain = payload.referenceImageUrl?.trim();
  const extras = (payload.additionalImageUrls ?? [])
    .map((u) => (u ?? "").trim())
    .filter(Boolean);
  const cleaned = slicedUrls.map((u) => (u ?? "").trim()).filter(Boolean);

  if (oldMain) {
    // 口径 1：定妆照在位——主图字段完全不出现在 patch 里（连 undefined 都不写，
    // 防止 updateNodeData 合并语义把主图清空），仅更新备用视角。
    return {
      additionalImageUrls: Array.from(
        new Set([...cleaned.filter((u) => u !== oldMain), ...extras.filter((u) => u !== oldMain)]),
      ).slice(0, maxAdditional),
    };
  }
  // 口径 2：无主图——与旧行为逐字段一致（front→主图 + 清 storageKey，rest→备用）。
  const [front, ...rest] = cleaned;
  return {
    referenceImageUrl: front,
    referenceStorageKey: undefined,
    additionalImageUrls: rest.slice(0, maxAdditional),
  };
}

/** #262 有参考图时给三视图提示词追加的身份约束句（英文，与 grid 提示词同语言）。
 *  edit/i2i 模型同时收到「参考图 + 文字」，不点名“以参考图角色为准”时文字描述权重
 *  往往压过图像身份 → 产出与定妆照无关的人。集中成常量便于两条生成路径（云端/本地
 *  ComfyUI）共用同一句式，也便于单测断言。 */
export const MULTI_ANGLE_IDENTITY_CLAUSE =
  ", depicting the exact same character as the reference image — keep the identical face, hairstyle, outfit, colors and proportions, only change the viewing angle";
