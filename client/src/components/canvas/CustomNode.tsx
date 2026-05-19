import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { ScriptNode } from "./nodes/ScriptNode";
import { StoryboardNode } from "./nodes/StoryboardNode";
import { PromptNode } from "./nodes/PromptNode";
import { AssetNode } from "./nodes/AssetNode";
import { VideoTaskNode } from "./nodes/VideoTaskNode";
import { AIChatNode } from "./nodes/AIChatNode";
import { NoteNode } from "./nodes/NoteNode";
import type { NodeType } from "../../../../shared/types";

interface CustomNodeData {
  nodeType: NodeType;
  title: string;
  payload: Record<string, unknown>;
  projectId: number;
}

// Use unknown as intermediate to avoid TypeScript overlap errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNodeProps = NodeProps<any>;

export const CustomNode = memo(function CustomNode(props: NodeProps) {
  const data = props.data as unknown as CustomNodeData;

  switch (data.nodeType) {
    case "script":
      return <ScriptNode {...(props as unknown as AnyNodeProps)} />;
    case "storyboard":
      return <StoryboardNode {...(props as unknown as AnyNodeProps)} />;
    case "prompt":
      return <PromptNode {...(props as unknown as AnyNodeProps)} />;
    case "asset":
      return <AssetNode {...(props as unknown as AnyNodeProps)} />;
    case "video_task":
      return <VideoTaskNode {...(props as unknown as AnyNodeProps)} />;
    case "ai_chat":
      return <AIChatNode {...(props as unknown as AnyNodeProps)} />;
    case "note":
      return <NoteNode {...(props as unknown as AnyNodeProps)} />;
    default:
      return null;
  }
});
