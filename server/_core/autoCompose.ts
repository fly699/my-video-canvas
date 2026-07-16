// D1 AI 一键成片核心。纯函数、无 IO：把「素材清单 + LLM 产出的成片方案」映射成 EditorDoc
// （主轨按方案排片/截取、转场、可选标题字幕、可选背景乐+自动闪避、可选整体调色），
// 供 editor.autoCompose 落地（applyDoc 可撤销）。方案解析复用 aiCut 的平衡花括号扫描思路。
import { emptyEditorDoc, type EditorDoc, type Clip } from "@shared/editorTypes";
import { SUBTITLE_TRANSFORM } from "./aiCut";

export interface ComposeAsset {
  url: string;
  kind: "video" | "image" | "audio";
  name: string;
  durationSec?: number; // 客户端 probe 到的素材时长（图片无）
  assetId?: number;
}

export interface AutoComposePlan {
  clips: { asset: number; trimIn?: number; trimOut?: number; durationSec?: number; transition?: string }[];
  texts?: { content: string; at: number; durationSec?: number; role?: string }[];
  bgm?: number;
  grade?: string;
}

// 转场白名单（与 PropertiesPanel/导出 xfade 支持的档位一致；不在表内的静默丢弃）。
const TRANSITIONS = new Set([
  "fade", "fadeblack", "fadewhite", "dissolve", "fadegrays", "hblur",
  "wipeleft", "wiperight", "wipeup", "wipedown",
  "slideleft", "slideright", "slideup", "slidedown", "smoothleft", "smoothright",
  "circleopen", "circleclose", "circlecrop", "rectcrop", "radial", "pixelize", "zoomin",
  "diagtl", "diagbr", "hlslice", "squeezeh", "squeezev",
]);
const GRADES = new Set(["subtle", "neutral_punch", "warm_cinematic", "cinematic", "teal_orange", "vivid", "none"]);

const MAX_CLIPS = 60;
const MAX_TEXTS = 12;
const MAX_TOTAL_SEC = 1800;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** 从 LLM 输出抠成片方案：扫描所有平衡花括号对，取第一个 clips 为数组的对象（同 aiCut
 *  的抗诱饵策略——不被解释文字里的 "clips" 字面量骗走）。失败返回 null。 */
export function parseAutoComposePlan(text: string): AutoComposePlan | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const o = JSON.parse(text.slice(i, j + 1)) as unknown;
            if (o && typeof o === "object" && Array.isArray((o as Record<string, unknown>).clips)) {
              return normalizePlan(o as Record<string, unknown>);
            }
          } catch { /* 非法对象——继续扫下一个 { */ }
          i = j;
          break;
        }
      }
    }
  }
  return null;
}

function normalizePlan(rec: Record<string, unknown>): AutoComposePlan {
  const clips = (rec.clips as unknown[])
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const r = c as Record<string, unknown>;
      const asset = Number(r.asset);
      if (!Number.isInteger(asset) || asset < 0) return null;
      const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
      return {
        asset,
        trimIn: num(r.trimIn),
        trimOut: num(r.trimOut),
        durationSec: num(r.durationSec),
        transition: typeof r.transition === "string" ? r.transition : undefined,
      };
    })
    .filter((c): c is NonNullable<typeof c> => !!c);
  const texts = (Array.isArray(rec.texts) ? rec.texts : [])
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const r = t as Record<string, unknown>;
      const content = String(r.content ?? "").trim().slice(0, 60);
      const at = Number(r.at);
      if (!content || !Number.isFinite(at)) return null;
      return { content, at: Math.max(0, at), durationSec: Number.isFinite(Number(r.durationSec)) ? Number(r.durationSec) : undefined, role: typeof r.role === "string" ? r.role : undefined };
    })
    .filter((t): t is NonNullable<typeof t> => !!t);
  const bgm = Number.isInteger(Number(rec.bgm)) && Number(rec.bgm) >= 0 ? Number(rec.bgm) : undefined;
  const grade = typeof rec.grade === "string" && GRADES.has(rec.grade) ? rec.grade : undefined;
  return { clips, texts, bgm, grade };
}

/** 核心组装：方案 → EditorDoc。所有越界/非法项静默丢弃或夹取——LLM 给什么都不至于产出
 *  非法时间轴。返回 doc + 统计。 */
