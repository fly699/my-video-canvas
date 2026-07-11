import type { NodeType } from "../../../shared/types";

export const CONNECTION_MATRIX: Partial<Record<NodeType, NodeType[]>> = {
  // script → note：专业审查（Coverage）报告一键存为便签节点留档。
  // 注：曾有 script → character，但 CharacterNode 只消费图源（detectUpstreamImagesExpanded），
  // 不读任何脚本文本——连了无效，已删（角色人设走角色节点自身编辑 / 向导，不从脚本文本生成）。
  script: ["storyboard", "prompt", "ai_chat", "note"],
  // storyboard → audio：分镜的「对白/旁白」字段自动喂给下游音频节点作配音文案。
  // storyboard → image_edit：分镜生成的关键帧可再进图像编辑精修（image_edit 走 getNodeImageOutput 认 storyboard 的 imageUrl）。
  // storyboard → character/pose_control：分镜关键帧是合法图源，character 经 detectUpstreamImagesExpanded
  // （IMAGE_SOURCE_TYPES 含 storyboard）取其图作参考图、pose_control 经 getNodeImageOutput 取其图抽姿态/构图，
  // 与 image_gen/image_edit/director 等其它图源一视同仁（此前被矩阵单独拒收，属不对称缺口）。
  storyboard: ["image_gen", "image_edit", "video_task", "prompt", "comfyui_image", "comfyui_video", "comfyui_workflow", "audio", "character", "pose_control", "compare"],
  // 注：曾有 prompt → script，但 ScriptNode 不读任何上游（正文走自身编辑 / 向导 / AI 生成）——
  // 连了无效，已删。prompt 的有效去向是生图 / 视频 / 分镜 / ComfyUI。
  prompt: ["image_gen", "video_task", "storyboard", "comfyui_image", "comfyui_video", "comfyui_workflow"],
  // 注：曾有 character → prompt，但 PromptNode 只读 detectUpstreamPrompt（不含 character）——
  // 连了无效，已删。要在提示词里引用角色身份，用提示词框内的 @角色 引用（无需连线）。
  character: ["storyboard", "image_gen", "video_task", "comfyui_image", "comfyui_video", "comfyui_workflow"],
  // image_gen → storyboard：精修工位回链——分镜「送精修」后图像节点连回分镜，
  // 出图仅作为「关键帧候选」供分镜显式点「采用此图」，无任何自动写入。
  // 注：image_gen/image_edit/comfyui_image 产出的是「图像」，不能连 clip（剪辑只裁切视频，
  // 图像连进去运行时取不到视频→「未找到视频输入」）。clip 的视频源由 asset(视频)/video_task/
  // comfyui_video/comfyui_workflow(video) 提供。
  // image_gen → comfyui_image：出图可作 ComfyUI 图像的 img2img/参考图（detectUpstreamImages 的
  // IMAGE_SOURCE_TYPES 含 image_gen）；此前缺失导致「图像生成 → ComfyUI 图像」拖线弹不出该目标。
  image_gen: ["video_task", "asset", "pose_control", "character", "image_gen", "image_edit", "comfyui_image", "comfyui_video", "comfyui_workflow", "storyboard", "compare"],
  // image_edit 输出仍是一张图：可作 i2v 首帧、存素材、当角色/参考图、回链分镜关键帧、或再串一次编辑。
  image_edit: ["video_task", "asset", "pose_control", "character", "image_gen", "image_edit", "comfyui_image", "comfyui_video", "comfyui_workflow", "storyboard", "compare"],
  // 导演台输出 3D 渲染截图（同图像产出）：作构图参考图喂给生图/视频/编辑/角色/ComfyUI/分镜关键帧。
  director: ["video_task", "asset", "pose_control", "character", "image_gen", "image_edit", "comfyui_image", "comfyui_video", "comfyui_workflow", "storyboard", "compare"],
  // video_task → video_task：生成的视频可作另一视频任务的「源视频」参考——V2V/运动控制/
  // 上采样/Aleph/对口型等 provider 会经 collectVideoRefMedia 取上游视频（不支持的 provider 自动忽略，
  // 拖线无害）。这是唯一保留的同类自链（其它同类如 prompt/storyboard 仍禁止）。
  video_task: ["clip", "asset", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut", "video_task", "compare"],
  // audio → audio: 把一段音频作为本地 VoxCPM 配音的参考音色喂给下游音频节点。
  // audio → comfyui_workflow: 作为自定义工作流的音频参数来源（VHS_LoadAudioUpload 等）。
  // audio → merge：合并节点自动把连入的音频节点用作整片背景音乐（MergeNode 的
  // detectedBgMusicUrl），智能体「整体配乐连入 merge」与手动拖线都走这条。
  // audio → video_task：数字人/视频对口型（OmniHuman、Volcengine、Kling Avatar）的
  // 驱动音频——连线音频节点作为 audio_url。模型不支持音频时该连接被 collectRefMedia 忽略。
  audio: ["clip", "audio", "comfyui_workflow", "merge", "video_task"],
  asset: ["image_gen", "image_edit", "video_task", "clip", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut", "pose_control", "character", "comfyui_image", "comfyui_video", "comfyui_workflow", "audio", "compare"],
  // 注：曾有 ai_chat → script，但 ScriptNode 不读任何上游——连了无效，已删。
  ai_chat: ["storyboard", "prompt"],
  clip: ["asset", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut", "video_task", "compare"],
  post_process: ["video_task", "image_gen", "asset"],
  // 视频后处理节点（overlay/subtitle/subtitle_motion/smart_cut/clip/merge）互为视频源与视频消费者
  // （六者都在 VIDEO_SOURCE_TYPES，且各自经 autoDetectInputVideo/collectInputVideoUrls 取上游视频）。
  // 故任一后处理节点的输出都可再喂给其它任一后处理节点（叠加后加字幕、字幕后智能剪辑、合并后加动态
  // 字幕…），另可存素材(asset)与作 video_task 的 V2V 源。此前它们只允许 → asset/merge，导致「叠加→
  // 字幕」「合并→字幕」「智能剪辑→合并」等真实链路拖线/智能体建线判定失败（各节点不自链）。
  overlay: ["asset", "clip", "merge", "subtitle", "subtitle_motion", "smart_cut", "video_task", "compare"],
  subtitle: ["asset", "clip", "overlay", "merge", "subtitle_motion", "smart_cut", "video_task", "compare"],
  subtitle_motion: ["asset", "clip", "overlay", "merge", "subtitle", "smart_cut", "video_task", "compare"],
  smart_cut: ["asset", "clip", "overlay", "merge", "subtitle", "subtitle_motion", "video_task", "compare"],
  // pose_control → comfyui_image/comfyui_workflow：构图/姿态图作 ControlNet 引导图
  // （propagateControlMap 明确把姿态图推给下游 comfyui_image 的 ControlNet；comfyui_workflow 经
  // resolveWorkflowImageParams 收其图为图像参数）。→ video_task/comfyui_video：作首帧/参考图
  // （autoDetectInputImage 认 pose_control 为图源）。此前只允许 → image_gen/image_edit/asset，
  // 导致 pose_control 无法拖线到任何 ComfyUI/视频节点（与运行时实际消费不符）。
  pose_control: ["image_gen", "image_edit", "asset", "video_task", "comfyui_image", "comfyui_video", "comfyui_workflow", "compare"],
  // voice_clone / lip_sync / avatar are "即将上线" placeholders (no payload logic,
  // handles disabled) — keep them out of the matrix so we don't advertise
  // connections that can't actually be made. Restore their edges (see git
  // history) when the underlying API integration ships.
  voice_clone: [],
  lip_sync: ["compare"],
  avatar: ["compare"],
  // merge → merge：合并链——把若干子序列各自合并后再汇入一个总合并节点（MergeNode 的
  // VIDEO_SOURCE_TYPES 已认 merge 为视频源）。此前 merge 仅允许 → asset/clip，导致
  // 「合并 → 合并」串联与智能体建线判定失败。
  // merge → clip/overlay/subtitle/subtitle_motion/smart_cut：合并成片后仍可继续后处理（整片加字幕/
  // 叠加水印/裁段/智能剪辑），merge 输出是视频源；→ merge 合并链；→ video_task 作 V2V 源；→ asset 存档。
  merge: ["asset", "clip", "merge", "overlay", "subtitle", "subtitle_motion", "smart_cut", "video_task", "compare"],
  comfyui_image: ["video_task", "asset", "pose_control", "character", "image_gen", "image_edit", "comfyui_image", "comfyui_video", "comfyui_workflow", "storyboard", "compare"],
  // comfyui_video 产出的是「视频」（resultVideoUrl）。下游 comfyui_image/comfyui_video 只经
  // useComfyUpstreamAutoFill→detectUpstreamImages 取「图源」（IMAGE_SOURCE_TYPES 不含 comfyui_video），
  // comfyui_workflow 的参数绑定类型只有 image/audio/text/number（无 video 输入槽）——三者都消费不了
  // comfyui_video 的视频，故不再列为目标（连了也取不到数据，是死边）。视频的正确去向是后处理链/
  // 剪辑/合并/video_task(V2V 源)/素材，均已在下方。
  comfyui_video: ["clip", "asset", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut", "video_task", "compare"],
  // comfyui_workflow → pose_control：自定义工作流出的图可再抽姿态/构图（pose_control 认其为图源）。
  comfyui_workflow: ["video_task", "asset", "clip", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut", "character", "image_gen", "image_edit", "comfyui_workflow", "comfyui_image", "comfyui_video", "pose_control", "compare"],
  note: [],
  group: [],
  // The agent (Copilot) orchestrates by CREATING nodes via chat, not via edges —
  // it has no connection handles, so no outgoing graph connections.
  agent: [],
  // 工程智能体同理：通过对话/任务在服务端跑 ComfyUI 工具环，产物一键写回其它节点，
  // 自身不参与连线，无连接桩。
  super_agent: [],
};

export const NOTE_TYPES: NodeType[] = ["note"];

export function getCompatibleTargets(sourceType: NodeType): NodeType[] {
  if (NOTE_TYPES.includes(sourceType)) {
    return Object.keys(CONNECTION_MATRIX) as NodeType[];
  }
  return CONNECTION_MATRIX[sourceType] ?? [];
}

export function getCompatibleSources(targetType: NodeType): NodeType[] {
  if (NOTE_TYPES.includes(targetType)) {
    return Object.keys(CONNECTION_MATRIX) as NodeType[];
  }
  return (Object.keys(CONNECTION_MATRIX) as NodeType[]).filter((src) => {
    const targets = CONNECTION_MATRIX[src];
    return targets != null && targets.includes(targetType);
  });
}

export function isConnectionValid(
  sourceType: NodeType | null,
  targetType: NodeType | null
): boolean {
  if (sourceType === null || targetType === null) return true;
  if (NOTE_TYPES.includes(sourceType) || NOTE_TYPES.includes(targetType)) return true;
  // The matrix is authoritative — it already omits same-type pairs that must not
  // self-chain (e.g. prompt→prompt, storyboard→storyboard) and explicitly lists the
  // ones that should (comfyui_image→comfyui_image img2img 再生; comfyui_workflow→comfyui_workflow
  // 图串联; video_task→video_task 作 V2V/上采样源). 注意 comfyui_video 不自链——它产出视频，
  // 而 comfy 节点只消费图/无视频输入槽，视频自链无处落地.
  // Self-loops on the *same node* are blocked separately in Canvas's
  // isValidConnection (source === target).
  const targets = CONNECTION_MATRIX[sourceType];
  return targets != null && targets.includes(targetType);
}

// 句柄级校验：剪辑(clip)有两个语义不同的输入桩 video-in / audio-in。只按节点类型校验会让
// 音频源落到 video-in 也判「合法」（两桩同时亮绿、可落错），运行时才报「未找到视频输入」。
// 这里按目标桩语义细分：audio-in 只收音频源；video-in 只收视频源(非音频)。其它目标/桩沿用 isConnectionValid。
export function isHandleConnectionValid(
  sourceType: NodeType | null,
  targetType: NodeType | null,
  targetHandle?: string | null,
  sourceIsAudio?: boolean,
): boolean {
  if (!isConnectionValid(sourceType, targetType)) return false;
  if (targetType === "clip" && (targetHandle === "audio-in" || targetHandle === "video-in")) {
    const isAudioSrc = sourceType === "audio" || !!sourceIsAudio;
    return targetHandle === "audio-in" ? isAudioSrc : !isAudioSrc;
  }
  return true;
}

// 自动建边/自动连线（拖到空白处建节点、快捷创建下游节点、模板库放置等）时，目标节点
// 的默认「输入桩」id。绝大多数节点用 BaseNode 自带的单一 `input` 桩；唯独剪辑(clip)节点
// 用 showHandles={false} 自绘了两个独立输入 `video-in` / `audio-in`，并无 `input` 桩。
// 若自动连线沿用硬编码的 "input"，边会落到 clip 上不存在的桩 → ReactFlow 找不到该桩、
// 边无法渲染（表现为「创建了节点却没有连线」，而拖到其它节点正常）。这里按源类型分流：
// 音频源 → audio-in，其余（视频/素材等）→ video-in。其它目标类型一律沿用 `input`。
export function defaultTargetHandle(
  targetType: NodeType | undefined,
  sourceType?: NodeType | null,
  sourceIsAudio?: boolean,
): string {
  // 音频源(audio 节点，或经 sourceIsAudio 判定的音频 asset)→ clip 的 audio-in；其余 → video-in。
  if (targetType === "clip") return (sourceType === "audio" || sourceIsAudio) ? "audio-in" : "video-in";
  return "input";
}

export const CONNECTION_HINTS: Record<
  NodeType,
  { label: string; outgoing: string; incoming: string }
> = {
  script: {
    label: "脚本",
    outgoing: "→ 分镜 / 提示词 / AI对话 / 便签(审查报告)",
    incoming: "← 无（脚本自成起点：向导 / AI 生成正文）",
  },
  compare: {
    label: "对比",
    outgoing: "→ 无（对比查看，纯前端不产出）",
    incoming: "← 两路图像或视频（生图 / 视频任务 / 剪辑 / 合并 / 素材 / 分镜 / ComfyUI …）",
  },
  storyboard: {
    label: "分镜",
    outgoing: "→ 图像生成 / 图像编辑 / 视频任务 / 提示词 / 音频(对白配音) / 角色·构图控制(关键帧作参考图)",
    incoming: "← 脚本 / 提示词 / 角色 / AI对话 / 图像生成·编辑·导演台·ComfyUI图像(关键帧回填)",
  },
  prompt: {
    label: "提示词",
    outgoing: "→ 图像生成 / 视频任务 / 分镜",
    incoming: "← 脚本 / 分镜 / AI对话",
  },
  character: {
    label: "角色/场景",
    outgoing: "→ 分镜 / 图像生成 / 视频任务 / ComfyUI 图像·视频·自定义（参考图）",
    incoming: "← 素材 / 图像生成·编辑 / 分镜(关键帧) / 导演台 / ComfyUI 图像·自定义（参考图）",
  },
  image_gen: {
    label: "图像生成",
    outgoing: "→ 视频任务 / 图像编辑 / 构图控制 / 角色 / 图像生成·ComfyUI图像/视频/自定义（参考图）/ 分镜(关键帧候选) / 素材",
    incoming: "← 分镜 / 提示词 / 角色 / 素材 / 图像编辑 / 导演台 / 构图控制 / 图像生成 / ComfyUI 图像·自定义（参考图）",
  },
  director: {
    label: "导演台",
    outgoing: "→ 视频任务 / 图像生成 / 图像编辑 / 角色 / 构图控制 / ComfyUI图像/视频/自定义（3D 构图参考图）/ 分镜",
    incoming: "← 无（双击进 3D 编辑器布局，截图即产出）",
  },
  video_task: {
    label: "视频任务",
    outgoing: "→ 剪辑 / 素材 / 叠加 / 合并 / 字幕 / 动态字幕 / 智能剪辑 / 视频任务(V2V源)",
    incoming: "← 图像/分镜/构图/导演台(首帧参考) · 视频源(V2V/上采样/对口型参考) · 音频(数字人驱动)",
  },
  audio: {
    label: "音频",
    outgoing: "→ 剪辑 / 合并（整片配乐）/ 音频（作参考音色）/ ComfyUI 自定义（音频参数）",
    incoming: "← 分镜（对白→配音文案）/ 音频 / 素材（本地 VoxCPM 参考音色）",
  },
  asset: {
    label: "素材",
    outgoing: "→ 图像生成/编辑 / 视频任务 / 剪辑 / 叠加 / 合并 / 字幕 / 动态字幕 / 智能剪辑 / 构图控制 / 角色 / 音频（参考音色）/ ComfyUI",
    incoming: "← 图像生成/编辑 / 视频任务 / 剪辑 / 叠加 / 字幕 / 动态字幕 / 智能剪辑 / 合并 / 构图控制 / 音频 / ComfyUI（存档）",
  },
  ai_chat: {
    label: "AI对话",
    outgoing: "→ 分镜 / 提示词",
    incoming: "← 脚本",
  },
  clip: {
    label: "剪辑",
    outgoing: "→ 素材 / 叠加 / 合并 / 字幕 / 动态字幕 / 智能剪辑 / 视频任务(V2V源)",
    incoming: "← 视频任务 / 音频 / 素材 / 叠加 / 字幕 / 动态字幕 / 智能剪辑 / 合并 / ComfyUI视频·自定义",
  },
  note: {
    label: "便签",
    outgoing: "→ 任何节点（注释）",
    incoming: "← 任何节点",
  },
  post_process: {
    label: "后处理",
    outgoing: "→ 视频任务 / 图像生成 / 素材（效果注入）",
    incoming: "← 图像 / 视频 / 素材",
  },
  image_edit: {
    label: "图像编辑",
    outgoing: "→ 视频任务（i2v 首帧）/ 素材 / 角色 / 构图控制 / 图像生成·ComfyUI图像/视频/自定义（参考图）/ 分镜（关键帧）/ 图像编辑（再串）",
    incoming: "← 图像生成 / 分镜 / 导演台 / 构图控制 / ComfyUI 图像·自定义 / 素材",
  },
  group: {
    label: "分组",
    outgoing: "容器节点，不参与数据流",
    incoming: "容器节点，不参与数据流",
  },
  merge: {
    label: "合并",
    outgoing: "→ 素材 / 剪辑 / 合并（合并链）/ 叠加 / 字幕 / 动态字幕 / 智能剪辑 / 视频任务(V2V源)",
    incoming: "← 视频任务 / 剪辑 / 叠加 / 字幕 / 动态字幕 / 智能剪辑 / 合并 / ComfyUI 视频·自定义 / 素材 / 音频（整片配乐）",
  },
  subtitle: {
    label: "字幕",
    outgoing: "→ 素材 / 剪辑 / 叠加 / 合并 / 动态字幕 / 智能剪辑 / 视频任务(V2V源)",
    incoming: "← 剪辑 / 视频任务 / 素材 / 叠加 / 动态字幕 / 智能剪辑 / 合并 / ComfyUI视频·自定义",
  },
  overlay: {
    label: "视频叠加",
    outgoing: "→ 素材 / 剪辑 / 合并 / 字幕 / 动态字幕 / 智能剪辑 / 视频任务(V2V源)",
    incoming: "← 剪辑 / 视频任务 / 素材 / 字幕 / 动态字幕 / 智能剪辑 / 合并 / ComfyUI视频·自定义",
  },
  subtitle_motion: {
    label: "动态字幕",
    outgoing: "→ 素材 / 剪辑 / 叠加 / 合并 / 字幕 / 智能剪辑 / 视频任务(V2V源)",
    incoming: "← 剪辑 / 视频任务 / 素材 / 叠加 / 字幕 / 智能剪辑 / 合并 / ComfyUI视频·自定义",
  },
  smart_cut: {
    label: "智能剪辑",
    outgoing: "→ 素材 / 剪辑 / 叠加 / 合并 / 字幕 / 动态字幕 / 视频任务(V2V源)",
    incoming: "← 视频任务 / 剪辑 / 素材 / 叠加 / 字幕 / 动态字幕 / 合并 / ComfyUI视频·自定义",
  },
  pose_control: {
    label: "构图控制",
    outgoing: "→ 图像生成 / 图像编辑 / 素材 / 视频任务(首帧) / ComfyUI图像/视频/自定义(ControlNet引导图)",
    incoming: "← 图像生成 / 图像编辑 / 导演台 / 分镜(关键帧) / 素材 / ComfyUI图像·自定义",
  },
  voice_clone: {
    label: "声音克隆",
    outgoing: "即将上线（暂不可连接）",
    incoming: "即将上线（暂不可连接）",
  },
  lip_sync: {
    label: "唇形同步",
    outgoing: "即将上线（暂不可连接）",
    incoming: "即将上线（暂不可连接）",
  },
  avatar: {
    label: "数字人",
    outgoing: "即将上线（暂不可连接）",
    incoming: "即将上线（暂不可连接）",
  },
  comfyui_image: {
    label: "ComfyUI 图像",
    outgoing: "→ 视频任务 / 素材 / 构图控制 / 图像生成/编辑 / 分镜 / 角色 / ComfyUI图像·视频·自定义",
    incoming: "← 分镜 / 提示词 / 角色 / 素材 / 图像生成·编辑 / 导演台 / 构图控制(ControlNet) / ComfyUI图像·自定义",
  },
  comfyui_video: {
    label: "ComfyUI 视频",
    outgoing: "→ 剪辑 / 素材 / 叠加 / 合并 / 字幕 / 动态字幕 / 智能剪辑 / 视频任务(V2V源)",
    incoming: "← 分镜 / 提示词 / 角色 / 素材 / 图像生成·编辑 / 导演台 / 构图控制 / ComfyUI 图像·自定义",
  },
  comfyui_workflow: {
    label: "ComfyUI 自定义",
    outgoing: "→ 视频任务 / 素材 / 剪辑 / 叠加 / 合并 / 字幕 / 动态字幕 / 智能剪辑 / 角色 / 图像生成·编辑 / 构图控制 / ComfyUI图像·视频·自定义",
    incoming: "← 分镜 / 提示词 / 角色 / 素材 / 图像生成·编辑 / 导演台 / 构图控制 / 音频 / ComfyUI图像·自定义",
  },
  agent: {
    label: "智能体",
    outgoing: "通过对话直接在画布生成节点（不经连线）",
    incoming: "对话式描述需求，自动编排工作流",
  },
  super_agent: {
    label: "工程智能体",
    outgoing: "自动编写并真机调通 ComfyUI 工作流，产物一键写回 comfyui_workflow 节点（不经连线）",
    incoming: "输入工程任务，服务端跑「写→校验→运行→读错→修」闭环",
  },
};
