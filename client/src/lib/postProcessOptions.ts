export interface PostProcessEffect {
  id: string;
  label: string;
  emoji: string;
  promptText: string;
  description: string;
  hasIntensity?: boolean;
  intensityLabel?: string;
  incompatibleWith?: string[];
}

export interface PostProcessCategory {
  id: string;
  label: string;
  emoji: string;
  color: string;
  effects: PostProcessEffect[];
}

export const POST_PROCESS_CATEGORIES: PostProcessCategory[] = [
  {
    id: "color",
    label: "色彩调色",
    emoji: "🎨",
    color: "oklch(0.68 0.22 300)",
    effects: [
      { id: "teal_orange",    label: "橙蓝电影",   emoji: "🎬", promptText: "cinematic orange and teal color grading, Hollywood film look",               description: "好莱坞大片标配对比色调", hasIntensity: true,  intensityLabel: "饱和度", incompatibleWith: ["bw","vintage","warm_gold","cool_blue"] },
      { id: "warm_gold",      label: "暖金夕阳",   emoji: "🌅", promptText: "warm golden hour lighting, amber color grade, sunset tones, magic hour",    description: "温暖金黄的黄金时刻氛围", incompatibleWith: ["teal_orange","bw","cool_blue"] },
      { id: "cool_blue",      label: "冷峻蓝调",   emoji: "🌊", promptText: "cool blue tint, desaturated shadows, cold clinical atmosphere",              description: "冷色系紧张氛围感", incompatibleWith: ["teal_orange","warm_gold"] },
      { id: "vintage",        label: "复古胶片",   emoji: "📽️", promptText: "vintage film look, faded colors, Kodachrome palette, aged film grain",       description: "经典胶片质感与颗粒感", hasIntensity: true, intensityLabel: "颗粒度", incompatibleWith: ["teal_orange"] },
      { id: "bw",             label: "黑白经典",   emoji: "⬛", promptText: "black and white, high contrast monochrome, classic film noir",               description: "经典黑白胶片风格", incompatibleWith: ["teal_orange","warm_gold","cool_blue","vintage","cyberpunk_neon","pastel"] },
      { id: "cyberpunk_neon", label: "赛博霓虹",   emoji: "🌃", promptText: "cyberpunk neon lighting, purple and cyan glow, futuristic city atmosphere",  description: "未来感霓虹灯光效果", incompatibleWith: ["bw","warm_gold"] },
      { id: "pastel",         label: "梦幻粉彩",   emoji: "🌸", promptText: "dreamy pastel colors, soft pink and lavender tones, ethereal mood",          description: "柔和梦幻的粉彩色调", incompatibleWith: ["bw","teal_orange","cyberpunk_neon"] },
      { id: "ink_wash",       label: "水墨国风",   emoji: "🖌️", promptText: "Chinese ink wash painting style, sumi-e, minimalist black ink strokes",      description: "中国水墨画风格", incompatibleWith: ["cyberpunk_neon","teal_orange"] },
    ],
  },
  {
    id: "lens",
    label: "镜头效果",
    emoji: "🔭",
    color: "oklch(0.65 0.18 240)",
    effects: [
      { id: "anamorphic",   label: "变形宽幅",   emoji: "📸", promptText: "anamorphic lens flares, ultra wide cinematic, horizontal lens streaks",        description: "电影变形镜头水平光晕", hasIntensity: true, intensityLabel: "光晕强度" },
      { id: "bokeh",        label: "浅景深",     emoji: "⭕", promptText: "shallow depth of field, creamy bokeh blur, subject isolation",                  description: "主体清晰背景虚化", hasIntensity: true, intensityLabel: "虚化程度" },
      { id: "vignette",     label: "暗角压缩",   emoji: "🔲", promptText: "strong cinematic vignette, darkened edges, focused center composition",         description: "四角暗角突出中心主体", hasIntensity: true, intensityLabel: "暗角深度" },
      { id: "tilt_shift",   label: "移轴微缩",   emoji: "🏙️", promptText: "tilt-shift photography, miniature effect, selective horizontal focus plane",    description: "让场景看起来像微缩模型" },
      { id: "fisheye",      label: "鱼眼畸变",   emoji: "🐟", promptText: "fisheye lens distortion, extreme wide angle, barrel distortion",                description: "超广角鱼眼变形效果" },
      { id: "chromatic_ab", label: "色差分离",   emoji: "🌈", promptText: "chromatic aberration, RGB color fringe, glitch aesthetic",                     description: "镜头色差分离的故障美学", hasIntensity: true, intensityLabel: "分离强度" },
      { id: "starburst",    label: "星芒滤镜",   emoji: "✨", promptText: "starburst filter, star-shaped light diffraction on bright highlights",           description: "光源产生星形光芒效果" },
    ],
  },
  {
    id: "motion",
    label: "运动质感",
    emoji: "🎞️",
    color: "oklch(0.65 0.20 25)",
    effects: [
      { id: "motion_blur",   label: "运动模糊",  emoji: "💨", promptText: "realistic motion blur, dynamic movement trails",                               description: "模拟快速运动的动态模糊", hasIntensity: true, intensityLabel: "模糊程度" },
      { id: "slow_motion",   label: "超慢动作",  emoji: "🐢", promptText: "ultra slow motion, high frame rate, every detail stretched in time",           description: "子弹时间般的极致慢动作", incompatibleWith: ["time_lapse"] },
      { id: "time_lapse",    label: "延时加速",  emoji: "⚡", promptText: "time lapse photography, accelerated motion, flowing clouds and light",         description: "延时摄影的加速流动感", incompatibleWith: ["slow_motion"] },
      { id: "camera_shake",  label: "手持震动",  emoji: "🤝", promptText: "handheld camera shake, documentary style, realistic organic movement",          description: "纪录片风格的手持镜头" },
      { id: "speed_ramp",    label: "变速切换",  emoji: "📈", promptText: "speed ramping effect, smooth dynamic transition between fast and slow motion",  description: "速度由快渐慢的动态变化" },
    ],
  },
  {
    id: "atmosphere",
    label: "光线氛围",
    emoji: "💡",
    color: "oklch(0.65 0.18 60)",
    effects: [
      { id: "god_rays",   label: "丁达尔光",  emoji: "☀️", promptText: "volumetric god rays, crepuscular rays, light shafts through haze",               description: "阳光穿透雾气的体积光效", hasIntensity: true, intensityLabel: "光束强度" },
      { id: "fog_mist",   label: "薄雾迷蒙",  emoji: "🌫️", promptText: "atmospheric fog, ethereal mist, hazy depth atmosphere",                          description: "增添神秘深度感的薄雾" },
      { id: "neon_glow",  label: "霓虹发光",  emoji: "🔆", promptText: "neon glow, bloom effect, overexposed highlights, glowing light halos",            description: "强烈霓虹发光晕染效果", hasIntensity: true, intensityLabel: "光晕范围" },
      { id: "underwater", label: "水下折射",  emoji: "🐠", promptText: "underwater scene, caustic light patterns, aquatic rippling atmosphere",           description: "水下光线折射的梦幻效果" },
      { id: "golden_rays",label: "晨曦薄光",  emoji: "🌄", promptText: "morning golden rays, soft dawn rim lighting, lens flare, warm backlight",         description: "清晨柔和的轮廓光线", incompatibleWith: ["moonlight"] },
      { id: "moonlight",  label: "月光冷蓝",  emoji: "🌙", promptText: "moonlit scene, silver blue moonlight, night atmosphere, subtle starlight",        description: "月光下的冷蓝夜间氛围", incompatibleWith: ["golden_rays"] },
    ],
  },
  {
    id: "style",
    label: "艺术风格",
    emoji: "🖼️",
    color: "oklch(0.65 0.22 155)",
    effects: [
      { id: "oil_painting",    label: "油画质感",    emoji: "🎨", promptText: "oil painting texture, impressionist brush strokes, painterly style",      description: "经典油画笔触质感" },
      { id: "anime_shinkai",   label: "新海诚动漫",  emoji: "🗾", promptText: "Makoto Shinkai anime style, hyper-detailed sky, lens flare, cinematic anime", description: "新海诚式精美动漫风格" },
      { id: "pixel_art",       label: "像素艺术",    emoji: "👾", promptText: "pixel art style, 8-bit aesthetic, retro video game look",                 description: "复古像素游戏风格" },
      { id: "comic_outline",   label: "漫画描边",    emoji: "💬", promptText: "comic book style, bold cell-shading outlines, halftone dots, graphic novel", description: "美式漫画风格描边" },
      { id: "photorealistic",  label: "超写实摄影",  emoji: "📷", promptText: "photorealistic, 8K resolution, hyperdetailed, professional photography RAW photo", description: "极度写实的摄影质感", hasIntensity: true, intensityLabel: "清晰度" },
      { id: "watercolor",      label: "水彩渲染",    emoji: "💧", promptText: "watercolor painting, soft washes, paper texture, flowing pigments",        description: "流动水彩画的柔和质感" },
      { id: "3d_cgi",          label: "3D 渲染感",   emoji: "🔮", promptText: "3D CGI render, ray tracing, subsurface scattering, physically based rendering", description: "精致的三维渲染效果" },
    ],
  },
  {
    id: "film",
    label: "胶片质感",
    emoji: "📽️",
    color: "oklch(0.58 0.12 90)",
    effects: [
      { id: "film_grain",       label: "35mm 颗粒",  emoji: "🎞️", promptText: "35mm film grain, analog photography noise, organic film texture",       description: "经典35mm胶片颗粒感", hasIntensity: true, intensityLabel: "颗粒粗细" },
      { id: "polaroid",         label: "拍立得",     emoji: "📸", promptText: "polaroid photo effect, faded vignette edges, instant film style",         description: "复古拍立得即拍效果" },
      { id: "double_exposure",  label: "双重曝光",   emoji: "🌓", promptText: "double exposure photography, overlapping silhouettes, dreamlike blend",   description: "两张图像叠加的创意效果" },
      { id: "crt_scanlines",    label: "CRT 扫描线", emoji: "📺", promptText: "CRT monitor effect, scanlines, old TV static, VHS aesthetic",             description: "复古CRT显示器扫描线" },
      { id: "infrared",         label: "红外摄影",   emoji: "♨️", promptText: "infrared photography, glowing white foliage, false color dreamlike",       description: "红外摄影的奇幻植物效果" },
    ],
  },
  {
    id: "transition",
    label: "转场过渡",
    emoji: "↔️",
    color: "oklch(0.65 0.18 200)",
    effects: [
      { id: "fade_black",        label: "黑场淡出",   emoji: "⬛", promptText: "fade to black transition, gradual darkness, cinematic close",             description: "渐渐淡入黑暗的经典转场" },
      { id: "dissolve",          label: "溶解过渡",   emoji: "💧", promptText: "cross dissolve transition, smooth scene blend, organic transition",       description: "两个场景平滑叠化过渡" },
      { id: "speed_blur_trans",  label: "速度模糊",   emoji: "💫", promptText: "speed blur wipe transition, zoom blur sweep effect",                      description: "高速模糊扫过的动感转场" },
      { id: "light_leak",        label: "漏光转场",   emoji: "💥", promptText: "light leak transition, organic film burn effect, warm flare wipe",        description: "胶片漏光的有机过渡效果" },
      { id: "whip_pan",          label: "甩镜切换",   emoji: "🌀", promptText: "whip pan transition, fast horizontal camera sweep, dynamic cut",          description: "快速横扫的甩镜转场" },
    ],
  },
];

export function buildEffectPrompt(
  selectedEffects: string[],
  intensities: Record<string, number> = {}
): string {
  const parts: string[] = [];
  for (const cat of POST_PROCESS_CATEGORIES) {
    for (const effect of cat.effects) {
      if (!selectedEffects.includes(effect.id)) continue;
      let text = effect.promptText;
      if (effect.hasIntensity && intensities[effect.id] !== undefined) {
        const pct = Math.round(intensities[effect.id] * 100);
        if (pct < 50) text = "subtle " + text;
        else if (pct > 80) text = "strong " + text;
      }
      parts.push(text);
    }
  }
  return parts.join(", ");
}

export function getEffectById(id: string): PostProcessEffect | null {
  for (const cat of POST_PROCESS_CATEGORIES) {
    const found = cat.effects.find(e => e.id === id);
    if (found) return found;
  }
  return null;
}
