import { useState, useEffect, useCallback, memo } from "react";
import { X, ChevronLeft, ChevronRight, FileText, Paperclip } from "lucide-react";
import type { CanvasNode } from "../../hooks/useCanvasStore";
import { getNodeConfig, NODE_ICONS } from "../../lib/nodeConfig";
import type {
  ScriptNodeData, StoryboardNodeData, PromptNodeData, ImageGenNodeData,
  AssetNodeData, VideoTaskNodeData, AIChatNodeData, NoteNodeData,
} from "../../../../shared/types";

interface PresentationModeProps {
  nodes: CanvasNode[];
  onClose: () => void;
}

function SlideContent({ node }: { node: CanvasNode }) {
  const { nodeType, payload } = node.data;

  if (nodeType === "script") {
    const d = payload as ScriptNodeData;
    return (
      <div
        className="w-full h-full overflow-auto p-6"
        style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--c-t1)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}
      >
        {d.content || <span style={{ color: "var(--c-t4)" }}>（暂无内容）</span>}
      </div>
    );
  }

  if (nodeType === "storyboard") {
    const d = payload as StoryboardNodeData;
    return (
      <div className="w-full h-full flex gap-5 p-5 overflow-hidden">
        {d.imageUrl ? (
          <div className="flex-shrink-0 w-1/2 rounded-lg overflow-hidden" style={{ background: "var(--c-canvas)", border: "1px solid var(--c-bd1)" }}>
            <img src={d.imageUrl} alt="storyboard" className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="flex-shrink-0 w-1/2 rounded-lg flex items-center justify-center" style={{ background: "var(--c-canvas)", border: "1px solid var(--c-bd1)" }}>
            <span style={{ color: "var(--c-t4)", fontSize: 13 }}>暂无图像</span>
          </div>
        )}
        <div className="flex-1 flex flex-col gap-3 overflow-auto">
          {d.sceneNumber && (
            <div style={{ fontSize: 11, color: "var(--c-t3)", letterSpacing: "0.05em" }}>
              场景 {d.sceneNumber}
            </div>
          )}
          {d.description && (
            <p style={{ fontSize: 14, color: "var(--c-t1)", lineHeight: 1.6 }}>{d.description}</p>
          )}
          {d.promptText && (
            <div style={{ background: "var(--c-base)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "var(--c-t2)", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
              {d.promptText}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-auto">
            {d.duration && <Chip label={`${d.duration}s`} />}
            {d.cameraMovement && <Chip label={d.cameraMovement} />}
            {d.lens && <Chip label={d.lens} />}
          </div>
        </div>
      </div>
    );
  }

  if (nodeType === "prompt") {
    const d = payload as PromptNodeData;
    return (
      <div className="w-full h-full flex gap-5 p-5 overflow-hidden">
        {d.imageUrl && (
          <div className="flex-shrink-0 w-1/2 rounded-lg overflow-hidden" style={{ background: "var(--c-canvas)", border: "1px solid var(--c-bd1)" }}>
            <img src={d.imageUrl} alt="prompt preview" className="w-full h-full object-contain" />
          </div>
        )}
        <div className="flex-1 flex flex-col gap-4 overflow-auto">
          <div>
            <div style={{ fontSize: 10, color: "var(--c-t4)", letterSpacing: "0.05em", marginBottom: 6 }}>正向提示词</div>
            <p style={{ fontSize: 13, color: "var(--c-t1)", lineHeight: 1.6, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
              {d.positivePrompt || <span style={{ color: "var(--c-t4)" }}>（空）</span>}
            </p>
          </div>
          {d.negativePrompt && (
            <div>
              <div style={{ fontSize: 10, color: "var(--c-t4)", letterSpacing: "0.05em", marginBottom: 6 }}>反向提示词</div>
              <p style={{ fontSize: 13, color: "var(--c-t3)", lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>{d.negativePrompt}</p>
            </div>
          )}
          <div className="flex gap-2 flex-wrap mt-auto">
            {d.style && <Chip label={d.style} />}
            {d.aspectRatio && <Chip label={d.aspectRatio} />}
          </div>
        </div>
      </div>
    );
  }

  if (nodeType === "image_gen") {
    const d = payload as ImageGenNodeData;
    return (
      <div className="w-full h-full flex gap-5 p-5 overflow-hidden">
        {d.imageUrl ? (
          <div className="flex-shrink-0 w-1/2 rounded-lg overflow-hidden" style={{ background: "var(--c-canvas)", border: "1px solid var(--c-bd1)" }}>
            <img src={d.imageUrl} alt="generated" className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="flex-shrink-0 w-1/2 rounded-lg flex items-center justify-center" style={{ background: "var(--c-canvas)", border: "1px dashed oklch(0.72 0.20 330 / 0.3)" }}>
            <span style={{ color: "var(--c-t4)", fontSize: 13 }}>尚未生成图像</span>
          </div>
        )}
        <div className="flex-1 flex flex-col gap-3 overflow-auto">
          {d.prompt && (
            <div>
              <div style={{ fontSize: 10, color: "var(--c-t4)", letterSpacing: "0.05em", marginBottom: 6 }}>提示词</div>
              <p style={{ fontSize: 14, color: "var(--c-t1)", lineHeight: 1.6 }}>{d.prompt}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-auto">
            {d.style && <Chip label={d.style} />}
            {d.aspectRatio && <Chip label={d.aspectRatio} />}
          </div>
        </div>
      </div>
    );
  }

  if (nodeType === "asset") {
    const d = payload as AssetNodeData;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-5">
        {d.type === "image" && d.url ? (
          <img src={d.url} alt={d.name} className="max-w-full max-h-full object-contain rounded-lg" />
        ) : d.type === "video" && d.url ? (
          <video src={d.url} controls className="max-w-full max-h-full rounded-lg" />
        ) : (
          <div className="flex flex-col items-center gap-3" style={{ color: "var(--c-t4)" }}>
            <Paperclip style={{ width: 40, height: 40 }} />
            <span style={{ fontSize: 14 }}>{d.name}</span>
            {d.mimeType && <Chip label={d.mimeType} />}
          </div>
        )}
      </div>
    );
  }

  if (nodeType === "video_task") {
    const d = payload as VideoTaskNodeData;
    return (
      <div className="w-full h-full flex flex-col gap-4 p-5 overflow-auto">
        {d.resultVideoUrl ? (
          <video
            src={d.resultVideoUrl?.startsWith("http") ? `/api/video-proxy?url=${encodeURIComponent(d.resultVideoUrl)}` : d.resultVideoUrl}
            controls
            className="w-full rounded-lg"
            style={{ maxHeight: "60%" }}
            preload="metadata"
          />
        ) : (
          <div className="flex items-center gap-2 p-4 rounded-lg" style={{ background: "var(--c-base)", border: "1px solid var(--c-bd1)" }}>
            <StatusBadge status={d.status} />
            <span style={{ fontSize: 13, color: "var(--c-t2)" }}>{statusLabel(d.status)}</span>
            {d.progress !== undefined && <span style={{ fontSize: 12, color: "var(--c-t3)", marginLeft: "auto" }}>{d.progress}%</span>}
          </div>
        )}
        {d.prompt && (
          <div>
            <div style={{ fontSize: 10, color: "var(--c-t4)", letterSpacing: "0.05em", marginBottom: 6 }}>提示词</div>
            <p style={{ fontSize: 13, color: "var(--c-t2)", lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>{d.prompt}</p>
          </div>
        )}
        <div className="flex gap-2 mt-auto">
          <Chip label={d.provider.toUpperCase()} />
        </div>
      </div>
    );
  }

  if (nodeType === "ai_chat") {
    const d = payload as AIChatNodeData;
    const messages = d.messages ?? [];
    const recent = messages.slice(-6);
    return (
      <div className="w-full h-full flex flex-col gap-2 p-5 overflow-auto">
        {recent.length === 0 ? (
          <span style={{ color: "var(--c-t4)", fontSize: 13 }}>（暂无对话）</span>
        ) : recent.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "80%",
              background: msg.role === "user"
                ? "oklch(0.68 0.22 285 / 0.15)"
                : "var(--c-surface)",
              border: `1px solid ${msg.role === "user" ? "oklch(0.68 0.22 285 / 0.25)" : "var(--c-bd2)"}`,
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12,
              color: "var(--c-t1)",
              lineHeight: 1.5,
            }}
          >
            {msg.content}
          </div>
        ))}
      </div>
    );
  }

  if (nodeType === "note") {
    const d = payload as NoteNodeData;
    return (
      <div
        className="w-full h-full overflow-auto p-6"
        style={{ fontSize: 15, color: "var(--c-t1)", lineHeight: 1.75, whiteSpace: "pre-wrap", fontStyle: "italic" }}
      >
        {d.content || <span style={{ color: "var(--c-t4)" }}>（空便签）</span>}
      </div>
    );
  }

  return null;
}

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 10,
        background: "var(--c-elevated)",
        border: "1px solid var(--c-bd2)",
        color: "var(--c-t3)",
        letterSpacing: "0.01em",
      }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "succeeded" ? "oklch(0.72 0.18 155)" :
    status === "failed" ? "oklch(0.65 0.22 25)" :
    status === "processing" ? "oklch(0.68 0.22 285)" :
    "var(--c-t3)";
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />;
}

function statusLabel(s: string) {
  return { pending: "等待中", processing: "生成中", succeeded: "已完成", failed: "失败" }[s] ?? s;
}

export const PresentationMode = memo(function PresentationMode({ nodes, onClose }: PresentationModeProps) {
  const sorted = [...nodes].sort((a, b) => {
    const dy = a.position.y - b.position.y;
    return Math.abs(dy) > 80 ? dy : a.position.x - b.position.x;
  });

  const [index, setIndex] = useState(0);
  const current = sorted[index];

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIndex((i) => Math.min(sorted.length - 1, i + 1)), [sorted.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") prev();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, prev, next]);

  if (!current) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "oklch(0.04 0.003 260 / 0.97)", backdropFilter: "blur(20px)" }}
      >
        <div style={{ color: "var(--c-t4)", fontSize: 14 }}>画布上暂无节点</div>
        <button onClick={onClose} style={{ position: "absolute", top: 20, right: 20, color: "var(--c-t3)" }}>
          <X style={{ width: 20, height: 20 }} />
        </button>
      </div>
    );
  }

  const config = getNodeConfig(current.data.nodeType);
  const Icon = NODE_ICONS[config.icon] ?? FileText;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: "oklch(0.04 0.003 260 / 0.97)",
        backdropFilter: "blur(24px)",
        animation: "avc-fade-in 200ms var(--ease-out-expo) forwards",
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center px-6 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--c-surface)" }}
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: `${config.color}20`,
              border: `1px solid ${config.color}38`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            <Icon style={{ width: 14, height: 14, color: config.color }} />
          </div>
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--c-t1)", letterSpacing: "-0.01em" }}>
              {current.data.title}
            </div>
            <div style={{ fontSize: 10, color: config.color, letterSpacing: "0.05em", textTransform: "uppercase", marginTop: 1 }}>
              {config.label}
            </div>
          </div>
        </div>

        {/* Slide count */}
        <div style={{ fontSize: 12, color: "var(--c-t4)", letterSpacing: "0.03em" }}>
          {index + 1} / {sorted.length}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          style={{
            marginLeft: 16,
            width: 32, height: 32, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--c-t4)",
            background: "transparent",
            border: "1px solid transparent",
            cursor: "pointer",
            transition: "all 120ms ease",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
        >
          <X style={{ width: 16, height: 16 }} />
        </button>
      </div>

      {/* Slide content */}
      <div
        className="flex-1 overflow-hidden relative"
        key={current.id}
        style={{ animation: "avc-slide-presentation 220ms var(--ease-out-expo) forwards" }}
      >
        <SlideContent node={current} />
      </div>

      {/* Footer navigation */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{ borderTop: "1px solid var(--c-surface)" }}
      >
        {/* Dot indicators */}
        <div className="flex items-center gap-1.5 flex-1">
          {sorted.slice(0, 20).map((n, i) => {
            const c = getNodeConfig(n.data.nodeType);
            return (
              <button
                key={n.id}
                onClick={() => setIndex(i)}
                style={{
                  width: i === index ? 18 : 6,
                  height: 6,
                  borderRadius: 99,
                  background: i === index ? c.color : "var(--c-bd2)",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 200ms ease",
                  flexShrink: 0,
                }}
              />
            );
          })}
          {sorted.length > 20 && <span style={{ fontSize: 10, color: "var(--c-t4)" }}>…</span>}
        </div>

        {/* Prev / Next */}
        <div className="flex items-center gap-2">
          <NavBtn icon={ChevronLeft} label="上一张" onClick={prev} disabled={index === 0} />
          <NavBtn icon={ChevronRight} label="下一张" onClick={next} disabled={index === sorted.length - 1} />
        </div>
      </div>
    </div>
  );
});

function NavBtn({ icon: Icon, label, onClick, disabled }: {
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  label: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        width: 36, height: 36, borderRadius: 10,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--c-base)",
        border: "1px solid var(--c-bd2)",
        color: disabled ? "var(--c-bd3)" : "var(--c-t2)",
        cursor: disabled ? "default" : "pointer",
        transition: "all 120ms ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)";
          (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLElement).style.background = "var(--c-base)";
          (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
        }
      }}
    >
      <Icon style={{ width: 16, height: 16 }} />
    </button>
  );
}
