// ── 一键动态样片（Animatic，#137）─────────────────────────────────────────────
// 用分镜的关键帧图 + 镜头表时长/转场，直接组装成剪辑器 EditorDoc（图片片段 +
// Ken-Burns 关键帧 + 逐切点转场 + 逐镜配音对位），走既有 editor.create →
// save → export 渲染管线出片——不等每镜视频生成、不花视频模型的钱，
// 几分钟内先看到「会动的分镜」（行业前期 animatic 工作流）。
// 纯函数、零副作用；渲染语义完全复用剪辑器（服务端零改动）。

import { EDITOR_DOC_VERSION, type EditorDoc, type Clip, type TransitionType, type TransformKeyframe } from "@shared/editorTypes";

export interface AnimaticShot {
  /** 关键帧图（分镜 payload.imageUrl）——无图的镜应在调用前过滤掉。 */
  imageUrl: string;
  /** 镜头时长（秒）；缺省/非法用 ANIMATIC_DEFAULT_SHOT_SECONDS。 */
  duration?: number | null;
  /** 镜头表原始转场（cut/dissolve/fade/wipe/match-cut），语义为「本镜 → 下一镜」。 */
  transition?: string | null;
  /** 逐镜配音（分镜下游 audio 节点，audioCategory ≠ sfx），与本镜起点对位。 */
  voiceUrl?: string | null;
  /** 配音时长（秒）；缺省按镜长裁。 */
  voiceDuration?: number | null;
}

export const ANIMATIC_DEFAULT_SHOT_SECONDS = 3;
/** 转场时长上限（xfade 会占用前后两镜的重叠区，取镜长的一小部分防吃掉短镜）。 */
const TRANSITION_MAX_SECONDS = 0.4;

/** 镜头表 transition → EditorDoc TransitionType。口径与装配端 mapShotTransition 一致
 *  （cut / match-cut / 未设 = 硬切），wipe 落到 xfade 的 wipeleft。 */
export function mapAnimaticTransition(t: string | null | undefined): TransitionType {
  if (t === "fade") return "fade";
  if (t === "dissolve") return "dissolve";
  if (t === "wipe") return "wipeleft";
  return "none";
}

/** Ken-Burns 关键帧：偶数镜缓慢推近（scale 1→1.08）、奇数镜拉远，全程 smoothstep
 *  缓入缓出——静态图有了呼吸感，不再是 PPT。只缩放不平移（cover 铺满下平移易露边）。 */
export function kenBurnsKeyframes(index: number, seconds: number): TransformKeyframe[] {
  const zoomIn = index % 2 === 0;
  const far = 1, near = 1.08;
  return [
    { t: 0, scale: zoomIn ? far : near, ease: "inout" },
    { t: Math.max(0.1, seconds), scale: zoomIn ? near : far },
  ];
}

/** 单镜有效秒数（1..30 夹取，非法回默认）。 */
export function animaticShotSeconds(d: number | null | undefined): number {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 0) return ANIMATIC_DEFAULT_SHOT_SECONDS;
  return Math.min(30, Math.max(1, n));
}

export interface AnimaticDocOptions {
  width?: number;   // default 1280
  height?: number;  // default 720
  fps?: number;     // default 30
  /** 关闭 Ken-Burns（纯静帧样片）。默认开启。 */
  kenBurns?: boolean;
}

/** 把镜头序列组装成可直接渲染的 EditorDoc：视频轨图片片段首尾相接（image 片段
 *  trimOut = 显示秒数的时长编码），非首镜按镜头表设 transitionIn；配音落音频轨
 *  与镜起点对位（超镜长裁断，防串到下一镜）。 */
export function buildAnimaticDoc(shots: AnimaticShot[], opts: AnimaticDocOptions = {}): EditorDoc {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const fps = opts.fps ?? 30;
  const ken = opts.kenBurns !== false;

  const videoClips: Clip[] = [];
  const audioClips: Clip[] = [];
  let cursor = 0;
  shots.forEach((s, i) => {
    const sec = animaticShotSeconds(s.duration);
    const prevSec = i > 0 ? animaticShotSeconds(shots[i - 1].duration) : 0;
    const tType = i > 0 ? mapAnimaticTransition(shots[i - 1].transition) : "none";
    const tDur = Math.min(TRANSITION_MAX_SECONDS, prevSec * 0.45, sec * 0.45);
    videoClips.push({
      id: `anim_v${i}`,
      kind: "image",
      assetUrl: s.imageUrl,
      start: cursor,
      trimIn: 0,
      trimOut: sec, // image 片段：trimOut = 显示时长（时长编码，与剪辑器一致）
      fit: "cover",
      ...(ken ? { keyframes: kenBurnsKeyframes(i, sec) } : {}),
      ...(tType !== "none" && tDur >= 0.1 ? { transitionIn: { type: tType, duration: Number(tDur.toFixed(2)) } } : {}),
    });
    if (s.voiceUrl) {
      const vDur = Number(s.voiceDuration);
      const cut = Number.isFinite(vDur) && vDur > 0 ? Math.min(vDur, sec) : sec;
      audioClips.push({
        id: `anim_a${i}`,
        kind: "audio",
        assetUrl: s.voiceUrl,
        start: cursor,
        trimIn: 0,
        trimOut: Number(cut.toFixed(3)),
        volume: 1,
      });
    }
    cursor += sec;
  });

  return {
    version: EDITOR_DOC_VERSION,
    width,
    height,
    fps,
    tracks: [
      { id: "v1", type: "video", clips: videoClips },
      { id: "a1", type: "audio", clips: audioClips },
    ],
  };
}

/** 样片总时长（秒）。 */
export function animaticTotalSeconds(shots: AnimaticShot[]): number {
  return shots.reduce((s, x) => s + animaticShotSeconds(x.duration), 0);
}
