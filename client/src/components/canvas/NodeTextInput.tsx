import { forwardRef, useCallback, useEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type FocusEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Check, Wand2, Languages, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useMention } from "./useMention";
import { useSlashMenu } from "./useSlashMenu";

/** 稳定的「合并外部转发 ref + 内部 ref」回调（避免每次渲染重建导致 ref 反复挂卸）。 */
function useMergedRef<T>(external: React.ForwardedRef<T>, internal: React.MutableRefObject<T | null>) {
  return useCallback((el: T | null) => {
    internal.current = el;
    if (typeof external === "function") external(el);
    else if (external) external.current = el;
  }, [external, internal]);
}

/**
 * IME-safe controlled inputs for canvas nodes.
 *
 * Why this exists: node text fields are controlled by the Zustand canvas store.
 * Writing to the store on every keystroke rebuilds the nodes array, which
 * re-renders the node — and a re-render *during* an IME composition (typing
 * Chinese/Japanese/Korean via pinyin etc.) aborts the composition, dumping the
 * raw latin keys into the field ("你好nishshut"). These wrappers keep the typed
 * value in LOCAL state and only push to the parent store:
 *   - on `compositionend` (the IME committed a character), or
 *   - on plain (non-composing) input, or
 *   - on blur.
 * So the store is never mutated mid-composition and the IME is never interrupted.
 *
 * The external `value` is mirrored into local state only while the field is NOT
 * focused/composing, so programmatic updates (AI expand/translate, collab) still
 * flow in without clobbering an in-progress edit.
 *
 * Use `onValueChange(v)` instead of `onChange`. Native `onFocus/onBlur` and the
 * other handlers are still forwarded.
 */

type CommonProps = { onValueChange?: (value: string) => void };

function useImeSafeValue<T extends HTMLInputElement | HTMLTextAreaElement>(
  value: string | number | readonly string[] | undefined,
  onValueChange?: (value: string) => void,
) {
  const [local, setLocal] = useState<string>(value == null ? "" : String(value));
  const composing = useRef(false);
  const focused = useRef(false);

  useEffect(() => {
    // Only adopt the external value when the user isn't actively editing, so we
    // never yank the caret/composition out from under them.
    if (!focused.current && !composing.current) setLocal(value == null ? "" : String(value));
  }, [value]);

  const onChange = (e: ChangeEvent<T>) => {
    setLocal(e.target.value);
    if (!composing.current) onValueChange?.(e.target.value);
  };
  const onCompositionStart = () => { composing.current = true; };
  const onCompositionEnd = (e: CompositionEvent<T>) => {
    composing.current = false;
    onValueChange?.((e.target as T).value);
  };
  const onFocus = () => { focused.current = true; };
  const onBlur = () => { focused.current = false; onValueChange?.(local); };

  // Programmatic value set (used by the @mention插入): update local + push to store.
  const commit = (next: string) => { setLocal(next); onValueChange?.(next); };

  return { local, onChange, onCompositionStart, onCompositionEnd, onFocus, onBlur, commit };
}

