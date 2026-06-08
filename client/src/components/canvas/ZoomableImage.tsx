import { MediaImage } from "./MediaImage";
import { openNodeImage } from "./NodeImageLightbox";

/**
 * 节点内参考图/预览图的统一渲染：宽度撑满、**高度自适应**（object-contain，不裁切），
 * 点击放大到画布级灯箱。替换各节点里固定高度 + object-cover + 无点击的零散写法。
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
        display: "block", width: "100%", height: "auto", maxHeight,
        objectFit: "contain", borderRadius: radius, cursor: "zoom-in",
        ...(border ? { border } : {}),
        ...style,
      }}
    />
  );
}
