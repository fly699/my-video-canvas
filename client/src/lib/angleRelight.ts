// #72 LibTV 多角度 / 打光编辑器的纯函数层：预设表 + 参数→提示词构建。
// 保持无依赖、确定性，供编辑器 UI 与单测共用。生成走 imageEdit.run
// （operation "reangle" / "relight"），服务端模板负责「保持主体/构图不变」的硬约束，
// 这里只产出用户可见、可编辑的机位/光照描述句。

// ── 多角度 ────────────────────────────────────────────────────────────────────

export interface AngleParams {
  /** 水平环绕角 0-360°（0=正面，90=右侧，180=背面，270=左侧） */
  yaw: number;
  /** 垂直俯仰 -90..90（正=俯拍、负=仰拍、0=水平视线） */
  pitch: number;
  /** 景别 0-100（0=全景 … 100=极度特写） */
  zoom: number;
}

export interface AnglePreset {
  key: string;
  label: string;
  params: AngleParams;
  /** 额外镜头效果描述（鱼眼/倾斜等），拼接进提示词 */
  extra?: string;
}

export const ANGLE_PRESETS: AnglePreset[] = [
  { key: "custom", label: "自定义", params: { yaw: 0, pitch: 0, zoom: 40 } },
  { key: "fisheye", label: "鱼眼视角", params: { yaw: 0, pitch: 0, zoom: 85 }, extra: "广角镜头，边缘带有鱼眼畸变效果" },
  { key: "dutch", label: "倾斜视角", params: { yaw: 25, pitch: 8, zoom: 55 }, extra: "画面明显倾斜的荷兰角构图，充满张力" },
  { key: "top_front", label: "正面俯拍", params: { yaw: 0, pitch: 45, zoom: 40 } },
  { key: "low_front", label: "正面仰拍", params: { yaw: 0, pitch: -40, zoom: 40 } },
  { key: "top_pano", label: "全景俯拍", params: { yaw: 0, pitch: 65, zoom: 5 } },
  { key: "back", label: "背面视角", params: { yaw: 180, pitch: 5, zoom: 35 } },
];

/** 景别档位（LibTV：全景→中景→特写渐进） */
export function shotLabelForZoom(zoom: number): string {
  if (zoom < 20) return "全景";
  if (zoom < 45) return "中景";
  if (zoom < 70) return "近景";
  if (zoom < 90) return "特写";
  return "极度特写";
}

/** 水平环绕角 → 方位口语描述 */
export function yawLabel(yaw: number): string {
  const y = ((yaw % 360) + 360) % 360;
  if (y < 22.5 || y >= 337.5) return "正面";
  if (y < 67.5) return "右前侧";
  if (y < 112.5) return "右侧";
  if (y < 157.5) return "右后侧";
  if (y < 202.5) return "背面";
  if (y < 247.5) return "左后侧";
  if (y < 292.5) return "左侧";
  return "左前侧";
}

/** 俯仰角 → 口语描述 */
export function pitchLabel(pitch: number): string {
  if (pitch >= 55) return `高空俯拍（俯角 ${Math.round(pitch)}°）`;
  if (pitch >= 15) return `俯拍（俯角 ${Math.round(pitch)}°）`;
  if (pitch > -15) return "水平视线拍摄";
  if (pitch > -55) return `仰拍（仰角 ${Math.round(-pitch)}°）`;
  return `极低角度仰拍（仰角 ${Math.round(-pitch)}°）`;
}

/** 参数 → 可编辑机位描述句（LibTV「提示词」开关生成的内容） */
export function buildAnglePrompt(p: AngleParams, presetKey?: string): string {
  const preset = ANGLE_PRESETS.find((x) => x.key === presetKey);
  const parts = [
    `${shotLabelForZoom(p.zoom)}镜头`,
    `从${yawLabel(p.yaw)}机位（水平环绕 ${Math.round(((p.yaw % 360) + 360) % 360)}°）`,
    pitchLabel(p.pitch),
  ];
  let s = `${parts.join("，")}重新拍摄同一主体与场景`;
  if (preset?.extra) s += `，${preset.extra}`;
  return s;
}

// ── 打光 ─────────────────────────────────────────────────────────────────────

