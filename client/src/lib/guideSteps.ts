/**
 * 交互式新手导览的步骤定义（纯数据，便于单测与维护）。
 *
 * 每一步可指定一个 CSS 选择器 `target` 高亮某个真实界面元素；`target` 为 null 时
 * 卡片居中、不高亮任何元素（用于总览/概念讲解）。`openPanel` 让 Canvas 在进入该步时
 * 程序化打开对应面板（面板多为条件渲染，不先打开就无从高亮）。`interactive` 为 true 时
 * spotlight 镂空区可点击（放行指针事件），用于「亲手做一次」的混合体验。
 *
 * 锚点约定：关键按钮在 Canvas.tsx / 各组件根节点补了 `data-tour="..."` 属性；
 * 顶栏/底栏容器用现成的 `.canvas-topbar` / `.canvas-bottombar`。目标不存在时
 * GuidedTour 自动降级为居中卡（如某按钮仅在特定风格下出现）。
 */

/** 可被导览程序化打开的面板键（对应 Canvas.tsx 里的 setShowXxx）。 */
export type GuidePanel =
  | "nodePicker"
  | "connectionHints"
  | "assets"
  | "charLib"
  | "agentChat"
  | "shortcuts"
  | null;

export type GuidePlacement = "top" | "bottom" | "left" | "right" | "auto";

export interface TourStep {
  id: string;
  /** 章节标签（卡片顶部小字）。 */
  chapter: string;
  /** 卡片图标（emoji，保持数据文件纯净、免图标映射）。 */
  icon: string;
  title: string;
  /** 正文段落。 */
  body: string[];
  /** 可选高亮提示条。 */
  tip?: string;
  /** 可选键位胶片（如 ["Alt","W"]）。 */
  keys?: string[];
  /** 可选流程链示意（如 ["脚本","分镜","图像","视频"]）。 */
  flow?: string[];
  /** 高亮目标的 CSS 选择器；null = 居中不高亮。 */
  target: string | null;
  /** 卡片相对目标的方位；默认 auto（按可视区自动选边）。 */
  placement?: GuidePlacement;
  /** 进入本步时程序化打开的面板。 */
  openPanel?: GuidePanel;
  /** true 时镂空区可点击（放行指针），用于「亲手试一下」。 */
  interactive?: boolean;
  /** 亲手操作步的行动提示（配合 interactive）。 */
  actionHint?: string;
}

