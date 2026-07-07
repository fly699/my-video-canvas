import { useState, useEffect } from "react";
import {
  X, Sparkles, Layers, Wand2, Video, Boxes, Bot, Users, ScrollText, Activity,
  Shield, ArrowRight, MessageCircle, Music, Wallet, Clapperboard, Bookmark,
  Palette, Upload, User, AtSign, Calculator, Copy, BookOpen, Route, ShieldCheck, Zap,
} from "lucide-react";
import type { NodeType } from "../../../../shared/types";
import { getNodeConfig } from "../../lib/nodeConfig";
import {
  CONNECTION_HINTS,
  getCompatibleTargets,
  getCompatibleSources,
} from "../../lib/connectionRules";

const STORAGE_KEY = "avc:guide-seen";

const FLOW_STEPS: { type: NodeType; label: string }[] = [
  { type: "script", label: "脚本" },
  { type: "storyboard", label: "分镜" },
  { type: "image_gen", label: "图像" },
  { type: "video_task", label: "视频" },
];

// 药丸组件
function NodePill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 99,
        border: `1px solid ${color.replace(")", " / 0.3)")}`,
        background: color.replace(")", " / 0.1)"),
        color: color,
        whiteSpace: "nowrap" as const,
      }}
    >
      {label}
    </span>
  );
}

