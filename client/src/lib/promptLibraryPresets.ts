// 内置「专业提示词」预设（静态，多分类）。用户可在提示词库面板浏览、一键套用，或收藏进
// 自己的库 / 快捷槽位。这些只是文本片段，插入到节点提示词框里即可。中文标签 + 英文提示词
// （多数生成模型对英文更敏感），用户可自行编辑。

export interface PresetPrompt { label: string; text: string }
export interface PresetCategory { category: string; items: PresetPrompt[] }

export const PROMPT_PRESETS: PresetCategory[] = [
  {
    category: "镜头 / 运镜",
    items: [
      { label: "电影感广角", text: "cinematic wide shot, 35mm anamorphic lens, shallow depth of field, natural film grain" },
      { label: "特写镜头", text: "extreme close-up, detailed facial features, soft bokeh background" },
      { label: "航拍俯视", text: "aerial drone shot, top-down view, sweeping camera movement" },
      { label: "推近运镜", text: "slow dolly-in push toward subject, smooth steadicam motion" },
      { label: "环绕运镜", text: "360-degree orbit shot around subject, dynamic parallax" },
    ],
  },
  {
    category: "光照 / 氛围",
    items: [
      { label: "黄金时刻", text: "golden hour lighting, warm rim light, long soft shadows" },
      { label: "霓虹赛博", text: "neon cyberpunk lighting, teal and magenta glow, wet reflective streets" },
      { label: "柔光棚拍", text: "soft diffused studio lighting, large softbox, even key light" },
      { label: "戏剧伦勃朗光", text: "dramatic Rembrandt lighting, strong chiaroscuro, single key light" },
      { label: "体积光", text: "volumetric god rays, atmospheric haze, light shafts through fog" },
    ],
  },
  {
    category: "画面风格",
    items: [
      { label: "写实电影", text: "photorealistic, cinematic color grading, high dynamic range, ultra detailed" },
      { label: "日式动漫", text: "anime style, clean cel shading, vibrant colors, detailed line art" },
      { label: "吉卜力", text: "Studio Ghibli inspired, hand-painted backgrounds, soft watercolor textures" },
      { label: "3D 渲染", text: "Pixar-style 3D render, subsurface scattering, soft global illumination" },
      { label: "水墨国风", text: "Chinese ink wash painting style, flowing brush strokes, negative space" },
    ],
  },
  {
    category: "画质增强",
    items: [
      { label: "高清细节", text: "ultra high detail, 8k, sharp focus, intricate textures" },
      { label: "杰作质量", text: "masterpiece, best quality, highly detailed, professional photography" },
      { label: "反向负面词", text: "(negative) blurry, low quality, distorted, deformed, extra limbs, watermark, text" },
    ],
  },
  {
    category: "构图",
    items: [
      { label: "三分法", text: "rule of thirds composition, balanced framing, leading lines" },
      { label: "对称居中", text: "perfectly symmetrical centered composition, frontal view" },
      { label: "前景遮挡", text: "foreground framing elements, layered depth, foreground bokeh" },
    ],
  },
];

/** 扁平化所有预设为 {category,label,text} 列表，方便搜索 / 列表渲染。 */
export function flatPresets(): { category: string; label: string; text: string }[] {
  return PROMPT_PRESETS.flatMap((c) => c.items.map((it) => ({ category: c.category, label: it.label, text: it.text })));
}
