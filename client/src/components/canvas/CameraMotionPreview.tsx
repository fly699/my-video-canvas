import { useEffect } from "react";

/**
 * #135 运镜动画预览（对齐 LibTV 运镜库的动图卡）：纯 CSS 三层小场景
 * （天空渐变 + 建筑剪影 + 人物剪影），按运镜类型对场景/背景层施加 transform
 * 循环动画——零外部素材、零带宽，缩放不糊；`prefers-reduced-motion` 自动静止。
 * 场景层尺寸 140% 预留移动余量，视窗 overflow hidden 形成「取景框」观感。
 */
export type CamMotion =
  | "push-in" | "pull-out" | "zoom-snap" | "dolly-zoom"
  | "pan-left" | "pan-right" | "whip-pan"
  | "tilt-up" | "tilt-down" | "dutch"
  | "crane-up" | "crane-down" | "birds-eye"
  | "track" | "orbit" | "handheld" | "static";

/** 按模板 id/英文名关键词推断演示动画；未识别时给轻缓推近兜底（比静止更有「运镜感」）。 */
export function inferCamMotion(id: string, english = ""): CamMotion {
  const s = `${id} ${english}`.toLowerCase();
  if (/dolly_zoom|vertigo|hitchcock/.test(s)) return "dolly-zoom";
  if (/snap_zoom|zoom_in|crash/.test(s)) return "zoom-snap";
  if (/dolly_in|push|kubrick|one_point/.test(s)) return "push-in";
  if (/dolly_out|pull/.test(s)) return "pull-out";
  if (/whip/.test(s)) return "whip-pan";
  if (/pan_left/.test(s)) return "pan-left";
  if (/pan_right|fincher|anderson/.test(s)) return "pan-right";
  if (/tilt_up/.test(s)) return "tilt-up";
  if (/tilt_down/.test(s)) return "tilt-down";
  if (/dutch|canted/.test(s)) return "dutch";
  if (/birds_eye|bird|top_down|overhead/.test(s)) return "birds-eye";
  if (/crane_down|descend/.test(s)) return "crane-down";
  if (/crane|rise|imax|aerial/.test(s)) return "crane-up";
  if (/orbit|arc|spiral|around/.test(s)) return "orbit";
  if (/track|follow|walk|trunk|bond|steadicam/.test(s)) return "track";
  if (/pov|handheld|shake|found_footage/.test(s)) return "handheld";
  if (/static|locked|fixed|anamorphic/.test(s)) return "static";
  return "push-in";
}

