import type { AgentOperation } from "../../shared/types";

// #278 角色出图工位剔除（用户拍板：彻底取消，不设开关）。
//
// 背景：规划模型会自发为每个新建 character 节点配一个 image_gen「出图工位」
// （角色→image_gen，仅展示、无下游）。这与角色节点自身的生成体系完全重复
// （快捷设置「自动定妆照/场景图」、角色卡一键按钮、#275「运行全部」fill-only
// 自动补图），且：①「运行全部」会为同一角色生成两张一样的图（双重计费）；
// ②破坏「角色主参考图单一来源」原则，后续引用分不清该引角色节点还是工位图；
// ③模型给人物工位配 16:9，而人物定妆照应为 3:4。提示词已加硬规则禁止，
// 这里是「模型不听话」时的确定性兜底（与 imageFirst/#145 锁定模型同一哲学）。
//
// 判别式（刻意保守，只剔除「纯展示复制品」，绝不误伤有用形态）：
//   剔除条件 = 新建 image_gen 且【唯一入边来自一个新建 character】
//            且【无任何出边/其它操作引用】且【该角色只配了这一个工位（1:1）】。
//   保留：1:N 多版本（一个角色接多个 image_gen——用户要多造型对比，有用）；
//         有下游消费者的工位（接了 video_task 等——真参考管线，不是展示品）；
//         多角色合入一个 image_gen（合影/群像）；来源含 prompt 等非角色输入的；
//         被 update/group/align/duplicate/canvas 等任何后续操作引用的；
//         连到画布【已存在】角色（非本批 tempId）的——用户现有画布结构不动。
export function cullCharacterWorkstations(ops: AgentOperation[]): { ops: AgentOperation[]; dropped: string[] } {
  const charTemps = new Set<string>();
  const imageTemps = new Map<string, AgentOperation>();
  for (const o of ops) {
    if (o.op === "create" && o.tempId) {
      if (o.nodeType === "character") charTemps.add(o.tempId);
      else if (o.nodeType === "image_gen") imageTemps.set(o.tempId, o);
    }
  }
  if (charTemps.size === 0 || imageTemps.size === 0) return { ops, dropped: [] };

  // 每个 image_gen 的入边源 / 是否有出边或其它引用。
  const incoming = new Map<string, string[]>();   // imgTemp -> sourceRefs
  const referenced = new Set<string>();           // imgTemp 被出边或其它操作引用
  for (const o of ops) {
    if (o.op === "connect") {
      if (o.targetRef && imageTemps.has(o.targetRef)) {
        const arr = incoming.get(o.targetRef) ?? [];
        arr.push(o.sourceRef ?? "");
        incoming.set(o.targetRef, arr);
      }
      if (o.sourceRef && imageTemps.has(o.sourceRef)) referenced.add(o.sourceRef); // 有下游
    } else if (o.op !== "create") {
      // update/delete/group/duplicate/align/canvas/library… 任何引用都视作「有用途」。
      if (o.targetRef && imageTemps.has(o.targetRef)) referenced.add(o.targetRef);
      for (const r of o.targetRefs ?? []) if (imageTemps.has(r)) referenced.add(r);
    }
  }

  // 候选：唯一入边、源是本批新建 character、无任何引用。
  const candidateByChar = new Map<string, string[]>(); // charTemp -> [imgTemp...]
  imageTemps.forEach((_op, imgTemp) => {
    if (referenced.has(imgTemp)) return;
    const ins = incoming.get(imgTemp) ?? [];
    if (ins.length !== 1 || !charTemps.has(ins[0])) return;
    const arr = candidateByChar.get(ins[0]) ?? [];
    arr.push(imgTemp);
    candidateByChar.set(ins[0], arr);
  });
  // 1:1 才剔除；一个角色配了 ≥2 个候选 = 多版本对比，全部保留。
  const cullSet = new Set<string>();
  candidateByChar.forEach((imgs) => { if (imgs.length === 1) cullSet.add(imgs[0]); });
  if (cullSet.size === 0) return { ops, dropped: [] };

  const dropped: string[] = [];
  const result = ops.filter((o) => {
    if (o.op === "create" && o.tempId && cullSet.has(o.tempId)) {
      dropped.push(`已省去「${o.title || "出图工位"}」：角色配套出图工位与角色节点自身生图重复（角色图请开「自动定妆照/场景图」或「运行全部」自动补齐；需同一角色多版本对比请明确说明）`);
      return false;
    }
    if (o.op === "connect" && ((o.targetRef && cullSet.has(o.targetRef)) || (o.sourceRef && cullSet.has(o.sourceRef)))) return false;
    return true;
  });
  return { ops: result, dropped };
}