export interface RelightParams {
  /** 光源方位角 0-360（0=正前方，90=右，180=后，270=左） */
  azimuth: number;
  /** 光源仰角 -90..90（正=上方打光，负=底光） */
  elevation: number;
  /** 全局亮度 %（100=不变） */
  brightness: number;
  /** 光色（hex，空=不指定） */
  color: string;
  /** 轮廓光 */
  rimLight: boolean;
  /** 智能模式文字描述（光效/情绪，可空） */
  smartText?: string;
  /** 光质 0-100：0=硬光（锐利阴影）50=默认 100=柔光（漫射） */
  softness?: number;
}

export const RELIGHT_DEFAULTS: RelightParams = { azimuth: 45, elevation: 35, brightness: 100, color: "", rimLight: false, smartText: "", softness: 50 };

/** 光质档位描述（拼进提示词；45-65 视为默认不描述） */
export function lightQualityLabel(softness: number | undefined): string {
  const v = softness ?? 50;
  if (v <= 20) return "硬光（边缘锐利、阴影清晰）";
  if (v < 45) return "偏硬光";
  if (v <= 65) return "";
  if (v < 85) return "偏柔光";
  return "柔光（大面积漫射、阴影柔和过渡）";
}

/** 常用光色快捷色卡（点选即写入 color） */
export const LIGHT_COLOR_SWATCHES: { label: string; hex: string }[] = [
  { label: "暖阳", hex: "#ffb35c" },
  { label: "烛光", hex: "#ff8a3d" },
  { label: "冷月", hex: "#7fb2ff" },
  { label: "冷白", hex: "#dfe8ff" },
  { label: "霓虹粉", hex: "#ff4fd8" },
  { label: "青蓝", hex: "#24d3ee" },
];

/** 主光源六方位快捷键（LibTV：左侧/顶部/右侧/前方/底部/后方） */
export const LIGHT_DIRECTIONS: { key: string; label: string; azimuth: number; elevation: number }[] = [
  { key: "left", label: "左侧", azimuth: 270, elevation: 15 },
  { key: "top", label: "顶部", azimuth: 0, elevation: 80 },
  { key: "right", label: "右侧", azimuth: 90, elevation: 15 },
  { key: "front", label: "前方", azimuth: 0, elevation: 10 },
  { key: "bottom", label: "底部", azimuth: 0, elevation: -60 },
  { key: "back", label: "后方", azimuth: 180, elevation: 25 },
];

/** 光源方位 → 口语描述（如「右上方」「正后方（逆光）」） */
export function lightDirLabel(azimuth: number, elevation: number): string {
  const a = ((azimuth % 360) + 360) % 360;
  let h = "";
  if (a < 22.5 || a >= 337.5) h = "正前方";
  else if (a < 67.5) h = "右前方";
  else if (a < 112.5) h = "右侧";
  else if (a < 157.5) h = "右后方";
  else if (a < 202.5) h = "正后方（逆光）";
  else if (a < 247.5) h = "左后方";
  else if (a < 292.5) h = "左侧";
  else h = "左前方";
  if (elevation >= 55) return `${h}高位（近顶光）`;
  if (elevation >= 20) return `${h}上方`;
  if (elevation > -20) return h;
  return `${h}低位（底光）`;
}

export interface RelightPreset {
  key: string;
  label: string;
  prompt: string;
  /** 预设卡的 CSS 渐变色板（无缩略图时的视觉示意） */
  swatch: string;
  /** 实时预览近似参数（hover 预设即时套到光照预览上「试穿」） */
  preview: Pick<RelightParams, "azimuth" | "elevation" | "brightness" | "color" | "rimLight" | "softness">;
}

