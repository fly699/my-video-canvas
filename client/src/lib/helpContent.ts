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
      { type: "h3", text: "添加节点" },
      { type: "kv", rows: [
        ["画布空白处右键", "弹出添加节点菜单"],
        ["画布空白处双击 / 双指点", "弹出添加节点菜单（移动端友好）"],
        ["菜单右上角的 📌 图钉", "固定菜单为浮动面板，连续添加多个节点"],
        ["工具栏 [添加]", "打开节点选择器"],
      ]},
      { type: "h3", text: "节点操作" },
      { type: "kv", rows: [
        ["点击节点", "选中"],
        ["Ctrl/⌘ + 点击", "多选"],
        ["框选拖拽", "框选多个节点"],
        ["右键点击节点", "弹出节点上下文菜单（删除/复制/固定/运行）"],
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

  // ── 底部面板：胶片条 / 时间轴 / 全览图 ───────────────────────────────────────
  {
    id: "ui-panels",
    title: "胶片条 · 时间轴 · 全览图",
    emoji: "🎬",
    content: [
      { type: "p", text: "底部 3 个浮动面板帮助你快速浏览整个项目的素材状态，全部支持拖动与缩放。" },
      { type: "h3", text: "胶片条" },
      { type: "p", text: "横向展示所有已生成图像/视频的缩略图。点击任意帧 → 画布自动定位并居中该节点。" },
      { type: "kv", rows: [
        ["顶边手柄", "向上拖动加高、向下拖动收缩"],
        ["头部拖动", "整体移动到任意位置（自动脱离吸附）"],
        ["右下角 ⋰ 角标", "浮动模式下双轴缩放宽+高"],
        ["头部 📌 按钮（浮动时）", "重新吸附到底部全宽"],
        ["拖拽图片缩略图到 AI 对话", "作为 image_url 附件，多模态 LLM 可直接看图"],
        ["拖拽视频缩略图到 AI 对话", "作为文本引用（视频 URL 字符串），LLM 可获取上下文但看不到画面"],
      ]},
      { type: "h3", text: "时间轴" },
      { type: "p", text: "横向展示视频片段（按 Y 轴排序），每帧显示时长徽章；总时长在头部显示。鼠标悬停某帧可在小窗口内播放预览。" },
      { type: "kv", rows: [
        ["点击预览图", "画布定位到对应节点"],
        ["点击播放按钮", "在缩略图内就地预览，无需打开节点"],
        ["头部 📌 / 右下角角标", "同胶片条 — 拖动重新吸附 / 双轴缩放"],
      ]},
      { type: "h3", text: "宽度自适应" },
      { type: "p", text: "吸附模式下，胶片条/时间轴宽度根据素材数量自动伸缩：少量素材时紧凑居中，素材增多时自然变宽，超过视口宽度后启用内部横向滚动。" },
      { type: "h3", text: "全览图（minimap）" },
      { type: "p", text: "右下角浮动的画布缩略图，紫色 mask 框表示当前可视区域。点击任意位置 → 跳转过去。" },
      { type: "kv", rows: [
        ["顶部条带", "拖动整个 minimap 到任意角落"],
        ["左上角 ⤡ 把手", "调整 minimap 尺寸"],
        ["z 层级", "始终在胶片条/时间轴/工具栏之上，避免被遮挡"],
      ]},
      { type: "tip", text: "胶片条与时间轴的位置/尺寸会持久化到浏览器，刷新后保持不变。" },
    ],
  },

  // ── 多用户协作 ──────────────────────────────────────────────────────────────
  {
    id: "collaboration",
    title: "多用户协作",
    emoji: "👥",
    content: [
      { type: "p", text: "项目可邀请其他用户共同编辑或仅查看，支持邮箱邀请、一次性链接、公开访问三种方式。所有角色变更即时通过 WebSocket 同步给在线协作者。" },
      { type: "h3", text: "四种角色" },
      { type: "kv", rows: [
        ["所有者 owner", "完整权限 + 删除项目 / 公开访问开关 / 转让"],
        ["管理员 admin", "编辑 + 邀请/移除成员、创建分享链接"],
        ["编辑者 editor", "增删改节点 / 触发 AI 生成 / 运行工作流"],
        ["查看者 viewer", "只读 — 仅能浏览画布，所有写操作按钮自动隐藏"],
      ]},
      { type: "h3", text: "邀请方式" },
      { type: "steps", items: [
        "顶栏点击 👥 协作图标，下拉中点「管理协作 / 邀请成员」",
        "邮箱邀请：输入 Email 与角色，对方注册/登录后自动加入项目",
        "分享链接：生成一次性或多次使用 Token（最多 N 次 + 过期时间），通过链接分享",
        "公开访问：开关「公开访问」后，任何登录用户通过项目 URL 可只读查看",
      ]},
      { type: "h3", text: "短链接 vs 完整链接" },
      { type: "p", text: "每条分享链接同时提供两种格式：完整链接 /invite/<token>（最高安全，token 长度 32 字符）与短链接 /i/<id>.<prefix>（约 12 字符路径，适合 SMS、WeChat、QR 码场景）。短链接通过 行 ID + 6 字符 token 前缀双重验证，安全等级足以应对时间受限的协作邀请。" },
      { type: "kv", rows: [
        ["完整链接「长」按钮", "适合粘贴到正式渠道（邮件、文档）"],
        ["短链接「短」按钮", "适合受限字符渠道；高亮紫色"],
      ]},
      { type: "h3", text: "实时光标 / 选择" },
      { type: "p", text: "在线协作者的鼠标光标会以各自的彩色显示在画布上，选中节点也会显示彩色边框，帮助你看到他们正在做什么。" },
      { type: "h3", text: "权限即时生效" },
      { type: "p", text: "角色变更（升级/降级/移除）会通过 collabBus 立即广播到对应用户的浏览器，无需刷新页面 — 工具栏按钮、写操作权限会即时调整。" },
      { type: "warn", text: "「公开访问」会让任何登录用户通过 URL 进入只读模式。需要更严格的访问控制请使用邮箱邀请或分享链接。" },
      { type: "tip", text: "管理员可以在协作面板底部生成自定义到期时间的分享链接（默认 7 天），适合临时演示或 Review。" },
    ],
  },

  // ── 局域网聊天 ───────────────────────────────────────────────────────────────
  {
    id: "lan-chat",
    title: "局域网聊天（匿名群聊）",
    emoji: "💬",
    content: [
      { type: "p", text: "**端到端 P2P 加密**实时群聊。消息通过 WebRTC DataChannel 浏览器↔浏览器直连，**服务器看不到明文**，只做初始信令握手 + 同组成员发现。每位用户的历史保存在自己的浏览器 IndexedDB 中（下线期间他人发的消息看不到，符合数据不出本机原则）。" },
      { type: "p", text: "按浏览器**出口公网 IP**严格分组：同一办公室/家庭网络的人自动互相可见；不同网络的用户**永不互通**。同 LAN 设备走 ICE host candidate 真正直连。建议 ≤10 人同组（mesh 架构 N² 连接，超过会卡）。" },
      { type: "h3", text: "入口" },
      { type: "kv", rows: [
        ["顶栏 💬 按钮", "依次切换：隐藏 → 气泡 → 浮窗 → 隐藏"],
        ["独立网页 /lan-chat", "全屏聊天界面，适合手机/平板/外屏使用"],
        ["浮窗头部 [—] 按钮", "收成右下角气泡，保留未读计数"],
        ["浮窗头部 [×] 按钮", "完全关闭（顶栏 💬 再点开）"],
      ]},
      { type: "h3", text: "登录方式" },
      { type: "p", text: "首次进入时弹出昵称输入框（最长 20 字），无需注册任何账号。同一局域网 IP 用同一昵称二次进入会复用 session（不会出现两个同名 Alice）。昵称会缓存到 localStorage，刷新后一键重连。" },
      { type: "h3", text: "群聊房间" },
      { type: "kv", rows: [
        ["默认大厅", "数据库自带的 id=1 房间，所有人首次进入这里"],
        ["创建房间", "侧栏底部输入名字回车即建；任何人都可建"],
        ["切换房间", "侧栏点击；自动加载该房间近 50 条历史"],
      ]},
      { type: "h3", text: "拖拽 + 附件" },
      { type: "p", text: "输入框上方的整个聊天面板都是 drop zone：从桌面拖文件、从画布胶片条/时间轴拖缩略图、或直接粘贴图片均可。最大 16 MB / 张；图片直接在消息流中显示，视频以链接卡片形式显示（聊天里不内嵌播放，避免带宽爆炸）。" },
      { type: "h3", text: "实时通知" },
      { type: "p", text: "气泡态或浏览器 tab 被切走时，新消息会触发：① 气泡上红色未读徽章；② 短促叮声；③ 桌面通知（首次需授权）。聚焦到打开的浮窗即清零未读。" },
      { type: "h3", text: "浮窗操作" },
      { type: "kv", rows: [
        ["头部拖动", "移动浮窗到任意位置（位置持久化）"],
        ["右下角 ⋰ 角标", "双轴缩放（最小 360×360，最大 900×900）"],
        ["气泡拖动", "调整气泡位置；松开如未发生拖动则展开为浮窗"],
        ["Esc 键", "从浮窗收回到气泡"],
      ]},
      { type: "warn", text: "公网 4G/5G 因运营商 CGNAT 多个用户共享同一出口 IP，可能与陌生人意外同组。切勿在公网移动网络下发敏感信息。" },
      { type: "tip", text: "跨 LAN 团队（远程办公）请用 /lan-chat#g=你的团队代号 邀请链接共享同一 groupId，绕过 IP 检测。" },
      { type: "tip", text: "数据库表为 lan_chat_rooms + lan_chat_messages，无外键到 users/projects；想清空聊天历史，DROP 这两张表即可（数据库迁移会按需重建）。" },
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

  // ── ComfyUI 参数完整参考 ────────────────────────────────────────────────────
  {
    id: "comfyui-params-reference",
    title: "ComfyUI 参数完整参考",
    emoji: "📊",
    content: [
      { type: "h3", text: "图像节点所有参数" },
      { type: "kv", rows: [
        ["服务器地址 customBaseUrl", "ComfyUI HTTP 地址，如 http://192.168.1.100:8188，留空=使用全局环境变量"],
        ["工作流模板", "txt2img（文生图）或 img2img（图生图）"],
        ["模型 ckpt", "Checkpoint 文件名，必填，从「刷新模型」列表选择"],
        ["LoRA lora", "附加 LoRA 文件名（可选），同样从列表选择"],
        ["LoRA 强度 loraStrength", "0.0–2.0，推荐 0.5–1.0，影响 LoRA 风格的融合程度"],
        ["提示词 prompt", "正向提示词，1–2000 字符，英文效果最佳（必填）"],
        ["负向提示词 negPrompt", "不想要的内容，≤2000 字符（可选）"],
        ["步数 steps", "1–150，推荐 20–30；越高质量越好但越慢"],
        ["CFG cfg", "1–30，推荐 7–8；越高越严格遵循提示词，过高会产生伪影"],
        ["宽 width", "64–2048，SDXL 推荐 1024，SD1.5 推荐 512，需为 8 的倍数"],
        ["高 height", "64–2048，规则同宽"],
        ["批量 batchSize", "1–8，一次生成多张，结果以网格展示"],
        ["种子 seed", "整数或 -1（随机），相同种子+参数=相同结果（可复现）"],
        ["采样器 sampler", "euler_a（推荐速度）/ dpmpp_2m（推荐质量）/ ddim / uni_pc 等"],
        ["调度器 scheduler", "karras（推荐）/ exponential / normal / sgm_uniform 等"],
        ["去噪 denoise", "0.0–1.0，仅 img2img 有效；0=保留原图，1=完全重绘，0.6–0.8 常用"],
        ["VAE vae", "图像解码器文件名，留空=使用 checkpoint 内置 VAE"],
        ["参考图 referenceImageUrl", "img2img 模式必填，可连接上游图像节点或粘贴 URL"],
      ]},
      { type: "h3", text: "视频节点特有参数" },
      { type: "kv", rows: [
        ["模板 workflowTemplate", "animatediff（文生视频）或 svd（图生视频）"],
        ["动态模块 motionModule", "AnimateDiff 必填，如 mm_sd_v15_v2.ckpt，放入 animatediff_models/ 目录"],
        ["帧数 frames", "1–256；AnimateDiff 推荐 16/24/32，SVD 固定 25"],
        ["帧率 fps", "1–60；推荐 8（AnimateDiff）或 6–12（SVD），影响视频播放速度"],
        ["视频宽 width", "可选，不填=模板默认；AnimateDiff 推荐 512，SVD 推荐 1024"],
        ["视频高 height", "可选，不填=模板默认；AnimateDiff 推荐 512，SVD 推荐 576"],
        ["参考图 referenceImageUrl", "SVD 必填；AnimateDiff 可选（用于 img2vid 风格）"],
      ]},
      { type: "h3", text: "内置模板 → 节点类型对应" },
      { type: "kv", rows: [
        ["txt2img", "ComfyUI 图像节点，纯文字生成图像"],
        ["img2img", "ComfyUI 图像节点，参考图+文字生成图像"],
        ["animatediff", "ComfyUI 视频节点，文字/图像生成动态视频"],
        ["svd", "ComfyUI 视频节点，单张参考图生成写实短视频"],
      ]},
      { type: "h3", text: "自动检测参数的 ComfyUI 节点类型" },
      { type: "kv", rows: [
        ["CLIPTextEncode", "→ 提示词（type: text）"],
        ["KSampler / KSamplerAdvanced", "→ seed, steps, cfg, sampler_name, scheduler, denoise（type: number/select）"],
        ["CheckpointLoaderSimple", "→ ckpt_name（type: select，从服务器拉取模型列表）"],
        ["UNETLoader / ImageOnlyCheckpointLoader", "→ unet_name / ckpt_name（type: select）"],
        ["LoraLoader / LoraLoaderModelOnly", "→ lora_name, strength_model（type: select/number）"],
        ["LoadImage", "→ image（type: image，上传参考图）"],
        ["EmptyLatentImage / EmptySD3LatentImage", "→ width, height, batch_size（type: number）"],
        ["VHS_VideoCombine", "→ frame_rate（type: number）；标记为视频输出节点"],
        ["SaveImage / PreviewImage", "→ 标记为图像输出节点，收集最终图像"],
      ]},
      { type: "tip", text: "自定义工作流节点中，如果某个参数没有被自动检测到，可以在阶段 B 手动填写 nodeId（数字 ID）和 fieldPath（如 inputs.text）来添加绑定。" },
    ],
  },

  // ── 自定义工作流高级技巧 ────────────────────────────────────────────────────
  {
    id: "comfyui-workflow-advanced",
    title: "自定义工作流高级技巧",
    emoji: "🔬",
    content: [
      { type: "h3", text: "参数路径（fieldPath）格式" },
      { type: "p", text: "fieldPath 使用点号分隔路径，对应 workflow JSON 中节点的字段位置：" },
      { type: "kv", rows: [
        ["inputs.text", "节点 inputs 对象下的 text 字段（最常见）"],
        ["inputs.ckpt_name", "模型选择字段"],
        ["inputs.seed", "种子字段"],
        ["inputs.width", "宽度字段"],
        ["inputs.strength_model", "LoRA 强度字段"],
        ["inputs.frame_rate", "帧率字段"],
      ]},
      { type: "h3", text: "手动添加参数绑定示例" },
      { type: "p", text: "如果 workflow 中节点 ID 为 \"42\" 的 FluxGuidance 节点有 guidance 字段需要配置：" },
      { type: "code", text: `nodeId:   42
fieldPath: inputs.guidance
label:     引导强度 (Guidance)
type:      number
min:       1
max:       30
defaultValue: 3.5` },
      { type: "h3", text: "输出节点 ID 配置" },
      { type: "p", text: "留空=系统自动检测（推荐）。如果自动检测遗漏了输出，可以手动填写节点 ID（在 ComfyUI API JSON 中，key 就是节点 ID）。" },
      { type: "h3", text: "输出类型设置" },
      { type: "kv", rows: [
        ["auto（推荐）", "自动判断：含 VHS_VideoCombine=视频，含 SaveImage=图像"],
        ["image", "强制收集 SaveImage 输出（即使工作流同时有视频节点）"],
        ["video", "强制收集 VHS_VideoCombine 输出"],
      ]},
      { type: "h3", text: "多节点同类型参数处理" },
      { type: "p", text: "如果 workflow 有多个 CLIPTextEncode 节点（如正向+负向提示词分开），阶段 B 会生成多个绑定，各自有独立的 nodeId，可以分别修改 label 为「正向提示词」和「负向提示词」加以区分。" },
      { type: "h3", text: "Flux 工作流特殊说明" },
      { type: "p", text: "Flux 使用独立的 UNETLoader + CLIPLoader + VAELoader 代替 CheckpointLoaderSimple，且通常使用 FluxGuidance 节点替代 CFG Scale，cfg 参数固定为 1 或 0。KSampler 中的 scheduler 推荐 simple。" },
      { type: "tip", text: "遇到复杂工作流（如 IPAdapter + ControlNet 组合），建议先在 ComfyUI Web 界面测试通过后，再导出 API JSON 粘贴到本节点。" },
    ],
  },

  // ── ComfyUI 故障排查 ────────────────────────────────────────────────────────
  {
    id: "comfyui-troubleshoot",
    title: "ComfyUI 故障排查",
    emoji: "🔧",
    content: [
      { type: "h3", text: "无法连接服务器" },
      { type: "kv", rows: [
        ["刷新模型显示「连接失败」", "检查 COMFYUI_BASE_URL 环境变量或节点「服务器地址」字段是否正确"],
        ["可以访问 ComfyUI Web 界面但应用无法连接", "ComfyUI 仅监听 127.0.0.1，需加 --listen 0.0.0.0 重启"],
        ["局域网地址无法访问", "检查防火墙是否放行对应端口（8188/8189等）"],
      ]},
      { type: "h3", text: "模型列表为空" },
      { type: "kv", rows: [
        ["ckpts / loras 列表为空", "检查模型文件是否放置在 ComfyUI/models/checkpoints/ 目录"],
        ["motion modules 为空", "文件需放在 ComfyUI/models/animatediff_models/ 目录"],
        ["VAE 列表为空", "文件需放在 ComfyUI/models/vae/ 目录"],
      ]},
      { type: "h3", text: "生成失败" },
      { type: "kv", rows: [
        ["CUDA out of memory", "降低分辨率（width/height）或减少批量数量（batchSize）"],
        ["节点不存在 (Missing node type)", "ComfyUI 缺少对应自定义节点，用 ComfyUI Manager 安装"],
        ["超时（timeout）", "视频生成超过 10 分钟会超时；检查 GPU 是否正常工作"],
        ["Checkpoint 加载失败", "确认模型文件完整（不是损坏的下载文件），重新下载"],
        ["KSampler 报错", "检查采样器名称是否正确，不同版本 ComfyUI 支持的采样器可能不同"],
      ]},
      { type: "h3", text: "进度条不更新" },
      { type: "p", text: "WebSocket 连接到 ComfyUI 服务器失败时，进度条不会实时更新，但任务仍在后台执行。生成完成后结果会正常显示。检查：" },
      { type: "steps", items: [
        "ComfyUI 服务器是否支持 WebSocket（标准安装均支持）",
        "网络中是否有代理/反向代理阻断了 WebSocket 连接",
        "任务最终会通过轮询（每 3 秒）检查结果，所以即使 WS 失败也能完成",
      ]},
      { type: "h3", text: "自定义工作流分析结果为空" },
      { type: "steps", items: [
        "确认粘贴的是 API Format JSON（不是 workflow 界面保存的普通 JSON）",
        "API Format JSON 的结构是以节点 ID 为 key 的对象，如 {\"1\": {\"class_type\": \"KSampler\", \"inputs\": {...}}}",
        "如果格式正确但仍无检测结果，检查节点 class_type 是否是支持的类型（见参数参考章节）",
        "手动添加参数绑定作为补充",
      ]},
      { type: "warn", text: "生成任务一旦提交到 ComfyUI 就无法取消（ComfyUI 不支持中途取消队列中的任务）。如果需要停止，需要在 ComfyUI Web 界面的队列管理器中手动清除。" },
    ],
  },

  // ── 服务器环境变量配置 ──────────────────────────────────────────────────────
  {
    id: "server-env-config",
    title: "服务器环境变量配置",
    emoji: "⚙️",
    content: [
      { type: "p", text: "所有环境变量在服务器启动前通过 .env 文件或系统环境设置。" },
      { type: "h3", text: "必填（生产环境）" },
      { type: "kv", rows: [
        ["DATABASE_URL", "MySQL 连接字符串，如 mysql://user:pass@host:3306/dbname"],
        ["JWT_SECRET", "JWT 签名密钥，随机字符串，生产必须设置（留空会拒绝启动）"],
        ["OAUTH_SERVER_URL", "OAuth 认证服务地址（使用 OAuth 登录时必填）"],
      ]},
      { type: "h3", text: "ComfyUI 连接" },
      { type: "kv", rows: [
        ["COMFYUI_BASE_URL", "ComfyUI 服务器地址，如 http://192.168.1.100:8188（所有 ComfyUI 节点的默认服务器）"],
      ]},
      { type: "h3", text: "视频生成 API（按需配置）" },
      { type: "kv", rows: [
        ["POYO_API_KEY", "Poyo.ai API 密钥，用于 Kling / Hailuo 等视频生成"],
        ["HIGGSFIELD_API_KEY", "Higgsfield API 密钥，用于 Higgsfield 视频生成"],
        ["HIGGSFIELD_API_SECRET", "配套 Higgsfield API Secret"],
      ]},
      { type: "h3", text: "AI 功能 API" },
      { type: "kv", rows: [
        ["OPENAI_API_KEY", "OpenAI API 密钥，用于 TTS 语音合成和 GPT 文本生成"],
        ["BUILT_IN_FORGE_API_URL", "内置 Stable Diffusion WebUI (Forge) 地址，用于图像生成节点"],
        ["BUILT_IN_FORGE_API_KEY", "内置 Forge API 密钥"],
      ]},
      { type: "h3", text: "应用配置" },
      { type: "kv", rows: [
        ["NODE_ENV", "运行环境：development（开发，无需数据库和 OAuth）/ production（生产）"],
        ["OWNER_EMAIL", "管理员邮箱，默认值需在生产环境替换"],
        ["OWNER_OPEN_ID", "管理员 OpenID（OAuth 场景）"],
        ["VITE_APP_ID", "前端应用 ID，用于 OAuth 和分析等"],
      ]},
      { type: "h3", text: "开发模式快速启动" },
      { type: "code", text: `DATABASE_URL="" OAUTH_SERVER_URL="" NODE_ENV=development pnpm dev` },
      { type: "p", text: "开发模式下自动以 Dev User（id=1）登录，使用内存存储，无需真实数据库和 OAuth 服务，适用于本地调试。" },
      { type: "h3", text: ".env 文件示例（生产环境）" },
      { type: "code", text: `DATABASE_URL=mysql://root:password@localhost:3306/aicanvas
JWT_SECRET=your_random_64_char_secret_here
OAUTH_SERVER_URL=https://your-oauth-server.com
COMFYUI_BASE_URL=http://192.168.1.100:8188
POYO_API_KEY=pk_xxxxxxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
NODE_ENV=production` },
      { type: "tip", text: "环境变量修改后需要重启服务器才能生效。" },
    ],
  },

  // ── 管理员配置指南 ──────────────────────────────────────────────────────────
  {
    id: "admin-guide",
    title: "管理员配置指南",
    emoji: "🛡️",
    content: [
      { type: "p", text: "管理员后台（访问路径：/admin）提供三大功能：白名单管理、操作日志、存储设置。仅具有 admin 角色的用户可访问。" },
      { type: "h3", text: "一、白名单管理" },
      { type: "p", text: "白名单开启后，只有列表中的 IP 地址或用户 ID 才能访问本应用。适用于限制访问权限的私有部署场景。" },
      { type: "steps", items: [
        "进入 /admin → 白名单管理标签页",
        "点击「启用白名单」开关（开启后立即生效，未在白名单中的请求将被拒绝）",
        "点击「添加条目」，选择类型（IP / 用户）并填写值",
        "IP 类型：填写 IPv4（如 192.168.1.1）或 IPv6 地址",
        "用户类型：填写用户的数字 ID（在用户管理中查看）",
        "添加可选备注说明该条目用途",
        "点击条目旁的删除按钮可随时移除",
      ]},
      { type: "warn", text: "开启白名单前，务必确认已将自己的 IP 或用户 ID 加入白名单，否则会将自己锁在系统外。如需紧急恢复，可以直接在数据库中修改 whitelistSettings.enabled = false。" },
      { type: "kv", rows: [
        ["IP 条目格式", "纯 IPv4 或 IPv6 地址，不支持 CIDR 段（如 192.168.1.0/24）"],
        ["用户条目格式", "纯数字的用户 ID，如 42"],
        ["「未知」IP 处理", "客户端 IP 无法确定时，IP 白名单不会放行（安全兜底）"],
      ]},
      { type: "h3", text: "二、存储设置" },
      { type: "p", text: "控制 AI 生成的媒体文件是否持久化存储到 S3（Manus 存储）。" },
      { type: "kv", rows: [
        ["持久化音频（persistAudio）", "开启：生成的音频文件上传到 S3，URL 永久有效。关闭：直接使用提供商临时 URL（约 24 小时后失效）"],
        ["持久化视频（persistVideo）", "开启：生成视频上传到 S3。关闭：使用 Poyo/Higgsfield 的临时 CDN URL"],
        ["图像", "图像始终持久化，不受此设置影响"],
      ]},
      { type: "tip", text: "在开发/预览环境中关闭持久化可以节省 S3 存储费用，但 24 小时后生成结果将失效。生产环境建议保持开启。" },
      { type: "h3", text: "三、操作日志（审计日志）" },
      { type: "p", text: "记录所有用户的关键操作，用于安全审计和使用统计。" },
      { type: "kv", rows: [
        ["login_email", "邮箱密码登录"],
        ["login_oauth", "OAuth 登录"],
        ["image_gen", "图像生成（包含模型、提示词摘要）"],
        ["video_gen", "视频生成（包含提供商、时长）"],
        ["audio_music", "音乐生成"],
        ["audio_dubbing", "AI 配音/TTS"],
        ["subtitle_transcribe", "语音转字幕"],
        ["comfyui_workflow_exec", "ComfyUI 自定义工作流执行"],
        ["logs_cleared", "管理员清空日志记录"],
      ]},
      { type: "p", text: "日志包含用户信息（ID/邮箱/姓名）、操作时间、IP 地址及地理位置（国家/地区/城市）、操作详情。可按操作类型过滤查看，每次最多加载 200 条。" },
    ],
  },

  // ── 前端接口配置说明 ────────────────────────────────────────────────────────
  {
    id: "api-interface-config",
    title: "前端接口配置说明",
    emoji: "🔌",
    content: [
      { type: "p", text: "本应用前后端通过 tRPC v11 进行类型安全的通信，所有接口均需登录认证。以下是 ComfyUI 相关接口的完整说明。" },
      { type: "h3", text: "ComfyUI 接口清单" },
      { type: "kv", rows: [
        ["comfyui.fetchModels", "获取 ComfyUI 服务器的可用模型、LoRA、采样器、VAE 列表（每个节点「刷新模型」按钮触发）"],
        ["comfyui.generateImage", "执行图像生成（txt2img / img2img），返回图像 URL 或多张 URL 列表"],
        ["comfyui.generateVideo", "执行视频生成（animatediff / svd），返回视频 URL"],
        ["comfyui.analyzeWorkflow", "分析 API Format Workflow JSON，返回自动检测的参数绑定列表"],
        ["comfyui.uploadWorkflowImage", "将图像上传到 ComfyUI 服务器（自定义工作流中 image 类型参数使用）"],
        ["comfyui.executeWorkflow", "执行自定义工作流，支持任意 JSON 和参数注入，返回输出 URL 列表"],
      ]},
      { type: "h3", text: "请求限制" },
      { type: "kv", rows: [
        ["Workflow JSON 大小", "≤ 500 KB（超过会被拒绝）"],
        ["参考图大小", "≤ 30 MB（上传到 ComfyUI 前的大小限制）"],
        ["输出文件大小", "≤ 200 MB（单个输出文件大小上限）"],
        ["图像任务超时", "约 5 分钟（100 次 × 3 秒轮询）"],
        ["视频任务超时", "约 10 分钟（200 次 × 3 秒轮询）"],
        ["提示词长度", "≤ 2000 字符（正向/负向各自限制）"],
        ["模型名长度", "≤ 255 字符"],
        ["URL 长度", "≤ 2048 字符（服务器地址/参考图 URL）"],
      ]},
      { type: "h3", text: "实时进度推送（WebSocket）" },
      { type: "p", text: "生成任务运行时，进度通过 Socket.IO 实时推送到前端，更新节点的进度条（0–100%）。推送路径：" },
      { type: "code", text: `ComfyUI WS (/ws) → 本应用服务器 → Socket.IO room: "project:{projectId}"
→ 前端 Canvas 监听 "comfyui:progress" 事件
→ 更新对应 nodeId 的 progress 字段（不持久化）` },
      { type: "p", text: "多节点同时生成时，每个任务使用独立的 WS 连接，互不干扰，可以同时显示多个进度条。" },
      { type: "h3", text: "去重保护（Dedupe）" },
      { type: "p", text: "所有生成接口都有去重保护：同一用户+同一节点 ID 的并发请求会被合并为一次实际调用，防止重复提交（例如快速双击运行按钮）。" },
      { type: "h3", text: "多 GPU 负载均衡策略" },
      { type: "p", text: "当前实现为手动分流：在每个节点的「服务器地址」字段填写不同的 ComfyUI 实例地址（:8188、:8189 等）。系统不自动负载均衡，需要用户根据 GPU 空闲情况手动选择目标实例。" },
      { type: "tip", text: "可以在不同节点中设置不同的 customBaseUrl，同时运行的任务会分别发送到对应的 GPU 实例，实现并行生成。" },
    ],
  },
];

export function getHelpSectionById(id: string): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.id === id);
}

export function getHelpSectionByNodeType(nodeType: NodeType): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.nodeType === nodeType);
}

export const COMFYUI_SECTION_IDS = [
  "node-comfyui-image",
  "node-comfyui-video",
  "node-comfyui-workflow",
  "comfyui-setup",
  "comfyui-params-reference",
  "comfyui-workflow-advanced",
  "comfyui-troubleshoot",
];
