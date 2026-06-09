import { forwardRef, useCallback, useEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type FocusEvent } from "react";
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

// `noMention`: 关闭「@」角色/场景自动补全（默认开启）。
type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & CommonProps & { noMention?: boolean };

export const NodeTextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function NodeTextArea(
  { value, onValueChange, onCompositionStart, onCompositionEnd, onFocus, onBlur, onKeyDown, onKeyUp, onClick, noMention, ...rest },
  ref,
) {
  const ime = useImeSafeValue<HTMLTextAreaElement>(value, onValueChange);
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const mergedRef = useMergedRef(ref, innerRef);
  const mention = useMention(!noMention, innerRef, ime.commit);
  const slash = useSlashMenu(!noMention, innerRef, ime.commit);
  const probe = () => { mention.probe(); slash.probe(); };
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
        onFocus={(e: FocusEvent<HTMLTextAreaElement>) => { ime.onFocus(); onFocus?.(e); }}
        onBlur={(e: FocusEvent<HTMLTextAreaElement>) => { ime.onBlur(); onBlur?.(e); setTimeout(() => { mention.close(); slash.close(); }, 120); }}
      />
      {mention.dropdown}
      {slash.dropdown}
    </>
  );
});

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & CommonProps & { noMention?: boolean };

export const NodeInput = forwardRef<HTMLInputElement, InputProps>(function NodeInput(
  { value, onValueChange, onCompositionStart, onCompositionEnd, onFocus, onBlur, onKeyDown, onKeyUp, onClick, noMention, ...rest },
  ref,
) {
  const ime = useImeSafeValue<HTMLInputElement>(value, onValueChange);
  const innerRef = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRef(ref, innerRef);
  const mention = useMention(!noMention, innerRef, ime.commit);
  const slash = useSlashMenu(!noMention, innerRef, ime.commit);
  const probe = () => { mention.probe(); slash.probe(); };
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
