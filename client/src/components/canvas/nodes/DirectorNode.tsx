import { memo, useCallback } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { MediaImage } from "../MediaImage";
import { Clapperboard, Maximize2 } from "lucide-react";
import type { DirectorNodeData } from "../../../../../shared/types";
import { makeDefaultDirectorScene } from "../../../lib/directorScene";

interface Props {
  id: string;
  selected?: boolean;
  data: { nodeType: "director"; title: string; payload: DirectorNodeData; projectId: number };
}

const accent = "oklch(0.72 0.18 300)";

// 导演台节点卡片：双击或点「打开导演台」进 3D 全屏编辑器；截图输出写入 payload.imageUrl，
// 作为下游生图/视频的构图参考图。3D 编辑由 DirectorEditor（懒加载）承担，此卡片轻量。
export const DirectorNode = memo(function DirectorNode({ id, selected, data }: Props) {
  const payload = data.payload;
  const requestPanel = useCanvasStore((s) => s.requestPanel);
  const scene = payload.scene ?? makeDefaultDirectorScene();
  const open = useCallback(() => requestPanel(id, "director-editor"), [id, requestPanel]);

  const heroMedia = payload.imageUrl ? (
    <div className="relative overflow-hidden" style={{ width: "100%", cursor: "pointer" }} onDoubleClick={open}>
      <MediaImage src={payload.imageUrl} alt="director" className="w-full" draggable={false} />
    </div>
  ) : undefined;

  return (
    <BaseNode id={id} selected={selected} nodeType="director" title={data.title} minHeight={170} heroMedia={heroMedia}>
      <div
        className="flex flex-col gap-3 p-3.5"
        onDoubleClick={(e) => { if ((e.target as HTMLElement).closest("button,input,select,textarea")) return; open(); }}
      >
        <button
          onClick={open}
          className="nodrag flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: `${accent.replace(")", " / 0.16)")}`, border: `1px solid ${accent.replace(")", " / 0.45)")}`, color: accent, cursor: "pointer" }}
        >
          <Clapperboard style={{ width: 14, height: 14 }} /> 打开导演台（3D 构图）
        </button>

        <div className="flex items-center justify-between" style={{ fontSize: 11, color: "var(--c-t4)" }}>
          <span>{scene.actors.length} 个角色 · 画幅 {scene.aspectRatio} · {scene.camera.fov.toFixed(0)}°</span>
          {payload.imageUrl && (
            <button onClick={open} className="nodrag flex items-center gap-1" style={{ color: accent, background: "none", border: "none", cursor: "pointer" }} title="重新进入 / 重拍">
              <Maximize2 style={{ width: 11, height: 11 }} /> 重拍
            </button>
          )}
        </div>

        {!payload.imageUrl && (
          <p style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5, margin: 0 }}>
            在 3D 空间摆好角色站位与机位 → 截图作为构图参考图，连到生图/视频节点，提示词强调「人物站位与参考图一致」。
          </p>
        )}
      </div>
    </BaseNode>
  );
});