// ── 宽幅弹出编辑器（对标 LibTV 宽输入框）──────────────────────────────────────
// 节点宽仅 340px，长提示词在节点内读写费劲。textarea 聚焦时右上角浮出「放大」小按钮
// （portal + getBoundingClientRect 定位，零布局侵入，与 @mention 下拉同款模式），点击
// 打开画布中央宽幅编辑窗。弹窗内 textarea 用【非受控】defaultValue + 每键 commit——
// 不回读外部值，IME 组合不会被打断；节点里的小框未聚焦，会正常采纳写回的新值。
function useExpandEditor(
  enabled: boolean,
  elRef: RefObject<HTMLTextAreaElement | null>,
  commit: (next: string) => void,
  placeholder?: string,
) {
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState("");
  const openRef = useRef(false); openRef.current = open;
  const bigRef = useRef<HTMLTextAreaElement | null>(null);

  // AI 提示词工具（扩写/翻译/润色）——LibTV 把这些内联在提示词输入区，这里让宽幅编辑弹窗
  // 也具备同样能力。底层复用 aiEnhance.enhance（与提示词节点同一端点）。因 useExpandEditor 被
  // 所有 NodeTextArea 复用，故一处接入即覆盖所有含提示词的节点（图像/视频/分镜/提示词等）。
  const enhance = trpc.aiEnhance.enhance.useMutation();
  const [aiBusy, setAiBusy] = useState<null | "expand" | "translate_en" | "polish">(null);
  const runAi = useCallback(async (mode: "expand" | "translate_en" | "polish", label: string) => {
    const el = bigRef.current;
    if (!el || aiBusy) return;
    const text = el.value.trim();
    if (!text) { toast.error("提示词为空，无法" + label); return; }
    setAiBusy(mode);
    try {
      const r = await enhance.mutateAsync({ text, mode });
      const out = r.result?.trim();
      if (out) { el.value = out; commit(out); toast.success(label + "完成"); }
      else toast.error(label + "失败：无返回");
    } catch (e) {
      toast.error(label + "失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAiBusy(null);
    }
  }, [aiBusy, commit, enhance]);

  const showBtn = useCallback(() => {
    if (!enabled || !elRef.current) return;
    setBtnRect(elRef.current.getBoundingClientRect());
  }, [enabled, elRef]);
  const hideBtnSoon = useCallback(() => {
    // 延迟隐藏：留出点按放大按钮的时间窗（按钮 onPointerDown preventDefault 保焦点）。
    setTimeout(() => { if (!openRef.current) setBtnRect(null); }, 150);
  }, []);
  const close = useCallback(() => {
    if (bigRef.current) commit(bigRef.current.value); // 关闭前最终写回
    setOpen(false); setBtnRect(null);
  }, [commit]);

  const ui = (
    <>
      {enabled && btnRect && !open && createPortal(
        <button
          className="nodrag"
          title="放大编辑（宽屏窗口）"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => { setInitial(elRef.current?.value ?? ""); setOpen(true); }}
          style={{
            position: "fixed", left: btnRect.right - 26, top: btnRect.top + 4, width: 22, height: 22, zIndex: 60,
            display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, cursor: "pointer",
            border: "1px solid var(--c-bd2)", background: "var(--c-base)", color: "var(--c-t3)", opacity: 0.85,
          }}
        ><Maximize2 size={12} /></button>,
        document.body,
      )}
      {open && createPortal(
        <div
          className="nodrag nowheel"
          style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={close}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 720, maxWidth: "94vw", height: "64vh", maxHeight: 640, display: "flex", flexDirection: "column",
              background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.5)", overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--c-bd2)", flexShrink: 0 }}>
              <Maximize2 size={14} style={{ color: "var(--c-t3)" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>{placeholder?.trim() ? placeholder.slice(0, 24) : "编辑文本"}</span>
              <div style={{ flex: 1 }} />
              {/* AI 提示词工具（LibTV 内联能力搬进宽幅弹窗）：扩写 / 翻译英文 / 润色 */}
              {([
                { mode: "expand" as const, label: "扩写", Icon: Wand2 },
                { mode: "translate_en" as const, label: "翻译", Icon: Languages },
                { mode: "polish" as const, label: "润色", Icon: Sparkles },
              ]).map(({ mode, label, Icon }) => (
                <button
                  key={mode}
                  className="nodrag"
                  onClick={() => runAi(mode, label)}
                  disabled={!!aiBusy}
                  title={`AI ${label}（作用于当前文本）`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8,
                    fontSize: 12, fontWeight: 500, cursor: aiBusy ? "default" : "pointer",
                    border: "1px solid var(--c-bd2)", background: "var(--c-surface)",
                    color: aiBusy && aiBusy !== mode ? "var(--c-t4)" : "var(--c-t2)", opacity: aiBusy && aiBusy !== mode ? 0.5 : 1,
                  }}
                >
                  {aiBusy === mode ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />} {label}
                </button>
              ))}
              <button onClick={close} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 14px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", border: "1px solid oklch(0.70 0.20 310 / 0.5)", background: "oklch(0.70 0.20 310 / 0.14)", color: "oklch(0.75 0.18 310)" }}>
                <Check size={13} /> 完成
              </button>
            </div>
            <textarea
              ref={bigRef}
              autoFocus
              defaultValue={initial}
              placeholder={placeholder}
              onInput={(e) => commit((e.target as HTMLTextAreaElement).value)}
              style={{ flex: 1, width: "100%", padding: "14px 16px", fontSize: 14, lineHeight: 1.75, background: "transparent", border: "none", outline: "none", resize: "none", color: "var(--c-t1)" }}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );

  return { showBtn, hideBtnSoon, refreshBtn: showBtn, ui };
}

// `noMention`: 关闭「@」角色/场景自动补全（默认开启）。
// `noSlash`: 关闭「/」提示词库快捷菜单（默认开启）。AI 对话节点自带 /命令，需单独关掉避免冲突。
// `noExpand`: 关闭聚焦时的「放大编辑」浮动按钮（默认开启）。
type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & CommonProps & { noMention?: boolean; noSlash?: boolean; noExpand?: boolean };

