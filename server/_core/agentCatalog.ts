import type { NodeType, AgentOperation } from "../../shared/types";
import { IMAGE_MODELS, VIDEO_MODELS } from "../../shared/modelCatalog";
import { PROVIDER_PARAMS, SUPPORTS_NEGATIVE_PROMPT, REQUIRES_REFERENCE_IMAGE, type ParamDef } from "../../shared/videoModelParams";

// ── Agent node catalog ────────────────────────────────────────────────────────
// The curated set of node types the Copilot agent may create/configure, plus the
// payload fields it may set on each. This is the single source of truth for both
// the LLM system prompt (so the model only proposes real nodes/fields) and the
// server-side validation (so we drop anything hallucinated before it reaches the
// client). Intentionally a SUBSET of all node types — the agent orchestrates the
// creative pipeline (script → storyboard/prompt → image/video → post), not admin
// or niche nodes.

export interface AgentFieldSpec {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "string[]";
  desc: string;
}

export interface AgentNodeSpec {
  type: NodeType;
  label: string;
  purpose: string;
  fields: AgentFieldSpec[];
  /** Downstream node types this one may connect to (mirrors connectionRules). */
  connectsTo: NodeType[];
}

export const AGENT_NODE_CATALOG: AgentNodeSpec[] = [
  {
    type: "script", label: "脚本", purpose: "影片剧本/梗概的创作与编辑",
    connectsTo: ["storyboard", "prompt", "ai_chat"],
    fields: [
      { name: "synopsis", type: "string", desc: "故事梗概（一句话或一段）" },
      { name: "logline", type: "string", desc: "一句话故事（25-35 字：主角+冲突+赌注）" },
      { name: "content", type: "string", desc: "完整剧本正文" },
      { name: "aiGenre", type: "string", desc: "类型，如 短视频/电影/广告片/MV" },
      { name: "aiStyle", type: "string", desc: "视觉风格，如 电影感/赛博朋克/写实" },
      { name: "aiMood", type: "string", desc: "情感基调，如 温暖治愈/紧张刺激" },
      { name: "aiSceneCount", type: "number", desc: "目标分镜数 2-12" },
      { name: "aiTargetModel", type: "string", desc: "目标生成模型，如 qwen/flux/wan_local/kling" },
      { name: "totalDuration", type: "number", desc: "成片目标总时长（秒），供拆镜/装配参考" },
      { name: "aiAspectRatio", type: "string", desc: "AI 生成分镜关键帧的画面比例，如 16:9 / 9:16" },
      { name: "aiPromptLang", type: "string", desc: "分镜提示词语言：en（默认，多数生成模型英文效果好）或 zh" },
    ],
  },
  {
    type: "character", label: "角色/场景", purpose: "可复用的角色（人物）或场景设定，连到分镜/生成节点以保持跨镜一致（脸/服装/特征）",
    connectsTo: ["storyboard", "image_gen", "video_task", "comfyui_image", "comfyui_video", "comfyui_workflow"],
    fields: [
      { name: "characterKind", type: "string", desc: "person（人物）或 scene（场景）" },
      { name: "name", type: "string", desc: "角色姓名（人物）" },
      { name: "role", type: "string", desc: "职业/角色定位，如 主角/侦探" },
      { name: "gender", type: "string", desc: "性别（人物）" },
      { name: "age", type: "string", desc: "年龄/年龄段（人物），如 28岁/中年" },
      { name: "appearance", type: "string", desc: "外貌描述（发型/脸型/体型等）" },
      { name: "personality", type: "string", desc: "性格特质（人物），如 冷静寡言/热情冲动" },
      { name: "outfit", type: "string", desc: "服装，如 黑色西装+红领带" },
      { name: "signature", type: "string", desc: "标志性物件/特征，如 银怀表/左眼疤痕" },
      { name: "sceneName", type: "string", desc: "场景名（characterKind=scene 时）" },
      { name: "sceneDescription", type: "string", desc: "场景描述（characterKind=scene 时）" },
      { name: "locationType", type: "string", desc: "场所类型（场景），如 室内/街道/森林" },
      { name: "atmosphere", type: "string", desc: "氛围（场景），如 阴郁压抑/明快温暖" },
      { name: "timeOfDay", type: "string", desc: "时间（场景），如 黄昏/深夜/清晨" },
      { name: "notes", type: "string", desc: "补充备注（通用）" },
    ],
  },
  {
    type: "storyboard", label: "分镜", purpose: "单个分镜（镜头表的一行）：画面描述、生成提示词与 Shot List 字段。镜头表面板可按这些字段一键批量生关键帧图/生视频/配音",
    connectsTo: ["image_gen", "video_task", "prompt", "comfyui_image", "comfyui_video", "audio"],
    fields: [
      { name: "sceneNumber", type: "number", desc: "镜号（1,2,3… 连续递增；「按镜头表装配」按它排序成片，必填）" },
      { name: "description", type: "string", desc: "画面描述（中文，给人看；生成提示词放 promptText，勿堆在此）" },
      { name: "promptText", type: "string", desc: "图像/视频生成提示词（必填，详细到可直接喂生成模型）" },
      { name: "negativePrompt", type: "string", desc: "反向提示词" },
      { name: "dialogue", type: "string", desc: "对白/旁白（格式「角色名：台词」，纯旁白直接写文本；批量配音直接取用）" },
      { name: "transition", type: "string", desc: "切到下一镜的转场：cut/fade/dissolve/wipe/fadeblack/fadewhite/smoothleft/match-cut，默认 cut（装配成片按它设逐切点转场）" },
      { name: "shotType", type: "string", desc: "景别：ECU/CU/MS/MLS/WS/establishing" },
      { name: "cameraMovement", type: "string", desc: "运镜：static/pan-left/zoom-in 等" },
      { name: "duration", type: "number", desc: "时长（秒）" },
      { name: "lens", type: "string", desc: "焦段，如 35mm" },
      { name: "lighting", type: "string", desc: "灯光，如 soft key + 轮廓光, golden hour" },
      { name: "sfx", type: "string", desc: "音效/氛围声意图，如 雨声+远雷" },
      { name: "colorTone", type: "string", desc: "调色，如 暖色 teal-orange" },
      { name: "beatRef", type: "string", desc: "对应节拍表拍点（如「3」或「中点」）" },
      { name: "aspectRatio", type: "string", desc: "关键帧图比例，如 16:9 / 9:16（按所选图像模型的档位夹取）" },
      { name: "imageModel", type: "string", desc: "关键帧生成用图像模型 id（见「云端生成模型清单·图像模型」，勿编造）" },
      { name: "imageResolution", type: "string", desc: "kie 图像分辨率档，如 1K/2K/4K（逐档计价，按模型支持档位夹取）" },
      { name: "skipAutoImage", type: "boolean", desc: "true=分镜仅作镜头表数据行：「运行全部」不为它兜底生关键帧图、预算不计入。分镜已连下游 image_gen 出图工位时系统自动跳过（无需设置）；仅『分镜独立出图但想暂停』时才设 true" },
    ],
  },
  {
    type: "prompt", label: "提示词", purpose: "纯文本提示词，向下游图像/视频节点传递（仅 ComfyUI 模式下作为每个镜头的提示词容器）",
    connectsTo: ["image_gen", "video_task", "comfyui_image", "comfyui_video", "comfyui_workflow"],
    fields: [
      { name: "positivePrompt", type: "string", desc: "正向提示词（输出至下游）" },
      { name: "negativePrompt", type: "string", desc: "反向提示词" },
      { name: "style", type: "string", desc: "风格" },
      { name: "aspectRatio", type: "string", desc: "画面比例，如 16:9 / 9:16" },
    ],
  },
  {
    type: "image_gen", label: "图像生成", purpose: "云端 AI 文/图生图",
    connectsTo: ["video_task", "asset", "compare"],
    fields: [
      { name: "prompt", type: "string", desc: "图像提示词" },
      { name: "negativePrompt", type: "string", desc: "反向提示词" },
      { name: "style", type: "string", desc: "风格" },
      { name: "aspectRatio", type: "string", desc: "比例，如 16:9（会自动同步到所选模型族对应的比例字段）" },
      { name: "model", type: "string", desc: "图像模型 id（见「云端生成模型清单·图像模型」，勿编造；不设则用节点默认）" },
      { name: "imageResolution", type: "string", desc: "kie 图像分辨率档，如 1K/2K/4K（逐档计价，按模型支持档位夹取）" },
      { name: "seed", type: "number", desc: "随机种子（可选；同角色跨镜锁同一 seed 可提升一致性）" },
      { name: "batchSize", type: "number", desc: "出图张数（仅部分模型生效：hf_soul_standard 支持 1/4；kie/poyo 的 Grok Imagine 每次固定返回一组约 6 张候选、按次计费，张数不可控，设了也无效）" },
    ],
  },
  {
    type: "comfyui_image", label: "ComfyUI 图像", purpose: "本地 ComfyUI 文/图生图",
    connectsTo: ["video_task", "comfyui_video", "asset", "compare"],
    fields: [
      { name: "prompt", type: "string", desc: "正向提示词" },
      { name: "negPrompt", type: "string", desc: "反向提示词" },
      { name: "width", type: "number", desc: "出图宽（px，/64 对齐，如 1280）" },
      { name: "height", type: "number", desc: "出图高（px，/64 对齐，如 720）" },
      { name: "seed", type: "number", desc: "随机种子（可选）" },
      { name: "steps", type: "number", desc: "采样步数（可选，默认由模板决定）" },
    ],
  },
  {
    type: "comfyui_video", label: "ComfyUI 视频", purpose: "本地 ComfyUI 文/图生视频",
    connectsTo: ["merge", "asset", "compare"],
    fields: [
      { name: "prompt", type: "string", desc: "正向提示词" },
      { name: "negPrompt", type: "string", desc: "反向提示词" },
      { name: "width", type: "number", desc: "出片宽（px，/64 对齐）" },
      { name: "height", type: "number", desc: "出片高（px，/64 对齐）" },
    ],
  },
  {
    type: "compare", label: "对比", purpose: "A/B 滑块对比两路上游结果（图或视频均可，双视频同步播放）；纯前端查看、不生成不扣费。用户也可在节点上直接全屏对比版本",
    connectsTo: [],
    fields: [
      { name: "aUrl", type: "string", desc: "A 路媒体 URL（可选；不填自动取第 1 路上游输出）" },
      { name: "bUrl", type: "string", desc: "B 路媒体 URL（可选；不填自动取第 2 路上游输出）" },
    ],
  },
  {
    type: "video_task", label: "视频任务", purpose: "云端 AI 文/图生视频",
    connectsTo: ["merge", "clip", "asset", "compare"],
    fields: [
      { name: "prompt", type: "string", desc: "视频提示词" },
      { name: "negativePrompt", type: "string", desc: "反向提示词（仅部分模型支持，见清单标注）" },
      { name: "provider", type: "string", desc: "视频模型 id（见「云端生成模型清单·视频模型」，勿编造；不设则用节点默认。选型看清单的能力标签：T2V=文生、I2V=图生需上游图）" },
      { name: "duration", type: "number", desc: "单镜时长（秒）；会写入所选视频模型的时长参数并按其档位夹取。连了分镜时也会自动继承分镜的 duration，故通常无需显式设" },
      { name: "params", type: "object", desc: '视频模型专属参数对象，如 {"aspect_ratio":"16:9","resolution":"720p"}。设比例/分辨率/模式用这里；可用键与取值【严格】按「云端生成模型清单·视频模型」中该 provider 的参数表（各模型键名/枚举档不同，清单外的键会被丢弃）' },
    ],
  },
  {
    type: "merge", label: "合并", purpose: "把多个视频拼接成片。上游视频若能回溯到分镜，用户可在节点上一键「按镜头表装配」（镜号排序 + 逐镜转场 + 配音对位），无需手动排序",
    connectsTo: ["subtitle", "overlay", "asset"],
    fields: [
      { name: "transition", type: "string", desc: "全局转场：none/fade/dissolve/fadeblack/fadewhite/smoothleft，默认 none 直切——除非用户点名要转场或快捷设置选了转场风格，否则不要设置（逐镜转场由装配按分镜 transition 自动设置）" },
      { name: "transitionDuration", type: "number", desc: "转场时长（秒，0.1-2.0，默认 0.5）" },
      { name: "segTransitions", type: "string[]", desc: "逐接缝转场数组（长度=段数-1，值同 transition 另加 wipe；仅当用户要求按镜头关系差异化转场时写：同场景连续动作→none 直切，时间/地点跳转→fadeblack，情绪过渡→dissolve）" },
      { name: "burnShotSubtitles", type: "boolean", desc: "true 时装配完成后把镜头表对白直接烧录为成片字幕" },
    ],
  },
  {
    type: "audio", label: "音频", purpose: "AI 配乐(music)/配音(dubbing)/音效(sfx)/音频工具(tools)或上传音频。逐镜配音不要手建——镜头表面板会按分镜 dialogue 批量生成",
    connectsTo: ["merge", "clip"],
    fields: [
      { name: "audioCategory", type: "string", desc: "music（配乐）/ dubbing（配音）/ sfx（音效）/ tools（音频工具）" },
      { name: "ttsText", type: "string", desc: "配音文案（audioCategory=dubbing 时）" },
      { name: "musicPrompt", type: "string", desc: "配乐描述（audioCategory=music 时），如 轻快钢琴+弦乐" },
      { name: "musicStyle", type: "string", desc: "配乐风格标签（music），如 cinematic/lo-fi" },
      { name: "musicInstrumental", type: "boolean", desc: "true=纯音乐不带人声（music）" },
      { name: "sfxPrompt", type: "string", desc: "音效描述（audioCategory=sfx 时），如 玻璃碎裂声" },
      { name: "sfxDuration", type: "number", desc: "音效时长（秒，0.5-22；不设=模型按描述自动定）" },
      { name: "sfxLoop", type: "boolean", desc: "true=生成可无缝循环的氛围音效（sfx）" },
      // #152 音频工具（tools）：需连一个上游音频（lyrics 除外）。工具是对现成音频的加工，不吃提示词生成新曲。
      { name: "toolModel", type: "string", desc: "音频工具（tools 时）：sep_vocals 人声分离 / cover 翻唱 / extend 续写 / lyrics 写歌词" },
      { name: "toolPrompt", type: "string", desc: "cover 风格描述（必填）/ extend 续写方向（可选）/ lyrics 主题（tools 时）" },
    ],
  },
  {
    type: "comfyui_workflow", label: "ComfyUI 自定义", purpose: "本地/云 ComfyUI 自定义工作流，按模板库的模板生成图/视频",
    connectsTo: ["merge", "asset", "video_task", "comfyui_video", "comfyui_workflow"],
    fields: [
      { name: "templateId", type: "number", desc: "引用「已分析的 ComfyUI 模板」中的模板 id" },
      { name: "prompt", type: "string", desc: "正向提示词（写入模板的 positive 角色参数）" },
      { name: "negPrompt", type: "string", desc: "反向提示词（写入 negative 角色参数）" },
      { name: "aspectRatio", type: "string", desc: "画面比例，如 16:9 / 9:16（配合 overrideRatioSize 覆盖工作流 latent 尺寸）" },
      { name: "overrideRatioSize", type: "boolean", desc: "true 时按 aspectRatio 覆盖工作流出图尺寸（保留面积、/64 对齐）" },
    ],
  },
  {
    type: "super_agent", label: "工程智能体", purpose:
      "自建 ComfyUI「工程智能体」：给它一句自然语言任务，它会多轮自动搭建并真机调通一份 ComfyUI 工作流（自动选节点/连线/填参、校验、运行、按报错自愈）。" +
      "适用：用自建 ComfyUI 且【模板库没有现成可用模板】、或需要一个定制/复杂工作流时——不用你手动引用 templateId，让它现搭。搭通后产出图/视频（产物在本节点上，不通过连线传递）。",
    connectsTo: [],
    fields: [
      { name: "task", type: "string", desc: "要它搭的工作流的自然语言描述（越具体越好：出图还是出视频、用什么大模型/LoRA/风格、分辨率、关键节点等）" },
      { name: "autoRun", type: "boolean", desc: "true=节点建好后自动开跑（无需用户点运行）；规划里想让它自动干活就设 true" },
      { name: "customBaseUrl", type: "string", desc: "目标 ComfyUI 服务器地址（留空用全局默认服务器）" },
      { name: "useMemory", type: "boolean", desc: "是否使用记忆体（资源记忆+工作流经验+已知坑），默认 true；关掉则忽略记忆直接读真机" },
      { name: "maxIterations", type: "number", desc: "最大自驱轮次 4-60，默认 50；复杂工作流可调高" },
    ],
  },
  {
    type: "note", label: "便签", purpose: "说明/批注，可连接任意节点",
    connectsTo: [],
    fields: [{ name: "content", type: "string", desc: "便签文本" }],
  },
];

