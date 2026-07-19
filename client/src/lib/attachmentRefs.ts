// #260 附件即可引用：{{refN}} 占位符 → 附件真实地址的【确定性替换】纯函数。
//
// 背景：规划模型看到的是图片内容而非地址，让它自己填 URL 只会编造（幻觉 URL 是历史
// 拒因大户）。故约定：LLM 只在受控字段（referenceImageUrl / library 操作的 sourceRef）
// 写 "{{refN}}" 占位符（服务端 sanitize 已剥除一切非占位符值），客户端在应用规划前用
// 本函数把占位符换成发送时登记的附件真实地址（素材库图自带 URL、本地图先走上传通道）。
// 编号规则两端一致：都是「过滤出图片附件后按消息内顺序 1 起编号」（服务端 attachRefList
// 与 CanvasAgentChat 构建 refMap 用同一规则）——规则漂移会导致图张错位，改动须两端同步。
//
// 同时在这里把 "library" 入库操作从节点操作流中【抽走】：applyAgentOperations 只认画布
// 语义（create/connect/update/delete/canvas），不做网络请求；入库由 CanvasAgentChat 拿着
// 返回的 libraryOps 调 characterLibrary.create 异步执行。
import type { AgentOperation } from "../../../shared/types";

/** 占位符全字匹配（sanitize 同一正则）——只替换「整个字段值恰为占位符」的情况，
 *  不做子串替换：参考图字段语义上就是单个地址，出现拼接串本身就是异常值。 */
const REF_RE = /^\{\{ref(\d+)\}\}$/;

export interface ResolvedLibraryOp {
  kind: "person" | "scene";
  name: string;
  /** 已替换为真实地址的附件 URL（http(s) 或 dev 下的 data:）。 */
  url: string;
}

export interface ResolveAttachmentRefsResult {
  /** 已完成占位符替换、且剔除了 library 操作的纯画布操作（喂给 applyAgentOperations）。 */
  nodeOps: AgentOperation[];
  /** 待执行的入库操作（sourceRef 已解析成真实 URL）。 */
  libraryOps: ResolvedLibraryOp[];
  /** 人类可读的告警（未知编号被剔除 / 会话恢复后附件映射丢失等），由调用方 toast。 */
  warnings: string[];
}

/**
 * 遍历操作列表：
 * - create/update 的 payload.referenceImageUrl 恰为 {{refN}} → 替换为 refMap 中的真实地址；
 *   编号不存在（LLM 越界 / 恢复路径无映射）→ 删除该字段并记告警（节点照常创建，只是没参考图，
 *   绝不让一个坏引用毁掉整个操作）。
 * - op==="library" → 解析 sourceRef 后移入 libraryOps；解析失败整条丢弃并记告警
 *   （入库没有图就没有意义，不做「无图入库」）。
 * 纯函数：不修改入参（逐 op 浅拷贝 payload），便于单测与恢复路径复用。
 */
export function resolveAttachmentRefs(
  ops: AgentOperation[],
  refMap: Record<string, string>,
): ResolveAttachmentRefsResult {
  const nodeOps: AgentOperation[] = [];
  const libraryOps: ResolvedLibraryOp[] = [];
  const warnings: string[] = [];
  const lookup = (v: string): string | undefined => {
    const m = REF_RE.exec(v);
    return m ? refMap[`ref${m[1]}`] : undefined;
  };

  for (const op of ops) {
    if (op.op === "library") {
      const src = typeof op.sourceRef === "string" ? op.sourceRef : "";
      const url = src ? lookup(src) : undefined;
      const kind = op.libraryKind === "scene" ? "scene" : "person";
      if (!url) {
        warnings.push(`入库操作「${op.name ?? "?"}」引用的附件 ${src || "(缺失)"} 不存在（可能是会话恢复后附件已失效），已跳过——请重新附图再试`);
        continue;
      }
      if (!op.name?.trim()) { warnings.push("入库操作缺少名称，已跳过"); continue; }
      libraryOps.push({ kind, name: op.name.trim(), url });
      continue;
    }
    // 仅 create/update 携带 payload；其余操作原样透传。
    const payload = op.payload;
    const refVal = payload && typeof payload.referenceImageUrl === "string" ? payload.referenceImageUrl : undefined;
    if (refVal && REF_RE.test(refVal)) {
      const url = lookup(refVal);
      if (url) {
        nodeOps.push({ ...op, payload: { ...payload, referenceImageUrl: url } });
      } else {
        // 编号越界 / 无映射：剥掉该字段保住整个操作（节点仍创建，仅缺参考图）。
        const { referenceImageUrl: _dropped, ...rest } = payload!;
        nodeOps.push({ ...op, payload: rest });
        warnings.push(`节点引用的附件 ${refVal} 不存在，已忽略该参考图（其余设置照常生效）`);
      }
      continue;
    }
    nodeOps.push(op);
  }
  return { nodeOps, libraryOps, warnings };
}
