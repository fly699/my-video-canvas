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

const STYLE_ID = "cmp-keyframes-v1";
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
@media (prefers-reduced-motion: reduce){.cmp-frame *{animation:none !important}}
`;

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