function WelcomeModal({ onClose }: { onClose: () => void }) {
  const [dontShow, setDontShow] = useState(false);

  function handleDismiss() {
    if (dontShow) localStorage.setItem(STORAGE_KEY, "1");
    onClose();
  }

  // 9 大核心工具（2 列布局，呼应图1）
  const features = [
    { Icon: Layers, color: "oklch(0.68 0.22 285)",
      title: "节点式工作流", desc: "脚本 / 分镜 / 提示词 / 图像 / 视频 / 剪辑节点自由编排，可视化连线" },
    { Icon: Clapperboard, color: "oklch(0.62 0.16 265)",
      title: "工作室界面风格", desc: "工具栏一键切换「专业 / 工作室」：工作室为影院深色皮肤，选中节点时主要参数以紧凑「命令栏」吸附在节点下方（提示词 + AI 扩写/翻译、模型/比例/主参数、参考图、发送钮），底部「展开全部参数」或双击可展开全部；逻辑与数据两风格共用、互不影响",
      badge: "NEW" },
    { Icon: Zap, color: "oklch(0.72 0.17 90)",
      title: "速览快捷键 Alt+W", desc: "一键临时展开全部节点的左侧参考图窗 + 顶部提示词窗，整张画布的参考与提示词一眼速览；再按 Alt+W 或 5 秒后自动恢复",
      badge: "NEW" },
    { Icon: ShieldCheck, color: "oklch(0.66 0.16 150)",
      title: "注册邮箱验证（管理员）", desc: "管理后台「注册认证」页可一键启用：开启后邮箱注册需收 6 位验证码方可登录，并可配置 SMTP（支持一键读取「公网隧道」页的 SMTP 共用）；关闭则注册即登录，老账号不受影响",
      badge: "NEW" },
    { Icon: Clapperboard, color: "oklch(0.65 0.20 160)",
      title: "分镜→成片流水线", desc: "镜头表一表统管：批量关键帧图 → 批量生视频（云端 / ComfyUI 本地免费三引擎）→ 批量配音（多角色分音色）→ 批量音效 → 合并节点「按镜头表装配」自动镜号排序、逐镜转场、配音音效对位，字幕再从镜头表一键对位生成；不满意的镜点「镜N」定位重生成",
      badge: "NEW" },
    { Icon: Wand2, color: "oklch(0.72 0.20 330)",
      title: "AI 图像生成", desc: "对齐 Poyo 全量目录共 24 个模型：Nano Banana Pro、GPT Image、Flux 2 / Kontext、Seedream、Kling、Z-Image 等，含 Higgsfield Soul / Reve",
      badge: "NEW" },
    { Icon: Video, color: "oklch(0.62 0.20 25)",
      title: "AI 视频生成", desc: "扩充至 37 个模型：Sora 2、Veo 3.1、Kling 2.1~3.0、Wan、Seedance、Hailuo、Runway、Higgsfield DoP，覆盖文生 / 图生 / 首尾帧",
      badge: "NEW" },
    { Icon: Clapperboard, color: "oklch(0.65 0.19 310)",
      title: "内置综合剪辑器", desc: "多片段时间轴 · 单遍 ffmpeg 导出高素质成片；转场 / 特效 / 画面适配 / 倒放 / 变速、富文本字幕、AI 配乐配音，撤销重做 + 自动保存",
      badge: "NEW" },
    { Icon: Clapperboard, color: "oklch(0.68 0.20 55)",
      title: "剪辑节点 · 专业升级", desc: "节点级精剪：双向裁剪 + 精确入出点 / 自定义倍速 / 截取封面帧；多音轨混音（每轨音量·延迟·淡入淡出·静音·独奏·语音闪避 Ducking）、响度标准化 + 降噪、调色预设、淡入淡出、裁剪比例 / 旋转翻转、输出分辨率·帧率·格式；预览可循环播放并随节点缩放充满",
      badge: "NEW" },
    { Icon: User, color: "oklch(0.66 0.18 30)",
      title: "角色一致性 · 全局角色库", desc: "角色节点的多视角参考图自动锁定身份，贯穿 ComfyUI 图/视频/工作流（IPAdapter / LoRA / 参考图）与 Poyo 图/视频（多模态参考）；一键「应用到本场景所有镜头」、多角色按布局定优先级、LLM 一致性校验；角色保存到全局角色库，跨项目快速调用；「一致性种子」一键把同一随机种子钉到该角色全部镜头，跨镜头一致性最大化",
      badge: "NEW" },
    { Icon: Bot, color: "oklch(0.70 0.18 250)",
      title: "多智能体编排", desc: "一个画布可放多个智能体，各自分管自己规划生成的节点：归属彩色徽标标识、规划上下文相互隔离，一键「选中 / 运行 / 清空我的节点」，互不干扰",
      badge: "NEW" },
    { Icon: Boxes, color: "oklch(0.68 0.20 100)",
      title: "分类模型选择器", desc: "图像 / 视频 / 对话节点统一的模型选择器：按供应商与家族分组、支持搜索、列表限高可滚动，KIE 模型排在前；每个模型标注消耗点数（credits），按预算挑选；管理员可在后台「模型管理」按节点分组勾选各模型是否显示",
      badge: "NEW" },
    { Icon: AtSign, color: "oklch(0.66 0.18 30)",
      title: "@ 引用：角色 / 场景 / 媒体节点", desc: "在任意提示词框输入 @ 即可引用画布上的角色 / 场景，以及已生成的图像 / 音频 / 视频节点：@角色 锁定身份、@图像 作参考图、@音频 驱动数字人口型、@视频 作动作迁移源；被 @ 的节点在吸附栏显示为「参与项」并标注来源，无需连线",
      badge: "NEW" },
    { Icon: Calculator, color: "oklch(0.72 0.18 155)",
      title: "实时点数预估 · 审计可追溯", desc: "图像 / 视频 / 分镜 / 音频节点的生成按钮按所选模型与参数（时长 / 分辨率 / 张数 / 字数等）实时预估消耗点数；预估值随每次生成计入管理员审计日志并标注成功 / 失败，操作日志与 ComfyUI 日志均支持一键导出 CSV",
      badge: "NEW" },
    { Icon: Copy, color: "oklch(0.68 0.22 285)",
      title: "一键同步模型与参数", desc: "分镜 / 图像 / 视频节点支持「同步参数」对话框：把当前节点选好的模型与全部参数一键复制到画布内同类节点，默认勾选同一工作流内的节点、支持全选，批量统一风格设置",
      badge: "NEW" },
    { Icon: BookOpen, color: "oklch(0.62 0.18 240)",
      title: "提示词库 · 拉线建节点", desc: "提示词库可保存常用提示词、分类管理、内联编辑、导入导出，输入「/」快捷唤出，支持 10 个快捷槽位；从节点端口拉线到空白处松手，即在落点弹出建节点菜单并自动连线，顺手搭流程",
      badge: "NEW" },
    { Icon: Boxes, color: "oklch(0.68 0.20 100)",
      title: "ComfyUI 自建集成", desc: "图像（多 LoRA / ControlNet+预处理 / IPAdapter / Inpaint / 放大）+ 视频（AnimateDiff / Wan / LTX，支持角色 LoRA）、15 类模型自动发现、自定义工作流导入（含专业导入向导，见下）；上游提示词「优先/转发」、运行后队列空闲自动清显存、参数绑定失同步校验、随机/固定种子、多行提示词批量出图" },
    { Icon: Bookmark, color: "oklch(0.65 0.20 140)",
      title: "ComfyUI 节点模板库", desc: "右键任意 ComfyUI 节点把全部参数（含提示词 / 工作流）存为共享模板，全员可调用；按节点外框颜色分类、可搜索 / 注释 / 重命名，点击即在画布快速新建带参节点",
      badge: "NEW" },
    { Icon: Music, color: "oklch(0.70 0.18 340)",
      title: "AI 配乐 · 配音 · 音效", desc: "音频节点接入 Suno / MiniMax 音乐生成、OpenAI / ElevenLabs / 本地 VoxCPM 配音与 ElevenLabs SFX 音效生成；对白支持「角色名：台词」多角色分音色 casting，逐段各自配音自动拼接成镜级音频",
      badge: "NEW" },
    { Icon: Wallet, color: "oklch(0.72 0.18 155)",
      title: "Poyo 余额仪表盘", desc: "顶栏实时显示剩余 Poyo 点数，配合模型选择器的点数标注，生成前即可掌握预算与消耗",
      badge: "NEW" },
    { Icon: Bot, color: "oklch(0.70 0.18 200)",
      title: "大模型对话 · 人设模板", desc: "Gemini 3 Flash、Claude Sonnet 4.5、Claude Haiku 4.5、GPT-5.2，写脚本 / 润色 / 审查 / 多版本；内置 30+ 人设模板（专业编剧·长片剧集、对白医生、SEEDANCE 2.0 专家等），节点与局域网聊天 AI 助手共用；每条消息可单独复制、整段一键导出",
      badge: "NEW" },
    { Icon: ScrollText, color: "oklch(0.62 0.18 240)",
      title: "ScriptNode 高级 AI", desc: "场景细化、剧本审查、多版本生成、对白提取、Mood Board 等 7 项工具；目标模型支持 ComfyUI 主流（Qwen-Image / Flux.1 / Wan 2.2 / HunyuanVideo 等），一键生成的分镜携带景别 / 焦段 / 灯光 / 调色与反向提示词并写入下游",
      badge: "PRO" },
    { Icon: Palette, color: "oklch(0.66 0.20 300)",
      title: "护眼主题与外观", desc: "共 15 套主题：深色系含 ComfyUI（litegraph 炭灰），浅色系新增 晴空 / 鼠尾草 / 暖砂 护眼配色；画布背景默认「跟随主题」切换即变，也可固定底色",
      badge: "NEW" },
    { Icon: Upload, color: "oklch(0.65 0.18 60)",
      title: "素材库批量与共享", desc: "多选 / 拖拽 / 粘贴（Ctrl·⌘V）批量上传，视频点击全屏弹窗预览；同一项目的编辑者共享素材库，互见彼此上传与 AI 生成的素材",
      badge: "NEW" },
    { Icon: Activity, color: "oklch(0.65 0.20 160)",
      title: "工作流状态面板", desc: "一键运行整条工作流，右侧面板实时展示每个节点进度、耗时、错误",
      badge: "NEW" },
    { Icon: MessageCircle, color: "oklch(0.70 0.18 285)",
      title: "团队聊天 · 桌面应用", desc: "大厅/群聊/端到端加密私聊，可安装为 Chrome 桌面应用，支持专属浅色主题",
      badge: "NEW" },
    { Icon: Users, color: "oklch(0.66 0.18 140)",
      title: "多人实时协作", desc: "多用户同时编辑，节点变更秒同步，协作者光标可见；他人放置的节点按创建者显示专属颜色标识，一眼辨认归属",
      badge: "NEW" },
    { Icon: ShieldCheck, color: "oklch(0.7 0.17 195)",
      title: "ComfyUI 工作流导入向导", desc: "分步导入：粘贴 JSON / 拖文件 / ComfyUI PNG（UI 格式自动转 API）→ 下拉选服务器（节点保存 ∪ 本机注册 ∪ 全局列表）→ 用服务器真实节点定义预检——未装的自定义节点、ckpt/LoRA/采样器等不存在的取值（下拉一键替换成服务器上的真实选项）、必填缺失，全部导入前查出，一次跑通；节点选择器「导入工作流」磁贴一键直达，已导入节点可随时「换工作流」",
      badge: "NEW" },
    { Icon: Route, color: "oklch(0.66 0.18 250)",
      title: "创作向导 · 专业开发管线", desc: "脚本节点「向导」分步推进：Logline → 梗概（风格基调 + 自定义意图可调）→ 节拍表（结构模板 + 时长分配策略，逐拍可编辑、总时长对账）→ 剧本（「仅剧本先审视」或「剧本+分镜」两种模式）→ 分镜；「约束预览」明示将注入的节拍表与角色档案（可临时改写），剧本生成后一键转「专业审查」六维评分闭环",
      badge: "NEW" },
    { Icon: Wallet, color: "oklch(0.72 0.15 160)",
      title: "预算管控面板", desc: "工具栏一键查看整张画布的预估消耗：逐节点按所选模型/参数精算，分 kie 点与 Poyo cr 两路对照实时余额（超额标红）、按模型分组明细；可设项目预算上限（超限时智能体自动执行暂停并提醒），计价与官方价格表全量对账",
      badge: "NEW" },
    { Icon: Zap, color: "oklch(0.72 0.18 60)",
      title: "画布效率操作", desc: "顶栏全局运行状态条（生成中/排队/失败一目了然，点失败直接跳到出错节点）；框选后 Ctrl+C/V 复制整条镜头链（含内部连线）；「一键整理」按连线方向自动排版 + 网格吸附；吸附窗在提示词/参考元素变更时自动弹出 2 秒",
      badge: "NEW" },
    { Icon: Bot, color: "oklch(0.70 0.18 250)",
      title: "画布助手 · 对话改画布", desc: "右下角浮层里一句话让 AI 直接在画布建/连/改节点（复用智能体同一套引擎），支持 @角色 引用、/ 唤起技能、一键撤销本次改动；每次进入画布默认打开，对话上下文落库、跨设备/清缓存不丢",
      badge: "NEW" },
    { Icon: Wand2, color: "oklch(0.68 0.19 285)",
      title: "ComfyUI 工作流 · AI 辅助分析导入", desc: "粘贴任意 ComfyUI 工作流 JSON，勾选「AI 辅助分析」用本机 Claude + ComfyUI MCP 查真实节点 schema，自动纠正参数类型/正负、按主次排序（提示词/尺寸/主模型/步数排前）；不开 AI 也有启发式主次分明，失败自动回退",
      badge: "NEW" },
    { Icon: Sparkles, color: "oklch(0.72 0.16 200)",
      title: "本机 Claude / GPT 桥接", desc: "用你的 Claude / ChatGPT 订阅额度跑画布 AI，不按 token 计费；后台「桥接 MCP 配置」贴一段 JSON 即可让本机 Claude 调 ComfyUI 等 MCP 工具集；转写（AI 剪辑/字幕）可指 OpenAI / Groq 免费额度 / 自建 whisper",
      badge: "NEW" },
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(8px)",
        backgroundColor: "oklch(0.05 0.007 260 / 0.7)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: 660,
          maxWidth: "100%",
          maxHeight: "92vh",
          backgroundColor: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px oklch(0 0 0 / 0.6)",
          overflow: "hidden",
        }}
      >
        {/* ── Hero banner ────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            padding: "20px 24px 24px",
            background: "linear-gradient(135deg, oklch(0.12 0.025 285) 0%, oklch(0.08 0.012 285) 100%)",
            borderBottom: "1px solid var(--c-bd2)",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {/* Decorative glow */}
          <div
            style={{
              position: "absolute", top: -80, right: -80, width: 240, height: 240,
              borderRadius: "50%", pointerEvents: "none",
              background: "radial-gradient(circle, oklch(0.68 0.22 285 / 0.25) 0%, transparent 70%)",
            }}
          />
          {/* Close button */}
          <button
            onClick={handleDismiss}
            aria-label="关闭"
            style={{
              position: "absolute", top: 12, right: 12, zIndex: 2,
              width: 28, height: 28, borderRadius: 6, border: "none",
              // Hero banner is dark in every theme → keep the X light (var(--c-t3)
              // would turn near-black & vanish in light theme).
              background: "transparent", color: "oklch(0.72 0.02 285)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-overlay)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <X size={16} />
          </button>

          <div style={{ position: "relative", display: "flex", gap: 14, alignItems: "flex-start" }}>
            {/* Brand logo */}
            <div
              style={{
                width: 56, height: 56, borderRadius: 12, flexShrink: 0, overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 6px 20px oklch(0.68 0.22 285 / 0.4)",
              }}
            >
              <img src="/chat-icon.svg" alt="KingTai" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>

            {/* Title block */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "oklch(0.97 0.01 285)", letterSpacing: "-0.01em" }}>
                  AI 视频画布
                </h1>
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 6,
                    fontSize: 11, fontWeight: 600,
                    background: "oklch(0.68 0.22 285 / 0.18)",
                    color: "oklch(0.82 0.16 285)",
                    border: "1px solid oklch(0.68 0.22 285 / 0.35)",
                  }}
                >
                  <Sparkles size={11} />
                  v1.0 · 全新发布
                </span>
              </div>
              <div style={{ fontSize: 12, color: "oklch(0.70 0.02 285)", marginBottom: 10 }}>
                专业 · AI 影视创作工作流 · 由 金泰智算（KingTai Smart）出品
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "oklch(0.86 0.015 285)" }}>
                支持 <Hl>23+ 种专业节点</Hl>、覆盖<Hl>脚本创作</Hl>、<Hl>AI 图像生成</Hl>、
                <Hl>视频任务</Hl>、<Hl>智能剪辑</Hl> 全流程，全新集成{" "}
                <Hl strong>ComfyUI 自建服务器</Hl> 与{" "}
                <Hl strong>多模型并行对比</Hl> 正式上线。
              </p>
            </div>
          </div>
        </div>

        {/* ── 8 core tools grid ──────────────────────────────────────── */}
        <div
          style={{
            flex: 1, overflowY: "auto",
            padding: "18px 24px 16px",
            display: "flex", flexDirection: "column", gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--c-t3)" }}>
            核心功能 · <span style={{ color: "var(--c-t2)", fontWeight: 600 }}>{features.length} 大工具</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {features.map((f) => (
              <div
                key={f.title}
                style={{
                  position: "relative",
                  padding: "12px 14px",
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-bd1)",
                  borderRadius: 10,
                  transition: "border-color 150ms ease, background 150ms ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = `${f.color}50`;
                  (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd1)";
                  (e.currentTarget as HTMLElement).style.background = "var(--c-surface)";
                }}
              >
                {f.badge && (
                  <span
                    style={{
                      position: "absolute", top: 10, right: 10,
                      padding: "1px 6px", borderRadius: 4,
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                      background: `${f.color}26`,
                      color: f.color,
                      border: `1px solid ${f.color}48`,
                    }}
                  >
                    {f.badge}
                  </span>
                )}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                      background: `${f.color}18`,
                      border: `1px solid ${f.color}32`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <f.Icon size={16} color={f.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t1)", marginBottom: 3 }}>
                      {f.title}
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.55, color: "var(--c-t4)" }}>
                      {f.desc}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Copyright block (style from reference image 2) ────────── */}
          <div
            style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              padding: "12px 14px",
              background: "oklch(0.65 0.20 160 / 0.06)",
              border: "1px solid oklch(0.65 0.20 160 / 0.30)",
              borderRadius: 10,
              marginTop: 6,
            }}
          >
            <Shield size={16} color="oklch(0.70 0.18 160)" style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.7, color: "var(--c-t3)" }}>
              <span style={{ color: "oklch(0.58 0.15 160)", fontWeight: 700 }}>
                © 金泰智算（KingTai Smart）
              </span>{" "}
              版权所有。本工具由 金泰智算 自主研发，所有模板、预设库及界面设计均受版权保护。
              未经授权，禁止复制或商业使用。
            </p>
          </div>
        </div>

        {/* ── Footer: checkbox + dual buttons ────────────────────────── */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 24px",
            borderTop: "1px solid var(--c-bd2)",
            background: "var(--c-base)",
            flexShrink: 0,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12, color: "var(--c-t3)", cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              style={{ cursor: "pointer", accentColor: "oklch(0.68 0.22 285)" }}
            />
            不再显示此欢迎页
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleDismiss}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "8px 14px", borderRadius: 8,
                background: "var(--c-surface)",
                border: "1px solid var(--c-bd2)",
                color: "var(--c-t2)",
                fontSize: 13, fontWeight: 500,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
            >
              查看新功能
              <ArrowRight size={12} />
            </button>
            <button
              onClick={handleDismiss}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 18px", borderRadius: 8,
                background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                border: "none",
                color: "white",
                fontSize: 13, fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 0 0 1px oklch(0.68 0.22 285 / 0.4), 0 4px 16px oklch(0.68 0.22 285 / 0.3)",
              }}
            >
              <Sparkles size={13} />
              开始创作
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline highlight for hero text — orange for plain, purple-strong for big features
function Hl({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span
      style={{
        color: strong ? "oklch(0.82 0.16 285)" : "oklch(0.80 0.18 65)",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

export function ConnectionHintsPanel({
  visible,
  selectedNodeType,
  onClose,
}: {
  visible: boolean;
  selectedNodeType: NodeType | null;
  onClose: () => void;
}) {
  const hints = selectedNodeType ? CONNECTION_HINTS[selectedNodeType] : null;
  const compatibleTargets = selectedNodeType
    ? getCompatibleTargets(selectedNodeType)
    : [];
  const compatibleSources = selectedNodeType
    ? getCompatibleSources(selectedNodeType)
    : [];

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 8,
        width: 240,
        zIndex: 100,
        transform: visible ? "translateX(0)" : "translateX(260px)",
        transition: "transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
        backgroundColor: "color-mix(in oklch, var(--c-base) 97%, transparent)",
        border: "1px solid var(--c-bd2)",
        borderRadius: 10,
        backdropFilter: "blur(12px)",
        overflow: "hidden",
        boxShadow: "0 8px 32px oklch(0 0 0 / 0.5)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--c-bd2)",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--c-t1)",
          }}
        >
          连线指引
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--c-t3)",
            display: "flex",
            alignItems: "center",
            padding: 2,
            borderRadius: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div
        style={{
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxHeight: "calc(100vh - 140px)",
          overflowY: "auto",
        }}
      >
        {hints ? (
          <>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: getNodeConfig(selectedNodeType!).color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--c-t1)",
                  }}
                >
                  {hints.label}
                </span>
              </div>

              {compatibleTargets.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--c-t3)",
                      marginBottom: 5,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    → 可输出到
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {compatibleTargets.map((t) => {
                      const cfg = getNodeConfig(t);
                      return (
                        <div
                          key={t}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              backgroundColor: cfg.color,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--c-t2)",
                            }}
                          >
                            {CONNECTION_HINTS[t].label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {compatibleSources.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--c-t3)",
                      marginBottom: 5,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    ← 可接收自
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {compatibleSources.map((s) => {
                      const cfg = getNodeConfig(s);
                      return (
                        <div
                          key={s}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              backgroundColor: cfg.color,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--c-t2)",
                            }}
                          >
                            {CONNECTION_HINTS[s].label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--c-t2)",
                marginBottom: 10,
              }}
            >
              标准工作流
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(
                [
                  "script",
                  "storyboard",
                  "image_gen",
                  "video_task",
                  "clip",
                ] as NodeType[]
              ).map((type, i, arr) => {
                const cfg = getNodeConfig(type);
                return (
                  <div key={type}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          backgroundColor: cfg.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{ fontSize: 12, color: "var(--c-t2)" }}
                      >
                        {CONNECTION_HINTS[type].label}
                      </span>
                    </div>
                    {i < arr.length - 1 && (
                      <div
                        style={{
                          marginLeft: 4,
                          paddingLeft: 0,
                          color: "var(--c-t4)",
                          fontSize: 12,
                          lineHeight: 1,
                          marginTop: 2,
                          marginBottom: 2,
                        }}
                      >
                        ↓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px solid var(--c-bd2)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--c-t3)",
                  marginBottom: 6,
                }}
              >
                辅助流
              </div>
              {(
                [
                  { from: "audio" as NodeType, to: "clip" as NodeType },
                  { from: "character" as NodeType, to: "storyboard" as NodeType },
                ] as { from: NodeType; to: NodeType }[]
              ).map(({ from, to }) => {
                const fromCfg = getNodeConfig(from);
                const toCfg = getNodeConfig(to);
                return (
                  <div
                    key={`${from}-${to}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      marginBottom: 5,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: fromCfg.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ fontSize: 11, color: "var(--c-t2)" }}
                    >
                      {CONNECTION_HINTS[from].label}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--c-t4)" }}>
                      →
                    </span>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: toCfg.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ fontSize: 11, color: "var(--c-t2)" }}
                    >
                      {CONNECTION_HINTS[to].label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div
          style={{
            paddingTop: 10,
            borderTop: "1px solid var(--c-bd2)",
            fontSize: 11,
            color: "var(--c-t3)",
          }}
        >
          拖动节点端点即可连线
        </div>
      </div>
    </div>
  );
}

export function BeginnerGuide({ onShowPanel }: { onShowPanel?: () => void }) {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setShowModal(true);
    }
  }, []);

  if (!showModal) return null;

  return <WelcomeModal onClose={() => setShowModal(false)} />;
}

export { WelcomeModal };