const SPEC_BY_TYPE = new Map(AGENT_NODE_CATALOG.map((s) => [s.type, s]));

// ── 云端生成模型清单（喂给 LLM 的模型/参数知识 + 服务端取值校验）───────────────
// 与节点选择器同源（shared/modelCatalog + shared/videoModelParams），零手抄零漂移。
const VALID_VIDEO_PROVIDERS = new Set<string>(VIDEO_MODELS.map((m) => m.value));
const VALID_IMAGE_MODELS = new Set<string>(IMAGE_MODELS.map((m) => m.value));

/** 单个参数定义 → 紧凑单行片段（*=默认值）。 */
function paramDefBrief(d: ParamDef): string {
  if (d.type === "select") {
    const opts = d.options.map((o) => (d.default !== undefined && String(o.value) === String(d.default) ? `${o.value}*` : String(o.value))).join("|");
    return `${d.key}=${opts}`;
  }
  if (d.type === "range" || d.type === "number") {
    return `${d.key}=${d.min}~${d.max}${d.default !== undefined ? `(默认${d.default})` : ""}`;
  }
  // toggle
  return `${d.key}=true|false${d.default !== undefined ? `(默认${String(d.default)})` : ""}`;
}

/** video_task.params 按模型参数表清洗：丢弃幻觉键、range/number 夹到 [min,max]、select 非法枚举
 *  丢弃（回退模型默认）。create 与 update 两条路径共用，保证行为一致（防「改时长/分辨率」越界）。 */
