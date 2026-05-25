import type { NodeType } from "../../../shared/types";

export interface HelpSection {
  id: string;
  title: string;
  emoji: string;
  nodeType?: NodeType;
  content: HelpBlock[];
}

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "tip"; text: string }
  | { type: "warn"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "kv"; rows: [string, string][] }
  | { type: "code"; text: string };

export const HELP_SECTIONS: HelpSection[] = [
  // ── 画布基础 ────────────────────────────────────────────────────────────────
  {
    id: "canvas-basics",
    title: "画布基础操作",
    emoji: "🎨",
    content: [
      { type: "h3", text: "导航" },
      { type: "kv", rows: [
        ["鼠标滚轮", "上下平移"],
        ["Shift + 滚轮", "左右平移"],
        ["Ctrl / ⌘ + 滚轮", "缩放"],
        ["拖拽空白处", "平移画布"],
        ["双指捏合（触控板）", "缩放"],
      ]},
      { type: "h3", text: "节点操作" },
      { type: "kv", rows: [
        ["点击节点", "选中"],
        ["Ctrl/⌘ + 点击", "多选"],
        ["框选拖拽", "框选多个节点"],
        ["Delete / Backspace", "删除选中节点"],
        ["Ctrl/⌘ + D", "复制节点"],
        ["Ctrl/⌘ + A", "全选"],
        ["Esc", "取消选中 / 关闭浮层"],
      ]},
      { type: "h3", text: "工作流" },
      { type: "kv", rows: [
        ["Shift + R", "从选中节点运行工作流"],
        ["工具栏 [运行]", "运行整个画布工作流"],
        ["Ctrl/⌘ + S", "保存画布"],
        ["Ctrl/⌘ + Z", "撤销"],
        ["Ctrl/⌘ + Shift + Z", "重做"],
        ["Ctrl/⌘ + K", "搜索已有节点"],
        ["Ctrl/⌘ + T", "快速模板"],
      ]},
      { type: "tip", text: "点击顶栏工具栏右侧的 ? 按钮可以随时查看快捷键速查表。" },
    ],
  },

  // ── 工作流运行 ──────────────────────────────────────────────────────────────
  {
    id: "workflow-runner",
    title: "工作流运行机制",
    emoji: "⚡",
    content: [
      { type: "p", text: "工作流运行器会分析节点之间的连线，按拓扑顺序依次执行所有可运行节点。" },
      { type: "h3", text: "可运行节点类型" },
      { type: "p", text: "脚本、分镜、提示词、图像生成、视频任务、AI对话、语音克隆、唇形同步、数字人、ComfyUI图像、ComfyUI视频、ComfyUI自定义工作流。" },
      { type: "h3", text: "数据流转" },
      { type: "steps", items: [
        "上游节点的输出（图像URL、文本内容等）会自动传递给下游节点",
        "视频生成节点可以接收上游图像节点的输出作为参考图",
        "提示词节点的文本可以被图像/视频生成节点使用",
        "角色/场景节点的描述可以汇入分镜和提示词节点",
      ]},
      { type: "h3", text: "运行状态" },
      { type: "kv", rows: [
        ["灰色边框", "未运行 / idle"],
        ["蓝色脉冲", "运行中"],
        ["绿色边框", "成功完成"],
        ["红色边框", "运行失败"],
      ]},
      { type: "tip", text: "选中某个节点后按 Shift+R，只会从该节点开始向下游运行，不影响已完成的上游节点。" },
    ],
  },

  // ── 节点连线规则 ────────────────────────────────────────────────────────────
  {
    id: "connection-rules",
    title: "节点连线规则",
    emoji: "🔗",
    content: [
      { type: "p", text: "拖拽节点右侧的圆形端口到目标节点左侧端口即可创建连线。不同节点类型有兼容性限制。" },
      { type: "h3", text: "常用连接路径" },
      { type: "kv", rows: [
        ["角色/场景 → 提示词", "注入角色描述"],
        ["提示词 → 图像生成", "作为正向提示词"],
        ["图像生成 → 视频任务", "用图像作为参考帧"],
        ["分镜 → 视频任务", "用分镜图像生成视频"],
        ["视频任务 → 剪辑", "剪辑已生成视频"],
        ["视频任务 → 字幕", "为视频添加字幕"],
        ["多个视频 → 合并", "合并多个视频片段"],
      ]},
      { type: "tip", text: "工具栏上的🔗按钮可以开启「连线指引」面板，实时显示当前选中节点可以连接的目标类型。" },
    ],
  },

  // ── 脚本节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-script",
    title: "脚本节点",
    emoji: "📜",
    nodeType: "script",
    content: [
      { type: "p", text: "用于编写影片脚本或故事大纲。支持 AI 辅助生成和格式化。" },
      { type: "h3", text: "使用方式" },
      { type: "steps", items: [
        "添加脚本节点，输入影片标题或主题",
        "点击「AI 生成」自动生成完整脚本",
        "手动编辑并完善脚本内容",
        "连接到分镜节点，将脚本段落转化为分镜",
      ]},
      { type: "tip", text: "脚本内容支持 Markdown 格式。每个段落可以对应一个分镜节点。" },
    ],
  },

  // ── 分镜节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-storyboard",
    title: "分镜节点",
    emoji: "🎬",
    nodeType: "storyboard",
    content: [
      { type: "p", text: "表示一个镜头场景，可以包含参考图像、场景描述和摄影指导。" },
      { type: "h3", text: "使用方式" },
      { type: "steps", items: [
        "添加分镜节点，输入场景描述",
        "上传参考图像或通过 AI 生成分镜图",
        "连接到视频任务节点，以分镜图像为参考生成视频",
        "连接到 ComfyUI 节点进行高级图像处理",
      ]},
      { type: "kv", rows: [
        ["参考图", "用于图生视频或风格迁移"],
        ["场景描述", "会被下游提示词/视频节点使用"],
      ]},
    ],
  },

  // ── 提示词节点 ──────────────────────────────────────────────────────────────
  {
    id: "node-prompt",
    title: "提示词节点",
    emoji: "✨",
    nodeType: "prompt",
    content: [
      { type: "p", text: "管理和优化 AI 生成的文本提示词，支持正向/负向提示词分离。" },
      { type: "h3", text: "使用方式" },
      { type: "steps", items: [
        "添加提示词节点，分别填写正向和负向提示词",
        "连接上游角色/场景节点自动注入描述",
        "连接到图像生成或视频任务节点",
        "使用「AI 优化」功能自动扩写和专业化提示词",
      ]},
      { type: "tip", text: "提示词节点的正向提示词内容会覆盖下游节点的提示词字段。建议使用英文提示词以获得最佳效果。" },
    ],
  },

  // ── 图像生成节点 ────────────────────────────────────────────────────────────
  {
    id: "node-image-gen",
    title: "图像生成节点",
    emoji: "🖼️",
    nodeType: "image_gen",
    content: [
      { type: "p", text: "使用云端 AI 服务（如 Flux、DALL-E 等）生成图像。" },
      { type: "h3", text: "参数说明" },
      { type: "kv", rows: [
        ["模型", "选择图像生成模型"],
        ["宽/高", "输出图像尺寸"],
        ["提示词", "描述要生成的图像内容"],
        ["负向提示词", "描述不想要的内容"],
      ]},
      { type: "tip", text: "连接上游「提示词」节点后，提示词字段会自动填充。也可以连接「分镜」节点，用分镜描述驱动图像生成。" },
    ],
  },

  // ── 素材节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-asset",
    title: "素材节点",
    emoji: "📦",
    nodeType: "asset",
    content: [
      { type: "p", text: "上传和管理本地媒体素材（图像、视频、音频），作为工作流的输入来源。" },
      { type: "steps", items: [
        "点击上传区域选择本地文件",
        "支持图像（JPG/PNG/WebP）、视频（MP4/WebM）、音频（MP3/WAV）",
        "上传后连接到下游节点使用",
      ]},
      { type: "tip", text: "素材库（顶栏 📎 按钮）管理已上传的所有素材，可以随时拖拽到画布复用。" },
    ],
  },

  // ── 视频任务节点 ────────────────────────────────────────────────────────────
  {
    id: "node-video-task",
    title: "视频任务节点",
    emoji: "🎥",
    nodeType: "video_task",
    content: [
      { type: "p", text: "调用云端视频生成服务（如 Kling、Hailuo、Higgsfield 等）生成视频片段。" },
      { type: "h3", text: "生成模式" },
      { type: "kv", rows: [
        ["文生视频 (T2V)", "仅用文字提示词生成"],
        ["图生视频 (I2V)", "以图像为起始帧生成"],
        ["视频延长", "延长已有视频（部分提供商支持）"],
      ]},
      { type: "h3", text: "参数说明" },
      { type: "kv", rows: [
        ["提供商", "Kling / Hailuo / Higgsfield 等"],
        ["时长", "通常 3–10 秒"],
        ["参考图", "用于图生视频，连接图像生成或分镜节点"],
        ["运动强度", "控制画面运动幅度"],
      ]},
      { type: "warn", text: "视频生成通常需要 30 秒至数分钟，任务提交后可以继续操作其他节点，完成后节点自动更新。" },
    ],
  },

  // ── AI 对话节点 ─────────────────────────────────────────────────────────────
  {
    id: "node-ai-chat",
    title: "AI 对话节点",
    emoji: "🤖",
    nodeType: "ai_chat",
    content: [
      { type: "p", text: "内置 AI 对话助手，可以辅助创作、生成提示词、分析内容等。" },
      { type: "steps", items: [
        "在输入框输入你的问题或指令",
        "AI 会结合上下文（包括同一项目中的其他节点信息）进行回复",
        "对话历史会保存在节点中",
        "可以连接到其他节点，将 AI 回复的内容注入工作流",
      ]},
      { type: "tip", text: "向 AI 描述你的视频创意，让它帮你生成分镜脚本、提示词或制作建议。" },
    ],
  },

  // ── 便签节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-note",
    title: "便签节点",
    emoji: "📝",
    nodeType: "note",
    content: [
      { type: "p", text: "用于在画布上添加文字注释、说明或TODO备忘。不参与工作流运行。" },
      { type: "tip", text: "可以用便签标注工作流的各个阶段，或记录制作思路和待办事项。" },
    ],
  },

  // ── 音频节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-audio",
    title: "音频节点",
    emoji: "🎵",
    nodeType: "audio",
    content: [
      { type: "p", text: "管理背景音乐、音效或旁白音频文件。" },
      { type: "steps", items: [
        "上传音频文件或填写音频 URL",
        "预览音频内容",
        "连接到剪辑或后处理节点作为配乐",
      ]},
    ],
  },

  // ── 后处理节点 ──────────────────────────────────────────────────────────────
  {
    id: "node-post-process",
    title: "后处理节点",
    emoji: "🔧",
    nodeType: "post_process",
    content: [
      { type: "p", text: "对视频进行后期处理：调色、滤镜、速度调整、裁剪等。" },
      { type: "kv", rows: [
        ["调色", "亮度/对比度/饱和度/色温调整"],
        ["滤镜", "应用预设视觉风格"],
        ["速度", "快放 / 慢放"],
        ["裁剪", "调整画面比例"],
      ]},
    ],
  },

  // ── 分组节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-group",
    title: "分组节点",
    emoji: "📁",
    nodeType: "group",
    content: [
      { type: "p", text: "将相关节点组织在一起，形成可折叠的逻辑分组，便于管理复杂工作流。" },
      { type: "steps", items: [
        "添加分组节点并调整大小",
        "将其他节点拖拽到分组内",
        "折叠分组隐藏内部细节",
        "移动分组会同步移动内部所有节点",
      ]},
    ],
  },

  // ── 角色/场景节点 ───────────────────────────────────────────────────────────
  {
    id: "node-character",
    title: "角色 / 场景节点",
    emoji: "👤",
    nodeType: "character",
    content: [
      { type: "p", text: "定义影片中的角色或场景设定，其描述会自动传递给下游提示词和分镜节点。" },
      { type: "h3", text: "角色示例" },
      { type: "p", text: "「主角：一位30岁的东方女性，身穿红色旗袍，长发飘逸，气质优雅」" },
      { type: "h3", text: "场景示例" },
      { type: "p", text: "「场景：夜晚的上海街道，霓虹灯倒映在湿润的地面，赛博朋克风格」" },
      { type: "tip", text: "连接多个角色节点到同一个提示词节点，可以在一个画面中描述多个角色的互动。" },
    ],
  },

  // ── 剪辑节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-clip",
    title: "剪辑节点",
    emoji: "✂️",
    nodeType: "clip",
    content: [
      { type: "p", text: "对视频片段进行精剪：截取、拼接、设置时间码。" },
      { type: "kv", rows: [
        ["起始时间", "从哪一秒开始截取"],
        ["结束时间", "截取到哪一秒"],
        ["输入", "连接视频任务或素材节点"],
      ]},
    ],
  },

  // ── 合并节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-merge",
    title: "合并节点",
    emoji: "🔀",
    nodeType: "merge",
    content: [
      { type: "p", text: "将多个视频片段按顺序合并为一个完整视频。" },
      { type: "steps", items: [
        "连接多个视频任务或剪辑节点到合并节点",
        "调整片段顺序",
        "设置转场效果（淡入淡出等）",
        "运行后输出合并后的完整视频",
      ]},
    ],
  },

  // ── 字幕节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-subtitle",
    title: "字幕节点",
    emoji: "💬",
    nodeType: "subtitle",
    content: [
      { type: "p", text: "为视频添加字幕文字，支持自动语音识别（ASR）和手动编辑。" },
      { type: "steps", items: [
        "连接视频任务节点",
        "选择「自动识别」或「手动输入」",
        "编辑字幕时间轴和文字",
        "设置字体、大小、位置和颜色",
      ]},
    ],
  },

  // ── 叠加节点 ────────────────────────────────────────────────────────────────
  {
    id: "node-overlay",
    title: "叠加节点",
    emoji: "🔲",
    nodeType: "overlay",
    content: [
      { type: "p", text: "将图像或视频叠加到主视频上，实现画中画、水印、Logo 等效果。" },
      { type: "kv", rows: [
        ["主视频", "底层视频输入"],
        ["叠加素材", "上层图像或视频"],
        ["位置", "叠加层的位置（左上/右上/居中等）"],
        ["透明度", "叠加层的不透明度"],
        ["缩放", "叠加层的大小比例"],
      ]},
    ],
  },

  // ── 动态字幕节点 ────────────────────────────────────────────────────────────
  {
    id: "node-subtitle-motion",
    title: "动态字幕节点",
    emoji: "🎭",
    nodeType: "subtitle_motion",
    content: [
      { type: "p", text: "生成带有动态效果的字幕，适用于短视频、Reels 等内容形式。" },
      { type: "kv", rows: [
        ["文字内容", "要显示的字幕文本"],
        ["动效类型", "弹出/滚动/打字机/渐变等"],
        ["持续时间", "动效持续时长（秒）"],
        ["样式", "字体/颜色/描边/阴影"],
      ]},
    ],
  },

  // ── 智能剪辑节点 ────────────────────────────────────────────────────────────
  {
    id: "node-smart-cut",
    title: "智能剪辑节点",
    emoji: "⚡",
    nodeType: "smart_cut",
    content: [
      { type: "p", text: "AI 驱动的智能剪辑，自动识别视频中的重要片段并进行剪辑。" },
      { type: "steps", items: [
        "连接视频任务或素材节点",
        "设置目标时长和剪辑风格",
        "AI 自动分析并选取最佳片段",
        "手动微调剪辑点",
      ]},
    ],
  },

  // ── 构图控制节点 ────────────────────────────────────────────────────────────
  {
    id: "node-pose-control",
    title: "构图控制节点",
    emoji: "🎯",
    nodeType: "pose_control",
    content: [
      { type: "p", text: "通过 ControlNet / OpenPose 控制图像生成中的人物姿态和构图。" },
      { type: "steps", items: [
        "上传参考图像或骨骼姿态图",
        "选择控制模式（OpenPose/Depth/Canny 等）",
        "连接到图像生成或 ComfyUI 节点",
        "运行时生成与参考姿态一致的图像",
      ]},
    ],
  },

  // ── 声音克隆节点 ────────────────────────────────────────────────────────────
  {
    id: "node-voice-clone",
    title: "声音克隆节点",
    emoji: "🎙️",
    nodeType: "voice_clone",
    content: [
      { type: "p", text: "克隆任意人声，将文本转为指定说话人的语音（TTS + 声音克隆）。" },
      { type: "steps", items: [
        "上传 3–30 秒参考音频（要克隆的声音）",
        "输入要转换的文本内容",
        "选择语言和语速",
        "运行后生成克隆语音，可连接到唇形同步或数字人节点",
      ]},
      { type: "warn", text: "声音克隆技术仅供合法创作使用，请确保已获得声音所有权人的授权。" },
    ],
  },

  // ── 唇形同步节点 ────────────────────────────────────────────────────────────
  {
    id: "node-lip-sync",
    title: "唇形同步节点",
    emoji: "👄",
    nodeType: "lip_sync",
    content: [
      { type: "p", text: "将视频中人物的唇形与指定音频同步，实现配音效果。" },
      { type: "steps", items: [
        "连接视频来源（视频任务或素材节点）",
        "连接音频来源（声音克隆或音频节点）",
        "运行后生成唇形同步的视频",
      ]},
    ],
  },

  // ── 数字人节点 ──────────────────────────────────────────────────────────────
  {
    id: "node-avatar",
    title: "数字人节点",
    emoji: "🧑‍💻",
    nodeType: "avatar",
    content: [
      { type: "p", text: "生成 AI 数字人播报视频，适用于新闻播报、产品讲解、教育内容等。" },
      { type: "steps", items: [
        "选择数字人形象（预设或上传自定义）",
        "输入播报文稿或连接脚本节点",
        "选择声音（内置 TTS 或连接声音克隆节点）",
        "运行生成数字人播报视频",
      ]},
    ],
  },

  // ── ComfyUI 图像节点 ────────────────────────────────────────────────────────
  {
    id: "node-comfyui-image",
    title: "ComfyUI 图像节点",
    emoji: "🖥️",
    nodeType: "comfyui_image",
    content: [
      { type: "p", text: "使用本地 ComfyUI 服务器生成图像，支持 txt2img 和 img2img 两种模式。" },
      { type: "h3", text: "基本参数" },
      { type: "kv", rows: [
        ["服务器地址", "ComfyUI HTTP 地址，如 http://192.168.1.100:8188，留空使用全局配置"],
        ["工作流模板", "txt2img（文生图）/ img2img（图生图）"],
        ["模型 (Checkpoint)", "从服务器模型列表选择"],
        ["LoRA", "附加 LoRA 权重文件（可选）"],
        ["提示词", "正向提示词（英文效果最佳）"],
        ["负向提示词", "不想要的内容描述"],
        ["步数 (Steps)", "推理步数，越高质量越好但越慢（20–30 推荐）"],
        ["CFG Scale", "提示词引导强度（7–8 推荐）"],
        ["宽/高", "输出图像尺寸"],
        ["种子 (Seed)", "-1 为随机"],
      ]},
      { type: "h3", text: "高级参数" },
      { type: "kv", rows: [
        ["采样器 (Sampler)", "推荐 euler_a / dpmpp_2m"],
        ["调度器 (Scheduler)", "推荐 karras / exponential"],
        ["去噪强度 (Denoise)", "img2img 时的修改幅度，0=不变，1=完全重绘"],
        ["VAE", "图像解码器，留空使用 checkpoint 内置"],
        ["LoRA 强度", "LoRA 对画风影响程度（0.5–1.0 推荐）"],
        ["批量数量", "一次生成几张图（1–8）"],
      ]},
      { type: "tip", text: "首次使用需点击「刷新模型」加载服务器上已安装的模型列表。确保 ComfyUI 服务器已启动。" },
    ],
  },

  // ── ComfyUI 视频节点 ────────────────────────────────────────────────────────
  {
    id: "node-comfyui-video",
    title: "ComfyUI 视频节点",
    emoji: "📹",
    nodeType: "comfyui_video",
    content: [
      { type: "p", text: "使用本地 ComfyUI 服务器生成视频，支持 AnimateDiff 和 SVD（Stable Video Diffusion）。" },
      { type: "h3", text: "工作流模板" },
      { type: "kv", rows: [
        ["AnimateDiff", "从文字或图像生成动态视频，支持各种 motion module"],
        ["SVD (img2vid)", "以单张图像为起始帧，生成写实风格的短视频"],
      ]},
      { type: "h3", text: "视频参数" },
      { type: "kv", rows: [
        ["帧数", "视频总帧数（AnimateDiff: 16/24/32，SVD: 25）"],
        ["FPS", "输出视频帧率（通常 8–16）"],
        ["运动模块", "AnimateDiff 的动态效果模块"],
        ["参考图", "SVD 或 img2vid 的起始图像"],
        ["宽/高", "视频分辨率（推荐 512×512 或 768×512）"],
      ]},
      { type: "warn", text: "视频生成对显存要求较高。RTX 5090 可以流畅运行高分辨率视频工作流，低显存 GPU 建议降低分辨率。" },
    ],
  },

  // ── ComfyUI 自定义工作流节点 ────────────────────────────────────────────────
  {
    id: "node-comfyui-workflow",
    title: "ComfyUI 自定义工作流节点",
    emoji: "⚙️",
    nodeType: "comfyui_workflow",
    content: [
      { type: "p", text: "导入任意 ComfyUI Workflow JSON 并运行，支持所有 ComfyUI 节点和自定义插件。这是实现「完全不缺失功能」接入 ComfyUI 的核心节点。" },
      { type: "h3", text: "三个阶段" },
      { type: "steps", items: [
        "阶段 A — 粘贴 Workflow JSON：直接粘贴从 ComfyUI 导出的 API 格式 JSON，或上传 .json 文件，或选择内置预设（SDXL / Flux / HunyuanVideo / Wan2.1）",
        "阶段 B — 配置参数映射：系统自动检测 workflow 中的可配置字段（提示词/模型/步数/尺寸等），可以修改参数标签或手动添加未检测到的参数",
        "阶段 C — 运行工作流：在动态表单中填写参数值，点击运行，查看实时进度条和最终输出结果",
      ]},
      { type: "h3", text: "导出 API Format JSON" },
      { type: "steps", items: [
        "在 ComfyUI Web 界面设计好工作流",
        "点击顶部菜单 Extra Options → Enable Dev Mode Options",
        "点击 Save (API Format) 导出 JSON 文件",
        "将 JSON 内容粘贴到本节点的文本框中",
      ]},
      { type: "h3", text: "内置预设" },
      { type: "kv", rows: [
        ["SDXL 1.0", "SDXL 标准文生图（1024×1024）"],
        ["Flux.1-dev", "Flux 高质量文生图（需要 flux1-dev.safetensors）"],
        ["HunyuanVideo", "腾讯混元视频生成（需要对应模型）"],
        ["Wan2.1 T2V", "万象文生视频（需要 Wan2 系列模型）"],
      ]},
      { type: "h3", text: "参数类型" },
      { type: "kv", rows: [
        ["text", "文本输入框（提示词）"],
        ["number", "数字输入（步数/CFG等）"],
        ["select", "下拉选择（模型/采样器等）"],
        ["image", "图像上传或 URL 输入"],
        ["boolean", "开关选项"],
      ]},
      { type: "tip", text: "系统会自动检测 CLIPTextEncode（提示词）、KSampler（步数/CFG/采样器）、CheckpointLoaderSimple（模型）、EmptyLatentImage（尺寸）等常用节点的参数。" },
    ],
  },

  // ── ComfyUI 服务器配置 ──────────────────────────────────────────────────────
  {
    id: "comfyui-setup",
    title: "ComfyUI 服务器配置",
    emoji: "🖥️",
    content: [
      { type: "p", text: "本应用支持连接本地或远程部署的 ComfyUI 服务器，包括多 GPU 多实例配置。" },
      { type: "h3", text: "单实例配置" },
      { type: "p", text: "在服务器启动环境中设置以下环境变量：" },
      { type: "code", text: "COMFYUI_BASE_URL=http://192.168.1.100:8188" },
      { type: "h3", text: "多 GPU 多实例配置（推荐 4×5090）" },
      { type: "p", text: "每张 GPU 启动一个 ComfyUI 进程：" },
      { type: "code", text: `# 实例 1（GPU 0）：COMFYUI_BASE_URL 默认实例
python main.py --port 8188 --cuda-device 0

# 实例 2（GPU 1）
python main.py --port 8189 --cuda-device 1

# 实例 3（GPU 2）
python main.py --port 8190 --cuda-device 2

# 实例 4（GPU 3）
python main.py --port 8191 --cuda-device 3` },
      { type: "p", text: "在各 ComfyUI 节点的「服务器地址」字段分别填写不同端口（:8188、:8189、:8190、:8191），实现手动 GPU 分流。" },
      { type: "h3", text: "必备 ComfyUI 插件" },
      { type: "kv", rows: [
        ["ComfyUI-VideoHelperSuite", "VHS_VideoCombine 节点，视频生成必须"],
        ["ComfyUI-AnimateDiff-Evolved", "AnimateDiff 工作流必须"],
        ["ComfyUI-HunyuanVideoWrapper", "HunyuanVideo 支持"],
        ["Wan2GP / ComfyUI-WanVideoWrapper", "Wan2.1 视频生成"],
        ["ComfyUI_IPAdapter_plus", "IP-Adapter 风格迁移"],
        ["comfyui_controlnet_aux", "ControlNet 预处理器"],
      ]},
      { type: "p", text: "以上插件均可通过 ComfyUI Manager → Install Missing Custom Nodes 搜索安装。" },
      { type: "h3", text: "推荐模型" },
      { type: "kv", rows: [
        ["SDXL", "sd_xl_base_1.0.safetensors + sd_xl_refiner_1.0.safetensors"],
        ["Flux.1-dev", "flux1-dev.safetensors + ae.safetensors（VAE）"],
        ["HunyuanVideo", "HunyuanVideo_720_cfgdistill_fp8.safetensors"],
        ["Wan2.1 T2V", "Wan2_1-T2V-14B_fp8.safetensors"],
        ["AnimateDiff", "mm_sd_v15_v2.ckpt（放入 models/animatediff_models/）"],
      ]},
      { type: "h3", text: "模型目录" },
      { type: "code", text: `ComfyUI/
├── models/
│   ├── checkpoints/     # SDXL, Flux, SD1.5 等主模型
│   ├── loras/           # LoRA 权重文件
│   ├── vae/             # VAE 解码器
│   ├── controlnet/      # ControlNet 模型
│   ├── animatediff_models/  # AnimateDiff motion module
│   └── unet/            # Flux UNet 模型` },
      { type: "h3", text: "网络配置" },
      { type: "p", text: "确保 ComfyUI 服务器对本应用服务器可访问（同局域网或通过 SSH 隧道）。ComfyUI 默认只监听 127.0.0.1，需要用以下参数开放局域网访问：" },
      { type: "code", text: "python main.py --listen 0.0.0.0 --port 8188" },
      { type: "warn", text: "开放 0.0.0.0 监听会让局域网所有设备都能访问 ComfyUI，请确保在安全的内网环境中使用，或配置防火墙规则。" },
      { type: "h3", text: "CORS 配置" },
      { type: "p", text: "本应用的服务器端会代理所有 ComfyUI 请求，无需在 ComfyUI 侧配置 CORS。" },
      { type: "tip", text: "配置完成后，在任意 ComfyUI 节点点击「刷新模型」按钮，如果能看到模型列表则说明连接成功。" },
    ],
  },

  // ── 进阶工作流示例 ──────────────────────────────────────────────────────────
  {
    id: "workflow-examples",
    title: "工作流示例",
    emoji: "💡",
    content: [
      { type: "h3", text: "示例 1：AI 视频制作全流程" },
      { type: "steps", items: [
        "脚本节点 → 输入视频主题，AI 生成脚本",
        "分镜节点 × N → 对应脚本各段落",
        "提示词节点 → 为每个分镜生成 AI 提示词",
        "ComfyUI 图像节点 → 生成各分镜的参考图",
        "视频任务节点 × N → 图生视频生成各片段",
        "字幕节点 → 添加旁白字幕",
        "合并节点 → 将所有片段合并为完整视频",
      ]},
      { type: "h3", text: "示例 2：角色一致性工作流" },
      { type: "steps", items: [
        "角色节点 → 定义主角外貌和性格描述",
        "IP-Adapter 或 ComfyUI 自定义节点 → 载入角色参考图",
        "多个分镜节点 → 连接到角色节点获取统一描述",
        "ComfyUI 图像节点 → 使用 IP-Adapter 保持角色一致性",
        "视频任务节点 → 基于一致的参考图生成视频",
      ]},
      { type: "h3", text: "示例 3：HunyuanVideo 文生视频" },
      { type: "steps", items: [
        "添加 ComfyUI 自定义工作流节点",
        "点击「HunyuanVideo」预设按钮",
        "阶段 B 中确认自动检测的参数（提示词/分辨率/帧数）",
        "阶段 C 填写提示词并运行",
        "等待视频生成（RTX 5090 约 2–5 分钟）",
      ]},
      { type: "tip", text: "复杂工作流建议先用「版本历史」保存一个基础版本，再逐步添加节点，便于回滚。" },
    ],
  },
];

export function getHelpSectionById(id: string): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.id === id);
}

export function getHelpSectionByNodeType(nodeType: NodeType): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.nodeType === nodeType);
}

export const COMFYUI_SECTION_IDS = ["node-comfyui-image", "node-comfyui-video", "node-comfyui-workflow", "comfyui-setup"];
