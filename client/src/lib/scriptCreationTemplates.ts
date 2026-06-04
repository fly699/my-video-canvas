/**
 * ScriptNode 的 "AI 剧本创作" 模板库。
 *
 * 每个模板代表一类**具体**的视频项目（如 "抖音 15s 钩子" / "微电影
 * 3-5min"），包含：
 *  - 推荐写作 LLM（基于该模型的专长）
 *  - 一键填充表单的参数预设（genre / style / mood / sceneCount /
 *    totalDuration / aspectRatio / targetVideoModel）
 *  - systemPromptAddon：服务端拼到 system prompt 末尾的"详细写作指令"，
 *    包含每个模型应该如何发挥的具体技巧（如"Claude Sonnet 请输出 4-act
 *    结构 + 角色弧线"），从根本上让生成结果贴合该类型项目的行业惯例。
 *
 * 添加模板时：
 *  - presets 中的 genre/style/mood/aspectRatio/targetVideoModel 必须命中
 *    ScriptNode.tsx 中 GENRES/STYLES/MOODS/RATIOS/TARGET_MODELS 数组的合法值
 *  - recommendedLlm 必须命中 CHAT_MODELS 的 id
 *  - systemPromptAddon 写 200-500 字，明确：节奏 / 句长 / 视角 / 输出额外约束
 */
import type { LucideIcon } from "lucide-react";
import {
  Clapperboard, Megaphone, Film, BookOpenText, Music, FlaskConical,
  Sparkles, Camera, Video, ScrollText, ShoppingBag, GraduationCap,
  Search, History, Disc3, Drama, Compass, MountainSnow,
  Heart, Pizza, Bot, Layers,
} from "lucide-react";

const md = (s: string) => s.replace(/^[ \t]+/gm, "").trim();

export interface ScriptTemplate {
  id: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  /** CHAT_MODELS id */
  recommendedLlm: string;
  presets: {
    genre?: string;
    style?: string;
    mood?: string;
    targetVideoModel?: string;
    aspectRatio?: string;
    sceneCount?: number;
    totalDuration?: number;
  };
  systemPromptAddon: string;
}

export interface ScriptTemplateCategory {
  id: string;
  label: string;
  templates: ScriptTemplate[];
}

// CHAT_MODELS id reference (do not change without updating models.ts)
const M = {
  // gemini-2.5-flash is no longer served (see models.ts) — recommend the working
  // Gemini 3 Flash so applying a template doesn't pick a dead model.
  GEMINI: "gemini-3-flash-preview",
  HAIKU:  "claude-haiku-4-5-20251001",
  SONNET: "claude-sonnet-4-5-20250929",
  GPT:    "gpt-5.2",
} as const;