const STYLE_ID = "cmp-keyframes-v2";
const CSS = `
.cmp-frame{position:relative;overflow:hidden;background:#0b0d13;perspective:520px}
.cmp-scene{position:absolute;left:-20%;top:-20%;width:140%;height:140%;will-change:transform}
.cmp-bg{position:absolute;inset:0;background:
  radial-gradient(circle at 72% 26%, #f7c56d 0 7%, transparent 8%),
  linear-gradient(#2b3550 0%, #4a4667 46%, #8a5a58 62%, #1d2130 62.5%, #171a26 100%)}
.cmp-mid{position:absolute;left:0;right:0;bottom:0;height:62%;background:
  linear-gradient(transparent 0 34%, #12141d 34%) ,
  linear-gradient(90deg, transparent 0 8%, #141826 8% 20%, transparent 20% 30%, #10131e 30% 40%, transparent 40% 58%, #141826 58% 66%, transparent 66% 78%, #10131e 78% 92%, transparent 92%);
  background-size:100% 100%, 100% 58%;background-repeat:no-repeat;background-position:bottom, top}
.cmp-subject{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);width:9%;aspect-ratio:1/2.6}
.cmp-head{width:56%;aspect-ratio:1;border-radius:50%;background:#e8e4da;margin:0 auto}
.cmp-torso{width:100%;height:62%;margin-top:6%;border-radius:38% 38% 30% 30%;background:#d8d2c4}
.cmp-vignette{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 26px 10px rgba(0,0,0,.55)}
.cmp-badge{position:absolute;left:6px;top:5px;font-size:8px;font-weight:700;letter-spacing:.08em;color:rgba(255,255,255,.5);text-transform:uppercase}
@keyframes cmpPushIn{from{transform:scale(1)}to{transform:scale(1.32)}}
@keyframes cmpPullOut{from{transform:scale(1.32)}to{transform:scale(1)}}
@keyframes cmpZoomSnap{0%,55%{transform:scale(1)}70%,100%{transform:scale(1.45)}}
@keyframes cmpPanL{from{transform:translateX(-5%)}to{transform:translateX(7%)}}
@keyframes cmpPanR{from{transform:translateX(7%)}to{transform:translateX(-5%)}}
@keyframes cmpWhip{0%,38%{transform:translateX(6%);filter:blur(0)}46%{filter:blur(3px)}54%,92%{transform:translateX(-6%);filter:blur(0)}100%{transform:translateX(-6%)}}
@keyframes cmpTiltUp{from{transform:translateY(7%)}to{transform:translateY(-8%)}}
@keyframes cmpTiltDown{from{transform:translateY(-8%)}to{transform:translateY(7%)}}
@keyframes cmpDutch{from{transform:rotate(0deg) scale(1.06)}to{transform:rotate(-8deg) scale(1.12)}}
@keyframes cmpCraneUp{from{transform:translateY(6%) scale(1.12)}to{transform:translateY(-9%) scale(1)}}
@keyframes cmpCraneDown{from{transform:translateY(-9%) scale(1)}to{transform:translateY(6%) scale(1.12)}}
@keyframes cmpBirds{from{transform:rotateX(0deg) scale(1.05)}to{transform:rotateX(34deg) scale(1.28)}}
@keyframes cmpTrackBg{from{transform:translateX(0)}to{transform:translateX(-14%)}}
@keyframes cmpBob{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-5%)}}
@keyframes cmpOrbit{from{transform:rotateY(-16deg) scale(1.08)}to{transform:rotateY(16deg) scale(1.08)}}
@keyframes cmpHand{0%{transform:translate(0,0) rotate(0)}18%{transform:translate(1.4%,-.9%) rotate(.5deg)}39%{transform:translate(-1.1%,.7%) rotate(-.6deg)}61%{transform:translate(.8%,1.1%) rotate(.3deg)}83%{transform:translate(-1.3%,-.6%) rotate(-.4deg)}100%{transform:translate(0,0) rotate(0)}}
@keyframes cmpDollyZoomBg{from{transform:scale(1)}to{transform:scale(1.5)}}
.cmp-push-in .cmp-scene{animation:cmpPushIn 2.6s ease-in-out infinite alternate}
.cmp-pull-out .cmp-scene{animation:cmpPullOut 2.6s ease-in-out infinite alternate}
.cmp-zoom-snap .cmp-scene{animation:cmpZoomSnap 1.9s cubic-bezier(.7,0,.3,1) infinite}
.cmp-pan-left .cmp-scene{animation:cmpPanL 3s ease-in-out infinite alternate}
.cmp-pan-right .cmp-scene{animation:cmpPanR 3s ease-in-out infinite alternate}
.cmp-whip-pan .cmp-scene{animation:cmpWhip 2.2s cubic-bezier(.8,0,.2,1) infinite}
.cmp-tilt-up .cmp-scene{animation:cmpTiltUp 2.8s ease-in-out infinite alternate}
.cmp-tilt-down .cmp-scene{animation:cmpTiltDown 2.8s ease-in-out infinite alternate}
.cmp-dutch .cmp-scene{animation:cmpDutch 2.6s ease-in-out infinite alternate}
.cmp-crane-up .cmp-scene{animation:cmpCraneUp 3s ease-in-out infinite alternate}
.cmp-crane-down .cmp-scene{animation:cmpCraneDown 3s ease-in-out infinite alternate}
.cmp-birds-eye .cmp-scene{animation:cmpBirds 3s ease-in-out infinite alternate;transform-origin:50% 68%}
.cmp-track .cmp-bg,.cmp-track .cmp-mid{animation:cmpTrackBg 2.4s linear infinite alternate}
.cmp-track .cmp-subject{animation:cmpBob 0.7s ease-in-out infinite}
.cmp-orbit .cmp-scene{animation:cmpOrbit 3.2s ease-in-out infinite alternate;transform-origin:50% 60%}
.cmp-handheld .cmp-scene{animation:cmpHand 1.6s linear infinite}
.cmp-dolly-zoom .cmp-bg{animation:cmpDollyZoomBg 2.4s ease-in-out infinite alternate;transform-origin:50% 55%}
@keyframes smpBreath{from{transform:scale(1.02)}to{transform:scale(1.09)}}
@keyframes smpGrain{0%{opacity:.14;transform:translate(0,0)}50%{opacity:.22;transform:translate(-2%,1%)}100%{opacity:.14;transform:translate(1%,-2%)}}
.smp-live .cmp-scene{animation:smpBreath 4.5s ease-in-out infinite alternate}
.smp-ov{position:absolute;inset:0;pointer-events:none}
.smp-ov-neon{background:linear-gradient(115deg, rgba(255,0,180,.28), transparent 42%, rgba(0,220,255,.30))}
.smp-ov-vapor{background:linear-gradient(160deg, rgba(255,120,220,.35), rgba(120,90,255,.30))}
.smp-ov-grain{background:repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 1px, transparent 1px 3px),repeating-linear-gradient(90deg, rgba(0,0,0,.05) 0 1px, transparent 1px 2px);animation:smpGrain 0.9s steps(3) infinite}
.smp-ov-dots{background:radial-gradient(rgba(0,0,0,.35) 1px, transparent 1.4px);background-size:6px 6px}
.smp-ov-lines{background:repeating-linear-gradient(45deg, rgba(0,0,0,.16) 0 1px, transparent 1px 4px)}
.smp-ov-letterbox::before,.smp-ov-letterbox::after{content:"";position:absolute;left:0;right:0;height:12%;background:#000}
.smp-ov-letterbox::before{top:0}.smp-ov-letterbox::after{bottom:0}
.smp-ov-flare{background:linear-gradient(90deg, transparent 30%, rgba(80,170,255,.35) 49%, rgba(80,170,255,.5) 50%, rgba(80,170,255,.35) 51%, transparent 70%);mix-blend-mode:screen}
@media (prefers-reduced-motion: reduce){.cmp-frame *{animation:none !important}}
`;

