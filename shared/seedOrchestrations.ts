// 官方种子编排模板：几套经典成片骨架，空画布一键铺开整套节点 + 连线，用户替换占位
// 提示词即可开工。纯数据（AgentOperation[]），复用编排库的 applyOrchestration 落地。
// 注意：刻意避开 storyboard 节点——快捷设置 noStoryboard 默认开会剔除它；改用
// image_gen（首帧）→ video_task（图生视频）主流程承载分镜，最后 merge 合并成片。
import type { AgentOperation } from "./types";
import type { OrchestrationTemplate } from "./orchestration";

export interface SeedOrchestration extends OrchestrationTemplate {
  /** 一句话说明这套骨架适合什么。 */
  desc: string;
  /** 列表展示用 emoji。 */
  icon: string;
}

const create = (tempId: string, nodeType: string, payload: Record<string, unknown>, title: string): AgentOperation =>
  ({ op: "create", tempId, nodeType: nodeType as AgentOperation["nodeType"], title, payload });
const link = (sourceRef: string, targetRef: string): AgentOperation => ({ op: "connect", sourceRef, targetRef });

// 一套「首帧图 → 图生视频」的镜头：image_gen(iN) → video_task(vN)，角色 cN 若有则接首帧。
const shot = (n: number, imgPrompt: string, vidPrompt: string, charRef?: string) => {
  const i = `i${n}`, v = `v${n}`;
  const ops: AgentOperation[] = [
    create(i, "image_gen", { prompt: imgPrompt }, `镜${n}·首帧`),
    create(v, "video_task", { duration: 5, promptText: vidPrompt }, `镜${n}·视频`),
    link(i, v),
  ];
  if (charRef) ops.push(link(charRef, i));
  return { ops, videoRef: v };
};

/** 三幕短片骨架：主角 + 起/承/转/合四镜 + 合并成片。 */
function threeActShort(): AgentOperation[] {
  const ops: AgentOperation[] = [
    create("c1", "character", { name: "主角", appearance: "（在此描述主角长相/发型/服装/气质）" }, "主角"),
  ];
  const beats: Array<[string, string]> = [
    ["开场：交代人物与环境", "缓慢推入，建立氛围"],
    ["发展：主角遇到冲突/目标", "手持跟随，情绪递进"],
    ["高潮：冲突爆发的关键瞬间", "快速运镜，张力拉满"],
    ["结尾：余韵与收束", "缓缓拉远，留白收尾"],
  ];
  const vids: string[] = [];
  beats.forEach(([img, vid], k) => { const s = shot(k + 1, img, vid, "c1"); ops.push(...s.ops); vids.push(s.videoRef); });
  ops.push(create("m1", "merge", {}, "成片合并"));
  vids.forEach((v) => ops.push(link(v, "m1")));
  return ops;
}

/** 产品广告骨架：产品图 + 三个卖点场景 + 行动号召 + 合并。 */
function productAd(): AgentOperation[] {
  const ops: AgentOperation[] = [
    create("p1", "image_gen", { prompt: "产品主图（在此描述产品外观/材质/卖点）" }, "产品图"),
  ];
  const scenes: Array<[string, string]> = [
    ["卖点一：核心功能特写", "特写运镜，突出细节"],
    ["卖点二：使用场景演示", "环绕运镜，展示体验"],
    ["行动号召：品牌与优惠信息", "定格上字，引导下单"],
  ];
  const vids: string[] = [];
  scenes.forEach(([img, vid], k) => { const s = shot(k + 1, img, vid, "p1"); ops.push(...s.ops); vids.push(s.videoRef); });
  ops.push(create("m1", "merge", {}, "广告成片"));
  vids.forEach((v) => ops.push(link(v, "m1")));
  return ops;
}

/** 角色微电影骨架：主角 + 四镜叙事 + 配乐 + 合并。 */
function characterFilm(): AgentOperation[] {
  const ops: AgentOperation[] = [
    create("c1", "character", { name: "主角", appearance: "（在此描述主角长相/发型/服装/气质）" }, "主角"),
    create("a1", "audio", { prompt: "背景配乐（在此描述情绪/曲风/节奏）" }, "配乐"),
  ];
  const beats: Array<[string, string]> = [
    ["清晨：日常的开始", "自然光，平稳记录"],
    ["转折：意外打破平静", "手持晃动，制造不安"],
    ["抉择：主角做出决定", "低角度，强调决心"],
    ["新生：走向新的日常", "暖调，缓缓向前"],
  ];
  const vids: string[] = [];
  beats.forEach(([img, vid], k) => { const s = shot(k + 1, img, vid, "c1"); ops.push(...s.ops); vids.push(s.videoRef); });
  ops.push(create("m1", "merge", {}, "微电影成片"));
  vids.forEach((v) => ops.push(link(v, "m1")));
  ops.push(link("a1", "m1")); // 配乐接入合并
  return ops;
}

export const SEED_ORCHESTRATIONS: SeedOrchestration[] = [
  { id: "seed_three_act", name: "三幕短片骨架", desc: "主角 + 起承转合四镜 + 合并成片，适合叙事短片起步。", icon: "🎬", createdAt: 0, ops: threeActShort() },
  { id: "seed_product_ad", name: "产品广告骨架", desc: "产品图 + 三卖点场景 + 行动号召，适合带货/宣传片。", icon: "📦", createdAt: 0, ops: productAd() },
  { id: "seed_character_film", name: "角色微电影骨架", desc: "主角 + 四镜叙事 + 配乐 + 合并，适合人物故事。", icon: "🎭", createdAt: 0, ops: characterFilm() },
];
