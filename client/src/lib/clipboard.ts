import { toast } from "sonner";

/**
 * 跨环境复制文本到剪贴板。
 *
 * 背景：`navigator.clipboard.writeText` 只在**安全上下文**（HTTPS 或 localhost）可用。
 * 局域网 / 纯 HTTP 部署下 `navigator.clipboard` 为 undefined，或调用被拒——若不兜底，
 * 复制静默失败还常伴随「假成功」的提示（因为 `.then()` 从未拒绝但根本没复制）。
 *
 * 这里优先走异步 Clipboard API，失败则回退到隐藏 `<textarea>` + `execCommand('copy')`
 * （在纯 HTTP 下也能工作）。返回是否成功，供调用方决定提示。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 落到下面的 execCommand 兜底
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 复制并 toast 反馈的便捷封装：成功 toast.success(okMsg)，失败 toast.error（含 HTTP 提示）。
 * 大多数「复制」按钮直接用它即可。
 */
export async function copyTextWithToast(text: string, okMsg = "已复制", opts?: { duration?: number }): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) toast.success(okMsg, opts?.duration ? { duration: opts.duration } : undefined);
  else toast.error("复制失败，请手动选中复制（HTTP 访问下浏览器限制剪贴板，建议改用 HTTPS）");
  return ok;
}