export const RELIGHT_PRESETS: RelightPreset[] = [
  { key: "overexposed_film", label: "过曝胶片", prompt: "过曝胶片质感：高调曝光、轻微泛白的高光溢出、柔和颗粒感与淡淡的暖调漂白色偏", swatch: "linear-gradient(135deg,#f7f3e8,#e8d9b8)", preview: { azimuth: 0, elevation: 30, brightness: 150, color: "#f2e6c8", rimLight: false, softness: 85 } },
  { key: "blue_backlight", label: "蓝色逆光", prompt: "冷蓝色逆光：主体背后强烈蓝色轮廓光，正面暗部保留细节，冷色电影氛围", swatch: "linear-gradient(135deg,#0b2a55,#2f6fd6)", preview: { azimuth: 180, elevation: 25, brightness: 95, color: "#2f6fd6", rimLight: true, softness: 40 } },
  { key: "rembrandt", label: "伦勃朗光", prompt: "伦勃朗式打光：45° 侧上方单主光，脸颊出现标志性三角形亮区，暗部层次丰富，古典油画质感", swatch: "linear-gradient(135deg,#3a2a18,#c98f4a)", preview: { azimuth: 315, elevation: 45, brightness: 90, color: "#e8b06a", rimLight: false, softness: 30 } },
  { key: "cyberpunk", label: "赛博朋克", prompt: "赛博朋克霓虹打光：品红与青色双色霓虹交叉照明，湿润反光高对比，未来都市夜景氛围", swatch: "linear-gradient(135deg,#ff2d95,#00e5ff)", preview: { azimuth: 90, elevation: 10, brightness: 105, color: "#ff2d95", rimLight: true, softness: 45 } },
  { key: "sunset_trip", label: "落日迷幻", prompt: "落日迷幻色：橙紫渐变的落日余晖，长影拉伸，梦幻朦胧的空气感光晕", swatch: "linear-gradient(135deg,#ff7e45,#8b5cf6)", preview: { azimuth: 250, elevation: 8, brightness: 105, color: "#ff7e45", rimLight: false, softness: 75 } },
  { key: "mystic_dark", label: "神秘暗调", prompt: "神秘暗调：低调布光，大面积深邃阴影，只保留一束窄光勾勒主体，悬疑氛围", swatch: "linear-gradient(135deg,#0a0d14,#3b4252)", preview: { azimuth: 20, elevation: 60, brightness: 55, color: "#9fb4d8", rimLight: false, softness: 15 } },
  { key: "golden_hour", label: "黄金时刻", prompt: "黄金时刻：日落前低角度金色阳光，温暖柔和的侧逆光，发丝与轮廓镶金边", swatch: "linear-gradient(135deg,#f5b942,#e07b39)", preview: { azimuth: 300, elevation: 6, brightness: 110, color: "#f5b942", rimLight: true, softness: 70 } },
  { key: "nolan_gray", label: "诺兰冷灰", prompt: "诺兰式冷灰调：去饱和的冷灰蓝色调，自然硬光，克制的对比与真实质感，史诗电影氛围", swatch: "linear-gradient(135deg,#5c6672,#9aa5b1)", preview: { azimuth: 0, elevation: 50, brightness: 92, color: "#9aa5b1", rimLight: false, softness: 55 } },
];

/** 参数 → 可编辑打光描述句 */
export function buildRelightPrompt(p: RelightParams, presetKey?: string): string {
  const preset = RELIGHT_PRESETS.find((x) => x.key === presetKey);
  if (preset) {
    // 预设为主体，叠加用户改过的全局参数（亮度/颜色/轮廓光仅在非默认时追加）
    const extras: string[] = [];
    if (p.brightness !== 100) extras.push(`整体亮度调整为 ${Math.round(p.brightness)}%`);
    if (p.color) extras.push(`主光色偏 ${p.color}`);
    if (p.rimLight) extras.push("加轮廓光勾边");
    return preset.prompt + (extras.length ? `，${extras.join("，")}` : "");
  }
  const parts: string[] = [`主光源来自${lightDirLabel(p.azimuth, p.elevation)}`];
  const lq = lightQualityLabel(p.softness);
  if (lq) parts.push(lq);
  if (p.brightness !== 100) parts.push(`整体亮度 ${Math.round(p.brightness)}%${p.brightness > 100 ? "（提亮）" : "（压暗）"}`);
  if (p.color) parts.push(`光色为 ${p.color}`);
  if (p.rimLight) parts.push("主体边缘加轮廓光（rim light）勾出发丝与肩线");
  if (p.smartText?.trim()) parts.push(p.smartText.trim());
  return parts.join("，");
}