// ── 1. 短视频 ──────────────────────────────────────────────────────────
const SHORT_VIDEO: ScriptTemplate[] = [
  {
    id: "douyin-15s-hook",
    label: "抖音 15s 钩子",
    icon: Sparkles,
    blurb: "前 3 秒必爆款 · 强节奏",
    recommendedLlm: M.HAIKU,
    presets: { genre: "短视频", style: "电影感", mood: "紧张刺激", targetVideoModel: "seedance", aspectRatio: "9:16", sceneCount: 5, totalDuration: 15 },
    systemPromptAddon: md(`
      你是抖音爆款短视频编剧。这次写的是 15 秒竖屏视频，必须遵守：
      - **0-3 秒**：用一个反常识/反差/数字/质问钩住观众（"完播率 > 50%" 的死线）
      - **4-12 秒**：3 个递进信息点，每点 2-3 秒一次画面切换
      - **13-15 秒**：留悬念或重击式结尾，不要软收（不要"你学会了吗"）
      - 句子全部短句（每句 ≤15 字），口语化，**禁用书面语和长定语**
      - 旁白节奏对应画面切换：每 2-3 秒一次明显视觉变化
      - Claude Haiku 4.5 速度优势：保持文字精简、不要 over-think；快速给出 5 个 scene + 短促 promptText
    `),
  },
  {
    id: "xiaohongshu-recommend",
    label: "小红书种草 90s",
    icon: Heart,
    blurb: "情感铺陈 + 产品融入",
    recommendedLlm: M.SONNET,
    presets: { genre: "短视频", style: "写实", mood: "温暖治愈", targetVideoModel: "kling", aspectRatio: "9:16", sceneCount: 7, totalDuration: 90 },
    systemPromptAddon: md(`
      你是小红书种草内容编剧。90 秒情绪铺陈型种草视频：
      - 前 10 秒：建立"我是谁 / 我遇到什么问题"（共情）
      - 11-50 秒：发现产品的过程，要有"惊喜瞬间"的视觉锚点（产品特写 + 表情反应）
      - 51-80 秒：使用细节展示，画面要美（生活化场景而非演播室）
      - 81-90 秒：温柔的推荐句，避免硬广话术
      - 写作语气：第一人称女性视角，亲切但不做作；可以有自然口癖（"真的好用"/"我居然才发现"）
      - Claude Sonnet 4.6 擅长情感细腻度：请用具体感官细节代替形容词（"杯沿渗出的暖意" 而非 "温暖")
    `),
  },
  {
    id: "bilibili-knowledge",
    label: "B 站知识科普",
    icon: GraduationCap,
    blurb: "信息密度高 · 结构清晰",
    recommendedLlm: M.GEMINI,
    presets: { genre: "短视频", style: "写实", mood: "轻松幽默", targetVideoModel: "veo", aspectRatio: "16:9", sceneCount: 8, totalDuration: 180 },
    systemPromptAddon: md(`
      你是 B 站知识区 UP 主的脚本写手。3 分钟科普视频要求：
      - 结构：钩子（15s）→ 痛点引入（30s）→ 核心 3-4 个知识点（90s）→ 反常识结论（30s）→ 互动收尾（15s）
      - 每个知识点都要配 1-2 个"视觉化比喻"（如把光速比作开车环游地球的时间）
      - 旁白要"有梗"——每 30 秒至少一个轻幽默或网络梗触发点
      - 避免说教语气，多用"咱们""你以为""真相是"
      - Gemini 2.5 Flash 平衡能力强：请同时输出旁白脚本 + 配套画面（实拍/示意图/动画）建议；不要全用空镜
    `),
  },
  {
    id: "movie-explainer",
    label: "影视混剪解说",
    icon: Film,
    blurb: "5 分钟讲完一部电影",
    recommendedLlm: M.SONNET,
    presets: { genre: "短视频", style: "电影感", mood: "神秘悬疑", targetVideoModel: "kling", aspectRatio: "16:9", sceneCount: 10, totalDuration: 300 },
    systemPromptAddon: md(`
      你是影视解说博主（如"奇爱博士""木鱼水心"风格）。5 分钟讲完一部电影：
      - 开头 30 秒：用最尖锐的剧情转折开场，制造"我想看完"动力
      - 中段：按因果链梳理而非时间线，每场戏标注**关键转折类型**（人物动机变化 / 冲突升级 / 反转）
      - 结尾 30 秒：升华到导演表达层面（不只是讲故事，要"读懂电影")
      - 旁白语速比常规快 1.2 倍——句子可以长，但信息必须密
      - Claude Sonnet 4.6 长上下文 + 强逻辑：请构建场景之间的因果链条，避免流水账；每个 scene 描述要包含"上一场到这场为什么转折"
    `),
  },
  {
    id: "street-interview",
    label: "街头采访",
    icon: Pizza,
    blurb: "真实感 · 反差对比",
    recommendedLlm: M.HAIKU,
    presets: { genre: "短视频", style: "写实", mood: "轻松幽默", targetVideoModel: "seedance", aspectRatio: "9:16", sceneCount: 6, totalDuration: 60 },
    systemPromptAddon: md(`
      你是街头采访类视频编剧。60 秒竖屏，模拟真人采访：
      - 必须有 5-6 个**不同人物**的快速短答（每人 5-8 秒）
      - 设计一个核心问题（如"你愿意为爱情放弃 100 万吗"），答案有戏剧性反差（年轻/年长 + 男/女 + 不同职业）
      - 每个回答前用 0.5 秒静帧捕捉表情
      - 收尾用一个"金句"或意外答案
      - Claude Haiku 4.5 速度优势：直接给短答，不要思考过度；scene 描述聚焦在人物表情 + 环境氛围
    `),
  },
];

