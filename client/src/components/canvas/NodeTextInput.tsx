import { forwardRef, useEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type FocusEvent } from "react";

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

  return { local, onChange, onCompositionStart, onCompositionEnd, onFocus, onBlur };
}

type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & CommonProps;

export const NodeTextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function NodeTextArea(
  { value, onValueChange, onCompositionStart, onCompositionEnd, onFocus, onBlur, ...rest },
  ref,
) {
  const ime = useImeSafeValue<HTMLTextAreaElement>(value, onValueChange);
  return (
    <textarea
      ref={ref}
      {...rest}
      value={ime.local}
      onChange={ime.onChange}
      onCompositionStart={(e) => { ime.onCompositionStart(); onCompositionStart?.(e); }}
      onCompositionEnd={(e) => { ime.onCompositionEnd(e); onCompositionEnd?.(e); }}
      onFocus={(e: FocusEvent<HTMLTextAreaElement>) => { ime.onFocus(); onFocus?.(e); }}
      onBlur={(e: FocusEvent<HTMLTextAreaElement>) => { ime.onBlur(); onBlur?.(e); }}
    />
  );
});

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & CommonProps;

export const NodeInput = forwardRef<HTMLInputElement, InputProps>(function NodeInput(
  { value, onValueChange, onCompositionStart, onCompositionEnd, onFocus, onBlur, ...rest },
  ref,
) {
  const ime = useImeSafeValue<HTMLInputElement>(value, onValueChange);
  return (
    <input
      ref={ref}
      {...rest}
      value={ime.local}
      onChange={ime.onChange}
      onCompositionStart={(e) => { ime.onCompositionStart(); onCompositionStart?.(e); }}
      onCompositionEnd={(e) => { ime.onCompositionEnd(e); onCompositionEnd?.(e); }}
      onFocus={(e: FocusEvent<HTMLInputElement>) => { ime.onFocus(); onFocus?.(e); }}
      onBlur={(e: FocusEvent<HTMLInputElement>) => { ime.onBlur(); onBlur?.(e); }}
    />
  );
});
