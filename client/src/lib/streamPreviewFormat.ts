// #312 流式回显实时排版：把「生成中的不完整规划 JSON」抽成人能读的草稿行。
//
// 背景：流式回显（#306/#309a）直接滚动模型原始输出——快问快答轮是普通文本没问题，
// 规划轮是一大坨未闭合 JSON，用户反馈「太乱、看不清」。本模块做纯展示层的轻量提取：
// - 正则抽取【已生成完的】reply 片段（容忍字符串未闭合——取已流出的部分）；
// - 按 "op" 出现位置分段，抽每个操作的 op/nodeType/title/action，渲染成编号清单；
// - 非规划形态（不含规划特征键）原样直出；什么都抽不出来时回退原文。
// #322 补漏：服务端对超 8000 字的 partial 改发「头 + 省略标记 + 尾」（原先只留尾部，
// 开头的 "reply"/"operations" 键被截掉 → 守卫不命中 → 整段裸 JSON 直出）。这里配套：
// ① 守卫放宽——出现 "op":"..." 也算规划形态（老服务端只发尾部时也能兜住）；
// ② 按省略标记分窗抽取，窗口间显示「……（中间部分已省略）」提示行；
// ③ 首窗完整（含 reply/operations 键）才用连续编号；省略之后的操作行改用「·」圆点
//    ——中间被省略了多少条无从得知，硬编号会撒谎。
// 纯函数、无状态；调用方 useMemo 包裹，轮询节奏 1~2.5s 才更新一次、输入 ≤8000 字，
// 正则开销可忽略。绝不影响数据流——partial 原文照旧累积，这里只管「怎么显示」。
import { STREAM_OMIT_MARK } from "@shared/streamPreviewCut";

const NODE_LABEL: Record<string, string> = {
  image_gen: "图像", video_task: "视频", storyboard: "分镜", character: "角色", scene: "场景",
  script: "脚本", prompt: "提示词", audio: "音频", merge: "合并", note: "便签", subtitle: "字幕",
  dynamic_subtitle: "动态字幕", clip: "剪辑", overlay: "叠加", smart_clip: "智能剪辑",
  comfyui_image: "ComfyUI图像", comfyui_video: "ComfyUI视频", comfyui_workflow: "ComfyUI工作流",
  image_edit: "图像编辑", pose_control: "姿势控制", super_agent: "工程智能体", ai_chat: "AI对话",
};
const OP_LABEL: Record<string, string> = {
  create: "新建", update: "修改", delete: "删除", connect: "连线", canvas: "画布操作", group: "编组", ungroup: "解组",
};

/** 解开 JSON 字符串片段里的常见转义（只处理展示需要的三种，其余原样）。 */
const unescape = (s: string) => s.replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

/** 单个文本窗口 → 操作描述行数组（不带编号/圆点前缀，由调用方决定行首形态）。 */
function extractOps(s: string): string[] {
  const segs: Array<{ op: string; idx: number }> = [];
  const opRe = /"op"\s*:\s*"([a-zA-Z_]+)"/g;
  for (let m = opRe.exec(s); m; m = opRe.exec(s)) segs.push({ op: m[1], idx: m.index });
  return segs.map((seg, i) => {
    const chunk = s.slice(seg.idx, i + 1 < segs.length ? segs[i + 1].idx : s.length);
    const nt = /"nodeType"\s*:\s*"(\w+)"/.exec(chunk)?.[1];
    // title 只取【已闭合】的（未闭合会抓到半截乱串）；connect 补上 源→目标。
    const title = /"title"\s*:\s*"((?:[^"\\]|\\.)*?)"/.exec(chunk)?.[1];
    const action = /"action"\s*:\s*"(\w+)"/.exec(chunk)?.[1];
    const src = /"source(?:Ref|Id)?"\s*:\s*"([^"]{1,40})"/.exec(chunk)?.[1];
    const dst = /"target(?:Ref|Id)?"\s*:\s*"([^"]{1,40})"/.exec(chunk)?.[1];
    let desc = OP_LABEL[seg.op] ?? seg.op;
    if (nt) desc += ` ${NODE_LABEL[nt] ?? nt}`;
    if (title) desc += `「${unescape(title)}」`;
    if (seg.op === "connect" && src && dst) desc += ` ${src} → ${dst}`;
    if (seg.op === "canvas" && action) desc += `：${action}`;
    return desc;
  });
}

/** 生成中的原始输出 → 可读预览文本。非规划形态/无可抽结构时返回原文。纯函数。 */
export function formatStreamPreview(raw: string): string {
  // 规划形态特征：reply/operations 键（完整头部），或任一 "op":"..."（#322：超长被
  // 裁剪成只剩中后段时也要认出来）。普通文本（快问快答、闲聊）原样直出。
  if (!/"reply"\s*:|"operations"\s*:|"op"\s*:\s*"[a-zA-Z_]+"/.test(raw)) return raw;

  const windows = raw.split(STREAM_OMIT_MARK);
  // 首窗含 reply/operations 键 = 从 JSON 开头起是完整的 → 首窗操作可用真实连续编号。
  const headIntact = /"reply"\s*:|"operations"\s*:/.test(windows[0]);
  const lines: string[] = [];
  let extracted = 0; // 真实抽出的内容行数（省略提示行不算，防止只剩提示行的空壳）

  windows.forEach((w, wi) => {
    if (wi > 0) lines.push("……（中间部分已省略）……");
    else if (!headIntact) lines.push("……（前面部分已省略）……"); // 老服务端纯尾部截断的兜底形态
    if (wi === 0 && headIntact) {
      // reply（容忍未闭合：字符串还在生成中就取已流出的部分）
      const rm = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(w);
      if (rm && unescape(rm[1]).trim()) { lines.push("💬 " + unescape(rm[1]).trim()); extracted++; }
    }
    const numbered = wi === 0 && headIntact;
    let n = 0;
    for (const desc of extractOps(w)) {
      lines.push(numbered ? `${++n}. ${desc}` : `· ${desc}`);
      extracted++;
    }
  });

  if (!extracted) return raw; // JSON 刚开头、啥也没成形 → 原样兜底
  return lines.join("\n");
}