// ── 2. 广告 · 营销 ────────────────────────────────────────────────────
const ADS: ScriptTemplate[] = [
  {
    id: "viral-30s",
    label: "病毒营销 30s",
    icon: Megaphone,
    blurb: "高传播性 · 反转结构",
    recommendedLlm: M.GPT,
    presets: { genre: "广告片", style: "电影感", mood: "轻松幽默", targetVideoModel: "veo", aspectRatio: "9:16", sceneCount: 6, totalDuration: 30 },
    systemPromptAddon: md(`
      你是病毒营销广告编剧。30 秒短片需要满足"WTF 量纲"：
      - 必须有一个核心 **反转/反常识** 设定（即"看了第一遍以为是 X，结果是 Y"）
      - 6 个 scene 节奏：建立场景 (5s) → 误导 (10s) → 反转点 (5s) → 真相揭示 (5s) → 品牌露出 (5s)
      - 不允许超过 30 秒（哪怕 1 秒）
      - 品牌信息**只在最后 5 秒**出现，前 25 秒不能透露
      - GPT-5.2 创意能力：请尽量给出"反直觉"的设定（不要再用"普通早晨突然变身"的套路）
    `),
  },
  {
    id: "brand-emotional-60s",
    label: "品牌情感片 60s",
    icon: Heart,
    blurb: "情绪曲线 · 价值观传递",
    recommendedLlm: M.SONNET,
    presets: { genre: "广告片", style: "电影感", mood: "温暖治愈", targetVideoModel: "dop", aspectRatio: "16:9", sceneCount: 6, totalDuration: 60 },
    systemPromptAddon: md(`
      你是国际广告公司创意总监。60 秒品牌情感片：
      - 情绪曲线：平静 → 失落 → 触动 → 释怀 → 升华（每 scene 一个阶段）
      - 不能直接说品牌的功能/卖点；通过角色行为暗示价值观
      - 旁白 = "金句 + 留白"，每句话之间至少 3 秒画面让情绪沉淀
      - 配乐建议：钢琴/弦乐/无人声为主
      - Claude Sonnet 4.6 情感细腻 + 长文理解：请用**细节而非形容词**——一个动作、一个眼神、一件物品比"温暖""感动"更有力
    `),
  },
  {
    id: "product-demo-45s",
    label: "产品演示 45s",
    icon: ShoppingBag,
    blurb: "卖点清晰 · 视觉示范",
    recommendedLlm: M.GEMINI,
    presets: { genre: "广告片", style: "写实", mood: "壮阔震撼", targetVideoModel: "wan", aspectRatio: "16:9", sceneCount: 5, totalDuration: 45 },
    systemPromptAddon: md(`
      你是 B2C 产品广告编剧。45 秒产品演示：
      - 5 个 scene 必须分别对应：**问题 / 产品登场 / 核心功能 / 使用场景 / 行动号召**
      - 每个 scene 旁白 ≤2 句，画面比文字重要
      - 产品镜头必须包含：特写细节（材质、按键）+ 使用瞬间（手与产品的关系）
      - 行动号召要具体（"点击购物车" / "搜索 XXX"），不要泛泛"了解更多"
      - Gemini 2.5 Flash 平衡能力：请确保 promptText 中**产品本身的描述精确**（材质、颜色、尺寸感、品牌定位），不要写虚的氛围词
    `),
  },
  {
    id: "influencer-recommend",
    label: "网红种草 60s",
    icon: Disc3,
    blurb: "亲身体验 · 反复强化",
    recommendedLlm: M.HAIKU,
    presets: { genre: "广告片", style: "写实", mood: "轻松幽默", targetVideoModel: "kling", aspectRatio: "9:16", sceneCount: 6, totalDuration: 60 },
    systemPromptAddon: md(`
      你是 KOL 种草脚本写手。60 秒竖屏种草：
      - 开头 5 秒：用 "你们一直问我用什么..." 或 "我必须公开这个秘密" 类钩子
      - 主体 45 秒：拆 3 个使用场景（早/午/晚 或 工作/休息/外出），每场景 15 秒
      - 收尾 10 秒：直接给产品名 + 优惠码（不要含蓄）
      - 语气：闺蜜对话感 + 适度夸张（"真的天塌下来都要安利"）
      - Claude Haiku 4.5 速度：直接给出多个口语化短句，不要 over-polish；scene 描述用日常生活场景，避免摆拍感
    `),
  },
];

