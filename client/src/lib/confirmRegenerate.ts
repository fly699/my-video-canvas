import { confirmDialog } from "@/components/ui/dialogService";

/**
 * 已有生成结果时「点击按钮再次生成」的统一二次确认。
 *
 * 仅供【按钮 onClick 入口】调用——画布助手自动编排、整组执行、质检自动重试等
 * 程序化触发一律直接调用各节点的 submit/generate 函数，不得经过本确认（产品约定：
 * 二次确认只限手点按钮这个入口，不给自动化流程添堵）。
 */
export function confirmRegenerate(what = "生成结果"): Promise<boolean> {
  return confirmDialog({
    title: "重新生成？",
    message: `该节点已有${what}。再次生成会发起新的调用（云端模型将再次计费），完成后将替换当前结果。`,
    confirmLabel: "重新生成",
  });
}
