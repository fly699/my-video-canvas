import { memo } from "react";
import { BaseNode } from "../BaseNode";
import { PersonStanding, Lock } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "avatar";
    title: string;
    payload: Record<string, unknown>;
    projectId: number;
  };
}

const accent = "oklch(0.65 0.20 290)";
const accentA = (a: number) => `oklch(0.65 0.20 290 / ${a})`;

export const AvatarNode = memo(function AvatarNode({ id, selected, data }: Props) {
  return (
    <BaseNode id={id} selected={selected} nodeType="avatar" title={data.title} minHeight={120}>
      <div className="flex flex-col items-center gap-3 p-4 text-center">
        <div className="flex items-center justify-center w-10 h-10 rounded-full" style={{ background: accentA(0.12), border: `1px solid ${accentA(0.4)}` }}>
          <PersonStanding style={{ width: 18, height: 18, color: accent }} />
        </div>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 4 }}>数字人</p>
          <div className="flex items-center justify-center gap-1.5">
            <Lock style={{ width: 10, height: 10, color: "var(--c-t4)" }} />
            <p style={{ fontSize: 10, color: "var(--c-t4)" }}>需要配置 D-ID API Key</p>
          </div>
        </div>
        <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.6 }}>
          输入脚本和数字人形象，自动生成带口型的数字人讲解视频
        </p>
        <div className="px-3 py-1.5 rounded-lg w-full" style={{ background: accentA(0.06), border: `1px dashed ${accentA(0.35)}` }}>
          <p style={{ fontSize: 9, color: accent }}>即将上线 · Deferred pending API Key</p>
        </div>
      </div>
    </BaseNode>
  );
});