export const GUIDE_STEPS: TourStep[] = [
  {
    id: "welcome",
    chapter: "开始",
    icon: "✨",
    title: "欢迎来到 AI 视频画布",
    body: [
      "这是一条「把想法拍成片」的可视化流水线：在无限画布上摆节点、拉连线，脚本→分镜→图像→视频→剪辑一气呵成，云端与本地 ComfyUI 引擎随你调度。",
      "接下来约 1 分钟带你认全主要功能。可随时点「跳过」，或稍后从右上角「更多 → 新手导览」重新开始。",
    ],
    tip: "键盘 → / ← 可翻页，Esc 退出。",
    target: null,
  },
  {
    id: "topbar",
    chapter: "界面总览",
    icon: "🧭",
    title: "顶栏：项目 · 余额 · 各面板开关",
    body: [
      "左侧是返回、项目名（点击可重命名）、保存状态与实时余额仪表盘（Poyo / KIE 点数一眼可见）。",
      "右侧一排是各面板的开关：聊天、画布助手、模板库、素材库、角色库、剪辑器、撤销/重做/保存，以及「更多 ⋯」里的进阶功能。",
    ],
    target: ".canvas-topbar",
    placement: "bottom",
  },
  {
    id: "add-node",
    chapter: "第一步 · 建节点",
    icon: "➕",
    title: "添加你的第一个节点",
    body: [
      "点亮的「添加」会弹出节点选择器：按脚本 / 图像 / 视频 / 音频 / ComfyUI 等分类排列，支持搜索，回车即添加首个匹配。",
      "顶部还有「导入工作流」向导磁贴，可直接把 ComfyUI 工作流 JSON 变成画布节点。也可在画布空白处双击快速新建。",
    ],
    tip: "试着点一下高亮的「添加」按钮，看看节点选择器。",
    target: '[data-tour="add-node"]',
    placement: "top",
    openPanel: "nodePicker",
    interactive: true,
    actionHint: "点「添加」打开选择器",
  },
  {
    id: "workflow",
    chapter: "节点式工作流",
    icon: "🔗",
    title: "拉连线，串成一条流水线",
    body: [
      "每个节点是一道工序，上游产物顺着连线喂给下游。最典型的成片链路如下——脚本写故事、分镜拆镜头、图像出关键帧、视频动起来。",
      "拖动节点边缘的圆点即可连线；拖到空白处松手会就地弹出「建节点并连线」菜单，顺手搭流程。",
    ],
    flow: ["脚本", "分镜", "图像", "视频", "剪辑"],
    target: null,
  },
  {
    id: "connect-rules",
    chapter: "节点式工作流",
    icon: "🧩",
    title: "连线指引：谁能连谁",
    body: [
      "不确定某个节点能连到哪里？打开「连线指引」侧栏，选中任一节点即可看到它「可输出到」「可接收自」哪些节点类型，避免连出无效边。",
    ],
    target: '[data-tour="conn-hints"]',
    placement: "top",
    openPanel: "connectionHints",
  },
  {
    id: "run",
    chapter: "运行与状态",
    icon: "▶️",
    title: "一键运行整条工作流",
    body: [
      "「运行」按选择智能感知：不选 = 跑全部；选中 1 个 = 从该节点起跑；框选多个 = 只跑选中。生成中/排队/失败都会在顶部状态条实时汇总，点失败可直接跳到出错节点。",
    ],
    tip: "运行会真实消耗点数，导览期间先不点，看看即可。",
    target: '[data-tour="run"]',
    placement: "top",
  },
  {
    id: "models",
    chapter: "模型与点数",
    icon: "🎛️",
    title: "分类模型选择器 · 实时点数预估",
    body: [
      "图像 / 视频 / 对话节点共用一个模型选择器：按供应商与家族分组、可搜索，每个模型标注消耗点数（credits），按预算挑选。",
      "生成按钮会随所选模型与参数（时长 / 分辨率 / 张数 / 字数）实时预估消耗，并计入可导出的审计日志。",
    ],
    target: null,
  },
  {
    id: "character",
    chapter: "角色一致性",
    icon: "🧑‍🎤",
    title: "角色库：锁定同一张脸",
    body: [
      "角色节点的多视角参考图会自动锁定身份，贯穿 ComfyUI（IPAdapter / LoRA / 参考图）与 Poyo 图/视频的多模态参考；「一致性种子」把同一随机种子钉到该角色全部镜头。",
      "角色保存进「全局角色库」后可跨项目快速调用，一键「应用到本场景所有镜头」。",
    ],
    target: '[data-tour="charlib"]',
    placement: "bottom",
    openPanel: "charLib",
  },
  {
    id: "atref",
    chapter: "引用",
    icon: "@",
    title: "@ 引用：无需连线也能取用",
    body: [
      "在任意提示词框输入 @，即可引用画布上的角色 / 场景，或已生成的图像 / 音频 / 视频节点：@角色 锁身份、@图像 作参考、@音频 驱动数字人口型、@视频 作动作迁移源。",
      "被 @ 的对象会在节点吸附栏显示为「参与项」并标注来源，比连线更轻。",
    ],
    target: null,
  },
  {
    id: "comfyui",
    chapter: "ComfyUI 集成",
    icon: "🧱",
    title: "自建 ComfyUI · 工作流导入向导",
    body: [
      "内置图像（多 LoRA / ControlNet / IPAdapter / Inpaint / 放大）与视频（AnimateDiff / Wan / LTX）节点，15 类模型自动发现。",
      "「导入工作流」向导可粘贴 JSON / 拖文件 / ComfyUI PNG，用服务器真实节点定义预检纠错；勾选「AI 辅助分析」还能自动纠正参数类型与主次排序。",
    ],
    tip: "这些都在「添加」的节点选择器里。",
    target: '[data-tour="add-node"]',
    placement: "top",
    openPanel: "nodePicker",
  },
  {
    id: "comfy-templates",
    chapter: "ComfyUI 集成",
    icon: "📦",
    title: "ComfyUI 工作流 / 节点模板库",
    body: [
      "右键任意 ComfyUI 节点，把它的全部参数（含提示词 / 工作流）存为共享模板，全员可复用。",
      "打开顶栏「节点模板库」：按外框颜色分类、可搜索 / 注释 / 重命名，点击即在画布快速新建带参节点。",
    ],
    target: '[data-tour="node-lib"]',
    placement: "bottom",
  },
  {
    id: "assets",
    chapter: "素材库",
    icon: "📎",
    title: "素材库：批量上传 · 团队共享",
    body: [
      "多选 / 拖拽 / 粘贴（Ctrl·⌘V）批量上传，视频点击全屏预览。同一项目的编辑者共享素材库，互见彼此上传与 AI 生成的素材，直接拖进画布使用。",
    ],
    target: '[data-tour="assets"]',
    placement: "bottom",
    openPanel: "assets",
  },
  {
    id: "editor",
    chapter: "剪辑成片",
    icon: "🎬",
    title: "内置综合剪辑器 · AI 智能剪辑",
    body: [
      "点顶栏剪辑器进入 /editor：多片段时间轴、转场特效、富文本字幕、AI 配乐配音、调色预设，单遍 ffmpeg 导出高素质成片，撤销重做 + 自动保存。",
      "「AI 智能剪辑」可自动转写、按语义挑选保留段落，快速出粗剪。",
    ],
    target: '[data-tour="editor"]',
    placement: "bottom",
  },
  {
    id: "agent",
    chapter: "画布助手",
    icon: "🪄",
    title: "画布助手：一句话改画布",
    body: [
      "右下角的浮层助手用自然语言让 AI 直接在画布上建 / 连 / 改节点（复用智能体同一套引擎），支持 @角色 引用、/ 唤起技能、一键撤销本次改动。",
      "每次进入画布默认打开，对话上下文落库，跨设备与清缓存都不丢。",
    ],
    target: '[data-tour="agent"]',
    placement: "bottom",
    openPanel: "agentChat",
  },
  {
    id: "collab",
    chapter: "协作与聊天",
    icon: "💬",
    title: "团队聊天 · 聊天 AI 助手 · 协作",
    body: [
      "多用户同时编辑，节点变更秒同步，协作者光标可见、他人节点按创建者显示专属颜色。",
      "顶栏聊天支持大厅 / 群聊 / 端到端加密私聊，还能装成移动端 / 桌面应用。",
      "聊天里还内置「AI 助手」——直接和 AI 对话写脚本、润色、答疑，与画布节点共用同一套人设模板。",
    ],
    target: '[data-tour="chat"]',
    placement: "bottom",
  },
  {
    id: "asset-push",
    chapter: "产物推送",
    icon: "🔔",
    title: "产物自动推送，不进画布也能收",
    body: [
      "你生成的每个产物（图 / 视频 / 音频 / ComfyUI）都会自动推送到聊天里的「我的产物通知」房——不进画布也能实时收、历史随时查。",
      "点「更多 → 产物推送设置」还能配 Bark / Server酱 / Telegram 等外部推送，关着页面 / 在手机上离线也能收到。",
    ],
    target: '[data-tour="more"]',
    placement: "bottom",
  },
  {
    id: "theme",
    chapter: "外观",
    icon: "🎨",
    title: "主题 · 工作室风格 · 画布背景",
    body: [
      "15 套主题（含护眼浅色与 ComfyUI 炭灰深色）随手切换；「专业 / 创意 / 工作室」风格切换改变节点参数的呈现密度；画布背景默认跟随主题，也可固定底色。",
    ],
    target: '[data-tour="theme"]',
    placement: "top",
  },
  {
    id: "budget",
    chapter: "预算管控",
    icon: "💰",
    title: "预算面板：花之前先算清",
    body: [
      "一键查看整张画布的预估消耗：逐节点按模型 / 参数精算，分 KIE 点与 Poyo cr 两路对照实时余额（超额标红），可设项目预算上限，超限时智能体自动暂停并提醒。",
    ],
    target: '[data-tour="budget"]',
    placement: "top",
  },
  {
    id: "shortcuts",
    chapter: "效率",
    icon: "⚡",
    title: "快捷键与效率操作",
    body: [
      "框选后 Ctrl+C/V 复制整条镜头链（含内部连线）；「一键整理」按连线方向自动排版；速览快捷键临时展开全画布的参考图与提示词，一眼速览。",
      "点开高亮的「?」可查看完整快捷键列表。",
    ],
    keys: ["Alt", "W"],
    target: '[data-tour="shortcuts"]',
    placement: "top",
    openPanel: "shortcuts",
  },
  {
    id: "finish",
    chapter: "完成",
    icon: "🚀",
    title: "开始创作吧！",
    body: [
      "你已认全主要功能。更详细的图文说明在「更多 → 操作指南」里随时可查；本导览也能从那里重新开始。",
      "现在，去搭你的第一条工作流吧——从「添加」一个脚本或图像节点开始。",
    ],
    tip: "随时可从「更多 → 新手导览」重开本引导。",
    target: null,
  },
];