// ── 3. 电影 · 剧集 ─────────────────────────────────────────────────────
const FILM: ScriptTemplate[] = [
  {
    id: "feature-outline",
    label: "电影长片大纲",
    icon: Clapperboard,
    blurb: "三幕结构 · 多线推进",
    recommendedLlm: M.SONNET,
    presets: { genre: "电影", style: "电影感", mood: "壮阔震撼", targetVideoModel: "dop", aspectRatio: "2.35:1", sceneCount: 12, totalDuration: 600 },
    systemPromptAddon: md(`
      你是好莱坞剧本顾问。电影长片大纲（10 分钟视频化的提案）：
      - 严格三幕结构：
        - **第一幕（30%）**：日常 → 召唤 → 拒绝 → 接受
        - **第二幕（50%）**：试炼 → 同盟 → 黑夜
        - **第三幕（20%）**：复活 → 回归 → 升华
      - 每个 scene 必须标注属于哪一幕、哪个 beat
      - 角色弧线：主角必须有 "I want / I need" 的差异（表面追求 vs 内心需要），在第二幕 midpoint 揭露
      - 至少 1 个对位角色（antagonist 或 mirror）
      - Claude Sonnet 4.6 长上下文 + 强逻辑：充分用上下文窗口，每个 scene 描述里包含"上一场到这场的因果链 + 给下一场的伏笔"
    `),
  },
  {
    id: "webdrama-episode",
    label: "网剧分集",
    icon: Drama,
    blurb: "单集 8-10min · 强钩子",
    recommendedLlm: M.SONNET,
    presets: { genre: "短剧", style: "电影感", mood: "紧张刺激", targetVideoModel: "kling", aspectRatio: "9:16", sceneCount: 10, totalDuration: 480 },
    systemPromptAddon: md(`
      你是竖屏短剧编剧（针对抖音/快手网剧）。单集 8 分钟：
      - **必须**有 3 个以上反转（每 2-3 分钟一次）
      - 开头 30 秒：上一集悬念回扣 + 本集新冲突点燃
      - 中段：每 90 秒一次"剧情爆点"——撕逼/打脸/暴富/打脸反转
      - 结尾 30 秒：留下一集钩子（角色突然出现/反派现形/关键道具）
      - 对白要快、要尖、要有冲突——避免"温和劝说"类对话
      - Claude Sonnet 4.6 推理能力：请预先规划好整集的"爆点节奏地图"，确保每 90 秒触发一次情绪波峰
    `),
  },
  {
    id: "short-film-5min",
    label: "微电影 3-5min",
    icon: Film,
    blurb: "完整起承转合 · 一个核心情感",
    recommendedLlm: M.SONNET,
    presets: { genre: "微电影", style: "电影感", mood: "温暖治愈", targetVideoModel: "dop", aspectRatio: "2.35:1", sceneCount: 8, totalDuration: 300 },
    systemPromptAddon: md(`
      你是短片导演。5 分钟微电影：
      - 整片围绕**一个核心情感**（如"和解" / "释怀" / "传承"），不贪多
      - 角色不超过 3 个，主角 1 个，其他都是镜面/对位
      - 必须有"无对白"的情感高潮段（至少 30 秒纯画面 + 配乐）
      - 收尾不要解释——让观众自己脑补
      - Claude Sonnet 4.6：请用电影学院级的镜头语言术语描述 promptText（如"Close-up on hands trembling, shallow DOF, 35mm equivalent, slow push"），不要写小学生作文
    `),
  },
  {
    id: "thriller-mystery",
    label: "悬疑推理",
    icon: Search,
    blurb: "线索铺陈 · 反转设计",
    recommendedLlm: M.SONNET,
    presets: { genre: "电影", style: "电影感", mood: "神秘悬疑", targetVideoModel: "kling", aspectRatio: "16:9", sceneCount: 9, totalDuration: 480 },
    systemPromptAddon: md(`
      你是悬疑推理片编剧。剧情需要满足"线索可回溯"原则：
      - 凶手/真相在第一幕已经露面（不能"凭空冒出"）
      - 整片**至少 5 个伏笔**埋在前 60% 时长里，结尾全部回收
      - 每场戏标注：**红鲱鱼（误导）** 或 **真线索**
      - 揭晓时刻不要冗长解释——用 30 秒蒙太奇闪回前面的线索即可
      - 时间线可以非线性，但每跳跃必须有过渡指示
      - Claude Sonnet 4.6 强推理：请先在心里完整推演完整案件全貌，再倒推每场戏需要露出/隐藏什么信息——保证逻辑闭环
    `),
  },
  {
    id: "three-act",
    label: "标准三幕剧",
    icon: Layers,
    blurb: "经典戏剧结构教学",
    recommendedLlm: M.SONNET,
    presets: { genre: "电影", style: "电影感", mood: "壮阔震撼", targetVideoModel: "veo", aspectRatio: "16:9", sceneCount: 9, totalDuration: 360 },
    systemPromptAddon: md(`
      你是编剧教学的实战派。请严格按 **Field 三幕结构** 输出：
      - 1-3 场：建立（act 1）—— 平常世界 → 触发事件（plot point 1）
      - 4-7 场：发展（act 2）—— 升级冲突 → 中点（midpoint reversal）→ 最低谷（plot point 2）
      - 8-9 场：高潮 + 落幕（act 3）—— 决战 → 新平衡
      - 每个 scene 标注属于哪一幕 + 是否是关键 beat
      - 单独输出一个 "## 结构分析" 段，用 200 字解释为什么这么切分
      - Claude Sonnet 4.6 教学能力：除了剧本本身，给学习者一个"知识增量"
    `),
  },
];

