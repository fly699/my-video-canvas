// 风格库（对齐 LibTV「风格广场」）：通用视觉风格预设。选中后把 `prompt` 片段注入节点提示词。
// 分三类：影视质感 / 绘画艺术 / 三维渲染。片段用中英混合的通行风格词，模型识别度高。

export type StyleCategory = "影视质感" | "绘画艺术" | "三维渲染";
export const STYLE_CATEGORIES: StyleCategory[] = ["影视质感", "绘画艺术", "三维渲染"];

export interface StylePreset {
  id: string;
  label: string;
  englishLabel: string;
  emoji: string;
  category: StyleCategory;
  description: string;
  /** 注入到提示词的风格片段。 */
  prompt: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  // ── 影视质感 ──
  { id: "cinematic", label: "电影感", englishLabel: "Cinematic", emoji: "🎬", category: "影视质感", description: "电影级打光与调色，浅景深、宽银幕氛围。", prompt: "cinematic lighting, shallow depth of field, film grain, anamorphic, dramatic color grading, 35mm" },
  { id: "film_grain", label: "胶片颗粒", englishLabel: "Film / Kodak", emoji: "🎞️", category: "影视质感", description: "柯达胶片质感，颗粒与暖调。", prompt: "shot on Kodak Portra 400, film grain, analog photography, warm tones, soft highlights" },
  { id: "bw", label: "黑白", englishLabel: "Black & White", emoji: "⚫", category: "影视质感", description: "高对比黑白，光影戏剧化。", prompt: "black and white photography, high contrast monochrome, dramatic shadows, fine art" },
  { id: "low_key", label: "暗调低光", englishLabel: "Low-key", emoji: "🌑", category: "影视质感", description: "低照度暗调，硬光与深阴影。", prompt: "low-key lighting, moody dark tones, chiaroscuro, deep shadows, single light source" },
  { id: "cyberpunk", label: "赛博朋克", englishLabel: "Cyberpunk", emoji: "🌆", category: "影视质感", description: "霓虹雨夜、青洋红冷调未来都市。", prompt: "cyberpunk, neon lights, rain-soaked streets, teal and magenta, blade runner atmosphere, volumetric fog" },
  { id: "hk_retro", label: "复古港风", englishLabel: "Retro HK", emoji: "🏮", category: "影视质感", description: "90 年代港片霓虹与胶片暖调。", prompt: "1990s Hong Kong cinema, retro neon, wong kar-wai style, warm film tones, nostalgic" },
  { id: "golden_hour", label: "黄金时刻", englishLabel: "Golden Hour", emoji: "🌅", category: "影视质感", description: "日落暖光、逆光轮廓、柔和眩光。", prompt: "golden hour lighting, warm backlight, rim light, soft lens flare, sun-kissed" },
  { id: "high_contrast", label: "大光比", englishLabel: "High Contrast", emoji: "🔦", category: "影视质感", description: "强硬光大光比，边缘锐利。", prompt: "hard light, high dynamic range contrast, crisp shadows, punchy highlights" },

  // ── 绘画艺术 ──
  { id: "ink_wash", label: "中国水墨", englishLabel: "Ink Wash", emoji: "🖌️", category: "绘画艺术", description: "写意水墨，留白与晕染。", prompt: "traditional Chinese ink wash painting, sumi-e, negative space, flowing brush strokes, monochrome ink" },
  { id: "oil", label: "油画厚涂", englishLabel: "Oil Painting", emoji: "🎨", category: "绘画艺术", description: "厚涂笔触，古典油画质感。", prompt: "oil painting, thick impasto brush strokes, classical, rich texture, painterly" },
  { id: "watercolor", label: "水彩", englishLabel: "Watercolor", emoji: "💧", category: "绘画艺术", description: "透明水彩，湿边与渐层。", prompt: "watercolor painting, soft washes, wet-on-wet, translucent, delicate gradients, paper texture" },
  { id: "anime", label: "日系插画", englishLabel: "Anime", emoji: "🌸", category: "绘画艺术", description: "日系动画赛璐璐插画。", prompt: "anime illustration, cel shading, japanese animation, clean lineart, vibrant colors" },
  { id: "ukiyoe", label: "浮世绘", englishLabel: "Ukiyo-e", emoji: "🌊", category: "绘画艺术", description: "江户木版画，平涂与波纹。", prompt: "ukiyo-e woodblock print, edo period, flat colors, bold outlines, hokusai style" },
  { id: "pencil", label: "铅笔素描", englishLabel: "Pencil Sketch", emoji: "✏️", category: "绘画艺术", description: "手绘铅笔素描，交叉排线。", prompt: "pencil sketch, graphite, cross-hatching, hand-drawn, monochrome linework" },
  { id: "popart", label: "波普艺术", englishLabel: "Pop Art", emoji: "🟡", category: "绘画艺术", description: "高饱和波普，网点与描边。", prompt: "pop art, bold saturated colors, ben-day dots, comic style, warhol, thick outlines" },
  { id: "vaporwave", label: "蒸汽波", englishLabel: "Vaporwave", emoji: "🩷", category: "绘画艺术", description: "复古蒸汽波、粉紫渐变。", prompt: "vaporwave aesthetic, pink and purple gradient, retro 80s, glitch, neon grid" },

  // ── 三维渲染 ──
  { id: "cg3d", label: "3D 渲染", englishLabel: "3D Render", emoji: "🧊", category: "三维渲染", description: "写实 CG 渲染，全局光照。", prompt: "3D render, octane render, global illumination, subsurface scattering, ultra detailed, photorealistic" },
  { id: "clay", label: "黏土", englishLabel: "Claymation", emoji: "🟤", category: "三维渲染", description: "黏土定格质感，柔和塑形。", prompt: "claymation, stop motion, soft clay texture, handcrafted, plasticine, tactile" },
  { id: "lowpoly", label: "低多边形", englishLabel: "Low Poly", emoji: "🔷", category: "三维渲染", description: "低面数几何、扁平配色。", prompt: "low poly 3D, geometric facets, flat shading, minimal, isometric" },
  { id: "isometric", label: "等距场景", englishLabel: "Isometric", emoji: "📐", category: "三维渲染", description: "等距视角微缩场景。", prompt: "isometric 3D scene, miniature diorama, clean render, soft shadows, tilt-shift" },
  { id: "felt", label: "毛毡", englishLabel: "Felt", emoji: "🧶", category: "三维渲染", description: "羊毛毡手作质感，柔软温暖。", prompt: "needle felted wool, soft fuzzy texture, handmade, cozy, macro" },
  { id: "pixar", label: "皮克斯动画", englishLabel: "Pixar-style", emoji: "🎡", category: "三维渲染", description: "皮克斯风 3D 动画，柔光可爱。", prompt: "pixar style 3D animation, soft global illumination, cute character, cinematic render, disney" },
  { id: "ghibli", label: "吉卜力", englishLabel: "Ghibli", emoji: "🍃", category: "三维渲染", description: "吉卜力手绘背景与柔光。", prompt: "studio ghibli style, hand-painted background, soft lighting, whimsical, miyazaki" },
  { id: "pixel", label: "像素", englishLabel: "Pixel Art", emoji: "🕹️", category: "三维渲染", description: "复古像素点绘。", prompt: "pixel art, 16-bit, retro game sprite, dithering, limited palette" },
];
