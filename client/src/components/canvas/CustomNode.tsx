import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { ScriptNode } from "./nodes/ScriptNode";
import { StoryboardNode } from "./nodes/StoryboardNode";
import { PromptNode } from "./nodes/PromptNode";
import { AssetNode } from "./nodes/AssetNode";
import { VideoTaskNode } from "./nodes/VideoTaskNode";
import { AIChatNode } from "./nodes/AIChatNode";
import { NoteNode } from "./nodes/NoteNode";
import { ImageGenNode } from "./nodes/ImageGenNode";
import { AudioNode } from "./nodes/AudioNode";
import { PostProcessNode } from "./nodes/PostProcessNode";
import { GroupNode } from "./nodes/GroupNode";
import { CharacterNode } from "./nodes/CharacterNode";
import { ClipNode } from "./nodes/ClipNode";
import { MergeNode } from "./nodes/MergeNode";
import { SubtitleNode } from "./nodes/SubtitleNode";
import { OverlayNode } from "./nodes/OverlayNode";
import { SubtitleMotionNode } from "./nodes/SubtitleMotionNode";
import { SmartCutNode } from "./nodes/SmartCutNode";
import { PoseControlNode } from "./nodes/PoseControlNode";
import { VoiceCloneNode } from "./nodes/VoiceCloneNode";
import { LipSyncNode } from "./nodes/LipSyncNode";
import { AvatarNode } from "./nodes/AvatarNode";
import { ComfyuiImageNode } from "./nodes/ComfyuiImageNode";
import { ComfyuiVideoNode } from "./nodes/ComfyuiVideoNode";
import { ComfyuiWorkflowNode } from "./nodes/ComfyuiWorkflowNode";
import { AgentNode } from "./nodes/AgentNode";
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
    case "image_gen":
      return <ImageGenNode {...(props as unknown as AnyNodeProps)} />;
    case "asset":
      return <AssetNode {...(props as unknown as AnyNodeProps)} />;
    case "video_task":
      return <VideoTaskNode {...(props as unknown as AnyNodeProps)} />;
    case "ai_chat":
      return <AIChatNode {...(props as unknown as AnyNodeProps)} />;
    case "note":
      return <NoteNode {...(props as unknown as AnyNodeProps)} />;
    case "audio":
      return <AudioNode {...(props as unknown as AnyNodeProps)} />;
    case "post_process":
      return <PostProcessNode {...(props as unknown as AnyNodeProps)} />;
    case "group":
      return <GroupNode {...(props as unknown as AnyNodeProps)} />;
    case "character":
      return <CharacterNode {...(props as unknown as AnyNodeProps)} />;
    case "clip":
      return <ClipNode {...(props as unknown as AnyNodeProps)} />;
    case "merge":
      return <MergeNode {...(props as unknown as AnyNodeProps)} />;
    case "subtitle":
      return <SubtitleNode {...(props as unknown as AnyNodeProps)} />;
    case "overlay":
      return <OverlayNode {...(props as unknown as AnyNodeProps)} />;
    case "subtitle_motion":
      return <SubtitleMotionNode {...(props as unknown as AnyNodeProps)} />;
    case "smart_cut":
      return <SmartCutNode {...(props as unknown as AnyNodeProps)} />;
    case "pose_control":
      return <PoseControlNode {...(props as unknown as AnyNodeProps)} />;
    case "voice_clone":
      return <VoiceCloneNode {...(props as unknown as AnyNodeProps)} />;
    case "lip_sync":
      return <LipSyncNode {...(props as unknown as AnyNodeProps)} />;
    case "avatar":
      return <AvatarNode {...(props as unknown as AnyNodeProps)} />;
    case "comfyui_image":
      return <ComfyuiImageNode {...(props as unknown as AnyNodeProps)} />;
    case "comfyui_video":
      return <ComfyuiVideoNode {...(props as unknown as AnyNodeProps)} />;
    case "comfyui_workflow":
      return <ComfyuiWorkflowNode {...(props as unknown as AnyNodeProps)} />;
    case "agent":
      return <AgentNode {...(props as unknown as AnyNodeProps)} />;
    default:
      return null;
  }
});