// ── 4. 纪录 · 教学 ─────────────────────────────────────────────────────
const DOC: ScriptTemplate[] = [
  {
    id: "documentary-narration",
    label: "纪录片旁白",
    icon: Camera,
    blurb: "客观叙事 · 信息密度",
    recommendedLlm: M.GEMINI,
    presets: { genre: "纪录片", style: "写实", mood: "壮阔震撼", targetVideoModel: "veo", aspectRatio: "16:9", sceneCount: 8, totalDuration: 240 },
    systemPromptAddon: md(`
      你是 BBC / NHK 风格纪录片旁白撰稿人。4 分钟纪录片：
      - 旁白语气**客观克制**——避免感叹号和煽情形容词
      - 每个 scene 含一个数据/事实/历史背景作为锚点（"1947年的春天，..."）
      - 画面建议：实景拍摄 + 历史影像 + 数据可视化 三种类型混合
      - 配乐建议：管弦乐 / 环境音为主，避免流行乐
      - 收尾要"开放" —— 抛出新问题或时代反思，不要给结论
      - Gemini 2.5 Flash 多模态平衡：请同时给视觉建议（实拍 vs 资料 vs 动画）+ 旁白文本，让画面信息与文字信息互补而非重复
    `),
  },
  {
    id: "tutorial-explainer",
    label: "教学说明",
    icon: GraduationCap,
    blurb: "步骤清晰 · 视觉示意",
    recommendedLlm: M.GEMINI,
    presets: { genre: "宣传片", style: "极简", mood: "轻松幽默", targetVideoModel: "wan", aspectRatio: "16:9", sceneCount: 6, totalDuration: 180 },
    systemPromptAddon: md(`
      你是教学视频脚本师。3 分钟教学：
      - 必须包含：1. **问题陈述**（30s）2. **学习目标**（15s）3. **核心步骤**（120s，分 3-5 步）4. **常见错误**（15s）5. **总结+下一步**（15s）
      - 每个步骤的画面：实操特写 + 错误对比 + 文字标签
      - 旁白节奏：步骤切换时 1-2 秒停顿
      - 不要假设观众已知，但也不要凡事都解释（找平衡点）
      - Gemini 2.5 Flash：请给出**画面与旁白同步度高**的脚本（旁白说什么，画面就该出现什么——这是教学视频的金科玉律）
    `),
  },
  {
    id: "history-reenactment",
    label: "历史复刻",
    icon: History,
    blurb: "时代还原 · 戏剧化呈现",
    recommendedLlm: M.SONNET,
    presets: { genre: "纪录片", style: "复古胶片", mood: "神秘悬疑", targetVideoModel: "kling", aspectRatio: "2.35:1", sceneCount: 8, totalDuration: 300 },
    systemPromptAddon: md(`
      你是历史题材编剧。5 分钟历史复刻短片：
      - 每个 scene 必须**精确到年月**，地点要具体到城市
      - 服装、道具、建筑必须符合时代（明确写"光绪二十六年，北京宣武门外"而非泛泛"清末"）
      - 历史人物对白可以虚构但要符合时代用语（不要让晚清官员说"OK"）
      - 至少 1 个真实历史细节作为锚点（让观众觉得"这是真的"）
      - 旁白可以适度戏剧化，但不能编造重大事实
      - Claude Sonnet 4.6 知识渊博：调动你对历史的具体细节认知（服饰/官衔/建筑/食物），别只写"古代场景"
    `),
  },
];