export function buildAutoComposeDoc(
  assets: ComposeAsset[],
  plan: AutoComposePlan,
  opts: { width: number; height: number; fps: number },
): { doc: EditorDoc; stats: { clips: number; totalSec: number; texts: number; hasBgm: boolean } } {
  const doc = emptyEditorDoc(opts.width, opts.height, opts.fps);
  doc.normalizeAudio = true;
  const vTrack = doc.tracks.find((t) => t.type === "video")!;
  const tTrack = doc.tracks.find((t) => t.type === "text")!;
  const aTrack = doc.tracks.find((t) => t.type === "audio")!;
  const useGrade = plan.grade && plan.grade !== "none" ? plan.grade : undefined;

  let outT = 0;
  for (const pc of plan.clips) {
    if (vTrack.clips.length >= MAX_CLIPS || outT >= MAX_TOTAL_SEC) break;
    const a = assets[pc.asset];
    if (!a || (a.kind !== "video" && a.kind !== "image")) continue; // 音频/越界索引不进主轨
    let trimIn = 0, trimOut = 0;
    if (a.kind === "video") {
      const srcDur = a.durationSec && a.durationSec > 0 ? a.durationSec : 3600;
      trimIn = Math.max(0, Math.min(pc.trimIn ?? 0, srcDur));
      trimOut = Math.max(0, Math.min(pc.trimOut ?? srcDur, srcDur));
      if (trimOut - trimIn < 0.5) { trimIn = 0; trimOut = Math.min(srcDur, Math.max(0.5, trimOut - trimIn) || srcDur); }
      if (trimOut - trimIn > 120) trimOut = trimIn + 120; // 单段上限，防整条长视频原样塞入
    } else {
      // 图片：duration 编码在 trimOut（与剪辑器约定一致），默认 3s、夹到 [1,10]
      trimIn = 0;
      trimOut = Math.max(1, Math.min(pc.durationSec ?? 3, 10));
    }
    const dur = trimOut - trimIn;
    if (dur <= 0.05) continue;
    const transition = vTrack.clips.length > 0 && pc.transition && TRANSITIONS.has(pc.transition)
      ? { type: pc.transition as never, duration: Math.max(0.2, Math.min(1, dur / 3, 0.5)) }
      : undefined;
    const clip: Clip = {
      id: `ac-v-${vTrack.clips.length}`, kind: a.kind,
      ...(a.assetId != null ? { assetId: a.assetId } : {}),
      assetUrl: a.url,
      start: round3(outT), trimIn: round3(trimIn), trimOut: round3(trimOut),
      fit: "cover",
      ...(transition ? { transitionIn: transition } : {}),
      ...(useGrade ? { effects: { filter: useGrade } } : {}),
    };
    vTrack.clips.push(clip);
    outT += dur;
  }
  const totalSec = round3(outT);

  // 文字（标题/收尾字幕）：at/时长夹到成片范围内
  for (const tx of (plan.texts ?? []).slice(0, MAX_TEXTS)) {
    if (totalSec <= 0) break;
    const at = Math.min(tx.at, Math.max(0, totalSec - 0.5));
    const dur = Math.max(0.5, Math.min(tx.durationSec ?? 3, 10, totalSec - at));
    const isTitle = tx.role === "title";
    const fontSize = Math.max(24, Math.round(opts.height * (isTitle ? 0.07 : 0.045)));
    tTrack.clips.push({
      id: `ac-t-${tTrack.clips.length}`, kind: "text",
      start: round3(at), trimIn: 0, trimOut: round3(dur),
      transform: isTitle ? { x: 0.1, y: 0.4, scale: 0.8 } : { ...SUBTITLE_TRANSFORM },
      text: { content: tx.content, size: fontSize, color: "#ffffff", strokeColor: "#000000", strokeWidth: Math.max(2, Math.round(fontSize / 16)), align: "center", motionStyle: isTitle ? "fade" : "none" },
    });
  }

  // 背景乐：选中的音频素材铺满成片（自动闪避人声 + 结尾 1s 淡出），过长在导出被 -shortest 裁齐
  let hasBgm = false;
  const bgmAsset = plan.bgm != null ? assets[plan.bgm] : undefined;
  if (bgmAsset && bgmAsset.kind === "audio" && totalSec > 0) {
    const srcDur = bgmAsset.durationSec && bgmAsset.durationSec > 0 ? bgmAsset.durationSec : totalSec;
    aTrack.clips.push({
      id: "ac-bgm", kind: "audio",
      ...(bgmAsset.assetId != null ? { assetId: bgmAsset.assetId } : {}),
      assetUrl: bgmAsset.url,
      start: 0, trimIn: 0, trimOut: round3(Math.min(srcDur, totalSec)),
      volume: 0.9, ducking: true, fadeOut: Math.min(1, totalSec / 4), fadeCurve: "qsin",
    });
    hasBgm = true;
  }

  return { doc, stats: { clips: vTrack.clips.length, totalSec, texts: tTrack.clips.length, hasBgm } };
}
