// 运镜模板库 — 30+ 内置专业电影运镜
//
// 每个模板把"自然语言运镜描述" + "各 provider 的参数 mapping"封装在一起：
// - promptZh / promptEn: 注入到 prompt（所有 provider 都用得上）
// - providerParams: 只有少数 provider 有原生 camera_motion 字段（目前仅
//   Higgsfield DoP 系列 + Poyo Seedance 的 camera_fixed），其他都靠
//   prompt 注入让模型自己理解
//
// 应用时用 marker 包裹自动注入文本，便于幂等替换：
//   <!-- camera:dolly_zoom -->希区柯克变焦…<!-- /camera -->
// 同一节点重新选不同模板时，只替换 marker 内部，不动用户手写内容

export type CinematographyCategory =
  | "推拉"
  | "摇移"
  | "倾斜"
  | "升降"
  | "跟拍"
  | "环绕"
  | "复合"
  | "特殊"
  | "经典";

export interface CinematographyTemplate {
  id: string;
  label: string;
  englishLabel: string;
  category: CinematographyCategory;
  emoji: string;
  description: string;
  promptZh: string;
  promptEn: string;
  providerParams: {
    // Higgsfield DoP — type + speed 真正生效
    higgsfield?: {
      camera_motion_type?: "none" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "orbit" | "static";
      camera_motion_speed?: "slow" | "normal" | "fast";
    };
    // Poyo Seedance — 只有 camera_fixed
    seedance?: { camera_fixed?: boolean };
  };
  recommendedScenarios?: string[];
}

export const CINEMATOGRAPHY_CATEGORIES: CinematographyCategory[] = [
  "推拉", "摇移", "倾斜", "升降", "跟拍", "环绕", "复合", "特殊", "经典",
];