function cleanVideoTaskParams(params: Record<string, unknown>, defs: ParamDef[]): Record<string, unknown> {
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    const d = defByKey.get(k);
    if (!d) continue; // 幻觉键：丢弃（上游会拒绝或静默无效）
    if (d.type === "range" || d.type === "number") {
      // 数值型：容忍 LLM 把数字写成字符串（"18"）——数字或可解析数字串都取值夹到 [min,max]；
      // 非数值（如 "abc"）丢弃回退默认，避免把垃圾串透传给下游报错。
      const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
      if (Number.isFinite(n)) {
        let c = n;
        if (typeof d.min === "number" && c < d.min) c = d.min;
        if (typeof d.max === "number" && c > d.max) c = d.max;
        cleaned[k] = c;
      }
    } else if (d.type === "select") {
      const allowed = new Set(d.options.map((o) => String(o.value)));
      if (allowed.has(String(v))) cleaned[k] = v; // 合法枚举保留；非法丢弃回退默认
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

/** 视频模型清单：每行一个模型（id、名称、能力标签、参考图/反向词支持、完整参数表）。
 *  only 提供时只输出该模型的完整条目（#141 按需注入）。 */
export function videoModelDigestText(only?: string): string {
  return VIDEO_MODELS
    .filter((m) => m.value !== "mock")
    .filter((m) => !only || m.value === only)
    .map((m) => {
      const caps = m.caps?.length ? `[${m.caps.join("/")}]` : "";
      const marks = [
        REQUIRES_REFERENCE_IMAGE.has(m.value) ? "需参考图" : "",
        SUPPORTS_NEGATIVE_PROMPT.has(m.value) ? "支持negativePrompt" : "",
      ].filter(Boolean).join("·");
      const defs = PROVIDER_PARAMS[m.value] ?? [];
      const ps = defs.length ? defs.map(paramDefBrief).join(", ") : "（无可调参数）";
      return `- ${m.value}「${m.label}」${caps}${marks ? `（${marks}）` : ""} params: ${ps}`;
    })
    .join("\n");
}

/** 图像模型清单：id、名称、能力标签、是否必须参考图。only 提供时只输出该模型（#141）。 */
export function imageModelDigestText(only?: string): string {
  return IMAGE_MODELS
    .filter((m) => !only || m.value === only)
    .map((m) => `- ${m.value}「${m.label}」${m.caps?.length ? `[${m.caps.join("/")}]` : ""}${m.requiresRef ? "（需参考图/上游图输入）" : ""}${m.note ? `（${m.note}）` : ""}`)
    .join("\n");
}

/** 汇总成系统提示的「云端生成模型清单」章节（仅非 comfyOnly 模式注入）。
 *
 *  #141 按需注入：快速设置锁定了图/视频模型时（pinned*），对应类别只保留所锁模型的
 *  完整条目（含参数表），其余压成「仅名字目录」一行——清单体积大幅缩身、模型不再
 *  选型犹豫；名目录明确标注「仅供答疑提及，生成禁止选用」防止对被裁模型编造参数。
 *  锁定值不在清单里（拼错/已下架）则该类别回退全量，绝不让助手失明。
 *  图/视频独立裁剪：只锁图像时视频仍全量，反之亦然；不锁 = 全量（与旧版逐字一致）。
 *  可靠性依据：快速设置随每轮请求实时传入、服务端无状态——改模型下一轮即按新模型
 *  注入、选回「默认」下一轮即恢复全量，无缓存/同步问题。 */
export function modelKnowledgeText(opts: { pinnedImageModel?: string; pinnedVideoModel?: string; compact?: boolean } = {}): string {
  const imgPin = opts.pinnedImageModel && IMAGE_MODELS.some((m) => m.value === opts.pinnedImageModel) ? opts.pinnedImageModel : undefined;
  const vidPin = opts.pinnedVideoModel && VIDEO_MODELS.some((m) => m.value === opts.pinnedVideoModel && m.value !== "mock") ? opts.pinnedVideoModel : undefined;
  const restNote = (kind: string, pin: string, rest: string) =>
    `\n（已由用户在快速设置锁定${kind}模型 ${pin}，生成一律用它。其余${kind}模型仅名字目录、仅供答疑提及，本轮生成【禁止】选用——它们的参数未提供，选用即编造：${rest}）`;
  // A3 批2 编辑模式精简清单：框选=增量编辑意图，通常不涉及重新选型，全量参数表（清单
  // 最大体积来源）压成「仅合法 id 目录」；锁定（pinned）类别不受影响（保留所锁完整条目）。
  const compactNote = (kind: string, ids: string) =>
    `（编辑模式精简清单——${kind}模型合法 id 目录：${ids}。如需换模型只从此目录取 id；参数表本轮未注入，`
    + `不清楚某模型的 params 键就【不要】写 params，交由节点默认与服务端校验兜底。）`;
  const imgSection = imgPin
    ? imageModelDigestText(imgPin) + restNote("图像", imgPin, IMAGE_MODELS.filter((m) => m.value !== imgPin).map((m) => m.value).join("、"))
    : opts.compact
      ? compactNote("图像", IMAGE_MODELS.map((m) => m.value).join("、"))
      : imageModelDigestText();
  const vidSection = vidPin
    ? videoModelDigestText(vidPin) + restNote("视频", vidPin, VIDEO_MODELS.filter((m) => m.value !== vidPin && m.value !== "mock").map((m) => m.value).join("、"))
    : opts.compact
      ? compactNote("视频", VIDEO_MODELS.filter((m) => m.value !== "mock").map((m) => m.value).join("、"))
      : videoModelDigestText();
  return `## 图像模型（image_gen.model / storyboard.imageModel 的合法取值）\n${imgSection}\n## 视频模型（video_task.provider 的合法取值；params 键与取值严格按各自参数表，*=默认）\n${vidSection}`;
}

// update 操作只带 targetRef（节点 id）不带 nodeType，服务端无法按类型过滤——改用「全目录
// 字段名并集」过滤：保留属于任一节点类型 spec 的字段，丢弃并集外的纯幻觉字段。再显式放行
// 自愈用的 customBaseUrl（补 ComfyUI 服务器地址，不在任何 create spec 里）。
const ALL_SPEC_FIELDS = new Set<string>([
  ...AGENT_NODE_CATALOG.flatMap((s) => s.fields.map((f) => f.name)),
  "customBaseUrl",
  // 「跳过执行」通用开关（任意可运行节点；用户右键或助手 update 均可切换）。
  "disabled",
]);

// In "仅 ComfyUI 生成" mode these node types are excluded. The generation nodes
// (image_gen / video_task / audio / comfyui_image / comfyui_video) are dropped so
// generation must go through comfyui_workflow (a library template materialized
// into a workflow node). `storyboard` is also excluded here: its built-in "AI 生成
// 分镜" uses cloud image models (inconsistent with ComfyUI-only), so per-shot
// prompts are carried by `prompt` nodes instead (script → prompt → comfyui_workflow).
const COMFY_ONLY_EXCLUDED = new Set<NodeType>(["image_gen", "video_task", "audio", "comfyui_image", "comfyui_video", "storyboard"]);

/** Render the catalog as compact text for the LLM system prompt. In comfyOnly
 *  mode, the excluded generation nodes are dropped so the model can't pick them.
 *  super_agent（工程智能体）仅在 allowSuperAgent（用户 L3+，能真正运行它）时列出，
 *  否则不注入——避免给无权限用户规划出跑不起来的节点。 */
export function catalogText(opts: { comfyOnly?: boolean; allowSuperAgent?: boolean } = {}): string {
  return AGENT_NODE_CATALOG
    .filter((s) => !(opts.comfyOnly && COMFY_ONLY_EXCLUDED.has(s.type)))
    .filter((s) => s.type !== "super_agent" || opts.allowSuperAgent)
    .map((s) => {
      const fields = s.fields.map((f) => `${f.name}(${f.type}): ${f.desc}`).join("; ");
      const to = s.connectsTo.length ? s.connectsTo.join(", ") : "（无固定下游）";
      return `• ${s.type} 「${s.label}」— ${s.purpose}\n  可设字段: ${fields}\n  可连接到: ${to}`;
    })
    .join("\n");
}

/** Render analyzed-template knowledge for the system prompt (bounded). */
export function templateKnowledgeText(
  rows: { id: number; label: string; functionSummary: string; capabilities: string[]; outputType?: string; hasVideoOutput?: boolean; shotSeconds?: number | null }[],
  opts: { maxItems?: number; maxLen?: number } = {},
): string {
  const maxItems = opts.maxItems ?? 20;
  const maxLen = opts.maxLen ?? 2000;
  // Prefer video-capable + (implicitly) recently analyzed (caller pre-sorts).
  const lines = rows.slice(0, maxItems).map((r) => {
    const caps = r.capabilities?.length ? `[${r.capabilities.join("/")}]` : "";
    // Per-shot duration cap for video templates so the agent can plan enough shots.
    const dur = r.shotSeconds && r.shotSeconds > 0 ? `, 每镜≈${r.shotSeconds % 1 === 0 ? r.shotSeconds : r.shotSeconds.toFixed(1)}s` : "";
    return `• id=${r.id} 「${r.label}」(${r.outputType ?? "?"}${dur}) ${caps} ${r.functionSummary}`.trim();
  });
  let out = lines.join("\n");
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/**
 * Validate + sanitize one raw operation from the LLM. Returns a cleaned op, or
 * null if it is structurally invalid (unknown create nodeType, missing refs).
 * Create-op payloads are filtered to the spec's whitelisted fields.
 */
export function sanitizeOperation(
  raw: unknown,
  opts: { comfyOnly?: boolean; validTemplateIds?: Set<number>; allowSuperAgent?: boolean } = {},
): AgentOperation | null {
  const r = sanitizeOperationDetailed(raw, opts);
  return "op" in r ? r.op : null;
}

/**
 * Same validation as {@link sanitizeOperation} but distinguishes "kept" from
 * "dropped + why" so the agent can tell the user *which* of the LLM's proposed
 * operations were silently discarded (hallucinated node types, fabricated
 * template ids, malformed connects, …) instead of them just vanishing.
 */
export function sanitizeOperationDetailed(
  raw: unknown,
  opts: {
    comfyOnly?: boolean; validTemplateIds?: Set<number>; allowSuperAgent?: boolean;
    /** A3 增量规划：用户框选节点时的硬约束——update/delete 的 targetRef 必须在此集合内
     *  （调用方需预先把本轮 create 的 tempId 并入，允许「新建节点再改它」）。不传=不启用。 */
    allowedTargetIds?: Set<string>;
  } = {},
): { op: AgentOperation } | { drop: string } {
  if (!raw || typeof raw !== "object") return { drop: "无法识别的操作（非对象）" };
  const o = raw as Record<string, unknown>;
  const op = o.op;
  if (op !== "create" && op !== "update" && op !== "connect" && op !== "delete" && op !== "canvas") return { drop: `未知的操作类型「${String(op)}」` };
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  // note 是给人看的一句话理由，行内展示——超长（LLM 跑偏）截到 120 字防撑爆消息存储。
  const noteStr = (v: unknown) => { const t = str(v); return t && t.length > 120 ? t.slice(0, 120) + "…" : t; };

  // #112 画布级动作：白名单校验 action，其余字段一律剥除（无 payload/ref 概念）。
  if (op === "canvas") {
    const CANVAS_ACTIONS = new Set(["minimal_on", "minimal_off", "arrange_layout", "fit_view", "download_all"]);
    const action = str(o.action);
    if (!action || !CANVAS_ACTIONS.has(action)) return { drop: `未知的画布动作「${String(o.action)}」` };
    return { op: { op: "canvas", action: action as AgentOperation["action"], note: noteStr(o.note) } };
  }

  if (op === "create") {
    const nodeType = str(o.nodeType) as NodeType | undefined;
    if (!nodeType || !SPEC_BY_TYPE.has(nodeType)) return { drop: `不支持的节点类型「${String(o.nodeType)}」` };
    // comfyOnly: drop any generation node that isn't comfyui_workflow.
    if (opts.comfyOnly && COMFY_ONLY_EXCLUDED.has(nodeType)) return { drop: `「仅 ComfyUI」模式下不支持 ${nodeType} 节点` };
    // super_agent（工程智能体）需 L3+ 才能运行——无权限用户即使 LLM 提议也丢弃，避免建出跑不起来的节点。
    if (nodeType === "super_agent" && !opts.allowSuperAgent) return { drop: "工程智能体节点需要 L3+ 权限，已跳过" };
    const spec = SPEC_BY_TYPE.get(nodeType)!;
    const allowed = new Set(spec.fields.map((f) => f.name));
    const payload: Record<string, unknown> = {};
    if (o.payload && typeof o.payload === "object") {
      for (const [k, v] of Object.entries(o.payload as Record<string, unknown>)) {
        if (!allowed.has(k)) continue;
        // object 型字段（如 video_task.params）必须是纯对象——字符串/数组会破坏节点参数面板。
        if (k === "params" && (typeof v !== "object" || v === null || Array.isArray(v))) continue;
        payload[k] = v;
      }
    }
    // 模型取值校验（与节点选择器同源清单）：LLM 编造的模型 id 静默剥除（保留同批其它字段，
    // 节点回落默认模型），比整条丢弃更贴合意图。
    if (typeof payload.provider === "string" && !VALID_VIDEO_PROVIDERS.has(payload.provider)) delete payload.provider;
    if (typeof payload.model === "string" && !VALID_IMAGE_MODELS.has(payload.model)) delete payload.model;
    if (typeof payload.imageModel === "string" && !VALID_IMAGE_MODELS.has(payload.imageModel)) delete payload.imageModel;
    // video_task.params 键按所选模型的参数表过滤（幻觉键会被上游拒绝或静默无效）；
    // provider 未设/未知时保留原样——提交层还有各 provider 的 allow-list 兜底。
    if (nodeType === "video_task" && payload.params && typeof payload.params === "object") {
      const prov = typeof payload.provider === "string" ? payload.provider : undefined;
      const defs = prov ? PROVIDER_PARAMS[prov] : undefined;
      // 键过滤 + 数值夹取 + 枚举校验（尤其「合并短镜」开启后 LLM 可能把 duration 设成超模型上限）。
      if (defs) payload.params = cleanVideoTaskParams(payload.params as Record<string, unknown>, defs);
    }
    // Hard-guard comfyui_workflow templateId against the real analyzed-template set
    // so the model can't fabricate a template (e.g. an invented name with a made-up
    // / missing id that materializes into an empty, un-runnable shell node).
    if (nodeType === "comfyui_workflow" && opts.validTemplateIds) {
      const tid = payload.templateId != null ? Number(payload.templateId) : NaN;
      const hasValidTemplate = Number.isInteger(tid) && opts.validTemplateIds.has(tid);
      // comfyOnly: a workflow node is meaningless without a real template → drop.
      if (opts.comfyOnly && !hasValidTemplate) return { drop: "ComfyUI 工作流节点缺少有效模板" };
      // Any mode: a templateId that doesn't resolve is a hallucination → drop.
      if (payload.templateId != null && !hasValidTemplate) return { drop: `引用了不存在的工作流模板（id=${String(payload.templateId)}）` };
    }
    return {
      op: {
        op: "create", nodeType, tempId: str(o.tempId), title: str(o.title),
        payload, note: noteStr(o.note), sceneGroup: str(o.sceneGroup),
      },
    };
  }
  if (op === "connect") {
    const sourceRef = str(o.sourceRef), targetRef = str(o.targetRef);
    if (!sourceRef || !targetRef) return { drop: "连接操作缺少起点或终点引用" };
    return { op: { op: "connect", sourceRef, targetRef, sourceHandle: str(o.sourceHandle), targetHandle: str(o.targetHandle), note: noteStr(o.note) } };
  }
  if (op === "update") {
    const targetRef = str(o.targetRef);
    if (!targetRef) return { drop: "修改操作缺少目标节点引用" };
    // A3：框选模式下只允许改选中节点（或本轮新建的 tempId），防止增量修改误伤无关节点。
    if (opts.allowedTargetIds && !opts.allowedTargetIds.has(targetRef)) {
      return { drop: `已框选节点：仅允许修改选中节点，「${targetRef}」不在框选范围` };
    }
    // 与 create 对称地过滤字段：targetRef 不带 nodeType，按全目录字段并集 + customBaseUrl 放行，
    // 丢弃并集外的幻觉字段（截断回写损坏仍由客户端 agentApply 的截断守卫兜底）。
    const payload: Record<string, unknown> = {};
    if (o.payload && typeof o.payload === "object") {
      for (const [k, v] of Object.entries(o.payload as Record<string, unknown>)) {
        if (ALL_SPEC_FIELDS.has(k)) payload[k] = v;
      }
    }
    // 与 create 对称地拦幻觉 templateId：update 若把 comfyui_workflow 节点重指到一个不存在的
    // 模板，会把已有工位改成跑不通的空壳（templateId 只属于 comfyui_workflow，出现即校验）。
    // 只剥掉这个非法字段、保留同批其它合法改动（改 prompt/比例等），比整条丢弃更贴合意图。
    if (payload.templateId != null && opts.validTemplateIds) {
      const tid = Number(payload.templateId);
      if (!(Number.isInteger(tid) && opts.validTemplateIds.has(tid))) delete payload.templateId;
    }
    // 与 create 对称：编造的模型 id 剥除（provider 属 video_task、model/imageModel 属图像生成，
    // 全局唯一字段名，无需 nodeType 也能校验）；params 非纯对象剥除，provider 已知时按参数表过滤键。
    if (typeof payload.provider === "string" && !VALID_VIDEO_PROVIDERS.has(payload.provider)) delete payload.provider;
    if (typeof payload.model === "string" && !VALID_IMAGE_MODELS.has(payload.model)) delete payload.model;
    if (typeof payload.imageModel === "string" && !VALID_IMAGE_MODELS.has(payload.imageModel)) delete payload.imageModel;
    if (payload.params !== undefined && (typeof payload.params !== "object" || payload.params === null || Array.isArray(payload.params))) delete payload.params;
    // 与 create 同口径清洗：键过滤 + 数值夹取 + 枚举校验（「改时长/分辨率」也不越界）。
    // 注：update 未带 provider 时无从取参数表，只能透传（生成时按节点实际 provider 再夹取）。
    if (payload.params && typeof payload.provider === "string") {
      const defs = PROVIDER_PARAMS[payload.provider];
      if (defs) payload.params = cleanVideoTaskParams(payload.params as Record<string, unknown>, defs);
    }
    return { op: { op: "update", targetRef, title: str(o.title), payload, note: noteStr(o.note) } };
  }
  // delete
  const targetRef = str(o.targetRef);
  if (!targetRef) return { drop: "删除操作缺少目标节点引用" };
  // A3：框选模式下只允许删选中节点（或本轮新建的 tempId）——删除比误改更不可逆，必须硬拦。
  if (opts.allowedTargetIds && !opts.allowedTargetIds.has(targetRef)) {
    return { drop: `已框选节点：仅允许删除选中节点，「${targetRef}」不在框选范围` };
  }
  return { op: { op: "delete", targetRef, note: noteStr(o.note) } };
}