// ── #135 第二批：风格库色彩演示 ──────────────────────────────────────────────
// 同一迷你场景 + 每款风格专属 CSS filter/叠加层 + 轻微「呼吸」推近，让风格卡
// 像 LibTV 一样"活"起来。滤镜按风格语义近似（黑白/胶片/赛博霓虹/水墨/波普网点…）。
const STYLE_FX: Record<string, { filter: string; ov?: string }> = {
  cinematic:     { filter: "contrast(1.15) saturate(1.12)", ov: "letterbox" },
  film_grain:    { filter: "sepia(.35) contrast(1.05) saturate(1.1)", ov: "grain" },
  bw:            { filter: "grayscale(1) contrast(1.35)" },
  low_key:       { filter: "brightness(.55) contrast(1.45)" },
  cyberpunk:     { filter: "hue-rotate(30deg) saturate(1.9) contrast(1.15)", ov: "neon" },
  hk_retro:      { filter: "sepia(.4) hue-rotate(-14deg) saturate(1.55) contrast(1.08)", ov: "grain" },
  golden_hour:   { filter: "sepia(.5) saturate(1.45) brightness(1.12)" },
  high_contrast: { filter: "contrast(1.65) saturate(1.1)" },
  ink_wash:      { filter: "grayscale(1) contrast(.85) brightness(1.3) blur(.4px)" },
  oil:           { filter: "saturate(1.45) contrast(1.12)", ov: "lines" },
  watercolor:    { filter: "saturate(1.25) brightness(1.18) blur(.5px)" },
  anime:         { filter: "saturate(1.75) contrast(1.15) brightness(1.05)" },
  ukiyoe:        { filter: "sepia(.3) saturate(1.35) contrast(1.12)", ov: "lines" },
  pencil:        { filter: "grayscale(1) contrast(1.5) brightness(1.15)", ov: "lines" },
  popart:        { filter: "saturate(2.2) contrast(1.3)", ov: "dots" },
  vaporwave:     { filter: "hue-rotate(300deg) saturate(1.6) brightness(1.08)", ov: "vapor" },
  cg3d:          { filter: "saturate(1.15) contrast(1.12) brightness(1.06)" },
  clay:          { filter: "saturate(1.35) blur(.4px) brightness(1.12)" },
  lowpoly:       { filter: "saturate(1.45) contrast(1.25)" },
  isometric:     { filter: "saturate(1.2) brightness(1.12)" },
  felt:          { filter: "blur(.6px) saturate(1.25) brightness(1.12)" },
  pixar:         { filter: "saturate(1.55) brightness(1.14) contrast(1.05)" },
  ghibli:        { filter: "saturate(1.4) brightness(1.16) sepia(.15)" },
  pixel:         { filter: "contrast(1.35) saturate(1.6)", ov: "dots" },
};

