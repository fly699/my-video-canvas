// #258 提示词优化批②的两个默认关开关（快捷设置「智能与提速」组）。
// 【零回归构造】两个函数在开关关闭（false/undefined）时分别返回 ""/true——调用点是
// `${selfCheckRule(...)}` 与「guideRule 三元」，关闭时模板输出与旧版逐字一致，由守卫单测锁死。
// 【wire-format 红线】selfCheck 是「# 输出要求」规则清单的【末尾纯追加行】（与 #145 插入
// 对白语种硬规则同类、已有生产先例）；leanPrompt 是「整段有/无」（与 #140 跳过模板段、
// #141 清单压缩同机制）——都不挪动/拆分任何既有段落。

/** ⑧ 输出前自查清单：开启时追加到规则清单末尾的一条规则；关闭返回空串（提示词逐字不变）。 */
export function selfCheckRule(enabled?: boolean): string {
  if (!enabled) return "";
  return "\n- 【输出前自查（用户已开启）】提交前逐项核对，发现问题先改正再输出：① 每个 create/update 的 payload 字段名都在「可用节点目录」中该节点类型的字段列表内（有一个编造字段就整单不合格）；② 每条视频提示词（video_task/comfyui_video）都含五要素且动作量与镜头时长匹配；③ 上方「用户偏好/约束」里的每条【强制/硬约束】逐条核对已满足（模型/节点白名单/模板/排除分镜等）；④ 每个 connect 的 sourceRef/targetRef 都是本轮某 create 的 tempId 或画布摘要中真实存在的节点 id。自查只在内部进行，最终仍然只输出规定的 JSON 本体，不要输出自查过程。";
}

/** ⑦ 答疑段按需注入的判定：返回 true = 保留「应用操作答疑」段。
 *  保守策略（误判兜底 = 不会比现状差）：开关未开一律保留；开了也只在消息【不含任何
 *  疑问/求助特征】且长度足够明确时才省略——拿不准（空串/短句/带问号/含怎么如何等）一律保留。 */
const QUESTION_HINT_RE = /[?？]|怎么|怎样|如何|在哪|哪里|哪个|什么|为什么|为何|是否|有没有|能不能|能否|可不可以|吗|支不支持|教程|指南|说明|介绍|快捷键|入口|help|how\b|what\b|where\b|why\b/i;
export function includeGuideRule(leanPrompt: boolean | undefined, message: string | undefined): boolean {
  if (!leanPrompt) return true;                    // 开关关：永远保留（默认路径逐字一致）
  const msg = (message ?? "").trim();
  if (msg.length < 8) return true;                 // 太短意图不明 → 保留
  if (QUESTION_HINT_RE.test(msg)) return true;     // 任何疑问/求助特征 → 保留
  return false;                                    // 明确的生产指令 → 本轮省略答疑段
}
