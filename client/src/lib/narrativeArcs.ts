// 叙事弧线库 — 把 30+ 单点运镜模板编排成"经典叙事弧线"
//
// 每个 NarrativeArc 是一串 NarrativeBeat（节拍），每个 beat 引用
// cinematographyTemplates.ts 里的 templateId。把一个弧线应用到一组分镜
// 节点时：
//   - 如果 scenes 数 == beats 数 → 一一对应
//   - 如果 scenes < beats → 按比例采样 beats（保头/腰/尾）
//   - 如果 scenes > beats → 把 beats 等分摊到 scenes（前 N 个分镜用第一拍…）
//
// 这是运镜模板库的"叙事编排器"上层 — 用户不再需要逐个分镜挑模板，
// 而是用"三幕剧 / 英雄之旅 / 短视频钩子"等高层叙事结构一键展开。

import { getTemplateById, type CinematographyTemplate } from "./cinematographyTemplates";

export interface NarrativeBeat {
  /** Human-readable label for this beat ("开场" / "推进" / "高潮"). */
  label: string;
  /** Cinematography template ID this beat applies. Must exist in
   * cinematographyTemplates.ts CINEMATOGRAPHY_TEMPLATES. */
  templateId: string;
  /** Optional: why this beat uses this camera move (storytelling intent). */
  rationale?: string;
}

export interface NarrativeArc {
  id: string;
  label: string;
  englishLabel: string;
  emoji: string;
  category: "classic" | "modern" | "genre" | "short_form";
  description: string;
  beats: NarrativeBeat[];
  /** Recommended scene count range [min, max]. Used by UI to warn
   * "this arc fits 3-6 scenes; you have 12 — beats will be stretched". */
  recommendedSceneCount: [number, number];
}

