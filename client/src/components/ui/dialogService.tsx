import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// 应用内统一的 确认 / 输入 弹窗，替代无法主题化、样式割裂、移动端体验差的原生
// window.confirm / window.prompt。用 Promise 式命令 API，替换处几乎零改动：
//   if (await confirmDialog({ title: "确认删除？", danger: true })) { ... }
//   const name = await promptDialog({ title: "重命名", defaultValue: cur });  // 取消 → null
// 需在应用根挂一个 <DialogHost/>（见 App.tsx）。

type ConfirmOpts = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type PromptOpts = { title: string; message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string; mask?: boolean };

type Req =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

let listener: ((r: Req) => void) | null = null;
function push(r: Req) {
  // 无宿主时安全降级：confirm→false、prompt→null（不阻断，只是不弹）。
  if (listener) listener(r);
  else r.resolve(r.kind === "confirm" ? (false as never) : (null as never));
}

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => push({ kind: "confirm", opts, resolve }));
}
export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => push({ kind: "prompt", opts, resolve }));
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    listener = (r) => { setReq(r); if (r.kind === "prompt") setVal(r.opts.defaultValue ?? ""); };
    return () => { listener = null; };
  }, []);

  // 打开后把焦点移入弹窗（prompt→输入框，confirm→确认钮），Esc 取消。
  useEffect(() => {
    if (!req) return;
    const t = setTimeout(() => { (req.kind === "prompt" ? inputRef.current : confirmBtnRef.current)?.focus(); (inputRef.current)?.select(); }, 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!req) return null;
  const o = req.opts;
  const danger = req.kind === "confirm" && req.opts.danger;

  const close = () => setReq(null);
  const cancel = () => { req.resolve(req.kind === "confirm" ? (false as never) : (null as never)); close(); };
  const accept = () => {
    if (req.kind === "confirm") req.resolve(true as never);
    else req.resolve((val.trim() || req.opts.defaultValue || "") as never);
    close();
  };

  const accent = danger ? "oklch(0.62 0.20 25)" : "oklch(0.62 0.2 285)";
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={o.title}
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
      style={{ position: "fixed", inset: 0, zIndex: 2147483300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(6px)" }}
    >
      <div
        style={{ width: "min(92vw, 400px)", borderRadius: 16, background: "var(--c-elevated, #1a1a20)", border: "1px solid var(--c-bd2)", boxShadow: "0 24px 64px oklch(0 0 0 / 0.5)", padding: 22, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--c-t1)", margin: 0 }}>{o.title}</h3>
        {o.message && <p style={{ fontSize: 13, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>{o.message}</p>}
        {req.kind === "prompt" && (
          <input
            ref={inputRef}
            value={val}
            type={req.opts.mask ? "password" : "text"}
            placeholder={req.opts.placeholder}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); accept(); } }}
            style={{ fontSize: 14, padding: "9px 12px", borderRadius: 9, background: "var(--c-input, var(--c-base))", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }}
          />
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button
            onClick={cancel}
            style={{ fontSize: 13, padding: "8px 15px", borderRadius: 9, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer" }}
          >{o.cancelLabel ?? "取消"}</button>
          <button
            ref={confirmBtnRef}
            onClick={accept}
            style={{ fontSize: 13, fontWeight: 700, padding: "8px 17px", borderRadius: 9, border: "none", background: accent, color: "#fff", cursor: "pointer" }}
          >{o.confirmLabel ?? (danger ? "删除" : "确定")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
