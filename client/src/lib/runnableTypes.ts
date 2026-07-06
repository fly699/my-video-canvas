import type { NodeType } from "../../../shared/types";

/** 「可运行」的节点类型（有生成/处理动作、参与「运行全部」拓扑执行的类型）。
 *  独立成纯模块：preflight 等纯逻辑只需这份常量，不应为它 import 整个 useWorkflowRunner
 *  （那会把 VideoTaskNode 等重组件拉进纯/测试环境，触发 React 未定义等加载错误）。 */
export const RUNNABLE_TYPES: NodeType[] = [
  "storyboard", "prompt", "image_gen", "video_task",
  "clip", "merge", "subtitle", "overlay",
  "subtitle_motion", "smart_cut",
  "comfyui_image", "comfyui_video", "comfyui_workflow",
];
