import { MediaImage } from "./MediaImage";
import { openNodeImage } from "./NodeImageLightbox";

/**
 * 节点内参考图/预览图的统一渲染：**按图片真实比例自适应**（宽高都不超过容器/上限、
 * 不裁切、不留黑边）——竖图自动变窄变高、横图铺满宽度，点击放大到画布级灯箱。
 */
export function ZoomableImage({
  src, alt = "", maxHeight = 160, radius = 8, border, className, style,
}: {
  src: string;
  alt?: string;
  maxHeight?: number;
  radius?: number;
  border?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <MediaImage
      src={src}
      alt={alt}
      draggable={false}
      className={`nodrag ${className ?? ""}`}
      title="点击放大"
      onClick={(e) => { e.stopPropagation(); openNodeImage(src); }}
      style={{
        display: "block", width: "auto", height: "auto", maxWidth: "100%", maxHeight,
        margin: "0 auto", borderRadius: radius, cursor: "zoom-in",
        ...(border ? { border } : {}),
        ...style,
      }}
    />
  );
}
