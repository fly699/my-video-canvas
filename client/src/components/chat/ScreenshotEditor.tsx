import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil, Square, ArrowUpRight, Undo2, Check } from "lucide-react";

// Screen capture + lightweight annotation for the chat composer. Captured via the
// browser's getDisplayMedia (the standard share-screen/window/tab picker), then
// the user can draw pen/rect/arrow strokes before adding the PNG to the message.

/** Capture one frame of a screen/window/tab the user picks. Returns a PNG data URL,
 *  or null if unsupported / cancelled. Must be called from a user gesture. */
export async function captureScreen(): Promise<string | null> {
  const md = navigator.mediaDevices as MediaDevices | undefined;
  if (!md?.getDisplayMedia) return null;
  let stream: MediaStream;
  try {
    stream = await md.getDisplayMedia({ video: true, audio: false });
  } catch {
    return null; // user cancelled or denied
  }
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Wait for an actual frame (videoWidth becomes non-zero).
    await new Promise<void>((resolve) => {
      let tries = 0;
      const tick = () => { if (video.videoWidth > 0 || ++tries > 20) resolve(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const c = document.createElement("canvas");
    c.width = video.videoWidth || 1280;
    c.height = video.videoHeight || 720;
    c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

type Tool = "pen" | "rect" | "arrow";
interface Pt { x: number; y: number }
interface Shape { tool: Tool; color: string; w: number; points: Pt[] }

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#111111"];

export function ScreenshotEditor({ imageUrl, onCancel, onConfirm }: {
  imageUrl: string;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef<Shape | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);

  function drawArrow(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const h = 12 + w * 2.5;
    for (const d of [ang - Math.PI / 7, ang + Math.PI / 7]) {
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - h * Math.cos(d), b.y - h * Math.sin(d)); ctx.stroke();
    }
  }
  function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const p = s.points; if (p.length < 1) return;
    if (s.tool === "pen") { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (const q of p.slice(1)) ctx.lineTo(q.x, q.y); ctx.stroke(); }
    else { const a = p[0], b = p[p.length - 1]; if (s.tool === "rect") ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); else drawArrow(ctx, a, b, s.w); }
  }
  function redraw() {
    const canvas = canvasRef.current, img = imgRef.current;
    if (!canvas || !img) return;
    if (canvas.width !== img.naturalWidth) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const all = drawingRef.current ? [...shapes, drawingRef.current] : shapes;
    for (const s of all) drawShape(ctx, s);
  }

  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; redraw(); };
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);
  useEffect(redraw); // re-render whenever shapes/tool change

  const lineW = () => Math.max(3, Math.round((canvasRef.current?.width ?? 1200) / 350));
  function pos(e: React.PointerEvent): Pt {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function onDown(e: React.PointerEvent) { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drawingRef.current = { tool, color, w: lineW(), points: [pos(e)] }; }
  function onMove(e: React.PointerEvent) { const d = drawingRef.current; if (!d) return; const p = pos(e); if (tool === "pen") d.points.push(p); else d.points = [d.points[0], p]; redraw(); }
  function onUp() { const d = drawingRef.current; if (d) { drawingRef.current = null; setShapes((s) => [...s, d]); } }

  function confirm() {
    const c = canvasRef.current; if (!c) return;
    c.toBlob((blob) => { if (blob) onConfirm(new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" })); }, "image/png");
  }

  const toolBtn = (t: Tool, Icon: typeof Pencil, label: string) => (
    <button onClick={() => setTool(t)} title={label}
      style={{ display: "flex", alignItems: "center", gap: 5, height: 32, padding: "0 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
        background: tool === t ? "oklch(0.68 0.22 285 / 0.2)" : "rgba(255,255,255,0.06)", border: `1px solid ${tool === t ? "oklch(0.68 0.22 285 / 0.5)" : "rgba(255,255,255,0.12)"}`, color: tool === t ? "oklch(0.78 0.16 285)" : "#e6e6ea" }}>
      <Icon size={15} /> {label}
    </button>
  );

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100001, background: "oklch(0 0 0 / 0.78)", backdropFilter: "blur(4px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderRadius: 12, background: "oklch(0.18 0.01 285)", border: "1px solid rgba(255,255,255,0.12)" }}>
        {toolBtn("pen", Pencil, "画笔")}
        {toolBtn("rect", Square, "矩形")}
        {toolBtn("arrow", ArrowUpRight, "箭头")}
        <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.15)" }} />
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} title={c} style={{ width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", border: color === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.3)", boxShadow: color === c ? "0 0 0 2px oklch(0.68 0.22 285)" : "none" }} />
        ))}
        <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.15)" }} />
        <button onClick={() => setShapes((s) => s.slice(0, -1))} disabled={shapes.length === 0} title="撤销"
          style={{ display: "flex", alignItems: "center", gap: 5, height: 32, padding: "0 10px", borderRadius: 8, fontSize: 12.5, cursor: shapes.length ? "pointer" : "not-allowed", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e6e6ea", opacity: shapes.length ? 1 : 0.5 }}>
          <Undo2 size={15} /> 撤销
        </button>
        <button onClick={onCancel} title="取消" style={{ display: "flex", alignItems: "center", gap: 5, height: 32, padding: "0 10px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e6e6ea" }}><X size={15} /> 取消</button>
        <button onClick={confirm} title="添加到消息" style={{ display: "flex", alignItems: "center", gap: 5, height: 32, padding: "0 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: "oklch(0.68 0.22 285 / 0.2)", border: "1px solid oklch(0.68 0.22 285 / 0.55)", color: "oklch(0.8 0.14 285)" }}><Check size={15} /> 添加到消息</button>
      </div>
      {/* Canvas */}
      <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        style={{ maxWidth: "94vw", maxHeight: "calc(100vh - 110px)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", boxShadow: "0 16px 50px oklch(0 0 0 / 0.5)", cursor: "crosshair", touchAction: "none", background: "#000" }} />
    </div>,
    document.body,
  );
}