// ── 5. MV · 音乐 ─────────────────────────────────────────────────────
const MV: ScriptTemplate[] = [
  {
    id: "mv-shotlist",
    label: "MV 镜头脚本",
    icon: Music,
    blurb: "节奏对应 · 视觉象征",
    recommendedLlm: M.SONNET,
    presets: { genre: "MV", style: "梦幻", mood: "浪漫唯美", targetVideoModel: "dop", aspectRatio: "16:9", sceneCount: 10, totalDuration: 240 },
    systemPromptAddon: md(`
      你是 MV 导演。请按音乐结构切镜头：
      - 主歌 1：建立角色 + 情境（4-5 个 shot）
      - 副歌 1：情绪爆发的视觉象征（运动镜头 + 大特写）
      - 主歌 2：插叙/回忆/反差段
      - 副歌 2：升级 + 情绪极致
      - Bridge：抽象/超现实段（最能记忆的视觉点）
      - Outro：留白
      - 每个 scene 必须标注"对应歌曲段落"
      - Claude Sonnet 4.6 抽象联想能力：MV 不是讲故事，是用画面表达情绪——请给出**反逻辑但有情绪共鸣**的视觉点（如歌词唱"放不下"时，画面是有人在折纸船）
    `),
  },
  {
    id: "lyric-video",
    label: "Lyric Video",
    icon: ScrollText,
    blurb: "歌词可视化 · 文字动态",
    recommendedLlm: M.GEMINI,
    presets: { genre: "MV", style: "极简", mood: "浪漫唯美", targetVideoModel: "runway", aspectRatio: "16:9", sceneCount: 8, totalDuration: 180 },
    systemPromptAddon: md(`
      你是 Lyric Video 设计师。3 分钟歌词可视化：
      - 每个 scene 包含：**核心歌词**（中英文）+ **字体动态描述**（fade / slide / blur / shake）+ **背景画面**
      - 字体处理要呼应情绪（重音放大 + 颤抖；柔情斜体 + 慢淡入）
      - 背景画面以抽象色块 + 慢动镜头 + 光斑粒子为主，不抢戏
      - 至少 1 个 scene 是**纯文字 + 黑底**的极简爆发点
      - Gemini 2.5 Flash 平衡能力：请同时考虑文字编排 + 画面背景，二者要呼吸节奏一致
    `),
  },
  {
    id: "music-mood",
    label: "音乐情绪片",
    icon: Disc3,
    blurb: "无对白 · 纯氛围",
    recommendedLlm: M.GPT,
    presets: { genre: "MV", style: "梦幻", mood: "神秘悬疑", targetVideoModel: "veo", aspectRatio: "16:9", sceneCount: 7, totalDuration: 180 },
    systemPromptAddon: md(`
      你是实验性音乐短片编剧。3 分钟纯氛围片：
      - **无旁白、无对白**——只有画面 + 音乐 + 偶尔字幕诗句
      - 整片围绕一个核心 mood（如"deja vu" / "怀念" / "焦虑"），不讲故事
      - 7 个 scene 间允许蒙太奇式跳切，画面之间通过情绪关联而非因果
      - 至少 1 个 scene 是"超现实物理"（如人物倒立行走、雨水反向、镜面里有不同的脸）
      - GPT-5.2 创意能力：请尽量给"非常规联想"的画面（避免"雨夜窗前""孤独背影"等套路）
    `),
  },
];