export const NodeTextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function NodeTextArea(
  { value, onValueChange, onCompositionStart, onCompositionEnd, onFocus, onBlur, onKeyDown, onKeyUp, onClick, noMention, noSlash, noExpand, ...rest },
  ref,
) {
  const ime = useImeSafeValue<HTMLTextAreaElement>(value, onValueChange);
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const mergedRef = useMergedRef(ref, innerRef);
  const mention = useMention(!noMention, innerRef, ime.commit);
  const slash = useSlashMenu(!noMention && !noSlash, innerRef, ime.commit);
  const expand = useExpandEditor(!noExpand, innerRef, ime.commit, typeof rest.placeholder === "string" ? rest.placeholder : undefined);
  const probe = () => { mention.probe(); slash.probe(); expand.refreshBtn(); };
  // 暴露 commitValue：以编程方式设值并写回 store，直接更新内部 local（绕过「聚焦中不采纳外部 value」
  // 守卫）。供外部按钮（如 AI 对话节点的 /命令、画布注入）即时改写输入框，避免聚焦时设值不生效。
  useEffect(() => {
    if (innerRef.current) (innerRef.current as HTMLTextAreaElement & { commitValue?: (v: string) => void }).commitValue = ime.commit;
  });
  return (
    <>
      <textarea
        ref={mergedRef}
        {...rest}
        value={ime.local}
        onChange={(e) => { ime.onChange(e); probe(); }}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && (mention.onKeyDown(e) || slash.onKeyDown(e))) return; onKeyDown?.(e); }}
        onKeyUp={(e) => { probe(); onKeyUp?.(e); }}
        onClick={(e) => { probe(); onClick?.(e); }}
        onCompositionStart={(e) => { ime.onCompositionStart(); onCompositionStart?.(e); }}
        onCompositionEnd={(e) => { ime.onCompositionEnd(e); onCompositionEnd?.(e); probe(); }}
        onFocus={(e: FocusEvent<HTMLTextAreaElement>) => { ime.onFocus(); expand.showBtn(); onFocus?.(e); }}
        onBlur={(e: FocusEvent<HTMLTextAreaElement>) => { ime.onBlur(); expand.hideBtnSoon(); onBlur?.(e); setTimeout(() => { mention.close(); slash.close(); }, 120); }}
      />
      {mention.dropdown}
      {slash.dropdown}
      {expand.ui}
    </>
  );
});

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & CommonProps & { noMention?: boolean; noSlash?: boolean };

export const NodeInput = forwardRef<HTMLInputElement, InputProps>(function NodeInput(
  { value, onValueChange, onCompositionStart, onCompositionEnd, onFocus, onBlur, onKeyDown, onKeyUp, onClick, noMention, noSlash, ...rest },
  ref,
) {
  const ime = useImeSafeValue<HTMLInputElement>(value, onValueChange);
  const innerRef = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRef(ref, innerRef);
  const mention = useMention(!noMention, innerRef, ime.commit);
  const slash = useSlashMenu(!noMention && !noSlash, innerRef, ime.commit);
  const probe = () => { mention.probe(); slash.probe(); };
  useEffect(() => {
    if (innerRef.current) (innerRef.current as HTMLInputElement & { commitValue?: (v: string) => void }).commitValue = ime.commit;
  });
  return (
    <>
      <input
        ref={mergedRef}
        {...rest}
        value={ime.local}
        onChange={(e) => { ime.onChange(e); probe(); }}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && (mention.onKeyDown(e) || slash.onKeyDown(e))) return; onKeyDown?.(e); }}
        onKeyUp={(e) => { probe(); onKeyUp?.(e); }}
        onClick={(e) => { probe(); onClick?.(e); }}
        onCompositionStart={(e) => { ime.onCompositionStart(); onCompositionStart?.(e); }}
        onCompositionEnd={(e) => { ime.onCompositionEnd(e); onCompositionEnd?.(e); probe(); }}
        onFocus={(e: FocusEvent<HTMLInputElement>) => { ime.onFocus(); onFocus?.(e); }}
        onBlur={(e: FocusEvent<HTMLInputElement>) => { ime.onBlur(); onBlur?.(e); setTimeout(() => { mention.close(); slash.close(); }, 120); }}
      />
      {mention.dropdown}
      {slash.dropdown}
    </>
  );
});