export const NARRATIVE_ARCS: NarrativeArc[] = [
  // ── 经典 (Classic) ─────────────────────────────────────────────
  {
    id: "three_act",
    label: "三幕剧",
    englishLabel: "Three Act Structure",
    emoji: "🎭",
    category: "classic",
    description: "古典叙事：建立 → 冲突 → 解决。适合大多数剧情片段。",
    beats: [
      { label: "建立世界",   templateId: "static_locked", rationale: "静止全景介绍环境" },
      { label: "引入主角",   templateId: "dolly_in",      rationale: "缓推靠近主体引发关注" },
      { label: "冲突浮现",   templateId: "dutch_angle",   rationale: "倾斜构图制造不安" },
      { label: "对抗升级",   templateId: "snap_zoom_in",  rationale: "急推强化紧张" },
      { label: "解决回归",   templateId: "crane_up",      rationale: "拉远展示新平衡" },
    ],
    recommendedSceneCount: [4, 8],
  },
  {
    id: "hero_journey",
    label: "英雄之旅",
    englishLabel: "Hero's Journey",
    emoji: "🌟",
    category: "classic",
    description: "Joseph Campbell 经典叙事弧：从普通世界到归来。",
    beats: [
      { label: "平凡世界",   templateId: "static_locked",   rationale: "锁定静止，强调日常" },
      { label: "冒险召唤",   templateId: "tilt_up",         rationale: "上倾揭示远方目标" },
      { label: "门槛跨越",   templateId: "tracking_shot",   rationale: "跟拍主角踏上征程" },
      { label: "试炼与伙伴", templateId: "ots_shot",        rationale: "越肩拍摄对峙互动" },
      { label: "深渊磨难",   templateId: "dolly_zoom",      rationale: "希区柯克变焦表心理崩塌" },
      { label: "宝藏获得",   templateId: "push_to_face",    rationale: "脸部特写收束情绪" },
      { label: "归来世界",   templateId: "crane_up",        rationale: "拉远升起回到日常视角" },
    ],
    recommendedSceneCount: [5, 12],
  },

  // ── 现代叙事 (Modern) ──────────────────────────────────────────
  {
    id: "suspense",
    label: "悬疑递增",
    englishLabel: "Suspense Build",
    emoji: "🔍",
    category: "modern",
    description: "从平静日常逐步揭示真相，张力线性上升。",
    beats: [
      { label: "平静日常",   templateId: "static_locked",  rationale: "无害静态构图" },
      { label: "细微异常",   templateId: "tilt_down",      rationale: "下倾发现线索" },
      { label: "怀疑滋生",   templateId: "dutch_angle",    rationale: "倾斜暗示心理失衡" },
      { label: "追寻真相",   templateId: "tracking_shot",  rationale: "跟拍调查过程" },
      { label: "真相揭示",   templateId: "dolly_zoom",     rationale: "变焦冲击揭示" },
      { label: "余韵静止",   templateId: "static_locked",  rationale: "锁定让观众消化" },
    ],
    recommendedSceneCount: [4, 10],
  },
  {
    id: "lyrical",
    label: "文艺抒情",
    englishLabel: "Lyrical / Poetic",
    emoji: "🌿",
    category: "modern",
    description: "缓慢长镜头，情绪铺垫为主，无强烈冲突。",
    beats: [
      { label: "氛围建立", templateId: "static_locked",   rationale: "无人静景" },
      { label: "缓慢进入", templateId: "dolly_in",        rationale: "极慢推镜" },
      { label: "情感酝酿", templateId: "push_to_face",    rationale: "面部特写承载情绪" },
      { label: "环境呼应", templateId: "tilt_up",         rationale: "上倾向自然" },
      { label: "意境收束", templateId: "crane_up",        rationale: "缓拉留余韵" },
    ],
    recommendedSceneCount: [3, 8],
  },

  // ── 类型片 (Genre) ─────────────────────────────────────────────
  {
    id: "action",
    label: "动作片节奏",
    englishLabel: "Action Sequence",
    emoji: "💥",
    category: "genre",
    description: "快剪 + 多视角切换，节奏紧凑。",
    beats: [
      { label: "对峙",     templateId: "ots_shot",      rationale: "越肩对峙构图" },
      { label: "出击",     templateId: "snap_zoom_in",  rationale: "急推爆发起势" },
      { label: "追逐",     templateId: "tracking_shot", rationale: "跟拍追逐" },
      { label: "高潮交锋", templateId: "orbit_360",     rationale: "环绕展示动作全貌" },
      { label: "决胜",     templateId: "dolly_zoom",    rationale: "变焦制造瞬间永恒" },
      { label: "胜利仰望", templateId: "crane_up",      rationale: "升起仰望英雄" },
    ],
    recommendedSceneCount: [5, 10],
  },
  {
    id: "horror",
    label: "恐怖片心理",
    englishLabel: "Horror Pacing",
    emoji: "👻",
    category: "genre",
    description: "心理压迫递增，Jumpscare 节奏。",
    beats: [
      { label: "平静日常",   templateId: "static_locked",  rationale: "无害到极致的静止" },
      { label: "异常感知",   templateId: "dutch_angle",    rationale: "倾斜不安" },
      { label: "心理崩溃",   templateId: "dolly_zoom",     rationale: "希区柯克变焦经典恐怖" },
      { label: "Jumpscare", templateId: "snap_zoom_in",   rationale: "急推突袭" },
      { label: "余韵",       templateId: "crane_down",     rationale: "下降留压抑" },
    ],
    recommendedSceneCount: [4, 8],
  },
  {
    id: "comedy",
    label: "喜剧节拍",
    englishLabel: "Comedy Beat",
    emoji: "😄",
    category: "genre",
    description: "Setup → Punchline → 余兴。",
    beats: [
      { label: "Setup",     templateId: "static_locked",  rationale: "平淡铺垫" },
      { label: "误会上扬", templateId: "tilt_up",        rationale: "上倾引导期待" },
      { label: "Punchline", templateId: "snap_zoom_in",  rationale: "急推暴露包袱" },
      { label: "余兴笑场", templateId: "static_locked",  rationale: "锁定让观众笑" },
    ],
    recommendedSceneCount: [3, 6],
  },
  {
    id: "epic",
    label: "史诗叙事",
    englishLabel: "Epic Scale",
    emoji: "⚔️",
    category: "genre",
    description: "宏大场景 + 缓推升降。",
    beats: [
      { label: "宏大开场", templateId: "birds_eye",     rationale: "鸟瞰天地" },
      { label: "切入主角", templateId: "drone_spiral",  rationale: "无人机盘旋逼近" },
      { label: "征程",     templateId: "tracking_shot", rationale: "跟拍长征" },
      { label: "终极对决", templateId: "orbit_360",     rationale: "环绕展开战场" },
      { label: "史诗结尾", templateId: "crane_up",      rationale: "升起留下传奇感" },
    ],
    recommendedSceneCount: [5, 10],
  },

  // ── 短视频 (Short Form) ────────────────────────────────────────
  {
    id: "tiktok_hook",
    label: "短视频钩子",
    englishLabel: "TikTok / Reels Hook",
    emoji: "📱",
    category: "short_form",
    description: "3 秒钩子 → 展开 → 反转 → 落点。适合 15-30s 竖屏短片。",
    beats: [
      { label: "钩子（3秒）", templateId: "snap_zoom_in",   rationale: "急推抓眼球" },
      { label: "展开",         templateId: "tracking_shot",  rationale: "跟拍承接节奏" },
      { label: "反转",         templateId: "whip_pan",       rationale: "急摇切场" },
      { label: "落点梗",       templateId: "static_locked",  rationale: "锁定收尾" },
    ],
    recommendedSceneCount: [3, 5],
  },
  {
    id: "wes_anderson_arc",
    label: "Wes Anderson 风",
    englishLabel: "Wes Anderson Symmetry",
    emoji: "🎨",
    category: "short_form",
    description: "对称构图 + 横向平移，糖果色调的风格化叙事。",
    beats: [
      { label: "对称开场", templateId: "wes_anderson", rationale: "对称居中" },
      { label: "横向平移", templateId: "pan_right",    rationale: "标志性 pan" },
      { label: "对称回应", templateId: "wes_anderson", rationale: "对称镜像" },
      { label: "对称收尾", templateId: "wes_anderson", rationale: "对称定格" },
    ],
    recommendedSceneCount: [3, 6],
  },
];