// ── 6. 互动 · 实验 ────────────────────────────────────────────────────
const EXPERIMENTAL: ScriptTemplate[] = [
  {
    id: "multi-ending",
    label: "多结局互动",
    icon: Compass,
    blurb: "分支叙事 · 选择驱动",
    recommendedLlm: M.SONNET,
    presets: { genre: "短剧", style: "电影感", mood: "神秘悬疑", targetVideoModel: "kling", aspectRatio: "9:16", sceneCount: 10, totalDuration: 360 },
    systemPromptAddon: md(`
      你是互动剧编剧。6 分钟竖屏互动剧（如"黑镜：潘达斯奈基"风格）：
      - 必须设计 **2-3 个分支节点**（在 scene 描述中标注 "[CHOICE A / CHOICE B]"）
      - 每个分支至少需要 2 个 scene 来体现差异
      - 最少 2 个不同的结局
      - 分支不要影响 1-2 场的基础设定（用户选 A 和 B 共享前期角色和场景）
      - Claude Sonnet 4.6 强结构：请先列出"决策树"，再写每个分支的剧本，确保逻辑一致不冲突
    `),
  },
  {
    id: "ai-test-shots",
    label: "AI 视频测试镜头",
    icon: Bot,
    blurb: "极致提示词工程",
    recommendedLlm: M.HAIKU,
    presets: { genre: "宣传片", style: "电影感", mood: "壮阔震撼", targetVideoModel: "seedance", aspectRatio: "16:9", sceneCount: 6, totalDuration: 30 },
    systemPromptAddon: md(`
      你是 AI 视频提示词测试员。这次目的不是讲故事，是**测试 AI 视频模型能力边界**：
      - 每个 scene 测试不同维度：1. 复杂运镜（orbit + dolly zoom）2. 多人物互动 3. 物理特效（玻璃破碎、流体）4. 极端光照（霓虹/烛光/逆光）5. 快速运动（跑步、骑行）6. 微表情（眼神变化、微笑→哭泣）
      - promptText 必须**完全是英文**，且包含具体相机参数（焦距、运动速度、景深）
      - 每个 scene 长度 5 秒，刚好对应大多数 i2v 模型上限
      - Claude Haiku 4.5 速度：快速生成多个 prompt，不要 over-think；剧本本身不需要"故事"，只要每个 scene 是独立测试样本
    `),
  },
  {
    id: "heros-journey",
    label: "英雄之旅",
    icon: MountainSnow,
    blurb: "Joseph Campbell 12 步",
    recommendedLlm: M.SONNET,
    presets: { genre: "电影", style: "史诗", mood: "壮阔震撼", targetVideoModel: "dop", aspectRatio: "2.35:1", sceneCount: 12, totalDuration: 540 },
    systemPromptAddon: md(`
      你是神话叙事专家。请严格按 Joseph Campbell 英雄之旅 12 步输出：
      1. Ordinary World / 2. Call to Adventure / 3. Refusal / 4. Meeting the Mentor /
      5. Crossing the Threshold / 6. Tests, Allies, Enemies / 7. Approach to the Inmost Cave /
      8. Ordeal / 9. Reward / 10. The Road Back / 11. Resurrection / 12. Return with the Elixir
      - 每个 scene 一一对应（共 12 个）
      - 在 scene description 里标注属于哪一步（如 "[Step 7: Approach to the Inmost Cave]"）
      - Claude Sonnet 4.6 长上下文：请保持角色弧线在 12 步中**有真实成长**——开篇的弱点必须在第 11 步被克服
    `),
  },
  {
    id: "deconstruction",
    label: "解构性叙事",
    icon: FlaskConical,
    blurb: "非线性 · 多视角",
    recommendedLlm: M.SONNET,
    presets: { genre: "电影", style: "电影感", mood: "神秘悬疑", targetVideoModel: "veo", aspectRatio: "2.35:1", sceneCount: 10, totalDuration: 480 },
    systemPromptAddon: md(`
      你是实验电影编剧（Tarantino / Christopher Nolan 风格）。
      - 时间线**非线性**（倒叙 / 多线交织 / 时间反向）
      - 必须有 **至少 2 个视角** 讲述同一事件，且各自隐瞒部分真相
      - 关键事件至少出现 2 次（同一画面，第二次出现时观众理解发生了变化）
      - 每个 scene 标注**时间标签**（"Day 3 - 上午" / "Day 1 - 凌晨"）
      - Claude Sonnet 4.6：请先理出时间线全貌（按线性顺序），再决定怎么打乱呈现；确保打乱后还能让观众拼出全貌
    `),
  },
];

export const SCRIPT_TEMPLATE_CATEGORIES: ScriptTemplateCategory[] = [
  { id: "short",        label: "短视频",        templates: SHORT_VIDEO },
  { id: "ads",          label: "广告 · 营销",  templates: ADS },
  { id: "film",         label: "电影 · 剧集",  templates: FILM },
  { id: "doc",          label: "纪录 · 教学",  templates: DOC },
  { id: "mv",           label: "MV · 音乐",     templates: MV },
  { id: "experimental", label: "互动 · 实验",  templates: EXPERIMENTAL },
];

export const ALL_SCRIPT_TEMPLATES: ScriptTemplate[] = SCRIPT_TEMPLATE_CATEGORIES.flatMap((c) => c.templates);

/** Lookup helper used by ScriptNode UI + server-side wiring. */
export function getScriptTemplate(id: string | undefined): ScriptTemplate | undefined {
  if (!id) return undefined;
  return ALL_SCRIPT_TEMPLATES.find((t) => t.id === id);
}
