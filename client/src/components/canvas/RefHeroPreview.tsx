import { MediaImage } from "./MediaImage";

/**
 * 收缩态 hero 兜底预览：当生成/出图/出视频节点「尚无结果、但已挂参考图」时，
 * 用参考图作为节点收缩后的 hero 预览（左上角带「参考图」角标）。
 *
 * 背景：工作室皮肤下收缩节点没有 inline body，若 hero 仅在「已出结果」时渲染，
 * 只传了参考图、还没生成的节点收缩后只剩一条标题栏——参考图完全看不见。
 * 各图像/视频/分镜/ComfyUI 节点统一调用此组件，行为与角标一致。
 */
export function RefHeroPreview({ url }: { url: string }) {
  return (
    <div className="relative overflow-hidden" style={{ width: "100%", background: "var(--c-canvas)" }}>
      <MediaImage
        src={url}
        alt="参考图"
        className="w-full"
        draggable={false}
        style={{ display: "block", objectFit: "contain", maxHeight: 240 }}
      />
      <span
        className="absolute top-1.5 left-1.5 z-10 rounded-md pointer-events-none"
        style={{ fontSize: 9.5, fontWeight: 700, color: "#fff", background: "oklch(0 0 0 / 0.55)", padding: "2px 7px" }}
      >
        参考图
      </span>
    </div>
  );
}