export const CINEMATOGRAPHY_TEMPLATES: CinematographyTemplate[] = [
  // ── 推拉 (Push / Pull) ────────────────────────────────────────────
  {
    id: "dolly_in",
    label: "推镜（Dolly In）",
    englishLabel: "Dolly In",
    category: "推拉",
    emoji: "➡️",
    description: "镜头缓缓向前推进，靠近主体，强化情感与关注度",
    promptZh: "镜头缓缓向前推进，dolly in 推镜，逐渐靠近主体",
    promptEn: "slow dolly in, camera pushes forward toward subject, increasing intimacy",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_in", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["情绪推进", "揭示发现", "主角内心"],
  },
  {
    id: "dolly_out",
    label: "拉镜（Dolly Out）",
    englishLabel: "Dolly Out",
    category: "推拉",
    emoji: "⬅️",
    description: "镜头从主体缓缓拉远，揭示更大场景或制造孤立感",
    promptZh: "镜头从主体向后拉远，dolly out 拉镜，逐渐露出更广阔的环境",
    promptEn: "slow dolly out, camera pulls back from subject, revealing wider context",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_out", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["故事收尾", "孤独感", "环境揭示"],
  },
  {
    id: "snap_zoom_in",
    label: "急推变焦（Snap Zoom）",
    englishLabel: "Snap Zoom In",
    category: "推拉",
    emoji: "💥",
    description: "突然急速变焦推近，营造冲击与紧张感",
    promptZh: "突然急速变焦推进，snap zoom 镜头猛地拉近主体，画面顿时聚焦于细节",
    promptEn: "snap zoom in, sudden rapid zoom toward subject, snappy and intense",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_in", camera_motion_speed: "fast" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["惊吓时刻", "动作发现", "紧张悬念"],
  },
  {
    id: "push_to_face",
    label: "推到脸部特写",
    englishLabel: "Push to Face Close-Up",
    category: "推拉",
    emoji: "👁",
    description: "缓慢推向人物脸部，最后定格在眼睛或表情",
    promptZh: "镜头缓慢推向人物面部，最终定格于眼神，呈现内心情感",
    promptEn: "slow push toward subject's face, ending on eyes, emphasizing inner emotion",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_in", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["情感爆发", "角色内心", "回忆触发"],
  },

  // ── 摇移 (Pan) ────────────────────────────────────────────────────
  {
    id: "pan_left",
    label: "左摇（Pan Left）",
    englishLabel: "Pan Left",
    category: "摇移",
    emoji: "⬅",
    description: "镜头从右向左缓慢摇移，横向探索场景",
    promptZh: "镜头从右向左缓慢摇移，pan left，横向揭示场景",
    promptEn: "smooth pan left, camera rotates horizontally from right to left",
    providerParams: {
      higgsfield: { camera_motion_type: "pan_left", camera_motion_speed: "normal" },
    },
    recommendedScenarios: ["场景介绍", "角色登场", "环境扫描"],
  },
  {
    id: "pan_right",
    label: "右摇（Pan Right）",
    englishLabel: "Pan Right",
    category: "摇移",
    emoji: "➡",
    description: "镜头从左向右缓慢摇移，跟随主体或揭示空间",
    promptZh: "镜头从左向右缓慢摇移，pan right，横向跟随",
    promptEn: "smooth pan right, camera rotates horizontally from left to right",
    providerParams: {
      higgsfield: { camera_motion_type: "pan_right", camera_motion_speed: "normal" },
    },
    recommendedScenarios: ["跟随动作", "对话视线", "空间过渡"],
  },
  {
    id: "whip_pan",
    label: "急摇（Whip Pan）",
    englishLabel: "Whip Pan",
    category: "摇移",
    emoji: "🌪",
    description: "突然急速摇移，画面带运动模糊，常用于场景切换",
    promptZh: "急速横向摇移，whip pan，画面带强烈运动模糊，瞬间转向新场景",
    promptEn: "whip pan, sudden rapid horizontal motion with motion blur, abrupt transition",
    providerParams: {
      higgsfield: { camera_motion_type: "pan_right", camera_motion_speed: "fast" },
    },
    recommendedScenarios: ["快节奏剪辑", "场景过渡", "动作戏"],
  },

  // ── 倾斜 (Tilt) ───────────────────────────────────────────────────
  {
    id: "tilt_up",
    label: "上倾（Tilt Up）",
    englishLabel: "Tilt Up",
    category: "倾斜",
    emoji: "⬆",
    description: "镜头从下向上倾斜，常用于揭示高度或仰慕视角",
    promptZh: "镜头从下向上倾斜，tilt up，缓慢仰起",
    promptEn: "slow tilt up, camera pivots vertically from below to above",
    providerParams: {
      higgsfield: { camera_motion_type: "tilt_up", camera_motion_speed: "normal" },
    },
    recommendedScenarios: ["揭示高大", "仰视主角", "建筑展示"],
  },
  {
    id: "tilt_down",
    label: "下倾（Tilt Down）",
    englishLabel: "Tilt Down",
    category: "倾斜",
    emoji: "⬇",
    description: "镜头从上向下倾斜，常用于俯视或揭示底部",
    promptZh: "镜头从上向下倾斜，tilt down，缓慢俯下",
    promptEn: "slow tilt down, camera pivots vertically from above to below",
    providerParams: {
      higgsfield: { camera_motion_type: "tilt_down", camera_motion_speed: "normal" },
    },
    recommendedScenarios: ["俯瞰主体", "揭示线索", "压迫感"],
  },
  {
    id: "dutch_angle",
    label: "荷兰角（Dutch Angle）",
    englishLabel: "Dutch Angle / Canted",
    category: "倾斜",
    emoji: "🔻",
    description: "画面倾斜构图，营造不安、错乱、心理失衡",
    promptZh: "画面斜向倾斜构图，荷兰角，dutch angle，营造紧张失衡的心理感受",
    promptEn: "dutch angle composition, canted framing, tilted horizon, conveying unease and psychological tension",
    providerParams: {
      higgsfield: { camera_motion_type: "static" },
    },
    recommendedScenarios: ["心理悬疑", "反派出场", "醉酒幻觉"],
  },

  // ── 升降 (Crane / Boom) ───────────────────────────────────────────
  {
    id: "crane_up",
    label: "摇臂上升（Crane Up）",
    englishLabel: "Crane Up",
    category: "升降",
    emoji: "🏗️",
    description: "镜头沿垂直方向上升，揭示俯瞰视角",
    promptZh: "摇臂带动镜头垂直上升，crane up，从地面视角升至高空俯瞰",
    promptEn: "crane up, camera rises vertically from ground level to bird's eye view",
    providerParams: {
      higgsfield: { camera_motion_type: "tilt_up", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["史诗开场", "结局收束", "宏大场景"],
  },
  {
    id: "crane_down",
    label: "摇臂下降（Crane Down）",
    englishLabel: "Crane Down",
    category: "升降",
    emoji: "⬇️",
    description: "从高处缓慢下降，揭示细节与主体",
    promptZh: "镜头从高处缓慢垂直下降，crane down，逐渐靠近地面主体",
    promptEn: "crane down, camera descends vertically from high angle to subject level",
    providerParams: {
      higgsfield: { camera_motion_type: "tilt_down", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["从天而降", "故事开始", "引出主角"],
  },
  {
    id: "birds_eye",
    label: "鸟瞰（Bird's Eye）",
    englishLabel: "Bird's Eye View",
    category: "升降",
    emoji: "🦅",
    description: "正上方俯瞰角度，常用于图案、几何构图",
    promptZh: "正俯视角度俯拍，bird's eye view，从正上方鸟瞰整个场景",
    promptEn: "bird's eye view, overhead shot straight down, top-down perspective",
    providerParams: {
      higgsfield: { camera_motion_type: "static" },
    },
    recommendedScenarios: ["图案展示", "战场全局", "孤独主体"],
  },

  // ── 跟拍 (Tracking) ───────────────────────────────────────────────
  {
    id: "tracking_shot",
    label: "跟拍（Tracking）",
    englishLabel: "Tracking Shot",
    category: "跟拍",
    emoji: "🚶",
    description: "镜头跟随移动的主体，保持同步距离",
    promptZh: "镜头紧跟移动中的主体，tracking shot，同步前进保持构图",
    promptEn: "tracking shot, camera follows moving subject at constant distance, smooth motion",
    providerParams: {
      higgsfield: { camera_motion_type: "pan_right", camera_motion_speed: "normal" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["主角行走", "追逐戏", "对话场景"],
  },
  {
    id: "pov_shot",
    label: "主观视角（POV）",
    englishLabel: "POV Shot",
    category: "跟拍",
    emoji: "👀",
    description: "以人物视角呈现，观众“看到主角所见”",
    promptZh: "以人物主观视角拍摄，POV shot，从主角眼中看到的画面，仿佛观众就是主角",
    promptEn: "POV shot from character's first-person perspective, what the protagonist sees",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_in", camera_motion_speed: "slow" },
    },
    recommendedScenarios: ["代入感", "悬疑窥视", "驾驶/奔跑"],
  },
  {
    id: "ots_shot",
    label: "越肩拍摄（OTS）",
    englishLabel: "Over-the-Shoulder",
    category: "跟拍",
    emoji: "👤",
    description: "从一个角色的肩膀后方拍摄另一个角色，对话戏常用",
    promptZh: "越肩拍摄，over-the-shoulder shot，前景虚化的肩膀，对面是被拍角色的脸部",
    promptEn: "over-the-shoulder shot, foreground shoulder blurred, focus on opposite character's face",
    providerParams: {
      higgsfield: { camera_motion_type: "static" },
    },
    recommendedScenarios: ["双人对话", "紧张对峙", "审讯场景"],
  },
  {
    id: "walk_and_talk",
    label: "边走边谈（Walk & Talk）",
    englishLabel: "Walk and Talk",
    category: "跟拍",
    emoji: "🗣️",
    description: "侧向跟拍移动中边走边谈的两人，节奏紧凑",
    promptZh: "侧向跟拍两个并肩行走的角色，walk and talk，同步前进的对话场景",
    promptEn: "walk and talk shot, side tracking of two characters walking side by side in conversation",
    providerParams: {
      higgsfield: { camera_motion_type: "pan_right", camera_motion_speed: "normal" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["职场剧", "高层对话", "节奏感"],
  },

  // ── 环绕 (Orbit / Arc) ────────────────────────────────────────────
  {
    id: "orbit_360",
    label: "360° 环绕",
    englishLabel: "360° Orbit",
    category: "环绕",
    emoji: "🔄",
    description: "镜头绕主体一圈，强调全方位展示",
    promptZh: "镜头围绕主体进行 360 度环绕，orbit shot，平滑旋转一整圈",
    promptEn: "360 degree orbit around subject, smooth circular camera path",
    providerParams: {
      higgsfield: { camera_motion_type: "orbit", camera_motion_speed: "normal" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["产品展示", "英雄登场", "震撼时刻"],
  },
  {
    id: "arc_shot",
    label: "弧形移动（Arc）",
    englishLabel: "Arc Shot",
    category: "环绕",
    emoji: "🌙",
    description: "镜头沿弧线绕半圈，角度变化更优雅",
    promptZh: "镜头沿弧线绕过主体半圈，arc shot，平滑曲线运动",
    promptEn: "arc shot, camera moves in semicircle around subject, graceful curved motion",
    providerParams: {
      higgsfield: { camera_motion_type: "orbit", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["人物揭示", "舞蹈场景", "时尚拍摄"],
  },
  {
    id: "drone_spiral",
    label: "无人机螺旋上升",
    englishLabel: "Drone Spiral",
    category: "环绕",
    emoji: "🚁",
    description: "环绕主体同时垂直上升，史诗级揭示",
    promptZh: "无人机环绕主体螺旋上升，drone spiral，盘旋拉远揭示宏大场景",
    promptEn: "drone spiral up, helicopter view rising while orbiting subject, epic reveal",
    providerParams: {
      higgsfield: { camera_motion_type: "orbit", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["史诗结尾", "宏大场景", "建筑展示"],
  },

  // ── 复合 (Combination) ───────────────────────────────────────────
  {
    id: "crane_pan",
    label: "升降 + 摇移",
    englishLabel: "Crane Pan",
    category: "复合",
    emoji: "🎢",
    description: "在升降过程中同时摇移，三维空间运动",
    promptZh: "镜头升降的同时进行横向摇移，crane and pan combined，三维空间复合运动",
    promptEn: "combined crane and pan, camera rises while panning sideways, three-dimensional movement",
    providerParams: {
      higgsfield: { camera_motion_type: "pan_right", camera_motion_speed: "normal" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["复杂场面", "舞台调度", "故事开场"],
  },
  {
    id: "push_tilt",
    label: "推近 + 倾斜",
    englishLabel: "Push + Tilt",
    category: "复合",
    emoji: "↗",
    description: "推近的同时倾斜镜头，复合运动",
    promptZh: "镜头推近的同时缓慢上倾，push in 加 tilt up，复合运镜",
    promptEn: "push in combined with tilt up, complex compound camera motion",
    providerParams: {
      higgsfield: { camera_motion_type: "tilt_up", camera_motion_speed: "normal" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["揭示真相", "情绪转折", "戏剧高潮"],
  },

  // ── 特殊 (Special) ───────────────────────────────────────────────
  {
    id: "dolly_zoom",
    label: "希区柯克变焦",
    englishLabel: "Dolly Zoom (Vertigo Effect)",
    category: "特殊",
    emoji: "🌀",
    description: "推镜同时反向变焦，主体大小不变背景剧烈变化，眩晕感",
    promptZh: "希区柯克变焦镜头，dolly zoom vertigo effect，镜头向后拉远的同时焦距推进，主体保持画面大小不变而背景剧烈变形",
    promptEn: "dolly zoom out vertigo effect, subject stays same size while background dramatically expands, Hitchcock style",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_out", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["心理冲击", "悬疑揭示", "情绪转折"],
  },
  {
    id: "trunk_shot",
    label: "后备箱视角（Tarantino）",
    englishLabel: "Trunk Shot",
    category: "特殊",
    emoji: "📦",
    description: "Tarantino 标志性镜头，从后备箱向上仰视角色",
    promptZh: "从后备箱内向外仰视拍摄，trunk shot，Tarantino 标志性低角度仰视",
    promptEn: "trunk shot, low angle from inside a car trunk looking up at characters, Tarantino style",
    providerParams: {
      higgsfield: { camera_motion_type: "static" },
    },
    recommendedScenarios: ["黑帮戏", "犯罪片", "标志性构图"],
  },
  {
    id: "static_locked",
    label: "锁定静止（Locked-off）",
    englishLabel: "Locked-off Shot",
    category: "特殊",
    emoji: "🔒",
    description: "完全静止的画面，让观众专注于内容",
    promptZh: "镜头完全静止锁定，locked-off shot，画面如照片般定格，主体在静态画面中表演",
    promptEn: "locked-off static shot, completely still camera, frame is fixed like a photograph",
    providerParams: {
      higgsfield: { camera_motion_type: "static" },
      seedance: { camera_fixed: true },
    },
    recommendedScenarios: ["对白特写", "纪录片", "舞台感"],
  },

  // ── 经典电影风格 (Classic) ───────────────────────────────────────
  {
    id: "wes_anderson",
    label: "韦斯·安德森风格",
    englishLabel: "Wes Anderson Style",
    category: "经典",
    emoji: "🎨",
    description: "对称构图、缓慢平移、糖果色调，标志性 Wes Anderson 风格",
    promptZh: "韦斯·安德森风格构图，对称居中布局，pastel 糖果色调，缓慢的水平平移镜头，复古质感",
    promptEn: "Wes Anderson style, symmetric centered composition, pastel color palette, slow lateral tracking, retro aesthetic",
    providerParams: {
      higgsfield: { camera_motion_type: "pan_right", camera_motion_speed: "slow" },
    },
    recommendedScenarios: ["文艺片", "复古质感", "对称美学"],
  },
  {
    id: "kubrick_one_point",
    label: "库布里克单点透视",
    englishLabel: "Kubrick One-Point Perspective",
    category: "经典",
    emoji: "▽",
    description: "完美对称的单点透视构图，库布里克标志手法",
    promptZh: "库布里克标志性单点透视构图，one-point perspective，画面对称无瑕，消失点位于正中央",
    promptEn: "Kubrick one-point perspective, perfectly symmetrical composition, vanishing point at exact center",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_in", camera_motion_speed: "slow" },
    },
    recommendedScenarios: ["庄严仪式", "心理压迫", "建筑展示"],
  },
  {
    id: "spielberg_push",
    label: "斯皮尔伯格缓推",
    englishLabel: "Spielberg Slow Push",
    category: "经典",
    emoji: "✨",
    description: "极其缓慢的推进 + 仰角，制造惊奇时刻",
    promptZh: "斯皮尔伯格式缓推镜头，极其缓慢的推进配合轻微仰角，主体逐渐展现，营造惊奇与崇敬感",
    promptEn: "Spielberg slow push-in with subtle upward angle, building wonder and reverence toward subject",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_in", camera_motion_speed: "slow" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["史诗发现", "英雄登场", "魔法时刻"],
  },
  {
    id: "nolan_imax",
    label: "诺兰 IMAX 巨幕",
    englishLabel: "Nolan IMAX Wide",
    category: "经典",
    emoji: "🎬",
    description: "极宽广角 + 实景质感，诺兰式宏大美学",
    promptZh: "诺兰 IMAX 风格超宽广角镜头，宏大开阔的画面，实景质感，强烈的纵深感，2.35:1 宽画幅",
    promptEn: "Nolan IMAX style ultra-wide cinematography, expansive frame, practical effects feel, dramatic depth, 2.35:1 aspect",
    providerParams: {
      higgsfield: { camera_motion_type: "static" },
    },
    recommendedScenarios: ["科幻巨制", "战争场面", "外景宏观"],
  },
  {
    id: "bond_walk",
    label: "邦德式跟拍",
    englishLabel: "Bond Walk",
    category: "经典",
    emoji: "🕴️",
    description: "侧向跟拍主角自信前行，配合慢动作",
    promptZh: "侧向跟拍英姿挺拔的主角向前行走，bond walk style，自信从容的步伐，背景虚化",
    promptEn: "Bond walk, side tracking of confident protagonist walking forward, shallow depth of field, hero shot",
    providerParams: {
      higgsfield: { camera_motion_type: "pan_right", camera_motion_speed: "normal" },
      seedance: { camera_fixed: false },
    },
    recommendedScenarios: ["英雄出场", "气场展示", "广告拍摄"],
  },
  {
    id: "fincher_smooth",
    label: "芬奇极致顺滑",
    englishLabel: "Fincher Smooth",
    category: "经典",
    emoji: "🎯",
    description: "数字稳定器加持的零抖动顺滑运动",
    promptZh: "大卫·芬奇标志性的极致顺滑镜头运动，机械臂般精准的轨迹，完全无抖动",
    promptEn: "David Fincher signature smooth motion, mechanical precision, zero camera shake, motion-control rig style",
    providerParams: {
      higgsfield: { camera_motion_type: "zoom_in", camera_motion_speed: "slow" },
    },
    recommendedScenarios: ["悬疑揭示", "心理惊悚", "精密氛围"],
  },
  {
    id: "anamorphic_wide",
    label: "变形宽画幅",
    englishLabel: "Anamorphic Wide",
    category: "经典",
    emoji: "🎞️",
    description: "电影级变形镜头质感，水平耀斑 + 椭圆焦外",
    promptZh: "变形宽画幅镜头质感，2.39:1 电影比例，水平镜头耀斑，椭圆形焦外光斑，胶片质感",
    promptEn: "anamorphic widescreen, 2.39:1 cinema aspect, horizontal lens flares, oval bokeh, filmic texture",
    providerParams: {
      higgsfield: { camera_motion_type: "static" },
    },
    recommendedScenarios: ["电影感", "宽屏构图", "复古胶片"],
  },
];

// 模板查找辅助
export function getTemplateById(id: string): CinematographyTemplate | undefined {
  return CINEMATOGRAPHY_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: CinematographyCategory): CinematographyTemplate[] {
  return CINEMATOGRAPHY_TEMPLATES.filter((t) => t.category === category);
}

// ── Prompt 注入工具 ─────────────────────────────────────────────────
//
// 自动注入用 marker 包裹，便于幂等替换：
//   <!-- camera:dolly_zoom -->希区柯克变焦镜头…<!-- /camera -->
// 同一节点多次应用模板时，只更新 marker 内部文本，不破坏用户手写部分。

const CAMERA_MARKER_OPEN = "<!-- camera:";
const CAMERA_MARKER_CLOSE = " -->";
const CAMERA_END_MARKER = "<!-- /camera -->";

export function applyCinematographyToPrompt(
  currentPrompt: string,
  template: CinematographyTemplate,
  options?: { language?: "zh" | "en" },
): string {
  const lang = options?.language ?? "zh";
  const text = lang === "en" ? template.promptEn : template.promptZh;
  const newBlock = `${CAMERA_MARKER_OPEN}${template.id}${CAMERA_MARKER_CLOSE}${text}${CAMERA_END_MARKER}`;

  // Look for an existing camera-marker block; if found, replace it (regardless
  // of which template id was previously applied). Otherwise prepend to prompt.
  const re = new RegExp(`${escapeRegExp(CAMERA_MARKER_OPEN)}[^]*?${escapeRegExp(CAMERA_END_MARKER)}`, "m");
  if (re.test(currentPrompt)) {
    return currentPrompt.replace(re, newBlock);
  }
  // Empty prompt → just the block. Non-empty → prepend with newline separator
  // so the user's text stays intact below.
  return currentPrompt.trim().length === 0
    ? newBlock
    : `${newBlock}\n${currentPrompt}`;
}

export function clearCinematographyFromPrompt(currentPrompt: string): string {
  const re = new RegExp(`${escapeRegExp(CAMERA_MARKER_OPEN)}[^]*?${escapeRegExp(CAMERA_END_MARKER)}\\n?`, "m");
  return currentPrompt.replace(re, "").trim();
}

/** Detect which template (if any) is currently active in the prompt. */
export function detectActiveCinematography(currentPrompt: string): string | null {
  const m = currentPrompt.match(new RegExp(`${escapeRegExp(CAMERA_MARKER_OPEN)}([\\w_]+)${escapeRegExp(CAMERA_MARKER_CLOSE)}`));
  return m?.[1] ?? null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Provider 参数应用工具 ───────────────────────────────────────────
//
// 把模板的 providerParams 转成 VideoTaskNode 的 params patch。
// 不支持 native camera_motion 的 provider 返回空对象（仅靠 prompt 注入）。

export function applyCinematographyParams(
  provider: string,
  template: CinematographyTemplate,
): Record<string, unknown> {
  if (provider === "hf_dop_standard" || provider === "hf_dop_lite" || provider === "hf_dop_turbo") {
    const hf = template.providerParams.higgsfield;
    if (!hf) return {};
    const patch: Record<string, unknown> = {};
    if (hf.camera_motion_type) patch.camera_motion_type = hf.camera_motion_type;
    if (hf.camera_motion_speed) patch.camera_motion_speed = hf.camera_motion_speed;
    return patch;
  }
  if (provider === "poyo_seedance") {
    const sd = template.providerParams.seedance;
    if (!sd) return {};
    return sd.camera_fixed !== undefined ? { camera_fixed: sd.camera_fixed } : {};
  }
  // Other providers — no native camera_motion field; rely on prompt injection
  return {};
}

/** Whether this provider actually has a native camera_motion field. UI uses
 * this to add a "原生支持" badge to template cards. */
export function providerSupportsNativeCameraMotion(provider: string): boolean {
  return (
    provider === "hf_dop_standard" ||
    provider === "hf_dop_lite" ||
    provider === "hf_dop_turbo" ||
    provider === "poyo_seedance"
  );
}