export const NARRATIVE_ARC_CATEGORIES: Array<{
  id: NarrativeArc["category"];
  label: string;
}> = [
  { id: "classic", label: "经典叙事" },
  { id: "modern", label: "现代叙事" },
  { id: "genre", label: "类型片" },
  { id: "short_form", label: "短视频" },
];

// ── Helpers ───────────────────────────────────────────────────────

/** Find an arc by ID. */
export function getArcById(id: string): NarrativeArc | undefined {
  return NARRATIVE_ARCS.find((a) => a.id === id);
}

/** Resolve every beat's templateId to the actual CinematographyTemplate.
 * Returns null entries when an ID is stale (e.g. template was renamed) so
 * UI can flag the gap rather than crash. */
export function resolveBeats(arc: NarrativeArc): Array<{
  beat: NarrativeBeat;
  template: CinematographyTemplate | null;
}> {
  return arc.beats.map((beat) => ({
    beat,
    template: getTemplateById(beat.templateId) ?? null,
  }));
}

/**
 * Map an arc's beats onto an ordered list of scene IDs (storyboard nodes).
 * Returns one assignment per scene, distributing beats across scenes so
 * every scene gets exactly one beat:
 *
 *   - scenes.length === beats.length → 1:1 mapping
 *   - scenes.length < beats.length   → sample beats at evenly-spaced
 *     positions (e.g. 4 scenes from 7-beat arc picks positions
 *     0, 2, 4, 6 — keeps head & tail beats)
 *   - scenes.length > beats.length   → spread beats: floor(i * B / N) so
 *     consecutive scenes share a beat (e.g. 6 scenes from 4-beat arc:
 *     [0,0,1,2,2,3])
 *
 * If sceneIds is empty, returns []. If the arc has zero beats (defensive),
 * returns sceneIds mapped to a no-op beat (skipped by callers).
 */
export function mapArcToScenes(
  arc: NarrativeArc,
  sceneIds: string[],
): Array<{ sceneId: string; beat: NarrativeBeat; beatIndex: number }> {
  if (sceneIds.length === 0 || arc.beats.length === 0) return [];
  const result: Array<{ sceneId: string; beat: NarrativeBeat; beatIndex: number }> = [];
  const N = sceneIds.length;
  const B = arc.beats.length;
  for (let i = 0; i < N; i++) {
    // floor((i * B) / N) gives the standard "stretch B beats over N slots"
    // — works correctly in both N<B and N>B directions.
    const bi = Math.min(Math.floor((i * B) / N), B - 1);
    result.push({ sceneId: sceneIds[i], beat: arc.beats[bi], beatIndex: bi });
  }
  return result;
}

/**
 * Sort storyboard scene IDs by their sceneNumber field. Returns a sorted
 * copy. sceneNumber accepts number OR string (e.g. "S1-A", "开场"); we
 * use a comparator that:
 *
 *   1. Numeric values come first, in ascending order
 *   2. Numeric-prefix strings ("S1-A", "S2") come next, sorted by the
 *      leading number then lexically (so S1, S1-A, S2)
 *   3. Pure-string values ("开场", "插曲") come last, sorted lexically
 *   4. Missing/undefined sceneNumber falls back to the node's array
 *      position in the original input (so user-arranged order is
 *      preserved as last resort)
 *
 * Stability: equal sceneNumbers preserve original input order.
 */
export function sortStoryboardsBySceneNumber<T extends { id: string; sceneNumber?: number | string }>(
  scenes: T[],
): T[] {
  const indexed = scenes.map((s, idx) => ({ s, idx }));
  indexed.sort((a, b) => {
    const ra = rankSceneNumber(a.s.sceneNumber);
    const rb = rankSceneNumber(b.s.sceneNumber);
    if (ra.bucket !== rb.bucket) return ra.bucket - rb.bucket;
    if (ra.bucket === 0) return ra.num! - rb.num!;
    if (ra.bucket === 1) {
      if (ra.num !== rb.num) return ra.num! - rb.num!;
      return ra.str!.localeCompare(rb.str!);
    }
    if (ra.bucket === 2) return ra.str!.localeCompare(rb.str!);
    // bucket 3 (no value) — preserve original order
    return a.idx - b.idx;
  });
  return indexed.map((x) => x.s);
}

interface SceneRank {
  bucket: 0 | 1 | 2 | 3;  // 0=pure number, 1=numeric prefix, 2=string, 3=missing
  num?: number;
  str?: string;
}
function rankSceneNumber(v: number | string | undefined): SceneRank {
  if (v === undefined || v === null || v === "") return { bucket: 3 };
  if (typeof v === "number" && Number.isFinite(v)) return { bucket: 0, num: v };
  const s = String(v).trim();
  if (s.length === 0) return { bucket: 3 };
  const asNum = Number(s);
  if (Number.isFinite(asNum) && /^-?\d+(?:\.\d+)?$/.test(s)) return { bucket: 0, num: asNum };
  const prefix = s.match(/^(\d+)/);
  if (prefix) return { bucket: 1, num: Number(prefix[1]), str: s };
  return { bucket: 2, str: s };
}
