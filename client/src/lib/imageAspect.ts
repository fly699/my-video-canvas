// 源图比例继承工具：所有「以原图为输入」的 AI 功能（画面推演/宫格套件/图像编辑/
// 多角度/打光等）都必须把源图画幅传给模型，否则上游按各自默认出方图/横图——
// 真实故障：1937×812 宽幅源图推演出 960×960；kie 编辑模型未传比例被强制 1:1。
// 服务端还会按具体模型的比例枚举就近夹取（kieImage.clampAspectTo），这里只负责
// 「读出源图真实宽高 → 就近落到常用比例串」。

/** 常用比例候选（与各模型枚举的交集为主；服务端会再按模型枚举就近夹取）。 */
export const ASPECT_CANDIDATES = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16", "9:21"] as const;

/** 数值宽高比 → 就近的比例串（对数距离，宽幅/竖幅对称公平）。 */
export function nearestAspect(ratio: number, candidates: readonly string[] = ASPECT_CANDIDATES): string | undefined {
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  let best: string | undefined;
  let bd = Infinity;
  for (const c of candidates) {
    const [a, b] = c.split(":").map(Number);
    if (!a || !b) continue;
    const d = Math.abs(Math.log(a / b / ratio));
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** 读图片自然宽高比（浏览器缓存命中时近乎零开销）；读不出返回 undefined。 */
export function imageNaturalRatio(url: string): Promise<number | undefined> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      res(w > 0 && h > 0 ? w / h : undefined);
    };
    img.onerror = () => res(undefined);
    img.src = url;
  });
}

/** 源图 URL → 就近比例串；失败返回 undefined（调用方不传比例，保持旧行为兜底）。 */
export async function sourceAspectRatio(url: string): Promise<string | undefined> {
  const r = await imageNaturalRatio(url);
  return r ? nearestAspect(r) : undefined;
}
