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
// aspect 可选：给竖屏等骨架统一画幅（写进首帧图与视频镜 payload，与连续性体检口径一致）。
const shot = (n: number, imgPrompt: string, vidPrompt: string, charRef?: string, aspect?: string) => {
  const i = `i${n}`, v = `v${n}`;
  const imgPayload: Record<string, unknown> = { prompt: imgPrompt };
  const vidPayload: Record<string, unknown> = { duration: 5, promptText: vidPrompt };
  if (aspect) { imgPayload.aspectRatio = aspect; vidPayload.aspectRatio = aspect; }
  const ops: AgentOperation[] = [
    create(i, "image_gen", imgPayload, `镜${n}·首帧`),
    create(v, "video_task", vidPayload, `镜${n}·视频`),
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

/** 竖屏口播/vlog 骨架：出镜人 + 配乐 + 开场/两段内容/收尾四镜（9:16）+ 合并。 */
function verticalVlog(): AgentOperation[] {
  const ops: AgentOperation[] = [
    create("c1", "character", { name: "出镜人", appearance: "（在此描述出镜人长相/发型/服装/气质）" }, "出镜人"),
    create("a1", "audio", { prompt: "轻快背景音乐（在此描述情绪/曲风/节奏）" }, "配乐"),
  ];
  const beats: Array<[string, string]> = [
    ["竖屏中景：出镜人正对镜头微笑打招呼", "轻微推近，亲和开场"],
    ["竖屏近景：讲解要点一，配合手势", "固定机位，稳定收音感"],
    ["竖屏近景：讲解要点二，情绪上扬", "轻微侧移，保持节奏"],
    ["竖屏中景：出镜人总结并引导关注", "缓缓拉远，收尾留白"],
  ];
  const vids: string[] = [];
  beats.forEach(([img, vid], k) => { const s = shot(k + 1, img, vid, "c1", "9:16"); ops.push(...s.ops); vids.push(s.videoRef); });
  ops.push(create("m1", "merge", {}, "竖屏成片"));
  vids.forEach((v) => ops.push(link(v, "m1")));
  ops.push(link("a1", "m1"));
  return ops;
}

/** 美食短片骨架：食材特写 → 烹饪过程 → 成品展示三镜 + 配乐 + 合并（竖屏 9:16）。 */
function foodShort(): AgentOperation[] {
  const ops: AgentOperation[] = [
    create("a1", "audio", { prompt: "治愈系轻音乐（在此描述情绪/曲风/节奏）" }, "配乐"),
  ];
  const scenes: Array<[string, string]> = [
    ["食材俯拍特写：新鲜食材整齐摆放", "俯拍微移，展示食材质感"],
    ["烹饪过程：下锅翻炒/摆盘的动作特写", "跟随手部动作，突出热气与色泽"],
    ["成品展示：完成的菜品居中特写", "缓缓环绕，诱人收尾"],
  ];
  const vids: string[] = [];
  scenes.forEach(([img, vid], k) => { const s = shot(k + 1, img, vid, undefined, "9:16"); ops.push(...s.ops); vids.push(s.videoRef); });
  ops.push(create("m1", "merge", {}, "美食成片"));
  vids.forEach((v) => ops.push(link(v, "m1")));
  ops.push(link("a1", "m1"));
  return ops;
}

export const SEED_ORCHESTRATIONS: SeedOrchestration[] = [
  { id: "seed_three_act", name: "三幕短片骨架", desc: "主角 + 起承转合四镜 + 合并成片，适合叙事短片起步。", icon: "🎬", createdAt: 0, ops: threeActShort() },
  { id: "seed_product_ad", name: "产品广告骨架", desc: "产品图 + 三卖点场景 + 行动号召，适合带货/宣传片。", icon: "📦", createdAt: 0, ops: productAd() },
  { id: "seed_character_film", name: "角色微电影骨架", desc: "主角 + 四镜叙事 + 配乐 + 合并，适合人物故事。", icon: "🎭", createdAt: 0, ops: characterFilm() },
  { id: "seed_vertical_vlog", name: "竖屏口播/vlog 骨架", desc: "出镜人 + 配乐 + 四镜（9:16）+ 合并，适合口播/vlog/短视频。", icon: "📱", createdAt: 0, ops: verticalVlog() },
  { id: "seed_food_short", name: "美食短片骨架", desc: "食材特写→烹饪过程→成品展示三镜 + 配乐（9:16），适合美食号。", icon: "🍜", createdAt: 0, ops: foodShort() },
];
