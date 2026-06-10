// 内置「专业提示词」预设（静态，多分类）。用户可在提示词库面板浏览、一键套用，或收藏进
// 自己的库 / 快捷槽位。这些只是文本片段，插入到节点提示词框里即可。中文标签 + 英文提示词
// （多数生成模型对英文更敏感），用户可自行编辑。
//
// 词条来源：原内置预设 + 各模型社区公认的高质量片段（Sora 电影术语指南、Kling/Veo 提示词
// 教程、Midjourney/SD 摄影关键词与负面词最佳实践、Suno 风格标签结构），按本平台节点的实际
// 消费场景（图像/视频/数字人/角色/电商/配乐）整理。经验法则：运镜词是视频提示词里影响力
// 最高的元素；负面词宜短而准（SDXL 类模型尤其不要堆砌）。

export interface PresetPrompt { label: string; text: string }
export interface PresetCategory { category: string; items: PresetPrompt[] }

export const PROMPT_PRESETS: PresetCategory[] = [
  {
    category: "镜头 / 运镜",
    items: [
      { label: "电影感广角", text: "cinematic wide shot, 35mm anamorphic lens, shallow depth of field, natural film grain" },
      { label: "特写镜头", text: "extreme close-up, detailed facial features, soft bokeh background" },
      { label: "推近运镜", text: "slow dolly-in push toward subject, smooth steadicam motion" },
      { label: "拉远揭示", text: "slow dolly out pull back, gradually revealing the full scene" },
      { label: "环绕运镜", text: "360-degree orbit shot around subject, dynamic parallax" },
      { label: "跟踪镜头", text: "smooth tracking shot following the subject, steadicam glide" },
      { label: "摇臂升起", text: "crane shot rising up and over, sweeping reveal of the landscape" },
      { label: "航拍俯视", text: "aerial drone shot, top-down view, sweeping camera movement" },
      { label: "FPV 穿越", text: "FPV drone fly-through, fast weaving motion, dynamic speed" },
      { label: "手持纪实", text: "handheld camera with subtle shake, documentary realism, raw immediate feel" },
      { label: "甩镜转场", text: "whip pan transition, fast motion blur between scenes" },
      { label: "焦点切换", text: "rack focus shifting from foreground to background subject" },
      { label: "希区柯克变焦", text: "dolly zoom vertigo effect, background warping while subject stays fixed" },
    ],
  },
  {
    category: "视频动态",
    items: [
      { label: "走向镜头", text: "subject walking toward camera with natural gait, confident steady pace" },
      { label: "转身回眸", text: "subject slowly turning around to look back at the camera, hair swinging" },
      { label: "微风发丝", text: "hair and clothes gently blowing in the breeze, soft natural movement" },
      { label: "说话神态", text: "talking naturally to camera with subtle head movements, natural blinking and lip sync" },
      { label: "待机微动", text: "subtle idle motion, gentle breathing, occasional blinks, lifelike stillness" },
      { label: "慢动作水花", text: "slow motion water splash, 120fps, crisp droplets suspended in air" },
      { label: "奔跑追逐", text: "dynamic running sequence, motion blur on background, energetic chase" },
      { label: "真实细节", text: "dust particles visible in the light, condensation on glass, subtle lens flare, micro-details signaling realism" },
      { label: "落叶飘雪", text: "leaves and snowflakes drifting slowly through the air, layered depth" },
    ],
  },
  {
    category: "光照 / 氛围",
    items: [
      { label: "黄金时刻", text: "golden hour lighting, warm rim light, long soft shadows" },
      { label: "蓝调时刻", text: "blue hour twilight, cool ambient glow, city lights beginning to sparkle" },
      { label: "霓虹赛博", text: "neon cyberpunk lighting, teal and magenta glow, wet reflective streets" },
      { label: "柔光棚拍", text: "soft diffused studio lighting, large softbox, even key light" },
      { label: "三点布光", text: "studio three-point lighting, key fill and rim, clean professional setup" },
      { label: "戏剧伦勃朗光", text: "dramatic Rembrandt lighting, strong chiaroscuro, single key light" },
      { label: "逆光剪影", text: "backlit silhouette against bright sky, glowing edge light" },
      { label: "体积光", text: "volumetric god rays, atmospheric haze, light shafts through fog" },
      { label: "烛光暖调", text: "warm flickering candlelight, intimate cozy glow, deep soft shadows" },
      { label: "月夜冷光", text: "moonlit night scene, cool blue tones, gentle ambient starlight" },
      { label: "阴天柔光", text: "natural overcast diffused light, soft shadowless illumination" },
    ],
  },
  {
    category: "色调 / 调色",
    items: [
      { label: "青橙电影", text: "teal and orange cinematic color grading, complementary contrast" },
      { label: "莫兰迪灰", text: "muted morandi color palette, soft desaturated pastel tones" },
      { label: "黑白高反差", text: "high contrast black and white, deep blacks, dramatic monochrome" },
      { label: "暖调怀旧", text: "warm nostalgic faded tones, vintage Kodachrome film look" },
      { label: "冷峻蓝灰", text: "cold desaturated blue-grey palette, bleak moody atmosphere" },
      { label: "高饱和流行", text: "vibrant saturated pop colors, punchy bold palette" },
    ],
  },
  {
    category: "画面风格",
    items: [
      { label: "写实电影", text: "photorealistic, cinematic color grading, high dynamic range, ultra detailed" },
      { label: "复古胶片", text: "vintage 35mm film look, Fujifilm grain, faded highlights, retro color cast" },
      { label: "黑色电影", text: "film noir style, hard shadows, venetian blind light, smoky atmosphere" },
      { label: "日式动漫", text: "anime style, clean cel shading, vibrant colors, detailed line art" },
      { label: "吉卜力", text: "Studio Ghibli inspired, hand-painted backgrounds, soft watercolor textures" },
      { label: "3D 渲染", text: "Pixar-style 3D render, subsurface scattering, soft global illumination" },
      { label: "水墨国风", text: "Chinese ink wash painting style, flowing brush strokes, negative space" },
      { label: "油画质感", text: "classical oil painting, visible impasto brush strokes, rich pigments" },
      { label: "水彩插画", text: "delicate watercolor illustration, soft color bleeding, paper texture" },
      { label: "黏土定格", text: "claymation stop-motion style, handcrafted clay texture, miniature set" },
      { label: "对称糖果色", text: "Wes Anderson style, perfectly symmetrical framing, pastel candy palette" },
      { label: "像素艺术", text: "retro pixel art, 16-bit style, limited color palette" },
    ],
  },
  {
    category: "构图",
    items: [
      { label: "三分法", text: "rule of thirds composition, balanced framing, leading lines" },
      { label: "对称居中", text: "perfectly symmetrical centered composition, frontal view" },
      { label: "黄金螺旋", text: "golden ratio spiral composition, natural visual flow" },
      { label: "前景遮挡", text: "foreground framing elements, layered depth, foreground bokeh" },
      { label: "低角度仰拍", text: "low angle hero shot, towering powerful presence" },
      { label: "高角度俯拍", text: "high angle looking down, subject small in environment" },
      { label: "过肩视角", text: "over-the-shoulder shot, conversational framing, soft foreground shoulder" },
      { label: "荷兰角", text: "dutch angle tilted frame, uneasy dynamic tension" },
      { label: "极简留白", text: "minimalist composition, vast negative space, single small subject" },
    ],
  },
  {
    category: "人物 / 角色",
    items: [
      { label: "角色三视图", text: "character turnaround sheet, front side and back views, consistent design, neutral pose, plain background" },
      { label: "表情参考表", text: "character expression sheet, multiple facial expressions grid, consistent face" },
      { label: "全身立绘", text: "full body standing pose, head to toe in frame, clean studio background" },
      { label: "时尚人像", text: "fashion editorial portrait, designer styling, high-end magazine look" },
      { label: "自然抓拍", text: "candid lifestyle photo, natural unposed moment, authentic emotion" },
      { label: "干净头像", text: "clean professional headshot, soft key light, neutral seamless backdrop" },
      { label: "皮肤质感", text: "detailed skin texture, visible pores, natural imperfections, no beauty filter" },
    ],
  },
  {
    category: "场景 / 环境",
    items: [
      { label: "未来都市", text: "futuristic megacity skyline, towering holographic billboards, flying vehicles" },
      { label: "雨夜街头", text: "rainy night street, neon reflections on wet asphalt, umbrellas and steam" },
      { label: "古风庭院", text: "ancient Chinese courtyard, carved wooden eaves, lanterns and plum blossoms" },
      { label: "晨雾森林", text: "misty forest at dawn, sunbeams through tall pines, dew on moss" },
      { label: "海岸悬崖", text: "dramatic coastal cliffs, crashing waves, vast ocean horizon" },
      { label: "温馨室内", text: "cozy interior, warm lamp light, soft textiles, lived-in details" },
      { label: "科幻实验室", text: "sci-fi laboratory, glowing consoles, sterile white surfaces, holographic displays" },
      { label: "沙漠孤旅", text: "endless desert dunes, lone figure, heat haze, dramatic scale" },
    ],
  },
  {
    category: "电商 / 产品",
    items: [
      { label: "白底商品图", text: "clean white background product shot, even studio lighting, sharp edge-to-edge focus, e-commerce ready" },
      { label: "奢华质感", text: "luxury product photography, dramatic spotlight, dark moody backdrop, premium reflective surface" },
      { label: "悬浮展示", text: "product floating in mid-air, levitation effect, soft shadow below, minimal background" },
      { label: "美食诱人", text: "appetizing food close-up, steam rising, glistening texture, shallow depth of field" },
      { label: "化妆品水感", text: "cosmetics product with water splash, fresh droplets, crystal clear liquid motion" },
      { label: "场景化使用", text: "lifestyle product shot in natural use, real environment, authentic human interaction" },
      { label: "产品图负面词", text: "(negative) busy background, harsh shadows, reflections, dust, scratches, text, logo, watermark, amateur lighting" },
    ],
  },
  {
    category: "画质增强",
    items: [
      { label: "高清细节", text: "ultra high detail, 8k, sharp focus, intricate textures" },
      { label: "杰作质量", text: "masterpiece, best quality, highly detailed, professional photography" },
      { label: "锐利对焦", text: "tack sharp focus, crisp edges, high micro-contrast, no motion blur" },
      { label: "通用负面词", text: "(negative) blurry, low quality, distorted, deformed, extra limbs, watermark, text" },
      { label: "人像负面词", text: "(negative) bad anatomy, wrong proportions, deformed hands, extra fingers, cross-eyed, plastic skin, oversmoothed" },
      { label: "视频负面词", text: "(negative) flickering, morphing, warping, jitter, frame inconsistency, mutated motion, glitch artifacts" },
    ],
  },
  {
    category: "音乐 / 配乐",
    items: [
      { label: "史诗预告", text: "epic cinematic orchestral, powerful and triumphant, brass fanfare, soaring strings, thundering timpani, choir, building to massive climax, instrumental" },
      { label: "Lofi 放松", text: "lo-fi hip hop, 75 BPM, relaxed and warm, dusty vinyl crackle, mellow jazz piano, soft boom bap drums, no vocals" },
      { label: "温馨治愈", text: "warm acoustic folk, heartfelt and gentle, fingerpicked guitar, soft piano, intimate cozy mood, instrumental" },
      { label: "紧张悬疑", text: "dark suspense underscore, tense and ominous, pulsing low strings, ticking percussion, slow build, instrumental" },
      { label: "国风雅乐", text: "Chinese traditional instrumental, elegant and serene, guzheng and bamboo flute, flowing melody, ancient atmosphere" },
      { label: "电子律动", text: "upbeat electronic dance, energetic and driving, punchy synth bass, four-on-the-floor beat, bright festival energy" },
      { label: "轻快企业", text: "uplifting corporate background, optimistic and clean, light plucks and claps, steady momentum, instrumental" },
    ],
  },
];

/** 扁平化所有预设为 {category,label,text} 列表，方便搜索 / 列表渲染。 */
export function flatPresets(): { category: string; label: string; text: string }[] {
  return PROMPT_PRESETS.flatMap((c) => c.items.map((it) => ({ category: c.category, label: it.label, text: it.text })));
}