export function StyleSwatchPreview({ styleId, height = 76 }: { styleId: string; height?: number }) {
  useEffect(ensureKeyframes, []);
  const fx = STYLE_FX[styleId] ?? { filter: "saturate(1.2)" };
  return (
    <div className="cmp-frame smp-live" style={{ height, borderRadius: 7 }} aria-hidden data-style-swatch={styleId}>
      <div className="cmp-scene" style={{ filter: fx.filter }}>
        <div className="cmp-bg" />
        <div className="cmp-mid" />
        <div className="cmp-subject"><div className="cmp-head" /><div className="cmp-torso" /></div>
      </div>
      {fx.ov && <div className={`smp-ov smp-ov-${fx.ov}`} />}
      <div className="cmp-vignette" />
    </div>
  );
}

// ── #135 第二批：摄像机实时取景窗 ────────────────────────────────────────────
// 焦距→推拉（视角收窄）、光圈→背景景深虚化（主体独立层保持清晰）、镜头→变形宽银幕
// 眩光/旋焦渐晕、机身→胶片/IMAX 质感。参数即点即变（transition 过渡=天然动画）。
const FOCAL_SCALE: Record<number, number> = { 14: 0.9, 24: 1, 35: 1.12, 50: 1.24, 75: 1.4, 85: 1.48, 135: 1.72 };

export function RigViewfinderPreview({ cam, lens, focal, ap, height = 110 }: {
  cam: string; lens: string; focal: number; ap: string; height?: number;
}) {
  useEffect(ensureKeyframes, []);
  const scale = FOCAL_SCALE[focal] ?? (0.85 + (focal / 135) * 0.8);
  const f = parseFloat(ap) || 4;
  const bgBlur = Math.min(6, 7 / f); // f/1.2≈5.8px 大虚化，f/16≈0.4px 近全清
  const anamorphic = /anamorphic/i.test(lens);
  const dreamy = /lensbaby|helios|cooke/i.test(lens);
  const film = /super 8/i.test(cam);
  const imax = /imax/i.test(cam);
  const camFilter = film ? "sepia(.45) contrast(1.05) saturate(1.15)" : imax ? "contrast(1.18) saturate(1.15)" : "";
  return (
    <div className="cmp-frame" style={{ height, borderRadius: 9 }} aria-hidden data-rig-preview
      data-rig={`${focal}mm f/${ap}`}>
      <div className="cmp-scene" style={{ transform: `scale(${scale}) ${anamorphic ? "scaleX(1.12)" : ""}`, transition: "transform 450ms cubic-bezier(.4,0,.2,1)", transformOrigin: "50% 58%" }}>
        <div className="cmp-bg" style={{ filter: `blur(${bgBlur}px) ${camFilter}`, transition: "filter 450ms ease" }} />
        <div className="cmp-mid" style={{ filter: `blur(${(bgBlur * 0.55).toFixed(2)}px) ${camFilter}`, transition: "filter 450ms ease" }} />
        <div className="cmp-subject" style={{ filter: camFilter, transition: "filter 450ms ease" }}><div className="cmp-head" /><div className="cmp-torso" /></div>
      </div>
      {anamorphic && <div className="smp-ov smp-ov-flare" />}
      {film && <div className="smp-ov smp-ov-grain" />}
      <div className="cmp-vignette" style={dreamy ? { boxShadow: "inset 0 0 34px 18px rgba(0,0,0,.68)" } : undefined} />
      <span className="cmp-badge">{focal}mm · f/{ap}</span>
    </div>
  );
}

function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

export function CameraMotionPreview({ motion, height = 84 }: { motion: CamMotion; height?: number }) {
  useEffect(ensureKeyframes, []);
  return (
    <div className={`cmp-frame cmp-${motion}`} style={{ height, borderRadius: 7 }} aria-hidden data-cam-motion={motion}>
      <div className="cmp-scene">
        <div className="cmp-bg" />
        <div className="cmp-mid" />
        <div className="cmp-subject"><div className="cmp-head" /><div className="cmp-torso" /></div>
      </div>
      <div className="cmp-vignette" />
    </div>
  );
}
