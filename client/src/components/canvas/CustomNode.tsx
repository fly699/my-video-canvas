import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useBoxSelecting } from "../../hooks/useBoxSelecting";
import { useNodeExpandable } from "../../hooks/useNodeExpandGuard";
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
import { ImageEditNode } from "./nodes/ImageEditNode";
import { DirectorNode } from "./nodes/DirectorNode";
import { AgentNode } from "./nodes/AgentNode";
import { SuperAgentNode } from "./nodes/SuperAgentNode";
import { CompareNode } from "./nodes/CompareNode";
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
  // 把 selected 压成 false 再传给节点组件，让所有节点的「选中即展开配置区」（不管是用
  // NodeSelectedContext 还是**直接读 selected prop**——如 ImageGen/Audio/Comfyui/Note 等）
  // 都统一不触发，避免画布被撑乱。选中描边不受影响——BaseNode 的描边读 store 真实选中态。
  // 触发条件（单一 choke point，覆盖全部节点类型）：
  //   ① 多选（≥2 选中）——批量操作交给底部命令栏；
  //   ② 框选(橡皮筋)进行中——框内瞬时只覆盖 1 个也不闪展开；
  //   ③ 该节点因拖拽/框选而选中（gesture 抑制集）——直到被真点击才展开。
  const multiSelected = useCanvasStore((s) => {
    let c = 0;
    for (const n of s.nodes) { if (n.selected) { c++; if (c > 1) return true; } }
    return false;
  });
  const boxSelecting = useBoxSelecting();
  const expandable = useNodeExpandable(props.id);
  if (props.selected && (multiSelected || boxSelecting || !expandable)) props = { ...props, selected: false };

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
    case "compare":
      return <CompareNode {...(props as unknown as AnyNodeProps)} />;
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
    case "image_edit":
      return <ImageEditNode {...(props as unknown as AnyNodeProps)} />;
    case "director":
      return <DirectorNode {...(props as unknown as AnyNodeProps)} />;
    case "agent":
      return <AgentNode {...(props as unknown as AnyNodeProps)} />;
    case "super_agent":
      return <SuperAgentNode {...(props as unknown as AnyNodeProps)} />;
    default:
      return null;
  }
});
